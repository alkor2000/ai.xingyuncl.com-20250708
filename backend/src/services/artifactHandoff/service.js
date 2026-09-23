const { randomUUID } = require('crypto');
const path = require('path');
const { fail, digest } = require('./source');
const { TTL_MS, DraftStore } = require('./store');
const { TARGET, delivery, validateReceipt, MockArtifactReceiver } = require('./receiver');

const DRAFT_VERSION = 'p03-content-proposal-20260919.2';
const { SCHEMA_VERSION, validUUID, request, validateSelection, prepareSelection } = require('./selection');
const operations = new Map();

class ArtifactHandoffService {
  constructor({ source, store, now = Date.now, receiver }) {
    Object.assign(this, { source, store, now });
    this.receiver = receiver || new MockArtifactReceiver({ store: new DraftStore(path.join(store.directory, 'mock-receiver'), now), now });
  }
  async exclusive(id, fn) {
    const key = `${this.store.directory}:${id}`;
    const task = (operations.get(key) || Promise.resolve()).catch(() => {}).then(fn);
    operations.set(key, task);
    try { return await task; } finally { if (operations.get(key) === task) operations.delete(key); }
  }
  key(owner, key) {
    if (!validUUID(key)) fail('invalid_idempotency_key');
    return digest(`${owner}:${key}`);
  }
  async freeze(owner, body, key) {
    validateSelection(body);
    const keyHash = this.key(owner, key);
    const fingerprint = digest(JSON.stringify(body));
    // A replay can retrieve the existing frozen version after a source edit, but cannot bypass revocation.
    const replay = await this.store.transaction(state => state.keys[keyHash] || null);
    if (replay) {
      if (replay.fingerprint !== fingerprint) fail('idempotency_conflict', 409);
      return { ...(await this.get(owner, replay.snapshot_id)), replayed: true };
    }
    const { manifest, payload } = await prepareSelection(this.source, owner, body);
    manifest.draft_version = DRAFT_VERSION;
    // A purpose change must not create another copy of the same resource. Production/workspace
    // navigation is a separate T11 action; this prototype preserves the first declared purpose.
    const logicalKey = digest(JSON.stringify([String(owner), TARGET, manifest.source, manifest.locator, manifest.content_sha256]));
    const result = await this.store.transaction(state => {
      const raced = state.keys[keyHash];
      if (raced && raced.fingerprint !== fingerprint) fail('idempotency_conflict', 409);
      let record = Object.values(state.snapshots).find(item => item.logical_key === logicalKey);
      const replayed = !!record;
      if (!record) {
        if (Object.values(state.snapshots).filter(item => item.owner === String(owner)).length >= 50) fail('draft_limit', 429);
        const created = this.now();
        record = { id: randomUUID(), operation_id: randomUUID(), owner: String(owner), logical_key: logicalKey, manifest, payload,
          created_at: Math.floor(created / 1000), expires_at: created + TTL_MS };
        state.snapshots[record.id] = record;
      }
      state.keys[keyHash] = { fingerprint, snapshot_id: record.id, expires_at: record.expires_at };
      return { ...this.publicSnapshot(record), replayed };
    });
    return result;
  }
  publicSnapshot(record) {
    return { id: record.id, created_at: record.created_at, expires_at: Math.floor(record.expires_at / 1000),
      manifest: record.manifest, payload: record.payload, receiver: TARGET,
      binding: delivery(record).binding,
      source_checks: { source_access: 'allowed', selected_attachments: 'readable',
        checked_at: Math.floor(this.now() / 1000), cross_platform_authority: 'simulated_only' } };
  }
  async owned(owner, id) {
    if (!validUUID(id)) fail('snapshot_unavailable', 404);
    const record = await this.store.transaction(state => state.snapshots[id] || null);
    if (!record || record.owner !== String(owner)) fail('snapshot_unavailable', 404);
    const current = await this.source.load(owner, record.manifest.source.object_id);
    // Snapshots retain their bytes after edits; source access and selected attachment access remain live.
    for (const item of record.payload.attachments) {
      if (!current.ids.includes(item.source_id)) fail('attachment_unavailable', 409);
      await this.source.attachment(owner, item.source_id);
    }
    return record;
  }
  async get(owner, id) { return this.publicSnapshot(await this.owned(owner, id)); }
  async inspect(owner, id) {
    const preview = await this.source.inspect(owner, id);
    const latest = await this.store.transaction(state => Object.values(state.snapshots)
      .filter(item => item.owner === String(owner) && item.manifest.source.object_id === id)
      .sort((a, b) => b.created_at - a.created_at)[0]?.id || null);
    return { ...preview, latest_snapshot_id: latest };
  }
  async authorize(owner, id, body, key) {
    request(body, ['simulation']);
    if (!['valid', 'expired', 'revoked'].includes(body.simulation)) fail('invalid_request');
    const record = await this.owned(owner, id);
    const keyHash = this.key(owner, key);
    const fingerprint = digest(JSON.stringify([id, body]));
    return this.store.transaction(state => {
      const prior = state.grants[keyHash];
      if (prior && prior.fingerprint !== fingerprint) fail('idempotency_conflict', 409);
      const grant = prior || { id: randomUUID(), owner: String(owner), snapshot_id: id,
        content_sha256: record.manifest.content_sha256, target: TARGET, fingerprint, binding: delivery(record).binding,
        valid_until: this.now() + (body.simulation === 'expired' ? -1 : 5 * 60 * 1000),
        revoked: body.simulation === 'revoked', expires_at: record.expires_at };
      state.grants[keyHash] = grant;
      return { grant_id: grant.id, valid_until: Math.floor(grant.valid_until / 1000), simulated: true };
    });
  }
  async status(owner, id) {
    return this.exclusive(id, async () => {
      const record = await this.owned(owner, id);
      const accepted = await this.lookupReceipt(record);
      if (accepted) return this.recordReceipt(owner, record, accepted, true);
      return this.store.transaction(state => state.operations[id]?.result ||
        { state: 'prepared', ...delivery(record).binding });
    });
  }
  async lookupReceipt(record) {
    const accepted = await this.receiver.lookup(delivery(record).binding);
    const previous = await this.store.transaction(state => state.operations[record.id]?.result);
    // Losing a known receiver record is an inconsistency, not permission to recreate its resource.
    if (!accepted && previous?.state === 'mock_received') fail('receipt_invalid', 502, true);
    return accepted;
  }
  async recordReceipt(owner, record, response, replayed) {
    const receipt = validateReceipt(response, delivery(record).binding, this.now());
    // A completed transfer does not grant permanent access to a now revoked source.
    await this.owned(owner, record.id);
    return this.store.transaction(state => {
      const previous = state.operations[record.id]?.result?.receipt;
      if (previous && JSON.stringify(previous) !== JSON.stringify(receipt)) fail('receipt_invalid', 502, true);
      const result = { state: 'mock_received', ...delivery(record).binding, receipt_id: receipt.receipt_id, receipt, replayed,
        continuation: { state: 'not_started', action: 'select_resource', receiver: TARGET,
          resource_id: receipt.resource_id, resource_version: receipt.resource_version, purpose: record.manifest.purpose } };
      state.operations[record.id] = { result, expires_at: record.expires_at };
      return result;
    });
  }
  async deliver(owner, id, body, key) {
    request(body, ['grant_id', 'simulation']);
    if (!validUUID(body.grant_id) || !['success', 'reject', 'lose_response'].includes(body.simulation)) fail('invalid_request');
    const keyHash = `deliver:${this.key(owner, key)}`;
    return this.exclusive(id, async () => {
      const record = await this.owned(owner, id);
      const packet = delivery(record);
      await this.store.transaction(state => {
        if (state.keys[keyHash] && state.keys[keyHash].snapshot_id !== id) fail('idempotency_conflict', 409);
        state.keys[keyHash] = { snapshot_id: id, expires_at: record.expires_at };
      });
      // Query the independently durable receiver BEFORE considering new authorization or a resend.
      const accepted = await this.lookupReceipt(record);
      if (accepted) return this.recordReceipt(owner, record, accepted, true);
      await this.store.transaction(state => {
        const grant = Object.values(state.grants).find(item => item.id === body.grant_id);
        if (!grant || grant.owner !== String(owner) || grant.snapshot_id !== id || grant.target !== TARGET ||
            grant.content_sha256 !== record.manifest.content_sha256 || grant.revoked || grant.valid_until <= this.now() ||
            JSON.stringify(grant.binding) !== JSON.stringify(packet.binding)) fail('authorization_expired', 403);
        // Durable source intent precedes any receiver mutation. Restart can query even after a crash here.
        state.operations[id] = { result: { state: 'outcome_unknown', ...packet.binding }, expires_at: record.expires_at };
      });
      try {
        await this.owned(owner, id);
        const receipt = await this.receiver.accept(packet, body.simulation);
        return await this.recordReceipt(owner, record, receipt, false);
      } catch (error) {
        // Only the fake receiver's explicit pre-acceptance rejection proves that nothing was stored.
        if (error.code === 'receiver_unavailable') await this.store.transaction(state => {
          state.operations[id] = { result: { state: 'retryable_failure', ...packet.binding }, expires_at: record.expires_at };
        });
        throw error;
      }
    });
  }
}
module.exports = { ArtifactHandoffService, SCHEMA_VERSION, DRAFT_VERSION, request, validUUID };

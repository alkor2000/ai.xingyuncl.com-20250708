const { randomUUID } = require('crypto');
const { fail, digest } = require('./source');
const { TTL_MS } = require('./store');

const DRAFT_VERSION = 'p03-content-proposal-20260918.1';
const TARGET = 'mock-tedna';
const { SCHEMA_VERSION, validUUID, request, validateSelection, prepareSelection } = require('./selection');

class ArtifactHandoffService {
  constructor({ source, store, now = Date.now }) { Object.assign(this, { source, store, now }); }
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
        record = { id: randomUUID(), owner: String(owner), logical_key: logicalKey, manifest, payload,
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
      manifest: record.manifest, payload: record.payload, receiver: TARGET };
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
        content_sha256: record.manifest.content_sha256, target: TARGET, fingerprint,
        valid_until: this.now() + (body.simulation === 'expired' ? -1 : 5 * 60 * 1000),
        revoked: body.simulation === 'revoked', expires_at: record.expires_at };
      state.grants[keyHash] = grant;
      return { grant_id: grant.id, valid_until: Math.floor(grant.valid_until / 1000), simulated: true };
    });
  }
  async status(owner, id) {
    await this.owned(owner, id);
    return this.store.transaction(state => state.operations[id]?.result || { state: 'prepared', receiver: TARGET });
  }
  async deliver(owner, id, body, key) {
    request(body, ['grant_id', 'simulation']);
    if (!validUUID(body.grant_id) || !['success', 'reject', 'lose_response'].includes(body.simulation)) fail('invalid_request');
    const keyHash = `deliver:${this.key(owner, key)}`;
    const record = await this.owned(owner, id);
    const result = await this.store.transaction(state => {
      if (state.keys[keyHash] && state.keys[keyHash].snapshot_id !== id) fail('idempotency_conflict', 409);
      state.keys[keyHash] = { snapshot_id: id, expires_at: record.expires_at };
      // Recovery of an already accepted operation is independent of consumed/expired simulation grants.
      const accepted = state.received[id];
      if (accepted) {
        const result = { state: 'mock_received', receiver: TARGET, receipt_id: accepted.receipt_id, replayed: true };
        state.operations[id] = { result, expires_at: record.expires_at };
        return { result };
      }
      const grant = Object.values(state.grants).find(item => item.id === body.grant_id);
      if (!grant || grant.owner !== String(owner) || grant.snapshot_id !== id || grant.target !== TARGET ||
          grant.content_sha256 !== record.manifest.content_sha256 || grant.revoked || grant.valid_until <= this.now()) {
        fail('authorization_expired', 403);
      }
      if (body.simulation === 'reject') {
        state.operations[id] = { result: { state: 'retryable_failure', receiver: TARGET }, expires_at: record.expires_at };
        return { error: 'receiver_unavailable' };
      }
      // Fake receiver durable acceptance. This packet contains no conversation history or account tokens.
      const packet = { manifest: record.manifest, payload: record.payload };
      state.received[id] = { receipt_id: randomUUID(), packet, expires_at: record.expires_at };
      const result = { state: body.simulation === 'lose_response' ? 'outcome_unknown' : 'mock_received', receiver: TARGET };
      if (result.state === 'mock_received') result.receipt_id = state.received[id].receipt_id;
      state.operations[id] = { result, expires_at: record.expires_at };
      return body.simulation === 'lose_response' ? { error: 'response_lost' } : { result };
    });
    if (result.error) fail(result.error, 503, true);
    return result.result;
  }
}
module.exports = { ArtifactHandoffService, SCHEMA_VERSION, DRAFT_VERSION, request, validUUID };

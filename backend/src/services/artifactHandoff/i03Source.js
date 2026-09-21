// Actual source orchestration for the draft and the formal candidate, unmounted and development/test only.
// Authority must supply current subject/copy checks and a lock shared with source mutations.
// A store may supply cross-process exclusion. Native application authority/teacher policy remain separate work.
// Formal wire (rc2): W = Identity's first persisted issue + 86400 arrives as operation_expires_at and never
// changes; R = W + 29d bounds status/cancel authorization; L = local snapshot deadline (freeze + 24h).
// Release needs now < min(L, W). Records whose first issue has no trusted W yet are held out of cleanup;
// bounded recovery failures turn them into reconciliation records that stop automatic writes.
const { randomUUID } = require('crypto');
const { fail, digest } = require('./source');
const { prepareSelection, validateSelection, validUUID } = require('./selection');
const { encodeDraft, VERSION, FORMAL_VERSION, WIRE_VERSIONS } = require('./i03Draft');
const { targetReceipt, RECOVERY_SECONDS } = require('./i03Client');
const DAY = 86400000;
const ISSUE_SETTLE_MS = 30000; // peer-side bound after our own request ended; before it, "not_prepared" is not proof
const RECOVERY_ATTEMPT_LIMIT = 5;
// Local metadata outlives R by one day so the last known result stays readable; no authorization is
// requested after R. Candidate parameter, recorded in the handoff notes, not a protocol value.
const METADATA_GRACE_SECONDS = 86400;
const RECONCILIATION_OUTCOMES = ['not_created', 'cancelled', 'expired', 'rejected', 'deleted'];
const queues = new Map();
const terminal = status => ['succeeded', 'cancelled', 'expired', 'deleted', 'rejected'].includes(status);
// rc3: a recycled resource keeps its identity and may be restored by the target owner; the source never
// writes again, never rewrites it as expired, and shows it until the target reports deleted or succeeded.
const settled = status => terminal(status) || status === 'recycled';
const seconds = ms => Math.floor(ms / 1000);
class I03DraftSource {
  constructor({ source, store, authority, client, sourceInstance, targetInstance, now = Date.now, env = process.env,
    wireVersion = VERSION, recoveryAttemptLimit = RECOVERY_ATTEMPT_LIMIT }) {
    if (!['development', 'test'].includes(env.NODE_ENV)) fail('disabled', 404);
    if (!authority || ['checkSubject', 'checkExport', 'withSourceLock'].some(k => typeof authority[k] !== 'function')) fail('invalid_draft_configuration');
    if (!WIRE_VERSIONS.includes(wireVersion) || !Number.isSafeInteger(recoveryAttemptLimit) || recoveryAttemptLimit < 1 || recoveryAttemptLimit > 50) fail('invalid_draft_configuration');
    Object.assign(this, { source, store, authority, client, sourceInstance, targetInstance, now, wireVersion, recoveryAttemptLimit,
      formal: wireVersion === FORMAL_VERSION, issueWindowMs: (client?.timeoutMs || 5000) + ISSUE_SETTLE_MS });
  }
  async exclusive(id, fn) {
    if (this.store.exclusive) return this.store.exclusive(id, fn);
    const key = `${this.store.directory}:${id}`;
    const work = (queues.get(key) || Promise.resolve()).catch(() => {}).then(fn);
    queues.set(key, work);
    try { return await work; } finally { if (queues.get(key) === work) queues.delete(key); }
  }
  tx(owner, fn, options) { return this.store.transaction(String(owner), fn, options); }
  view(record) {
    return { schema_version: 1, protocol_version: record.protocol_version || VERSION, draft_only: true, operation_id: record.id,
      status: record.status, ...(record.last_error ? { error_code: record.last_error } : {}),
      ...(record.retry_at ? { retry_at: Math.ceil(record.retry_at / 1000) } : {}),
      ...(record.operation_expires_at != null ? { operation_expires_at: record.operation_expires_at,
        recovery_until: record.operation_expires_at + RECOVERY_SECONDS } : {}),
      ...(record.reconciliation ? (record.reconciliation.closed_at
        ? { reconciliation_closed: { outcome: record.reconciliation.outcome, closed_at: record.reconciliation.closed_at, actor: record.reconciliation.actor } }
        : { reconciliation_required: true }) : {}),
      ...(record.status === 'succeeded' || record.status === 'recycled' ? { resource_ref: record.receipt.resource_ref,
        resource_version: record.receipt.resource_version, open_target: record.receipt.open_target } : {}),
      ...(record.status === 'succeeded' ? { continuation: { status: 'not_started', landing: record.binding.landing } } : {}),
      ...(record.status === 'recycled' ? { recycle_until: record.receipt.recycle_until } : {}) };
  }
  // Hold keeps a record out of automatic cleanup: its first issue has no trusted W yet, or reconciliation is open.
  settle(op) {
    if (!this.formal) return;
    op.hold = (op.identity_attempted && op.operation_expires_at == null && !terminal(op.status)) ||
      (!!op.reconciliation && !op.reconciliation.closed_at);
  }
  async owned(owner, id) {
    await this.authority.checkSubject(owner);
    const record = validUUID(id) && await this.tx(owner, state => state.operations[id]);
    if (!record || record.owner !== String(owner)) fail('snapshot_unavailable', 404);
    if (record.binding.source_instance !== this.sourceInstance || record.binding.target_instance !== this.targetInstance ||
        (record.protocol_version || VERSION) !== this.wireVersion) fail('binding_mismatch', 409);
    return record;
  }
  async mutate(owner, id, fn) {
    return this.tx(owner, state => {
      const record = state.operations[id];
      if (!record) fail('operation_expired', 410);
      fn(record); this.settle(record); return record;
    });
  }
  async freeze(owner, body, key, title) {
    if (!validUUID(key)) fail('invalid_idempotency_key');
    validateSelection(body);
    await this.authority.checkSubject(owner);
    const keyHash = digest(JSON.stringify(['i03-freeze', this.sourceInstance, this.targetInstance, String(owner), key]));
    const fingerprint = digest(JSON.stringify([body, title]));
    return this.authority.withSourceLock(owner, body.message_id, async () => {
      await this.authority.checkExport(owner, body.message_id);
      const prior = await this.tx(owner, state => state.keys[keyHash]);
      if (prior) {
        if (prior.fingerprint !== fingerprint) fail('idempotency_conflict', 409);
        return this.view(await this.owned(owner, prior.operation_id));
      }
      const selected = await prepareSelection(this.source, owner, body);
      const id = randomUUID(), artifactId = randomUUID();
      const encoded = encodeDraft({ id: artifactId, binding: { operation_id: id }, ...selected },
        { sourceInstance: this.sourceInstance, targetInstance: this.targetInstance, title, wireVersion: this.wireVersion });
      const choice = digest(JSON.stringify([String(owner), this.sourceInstance, this.targetInstance, encoded.binding.destination, encoded.binding.selection_sha256]));
      const record = await this.tx(owner, state => {
        let current = Object.values(state.operations).find(op => op.choice === choice);
        // One selection never straddles two message versions; the other version's record is not adopted.
        if (current && (current.protocol_version || VERSION) !== this.wireVersion) fail('binding_mismatch', 409);
        if (!current) {
          if (Object.values(state.operations).filter(op => op.owner === String(owner) && op.write_until > this.now() && !terminal(op.status)).length >= 50) fail('draft_limit', 429);
          current = { id, owner: String(owner), choice, source_id: body.message_id, protocol_version: this.wireVersion, binding: encoded.binding,
            binding_sha256: encoded.binding_sha256, content_sha256: selected.manifest.content_sha256,
            status: 'ready', identity_attempted: false, released_at: null, cancel_requested: false,
            operation_expires_at: null, recovery_until: null, hold: false,
            write_until: this.now() + DAY, expires_at: this.now() + 30 * DAY };
          state.operations[id] = current;
          state.snapshots[id] = { packet: encoded.package, request: structuredClone(body), expires_at: current.write_until };
        }
        const raced = state.keys[keyHash];
        if (raced && raced.fingerprint !== fingerprint) fail('idempotency_conflict', 409);
        state.keys[keyHash] = { fingerprint, operation_id: current.id, expires_at: current.write_until };
        return current;
      }, { create: true });
      return this.view(record);
    });
  }
  async get(owner, id) { return this.view(await this.owned(owner, id)); }
  // The trusted deadline is persisted from the validated grant before the target request. It is set
  // once; a different value for the same operation is a binding mismatch (rc1 §3.1).
  async learnDeadline(owner, record, grant) {
    if (!this.formal || grant.operation_expires_at == null) return;
    await this.mutate(owner, record.id, op => {
      if (op.operation_expires_at == null) {
        op.operation_expires_at = grant.operation_expires_at;
        op.recovery_until = (grant.operation_expires_at + RECOVERY_SECONDS + METADATA_GRACE_SECONDS) * 1000;
        delete op.recovery_attempts; delete op.failure;
      } else if (op.operation_expires_at !== grant.operation_expires_at) fail('binding_mismatch', 409);
    });
  }
  async remember(owner, record, response) {
    const receipt = targetReceipt(response, record.id, this.wireVersion);
    return this.mutate(owner, record.id, current => {
      if (this.formal && current.operation_expires_at == null) fail('receipt_invalid', 502, true); // no target result without trusted W
      const old = current.receipt;
      if (old) {
        // rc3 §4.1: succeeded ⇄ recycled keep one resource identity; deleted is the tombstone terminal state.
        const sameResource = old.resource_ref === receipt.resource_ref && old.resource_version === receipt.resource_version;
        const kept = ['succeeded', 'recycled'].includes(receipt.status) && sameResource &&
          !(old.status === 'recycled' && receipt.status === 'recycled' && old.recycle_until !== receipt.recycle_until);
        const ok = ['succeeded', 'recycled'].includes(old.status) ? kept || receipt.status === 'deleted'
          : ['deleted', 'cancelled', 'expired', 'rejected'].includes(old.status) ? receipt.status === old.status
            : !(old.status === 'prepared' && receipt.status === 'not_received');
        if (!ok) fail('receipt_invalid', 502, true);
      }
      current.receipt = receipt; current.status = receipt.status;
      delete current.last_error; delete current.retry_at; delete current.pending_attempt; delete current.pending_phase;
    });
  }
  recoveryClosed(op) {
    return this.formal && op.operation_expires_at != null && seconds(this.now()) >= op.operation_expires_at + RECOVERY_SECONDS;
  }
  async send(owner, record, phase, packet) {
    await this.authority.checkSubject(owner);
    const attempt = randomUUID(), nowS = seconds(this.now());
    await this.mutate(owner, record.id, op => {
      if (['prepare', 'commit'].includes(phase) && op.cancel_requested) fail('operation_cancelled', 410);
      if (phase === 'commit' && !op.released_at) fail('not_prepared', 409);
      if (this.formal) {
        if (op.reconciliation && !op.reconciliation.closed_at && phase !== 'status') fail('reconciliation_required', 409);
        if (this.recoveryClosed(op)) fail('recovery_window_closed', 410);
        if (['prepare', 'commit'].includes(phase) && op.operation_expires_at != null && nowS >= op.operation_expires_at) fail('operation_expired', 410);
        if (!op.identity_attempted) op.issue_settles_at = this.now() + this.issueWindowMs; // first issue may still be in flight until then
      }
      op.identity_attempted = true; op.status = 'unknown'; op.pending_phase = phase; op.pending_attempt = attempt;
    });
    try {
      const response = await this.client.send(owner, record, phase, packet, { onIssued: grant => this.learnDeadline(owner, record, grant) });
      return await this.remember(owner, record, response);
    } catch (error) {
      await this.mutate(owner, record.id, op => {
        // A parallel cancel/status may already have installed a newer receipt.
        // Its result must not be replaced by a delayed error from this request.
        if (op.pending_attempt !== attempt) return;
        op.status = 'unknown'; op.last_error = error.code || 'target_unavailable';
        op.retry_at = this.now() + (error.retryAfter || 1) * 1000;
        if (this.formal && op.operation_expires_at == null && error.retryable) {
          // Bounded recovery without a trusted W: keep only minimal failure metadata, never bodies.
          op.recovery_attempts = (op.recovery_attempts || 0) + 1;
          op.failure = { first_at: op.failure?.first_at ?? nowS, last_at: nowS, attempts: op.recovery_attempts, last_error: op.last_error, phase };
          if (op.recovery_attempts >= this.recoveryAttemptLimit && !op.reconciliation) {
            op.reconciliation = { required_at: nowS, attempts: op.recovery_attempts, last_error: op.last_error };
          }
        }
      });
      throw error;
    }
  }
  async query(owner, record) {
    if (!record.identity_attempted) return record;
    if (this.recoveryClosed(record)) return record; // past R: no new human-level authorization; show the last known result
    try { return await this.send(owner, record, 'status'); }
    catch (error) {
      // A failed initial issue may not have created an Identity operation. No target content was sent.
      if (error.peer === 'identity' && error.code === 'not_prepared' && !record.receipt && !record.released_at) {
        if (this.formal && record.issue_settles_at > this.now()) {
          // rc2 §2.3: absence while the original issue may still be in flight is not proof of absence.
          await this.mutate(owner, record.id, op => { op.retry_at = op.issue_settles_at; op.last_error = 'not_prepared'; });
          fail('retry_later', 429, true);
        }
        return this.mutate(owner, record.id, op => {
          op.identity_attempted = false; op.status = 'ready';
          for (const k of ['last_error', 'retry_at', 'issue_settles_at', 'recovery_attempts', 'failure']) delete op[k];
        });
      }
      throw error;
    }
  }
  async status(owner, id) {
    return this.exclusive(id, async () => this.view(await this.query(owner, await this.owned(owner, id))));
  }
  async checkSource(owner, record, snapshot) {
    await this.authority.checkSubject(owner);
    await this.authority.checkExport(owner, record.source_id);
    const selected = await prepareSelection(this.source, owner, snapshot.request);
    if (selected.manifest.content_sha256 !== record.content_sha256) fail('source_changed', 409);
  }
  async cancelLocked(owner, record) {
    if (record.cancel_completed) return this.query(owner, record);
    if (this.recoveryClosed(record)) fail('recovery_window_closed', 410); // no revoke/cancel authorization past R
    // Resolve an initial issue failure first: Identity may never have created the operation.
    // Do not mark cancellation complete solely because revoke returned an error.
    if (record.identity_attempted && !record.receipt && !record.released_at) record = await this.query(owner, record);
    if (!record.identity_attempted) return this.mutate(owner, record.id, op => { op.status = 'cancelled'; op.cancel_completed = true; });
    try {
      await this.client.revoke(owner, record);
      await this.send(owner, record, 'cancel');
      return await this.mutate(owner, record.id, op => { op.cancel_completed = true; });
    } catch (error) {
      await this.mutate(owner, record.id, op => {
        op.status = 'unknown'; op.last_error = error.code || 'target_unavailable';
        op.retry_at = this.now() + (error.retryAfter || 1) * 1000;
      });
      throw error;
    }
  }
  async cancel(owner, id) {
    const record = await this.owned(owner, id);
    if (this.recoveryClosed(record)) fail('recovery_window_closed', 410); // no cancel intent is recorded past R
    // Persist intent under the same source lock as release, before waiting for an in-flight request.
    const intent = await this.authority.withSourceLock(owner, record.source_id,
      () => this.mutate(owner, id, op => { op.cancel_requested = true; }));
    // Revoke can race an in-flight commit. Waiting on the resume lock first would let
    // every already-started commit win, even if its ticket had not been redeemed.
    // Before release, let an outstanding initial issue/prepare resolve first. A status
    // absence while that issue is still in flight is not proof that nothing was created.
    return this.exclusive(intent.released_at ? `${id}:cancel` : id,
      async () => this.view(await this.cancelLocked(owner, await this.owned(owner, id))));
  }
  async resume(owner, id) {
    return this.exclusive(id, async () => {
      let record = await this.owned(owner, id);
      if (record.cancel_requested && !record.cancel_completed) return this.view(await this.cancelLocked(owner, record));
      if (this.formal && record.reconciliation && !record.reconciliation.closed_at) fail('reconciliation_required', 409);
      if (record.retry_at > this.now()) fail('retry_later', 429, true);
      record = await this.query(owner, record); // Every retry reconciles first; no automatic retry loop.
      if (settled(record.status)) return this.view(record);
      // Only after the fresh query above: a success or an unknown result is never rewritten as expired (rc2 V13).
      if (record.write_until <= this.now() || (this.formal && record.operation_expires_at != null && seconds(this.now()) >= record.operation_expires_at)) {
        return this.view(await this.mutate(owner, id, op => { op.status = 'expired'; }));
      }
      const snapshot = await this.tx(owner, state => state.snapshots[id]);
      if (!snapshot) fail('operation_expired', 410);
      if (['ready', 'not_received'].includes(record.status)) {
        if (record.cancel_requested) return this.view(await this.cancelLocked(owner, record));
        await this.authority.withSourceLock(owner, record.source_id, () => this.checkSource(owner, record, snapshot));
        record = await this.send(owner, record, 'prepare', snapshot.packet);
      }
      if (settled(record.status)) return this.view(record);
      if (record.status !== 'prepared') fail('receipt_invalid', 502, true);
      if (!record.released_at) {
        try {
          record = await this.authority.withSourceLock(owner, record.source_id, async () => {
            await this.checkSource(owner, record, snapshot);
            return this.mutate(owner, id, op => {
              if (op.cancel_requested) fail('operation_cancelled', 410);
              // Release requires the local snapshot deadline and, once trusted, Identity's W: now < min(L, W).
              if (op.write_until <= this.now()) fail('operation_expired', 410);
              if (this.formal && (op.operation_expires_at == null || seconds(this.now()) >= op.operation_expires_at)) fail('operation_expired', 410);
              op.released_at = seconds(this.now()); op.status = 'released';
            });
          });
        } catch (error) {
          record = await this.mutate(owner, id, op => { op.cancel_requested = true; });
          try { await this.cancelLocked(owner, record); } catch { /* Durable cancel intent remains resumable. */ }
          throw error;
        }
      }
      record = await this.owned(owner, id);
      if (record.cancel_requested) return this.view(await this.cancelLocked(owner, record));
      return this.view(await this.send(owner, record, 'commit'));
    });
  }
  // Reconciliation exit (rc2 §2.4): an operator closes a held record only after the original attempts have
  // ended and Identity history plus the target receipt/tombstone were checked; the basis is recorded and
  // the record then follows normal retention. No content, ticket or receipt is fabricated here.
  async reconcile(actor, owner, id, closure) {
    if (typeof this.authority.checkReconciler !== 'function') fail('invalid_draft_configuration');
    await this.authority.checkReconciler(actor);
    const keys = ['outcome', 'basis', 'attempts_ended', 'identity_history_checked', 'target_receipt_checked'];
    if (!closure || typeof closure !== 'object' || Array.isArray(closure) || Object.keys(closure).some(k => !keys.includes(k)) ||
        keys.some(k => !(k in closure)) || !RECONCILIATION_OUTCOMES.includes(closure.outcome) ||
        typeof closure.basis !== 'string' || !closure.basis.trim() || Array.from(closure.basis).length > 512 || /[ -]/.test(closure.basis) ||
        [closure.attempts_ended, closure.identity_history_checked, closure.target_receipt_checked].some(v => v !== true)) fail('invalid_request');
    if (!validUUID(id)) fail('snapshot_unavailable', 404);
    return this.exclusive(id, async () => this.view(await this.tx(owner, state => {
      const op = state.operations[id];
      if (!op || op.owner !== String(owner)) fail('snapshot_unavailable', 404);
      if (!op.reconciliation || op.reconciliation.closed_at) fail('invalid_request');
      if (op.issue_settles_at > this.now()) fail('retry_later', 429, true);
      op.reconciliation = { ...op.reconciliation, closed_at: seconds(this.now()), outcome: closure.outcome,
        basis: closure.basis, actor: String(actor) };
      op.status = closure.outcome === 'not_created' ? 'cancelled' : closure.outcome;
      op.cancel_requested = true; op.cancel_completed = true;
      for (const k of ['last_error', 'retry_at', 'pending_attempt', 'pending_phase']) delete op[k];
      this.settle(op); return op;
    })));
  }
}
module.exports = { I03DraftSource, ISSUE_SETTLE_MS, RECOVERY_ATTEMPT_LIMIT, METADATA_GRACE_SECONDS };

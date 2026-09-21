// In-process fake Identity + fake TE-DNA for the formal candidate (teacher-artifact-handoff/1).
// Models rc2 windows: t0 = first persisted issue, W = t0 + 86400, R = W + 29d, write tickets cut at W,
// status/cancel tickets cut at R, target re-checks W after its lock. Synthetic only; no real peer.
const { randomUUID } = require('crypto');
const { HandoffError } = require('../../services/artifactHandoff/source');
const { FORMAL_VERSION } = require('../../services/artifactHandoff/i03Draft');
const DAY = 86400;
const peerError = (code, status, retryable, peer, retryAfter) => Object.assign(new HandoffError(code, status, retryable), { peer, ...(retryAfter ? { retryAfter } : {}) });
class FormalPeers {
  constructor(clock, { timeoutMs = 100 } = {}) {
    this.clock = clock; this.timeoutMs = timeoutMs;
    this.identity = new Map(); // operation_id -> { t0, revoked }
    this.target = new Map();   // operation_id -> { state, resource, version, W }
    this.phases = []; this.issues = []; this.revokes = 0;
    this.script = {};          // loseIssue, loseRedeem, dropRedeem, beforeRedeem, identityDown, deadlineOverride
  }
  now() { return Math.floor(this.clock() / 1000); }
  window(id) { const op = this.identity.get(id); const W = op.t0 + DAY; return { W, R: W + 29 * DAY }; }
  async send(owner, record, phase, packet, { onIssued } = {}) {
    const write = ['prepare', 'commit'].includes(phase);
    if (this.script.identityDown) throw peerError('identity_unavailable', 503, true);
    let op = this.identity.get(record.id);
    if (!op) {
      if (phase !== 'prepare') throw peerError('not_prepared', 409, false, 'identity');
      op = { t0: this.now(), revoked: false }; this.identity.set(record.id, op); // persisted before any response
    }
    if (op.revoked && write) throw peerError('source_permission_revoked', 403, false, 'identity');
    const { W, R } = this.window(record.id), nowS = this.now();
    if (write ? nowS >= W : nowS >= R) throw peerError('operation_expired', 410, false, 'identity');
    const grant = { phase, operation_expires_at: this.script.deadlineOverride ?? W,
      ticket_expires_at: Math.min(nowS + (write ? 120 : 60), write ? W : R) };
    this.issues.push({ phase, ...grant });
    if (this.script.loseIssue) { this.script.loseIssue = false; throw peerError('identity_unavailable', 503, true); }
    if (onIssued) await onIssued(grant);
    if (this.script.beforeRedeem && await this.script.beforeRedeem(phase)) this.script.beforeRedeem = null; // hook acts once
    if (this.script.dropRedeem === phase) { this.script.dropRedeem = null; throw peerError('target_unavailable', 503, true); } // never reached target
    this.phases.push(phase);
    const redeemAt = this.now();
    if (redeemAt >= grant.ticket_expires_at) throw peerError('ticket_expired', 410, false, 'target');
    const t = this.target.get(record.id) || { state: 'not_received', W };
    this.target.set(record.id, t);
    if (t.state === 'prepared' && redeemAt >= t.W) t.state = 'expired'; // target lock-then-check W
    if (phase === 'prepare') {
      if (redeemAt >= t.W) throw peerError('operation_expired', 410, false, 'target');
      if (t.state === 'not_received') { t.state = 'prepared'; t.packet = packet; }
    } else if (phase === 'commit') {
      if (t.state === 'prepared') { t.state = 'succeeded'; t.resource = randomUUID(); t.version = `sha256:${record.binding.manifest_sha256}`; }
      else if (t.state !== 'succeeded') throw peerError(t.state === 'expired' ? 'operation_expired' : 'not_prepared', 409, false, 'target');
    } else if (phase === 'cancel') {
      if (!['succeeded', 'deleted'].includes(t.state)) t.state = 'cancelled';
    }
    if (this.script.loseRedeem === phase) { this.script.loseRedeem = null; throw peerError('target_unavailable', 503, true); }
    return { schema_version: 1, protocol_version: FORMAL_VERSION, request_id: randomUUID().replace(/-/g, ''),
      operation_id: record.id, status: t.state, replayed: false,
      ...(t.state === 'succeeded' ? { resource_ref: t.resource, resource_version: t.version,
        open_target: { kind: 'import_result', operation_id: record.id },
        ...(phase === 'cancel' ? { cancel_outcome: 'already_succeeded' } : {}) } : {}) };
  }
  async revoke(owner, record) {
    if (this.script.identityDown) throw peerError('identity_unavailable', 503, true);
    const op = this.identity.get(record.id);
    if (!op) throw peerError('not_prepared', 409, false, 'identity');
    if (this.now() >= this.window(record.id).R) throw peerError('operation_expired', 410, false, 'identity');
    op.revoked = true; this.revokes++;
  }
}
module.exports = { FormalPeers, DAY };

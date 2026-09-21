// Draft transport, intentionally restricted to loopback development/test peers.
// No production configuration, URL from a response, redirect, or automatic write retry.
const http = require('http');
const { randomBytes, randomUUID } = require('crypto');
const { decodeJSON } = require('../auth/IdentityEnrollmentContract');
const { HandoffError, fail } = require('./source');
const { validUUID } = require('./selection');
const { VERSION, FORMAL_VERSION, WIRE_VERSIONS } = require('./i03Draft');
const PHASES = ['prepare', 'commit', 'status', 'cancel'];
const RECOVERY_SECONDS = 29 * 86400; // rc2: R = W + 29d; status/cancel tickets are cut at R, write tickets at W.
// Trusted service configuration only. Both profiles remain loopback/test-only.
const ENDPOINT_PROFILES = Object.freeze({
  lab: Object.freeze({ issue: '/identity/issue', revoke: '/identity/revoke', target: '/tedna/' }),
  'native-draft': Object.freeze({
    issue: '/backchannel/teacher-artifact-handoffs/v1/issue',
    revoke: '/backchannel/teacher-artifact-handoffs/v1/revoke',
    target: '/api/v1/integrations/teacher-artifacts/'
  })
});
const CODES = new Set(['invalid_request', 'unsupported_schema', 'invalid_package', 'invalid_client', 'ticket_invalid',
  'ticket_expired', 'stale_request', 'action_not_allowed', 'wrong_target', 'phase_not_allowed', 'source_link_unavailable',
  'target_link_unavailable', 'link_changed', 'identity_conflict', 'subject_disabled', 'subject_not_eligible',
  'source_permission_revoked', 'binding_mismatch', 'source_changed', 'idempotency_conflict', 'replay_detected',
  'operation_expired', 'operation_cancelled', 'operation_deleted', 'not_prepared', 'payload_too_large',
  'unsupported_media', 'rate_limited', 'identity_unavailable', 'target_unavailable', 'storage_unavailable']);
const object = v => v && typeof v === 'object' && !Array.isArray(v);
function fields(v, required, optional = []) {
  if (!object(v) || required.some(k => !Object.hasOwn(v, k)) ||
      Object.keys(v).some(k => ![...required, ...optional].includes(k))) fail('receipt_invalid', 502, true);
}
// Request IDs are bounded opaque tracing metadata, not authorization UUIDs.
function validRequestID(v) {
  return typeof v === 'string' && v.length >= 1 && v.length <= 128 && !/[^A-Za-z0-9_-]/.test(v);
}
function envelope(v, wire = VERSION) {
  if (v.schema_version !== 1 || v.protocol_version !== wire || !validRequestID(v.request_id)) fail('receipt_invalid', 502, true);
}
function targetReceipt(v, operationId, wire = VERSION) {
  if (!WIRE_VERSIONS.includes(wire)) fail('invalid_draft_configuration');
  fields(v, ['schema_version', 'protocol_version', 'request_id', 'operation_id', 'status', 'replayed'],
    ['resource_ref', 'resource_version', 'open_target', 'cancel_outcome']);
  envelope(v, wire);
  if (v.operation_id !== operationId || typeof v.replayed !== 'boolean' ||
      !['not_received', 'prepared', 'succeeded', 'cancelled', 'expired', 'deleted', 'rejected'].includes(v.status)) fail('receipt_invalid', 502, true);
  if (v.status === 'succeeded') {
    if (!validUUID(v.resource_ref) || !/^sha256:[a-f0-9]{64}$/.test(v.resource_version)) fail('receipt_invalid', 502, true);
    fields(v.open_target, ['kind', 'operation_id']);
    if (v.open_target.kind !== 'import_result' || v.open_target.operation_id !== operationId) fail('receipt_invalid', 502, true);
  } else if (['resource_ref', 'resource_version', 'open_target'].some(k => k in v)) fail('receipt_invalid', 502, true);
  if ('cancel_outcome' in v && (v.status !== 'succeeded' || v.cancel_outcome !== 'already_succeeded')) fail('receipt_invalid', 502, true);
  return structuredClone(v);
}
function loopback(value) {
  let url;
  try { url = new URL(value); } catch { fail('invalid_draft_configuration'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) fail('invalid_draft_configuration');
  return url.origin;
}
class I03DraftClient {
  // wireVersion selects the message version. The draft keeps its exact behaviour; the formal candidate
  // (teacher-artifact-handoff/1) is a separate strict decoder that requires the trusted operation
  // deadline on every grant. Neither silently consumes the other's responses.
  constructor({ identityOrigin, targetOrigin, getAuthorization, targetClientId = 'tedna-client', now = Date.now,
    timeoutMs = 5000, endpointProfile = 'lab', wireVersion = VERSION, env = process.env }) {
    if (!['development', 'test'].includes(env.NODE_ENV)) fail('disabled', 404);
    if (typeof endpointProfile !== 'string' || !Object.hasOwn(ENDPOINT_PROFILES, endpointProfile) ||
        typeof getAuthorization !== 'function' || targetClientId !== 'tedna-client' ||
        !WIRE_VERSIONS.includes(wireVersion) || (wireVersion === FORMAL_VERSION && endpointProfile !== 'native-draft') ||
        !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 30000) fail('invalid_draft_configuration');
    Object.assign(this, { identityOrigin: loopback(identityOrigin), targetOrigin: loopback(targetOrigin),
      getAuthorization, targetClientId, now, timeoutMs, wireVersion, formal: wireVersion === FORMAL_VERSION,
      endpoints: ENDPOINT_PROFILES[endpointProfile] });
  }
  async post(peer, route, payload) {
    const data = Buffer.from(JSON.stringify({ schema_version: 1, protocol_version: this.wireVersion,
      request_time: Math.floor(this.now() / 1000), replay_nonce: randomBytes(24).toString('base64url'), ...payload }));
    if (data.length > (route === `${this.endpoints.target}prepare` ? 524288 : 16384)) fail('payload_too_large', 413);
    const headers = { 'Content-Type': 'application/json', 'Content-Length': data.length, 'Idempotency-Key': randomUUID() };
    const unavailable = `${peer === 'identity' ? 'identity' : 'target'}_unavailable`;
    try {
      if (peer === 'identity') headers.Authorization = await this.getAuthorization();
      return await new Promise((resolve, reject) => {
        const request = http.request(`${peer === 'identity' ? this.identityOrigin : this.targetOrigin}${route}`,
          { method: 'POST', headers, agent: false }, response => {
            const chunks = []; let length = 0;
            response.on('data', chunk => {
              length += chunk.length;
              if (length > 16384) request.destroy(new HandoffError('receipt_invalid', 502, true));
              else chunks.push(chunk);
            });
            response.on('aborted', () => reject(new HandoffError(unavailable, 503, true)));
            response.on('error', () => reject(new HandoffError(unavailable, 503, true)));
            response.on('end', () => {
              try {
                if (response.headers['content-type']?.split(';')[0] !== 'application/json' ||
                    response.headers['cache-control'] !== 'no-store') fail('receipt_invalid', 502, true);
                const value = decodeJSON(Buffer.concat(chunks));
                if (response.statusCode !== 200) {
                  // T11's default-closed main-app candidate adds schema_version to
                  // its error envelope; retain old native-draft peer compatibility.
                  const nativeTarget = peer === 'target' && this.endpoints === ENDPOINT_PROFILES['native-draft'];
                  fields(value, ['error', 'request_id'], nativeTarget ? ['schema_version'] : []);
                  if ('schema_version' in value && value.schema_version !== 1) fail('receipt_invalid', 502, true);
                  fields(value.error, ['code', 'message', 'retryable']);
                  if (!validRequestID(value.request_id) || !CODES.has(value.error.code) || typeof value.error.message !== 'string' ||
                      typeof value.error.retryable !== 'boolean' || response.statusCode < 400 || response.statusCode > 599) fail('receipt_invalid', 502, true);
                  const error = new HandoffError(value.error.code, response.statusCode, value.error.retryable);
                  error.peer = peer; // Only safe classification; never attach response/request/URL/headers.
                  const retryAfter = Number(response.headers['retry-after']);
                  if (Number.isSafeInteger(retryAfter) && retryAfter > 0) error.retryAfter = Math.min(retryAfter, 86400);
                  throw error;
                }
                resolve(value);
              } catch (error) { reject(error instanceof HandoffError ? error : new HandoffError('receipt_invalid', 502, true)); }
            });
          });
        const timer = setTimeout(() => request.destroy(new HandoffError(unavailable, 503, true)), this.timeoutMs);
        request.on('close', () => clearTimeout(timer));
        request.on('error', error => reject(error instanceof HandoffError ? error : new HandoffError(unavailable, 503, true)));
        request.end(data);
      });
    } catch (error) { throw error instanceof HandoffError ? error : new HandoffError(unavailable, 503, true); }
  }
  // onIssued(grant) runs after the Identity grant is validated and before the target request, so the
  // orchestration can persist the trusted deadline even if the redeem response is later lost.
  async send(owner, record, phase, packet, { onIssued } = {}) {
    if (!PHASES.includes(phase)) fail('invalid_request');
    const write = ['prepare', 'commit'].includes(phase);
    const ticket = await this.post('identity', this.endpoints.issue, { source_local_account_id: String(owner),
      target_client_id: this.targetClientId, phase, binding: record.binding });
    const grantFields = ['schema_version', 'protocol_version', 'request_id', 'ticket', 'operation_id', 'binding_sha256',
      'expires_at', 'replayed', 'reissue_required'];
    fields(ticket, this.formal ? [...grantFields, 'operation_expires_at'] : grantFields); envelope(ticket, this.wireVersion);
    const nowS = Math.floor(this.now() / 1000);
    let bound = nowS + (write ? 120 : 60), deadline = null;
    if (this.formal) {
      // W is Identity's first persisted creation + 86400; it never changes for one operation.
      deadline = ticket.operation_expires_at;
      if (!Number.isSafeInteger(deadline) || deadline <= 0) fail('receipt_invalid', 502, true);
      if (record.operation_expires_at != null && record.operation_expires_at !== deadline) fail('binding_mismatch', 409);
      bound = Math.min(bound, write ? deadline : deadline + RECOVERY_SECONDS);
    }
    if (ticket.operation_id !== record.id || ticket.binding_sha256 !== record.binding_sha256 ||
        ticket.replayed !== false || ticket.reissue_required !== false || typeof ticket.ticket !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(ticket.ticket) || Buffer.from(ticket.ticket, 'base64url').toString('base64url') !== ticket.ticket ||
        !Number.isSafeInteger(ticket.expires_at) || ticket.expires_at <= nowS || ticket.expires_at > bound) fail('receipt_invalid', 502, true);
    if (onIssued) await onIssued({ phase, operation_expires_at: deadline, ticket_expires_at: ticket.expires_at });
    // Ticket exists only on this stack. Every resumed phase gets a fresh ticket on the same operation.
    const result = await this.post('target', `${this.endpoints.target}${phase}`, { operation_id: record.id,
      binding_sha256: record.binding_sha256, ticket: ticket.ticket, ...(phase === 'prepare' ? { package: packet } : {}) });
    const receipt = targetReceipt(result, record.id, this.wireVersion);
    if (['commit', 'cancel'].includes(phase) && ['not_received', 'prepared'].includes(receipt.status)) fail('receipt_invalid', 502, true);
    return receipt;
  }
  async revoke(owner, record) {
    const result = await this.post('identity', this.endpoints.revoke, { source_local_account_id: String(owner),
      operation_id: record.id, binding_sha256: record.binding_sha256 });
    fields(result, ['schema_version', 'protocol_version', 'request_id', 'operation_id', 'revoked', 'replayed']); envelope(result, this.wireVersion);
    if (result.operation_id !== record.id || result.revoked !== true || typeof result.replayed !== 'boolean') fail('receipt_invalid', 502, true);
  }
}
module.exports = { I03DraftClient, targetReceipt, RECOVERY_SECONDS };

'use strict';

const https = require('node:https');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const C = require('./IdentityEnrollmentContract');
const S = require('./IdentityEnrollmentState');

// 使用原生HTTPS直连显式配置的Issuer：不读取代理环境变量、不跟随重定向、不自动重试。
// 总超时覆盖DNS、TCP、TLS与响应读取；任何网络失败都按“结果未确认”保留请求。
function exchange(request) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(request.binding);
    let timer, settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(C.problem('ENROLLMENT_TRANSPORT_UNCERTAIN'));
      else resolve(result);
    };
    const connection = https.request({ hostname: new URL(request.identity_issuer).hostname, port: 443,
      path: '/platform/enroll', method: 'POST', agent: false, rejectUnauthorized: true, minVersion: 'TLSv1.2',
      headers: { Authorization: `Bearer ${request.enrollment_token}`, 'Content-Type': 'application/json',
        Accept: 'application/json', 'Accept-Encoding': 'identity', 'Content-Length': Buffer.byteLength(body),
        'Idempotency-Key': request.idempotency_key, 'X-Enrollment-Nonce': request.nonce,
        'X-Enrollment-Timestamp': request.timestamp } }, response => {
      const chunks = [];
      let length = 0;
      response.on('data', chunk => {
        length += chunk.length;
        if (length > C.MAX_BYTES) {
          finish(true);
          response.destroy();
          connection.destroy();
        } else chunks.push(chunk);
      });
      response.on('error', () => finish(true));
      response.on('aborted', () => finish(true));
      response.on('end', () => {
        const counts = Object.create(null);
        for (let index = 0; index < response.rawHeaders.length; index += 2) {
          const key = response.rawHeaders[index].toLowerCase();
          counts[key] = (counts[key] || 0) + 1;
        }
        if (counts['content-type'] !== 1 || (counts['content-encoding'] || 0) > 0 ||
          !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers['content-type'] || '') ||
          !response.complete) return finish(true);
        finish(null, { status: response.statusCode, body: Buffer.concat(chunks) });
      });
    });
    timer = setTimeout(() => { finish(true); connection.destroy(); }, 15000);
    connection.on('error', () => finish(true));
    connection.end(body);
  });
}
function summary(root, request, state, receipt = null) {
  const result = { state, token_id: request.token_id, identity_issuer: request.identity_issuer,
    public_origin: request.binding.public_origin, identity_client_id: request.binding.identity_client_id,
    deployment_instance_key: request.binding.deployment_instance_key };
  if (receipt) result.enrollment_id = receipt.enrollment_id;
  if (state === 'CREDENTIALS_SAVED_PENDING_VERIFY') result.credentials_file = path.join(root, 'credentials.json');
  return result;
}
function checkStored(record, request) {
  C.exactKeys(record, ['schema_version', 'request_sha256', 'kind', 'response']);
  C.requireValue(record.schema_version === 1 && record.request_sha256 === S.digest(request),
    'ENROLLMENT_STATE_MISMATCH');
}
function existing(root, request) {
  const saved = S.optional(root, 'credentials.json');
  if (saved) {
    checkStored(saved, request);
    C.requireValue(['first', 'recovery'].includes(saved.kind));
    const safe = C.receipt(saved.response, request, saved.kind);
    return summary(root, request, 'CREDENTIALS_SAVED_PENDING_VERIFY', safe);
  }
  const recorded = S.optional(root, 'receipt.json');
  if (recorded) {
    checkStored(recorded, request);
    C.requireValue(['replay', 'receipt'].includes(recorded.kind));
    const safe = C.receipt(recorded.response, request, recorded.kind);
    return summary(root, request, 'SECRET_RECOVERY_REQUIRED', safe);
  }
  return null;
}
function storeResponse(root, request, response, kind) {
  C.receipt(response, request, kind);
  S.write(root, ['first', 'recovery'].includes(kind) ? 'credentials.json' : 'receipt.json',
    { schema_version: 1, request_sha256: S.digest(request), kind, response });
}
function serverFailure(root, attemptID, response) {
  const allowed = new Set(['enrollment_commit_unknown', 'enrollment_audit_unavailable',
    'enrollment_service_unavailable', 'enrollment_busy', 'enrollment_request_invalid',
    'enrollment_request_too_large', 'enrollment_media_type_unsupported', 'enrollment_host_rejected',
    'enrollment_method_not_allowed', 'enrollment_rate_limited', 'enrollment_capacity_full',
    'enrollment_body_invalid', 'enrollment_proof_invalid', 'enrollment_token_rejected',
    'enrollment_request_stale', 'enrollment_conflict', 'enrollment_retry_required']);
  let code = 'unexpected_response';
  try {
    const decoded = C.decodeJSON(response.body);
    if (allowed.has(decoded?.error?.code)) code = decoded.error.code;
  } catch { /* 非合同响应不回显正文；其状态仍是需要人工核实，而非已回滚。 */ }
  const status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599
    ? response.status : 0;
  S.write(root, `failure-${attemptID}.json`, { http_status: status, code });
  throw C.problem(`ENROLLMENT_SERVER_${code.toUpperCase()}`);
}
async function consume(root, { resume = false, transport = exchange, now = Date.now } = {}) {
  return S.locked(root, async () => {
    const request = S.load(root);
    const completed = existing(root, request);
    if (completed) return completed;
    const previous = S.attempts(root);
    C.requireValue(previous.length === 0 || resume, 'ENROLLMENT_EXPLICIT_RESUME_REQUIRED');
    // 明确重试仍须核对原始发送摘要；不允许修改请求文件后借resume生成另一份请求。
    for (const name of previous) {
      const attempt = S.read(root, name);
      C.exactKeys(attempt, ['request_sha256', 'started_at']);
      C.requireValue(attempt.request_sha256 === S.digest(request), 'ENROLLMENT_REQUEST_CHANGED');
    }
    const milliseconds = now();
    C.requireValue(Number.isSafeInteger(milliseconds) && milliseconds > 0, 'ENROLLMENT_CLOCK_INVALID');
    const age = Math.floor(milliseconds / 1000) - Number(request.timestamp);
    C.requireValue(age >= -30 && age <= 300, 'ENROLLMENT_WINDOW_EXPIRED_RECOVERY_REQUIRED');
    if (!previous.length) C.requireValue(Date.parse(request.token_expires_at) > milliseconds, 'ENROLLMENT_TOKEN_EXPIRED');
    const attemptID = randomUUID();
    // 先持久化发送意图；任何随后异常都不能被解释为服务端没有提交。
    S.write(root, `attempt-${attemptID}.json`, { request_sha256: S.digest(request), started_at: new Date(milliseconds).toISOString() });
    let response;
    try { response = await transport(request); } catch {
      throw C.problem('ENROLLMENT_TRANSPORT_UNCERTAIN');
    }
    C.requireValue(response && typeof response === 'object', 'ENROLLMENT_RESPONSE_INVALID');
    if (![200, 201].includes(response.status)) serverFailure(root, attemptID, response);
    const decoded = C.decodeJSON(response.body);
    const kind = response.status === 201 ? 'first' : 'replay';
    storeResponse(root, request, decoded, kind);
    return existing(root, request);
  });
}
async function status(root) {
  return S.locked(root, async () => {
    const request = S.load(root);
    return existing(root, request) || summary(root, request,
      S.attempts(root).length ? 'RESULT_UNCERTAIN' : 'PREPARED_NOT_SENT');
  });
}
async function prepare(root, issuer, rawBinding, issued, now = Date.now()) {
  const request = C.createRequest(issuer, rawBinding, issued, now);
  S.create(root, request);
  return summary(root, request, 'PREPARED_NOT_SENT');
}
async function recordReceipt(root, response) {
  return S.locked(root, async () => {
    const request = S.load(root);
    C.requireValue(S.attempts(root).length > 0, 'ENROLLMENT_NOT_SENT');
    C.requireValue(!existing(root, request), 'ENROLLMENT_RECEIPT_ALREADY_RECORDED');
    // 仅接受Identity管理CLI查询得到的完整回执。CLI文件必须由操作员通过受控流程取得。
    storeResponse(root, request, response, 'receipt');
    return existing(root, request);
  });
}
async function importSecret(root, response) {
  return S.locked(root, async () => {
    const request = S.load(root);
    C.requireValue(!S.optional(root, 'credentials.json'), 'ENROLLMENT_CREDENTIALS_ALREADY_SAVED');
    const recorded = S.read(root, 'receipt.json');
    checkStored(recorded, request);
    C.requireValue(['replay', 'receipt'].includes(recorded.kind));
    const before = C.receipt(recorded.response, request, recorded.kind);
    const after = C.receipt(response, request, 'recovery');
    for (const key of ['enrollment_id', 'instance_id', 'enrolled_at']) {
      C.requireValue(before[key] === after[key], 'ENROLLMENT_RECOVERY_MISMATCH');
    }
    if (before.current_secret_kid) C.requireValue(before.current_secret_kid !== after.current_secret_kid,
      'ENROLLMENT_RECOVERY_KID_UNCHANGED');
    storeResponse(root, request, response, 'recovery');
    return existing(root, request);
  });
}
module.exports = { exchange, prepare, consume, status, recordReceipt, importSecret };

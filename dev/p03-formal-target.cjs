// Synthetic TE-DNA target for the formal candidate wire, redeeming tickets at the REAL Identity provider.
// Config on stdin (identity_url, target_auth); prints {"url","control"} once. Control endpoint drives the
// injected clock and fault injection. Not T11: no resource library, no persistence, loopback only.
const http = require('http');
const { randomUUID, randomBytes } = require('crypto');
const FORMAL = 'teacher-artifact-handoff/1';
const PREFIX = '/api/v1/integrations/teacher-artifacts/';
const DAY = 86400;
let config, nowS = 0;
const ops = new Map(); // operation_id -> { state, W, resource, version, packet }
const events = [];
const script = { drop: null, lose: null, pause: null, paused: null, release: null };
const json = (res, status, body, extra = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify(body));
};
const failure = (res, status, code, retryable = false) => json(res, status, { schema_version: 1, request_id: randomUUID().replace(/-/g, ''),
  error: { code, message: 'target rejected', retryable } }, status === 503 ? { 'Retry-After': '1' } : {});
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let length = 0;
    req.on('data', c => { length += c.length; if (length > limit) { reject(new Error('too_large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
  });
}
// Redeem the source's ticket at the real provider with the target's own credentials (T11 pattern).
function redeem(ticket, phase, bindingSha) {
  const body = Buffer.from(JSON.stringify({ schema_version: 1, protocol_version: FORMAL, request_time: nowS,
    replay_nonce: randomBytes(24).toString('base64url'), ticket, expected_phase: phase, binding_sha256: bindingSha }));
  return new Promise(resolve => {
    const req = http.request(`${config.identity_url}/backchannel/teacher-artifact-handoffs/v1/redeem`, { method: 'POST', agent: false,
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length, 'Idempotency-Key': randomUUID(), Authorization: config.target_auth } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => { let value = null; try { value = JSON.parse(Buffer.concat(chunks)); } catch { value = null; } resolve({ status: res.statusCode, value }); });
      res.on('error', () => resolve({ status: 0, value: null }));
    });
    req.on('error', () => resolve({ status: 0, value: null }));
    req.setTimeout(5000, () => req.destroy());
    req.end(body);
  });
}
async function control(req, res) {
  if (req.method === 'GET') return json(res, 200, { now: nowS, paused: script.paused, events: events.length, ops: [...ops].map(([id, o]) => ({ id, state: o.state, W: o.W })) });
  const body = JSON.parse((await readBody(req, 16384)).toString() || '{}');
  if (Number.isSafeInteger(body.now)) nowS = body.now;
  for (const k of ['drop', 'lose', 'pause']) if (k in body) script[k] = body[k];
  if (body.release && script.release) { const r = script.release; script.release = null; script.paused = null; r(); }
  return json(res, 200, { ok: true, now: nowS });
}
async function handle(req, res) {
  if (req.url === '/__control') return control(req, res);
  if (req.method !== 'POST' || !req.url.startsWith(PREFIX)) return failure(res, 404, 'invalid_request');
  const phase = req.url.slice(PREFIX.length);
  if (!['prepare', 'commit', 'status', 'cancel'].includes(phase)) return failure(res, 404, 'invalid_request');
  let body;
  try { body = JSON.parse((await readBody(req, phase === 'prepare' ? 524288 : 16384)).toString()); } catch { return failure(res, 400, 'invalid_request'); }
  if (body.schema_version !== 1 || body.protocol_version !== FORMAL || typeof body.ticket !== 'string' || typeof body.operation_id !== 'string') return failure(res, 400, 'unsupported_schema');
  if (script.drop === phase) { script.drop = null; events.push({ phase, outcome: 'request_dropped' }); return req.socket.destroy(); }
  if (script.pause === phase) {
    script.pause = null; script.paused = phase;
    await new Promise(resolve => { script.release = resolve; }); // the driver moves the clocks, then releases
  }
  const grant = await redeem(body.ticket, phase, body.binding_sha256);
  if (grant.status !== 200 || !grant.value) {
    const code = grant.value?.error?.code || 'target_unavailable';
    events.push({ phase, outcome: 'redeem_rejected', status: grant.status, code });
    return failure(res, grant.status >= 400 && grant.status < 600 ? grant.status : 503, code, grant.value?.error?.retryable === true);
  }
  const W = grant.value.operation_expires_at;
  if (!Number.isSafeInteger(W) || grant.value.phase !== phase) { events.push({ phase, outcome: 'grant_invalid' }); return failure(res, 502, 'target_unavailable', true); }
  let op = ops.get(body.operation_id);
  if (!op) { op = { state: 'not_received', W }; ops.set(body.operation_id, op); }
  if (op.W !== W) { events.push({ phase, outcome: 'deadline_moved' }); return failure(res, 409, 'binding_mismatch'); }
  // Lock-then-check W (rc1 §3.1): a prepared staging past W expires; no resource is created at or after W.
  if (op.state === 'prepared' && nowS >= op.W) op.state = 'expired';
  if (phase === 'prepare') {
    if (nowS >= op.W) { events.push({ phase, outcome: 'operation_expired' }); return failure(res, 410, 'operation_expired'); }
    if (op.state === 'not_received') { op.state = 'prepared'; op.packet = body.package; }
  } else if (phase === 'commit') {
    if (op.state === 'prepared') { op.state = 'succeeded'; op.resource = randomUUID(); op.version = `sha256:${randomBytes(32).toString('hex')}`; }
    else if (op.state !== 'succeeded') { events.push({ phase, outcome: op.state }); return failure(res, op.state === 'expired' ? 410 : 409, op.state === 'expired' ? 'operation_expired' : 'not_prepared'); }
  } else if (phase === 'cancel') {
    if (!['succeeded', 'deleted'].includes(op.state)) op.state = 'cancelled';
  }
  events.push({ phase, outcome: op.state, W });
  const receipt = { schema_version: 1, protocol_version: FORMAL, request_id: randomUUID().replace(/-/g, ''), operation_id: body.operation_id,
    status: op.state, replayed: grant.value.replayed === true,
    ...(op.state === 'succeeded' ? { resource_ref: op.resource, resource_version: op.version, open_target: { kind: 'import_result', operation_id: body.operation_id },
      ...(phase === 'cancel' ? { cancel_outcome: 'already_succeeded' } : {}) } : {}) };
  if (script.lose === phase) { script.lose = null; events.push({ phase, outcome: 'response_lost' }); return req.socket.destroy(); }
  return json(res, 200, receipt);
}
let raw = '';
process.stdin.on('data', b => { raw += b; }).on('end', () => {
  config = JSON.parse(raw);
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(config.identity_url) || typeof config.target_auth !== 'string') { process.stderr.write('bad_config\n'); process.exit(2); }
  nowS = config.now || 0;
  const server = http.createServer((req, res) => handle(req, res).catch(() => { try { failure(res, 503, 'target_unavailable', true); } catch { /* closed */ } }));
  server.listen(0, '127.0.0.1', () => { process.stdout.write(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}` }) + '\n'); });
});

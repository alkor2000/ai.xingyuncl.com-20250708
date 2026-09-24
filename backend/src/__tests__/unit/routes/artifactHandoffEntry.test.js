// Login-protected save-to-lesson-library entry over the real formal orchestration and the pinned HTTPS transport,
// against laboratory TLS peers. Disabled runtime = handoff_disabled everywhere and capability.available=false.
const express = require('express');
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomUUID, randomBytes } = require('node:crypto');
const { createRouter, mount } = require('../../../routes/artifactHandoffEntry');
const { I03HttpsTransport, TRUST } = require('../../../services/artifactHandoff/i03HttpsTransport');
const { I03FormalClient } = require('../../../services/artifactHandoff/i03Client');
const { I03FormalSource } = require('../../../services/artifactHandoff/i03Source');
const { FORMAL_VERSION, bindingHash } = require('../../../services/artifactHandoff/i03Draft');
const { i03Fixture } = require('../../helpers/p03I03Fixture');
const { ids } = require('../../helpers/p03Fixture');

const T0 = 2000000000, DAY = 86400;
describe('P03 save-to-library entry (login-protected, formal runtime)', () => {
  let directory, ca, key, cert, identity, target, seen, script, clock, server, app, fixtureDir, f;
  const openssl = args => execFileSync('openssl', args, { cwd: directory, stdio: 'ignore' });
  const lookup = (_h, options, done) => options.all ? done(null, [{ address: '127.0.0.1', family: 4 }]) : done(null, '127.0.0.1', 4);
  const envelope = () => ({ schema_version: 1, protocol_version: FORMAL_VERSION, request_id: randomUUID().replace(/-/g, '') });
  const nowS = () => Math.floor(clock / 1000);
  const listen = handler => new Promise(resolve => {
    const s = https.createServer({ key, cert }, (req, res) => {
      const parts = []; req.on('data', c => parts.push(c));
      req.on('end', () => {
        let body = null; try { body = JSON.parse(Buffer.concat(parts)); } catch {}
        seen.push({ host: req.headers.host, path: req.url, body });
        res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
        handler(req, res, body);
      });
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
  const peers = () => {
    const ops = new Map(), resources = new Map(), prepared = new Set();
    const base = {
      identity: (req, res, body) => {
        const op = ops.get(body.binding.operation_id) || { t0: nowS() }; ops.set(body.binding.operation_id, op);
        const write = ['prepare', 'commit'].includes(body.phase), W = op.t0 + DAY;
        res.end(JSON.stringify({ ...envelope(), ticket: randomBytes(32).toString('base64url'), operation_id: body.binding.operation_id,
          binding_sha256: bindingHash(body.binding), expires_at: Math.min(nowS() + (write ? 120 : 60), write ? W : W + 29 * DAY),
          replayed: false, reissue_required: false, operation_expires_at: W }));
      },
      target: (req, res, body) => {
        const phase = req.url.split('/').pop();
        let r = resources.get(body.operation_id);
        if (phase === 'prepare') prepared.add(body.operation_id);
        if (phase === 'commit' && !r && prepared.has(body.operation_id)) { r = { resource_ref: randomUUID(), resource_version: `sha256:${'c'.repeat(64)}` }; resources.set(body.operation_id, r); }
        const status = r ? (script.recycled ? 'recycled' : 'succeeded') : prepared.has(body.operation_id) ? 'prepared' : 'not_received';
        res.end(JSON.stringify({ ...envelope(), operation_id: body.operation_id, status, replayed: false,
          ...(r ? { ...r, open_target: { kind: 'import_result', operation_id: body.operation_id } } : {}),
          ...(status === 'recycled' ? { recycle_until: nowS() + 30 * DAY } : {}) }));
      }
    };
    return { base, ops, identity: (q, s, b) => (script.identity || base.identity)(q, s, b), target: (q, s, b) => (script.target || base.target)(q, s, b) };
  };
  let fake;
  beforeAll(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'p03-entry-tls-'));
    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '1', '-subj', '/CN=P03 entry test CA', '-addext', 'basicConstraints=critical,CA:TRUE']);
    openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=P03 entry lab peer']);
    fs.writeFileSync(path.join(directory, 'good.ext'), 'subjectAltName=DNS:id.pkuailab.com,DNS:workflow.pkuailab.com\nextendedKeyUsage=serverAuth\n');
    openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'good.pem', '-days', '1', '-extfile', 'good.ext']);
    ca = fs.readFileSync(path.join(directory, 'ca.pem')); key = fs.readFileSync(path.join(directory, 'server.key')); cert = fs.readFileSync(path.join(directory, 'good.pem'));
  });
  afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
  const authorization = () => 'Basic ' + Buffer.from(`${TRUST.clientId}:${'synthetic-secret-'.repeat(3)}`).toString('base64');
  const formalStore = store => ({
    transaction: (owner, fn, options) => store.transaction(owner, fn, options), withOwnerLock: async (_o, fn) => fn(),
    exclusive: (() => { const q = new Map(); return (id, fn) => { const w = (q.get(id) || Promise.resolve()).catch(() => {}).then(fn); q.set(id, w); return w; }; })()
  });
  async function start(runtime) {
    app = express();
    app.locals.p03Handoff = runtime;
    app.use('/api/p03/handoffs', createRouter({ authenticate: (req, res, next) => {
      if (req.get('Authorization') !== 'Bearer teacher-101') return res.status(401).json({ success: false });
      req.user = { id: 101, role: 'user' }; next();
    } }));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const root = `http://127.0.0.1:${server.address().port}/api/p03/handoffs`;
    return async (url, options = {}) => {
      const response = await fetch(root + url, { ...options, headers: { Authorization: 'Bearer teacher-101', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
      return { response, data: await response.json() };
    };
  }
  beforeEach(async () => {
    seen = []; script = {}; clock = T0 * 1000; fake = peers();
    identity = await listen(fake.identity); target = await listen(fake.target);
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p03-entry-src-'));
    const transport = new I03HttpsTransport({ ...TRUST, getAuthorization: authorization, timeoutMs: 400,
      laboratory: { ca, lookup, ports: { identity: identity.address().port, target: target.address().port } } }, { NODE_ENV: 'test' });
    const client = new I03FormalClient({ transport, now: () => clock, timeoutMs: 400 });
    f = await i03Fixture(fixtureDir, client, () => clock, '101', { wireVersion: FORMAL_VERSION });
    f.service = new I03FormalSource({ source: f.source, store: formalStore(f.store), authority: f.authority, client, now: () => clock,
      sourceInstance: 'practice-synthetic', targetInstance: 'tedna-synthetic' });
  });
  afterEach(async () => {
    if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); server = null; }
    for (const s of [identity, target]) { s.closeAllConnections(); await new Promise(r => s.close(r)); }
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });
  const enabledRuntime = () => ({ enabled: true, wire: FORMAL_VERSION, service: f.service });
  const selection = async (call, overrides = {}) => {
    const { data: preview } = await call(`/messages/${ids.message}`);
    return { schema_version: 1, message_id: ids.message, expected_version: preview.source.version, selection: { start: 0, end: preview.text.length },
      attachments: [], purpose: 'reference', title: '两杯水观察方案', ...overrides };
  };

  test('disabled runtime: capability says unavailable and every other call is handoff_disabled without any peer or preview access', async () => {
    for (const runtime of [undefined, { enabled: false, switch: 'disabled' }]) {
      const call = await start(runtime);
      expect((await call('/capability')).data).toMatchObject({ available: false, reason: 'disabled' });
      for (const [url, options] of [[`/messages/${ids.message}`, {}], [`/?message_id=${ids.message}`, {}],
        ['/', { method: 'POST', body: '{}', headers: { 'Idempotency-Key': randomUUID() } }], [`/${randomUUID()}/save`, { method: 'POST' }], [`/${randomUUID()}`, {}]]) {
        const r = await call(url, options);
        expect(r.response.status).toBe(503);
        expect(r.data.error).toMatchObject({ code: 'handoff_disabled', retryable: false });
      }
      expect(seen).toHaveLength(0);
      server.closeAllConnections(); await new Promise(r => server.close(r)); server = null;
    }
  });
  test('envelope: login required, no query strings except message_id on the list, strict JSON, fresh request IDs', async () => {
    const call = await start(enabledRuntime());
    const ok = await call('/capability');
    expect(ok.response.headers.get('cache-control')).toBe('no-store');
    expect(ok.data).toMatchObject({ available: true, wire: FORMAL_VERSION, target: { instance: 'pku-tedna-prod', kind: 'personal_library' } });
    expect((await call('/capability', { headers: { Authorization: '' } })).data.error.code).toBe('unauthenticated');
    expect((await call(`/messages/${ids.message}?x=1`)).data.error.code).toBe('invalid_request');
    expect((await call('/?message_id=nope')).data.error.code).toBe('invalid_request');
    for (const body of ['[]', '{"schema_version":1,', 'a'.repeat(17000)]) {
      const r = await call('/', { method: 'POST', body, headers: { 'Idempotency-Key': randomUUID() } });
      expect(r.data.error.code).toBe('invalid_request');
      expect(r.data.request_id).not.toBe(ok.data.request_id);
    }
    expect((await call('/', { method: 'POST', body: JSON.stringify({ schema_version: 2 }), headers: { 'Idempotency-Key': randomUUID() } })).data.error.code).toBe('unsupported_schema');
    expect((await call('/', { method: 'POST', body: JSON.stringify(await selection(call)) })).data.error.code).toBe('invalid_idempotency_key');
    expect(seen).toHaveLength(0); // nothing above reached a peer
  });
  test('select -> freeze (nothing sent) -> explicit save -> succeeded; the same key/selection never makes a second copy; reload lists it', async () => {
    const call = await start(enabledRuntime());
    const body = await selection(call);
    const k = randomUUID();
    const frozen = await call('/', { method: 'POST', body: JSON.stringify(body), headers: { 'Idempotency-Key': k } });
    expect(frozen.data).toMatchObject({ status: 'ready', message_id: ids.message, protocol_version: FORMAL_VERSION });
    expect(seen).toHaveLength(0); // freezing sends nothing to Identity or the target
    const again = await call('/', { method: 'POST', body: JSON.stringify(body), headers: { 'Idempotency-Key': k } });
    expect(again.data.operation_id).toBe(frozen.data.operation_id);
    const differentKeySameSelection = await call('/', { method: 'POST', body: JSON.stringify(body), headers: { 'Idempotency-Key': randomUUID() } });
    expect(differentKeySameSelection.data.operation_id).toBe(frozen.data.operation_id); // one selection, one operation
    expect((await call('/', { method: 'POST', body: JSON.stringify({ ...body, title: '另一个标题' }), headers: { 'Idempotency-Key': k } })).data.error.code).toBe('idempotency_conflict');
    const [first, second] = await Promise.all([call(`/${frozen.data.operation_id}/save`, { method: 'POST' }), call(`/${frozen.data.operation_id}/save`, { method: 'POST' })]);
    for (const r of [first, second]) expect(r.data).toMatchObject({ status: 'succeeded', operation_id: frozen.data.operation_id, open_target: { kind: 'import_result' } });
    expect(first.data.resource_ref).toBe(second.data.resource_ref);
    expect(seen.filter(r => r.path.endsWith('/commit'))).toHaveLength(1);
    expect(seen.filter(r => r.host === 'id.pkuailab.com').length).toBeGreaterThan(0);
    const manifest = JSON.parse(Buffer.from(seen.find(r => r.path.endsWith('/prepare')).body.package.manifest_b64, 'base64'));
    expect(manifest.title).toBe('两杯水观察方案'); expect(manifest.protocol_version).toBe(FORMAL_VERSION);
    const listed = await call(`/?message_id=${ids.message}`);
    expect(listed.data.operations).toHaveLength(1);
    expect(listed.data.operations[0]).toMatchObject({ operation_id: frozen.data.operation_id, status: 'succeeded' });
    expect(listed.data.operations[0].last_synced_at).toBe(clock);
    const statusCalls = () => seen.filter(r => r.path.endsWith('/status')).length;
    const before = statusCalls(); // the second concurrent save recovered through one status query, never a write
    const local = await call(`/${frozen.data.operation_id}`);
    expect(local.data.status).toBe('succeeded');
    expect(statusCalls()).toBe(before); // GET is local; refresh asks
    expect((await call(`/${frozen.data.operation_id}/refresh`, { method: 'POST' })).data.status).toBe('succeeded');
    expect(statusCalls()).toBe(before + 1);
  });
  test('failure is retryable and never duplicates; recycled and R are reported for the status page', async () => {
    const call = await start(enabledRuntime());
    const frozen = await call('/', { method: 'POST', body: JSON.stringify(await selection(call)), headers: { 'Idempotency-Key': randomUUID() } });
    const id = frozen.data.operation_id;
    let commits = 0;
    script.target = (req, res, body) => { if (req.url.endsWith('/commit') && ++commits === 1) return; fake.base.target(req, res, body); }; // first commit stalls
    const failed = await call(`/${id}/save`, { method: 'POST' });
    expect(failed.response.status).toBe(503);
    expect(failed.data.error).toMatchObject({ code: 'target_unavailable', retryable: true });
    expect(failed.response.headers.get('retry-after')).toBeTruthy();
    expect((await call(`/${id}`)).data).toMatchObject({ status: 'unknown', error_code: 'target_unavailable' });
    clock += 2000;
    const retried = await call(`/${id}/save`, { method: 'POST' });
    expect(retried.data.status).toBe('succeeded'); expect(commits).toBe(2);
    const statusCalls = () => seen.filter(r => r.path.endsWith('/status')).length;
    const afterRetry = statusCalls(); // the retry queried status once before its single commit
    script.recycled = true;
    const recycled = await call(`/${id}/refresh`, { method: 'POST' });
    expect(recycled.data).toMatchObject({ status: 'recycled', resource_ref: retried.data.resource_ref });
    expect(recycled.data.recycle_until).toBe(nowS() + 30 * DAY);
    expect(statusCalls()).toBe(afterRetry + 1);
    clock = (T0 + 30 * DAY) * 1000; // R: the source asks nobody and keeps the last known state
    const atR = await call(`/${id}/refresh`, { method: 'POST' });
    expect(atR.data).toMatchObject({ status: 'recycled', recovery_until: T0 + 30 * DAY });
    expect(statusCalls()).toBe(afterRetry + 1);
  });
  test('eligibility is the runtime\'s: a disabled or shadow account is refused before any selection; request bodies carry no identity', async () => {
    const call = await start(enabledRuntime());
    f.policy.active = false;
    const preview = await call(`/messages/${ids.message}`);
    expect(preview.response.status).toBe(403); expect(preview.data.error.code).toBe('subject_disabled');
    f.policy.active = true; f.policy.eligible = false;
    expect((await call(`/messages/${ids.message}`)).data.error.code).toBe('subject_not_eligible');
    const body = { ...(await (async () => { f.policy.eligible = true; const b = await selection(call); f.policy.eligible = false; return b; })()), owner: 'someone-else', teacher: true };
    const r = await call('/', { method: 'POST', body: JSON.stringify(body), headers: { 'Idempotency-Key': randomUUID() } });
    expect(r.data.error.code).toBe('invalid_request'); // unknown fields are refused; identity never comes from the body
    expect(seen).toHaveLength(0);
  });
  test('mount uses the application authenticator on /api/p03/handoffs', () => {
    const uses = [];
    mount({ use: (p, r) => uses.push([p, typeof r]) });
    expect(uses).toEqual([['/api/p03/handoffs', 'function']]);
  });
});

// The real formal orchestration (I03FormalSource) through the real formal client and the pinned production
// HTTPS transport, against laboratory TLS peers that present the production hostnames under an ephemeral CA.
// Only the transport's development/test-only routing (ca, lookup, ports) points the fixed hostnames at the lab
// sockets; SNI, hostname verification, TLS 1.2+, no-redirect and no-plaintext policies are the production ones.
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomUUID, randomBytes } = require('node:crypto');
const { I03HttpsTransport, TRUST } = require('../../../services/artifactHandoff/i03HttpsTransport');
const { I03FormalClient } = require('../../../services/artifactHandoff/i03Client');
const { I03FormalSource } = require('../../../services/artifactHandoff/i03Source');
const { DraftStore } = require('../../../services/artifactHandoff/store');
const { FORMAL_VERSION, bindingHash } = require('../../../services/artifactHandoff/i03Draft');
const { i03Fixture } = require('../../helpers/p03I03Fixture');

const T0 = 2000000000, DAY = 86400;
describe('P03 formal orchestration over the pinned HTTPS transport (laboratory TLS peers)', () => {
  let directory, ca, key, cert, wrongCert, identity, target, seen, script, clock, lab;
  const openssl = args => execFileSync('openssl', args, { cwd: directory, stdio: 'ignore' });
  const lookup = (_host, options, done) => options.all ? done(null, [{ address: '127.0.0.1', family: 4 }]) : done(null, '127.0.0.1', 4);
  const listen = (options, handler) => new Promise(resolve => {
    const server = https.createServer(options, (req, res) => {
      const parts = []; req.on('data', c => parts.push(c));
      req.on('end', () => {
        let body = null; try { body = JSON.parse(Buffer.concat(parts)); } catch {}
        seen.push({ host: req.headers.host, path: req.url, authorization: req.headers.authorization, body });
        res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
        handler(req, res, body);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
  const envelope = () => ({ schema_version: 1, protocol_version: FORMAL_VERSION, request_id: randomUUID().replace(/-/g, '') });
  const nowS = () => Math.floor(clock / 1000);
  // Scripted formal peers: Identity issues tickets with W = first issue + 1 day; the target keeps one resource per operation.
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
        const status = r ? 'succeeded' : prepared.has(body.operation_id) ? 'prepared' : 'not_received';
        res.end(JSON.stringify({ ...envelope(), operation_id: body.operation_id, status, replayed: false,
          ...(status === 'succeeded' ? { ...r, open_target: { kind: 'import_result', operation_id: body.operation_id } } : {}) }));
      }
    };
    return { ops, resources, base, identity: (req, res, body) => (script.identity || base.identity)(req, res, body),
      target: (req, res, body) => (script.target || base.target)(req, res, body) };
  };
  let fake, spools;
  beforeAll(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'p03-formal-tls-'));
    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '1', '-subj', '/CN=P03 ephemeral test CA', '-addext', 'basicConstraints=critical,CA:TRUE']);
    openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=P03 lab peer']);
    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'other-ca.key', '-out', 'other-ca.pem', '-days', '1', '-subj', '/CN=P03 other CA', '-addext', 'basicConstraints=critical,CA:TRUE']);
    for (const [name, names] of [['good', 'DNS:id.pkuailab.com,DNS:workflow.pkuailab.com'], ['wrong', 'DNS:wrong.invalid']]) {
      fs.writeFileSync(path.join(directory, name + '.ext'), 'subjectAltName=' + names + '\nextendedKeyUsage=serverAuth\n');
      openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', name + '.pem', '-days', '1', '-extfile', name + '.ext']);
    }
    ca = fs.readFileSync(path.join(directory, 'ca.pem')); key = fs.readFileSync(path.join(directory, 'server.key'));
    cert = fs.readFileSync(path.join(directory, 'good.pem')); wrongCert = fs.readFileSync(path.join(directory, 'wrong.pem'));
  });
  beforeEach(async () => {
    seen = []; script = {}; clock = T0 * 1000; fake = peers();
    identity = await listen({ key, cert }, fake.identity);
    target = await listen({ key, cert }, fake.target);
    lab = { ca, lookup, ports: { identity: identity.address().port, target: target.address().port } };
    spools = [];
  });
  afterEach(async () => {
    for (const s of [identity, target]) { s.closeAllConnections(); await new Promise(r => s.close(r)); }
    for (const dir of spools) fs.rmSync(dir, { recursive: true, force: true });
  });
  afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
  const authorization = () => 'Basic ' + Buffer.from(`${TRUST.clientId}:${'synthetic-secret-'.repeat(3)}`).toString('base64');
  const transport = (options = {}, env = { NODE_ENV: 'test' }) => new I03HttpsTransport({ ...TRUST, getAuthorization: authorization, timeoutMs: 400, laboratory: lab, ...options }, env);
  // The formal source over the file spool of the fixture with owner anchors and per-operation exclusion.
  const formalStore = store => ({
    transaction: (owner, fn, options) => store.transaction(owner, fn, options),
    withOwnerLock: async (_owner, fn) => fn(),
    exclusive: (() => { const queues = new Map(); return (id, fn) => { const work = (queues.get(id) || Promise.resolve()).catch(() => {}).then(fn); queues.set(id, work); return work; }; })()
  });
  async function source(clientOptions = {}) {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p03-formal-src-')); spools.push(fixtureDir); // one spool per source
    const client = new I03FormalClient({ transport: transport(clientOptions), now: () => clock, timeoutMs: 400 });
    const f = await i03Fixture(fixtureDir, client, () => clock, 'p-teacher', { wireVersion: FORMAL_VERSION });
    const service = new I03FormalSource({ source: f.source, store: formalStore(f.store), authority: f.authority, client, now: () => clock,
      sourceInstance: 'practice-synthetic', targetInstance: 'tedna-synthetic' });
    return { f, service, client };
  }

  test('prepare/commit succeed over TLS to the fixed hostnames; Basic reaches Identity only; W is learned and persisted', async () => {
    const { f, service } = await source();
    const { operation_id: id } = await service.freeze(f.owner, await f.selection(), randomUUID(), '合成教学片段');
    const done = await service.resume(f.owner, id);
    expect(done).toMatchObject({ status: 'succeeded', protocol_version: FORMAL_VERSION, operation_expires_at: T0 + DAY, recovery_until: T0 + 30 * DAY });
    expect(seen.map(r => [r.host, r.path])).toEqual([
      ['id.pkuailab.com', '/backchannel/teacher-artifact-handoffs/v1/issue'], ['workflow.pkuailab.com', '/api/v1/integrations/teacher-artifacts/prepare'],
      ['id.pkuailab.com', '/backchannel/teacher-artifact-handoffs/v1/issue'], ['workflow.pkuailab.com', '/api/v1/integrations/teacher-artifacts/commit']]);
    expect(seen.filter(r => r.host === 'id.pkuailab.com').every(r => r.authorization === authorization())).toBe(true);
    expect(seen.filter(r => r.host === 'workflow.pkuailab.com').every(r => r.authorization === undefined)).toBe(true);
    expect(seen.every(r => r.body.protocol_version === FORMAL_VERSION && r.body.schema_version === 1)).toBe(true);
    const manifest = JSON.parse(Buffer.from(seen[1].body.package.manifest_b64, 'base64'));
    expect(manifest.protocol_version).toBe(FORMAL_VERSION); // fc1 erratum 01: the manifest carries the operation's wire
    expect((await f.store.transaction(f.owner, s => s.operations[id])).operation_expires_at).toBe(T0 + DAY);
    expect(await service.status(f.owner, id)).toMatchObject({ status: 'succeeded', resource_ref: done.resource_ref });
  });
  test('a stalled target closes as target_unavailable with no retry; the operation stays recoverable by status', async () => {
    const { f, service } = await source();
    const { operation_id: id } = await service.freeze(f.owner, await f.selection(), randomUUID(), '合成教学片段');
    let commits = 0;
    script.target = (req, res, body) => { if (req.url.endsWith('/commit') && ++commits === 1) return; fake.base.target(req, res, body); }; // first commit stalls
    await expect(service.resume(f.owner, id)).rejects.toMatchObject({ code: 'target_unavailable', retryable: true });
    expect(commits).toBe(1);
    expect(await service.get(f.owner, id)).toMatchObject({ status: 'unknown', error_code: 'target_unavailable' });
    clock += 2000;
    expect((await service.resume(f.owner, id)).status).toBe('succeeded'); // status-first recovery, then one commit
    expect(commits).toBe(2);
  });
  test('TLS failures are safe errors that consume no operation: wrong SAN, untrusted CA, redirect and plaintext are all refused', async () => {
    const wrong = await listen({ key, cert: wrongCert }, fake.identity);
    try {
      const { f, service } = await source({ laboratory: { ...lab, ports: { ...lab.ports, identity: wrong.address().port } } });
      const { operation_id: id } = await service.freeze(f.owner, await f.selection(), randomUUID(), '合成教学片段');
      await expect(service.resume(f.owner, id)).rejects.toMatchObject({ code: 'identity_unavailable' });
      expect(seen).toHaveLength(0); // the handshake failed before any request bytes
    } finally { wrong.closeAllConnections(); await new Promise(r => wrong.close(r)); }
    {
      // A peer certificate from a CA this instance does not trust: handshake refused, no request bytes.
      const { f, service } = await source({ laboratory: { ...lab, ca: fs.readFileSync(path.join(directory, 'other-ca.pem')) } });
      const { operation_id: id } = await service.freeze(f.owner, await f.selection(), randomUUID(), '合成教学片段');
      await expect(service.resume(f.owner, id)).rejects.toMatchObject({ code: 'identity_unavailable' });
      expect(seen).toHaveLength(0);
    }
    script.identity = (_req, res) => { res.statusCode = 302; res.setHeader('Location', 'https://id.pkuailab.com/elsewhere'); res.end(JSON.stringify({})); };
    const { f, service } = await source();
    const { operation_id: id } = await service.freeze(f.owner, await f.selection(), randomUUID(), '合成教学片段');
    await expect(service.resume(f.owner, id)).rejects.toMatchObject({ code: 'receipt_invalid' });
    expect(seen).toHaveLength(1); // the redirect was never followed
    expect(() => new I03HttpsTransport({ ...TRUST, identityOrigin: 'http://id.pkuailab.com', getAuthorization: authorization, timeoutMs: 400 })).toThrow('invalid_handoff_configuration');
  });
  test('laboratory routing is refused outside development/test and cannot disable verification', () => {
    expect(() => transport({}, { NODE_ENV: 'production' })).toThrow('invalid_handoff_configuration');
    expect(() => transport({ laboratory: { ...lab, rejectUnauthorized: false } })).toThrow('invalid_handoff_configuration');
    expect(() => transport({ laboratory: { ca, lookup, ports: { identity: 0, target: 443 } } })).toThrow('invalid_handoff_configuration');
    expect(() => transport({ laboratory: { ca, ports: lab.ports } })).toThrow('invalid_handoff_configuration');
    expect(() => new I03HttpsTransport({ ...TRUST, getAuthorization: authorization, timeoutMs: 400 }, { NODE_ENV: 'production' })).not.toThrow();
  });
  test('the formal source refuses a draft client, a draft wire or a store without owner anchors', async () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p03-formal-src-')); spools.push(fixtureDir);
    const client = new I03FormalClient({ transport: transport(), now: () => clock, timeoutMs: 400 });
    const f = await i03Fixture(fixtureDir, client, () => clock, 'p-teacher', { wireVersion: FORMAL_VERSION });
    const base = { source: f.source, store: formalStore(f.store), authority: f.authority, client, now: () => clock, sourceInstance: 'a', targetInstance: 'b' };
    expect(() => new I03FormalSource({ ...base, wireVersion: 'i03-draft-0.1' })).toThrow('invalid_handoff_configuration');
    expect(() => new I03FormalSource({ ...base, client: { formal: false, send: async () => {} } })).toThrow('invalid_handoff_configuration');
    expect(() => new I03FormalSource({ ...base, store: new DraftStore(fixtureDir) })).toThrow('invalid_handoff_configuration');
    expect(() => new I03FormalClient({ transport: {} })).toThrow('invalid_handoff_configuration');
  });
});

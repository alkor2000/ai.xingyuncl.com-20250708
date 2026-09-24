const https = require('node:https');
const tls = require('node:tls');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { I03HttpsTransport } = require('../../../services/artifactHandoff/i03HttpsTransport');

describe('P03 preparatory pinned HTTPS transport (local TLS peers only)', () => {
  let directory, ca, key, cert, wrongCert, server, handler, seen, observed, spy, trusted, socketErrors;
  const config = () => ({ identityOrigin: 'https://id.pkuailab.com', sourceOrigin: 'https://ai.pkuailab.com',
    targetOrigin: 'https://workflow.pkuailab.com', sourceInstance: 'pku-ai-platform-prod',
    targetInstance: 'pku-tedna-prod', clientId: 'ai-platform-client', timeoutMs: 500,
    getAuthorization: () => 'Basic ' + Buffer.from('ai-platform-client:' + 'synthetic'.repeat(8)).toString('base64') });
  beforeAll(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'p03-tls-'));
    const openssl = args => execFileSync('openssl', args, { cwd: directory, stdio: 'ignore' });
    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem',
      '-days', '1', '-subj', '/CN=P03 ephemeral test CA', '-addext', 'basicConstraints=critical,CA:TRUE']);
    openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=P03 test']);
    for (const [name, names] of [['good', 'DNS:id.pkuailab.com,DNS:workflow.pkuailab.com'], ['wrong', 'DNS:wrong.invalid']]) {
      fs.writeFileSync(path.join(directory, name + '.ext'), 'subjectAltName=' + names + '\nextendedKeyUsage=serverAuth\n');
      openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial',
        '-out', name + '.pem', '-days', '1', '-extfile', name + '.ext']);
    }
    ca = fs.readFileSync(path.join(directory, 'ca.pem')); key = fs.readFileSync(path.join(directory, 'server.key'));
    cert = fs.readFileSync(path.join(directory, 'good.pem')); wrongCert = fs.readFileSync(path.join(directory, 'wrong.pem'));
  });
  beforeEach(async () => {
    seen = []; observed = []; socketErrors = []; trusted = true;
    handler = (_req, res) => res.end('{}');
    server = https.createServer({ key, cert }, (req, res) => {
      const parts = []; req.on('data', chunk => parts.push(chunk));
      req.on('end', () => {
        seen.push({ path: req.url, headers: req.headers, body: Buffer.concat(parts).toString() });
        res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
        handler(req, res);
      });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const realRequest = https.request.bind(https);
    // Test-only socket routing and test CA. SNI, hostname verification and the
    // production TLS policy are unchanged; no public network request occurs.
    spy = jest.spyOn(https, 'request').mockImplementation((options, callback) => {
      observed.push(options);
      const request = realRequest({ ...options, port: server.address().port,
        lookup: (_host, options, done) => options.all
          ? done(null, [{ address: '127.0.0.1', family: 4 }]) : done(null, '127.0.0.1', 4),
        ...(trusted ? { ca } : {}) }, callback);
      request.on('error', error => socketErrors.push(error.code));
      return request;
    });
  });
  afterEach(async () => {
    spy.mockRestore(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  });
  afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));

  test('fixed paths/SNI; Identity alone receives Basic; responses are opaque, not success receipts', async () => {
    const settings = config(), auth = jest.fn(settings.getAuthorization);
    const client = new I03HttpsTransport({ ...settings, getAuthorization: auth });
    const requestKey = randomUUID();
    await client.post('issue', { schema_version: 1, synthetic: true }, requestKey);
    const result = await client.post('prepare', { package: { synthetic: true } }, randomUUID());
    expect(auth).toHaveBeenCalledTimes(1);
    expect(seen.map(x => x.path)).toEqual(['/backchannel/teacher-artifact-handoffs/v1/issue', '/api/v1/integrations/teacher-artifacts/prepare']);
    expect(seen[0].headers.authorization).toBe(settings.getAuthorization());
    expect(seen[1].headers.authorization).toBeUndefined();
    expect(seen[0].headers['idempotency-key']).toBe(requestKey);
    expect(observed.map(x => x.servername)).toEqual(['id.pkuailab.com', 'workflow.pkuailab.com']);
    for (const options of observed) expect(options).toMatchObject({ agent: false, rejectUnauthorized: true,
      checkServerIdentity: tls.checkServerIdentity, minVersion: 'TLSv1.2' });
    expect(result).toEqual({ statusCode: 200, body: Buffer.from('{}') });
    expect(result).not.toHaveProperty('resource_ref');
  });
  test.each([
    ['identityOrigin', 'http://127.0.0.1:9000'], ['identityOrigin', 'https://id.pkuailab.com/'],
    ['targetOrigin', 'https://workflow.pkuailab.com?destination=evil'], ['targetOrigin', 'https://evil.invalid'],
    ['sourceOrigin', 'https://ai.xingyuncl.com'], ['sourceInstance', 'xingyun-instance'],
    ['sourceInstance', ''], ['targetInstance', 'another-target'], ['clientId', 'another-client'],
    ['rejectUnauthorized', false], ['timeoutMs', 0]
  ])('rejects absent/wrong deployment binding or override %s=%s before network', (field, value) => {
    expect(() => new I03HttpsTransport({ ...config(), [field]: value })).toThrow('invalid_handoff_configuration');
    expect(observed).toHaveLength(0);
  });
  test('constructor snapshots trusted configuration; URL/path cannot be chosen by caller', async () => {
    const settings = config(), client = new I03HttpsTransport(settings);
    settings.targetOrigin = 'https://evil.invalid';
    await client.post('status', {}, randomUUID());
    for (const action of ['https://evil.invalid', '/leak', 'status?ticket=private', '__proto__']) {
      await expect(client.post(action, {}, randomUUID())).rejects.toMatchObject({ code: 'invalid_request' });
    }
    expect(observed).toHaveLength(1); expect(observed[0].hostname).toBe('workflow.pkuailab.com');
  });
  test('body must serialize to one top-level object; invalid keys or bodies never reach a peer', async () => {
    const client = new I03HttpsTransport(config());
    for (const body of [null, [], new Date(), { toJSON: () => 'not-an-object' }]) {
      await expect(client.post('status', body, randomUUID())).rejects.toMatchObject({ code: 'invalid_request' });
    }
    await expect(client.post('status', {}, 'untrusted-key')).rejects.toMatchObject({ code: 'invalid_request' });
    expect(observed).toHaveLength(0);
  });
  test('untrusted certificate is rejected before transmitting HTTP', async () => {
    trusted = false;
    await expect(new I03HttpsTransport(config()).post('issue', {}, randomUUID())).rejects.toMatchObject({ code: 'identity_unavailable' });
    expect(seen).toHaveLength(0);
    expect(socketErrors.some(code => ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN',
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(code))).toBe(true);
  });
  test('trusted CA with wrong hostname is rejected before transmitting HTTP', async () => {
    server.setSecureContext({ key, cert: wrongCert });
    await expect(new I03HttpsTransport(config()).post('prepare', {}, randomUUID())).rejects.toMatchObject({ code: 'target_unavailable' });
    expect(seen).toHaveLength(0);
    expect(socketErrors).toContain('ERR_TLS_CERT_ALTNAME_INVALID');
  });
  test('redirect is not followed and write is not automatically repeated', async () => {
    handler = (_req, res) => { res.statusCode = 307; res.setHeader('Location', 'https://evil.invalid/leak'); res.end('{}'); };
    await expect(new I03HttpsTransport(config()).post('issue', {}, randomUUID())).rejects.toMatchObject({ code: 'receipt_invalid' });
    expect(seen).toHaveLength(1); expect(observed).toHaveLength(1);
  });
  test('total timeout bounds a stalled peer and strips its diagnostics', async () => {
    handler = () => {};
    await expect(new I03HttpsTransport({ ...config(), timeoutMs: 60 }).post('commit', {}, randomUUID()))
      .rejects.toMatchObject({ message: 'target_unavailable', retryable: true });
    expect(observed).toHaveLength(1); expect(seen).toHaveLength(1);
  });
  test('credentials from another client and resolver errors cannot reach a peer or error text', async () => {
    for (const getAuthorization of [() => 'Basic ' + Buffer.from('wrong-client:PRIVATE_SECRET').toString('base64'),
      () => { throw new Error('PRIVATE_SECRET'); }]) {
      await expect(new I03HttpsTransport({ ...config(), getAuthorization }).post('issue', {}, randomUUID()))
        .rejects.toMatchObject({ message: 'invalid_handoff_configuration' });
    }
    expect(observed).toHaveLength(0);
  });
  test('control/prepare sizes differ; response is bounded; cache/compression policy is strict', async () => {
    const client = new I03HttpsTransport(config());
    await expect(client.post('issue', { bytes: 'x'.repeat(16384) }, randomUUID())).rejects.toMatchObject({ code: 'payload_too_large' });
    await client.post('prepare', { bytes: 'x'.repeat(17000) }, randomUUID());
    await expect(client.post('prepare', { bytes: 'x'.repeat(524288) }, randomUUID())).rejects.toMatchObject({ code: 'payload_too_large' });
    handler = (_req, res) => res.end('x'.repeat(16385));
    await expect(client.post('status', {}, randomUUID())).rejects.toMatchObject({ code: 'receipt_invalid' });
    handler = (_req, res) => { res.removeHeader('Cache-Control'); res.end('{}'); };
    await expect(client.post('status', {}, randomUUID())).rejects.toMatchObject({ code: 'receipt_invalid' });
    handler = (_req, res) => { res.setHeader('Content-Encoding', 'gzip'); res.end('{}'); };
    await expect(client.post('status', {}, randomUUID())).rejects.toMatchObject({ code: 'receipt_invalid' });
  });
  test('bounded Retry-After returned only for 429/503; transport does not retry or interpret errors', async () => {
    const client = new I03HttpsTransport(config());
    handler = (_req, res) => { res.statusCode = 429; res.setHeader('Retry-After', '999999'); res.end('{}'); };
    expect((await client.post('status', {}, randomUUID())).retryAfter).toBe(86400);
    handler = (_req, res) => { res.statusCode = 403; res.setHeader('Retry-After', '10'); res.end('{}'); };
    expect(await client.post('status', {}, randomUUID())).not.toHaveProperty('retryAfter');
    expect(seen).toHaveLength(2);
  });
});

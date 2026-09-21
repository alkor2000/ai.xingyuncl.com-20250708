const http = require('http');
const { randomUUID, randomBytes } = require('crypto');
const { I03DraftClient, targetReceipt } = require('../../../services/artifactHandoff/i03Client');
const { VERSION } = require('../../../services/artifactHandoff/i03Draft');
describe('I03 loopback draft HTTP transport', () => {
  let server, origin, client, handler, seen;
  const envelope = () => ({ schema_version: 1, protocol_version: VERSION, request_id: randomUUID() });
  beforeEach(async () => {
    seen = [];
    handler = (req, res) => res.end(JSON.stringify(envelope()));
    server = http.createServer((req, res) => {
      const parts = []; req.on('data', chunk => parts.push(chunk));
      req.on('end', () => {
        seen.push({ path: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(parts)) });
        res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
        handler(req, res);
      });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    client = new I03DraftClient({ identityOrigin: origin, targetOrigin: origin,
      getAuthorization: async () => 'Basic synthetic-memory-only', timeoutMs: 100, env: { NODE_ENV: 'test' } });
  });
  afterEach(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  test('fresh phase tickets/keys/nonces; only prepare includes bytes, only Identity receives Basic', async () => {
    const record = { id: randomUUID(), binding_sha256: 'a'.repeat(64), binding: { test: true } };
    const packet = { manifest_b64: 'synthetic-only', blobs: [] };
    handler = (req, res) => res.end(JSON.stringify(req.url === '/identity/issue' ? {
      ...envelope(), operation_id: record.id, binding_sha256: record.binding_sha256,
      ticket: randomBytes(32).toString('base64url'), expires_at: Math.floor(Date.now() / 1000) + 60,
      replayed: false, reissue_required: false
    } : { ...envelope(), operation_id: record.id, status: 'prepared', replayed: false }));
    await client.send('local-teacher', record, 'prepare', packet);
    await client.send('local-teacher', record, 'status');
    expect(seen.map(r => r.path)).toEqual(['/identity/issue', '/tedna/prepare', '/identity/issue', '/tedna/status']);
    expect(seen[0].body).not.toHaveProperty('package'); expect(seen[1].body.package).toEqual(packet);
    expect(seen[3].body).not.toHaveProperty('package');
    expect(seen[1].headers.authorization).toBeUndefined(); expect(seen[3].headers.authorization).toBeUndefined();
    expect(seen[0].headers.authorization).toBe('Basic synthetic-memory-only');
    expect(new Set(seen.map(r => r.headers['idempotency-key'])).size).toBe(4);
    expect(new Set(seen.map(r => r.body.replay_nonce)).size).toBe(4);
  });
  test.each(['{"status":"prepared","status":"succeeded"}', '{"number":1e999}', '{"s":"\\ud800"}', '{}{}', '[', 'x'])('rejects malformed/ambiguous JSON %s', async raw => {
    handler = (req, res) => res.end(raw);
    await expect(client.post('target', '/tedna/status', {})).rejects.toMatchObject({ code: 'receipt_invalid' });
  });
  test('never follows redirect or repeats a failed write', async () => {
    handler = (req, res) => { res.statusCode = 302; res.setHeader('Location', origin + '/leak'); res.end('{}'); };
    await expect(client.post('identity', '/identity/issue', {})).rejects.toMatchObject({ code: 'receipt_invalid' });
    expect(seen).toHaveLength(1);
  });
  test('timeout closes stalled response with safe error and no automatic retry', async () => {
    handler = () => {};
    await expect(client.post('target', '/tedna/commit', {})).rejects.toMatchObject({ code: 'target_unavailable', retryable: true });
    expect(seen).toHaveLength(1);
  });
  test('oversized response is rejected; cache headers are required', async () => {
    handler = (req, res) => res.end(' '.repeat(16385));
    await expect(client.post('target', '/tedna/status', {})).rejects.toBeDefined();
    handler = (req, res) => { res.removeHeader('Cache-Control'); res.end('{}'); };
    await expect(client.post('target', '/tedna/status', {})).rejects.toMatchObject({ code: 'receipt_invalid' });
  });
  test('remote diagnostics and credential callback errors cannot escape', async () => {
    handler = (req, res) => {
      res.statusCode = 503; res.setHeader('Retry-After', '8');
      res.end(JSON.stringify({ request_id: randomUUID(), error: { code: 'storage_unavailable', message: 'PRIVATE_REMOTE_BODY', retryable: true } }));
    };
    let error; try { await client.post('target', '/tedna/commit', {}); } catch (e) { error = e; }
    expect(error).toMatchObject({ code: 'storage_unavailable', retryAfter: 8 });
    expect(String(error)).not.toContain('PRIVATE_REMOTE_BODY'); expect(JSON.stringify(error)).not.toContain('PRIVATE_REMOTE_BODY');
    client.getAuthorization = async () => { throw new Error('PRIVATE_SECRET'); };
    await expect(client.post('identity', '/identity/issue', {})).rejects.toMatchObject({ message: 'identity_unavailable' });
  });
  test('production/public origins and forged receipt navigation rejected', () => {
    expect(() => new I03DraftClient({ env: { NODE_ENV: 'production' } })).toThrow('disabled');
    for (const identityOrigin of ['https://id.pkuailab.com', 'http://localhost:1234', origin + '/path', origin + '?x=1']) {
      expect(() => new I03DraftClient({ identityOrigin, targetOrigin: origin, getAuthorization: () => '', env: { NODE_ENV: 'test' } })).toThrow('invalid_draft_configuration');
    }
    const id = randomUUID(), receipt = { ...envelope(), operation_id: id, replayed: false, status: 'succeeded',
      resource_ref: randomUUID(), resource_version: 'sha256:' + 'a'.repeat(64), open_target: { kind: 'import_result', operation_id: id } };
    expect(targetReceipt(receipt, id)).toEqual(receipt);
    expect(() => targetReceipt({ ...receipt, open_target: { ...receipt.open_target, url: 'https://evil.invalid' } }, id)).toThrow('receipt_invalid');
    expect(() => targetReceipt(receipt, randomUUID())).toThrow('receipt_invalid');
  });
  test.each(['added-deadline', 'formal-version'])('draft cannot silently consume candidate change: %s', async change => {
    const record = { id: randomUUID(), binding_sha256: 'a'.repeat(64), binding: { test: true } };
    handler = (_req, res) => res.end(JSON.stringify({
      ...envelope(), operation_id: record.id, binding_sha256: record.binding_sha256,
      ticket: randomBytes(32).toString('base64url'), expires_at: Math.floor(Date.now() / 1000) + 60,
      replayed: false, reissue_required: false,
      ...(change === 'added-deadline' ? { operation_expires_at: Math.floor(Date.now() / 1000) + 86400 }
        : { protocol_version: 'teacher-artifact-handoff/1' })
    }));
    await expect(client.send('local-teacher', record, 'status')).rejects.toMatchObject({ code: 'receipt_invalid' });
    expect(seen).toHaveLength(1); // No target request after an incompatible grant.
  });
  test.each([undefined, 1])('native target preserves safe errors with envelope schema %s', async schema => {
    client = new I03DraftClient({ identityOrigin: origin, targetOrigin: origin,
      getAuthorization: () => 'Basic synthetic-memory-only', endpointProfile: 'native-draft', env: { NODE_ENV: 'test' } });
    handler = (_req, res) => {
      res.statusCode = 429; res.setHeader('Retry-After', '2');
      res.end(JSON.stringify({ ...(schema === undefined ? {} : { schema_version: schema }),
        request_id: randomUUID(), error: { code: 'rate_limited', message: 'PRIVATE_REMOTE_BODY', retryable: true } }));
    };
    const error = await client.post('target', '/api/v1/integrations/teacher-artifacts/status', {}).catch(e => e);
    expect(error).toMatchObject({ code: 'rate_limited', status: 429, peer: 'target', retryable: true, retryAfter: 2 });
    expect(JSON.stringify(error)).not.toContain('PRIVATE_REMOTE_BODY');
    expect(seen).toHaveLength(1); expect(seen[0].headers.authorization).toBeUndefined();
  });
  test.each([
    { schema_version: 2 }, { schema_version: '1' }, { schema_version: null },
    { schema_version: 1, operation_expires_at: 2000000000 },
    { schema_version: 1, protocol_version: 'teacher-artifact-handoff/1' }
  ])('native error rejects incompatible or extra fields %j', async extra => {
    client = new I03DraftClient({ identityOrigin: origin, targetOrigin: origin,
      getAuthorization: () => '', endpointProfile: 'native-draft', env: { NODE_ENV: 'test' } });
    handler = (_req, res) => {
      res.statusCode = 503;
      res.end(JSON.stringify({ ...extra, request_id: randomUUID(),
        error: { code: 'storage_unavailable', message: 'hidden', retryable: true } }));
    };
    await expect(client.post('target', '/api/v1/integrations/teacher-artifacts/status', {}))
      .rejects.toMatchObject({ code: 'receipt_invalid' });
  });
  test.each(['lab-target', 'native-identity'])('target envelope addition does not broaden %s', async peerCase => {
    if (peerCase === 'native-identity') client = new I03DraftClient({ identityOrigin: origin, targetOrigin: origin,
      getAuthorization: () => '', endpointProfile: 'native-draft', env: { NODE_ENV: 'test' } });
    handler = (_req, res) => {
      res.statusCode = 503;
      res.end(JSON.stringify({ schema_version: 1, request_id: randomUUID(),
        error: { code: 'storage_unavailable', message: 'hidden', retryable: true } }));
    };
    await expect(client.post(peerCase === 'lab-target' ? 'target' : 'identity',
      peerCase === 'lab-target' ? '/tedna/status' : '/backchannel/teacher-artifact-handoffs/v1/issue', {}))
      .rejects.toMatchObject({ code: 'receipt_invalid' });
  });
});

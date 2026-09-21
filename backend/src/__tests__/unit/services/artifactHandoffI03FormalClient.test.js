// Formal candidate wire (teacher-artifact-handoff/1) over loopback HTTP with scripted Identity/T11 JSON.
// Grants must carry the trusted operation deadline; tickets are cut at W (write) / R (status, cancel).
const http = require('http');
const { randomUUID, randomBytes } = require('crypto');
const { I03DraftClient, targetReceipt, RECOVERY_SECONDS } = require('../../../services/artifactHandoff/i03Client');
const { VERSION, FORMAL_VERSION } = require('../../../services/artifactHandoff/i03Draft');
describe('I03 formal candidate client (loopback, synthetic peers)', () => {
  let server, origin, client, handler, seen, clock;
  const nowS = () => Math.floor(clock / 1000);
  const envelope = (wire = FORMAL_VERSION) => ({ schema_version: 1, protocol_version: wire, request_id: randomUUID() });
  const record = () => ({ id: randomUUID(), binding_sha256: 'a'.repeat(64), binding: { test: true } });
  const grant = (rec, extra) => ({ ...envelope(), operation_id: rec.id, binding_sha256: rec.binding_sha256,
    ticket: randomBytes(32).toString('base64url'), replayed: false, reissue_required: false, ...extra });
  const receipt = (rec, status = 'prepared') => ({ ...envelope(), operation_id: rec.id, status, replayed: false,
    ...(status === 'succeeded' ? { resource_ref: randomUUID(), resource_version: `sha256:${'b'.repeat(64)}`, open_target: { kind: 'import_result', operation_id: rec.id } } : {}) });
  const make = (options = {}) => new I03DraftClient({ identityOrigin: origin, targetOrigin: origin, endpointProfile: 'native-draft',
    wireVersion: FORMAL_VERSION, getAuthorization: async () => 'Basic synthetic-memory-only', timeoutMs: 100, now: () => clock,
    env: { NODE_ENV: 'test' }, ...options });
  beforeEach(async () => {
    seen = []; clock = Date.parse('2026-09-21T06:00:00Z');
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
    client = make();
  });
  afterEach(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const script = (rec, grantExtra, status = 'prepared') => {
    handler = (req, res) => res.end(JSON.stringify(req.url.endsWith('/issue') ? grant(rec, grantExtra) : receipt(rec, status)));
  };
  test('formal wire needs native paths; requests carry the formal version; draft responses are rejected', async () => {
    expect(() => make({ endpointProfile: 'lab' })).toThrow('invalid_draft_configuration');
    expect(() => make({ wireVersion: 'teacher-artifact-handoff/1-rc2' })).toThrow('invalid_draft_configuration');
    const rec = record(), W = nowS() + 3600;
    script(rec, { expires_at: nowS() + 60, operation_expires_at: W });
    await client.send('local-teacher', rec, 'status');
    expect(seen.map(r => r.path)).toEqual(['/backchannel/teacher-artifact-handoffs/v1/issue', '/api/v1/integrations/teacher-artifacts/status']);
    expect(seen.every(r => r.body.protocol_version === FORMAL_VERSION && r.body.schema_version === 1)).toBe(true);
    seen = [];
    handler = (_req, res) => res.end(JSON.stringify({ ...grant(rec, { expires_at: nowS() + 60, operation_expires_at: W }), protocol_version: VERSION }));
    await expect(client.send('local-teacher', rec, 'status')).rejects.toMatchObject({ code: 'receipt_invalid' });
    expect(seen).toHaveLength(1);
    expect(() => targetReceipt({ ...receipt(rec), protocol_version: VERSION }, rec.id, FORMAL_VERSION)).toThrow('receipt_invalid');
    expect(() => targetReceipt(receipt(rec), rec.id, 'teacher-artifact-handoff/2')).toThrow('invalid_draft_configuration');
  });
  test.each([undefined, '2000086400', 2000086400.5, 0, -1, null])('grant without an integer operation deadline is rejected before any target call: %p', async deadline => {
    const rec = record();
    script(rec, { expires_at: nowS() + 60, ...(deadline === undefined ? {} : { operation_expires_at: deadline }) });
    await expect(client.send('local-teacher', rec, 'status')).rejects.toMatchObject({ code: 'receipt_invalid' });
    expect(seen).toHaveLength(1);
  });
  test('write tickets are bounded by min(now+120, W); a ticket beyond W never reaches the target', async () => {
    const rec = record();
    const W = nowS() + 90; // W closer than the 120 s ticket TTL
    script(rec, { expires_at: W, operation_expires_at: W }, 'succeeded');
    await client.send('local-teacher', rec, 'commit');
    expect(seen).toHaveLength(2);
    seen = []; script(rec, { expires_at: W + 1, operation_expires_at: W }, 'succeeded');
    await expect(client.send('local-teacher', rec, 'commit')).rejects.toMatchObject({ code: 'receipt_invalid' });
    expect(seen).toHaveLength(1);
    seen = []; const far = nowS() + 3600;
    script(rec, { expires_at: nowS() + 120, operation_expires_at: far });
    await client.send('local-teacher', rec, 'prepare', { manifest_b64: 'x', blobs: [] });
    seen = []; script(rec, { expires_at: nowS() + 121, operation_expires_at: far });
    await expect(client.send('local-teacher', rec, 'prepare', { manifest_b64: 'x', blobs: [] })).rejects.toMatchObject({ code: 'receipt_invalid' });
    expect(seen).toHaveLength(1);
  });
  test('status/cancel tickets are bounded by min(now+60, R)', async () => {
    const rec = record();
    const W = nowS() - RECOVERY_SECONDS + 30, R = W + RECOVERY_SECONDS; // R = now + 30 s
    script(rec, { expires_at: R, operation_expires_at: W }, 'succeeded');
    await client.send('local-teacher', rec, 'status');
    expect(seen).toHaveLength(2);
    seen = []; script(rec, { expires_at: R + 1, operation_expires_at: W });
    await expect(client.send('local-teacher', rec, 'cancel')).rejects.toMatchObject({ code: 'receipt_invalid' });
    expect(seen).toHaveLength(1);
    seen = []; const far = nowS() + 3600;
    script(rec, { expires_at: nowS() + 61, operation_expires_at: far });
    await expect(client.send('local-teacher', rec, 'status')).rejects.toMatchObject({ code: 'receipt_invalid' });
    expect(seen).toHaveLength(1);
  });
  test('onIssued receives the trusted deadline before the target request; its rejection stops the redeem', async () => {
    const rec = record(), W = nowS() + 3600, issued = [];
    script(rec, { expires_at: nowS() + 60, operation_expires_at: W });
    await client.send('local-teacher', rec, 'status', undefined, { onIssued: async g => { issued.push({ ...g, targetCalls: seen.length }); } });
    expect(issued).toEqual([{ phase: 'status', operation_expires_at: W, ticket_expires_at: nowS() + 60, targetCalls: 1 }]);
    seen = [];
    await expect(client.send('local-teacher', rec, 'status', undefined, { onIssued: async () => { throw new Error('PRIVATE_LOCAL_REASON'); } })).rejects.toThrow('PRIVATE_LOCAL_REASON');
    expect(seen).toHaveLength(1);
    // A grant that contradicts the record's persisted deadline is a binding mismatch, not a new deadline.
    seen = [];
    await expect(client.send('local-teacher', { ...rec, operation_expires_at: W - 1 }, 'status')).rejects.toMatchObject({ code: 'binding_mismatch' });
    expect(seen).toHaveLength(1);
  });
  test('formal target receipts keep the strict shape; native error envelopes keep safe classification', async () => {
    const rec = record(), W = nowS() + 3600;
    handler = (req, res) => {
      if (req.url.endsWith('/issue')) return res.end(JSON.stringify(grant(rec, { expires_at: nowS() + 60, operation_expires_at: W })));
      res.statusCode = 410;
      res.end(JSON.stringify({ schema_version: 1, request_id: randomUUID(), error: { code: 'operation_expired', message: 'PRIVATE_REMOTE_BODY', retryable: false } }));
    };
    const error = await client.send('local-teacher', rec, 'commit').catch(e => e);
    expect(error).toMatchObject({ code: 'operation_expired', status: 410, peer: 'target', retryable: false });
    expect(JSON.stringify(error)).not.toContain('PRIVATE_REMOTE_BODY');
    handler = (req, res) => res.end(JSON.stringify(req.url.endsWith('/issue') ? grant(rec, { expires_at: nowS() + 60, operation_expires_at: W })
      : { ...receipt(rec, 'succeeded'), operation_expires_at: W }));
    await expect(client.send('local-teacher', rec, 'status')).rejects.toMatchObject({ code: 'receipt_invalid' });
  });
  test('the draft client still rejects every formal grant and the formal client every draft grant', async () => {
    const rec = record(), W = nowS() + 3600;
    const draft = new I03DraftClient({ identityOrigin: origin, targetOrigin: origin, endpointProfile: 'native-draft',
      getAuthorization: async () => 'Basic synthetic-memory-only', timeoutMs: 100, now: () => clock, env: { NODE_ENV: 'test' } });
    script(rec, { expires_at: nowS() + 60, operation_expires_at: W });
    await expect(draft.send('local-teacher', rec, 'status')).rejects.toMatchObject({ code: 'receipt_invalid' });
    handler = (_req, res) => res.end(JSON.stringify({ ...grant(rec, { expires_at: nowS() + 60 }), protocol_version: VERSION }));
    await expect(client.send('local-teacher', rec, 'status')).rejects.toMatchObject({ code: 'receipt_invalid' });
    expect(seen).toHaveLength(2);
  });
});

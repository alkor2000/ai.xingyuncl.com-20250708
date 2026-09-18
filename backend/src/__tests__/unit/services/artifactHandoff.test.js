const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const express = require('express');
const { fixture, ids } = require('../../helpers/p03Fixture');
const { ArtifactHandoffService } = require('../../../services/artifactHandoff/service');
const { DraftStore, TTL_MS } = require('../../../services/artifactHandoff/store');
const { createRouter, enabled, mount } = require('../../../routes/artifactHandoffDev');

let f, directory, clock, server;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'p03-test-'));
  clock = Date.parse('2026-09-18T01:00:00Z');
  f = await fixture(directory, () => clock);
});
afterEach(async () => {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); server = null; }
  await fs.rm(directory, { recursive: true, force: true });
});
async function body(overrides = {}) {
  const preview = await f.service.inspect(101, ids.message);
  return { schema_version: 1, message_id: ids.message, expected_version: preview.source.version,
    selection: { start: 0, end: preview.text.length }, attachments: [], purpose: 'reference', ...overrides };
}
const freeze = async overrides => f.service.freeze(101, await body(overrides), randomUUID());
const grant = (id, simulation = 'valid', owner = 101) => f.service.authorize(owner, id, { schema_version: 1, simulation }, randomUUID());
const deliver = async (id, simulation = 'success', auth) => f.service.deliver(101, id,
  { schema_version: 1, grant_id: (auth || await grant(id)).grant_id, simulation }, randomUUID());

test('exports exactly one selected passage, no prompts, thinking, account data, or automatic attachment', async () => {
  const selected = '先观察，再记录两杯水的变化。';
  const preview = await f.service.inspect(101, ids.message);
  const start = preview.text.indexOf(selected);
  const snapshot = await freeze({ selection: { start, end: start + selected.length } });
  expect(snapshot.payload).toEqual({ text: selected, attachments: [] });
  expect(snapshot.manifest.source.version).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(snapshot.manifest.summary).toEqual({ kind: 'verbatim_excerpt', text: selected });
  await deliver(snapshot.id);
  const received = await f.store.transaction(state => state.received[snapshot.id].packet);
  expect(received).toEqual({ manifest: snapshot.manifest, payload: snapshot.payload });
  const packet = JSON.stringify(received);
  for (const excluded of ['UNSELECTED_PRIVATE_PROMPT', 'PRIVATE_THINKING', 'file_path', 'owner', 'global_person_id', 'example.org']) expect(packet).not.toContain(excluded);
});

test('whole answer preserves original text and treats ordinary links and executable HTML as text', async () => {
  f.messages[ids.message].content = '<script>throw new Error("never run")</script>\nhttps://example.org/ordinary';
  const snapshot = await freeze();
  expect(snapshot.payload.text).toBe(f.messages[ids.message].content);
  expect(snapshot.manifest.web_links).toBe('references_only_not_fetched');
  expect(snapshot.manifest.visibility).toBe('private');
});

test('source edits invalidate a preview but never rewrite an existing snapshot', async () => {
  const before = await body();
  const key = randomUUID();
  const snapshot = await f.service.freeze(101, before, key);
  f.messages[ids.message].content = '新版原文';
  await expect(f.service.freeze(101, before, randomUUID())).rejects.toMatchObject({ code: 'source_changed' });
  expect((await f.service.get(101, snapshot.id)).payload).toEqual(snapshot.payload);
  expect((await f.service.freeze(101, before, key)).id).toBe(snapshot.id);
  expect((await freeze()).id).not.toBe(snapshot.id);
});

test('concurrent double clicks and new HTTP keys converge on one snapshot and receiver record', async () => {
  const input = await body();
  const snapshots = await Promise.all(Array.from({ length: 6 }, () => f.service.freeze(101, input, randomUUID())));
  expect(new Set(snapshots.map(item => item.id)).size).toBe(1);
  const id = snapshots[0].id;
  const auth = await grant(id);
  const results = await Promise.all(Array.from({ length: 6 }, () => deliver(id, 'success', auth)));
  expect(new Set(results.map(item => item.receipt_id)).size).toBe(1);
  expect(await f.store.transaction(state => Object.keys(state.received).length)).toBe(1);
});

test('same idempotency key rejects different content and survives service restart', async () => {
  const input = await body();
  const key = randomUUID();
  const first = await f.service.freeze(101, input, key);
  f.service = new ArtifactHandoffService({ source: f.source, store: new DraftStore(path.join(directory, 'private'), () => clock), now: () => clock });
  expect((await f.service.freeze(101, input, key)).id).toBe(first.id);
  await expect(f.service.freeze(101, { ...input, purpose: 'courseware' }, key)).rejects.toMatchObject({ code: 'idempotency_conflict' });
});

test.each(['expired', 'revoked'])('rejects %s authorization, then recovers without a new snapshot', async simulation => {
  const snapshot = await freeze();
  await expect(deliver(snapshot.id, 'success', await grant(snapshot.id, simulation))).rejects.toMatchObject({ code: 'authorization_expired' });
  expect(await f.store.transaction(state => Object.keys(state.received).length)).toBe(0);
  expect((await deliver(snapshot.id)).state).toBe('mock_received');
});

test('receiver failure persists and can recover', async () => {
  const snapshot = await freeze();
  await expect(deliver(snapshot.id, 'reject')).rejects.toMatchObject({ code: 'receiver_unavailable', retryable: true });
  expect((await f.service.status(101, snapshot.id)).state).toBe('retryable_failure');
  expect((await deliver(snapshot.id)).state).toBe('mock_received');
});

test('accepted-but-response-lost survives restart and expired grant without duplicate import', async () => {
  const snapshot = await freeze();
  const auth = await grant(snapshot.id);
  await expect(deliver(snapshot.id, 'lose_response', auth)).rejects.toMatchObject({ code: 'response_lost' });
  expect((await f.service.status(101, snapshot.id)).state).toBe('outcome_unknown');
  clock += 10 * 60 * 1000;
  f.service = new ArtifactHandoffService({ source: f.source, store: new DraftStore(path.join(directory, 'private'), () => clock), now: () => clock });
  expect((await deliver(snapshot.id, 'success', auth)).replayed).toBe(true);
  expect((await f.service.status(101, snapshot.id)).state).toBe('mock_received');
  expect(await f.store.transaction(state => Object.keys(state.received).length)).toBe(1);
});

test('source/receiver access never bypasses ownership, even after acceptance', async () => {
  const snapshot = await freeze();
  await deliver(snapshot.id);
  await expect(f.service.get(202, snapshot.id)).rejects.toMatchObject({ code: 'snapshot_unavailable' });
  await expect(f.service.inspect(202, ids.message)).rejects.toMatchObject({ code: 'source_unavailable' });
  await expect(grant(snapshot.id, 'valid', 202)).rejects.toMatchObject({ code: 'snapshot_unavailable' });
  f.conversations[ids.conversation].user_id = 202;
  await expect(f.service.get(101, snapshot.id)).rejects.toMatchObject({ code: 'source_unavailable' });
  await expect(deliver(snapshot.id)).rejects.toMatchObject({ code: 'source_unavailable' });
});

test('grant binds to the snapshot and target, not a user-supplied identity', async () => {
  const a = await freeze();
  const b = await freeze({ selection: { start: 0, end: 4 } });
  await expect(deliver(b.id, 'success', await grant(a.id))).rejects.toMatchObject({ code: 'authorization_expired' });
  const auth = await grant(b.id);
  await f.store.transaction(state => { Object.values(state.grants).find(item => item.id === auth.grant_id).target = 'wrong-platform'; });
  await expect(deliver(b.id, 'success', auth)).rejects.toMatchObject({ code: 'authorization_expired' });
});

test('changing the intended use alone does not duplicate a resource', async () => {
  const a = await freeze();
  const b = await freeze({ purpose: 'courseware' });
  expect(b.id).toBe(a.id);
  expect(b.manifest.purpose).toBe('reference');
  expect(b.replayed).toBe(true);
});

test('a delivery request key cannot be reused for another snapshot', async () => {
  const a = await freeze();
  const b = await freeze({ selection: { start: 0, end: 4 } });
  const key = randomUUID();
  const request = async id => ({ schema_version: 1, simulation: 'success', grant_id: (await grant(id)).grant_id });
  await f.service.deliver(101, a.id, await request(a.id), key);
  await expect(f.service.deliver(101, b.id, await request(b.id), key)).rejects.toMatchObject({ code: 'idempotency_conflict' });
});

test.each(['pending', 'streaming', 'failed'])('refuses %s messages', async status => {
  f.messages[ids.message].status = status;
  await expect(f.service.inspect(101, ids.message)).rejects.toMatchObject({ code: 'source_not_ready' });
});
test('refuses user messages, cleared/deleted sources and malformed thinking boundaries', async () => {
  await expect(f.service.inspect(101, ids.other)).rejects.toMatchObject({ code: 'source_not_ready' });
  f.conversations[ids.conversation].cleared_at = '2026-09-18T00:01:00Z';
  await expect(f.service.inspect(101, ids.message)).rejects.toMatchObject({ code: 'source_unavailable' });
  delete f.conversations[ids.conversation].cleared_at;
  f.messages[ids.message].content = '<thinking>unfinished';
  await expect(f.service.inspect(101, ids.message)).rejects.toMatchObject({ code: 'source_not_ready' });
  delete f.messages[ids.message];
  await expect(f.service.inspect(101, ids.message)).rejects.toMatchObject({ code: 'source_unavailable' });
});

test('attachment inventory distinguishes supported, unavailable, and unsupported content', async () => {
  const p = await f.service.inspect(101, ids.message);
  expect(p.attachments.map(item => item.status)).toEqual(['ready', 'attachment_unavailable', 'attachment_unsupported']);
  const chosen = { source_id: ids.file, expected_version: p.attachments[0].version };
  const snapshot = await freeze({ attachments: [chosen] });
  expect(snapshot.payload.attachments[0].text).toContain('合成材料');
  expect(snapshot.manifest.attachments[0]).not.toHaveProperty('text');
  await fs.writeFile(f.files[ids.file].file_path, 'changed after preview');
  await expect(freeze({ attachments: [chosen] })).rejects.toMatchObject({ code: 'source_changed' });
  expect((await f.service.get(101, snapshot.id)).payload.attachments[0].text).toContain('合成材料');
  await fs.unlink(f.files[ids.file].file_path);
  await expect(f.service.get(101, snapshot.id)).rejects.toMatchObject({ code: 'attachment_unavailable' });
});

test('attachment revocation, unrelated files, path escape and remote URLs are denied', async () => {
  f.files[ids.file].user_id = 202;
  const preview = await f.service.inspect(101, ids.message);
  expect(preview.attachments[0]).toEqual({ source_id: ids.file, status: 'attachment_unavailable' });
  f.files[ids.file].user_id = 101;
  for (const unsafePath of ['/etc/passwd', 'https://example.org/file.md']) {
    f.files[ids.file].file_path = unsafePath;
    await expect(f.source.attachment(101, ids.file)).rejects.toMatchObject({ code: 'attachment_unavailable' });
  }
  f.files[ids.file].file_path = path.join(f.uploadRoot, 'escape.md');
  await fs.symlink('/etc/passwd', f.files[ids.file].file_path);
  await expect(f.source.attachment(101, ids.file)).rejects.toMatchObject({ code: 'attachment_unavailable' });
  await expect(freeze({ attachments: [{ source_id: randomUUID(), expected_version: 'any' }] })).rejects.toMatchObject({ code: 'attachment_unavailable' });
});

test('non-UTF8 or oversized text attachment is refused, never substituted with extracted_content', async () => {
  await fs.writeFile(f.files[ids.file].file_path, Buffer.from([0xff, 0xfe, 0x00]));
  f.files[ids.file].extracted_content = 'FAKE_EXTRACTED_TEXT';
  await expect(f.source.attachment(101, ids.file)).rejects.toMatchObject({ code: 'attachment_unavailable' });
  await fs.writeFile(f.files[ids.file].file_path, Buffer.alloc(65 * 1024, 65));
  await expect(f.source.attachment(101, ids.file)).rejects.toMatchObject({ code: 'attachment_unsupported' });
});

test('rejects unknown fields, empty/invalid ranges and split emoji', async () => {
  const input = await body();
  await expect(f.service.freeze(101, { ...input, user_id: 202 }, randomUUID())).rejects.toMatchObject({ code: 'invalid_request' });
  for (const selection of [{ start: -1, end: 1 }, { start: 2, end: 2 }, { start: 0, end: 99999 }, { start: 1.2, end: 3 }]) {
    await expect(freeze({ selection })).rejects.toMatchObject({ code: 'invalid_selection' });
  }
  const p = await f.service.inspect(101, ids.message);
  const pos = p.text.indexOf('🌧');
  await expect(freeze({ selection: { start: pos + 1, end: pos + 2 } })).rejects.toMatchObject({ code: 'invalid_selection' });
});

test('spool is private, bounded by expiry, and no longer returns expired snapshots', async () => {
  const snapshot = await freeze();
  expect((await fs.stat(path.join(directory, 'private/state.json'))).mode & 0o777).toBe(0o600);
  clock += TTL_MS + 1;
  await expect(f.service.get(101, snapshot.id)).rejects.toMatchObject({ code: 'snapshot_unavailable' });
});

async function http(env = { NODE_ENV: 'test', P03_DEV_ENABLED: 'true', P03_DEV_USER_IDS: '101' }) {
  const app = express();
  app.use('/api/dev/p03', createRouter({ service: f.service, env, authenticate: (req, res, next) => {
    if (req.get('Authorization') !== 'Bearer test-user-101') return res.status(401).json({ success: false });
    req.user = { id: 101, role: 'super_admin' }; next();
  } }));
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const root = `http://127.0.0.1:${server.address().port}/api/dev/p03`;
  return async (url, options = {}) => {
    const response = await fetch(root + url, { ...options, headers: { Authorization: 'Bearer test-user-101', ...options.headers } });
    return { response, data: await response.json() };
  };
}

test('HTTP envelope, strict parsing, fresh request IDs and safe errors', async () => {
  const call = await http();
  const normal = await call(`/messages/${ids.message}`);
  expect(normal.response.headers.get('cache-control')).toBe('no-store');
  expect(normal.response.headers.get('referrer-policy')).toBe('no-referrer');
  const input = await body();
  for (const content of [JSON.stringify(input) + '{}', '[]', '{"schema_version":1,"secret":"PRIVATE_INPUT"}', 'a'.repeat(17000)]) {
    const r = await call('/snapshots', { method: 'POST', body: content, headers: { 'Content-Type': 'application/json' } });
    expect(r.response.status).toBeGreaterThanOrEqual(400);
    expect(r.data.error.code).toBe('invalid_request');
    expect(JSON.stringify(r.data)).not.toContain('PRIVATE_INPUT');
    expect(r.data.request_id).not.toBe(normal.data.request_id);
  }
  expect((await call(`/messages/${ids.message}?token=FORBIDDEN`)).data.error.code).toBe('invalid_request');
  expect((await call(`/messages/${ids.message}`, { headers: { Authorization: '' } })).data.error.code).toBe('unauthenticated');
  const saved = await call('/snapshots', { method: 'POST', body: JSON.stringify(input), headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() } });
  expect(saved.response.status).toBe(200);
  expect(saved.data.payload.text).toBe(normal.data.text);
});

test('production and default configurations cannot mount the prototype, even with an enabled flag', async () => {
  for (const env of [{ NODE_ENV: 'production', P03_DEV_ENABLED: 'true' }, {}, { NODE_ENV: 'development' }]) {
    expect(enabled(env)).toBe(false);
    const app = { use: jest.fn() };
    mount(app, env);
    expect(app.use).not.toHaveBeenCalled();
  }
  const call = await http({ NODE_ENV: 'production', P03_DEV_ENABLED: 'true', P03_DEV_USER_IDS: '101' });
  expect((await call(`/messages/${ids.message}`)).response.status).toBe(404);
});
test('local user/admin role is not treated as verified teacher authority', async () => {
  const call = await http({ NODE_ENV: 'test', P03_DEV_ENABLED: 'true', P03_DEV_USER_IDS: '202' });
  expect((await call(`/messages/${ids.message}`)).response.status).toBe(403);
});

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const express = require('express');
const JSZip = require('jszip');
const { fixture } = require('../../helpers/p03Fixture');
const { ArtifactExportService } = require('../../../services/artifactExportService');
const { createRouter } = require('../../../routes/artifactExports');
let directory, f, service, server, url;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'p03-export-'));
  f = await fixture(directory); service = new ArtifactExportService(f.source);
  const app = express();
  app.use('/api/artifact-exports', createRouter({ service, authenticate: (req, res, next) => {
    if (!req.headers['x-test-user']) return res.status(401).json({ message: 'legacy auth failure' });
    req.user = { id: Number(req.headers['x-test-user']), role: 'admin' }; next();
  } }));
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  url = `http://127.0.0.1:${server.address().port}/api/artifact-exports/messages/${f.ids.message}`;
});
afterEach(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); });
async function body() {
  const p = await service.inspect(101, f.ids.message);
  return { schema_version: 1, expected_version: p.source.version, selection: { start: 0, end: p.text.length }, attachments: [] };
}
async function post(data, owner = 101) {
  return fetch(`${url}/download`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-user': String(owner) }, body: JSON.stringify(data) });
}
test('HTTP downloads exact passage and provenance, with no other conversation content or implicit attachments', async () => {
  const b = await body(); b.selection = { start: 2, end: 9 };
  const response = await post(b);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="answer-.*\.zip"$/);
  expect(response.headers.get('x-request-id')).toBeTruthy();
  const bytes = Buffer.from(await response.arrayBuffer());
  const zip = await JSZip.loadAsync(bytes);
  expect(Object.keys(zip.files)).toEqual(['answer.md', 'source.json']);
  const text = await zip.file('answer.md').async('string');
  expect(text).toBe((await service.inspect(101, f.ids.message)).text.slice(2, 9));
  const metadata = await zip.file('source.json').async('string');
  const manifest = JSON.parse(metadata);
  expect(manifest.source.version).toBe(b.expected_version);
  expect(manifest.locator).toMatchObject(b.selection);
  expect(manifest).not.toHaveProperty('draft_version');
  expect(text + metadata).not.toMatch(/PRIVATE_THINKING|UNSELECTED_PRIVATE_PROMPT|user_id|file_path|uploadRoot|mock-tedna/);
  expect((await service.download(101, f.ids.message, b)).buffer).toEqual(bytes);
});
test('only explicitly selected readable attachments are included; changed or revoked attachment refuses download', async () => {
  const b = await body(); const p = await service.inspect(101, f.ids.message);
  b.attachments = [{ source_id: f.ids.file, expected_version: p.attachments[0].version }];
  const zip = await JSZip.loadAsync((await service.download(101, f.ids.message, b)).buffer);
  expect(Object.keys(zip.files)).toEqual(['answer.md', 'attachments/01-activity.md', 'source.json']);
  expect(await zip.file('attachments/01-activity.md').async('string')).toBe(p.attachments[0].text);
  await fs.appendFile(path.join(f.uploadRoot, 'activity.md'), 'change');
  expect((await post(b)).status).toBe(409);
  f.files[f.ids.file].user_id = 202;
  expect((await (await post(b)).json()).error.code).toBe('attachment_unavailable');
});
test('requires authentication and ownership even for admin, and rechecks after preview', async () => {
  expect((await fetch(url)).status).toBe(401);
  const denied = await fetch(url, { headers: { 'x-test-user': '202' } });
  expect(denied.status).toBe(404);
  const b = await body();
  expect((await post(b, 202)).status).toBe(404);
  f.conversations[f.ids.conversation].user_id = 202;
  expect((await post(b)).status).toBe(404);
  const auth = await (await fetch(url)).json();
  expect(auth.error.code).toBe('unauthenticated'); expect(auth.request_id).toBeTruthy();
});
test('changed/deleted source is refused; a new preview restores download only for the new version', async () => {
  const b = await body(); f.messages[f.ids.message].content += 'Updated';
  expect((await (await post(b)).json()).error.code).toBe('source_changed');
  expect((await post(await body())).status).toBe(200);
  delete f.messages[f.ids.message];
  expect((await post(b)).status).toBe(404);
});
test('rejects caller content, identity, unknown fields, invalid ranges and split UTF16 pairs', async () => {
  const b = await body();
  for (const extra of [{ text: 'invented' }, { user_id: 101 }, { purpose: 'courseware' }]) expect((await post({ ...b, ...extra })).status).toBe(400);
  const p = await service.inspect(101, f.ids.message); const emoji = p.text.indexOf('🌧');
  for (const selection of [{ start: 0, end: 0 }, { start: -1, end: 9 }, { start: emoji, end: emoji + 1 }]) {
    expect((await (await post({ ...b, selection })).json()).error.code).toBe('invalid_selection');
  }
  expect((await fetch(url + '?token=not-a-real-token')).status).toBe(400);
  const malformed = await fetch(url + '/download', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-user': '101' }, body: '{}{}' });
  expect(malformed.status).toBe(400); expect((await malformed.json()).error.code).toBe('invalid_request');
});
test('concurrent repeat downloads are identical and create no persistent drafts; links remain plain references', async () => {
  const b = await body();
  const [a, c] = await Promise.all([service.download(101, f.ids.message, b), service.download(101, f.ids.message, b)]);
  expect(a.buffer).toEqual(c.buffer);
  const zip = await JSZip.loadAsync(a.buffer);
  expect(await zip.file('answer.md').async('string')).toContain('https://example.org/water-cycle');
  expect(JSON.parse(await zip.file('source.json').async('string')).web_links).toBe('references_only_not_fetched');
  expect(await fs.readdir(directory)).toEqual(['uploads']);
  expect((await fetch(url + '/deliver', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-user': '101' }, body: '{}' })).status).toBe(404);
});

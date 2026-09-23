// Synthetic HTTP acceptance + shareable source examples. No database or external service.
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const { createRequire } = require('module');
const backend = createRequire(path.resolve(__dirname, '../backend/package.json'));
const express = backend('express');
const { fixture } = backend('./src/__tests__/helpers/p03Fixture');
const { createRouter } = backend('./src/routes/artifactHandoffDev');
const { ArtifactHandoffService, DRAFT_VERSION } = backend('./src/services/artifactHandoff/service');
const { delivery } = backend('./src/services/artifactHandoff/receiver');
const { encodeDraft } = backend('./src/services/artifactHandoff/i03Draft');
const { DraftStore } = backend('./src/services/artifactHandoff/store');
const root = path.resolve(__dirname, '..');

(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'p03-http-'));
  let server, clock = Date.parse('2026-09-19T08:00:00Z');
  try {
    const f = await fixture(directory, () => clock);
    const app = express();
    const env = { NODE_ENV: 'test', P03_DEV_ENABLED: 'true', P03_DEV_USER_IDS: '101' };
    app.use('/api/dev/p03', createRouter({ service: f.service, env,
      authenticate: (req, res, next) => { req.user = { id: 101 }; next(); } }));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const url = `http://127.0.0.1:${server.address().port}/api/dev/p03`;
    async function call(route, body, expected = 200, key = randomUUID()) {
      const response = await fetch(url + route, body ? { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) } : {});
      const result = await response.json();
      assert.equal(response.status, expected);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert(result.request_id);
      return result;
    }
    const preview = await call(`/messages/${f.ids.message}`);
    const text = '先观察，再记录两杯水的变化。';
    const start = preview.text.indexOf(text);
    const base = { schema_version: 1, message_id: f.ids.message, expected_version: preview.source.version,
      selection: { start, end: start + text.length },
      attachments: [{ source_id: f.ids.file, expected_version: preview.attachments[0].version }], purpose: 'lesson_preparation' };
    const selected = await call('/snapshots', base);
    const whole = await call('/snapshots', { ...base, selection: { start: 0, end: preview.text.length }, attachments: [] });
    const checks = [];
    const duplicates = await Promise.all(Array.from({ length: 4 }, () => call('/snapshots', base)));
    assert(duplicates.every(x => x.id === selected.id && x.binding.operation_id === selected.binding.operation_id));
    checks.push('duplicate-clicks-one-operation');
    const authorize = simulation => call(`/snapshots/${selected.id}/authorize`, { schema_version: 1, simulation });
    const send = (grant, simulation, status = 200) => call(`/snapshots/${selected.id}/deliver`,
      { schema_version: 1, grant_id: grant.grant_id, simulation }, status);
    for (const simulation of ['expired', 'revoked']) {
      assert.equal((await send(await authorize(simulation), 'success', 403)).error.code, 'authorization_expired');
      checks.push(simulation);
    }
    const auth = await authorize('valid');
    const filename = f.files[f.ids.file].file_path;
    const bytes = await fs.readFile(filename);
    await fs.unlink(filename);
    assert.equal((await send(auth, 'success', 409)).error.code, 'attachment_unavailable');
    await fs.writeFile(filename, bytes);
    checks.push('selected-attachment-missing');
    assert.equal((await send(auth, 'reject', 503)).error.code, 'receiver_unavailable');
    assert.equal((await call(`/snapshots/${selected.id}/status`)).state, 'retryable_failure');
    checks.push('receiver-rejection');
    assert.equal((await send(auth, 'lose_response', 503)).error.code, 'response_lost');
    clock += 600_000;
    const restarted = new ArtifactHandoffService({ source: f.source,
      store: new DraftStore(path.join(directory, 'private'), () => clock), now: () => clock });
    const recovered = await restarted.status(101, selected.id);
    assert.equal(recovered.state, 'mock_received');
    assert.equal(recovered.receipt.operation_id, selected.binding.operation_id);
    assert.equal(recovered.continuation.resource_id, recovered.receipt.resource_id);
    assert.equal(recovered.continuation.state, 'not_started');
    assert.equal((await send(auth, 'success')).receipt_id, recovered.receipt_id);
    assert.equal(await restarted.receiver.store.transaction(state => Object.keys(state.received).length), 1);
    checks.push('lost-response-restart-expired-grant-query-recovery');
    f.conversations[f.ids.conversation].user_id = 202;
    assert.equal((await call(`/snapshots/${selected.id}/status`, null, 404)).error.code, 'source_unavailable');
    checks.push('revoked-source-blocks-recovery');
    f.conversations[f.ids.conversation].user_id = 101;
    const packet = delivery(await restarted.owned(101, selected.id));
    const exactPacket = JSON.parse(packet.packetBytes.toString('utf8'));
    assert.equal(exactPacket.payload.text, text);
    assert.equal(exactPacket.payload.attachments.length, 1);
    assert(!/PRIVATE_THINKING|UNSELECTED_PRIVATE_PROMPT|file_path|global_person_id/.test(packet.packetBytes.toString()));
    const examples = { example_only: true, draft_version: DRAFT_VERSION, protocol_status: 'awaiting_I03_T11',
      authorization: 'synthetic_local_tester_not_verified_teacher',
      limits: { answer_bytes: 131072, attachment_bytes_each: 65536, attachment_count: 3 },
      inventory: preview.attachments.map(({ text: ignored, ...item }) => item),
      selected: { binding: selected.binding, source_checks: selected.source_checks, ...exactPacket },
      whole_answer_without_attachments: { manifest: whole.manifest, payload: whole.payload },
      exact_packet_utf8: packet.packetBytes.toString('utf8'), recovered,
      i03_draft: encodeDraft(selected, { sourceInstance: 'practice-synthetic', targetInstance: 'tedna-synthetic', title: '两杯水观察方案（合成）' }) };
    if (process.argv.includes('--write-examples')) await fs.writeFile(path.join(root, 'docs/integrations/p03-handoff-examples.json'), JSON.stringify(examples, null, 2) + '\n');
    const output = path.join(root, 'storage/private/p03-handoff-validation');
    await fs.mkdir(output, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(output, 'http-result.json'), JSON.stringify({ synthetic: true, passed: true, checks,
      packet_sha256: packet.binding.packet_sha256, receipt: recovered.receipt }, null, 2), { mode: 0o600 });
    console.log(`P03 synthetic HTTP checks passed (${checks.length}); evidence: ${output}`);
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

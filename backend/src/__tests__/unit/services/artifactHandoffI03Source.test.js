const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { i03Fixture } = require('../../helpers/p03I03Fixture');
const { HandoffError } = require('../../../services/artifactHandoff/source');
const { I03DraftSource } = require('../../../services/artifactHandoff/i03Source');
const { VERSION } = require('../../../services/artifactHandoff/i03Draft');
describe('I03 application source orchestration (synthetic authority)', () => {
  let dir, f, clock, client, remote, phases, resource, onSend;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'p03-source-')); clock = Date.parse('2026-09-19T12:00:00Z');
    remote = 'not_received'; phases = []; resource = randomUUID(); onSend = null;
    client = { revoke: jest.fn(async () => {}), send: jest.fn(async (owner, record, phase, packet) => {
      phases.push(phase);
      if (onSend) await onSend(phase, record, packet);
      if (phase === 'prepare' && remote === 'not_received') remote = 'prepared';
      if (phase === 'commit' && remote === 'prepared') remote = 'succeeded';
      if (phase === 'cancel' && remote !== 'succeeded') remote = 'cancelled';
      return { schema_version: 1, protocol_version: VERSION, request_id: randomUUID(), operation_id: record.id,
        status: remote, replayed: false, ...(remote === 'succeeded' ? { resource_ref: resource,
          resource_version: `sha256:${record.binding.manifest_sha256}`,
          open_target: { kind: 'import_result', operation_id: record.id },
          ...(phase === 'cancel' ? { cancel_outcome: 'already_succeeded' } : {}) } : {}) };
    }) };
    f = await i03Fixture(dir, client, () => clock);
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });
  const freeze = async () => f.service.freeze(f.owner, await f.selection(), randomUUID(), '合成教学片段');
  const record = id => f.store.transaction(s => s.operations[id]);
  test('concurrent freezes and resumes retain one operation, frozen intent and resource', async () => {
    const body = await f.selection();
    const choices = await Promise.all([body, { ...body, purpose: 'courseware' }, body].map(b => f.service.freeze(f.owner, b, randomUUID(), '合成教学片段')));
    expect(new Set(choices.map(x => x.operation_id)).size).toBe(1);
    const id = choices[0].operation_id;
    onSend = async phase => { if (phase === 'commit') expect((await record(id)).released_at).toBe(clock / 1000); };
    const answers = await Promise.all(choices.map(() => f.service.resume(f.owner, id)));
    expect(new Set(answers.map(x => x.resource_ref)).size).toBe(1);
    expect(phases).toEqual(['prepare', 'commit', 'status', 'status']);
    expect(answers[0].continuation).toEqual({ status: 'not_started', landing: 'lesson_preparation' });
  });
  test('same idempotency key cannot change intent', async () => {
    const key = randomUUID(), body = await f.selection();
    const first = await f.service.freeze(f.owner, body, key, '标题');
    expect(await f.service.freeze(f.owner, body, key, '标题')).toEqual(first);
    await expect(f.service.freeze(f.owner, body, key, '改标题')).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });
  test.each(['copy', 'version', 'attachment'])('change %s after prepared cancels without releasing or committing', async kind => {
    const { operation_id: id } = await freeze();
    onSend = async phase => {
      if (phase !== 'prepare') return;
      await f.mutateSource(async () => {
        if (kind === 'copy') f.policy.copy = false;
        if (kind === 'version') f.messages[f.ids.message].content += '\nchanged';
        if (kind === 'attachment') await fs.unlink(f.files[f.ids.file].file_path);
      });
    };
    await expect(f.service.resume(f.owner, id)).rejects.toMatchObject({ code:
      { copy: 'source_permission_revoked', version: 'source_changed', attachment: 'attachment_unavailable' }[kind] });
    expect(phases).toEqual(['prepare', 'cancel']);
    expect(client.revoke).toHaveBeenCalledTimes(1);
    expect(await record(id)).toMatchObject({ status: 'cancelled', released_at: null, cancel_requested: true });
  });
  test('permission mutation shares release lock and must complete before release', async () => {
    const { operation_id: id } = await freeze();
    let unlock; const blocked = new Promise(resolve => { unlock = resolve; });
    const mutation = f.mutateSource(async () => { await blocked; f.policy.copy = false; });
    const attempt = f.service.resume(f.owner, id);
    unlock(); await mutation;
    await expect(attempt).rejects.toMatchObject({ code: 'source_permission_revoked' });
    expect(phases).toEqual([]); expect((await record(id)).released_at).toBeNull();
  });
  test('cancel during prepare is persisted before release; no commit', async () => {
    const { operation_id: id } = await freeze();
    let cancellation;
    onSend = async phase => {
      if (phase === 'prepare') {
        remote = 'prepared'; cancellation = f.service.cancel(f.owner, id);
        while (!(await record(id)).cancel_requested) await new Promise(resolve => setImmediate(resolve));
      }
    };
    await expect(f.service.resume(f.owner, id)).rejects.toMatchObject({ code: 'operation_cancelled' });
    expect((await cancellation).status).toBe('cancelled'); expect(phases).not.toContain('commit');
    expect((await record(id)).released_at).toBeNull();
  });
  test('cancel can revoke while commit is in flight', async () => {
    const { operation_id: id } = await freeze();
    onSend = async phase => {
      if (phase === 'commit') expect((await f.service.cancel(f.owner, id)).status).toBe('cancelled');
    };
    expect((await f.service.resume(f.owner, id)).status).toBe('cancelled');
    expect(client.revoke).toHaveBeenCalledTimes(1);
  });
  test('late commit failure cannot overwrite a confirmed parallel cancellation', async () => {
    const { operation_id: id } = await freeze();
    onSend = async phase => {
      if (phase === 'commit') {
        expect((await f.service.cancel(f.owner, id)).status).toBe('cancelled');
        throw new HandoffError('operation_cancelled', 410);
      }
    };
    await expect(f.service.resume(f.owner, id)).rejects.toMatchObject({ code: 'operation_cancelled' });
    expect(await f.service.get(f.owner, id)).toMatchObject({ status: 'cancelled' });
    expect((await record(id)).retry_at).toBeUndefined();
    expect((await f.service.resume(f.owner, id)).status).toBe('cancelled');
  });
  test('source instances cannot collapse identical choices or idempotency keys', async () => {
    const body = await f.selection(), key = randomUUID();
    const first = await f.service.freeze(f.owner, body, key, '标题');
    const other = new I03DraftSource({ source: f.source, store: f.store, authority: f.authority, client,
      sourceInstance: 'practice-other', targetInstance: 'tedna-synthetic', now: () => clock, env: { NODE_ENV: 'test' } });
    const second = await other.freeze(f.owner, body, key, '标题');
    expect(second.operation_id).not.toBe(first.operation_id);
    await expect(other.get(f.owner, first.operation_id)).rejects.toMatchObject({ code: 'binding_mismatch' });
  });
  test('cancel after success preserves original resource and continuation remains not started', async () => {
    const { operation_id: id } = await freeze(), a = await f.service.resume(f.owner, id);
    const b = await f.service.cancel(f.owner, id);
    expect(b.resource_ref).toBe(a.resource_ref); expect(b.status).toBe('succeeded');
    expect((await record(id)).receipt.cancel_outcome).toBe('already_succeeded');
  });
  test('lost commit response recovers after source restart and payload expiry without resending', async () => {
    const { operation_id: id } = await freeze();
    onSend = async phase => { if (phase === 'commit') { remote = 'succeeded'; throw new HandoffError('target_unavailable', 503, true); } };
    await expect(f.service.resume(f.owner, id)).rejects.toMatchObject({ code: 'target_unavailable' });
    expect(await f.service.get(f.owner, id)).toMatchObject({ status: 'unknown' });
    onSend = null; clock += 2 * 86400000;
    const restarted = await i03Fixture(dir, client, () => clock);
    restarted.policy.copy = false; // Released private copy is recoverable; current subject still required.
    expect(await restarted.service.resume(f.owner, id)).toMatchObject({ status: 'succeeded', resource_ref: resource });
    expect(phases).toEqual(['prepare', 'commit', 'status']);
    expect(await restarted.store.transaction(s => s.snapshots[id])).toBeUndefined();
  });
  test('failed receiver requires explicit delayed retry and fresh status before write', async () => {
    const { operation_id: id } = await freeze();
    onSend = async phase => { if (phase === 'prepare') throw new HandoffError('target_unavailable', 503, true); };
    await expect(f.service.resume(f.owner, id)).rejects.toMatchObject({ code: 'target_unavailable' });
    await expect(f.service.resume(f.owner, id)).rejects.toMatchObject({ code: 'retry_later' });
    onSend = null; clock += 1000;
    expect((await f.service.resume(f.owner, id)).status).toBe('succeeded');
    expect(phases).toEqual(['prepare', 'status', 'prepare', 'commit']);
  });
  test('cancel after failed initial issue confirms absence before local cancellation', async () => {
    const { operation_id: id } = await freeze();
    onSend = async phase => { throw Object.assign(new HandoffError(phase === 'prepare' ? 'identity_unavailable' : 'not_prepared', 503, true), { peer: 'identity' }); };
    await expect(f.service.resume(f.owner, id)).rejects.toMatchObject({ code: 'identity_unavailable' });
    expect((await f.service.cancel(f.owner, id)).status).toBe('cancelled');
    expect(client.revoke).not.toHaveBeenCalled();
  });
  test('24h expiry and 30d retention are absolute; no replacement operation on repeated choice', async () => {
    const a = await freeze(); clock += 86400000;
    expect((await f.service.resume(f.owner, a.operation_id)).status).toBe('expired');
    expect((await freeze()).operation_id).toBe(a.operation_id); expect(phases).toEqual([]);
    clock += 29 * 86400000;
    await expect(f.service.get(f.owner, a.operation_id)).rejects.toMatchObject({ code: 'snapshot_unavailable' });
  });
  test('deleted target never recreates and a changed resource receipt is rejected', async () => {
    const { operation_id: id } = await freeze(); await f.service.resume(f.owner, id);
    resource = randomUUID(); await expect(f.service.status(f.owner, id)).rejects.toMatchObject({ code: 'receipt_invalid' });
    remote = 'deleted'; expect((await f.service.status(f.owner, id)).status).toBe('deleted');
    expect((await f.service.resume(f.owner, id)).status).toBe('deleted');
    expect(phases.filter(p => p === 'commit')).toHaveLength(1);
  });
  test('explicit active/eligible policy and ownership are checked, production cannot construct service', async () => {
    const a = await freeze(); f.policy.eligible = false;
    await expect(f.service.status(f.owner, a.operation_id)).rejects.toMatchObject({ code: 'subject_not_eligible' });
    f.policy.eligible = true; f.policy.active = false;
    await expect(f.service.resume(f.owner, a.operation_id)).rejects.toMatchObject({ code: 'subject_disabled' });
    expect(phases).toEqual([]);
    expect(() => new I03DraftSource({ env: { NODE_ENV: 'production' } })).toThrow('disabled');
    expect(() => new I03DraftSource({ env: { NODE_ENV: 'test' } })).toThrow('invalid_draft_configuration');
  });
  test('another eligible teacher cannot inspect or resume this operation', async () => {
    const { operation_id: id } = await freeze();
    f.authority.checkSubject = async () => {}; // Both accounts are eligible; operation ownership still differs.
    for (const action of ['get', 'status', 'resume', 'cancel']) {
      await expect(f.service[action]('p-other', id)).rejects.toMatchObject({ code: 'snapshot_unavailable' });
    }
    await expect(f.service.freeze(f.owner, null, randomUUID(), '标题')).rejects.toMatchObject({ code: 'invalid_request' });
    expect(phases).toEqual([]);
  });
});

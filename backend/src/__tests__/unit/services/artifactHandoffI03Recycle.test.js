// rc3 §4 state model on the source side: recycled keeps the resource identity and may be restored;
// deleted is the tombstone terminal state; the draft wire never sees either extension.
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { i03Fixture } = require('../../helpers/p03I03Fixture');
const { FormalPeers, DAY } = require('../../helpers/p03FormalPeers');
const { targetReceipt } = require('../../../services/artifactHandoff/i03Client');
const { FORMAL_VERSION, VERSION } = require('../../../services/artifactHandoff/i03Draft');
const T0 = 2000000000;
describe('I03 formal candidate recycle bin (rc3 §4, synthetic peers)', () => {
  let dir, f, clock, peers, id, done;
  const record = () => f.store.transaction(f.owner, s => s.operations[id]);
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'p03-recycle-'));
    clock = T0 * 1000; peers = new FormalPeers(() => clock);
    f = await i03Fixture(dir, peers, () => clock, 'p-teacher', { wireVersion: FORMAL_VERSION });
    ({ operation_id: id } = await f.service.freeze(f.owner, await f.selection(), randomUUID(), '合成教学片段'));
    done = await f.service.resume(f.owner, id);
    expect(done.status).toBe('succeeded');
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });
  test('V14: owner deletion shows recycled with the same resource identity and recycle_until; no write, no expiry rewrite', async () => {
    peers.recycle(id);
    const view = await f.service.status(f.owner, id);
    expect(view).toMatchObject({ status: 'recycled', resource_ref: done.resource_ref, resource_version: done.resource_version,
      open_target: done.open_target, recycle_until: T0 + 30 * DAY });
    expect(view.continuation).toBeUndefined();
    expect(await f.service.cancel(f.owner, id)).toMatchObject({ status: 'recycled', resource_ref: done.resource_ref });
    expect((await record()).receipt.cancel_outcome).toBe('already_succeeded');
    clock = (T0 + 2 * DAY) * 1000; // past L; the recycled resource is not rewritten as expired and nothing is resent
    expect(await f.service.resume(f.owner, id)).toMatchObject({ status: 'recycled', recycle_until: T0 + 30 * DAY });
    expect(peers.phases.filter(p => p === 'commit')).toHaveLength(1);
    expect(await f.store.transaction(f.owner, s => s.snapshots[id])).toBeUndefined();
  });
  test('V15: restore returns to succeeded with the same identity; a changed identity or moved recycle_until is rejected', async () => {
    peers.recycle(id);
    expect((await f.service.status(f.owner, id)).status).toBe('recycled');
    peers.script.recycleUntilOverride = T0 + 31 * DAY;
    await expect(f.service.status(f.owner, id)).rejects.toMatchObject({ code: 'receipt_invalid' });
    peers.script.recycleUntilOverride = undefined;
    peers.script.resourceOverride = randomUUID();
    await expect(f.service.status(f.owner, id)).rejects.toMatchObject({ code: 'receipt_invalid' });
    peers.script.resourceOverride = undefined;
    clock = (T0 + 10 * DAY) * 1000;
    peers.restore(id);
    const back = await f.service.status(f.owner, id);
    expect(back).toMatchObject({ status: 'succeeded', resource_ref: done.resource_ref, resource_version: done.resource_version,
      continuation: { status: 'not_started', landing: 'lesson_preparation' } });
    expect(back.recycle_until).toBeUndefined();
    expect((await f.service.freeze(f.owner, await f.selection(), randomUUID(), '合成教学片段')).operation_id).toBe(id);
  });
  test('V16: purge reaches the deleted tombstone; nothing revives it afterwards', async () => {
    peers.recycle(id); await f.service.status(f.owner, id);
    peers.purge(id);
    const gone = await f.service.status(f.owner, id);
    expect(gone.status).toBe('deleted'); expect(gone.resource_ref).toBeUndefined(); expect(gone.recycle_until).toBeUndefined();
    peers.target.get(id).state = 'succeeded'; // a tombstone cannot be talked back into a resource
    await expect(f.service.status(f.owner, id)).rejects.toMatchObject({ code: 'receipt_invalid' });
    // The refused receipt is recorded as an error only; the tombstone itself is never un-settled (triad finding 2026-09-21).
    const kept = await f.service.get(f.owner, id);
    expect(kept).toMatchObject({ status: 'deleted', error_code: 'receipt_invalid' }); expect(kept.resource_ref).toBeUndefined();
    peers.target.get(id).state = 'deleted'; clock += 2000; // honest peer again, after the recorded backoff
    expect((await f.service.resume(f.owner, id)).status).toBe('deleted');
    expect(peers.phases.filter(p => p === 'commit')).toHaveLength(1);
  });
  test('V17: a failed read-only status query keeps the receipt-backed status; only writes are unknown in flight', async () => {
    peers.script.dropRedeem = 'status'; // transient target failure on the query itself
    await expect(f.service.status(f.owner, id)).rejects.toMatchObject({ code: 'target_unavailable' });
    expect(await f.service.get(f.owner, id)).toMatchObject({ status: 'succeeded', error_code: 'target_unavailable', resource_ref: done.resource_ref });
    clock += 2000;
    expect(await f.service.resume(f.owner, id)).toMatchObject({ status: 'succeeded', resource_ref: done.resource_ref });
    expect((await record()).last_error).toBeUndefined();
    expect(peers.phases.filter(p => p === 'commit')).toHaveLength(1); // writes that fail stay unknown until queried (window tests)
  });
  test('receipt shape: recycled needs the resource identity and an integer recycle_until; succeeded must not carry it; the draft rejects both', () => {
    const base = { schema_version: 1, protocol_version: FORMAL_VERSION, request_id: 'r1', operation_id: id, replayed: false };
    const resource = { resource_ref: done.resource_ref, resource_version: done.resource_version, open_target: { kind: 'import_result', operation_id: id } };
    expect(targetReceipt({ ...base, status: 'recycled', ...resource, recycle_until: T0 + 30 * DAY }, id, FORMAL_VERSION).status).toBe('recycled');
    expect(targetReceipt({ ...base, status: 'recycled', ...resource, recycle_until: T0 + 30 * DAY, cancel_outcome: 'already_succeeded' }, id, FORMAL_VERSION).cancel_outcome).toBe('already_succeeded');
    for (const bad of [{ ...base, status: 'recycled', ...resource }, { ...base, status: 'recycled', ...resource, recycle_until: '2002592000' },
      { ...base, status: 'recycled', ...resource, recycle_until: 0 }, { ...base, status: 'recycled', recycle_until: T0 },
      { ...base, status: 'succeeded', ...resource, recycle_until: T0 + 30 * DAY }, { ...base, status: 'deleted', recycle_until: T0 },
      { ...base, status: 'deleted', ...resource }]) {
      expect(() => targetReceipt(bad, id, FORMAL_VERSION)).toThrow('receipt_invalid');
    }
    const draft = { ...base, protocol_version: VERSION };
    expect(() => targetReceipt({ ...draft, status: 'recycled', ...resource, recycle_until: T0 + 30 * DAY }, id, VERSION)).toThrow('receipt_invalid');
    expect(() => targetReceipt({ ...draft, status: 'succeeded', ...resource, recycle_until: T0 + 30 * DAY }, id, VERSION)).toThrow('receipt_invalid');
    expect(targetReceipt({ ...draft, status: 'succeeded', ...resource }, id, VERSION).status).toBe('succeeded');
  });
});

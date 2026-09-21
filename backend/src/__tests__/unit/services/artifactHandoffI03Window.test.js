// rc2 V10–13 on the source side against a synthetic formal Identity/TE-DNA pair (no real peer).
// Windows: t0 = first persisted issue, W = t0 + 86400, R = W + 29d, L = freeze + 24h.
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { i03Fixture } = require('../../helpers/p03I03Fixture');
const { FormalPeers, DAY } = require('../../helpers/p03FormalPeers');
const { HandoffError } = require('../../../services/artifactHandoff/source');
const { I03DraftSource, ISSUE_SETTLE_MS, METADATA_GRACE_SECONDS } = require('../../../services/artifactHandoff/i03Source');
const { FORMAL_VERSION, VERSION } = require('../../../services/artifactHandoff/i03Draft');
const { RECOVERY_SECONDS } = require('../../../services/artifactHandoff/i03Client');
const FREEZE = 1999992800, T0 = 2000000000; // rc2 §3 fixed example: freeze two hours before t0
describe('I03 formal candidate windows (rc2 V10–13, synthetic peers)', () => {
  let dir, f, clock, peers;
  const nowS = () => Math.floor(clock / 1000);
  const record = id => f.store.transaction(f.owner, s => s.operations[id]);
  const snapshot = id => f.store.transaction(f.owner, s => s.snapshots[id]);
  const freeze = async () => f.service.freeze(f.owner, await f.selection(), randomUUID(), '合成教学片段');
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'p03-window-'));
    clock = FREEZE * 1000; peers = new FormalPeers(() => clock);
    f = await i03Fixture(dir, peers, () => clock, 'p-teacher', { wireVersion: FORMAL_VERSION, recoveryAttemptLimit: 3 });
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });
  test('W is persisted from the validated grant before the target request and never changes; R and L are derived', async () => {
    const { operation_id: id } = await freeze();
    clock = T0 * 1000;
    const done = await f.service.resume(f.owner, id);
    expect(done).toMatchObject({ status: 'succeeded', protocol_version: FORMAL_VERSION,
      operation_expires_at: T0 + DAY, recovery_until: T0 + DAY + RECOVERY_SECONDS });
    const op = await record(id);
    expect(op).toMatchObject({ operation_expires_at: T0 + DAY, hold: false, write_until: (FREEZE + DAY) * 1000,
      recovery_until: (T0 + DAY + RECOVERY_SECONDS + METADATA_GRACE_SECONDS) * 1000, protocol_version: FORMAL_VERSION });
    expect(peers.phases).toEqual(['prepare', 'commit']);
    expect(peers.issues.map(i => i.operation_expires_at)).toEqual([T0 + DAY, T0 + DAY]);
    // A later grant with another deadline for the same operation is a binding mismatch and never reaches the target.
    peers.script.deadlineOverride = T0 + DAY + 1;
    await expect(f.service.status(f.owner, id)).rejects.toMatchObject({ code: 'binding_mismatch' });
    expect(peers.phases).toEqual(['prepare', 'commit']);
    expect((await record(id)).operation_expires_at).toBe(T0 + DAY);
  });
  test('V10: lost first-issue response keeps the operation, recovers W via status, then continues the same prepare', async () => {
    const { operation_id: id } = await freeze();
    clock = T0 * 1000; peers.script.loseIssue = true;
    await expect(f.service.resume(f.owner, id)).rejects.toMatchObject({ code: 'identity_unavailable' });
    let op = await record(id);
    expect(op).toMatchObject({ status: 'unknown', identity_attempted: true, operation_expires_at: null, hold: true, recovery_attempts: 1 });
    expect(op.issue_settles_at).toBe(T0 * 1000 + 100 + ISSUE_SETTLE_MS);
    expect(peers.identity.size).toBe(1); expect(peers.phases).toEqual([]);
    clock += 2000;
    const done = await f.service.resume(f.owner, id);
    expect(done).toMatchObject({ status: 'succeeded', operation_expires_at: T0 + DAY });
    expect(peers.identity.size).toBe(1); // same Identity operation; no replacement, no guessed deadline
    expect(peers.issues.map(i => i.phase)).toEqual(['prepare', 'status', 'prepare', 'commit']);
    expect(peers.phases).toEqual(['status', 'prepare', 'commit']);
    op = await record(id);
    expect(op).toMatchObject({ hold: false, operation_expires_at: T0 + DAY });
    expect(op.recovery_attempts).toBeUndefined(); expect(op.failure).toBeUndefined();
    // Restart: a fresh source over the same spool reads the persisted W and answers from status alone.
    const restarted = await i03Fixture(dir, peers, () => clock, 'p-teacher', { wireVersion: FORMAL_VERSION });
    expect(await restarted.service.status(f.owner, id)).toMatchObject({ status: 'succeeded', operation_expires_at: T0 + DAY, resource_ref: done.resource_ref });
  });
  test('V10: "not_prepared" while the first issue may still be in flight is not proof of absence', async () => {
    const { operation_id: id } = await freeze();
    clock = T0 * 1000; peers.script.identityDown = true;
    await expect(f.service.resume(f.owner, id)).rejects.toMatchObject({ code: 'identity_unavailable' });
    peers.script.identityDown = false; peers.identity.clear(); // Identity never persisted anything
    clock += 2000;
    await expect(f.service.resume(f.owner, id)).rejects.toMatchObject({ code: 'retry_later' });
    expect((await record(id)).retry_at).toBe(T0 * 1000 + 100 + ISSUE_SETTLE_MS);
    clock = T0 * 1000 + 100 + ISSUE_SETTLE_MS + 1;
    expect((await f.service.resume(f.owner, id)).status).toBe('succeeded');
    expect(peers.phases).toEqual(['prepare', 'commit']);
  });
  test('V10: bounded recovery without a trusted W stops automatic writes and needs an explicit reconciliation exit', async () => {
    const { operation_id: id } = await freeze();
    clock = T0 * 1000; peers.script.identityDown = true;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await expect(f.service.resume(f.owner, id)).rejects.toMatchObject({ code: 'identity_unavailable' });
      clock += 2000;
    }
    let op = await record(id);
    expect(op).toMatchObject({ hold: true, recovery_attempts: 3, reconciliation: { attempts: 3, last_error: 'identity_unavailable' } });
    expect(op.failure).toEqual({ first_at: T0, last_at: T0 + 4, attempts: 3, last_error: 'identity_unavailable', phase: 'status' });
    expect(JSON.stringify(op)).not.toMatch(/先观察|manifest_b64|ticket/);
    peers.script.identityDown = false;
    await expect(f.service.resume(f.owner, id)).rejects.toMatchObject({ code: 'reconciliation_required' });
    expect(await f.service.get(f.owner, id)).toMatchObject({ status: 'unknown', reconciliation_required: true });
    // Held records outlive freeze+30d; nothing is pruned or resent silently.
    clock = (FREEZE + 31 * DAY) * 1000;
    expect(await f.service.get(f.owner, id)).toMatchObject({ reconciliation_required: true });
    expect(peers.phases).toEqual([]);
    const closure = { outcome: 'not_created', basis: 'Identity history has no operation; target has no receipt or tombstone',
      attempts_ended: true, identity_history_checked: true, target_receipt_checked: true };
    await expect(f.service.reconcile('p-teacher', f.owner, id, closure)).rejects.toMatchObject({ code: 'subject_not_eligible' });
    await expect(f.service.reconcile('ops-reconciler', f.owner, id, { ...closure, attempts_ended: false })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(await f.service.reconcile('ops-reconciler', f.owner, id, closure)).toMatchObject({ status: 'cancelled',
      reconciliation_closed: { outcome: 'not_created', actor: 'ops-reconciler', closed_at: nowS() } });
    // Closed: normal retention applies again (freeze+30d already passed), so the record is gone on the next read.
    await expect(f.service.get(f.owner, id)).rejects.toMatchObject({ code: 'snapshot_unavailable' });
    await expect(f.service.reconcile('ops-reconciler', f.owner, id, closure)).rejects.toMatchObject({ code: 'snapshot_unavailable' });
    expect(peers.phases).toEqual([]); expect(peers.identity.size).toBe(0);
  });
  test('V11: past freeze+30d but inside R the bodiless record still recovers the original result; no second resource', async () => {
    const { operation_id: id } = await freeze();
    clock = T0 * 1000;
    const done = await f.service.resume(f.owner, id);
    clock = (FREEZE + 30 * DAY + 1) * 1000; // rc2 §3: 7199 s of recovery window remain
    expect(await snapshot(id)).toBeUndefined();
    const status = await f.service.status(f.owner, id);
    expect(status).toMatchObject({ status: 'succeeded', resource_ref: done.resource_ref, resource_version: done.resource_version });
    expect(peers.issues.at(-1)).toMatchObject({ phase: 'status', ticket_expires_at: nowS() + 60 });
    expect((await freeze()).operation_id).toBe(id);
    expect(peers.target.size).toBe(1); expect(peers.phases).toEqual(['prepare', 'commit', 'status']);
  });
  test('V12a: write ticket is cut at W; crossing W between issue and redeem creates no resource', async () => {
    clock = T0 * 1000; // freeze and first issue in the same second, so L = W and a commit at W-1 is possible
    const { operation_id: id } = await freeze();
    peers.script.dropRedeem = 'commit'; // released, but the commit request never reached the target
    await expect(f.service.resume(f.owner, id)).rejects.toMatchObject({ code: 'target_unavailable' });
    expect(await record(id)).toMatchObject({ status: 'unknown', released_at: T0 });
    clock = (T0 + DAY - 1) * 1000;
    peers.script.beforeRedeem = phase => { if (phase !== 'commit') return false; clock = (T0 + DAY) * 1000; return true; };
    await expect(f.service.resume(f.owner, id)).rejects.toMatchObject({ code: 'ticket_expired' });
    expect(peers.issues.at(-1)).toEqual({ phase: 'commit', operation_expires_at: T0 + DAY, ticket_expires_at: T0 + DAY });
    expect(peers.target.get(id).state).toBe('prepared');
    clock += 2000;
    expect(await f.service.resume(f.owner, id)).toMatchObject({ status: 'expired' });
    expect(peers.target.get(id).state).toBe('expired');
    expect(await f.service.resume(f.owner, id)).toMatchObject({ status: 'expired' });
    expect(peers.issues.map(i => i.phase)).toEqual(['prepare', 'commit', 'status', 'commit', 'status', 'status']);
    expect(peers.phases.filter(p => p === 'commit')).toHaveLength(1); // the W-1 redeem; the first never arrived
  });
  test('V12a: at W the source requests no write ticket; the target result is queried and reported', async () => {
    clock = T0 * 1000;
    const { operation_id: id } = await freeze();
    peers.script.dropRedeem = 'commit';
    await expect(f.service.resume(f.owner, id)).rejects.toMatchObject({ code: 'target_unavailable' });
    clock = (T0 + DAY) * 1000;
    expect(await f.service.resume(f.owner, id)).toMatchObject({ status: 'expired' });
    expect(peers.issues.map(i => i.phase)).toEqual(['prepare', 'commit', 'status']);
    // A lost success is recovered the same way: no new write, only the original result.
    clock = T0 * 1000; peers.issues = []; peers.phases = [];
    const second = await i03Fixture(await fs.mkdtemp(path.join(os.tmpdir(), 'p03-window-')), peers, () => clock, 'p-teacher', { wireVersion: FORMAL_VERSION });
    const { operation_id: other } = await second.service.freeze(second.owner, await second.selection(), randomUUID(), '合成教学片段');
    peers.script.loseRedeem = 'commit';
    await expect(second.service.resume(second.owner, other)).rejects.toMatchObject({ code: 'target_unavailable' });
    clock = (T0 + DAY) * 1000;
    expect(await second.service.resume(second.owner, other)).toMatchObject({ status: 'succeeded' });
    expect(peers.issues.map(i => i.phase)).toEqual(['prepare', 'commit', 'status']);
  });
  test('V12b: status ticket is cut at R; at R no recovery authorization is requested and cancel is refused', async () => {
    const { operation_id: id } = await freeze();
    clock = T0 * 1000;
    const done = await f.service.resume(f.owner, id);
    const R = T0 + DAY + RECOVERY_SECONDS;
    clock = (R - 1) * 1000;
    expect(await f.service.status(f.owner, id)).toMatchObject({ status: 'succeeded' });
    expect(peers.issues.at(-1)).toEqual({ phase: 'status', operation_expires_at: T0 + DAY, ticket_expires_at: R });
    const issued = peers.issues.length;
    clock = R * 1000;
    expect(await f.service.status(f.owner, id)).toMatchObject({ status: 'succeeded', resource_ref: done.resource_ref });
    expect(await f.service.resume(f.owner, id)).toMatchObject({ status: 'succeeded' });
    await expect(f.service.cancel(f.owner, id)).rejects.toMatchObject({ code: 'recovery_window_closed' });
    expect(peers.issues).toHaveLength(issued); expect(peers.revokes).toBe(0);
    clock = (R + METADATA_GRACE_SECONDS) * 1000;
    await expect(f.service.get(f.owner, id)).rejects.toMatchObject({ code: 'snapshot_unavailable' });
  });
  test('V13: L <= now < W stops release; an existing success survives local snapshot expiry', async () => {
    const { operation_id: id } = await freeze();
    clock = T0 * 1000;
    peers.script.loseRedeem = 'prepare';
    await expect(f.service.resume(f.owner, id)).rejects.toMatchObject({ code: 'target_unavailable' });
    expect(peers.target.get(id).state).toBe('prepared');
    clock = (FREEZE + DAY) * 1000; // L reached, W still 7200 s away
    expect(await f.service.resume(f.owner, id)).toMatchObject({ status: 'expired' });
    expect(peers.phases).toEqual(['prepare', 'status']); expect((await record(id)).released_at).toBeNull();
    // Second half: a succeeded operation whose L has passed keeps showing and recovering its success.
    const second = await i03Fixture(await fs.mkdtemp(path.join(os.tmpdir(), 'p03-window-')), peers, () => clock, 'p-teacher', { wireVersion: FORMAL_VERSION });
    clock = FREEZE * 1000; peers.phases = [];
    const { operation_id: other } = await second.service.freeze(second.owner, await second.selection(), randomUUID(), '合成教学片段');
    clock = T0 * 1000;
    const done = await second.service.resume(second.owner, other);
    clock = (FREEZE + DAY + 1) * 1000;
    expect(await second.store.transaction(second.owner, s => s.snapshots[other])).toBeUndefined();
    expect(await second.service.resume(second.owner, other)).toMatchObject({ status: 'succeeded', resource_ref: done.resource_ref });
    expect(peers.phases).toEqual(['prepare', 'commit', 'status']);
  });
  test('draft and formal records are never mixed; the formal source refuses a target result without a trusted W', async () => {
    const { operation_id: id } = await freeze();
    const draft = new I03DraftSource({ source: f.source, store: f.store, authority: f.authority, client: peers, now: () => clock,
      sourceInstance: 'practice-synthetic', targetInstance: 'tedna-synthetic', env: { NODE_ENV: 'test' } });
    await expect(draft.get(f.owner, id)).rejects.toMatchObject({ code: 'binding_mismatch' });
    await expect(draft.freeze(f.owner, await f.selection(), randomUUID(), '合成教学片段')).rejects.toMatchObject({ code: 'binding_mismatch' });
    expect((await record(id)).protocol_version).toBe(FORMAL_VERSION); expect(VERSION).not.toBe(FORMAL_VERSION);
    const forgetful = { revoke: peers.revoke.bind(peers), send: (owner, rec, phase, packet) => peers.send(owner, rec, phase, packet) };
    const blind = new I03DraftSource({ source: f.source, store: f.store, authority: f.authority, client: forgetful, now: () => clock,
      sourceInstance: 'practice-synthetic', targetInstance: 'tedna-synthetic', wireVersion: FORMAL_VERSION, env: { NODE_ENV: 'test' } });
    await expect(blind.resume(f.owner, id)).rejects.toMatchObject({ code: 'receipt_invalid' });
    expect((await record(id)).operation_expires_at).toBeNull();
    expect(() => new I03DraftSource({ source: f.source, store: f.store, authority: f.authority, client: peers,
      sourceInstance: 'a', targetInstance: 'b', wireVersion: 'teacher-artifact-handoff/2', env: { NODE_ENV: 'test' } })).toThrow('invalid_draft_configuration');
  });
  test('formal errors keep only safe classification and retry timing', async () => {
    const { operation_id: id } = await freeze();
    clock = T0 * 1000;
    peers.send = async () => { throw Object.assign(new HandoffError('rate_limited', 429, true), { peer: 'target', retryAfter: 7 }); };
    await expect(f.service.resume(f.owner, id)).rejects.toMatchObject({ code: 'rate_limited' });
    expect(await f.service.get(f.owner, id)).toMatchObject({ status: 'unknown', error_code: 'rate_limited', retry_at: nowS() + 7 });
  });
});

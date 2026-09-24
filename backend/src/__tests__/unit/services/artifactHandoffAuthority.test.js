// J2 source eligibility candidate: start rights only; teacher status is TE-DNA's, the link is Identity's.
const { createHandoffAuthority } = require('../../../services/artifactHandoff/handoffAuthority');
describe('P03 source handoff authority (candidate)', () => {
  const users = {
    101: { id: 101, status: 'active', role: 'user', isAccountExpired: () => false },
    102: { id: 102, status: 'inactive', role: 'user', isAccountExpired: () => false },
    103: { id: 103, status: 'active', role: 'user', isAccountExpired: () => true },
    104: { id: 104, status: 'active', role: 'super_admin', isAccountExpired: () => false },
    105: { id: 105, status: 'active', role: 'user', group_id: 9, isAccountExpired: () => false },
    106: { id: 106, status: 'active', role: 'user', uuid_source: 'sso', isAccountExpired: () => false }, // edu shadow account
    107: { id: 107, status: 'active', role: 'super_admin', uuid_source: 'sso', isAccountExpired: () => false }
  };
  const messages = { m1: { id: 'm1', conversation_id: 'c1', created_at: '2026-09-21T00:00:00Z' }, m2: { id: 'm2', conversation_id: 'c2', created_at: '2026-09-21T00:00:00Z' } };
  const conversations = { c1: { id: 'c1', user_id: 101 }, c2: { id: 'c2', user_id: 105, cleared_at: '2026-09-21T01:00:00Z' } };
  const locks = [];
  const store = { withOwnerLock: async (owner, fn) => { locks.push(owner); return fn(); } };
  const make = (extra = {}) => createHandoffAuthority({ User: { findById: async id => users[id] }, Message: { findById: async id => messages[id] },
    Conversation: { findById: async id => conversations[id] }, store, ...extra });
  test('active, unexpired, non-student accounts may start; nothing else does', async () => {
    const a = make();
    await expect(a.checkSubject(101)).resolves.toBeUndefined();
    await expect(a.checkSubject('101')).resolves.toBeUndefined();
    for (const [who, code] of [[102, 'subject_disabled'], [103, 'subject_disabled'], [999, 'subject_disabled'], ['p-teacher', 'subject_disabled'], ['-1', 'subject_disabled']]) {
      await expect(a.checkSubject(who)).rejects.toMatchObject({ code, status: 403 });
    }
    // Shadow accounts (uuid_source='sso') are excluded by default; an injected student-group predicate only adds to that.
    await expect(a.checkSubject(106)).rejects.toMatchObject({ code: 'subject_not_eligible', status: 403 });
    await expect(a.checkSubject(105)).resolves.toBeUndefined();
    const student = make({ isStudentAccount: user => user.group_id === 9 });
    await expect(student.checkSubject(105)).rejects.toMatchObject({ code: 'subject_not_eligible' });
    await expect(student.checkSubject(106)).rejects.toMatchObject({ code: 'subject_not_eligible' });
    await expect(student.checkSubject(101)).resolves.toBeUndefined();
  });
  test('export needs the owner\'s own, uncleared conversation; nothing about teacher role is inferred', async () => {
    const a = make();
    await expect(a.checkExport(101, 'm1')).resolves.toBeUndefined();
    await expect(a.checkExport(104, 'm1')).rejects.toMatchObject({ code: 'source_permission_revoked' }); // super_admin is not the owner
    await expect(a.checkExport(105, 'm2')).rejects.toMatchObject({ code: 'source_permission_revoked' }); // cleared conversation
    await expect(a.checkExport(101, 'missing')).rejects.toMatchObject({ code: 'source_permission_revoked' });
    await expect(a.checkExport(102, 'm1')).rejects.toMatchObject({ code: 'subject_disabled' });
  });
  test('source lock is the owner anchor of the durable store; reconciliation needs an active super_admin', async () => {
    const a = make();
    expect(await a.withSourceLock(101, 'm1', async () => 'done')).toBe('done');
    expect(locks).toEqual(['101']);
    await expect(a.checkReconciler(104)).resolves.toBeUndefined();
    await expect(a.checkReconciler(107)).resolves.toBeUndefined(); // reconciliation is not a handoff start; the shadow rule is about starting
    await expect(a.checkReconciler(101)).rejects.toMatchObject({ code: 'subject_not_eligible' });
    await expect(a.checkReconciler(102)).rejects.toMatchObject({ code: 'subject_disabled' });
    expect(() => createHandoffAuthority({ User: {}, Message: {}, Conversation: {}, store: {} })).toThrow('invalid_draft_configuration');
  });
});

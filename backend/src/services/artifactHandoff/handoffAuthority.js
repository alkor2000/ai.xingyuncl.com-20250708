// Source-side eligibility candidate for the teacher artifact handoff (user decision J2, 2026-09-21).
// The practice platform decides only whether an account may START a handoff: the account exists, is active,
// is not expired and is not a student-mode/shadow account. It does NOT infer teacher status: TE-DNA decides
// "teacher" on its own local account, and Identity refuses unlinked accounts at issue (source_link_unavailable).
// Copy rights (J1): only the owner's own conversation and its attachments (already enforced by the source
// adapter); deletion at either end never touches the other end's original. Unmounted, default-off candidate.
const { fail } = require('./source');
// Shadow accounts (决-9 / docs/02 §3): a student has only the edu account; the practice account is its shadow,
// auto-created by the SSO path with users.uuid_source='sso' (set once at creation, never editable; password login
// already refuses it; Identity-linked teacher accounts stay 'system'). Such an account can never start a handoff.
// 决-12 student mode additionally hangs on a mapped school student group (edu_school_id + cohort); those columns are
// not in the schema yet, so a caller may inject a stricter predicate; the default never excludes less than this.
const shadowAccount = user => user.uuid_source === 'sso';
function createHandoffAuthority({ User, Message, Conversation, store, isStudentAccount = shadowAccount }) {
  if (!User || !Message || !Conversation || !store || typeof store.withOwnerLock !== 'function' || typeof isStudentAccount !== 'function') fail('invalid_draft_configuration');
  async function account(owner) {
    if (!/^[1-9][0-9]{0,17}$/.test(String(owner))) fail('subject_disabled', 403);
    const user = await User.findById(Number(owner));
    if (!user || user.deleted_at || user.status !== 'active') fail('subject_disabled', 403);
    if (typeof user.isAccountExpired === 'function' ? user.isAccountExpired() : (user.expire_at && new Date(user.expire_at) < new Date())) fail('subject_disabled', 403);
    return user;
  }
  const authority = {
    async checkSubject(owner) {
      const user = await account(owner);
      if (shadowAccount(user) || await isStudentAccount(user)) fail('subject_not_eligible', 403);
    },
    // The selected message must belong to a conversation this account owns and still be readable.
    async checkExport(owner, messageId) {
      await authority.checkSubject(owner);
      const message = await Message.findById(messageId);
      const conversation = message && await Conversation.findById(message.conversation_id);
      if (!conversation || String(conversation.user_id) !== String(owner)) fail('source_permission_revoked', 403);
      if (conversation.cleared_at && new Date(message.created_at) <= new Date(conversation.cleared_at)) fail('source_permission_revoked', 403);
    },
    // Release and source-fact checks serialize on the owner's ledger anchor; business mutation paths take the same lock.
    withSourceLock(owner, messageId, fn) { return store.withOwnerLock(String(owner), fn); },
    // Reconciliation closure is an operator action: an active super_admin, never the owner's own session.
    async checkReconciler(actor) {
      const user = await account(actor);
      if (user.role !== 'super_admin') fail('subject_not_eligible', 403);
    }
  };
  return authority;
}
module.exports = { createHandoffAuthority };

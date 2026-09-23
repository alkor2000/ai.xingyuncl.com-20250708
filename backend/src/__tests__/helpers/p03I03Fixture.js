// Explicit synthetic teacher/copy policy and source mutation lock. No role inference.
const path = require('path');
const { fixture, ids } = require('./p03Fixture');
const { fail } = require('../../services/artifactHandoff/source');
const { DraftStore } = require('../../services/artifactHandoff/store');
const { I03DraftSource } = require('../../services/artifactHandoff/i03Source');
async function i03Fixture(directory, client, now = Date.now, owner = 'p-teacher', options = {}) {
  const f = await fixture(directory, now);
  f.conversations[ids.conversation].user_id = owner;
  Object.values(f.files).forEach(file => { file.user_id = owner; });
  const policy = { active: true, eligible: true, copy: true };
  let tail = Promise.resolve();
  const authority = {
    async checkSubject(who) {
      if (String(who) !== owner || !policy.active) fail('subject_disabled', 403);
      if (!policy.eligible) fail('subject_not_eligible', 403);
    },
    async checkExport(who, id) {
      await authority.checkSubject(who);
      if (!policy.copy || id !== ids.message) fail('source_permission_revoked', 403);
    },
    async withSourceLock(who, id, fn) {
      const task = tail.catch(() => {}).then(fn); tail = task;
      return task;
    },
    // Reconciliation is an operator action, never the teacher's own session.
    async checkReconciler(actor) { if (actor !== 'ops-reconciler') fail('subject_not_eligible', 403); }
  };
  const store = new DraftStore(path.join(directory, 'i03-source'), now);
  const service = new I03DraftSource({ source: f.source, store, authority, client, now, ...options,
    sourceInstance: 'practice-synthetic', targetInstance: 'tedna-synthetic', env: { NODE_ENV: 'test' } });
  async function selection() {
    const current = await f.source.load(owner, ids.message), file = await f.source.attachment(owner, ids.file);
    const start = current.text.indexOf('先观察'), end = start + '先观察，再记录两杯水的变化。'.length;
    return { schema_version: 1, message_id: ids.message, expected_version: current.version,
      selection: { start, end }, attachments: [{ source_id: ids.file, expected_version: file.version }], purpose: 'lesson_preparation' };
  }
  return { ...f, owner, policy, authority, store, service, selection,
    mutateSource: fn => authority.withSourceLock(owner, ids.message, fn) };
}
module.exports = { i03Fixture };

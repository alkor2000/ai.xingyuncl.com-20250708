'use strict';

// The editor's own write paths call this after a successful save/create/delete. It is a no-op unless the
// default-off P09 runtime is enabled and the project is actually associated with a teaching task, and it
// never fails a save: a P09 problem is logged and swallowed, because the student's work comes first.
//
// Two phases on purpose:
//   1. awaited — write the durable facts (this work has changed; a student really saved content). One
//      small UPDATE inside the request that saved, so a crash, a restart or a ledger outage immediately
//      afterwards leaves a pending marker rather than a projection that is stale forever.
//   2. not awaited — reconcile the projection and append the event. Safe to lose: the marker, and the
//      periodic sweep that reads it, will do it again.
// `contentSave` is decided by the controller from what the authenticated request actually wrote, never
// from a claim in the request body: the editor only ever writes student content through the page-update
// path, so page creation (including the starter page it makes by itself) is never counted as a save.
async function noteWebsiteArtifactChange(req, { projectId, deleted = false, contentSave = false }) {
  try {
    const runtime = req?.app?.locals?.p09Website;
    if (!runtime || runtime.enabled !== true || !req.user?.id || !projectId) return;
    const marked = await runtime.service.recordSourceWrite({ ownerUserId: req.user.id, projectId, deleted, contentSave });
    for (const id of marked.link_ids) {
      Promise.resolve(runtime.service.reconcileLink(id, { deleted })).catch(error => logWarn(error));
    }
  } catch (error) { logWarn(error); }
}
function logWarn(error) {
  try { require('../../utils/logger').warn('P09 source change note failed', { code: error?.code || 'unknown' }); }
  catch { /* logging must never break a save either */ }
}
module.exports = { noteWebsiteArtifactChange };

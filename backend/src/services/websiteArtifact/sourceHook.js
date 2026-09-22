'use strict';

// The editor's own write paths call this after a successful save/create/delete. It is a no-op unless the
// default-off P09 runtime is enabled and the project is actually associated with a teaching task, and it
// never fails a save: a P09 problem is logged and swallowed, because the student's work comes first.
function noteWebsiteArtifactChange(req, { projectId, deleted = false }) {
  try {
    const runtime = req?.app?.locals?.p09Website;
    if (!runtime || runtime.enabled !== true || !req.user?.id || !projectId) return;
    Promise.resolve(runtime.service.noteSourceChange({ ownerUserId: req.user.id, projectId, deleted }))
      .catch(error => logWarn(error));
  } catch (error) { logWarn(error); }
}
function logWarn(error) {
  try { require('../../utils/logger').warn('P09 source change note failed', { code: error?.code || 'unknown' }); }
  catch { /* logging must never break a save either */ }
}
module.exports = { noteWebsiteArtifactChange };

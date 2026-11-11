/** Compatible application rollback: keep these modules unavailable until a reviewed fix.
 * No runtime switch, DB dependency or schema down can accidentally reopen legacy links.
 */
module.exports = function sharedWorkRollbackGate(req, res, next) {
  let pathname;
  try { pathname = decodeURIComponent(req.path).replace(/\/{2,}/g, '/').toLowerCase(); }
  catch { return res.status(400).end(); }
  const prefixes = ['/pages', '/shared-pages', '/api/shared-works', '/api/html-editor', '/api/mindmap'];
  if (prefixes.some(prefix => pathname === prefix || pathname.startsWith(prefix + '/'))) {
    return res.status(503).set({ 'Cache-Control': 'private, no-store', 'Retry-After': '3600' })
      .json({ success: false, code: 'SHARED_WORK_MAINTENANCE', message: '网页与思维导图暂时维护，请稍后再试' });
  }
  next();
};

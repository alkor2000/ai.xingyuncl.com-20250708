const router = require('express').Router();
const safety = require('../services/videoSafetyService');
const { scope } = require('../services/galleryReviewService');
const handle = fn => async (req, res) => {
  try { await fn(req, res); }
  catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.statusCode ? e.message : '视频审核操作失败，请稍后重试' }); }
};
const ok = (res, data) => res.json({ success: true, data });
const send = (res, file) => res.sendFile(file, { acceptRanges: true, lastModified: false, cacheControl: false,
  headers: { 'Content-Type': 'video/mp4', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
router.get('/generation/:id/asset', handle(async (req, res) => send(res, await safety.asset(req.params.id, req.user))));
router.post('/generation/:id/report', require('express-rate-limit')({ windowMs: 60000, max: 20, keyGenerator: req => String(req.user.id), standardHeaders: true, legacyHeaders: false }), handle(async (req, res) => {
  ok(res, await require('../services/galleryModerationService').report('video', req.params.id, req.user, req.body));
}));
router.use('/gallery-review', (req, res, next) => { try { scope(req.user); next(); } catch { res.status(403).json({ success: false, message: '仅审核老师可以操作' }); } });
router.use('/gallery-review', require('express-rate-limit')({ windowMs: 60000, max: 60, keyGenerator: req => String(req.user.id), standardHeaders: true, legacyHeaders: false }));
router.get('/gallery-review', handle(async (req, res) => {
  const state = ['pending','approved','rejected','removed','reported'].includes(req.query.state) ? req.query.state : 'pending';
  const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page) || 1));
  ok(res, await require('../services/galleryReviewQueueService').list('video',req.user,{...req.query,state,page}));
}));
router.get('/gallery-review/selection',handle(async(req,res)=>ok(res,await require('../services/galleryReviewQueueService').selection('video',req.user,req.query))));
router.get('/gallery-review/groups',handle(async(req,res)=>ok(res,await require('../services/galleryReviewQueueService').groups(req.user))));
router.post('/gallery-review/batch',handle(async(req,res)=>ok(res,await require('../services/galleryReviewQueueService').batch('video',req.user,req.body))));
router.post('/gallery-review/:id/recheck',handle(async(req,res)=>ok(res,await require('../services/galleryReviewQueueService').recheck('video',req.params.id,req.user))));
router.get('/gallery-review/:id/asset', handle(async (req, res) => send(res, await safety.asset(req.params.id, req.user, true))));
router.get('/gallery-review/:id/events', handle(async (req, res) => {
  ok(res, await require('../services/galleryModerationService').history('video', req.params.id, req.user));
}));
router.post('/gallery-review/:id/visibility', handle(async (req, res) => {
  ok(res, await require('../services/galleryModerationService').visibility('video', req.params.id, req.user, req.body));
}));
router.post('/gallery-review/:id/import', handle(async (req, res) => {
  await safety.authorize(req.params.id, req.user);
  ok(res, await require('../services/videoSafetyLegacy').importVideo(req.params.id, req.user.id));
}));
router.post('/gallery-review/:id/decision', handle(async (req, res) => {
  ok(res, await safety.decide(req.params.id, req.user, req.body.state, req.body.reason, req.body.revision, {mapReview:req.body.mapReview}));
}));
module.exports = router;

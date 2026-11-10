const router = require('express').Router();
const review = require('../services/galleryReviewService');
const safety = require('../services/imageSafetyService');
const limited = require('express-rate-limit')({ windowMs: 60000, max: 60, keyGenerator: req => String(req.user.id), standardHeaders: true, legacyHeaders: false });
const handle = fn => async (req, res) => {
  try { review.scope(req.user); await fn(req, res); }
  catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.statusCode ? e.message : '审核操作失败，请稍后重试' }); }
};
const ok = (res, data) => res.json({ success: true, data });
router.use(limited);
router.get('/', handle(async (req, res) => {
  const state = ['pending', 'approved', 'rejected', 'removed', 'reported'].includes(req.query.state) ? req.query.state : 'pending';
  const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page) || 1));
  ok(res, await require('../services/galleryReviewQueueService').list('image', req.user, { ...req.query, state, page }));
}));
router.get('/selection',handle(async(req,res)=>ok(res,await require('../services/galleryReviewQueueService').selection('image',req.user,req.query))));
router.get('/groups', handle(async (req,res) => ok(res,await require('../services/galleryReviewQueueService').groups(req.user))));
router.post('/batch', handle(async (req,res) => ok(res,await require('../services/galleryReviewQueueService').batch('image',req.user,req.body))));
router.post('/:id/recheck', handle(async (req,res) => ok(res,await require('../services/galleryReviewQueueService').recheck('image',req.params.id,req.user))));
router.get('/:id/asset', handle(async (req, res) => {
  const bytes = await safety.asset(req.params.id, req.user, false, 'teacher');
  res.set({ 'Cache-Control': 'private, no-store', 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff' }).send(bytes);
}));
router.get('/:id/events', handle(async (req, res) => {
  ok(res, await require('../services/galleryModerationService').history('image', req.params.id, req.user));
}));
router.post('/:id/visibility', handle(async (req, res) => {
  ok(res, await require('../services/galleryModerationService').visibility('image', req.params.id, req.user, req.body));
}));
router.post('/:id/import', handle(async (req, res) => {
  await review.authorize(req.params.id, req.user);
  ok(res, await require('../services/imageSafetyLegacy').importImage(req.params.id, req.user.id));
}));
router.post('/:id/decision', handle(async (req, res) => {
  ok(res, await review.decide(req.params.id, req.user, req.body.state, req.body.reason, req.body.revision, {mapReview:req.body.mapReview}));
}));
module.exports = router;

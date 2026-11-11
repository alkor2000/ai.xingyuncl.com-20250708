const router = require('express').Router();
const { authenticate } = require('../middleware/authMiddleware');
const service = require('../services/sharedWorkService');
const HtmlPage = require('../models/HtmlPage');
const handle = fn => async (req, res) => {
  try { res.json({ success: true, data: await fn(req) }); }
  catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.statusCode ? e.message : '操作失败，请稍后重试' }); }
};
router.use((req,res,next) => { res.set('Cache-Control','private, no-store'); next(); });
router.use(authenticate);
router.use(require('express-rate-limit')({ windowMs:60000, max:120, keyGenerator:req=>String(req.user.id), standardHeaders:true, legacyHeaders:false }));
router.get('/', handle(req => service.list(req.user, req.query)));
router.get('/groups', handle(req => require('../services/galleryReviewQueueService').groups(req.user)));
router.get('/html/:userId/:slug/content', handle(async req => {
  const page = await HtmlPage.findBySlug(req.params.userId, req.params.slug);
  if (!page) throw Object.assign(new Error('作品已撤回或不存在'), { statusCode:404 });
  return { id:page.id, title:page.title, content:page.compiled_content };
}));
router.post('/:kind/:id/withdraw', handle(req => service.withdraw(req.params.kind, req.params.id, req.user, req.body.revision)));
router.post('/:kind/:id/report', handle(req => service.report(req.params.kind, req.params.id, req.user, req.body.reason)));
router.get('/:kind/:id/reports', handle(req => service.reports(req.params.kind, req.params.id, req.user)));
router.post('/:kind/:id/resolve', handle(req => service.resolve(req.params.kind, req.params.id, req.user)));
module.exports = router;

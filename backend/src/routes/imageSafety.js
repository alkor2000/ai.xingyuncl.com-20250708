const express = require('express');
const router = express.Router();
const db = require('../database/connection');
const safety = require('../services/imageSafetyService');
const provider = require('../services/imageCensorProvider');
const { requireSuperAdmin } = require('../middleware/permissions/superAdminMiddleware');
const rateLimit = require('express-rate-limit');
const handle = fn => async (req, res) => {
  try { await fn(req, res); }
  catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.statusCode ? e.message : '内容审核操作失败，请稍后重试' }); }
};
const ok = (res, data) => res.json({ success: true, data });
const limited = rateLimit({ windowMs: 60000, max: 20, keyGenerator: req => String(req.user.id), standardHeaders: true, legacyHeaders: false });

router.get('/generation/:id/asset', handle(async (req, res) => {
  const buffer = await safety.asset(req.params.id, req.user, req.query.thumbnail === '1');
  res.set({ 'Cache-Control': 'private, no-store', 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff' }).send(buffer);
}));
router.get('/reference/:id', handle(async (req, res) => {
  const buffer = await safety.reference(req.params.id, req.user.id);
  res.set({ 'Cache-Control': 'private, no-store', 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff' }).send(buffer);
}));
router.post('/generation/:id/report', limited, handle(async (req, res) => {
  const reason = req.body.reason;
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) throw safety.error('请填写举报原因（最多500字）', 400);
  await db.transaction(async query => {
    const { rows } = await query('SELECT id FROM image_generations WHERE id=? AND is_public=1 FOR UPDATE', [req.params.id]);
    if (!rows.length) throw safety.error('记录不存在', 404);
    await query('INSERT IGNORE INTO image_safety_reports (generation_id,user_id,reason) VALUES (?,?,?)', [req.params.id, req.user.id, reason.trim()]);
    // Reports enter a human queue; accusations alone never restrict an account.
  });
  ok(res, { reported: true });
}));
router.use('/admin/moderation', requireSuperAdmin());
router.get('/admin/moderation', handle(async (req, res) => {
  const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page) || 1));
  const state = ['pending', 'pass', 'review', 'block', 'error', 'reported'].includes(req.query.state) ? req.query.state : 'pending';
  const where = state === 'reported' ? 'EXISTS (SELECT 1 FROM image_safety_reports r WHERE r.generation_id=ig.id)' : "COALESCE(s.state,'pending')=?";
  const params = state === 'reported' ? [] : [state];
  const { rows: count } = await db.query(`SELECT COUNT(*) total FROM image_generations ig LEFT JOIN image_safety s ON s.generation_id=ig.id WHERE ${where}`, params);
  const { rows } = await db.simpleQuery(`SELECT ig.id,ig.user_id,ig.prompt,ig.status,ig.is_public,ig.created_at,
    COALESCE(s.state,'pending') moderation_status,COALESCE(s.revision,0) revision,s.reason,s.file_key IS NOT NULL has_asset,
    EXISTS(SELECT 1 FROM image_safety_restrictions x WHERE x.user_id=ig.user_id AND x.restricted=1) restricted,
    (SELECT COUNT(*) FROM image_safety_reports r WHERE r.generation_id=ig.id) reports
    FROM image_generations ig LEFT JOIN image_safety s ON s.generation_id=ig.id WHERE ${where} ORDER BY ig.id DESC LIMIT 30 OFFSET ?`, [...params, (page - 1) * 30]);
  ok(res, { data: rows, total: count[0].total, page, providerConfigured: provider.configured() });
}));
router.get('/admin/moderation/:id/asset', handle(async (req, res) => {
  const buffer = await safety.asset(req.params.id, req.user, false, true);
  res.set({ 'Cache-Control': 'private, no-store', 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff' }).send(buffer);
}));
router.get('/admin/moderation/:id/events', handle(async (req, res) => {
  const { rows: events } = await db.query('SELECT id,actor_id,action,state,reason,created_at FROM image_safety_events WHERE generation_id=? ORDER BY id DESC LIMIT 100', [req.params.id]);
  const { rows: reports } = await db.query('SELECT user_id,reason,created_at FROM image_safety_reports WHERE generation_id=? ORDER BY id DESC LIMIT 100', [req.params.id]);
  ok(res, { events, reports });
}));
router.post('/admin/moderation/:id/decision', limited, handle(async (req, res) => {
  await safety.decide(req.params.id, req.user.id, req.body.state, req.body.reason, req.body.revision);
  ok(res, await safety.get(req.params.id));
}));
router.post('/admin/moderation/:id/import', limited, handle(async (req, res) => {
  await require('../services/imageSafetyLegacy').importImage(req.params.id, req.user.id);
  ok(res, await safety.get(req.params.id));
}));
router.post('/admin/moderation/:id/recheck', limited, handle(async (req, res) => {
  const current = await safety.get(req.params.id);
  if (!current.file_key) throw safety.error('请先转入受限存储', 409);
  if (current.state === 'block') throw safety.error('已下架内容须由管理员人工复核', 409);
  const { rows } = await db.query('SELECT prompt,negative_prompt FROM image_generations WHERE id=?', [req.params.id]);
  if (!rows.length) throw safety.error('记录不存在', 404);
  const textResult = await provider.text(`${rows[0].prompt}\n${rows[0].negative_prompt || ''}`);
  const result = textResult.state === 'pass' ? await provider.image(await safety.asset(req.params.id, req.user, false, true)) : textResult;
  if (result.state === 'error') throw safety.error('审核服务暂不可用，内容保持隔离', 503);
  await safety.decide(req.params.id, req.user.id, result.state, `provider_recheck:${result.reason}`, current.revision);
  ok(res, await safety.get(req.params.id));
}));
router.post('/admin/moderation/users/:id/restriction', limited, handle(async (req, res) => {
  const { restricted, reason } = req.body;
  if (typeof restricted !== 'boolean' || typeof reason !== 'string' || !reason.trim() || reason.length > 500) throw safety.error('请填写账号处置原因', 400);
  await db.transaction(async query => {
    await query('INSERT INTO image_safety_restrictions (user_id,restricted,reason,actor_id) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE restricted=VALUES(restricted),reason=VALUES(reason),actor_id=VALUES(actor_id),updated_at=NOW()', [req.params.id, restricted, reason, req.user.id]);
    if (restricted) await query('UPDATE image_generations SET is_public=0 WHERE user_id=?', [req.params.id]);
    await safety.event(query, null, req.user.id, 'account_restriction', restricted ? 'block' : 'pass', `user:${req.params.id} ${reason}`.slice(0, 500));
  });
  ok(res, { restricted });
}));
module.exports = router;

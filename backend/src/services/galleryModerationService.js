const db = require('../database/connection');
const imageSafety = require('./imageSafetyService');
const error = imageSafety.error;
const categories = Object.freeze(['sexual','violence','disgust','discrimination','political','minors','map','other']);
const types = Object.freeze({
  image: { success: 'success', reviewer: 'gallery_reviewer_id', reviewed: 'gallery_reviewed_at' },
  video: { success: 'succeeded', reviewer: 'reviewer_id', reviewed: 'reviewed_at' }
});
function type(media) { if (!Object.hasOwn(types, media)) throw error('作品类型不正确', 400); return types[media]; }
function idOf(value) { const id = Number(value); if (!Number.isSafeInteger(id) || id < 1 || !/^\d+$/.test(String(value))) throw error('作品编号不正确', 400); return id; }
function threshold() {
  const value = process.env.GALLERY_REPORT_THRESHOLD || '3';
  if (!/^\d+$/.test(value) || Number(value) < 2 || Number(value) > 100) throw error('举报阈值配置无效，请联系管理员', 503);
  return Number(value);
}
const authorize = (media, ...args) => media === 'image' ? require('./galleryReviewService').authorize(...args) : require('./videoSafetyService').authorize(...args);
const audit = (media, ...args) => media === 'image' ? imageSafety.event(...args) : require('./videoSafetyService').event(...args);
async function report(media, value, user, body = {}) {
  const cfg = type(media), id = idOf(value), n = threshold();
  const category = body.category === undefined ? 'other' : body.category;
  if (!categories.includes(category) || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 500) throw error('请选择举报类别并填写原因（最多500字）', 400);
  return db.transaction(async query => {
    // Same lock order as every publish/review path. A reporter never writes an account restriction.
    const { rows: works } = await query(`SELECT id,user_id,status,is_public FROM ${media}_generations WHERE id=? FOR UPDATE`, [id]);
    const work = works[0];
    if (!work || !Number(work.is_public) || work.status !== cfg.success || Number(work.user_id) === Number(user.id)) throw error('作品不可举报', 404);
    const { rows: decisions } = await query(`SELECT * FROM ${media}_safety WHERE generation_id=? FOR UPDATE`, [id]);
    const current = decisions[0];
    if (!current || current.state !== 'pass' || current.gallery_state !== 'approved' || !current.file_key || !current[cfg.reviewer] || Number(current[cfg.reviewer]) === Number(work.user_id)) throw error('作品不可举报', 404);
    const { rows: inserted } = await query(`INSERT IGNORE INTO ${media}_safety_reports (generation_id,user_id,category,reason) VALUES (?,?,?,?)`, [id, user.id, category, body.reason.trim()]);
    const { rows: counts } = await query(`SELECT COUNT(*) total FROM ${media}_safety_reports WHERE generation_id=? AND resolved_at IS NULL`, [id]);
    const hidden = Number(counts[0].total) >= n;
    if (inserted.affectedRows) await audit(media, query, id, user.id, 'gallery_report', 'reported', category, current.sha256);
    if (hidden) {
      await query(`UPDATE ${media}_safety SET gallery_state='reported',gallery_reason=?,revision=revision+1,updated_at=NOW() WHERE generation_id=?`, ['收到多位用户举报，已暂时隐藏，等待管理员复核', id]);
      await query(`UPDATE ${media}_generations SET is_public=0,gallery_approved_by=NULL WHERE id=?`, [id]);
      await audit(media, query, id, null, 'gallery_report_hold', 'reported', `distinct_reports:${counts[0].total};threshold:${n}`, current.sha256);
    }
    return { reported: true, duplicate: !inserted.affectedRows, temporarily_hidden: hidden };
  });
}
async function visibility(media, value, user, body = {}) {
  const cfg = type(media), id = idOf(value);
  if (!['down','restore'].includes(body.action) || !Number.isSafeInteger(body.revision) || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 500) throw error('请填写操作原因并刷新记录版本', 400);
  if (body.action === 'restore' && body.reviewed !== true) throw error('请完整复核作品后再恢复', 400);
  return db.transaction(async query => {
    const work = await authorize(media, id, user, query, true);
    const { rows } = await query(`SELECT * FROM ${media}_safety WHERE generation_id=? FOR UPDATE`, [id]);
    const current = rows[0];
    if (!current || current.revision !== body.revision) throw error('作品已变更，请刷新后处理', 409);
    const restoring = body.action === 'restore';
    if (restoring ? !['removed','reported'].includes(current.gallery_state) : current.gallery_state !== 'approved') throw error('当前状态不能执行此操作，请刷新', 409);
    if (restoring) {
      const machineResult=await require('./galleryMachineReviewService').assertEligible(query,media,id,current);
      await require('./galleryMachineReviewService').recordMapReview(query,media,id,current,machineResult,body,user.id);
      if (work.status !== cfg.success || current.state !== 'pass' || !current.file_key || !current.sha256) throw error('作品未通过安全审核或缺少受限文件，不能恢复', 409);
      const { rows: limits } = await query('SELECT restricted FROM image_safety_restrictions WHERE user_id=? FOR UPDATE', [work.user_id]);
      const { rows: blocked } = await query(`SELECT generation_id FROM ${media}_safety WHERE sha256=? AND state='block' LIMIT 1`, [current.sha256]);
      if (limits[0]?.restricted || blocked.length) throw error('账号或相同内容仍被限制，不能恢复', 409);
      if (media === 'image') await imageSafety.asset(id, user, false, 'teacher');
      else await require('./privateVideoStore').verify(current.file_key, current.sha256).catch(() => { throw error('视频文件不可用或校验失败', 409); });
    }
    const state = restoring ? 'approved' : 'removed';
    await query(`UPDATE ${media}_safety SET gallery_state=?,gallery_reason=?,${cfg.reviewer}=?,${cfg.reviewed}=NOW(),revision=revision+1,updated_at=NOW() WHERE generation_id=?`, [state, body.reason.trim(), user.id, id]);
    await query(`UPDATE ${media}_generations SET is_public=?,gallery_approved_by=? WHERE id=?`, [restoring ? 1 : 0, restoring ? user.id : null, id]);
    if (restoring) await query(`UPDATE ${media}_safety_reports SET resolved_at=NOW() WHERE generation_id=? AND resolved_at IS NULL`, [id]);
    await audit(media, query, id, user.id, restoring ? 'gallery_restore' : 'gallery_takedown', state, body.reason.trim(), current.sha256);
    return { is_public: restoring ? 1 : 0, gallery_status: state, revision: current.revision + 1 };
  });
}
async function history(media, value, user) {
  type(media); const id = idOf(value); await authorize(media, id, user);
  const { rows: events } = await db.query(`SELECT CASE WHEN action='gallery_report' THEN NULL ELSE actor_id END actor_id,action,state,reason,created_at FROM ${media}_safety_events WHERE generation_id=? ORDER BY id DESC LIMIT 100`, [id]);
  // Reporters' identity is unnecessary for reviewing the content.
  const { rows: reports } = await db.query(`SELECT category,reason,created_at,resolved_at FROM ${media}_safety_reports WHERE generation_id=? ORDER BY id DESC LIMIT 100`, [id]);
  return { events, reports, threshold: threshold() };
}
module.exports = { report, visibility, history, categories, threshold, idOf };

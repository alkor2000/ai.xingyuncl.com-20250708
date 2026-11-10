const db = require('../database/connection');
const safety = require('./imageSafetyService');

function scope(user, alias = 'u') {
  if (user.role === 'super_admin') return { sql: '1=1', params: [] };
  if (user.role === 'admin' && user.group_id) return { sql: `${alias}.group_id=? AND ${alias}.role='user'`, params: [user.group_id] };
  throw safety.error('仅审核老师可以操作', 403);
}
async function authorize(id, user, query = db.query.bind(db), lock = false) {
  const s = scope(user);
  const { rows } = await query(`SELECT ig.id,ig.user_id,ig.status FROM image_generations ig
    JOIN users u ON u.id=ig.user_id WHERE ig.id=? AND ${s.sql}${lock ? ' FOR UPDATE' : ''}`, [id, ...s.params]);
  if (!rows.length) throw safety.error('作品不存在或不在审核范围内', 404);
  if (Number(rows[0].user_id) === Number(user.id)) throw safety.error('不能审核自己的作品，请交由其他老师审核', 403);
  return rows[0];
}
async function list(user, state, page) {
  const s = scope(user);
  const reported = state === 'reported';
  const filter = reported ? "(s.gallery_state='reported' OR (s.gallery_state='approved' AND EXISTS (SELECT 1 FROM image_safety_reports r WHERE r.generation_id=s.generation_id AND r.resolved_at IS NULL)))" : 's.gallery_state=?';
  const where = `${s.sql} AND ig.user_id<>? AND ${filter}`;
  const params = [...s.params, user.id, ...(reported ? [] : [state])];
  const from = 'FROM image_generations ig JOIN users u ON u.id=ig.user_id JOIN image_safety s ON s.generation_id=ig.id';
  const { rows: count } = await db.query(`SELECT COUNT(*) total ${from} WHERE ${where}`, params);
  const { rows } = await db.simpleQuery(`SELECT ig.id,ig.user_id,u.username,ig.prompt,ig.negative_prompt,
    s.state moderation_status,s.gallery_state,s.revision,s.gallery_reason,(SELECT COUNT(*) FROM image_safety_reports r WHERE r.generation_id=s.generation_id AND r.resolved_at IS NULL) reports,s.file_key IS NOT NULL has_asset,
    s.gallery_requested_at,s.gallery_reviewer_id,s.gallery_reviewed_at
    ${from} WHERE ${where} ORDER BY s.gallery_requested_at,ig.id LIMIT 30 OFFSET ?`, [...params, (page - 1) * 30]);
  return { data: rows, total: count[0].total, page };
}
async function decide(id, user, state, reason, revision) {
  if (!['approved', 'rejected'].includes(state) || typeof reason !== 'string' || !reason.trim() || reason.length > 500 || !Number.isSafeInteger(revision)) throw safety.error('请填写审核结论、理由并刷新版本', 400);
  return db.transaction(async query => {
    const generation = await authorize(id, user, query, true);
    const { rows } = await query('SELECT * FROM image_safety WHERE generation_id=? FOR UPDATE', [id]);
    const current = rows[0];
    if (!current || current.revision !== revision) throw safety.error('作品已变更，请刷新后重新审核', 409);
    if (current.gallery_state !== 'pending' && !(['approved','removed','reported'].includes(current.gallery_state) && state === 'rejected')) throw safety.error('作品已撤回或已审核，请刷新', 409);
    const approved = state === 'approved';
    if (approved) {
      if (!current.file_key || !current.sha256 || generation.status !== 'success') throw safety.error('请先导入并检查完整图片', 409);
      const { rows: limits } = await query('SELECT restricted FROM image_safety_restrictions WHERE user_id=? FOR UPDATE', [generation.user_id]);
      const { rows: blocked } = await query("SELECT generation_id FROM image_safety WHERE sha256=? AND state='block' LIMIT 1", [current.sha256]);
      if (limits[0]?.restricted || current.state === 'block' || blocked.length) throw safety.error('已拦截的作品须先由超级管理员复核，不能公开', 409);
      // Human review is explicit even when the machine service is unavailable.
      // Verify the actual reviewed bytes still exist and match the immutable hash.
      await safety.asset(id, user, false, 'teacher');
    }
    await query(`UPDATE image_safety SET gallery_state=?,gallery_reviewer_id=?,gallery_reviewed_at=NOW(),
      state=?,reason=?,gallery_reason=?,revision=revision+1,updated_at=NOW() WHERE generation_id=?`,
    [state, user.id, approved ? 'pass' : 'block', approved ? 'teacher_review' : 'teacher_rejected', reason.trim(), id]);
    await query('UPDATE image_generations SET is_public=?,gallery_approved_by=? WHERE id=?', [approved ? 1 : 0, approved ? user.id : null, id]);
    await safety.event(query, id, user.id, 'gallery_decision', state, reason.trim(), current.sha256);
    return { is_public: approved ? 1 : 0, gallery_status: state };
  });
}
module.exports = { scope, authorize, list, decide };

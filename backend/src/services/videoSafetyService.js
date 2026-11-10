const db = require('../database/connection');
const imageSafety = require('./imageSafetyService');
const { scope } = require('./galleryReviewService');
const store = require('./privateVideoStore');
const error = imageSafety.error;
const rawFields = ['video_url','thumbnail_path','preview_gif_path','last_frame_path','oss_video_url','oss_thumbnail_url','oss_gif_url'];
async function event(query, id, actor, action, state, reason, sha = null) {
  await query('INSERT INTO video_safety_events (generation_id,actor_id,action,state,reason,sha256) VALUES (?,?,?,?,?,?)', [id, actor, action, state, reason, sha]);
}
async function get(id) {
  const { rows } = await db.query('SELECT * FROM video_safety WHERE generation_id=?', [id]);
  return rows[0] || { state: 'pending', gallery_state: 'private', revision: 0 };
}
async function authorize(id, user, query = db.query.bind(db), lock = false) {
  const s = scope(user);
  const { rows } = await query(`SELECT vg.id,vg.user_id,vg.status FROM video_generations vg JOIN users u ON u.id=vg.user_id
    WHERE vg.id=? AND ${s.sql}${lock ? ' FOR UPDATE' : ''}`, [id, ...s.params]);
  if (!rows.length) throw error('视频不存在或不在审核范围内', 404);
  if (Number(rows[0].user_id) === Number(user.id)) throw error('不能审核自己的视频，请交由其他老师审核', 403);
  return rows[0];
}
async function capture(id, userId, artifact) {
  await db.transaction(async query => {
    const { rows } = await query('SELECT id FROM video_generations WHERE id=? AND user_id=? FOR UPDATE', [id, userId]);
    if (!rows.length) throw error('视频不存在', 404);
    const { rows: previous } = await query('SELECT * FROM video_safety WHERE generation_id=? FOR UPDATE', [id]);
    if (previous[0]?.file_key) {
      if (previous[0].sha256 !== artifact.sha) throw error('视频内容已锁定', 409);
      return;
    }
    const { rows: blocked } = await query("SELECT generation_id FROM video_safety WHERE sha256=? AND state='block' LIMIT 1", [artifact.sha]);
    const state = blocked.length ? 'block' : 'pending';
    await query(`INSERT INTO video_safety (generation_id,state,sha256,file_key,file_size,revision) VALUES (?,?,?,?,?,1)
      ON DUPLICATE KEY UPDATE state=IF(state='block','block',VALUES(state)),sha256=VALUES(sha256),file_key=VALUES(file_key),file_size=VALUES(file_size),revision=revision+1`, [id, state, artifact.sha, artifact.key, artifact.size]);
    await query('UPDATE video_generations SET is_public=0,gallery_approved_by=NULL WHERE id=?', [id]);
    await event(query, id, null, 'capture', state, 'full_video_teacher_review_required', artifact.sha);
  });
  return { localPath: `/api/video/generation/${id}/asset`, thumbnailPath: null, previewGifPath: null, fileSize: artifact.size };
}
async function fromUrl(url, id, userId) { return capture(id, userId, await store.fromUrl(url)); }
async function framesForProvider(userId, params) {
  const out = { ...params };
  for (const field of ['first_frame_image','last_frame_image']) {
    if (!params[field]) continue;
    const match = /^\/api\/image\/reference\/([a-f0-9-]{36})$/.exec(params[field]);
    if (!match) throw error('只允许使用本人上传且审核通过的参考帧', 400);
    const bytes = await imageSafety.reference(match[1], userId);
    const oss = require('./ossService'); await oss.initialize();
    if (oss.isLocal) throw error('参考帧的私有存储尚未配置', 503);
    const key = `video-frames/${userId}/reviewed/${imageSafety.hash(bytes)}.jpg`;
    await oss.client.put(key, bytes, { headers: { 'Content-Type': 'image/jpeg', 'x-oss-object-acl': 'private' } });
    // Short-lived provider-only URL; never persisted or returned to the client.
    out[field] = oss.client.signatureUrl(key, { expires: 3600 });
  }
  return out;
}
async function project(value) {
  if (Array.isArray(value)) return Promise.all(value.map(project));
  if (!value || typeof value !== 'object') return value;
  const out = { ...value };
  if (out.id && ('local_path' in out || 'video_url' in out)) {
    const current = await get(out.id);
    out.gallery_reason = current.gallery_state === 'approved' ? null : current.gallery_reason || null;
    out.moderation_status = current.state; out.gallery_status = current.gallery_state; out.moderation_revision = current.revision;
    out.local_path = current.state === 'pass' && current.file_key ? `/api/video/generation/${out.id}/asset` : null;
    for (const key of rawFields) out[key] = null;
    for (const key of ['raw_response','first_frame_image','last_frame_image','reference_images','email']) delete out[key];
  }
  if (out.data) out.data = await project(out.data);
  return out;
}
async function publish(id, userId) {
  return db.transaction(async query => {
    const { rows } = await query('SELECT id,status,is_public FROM video_generations WHERE id=? AND user_id=? FOR UPDATE', [id, userId]);
    if (!rows.length) throw error('视频不存在', 404);
    await query('INSERT IGNORE INTO video_safety (generation_id) VALUES (?)', [id]);
    const { rows: states } = await query('SELECT * FROM video_safety WHERE generation_id=? FOR UPDATE', [id]);
    const current = states[0], cancel = rows[0].is_public || current.gallery_state === 'pending';
    if (['removed', 'reported'].includes(current.gallery_state)) throw error('作品已暂时下架，须由管理员复核后恢复', 409);
    if (!cancel) {
      const { rows: limits } = await query('SELECT restricted FROM image_safety_restrictions WHERE user_id=? FOR UPDATE', [userId]);
      if (rows[0].status !== 'succeeded' || current.state === 'block' || limits[0]?.restricted) throw error('视频未通过安全审核，不能提交公开申请');
    }
    const state = cancel ? 'private' : 'pending';
    await query('UPDATE video_safety SET gallery_state=?,reviewer_id=NULL,reviewed_at=NULL,requested_at=?,revision=revision+1 WHERE generation_id=?', [state, cancel ? null : new Date(), id]);
    await query('UPDATE video_generations SET is_public=0,gallery_approved_by=NULL WHERE id=?', [id]);
    await event(query, id, userId, cancel ? 'gallery_withdraw' : 'gallery_submit', state, 'owner_request');
    return { is_public: 0, gallery_status: state };
  });
}
async function asset(id, user, review = false) {
  const { rows } = await db.query('SELECT vg.user_id,vg.is_public,vg.status generation_status,s.* FROM video_generations vg JOIN video_safety s ON s.generation_id=vg.id WHERE vg.id=?', [id]);
  const row = rows[0];
  if (review) await authorize(id, user);
  if (!row || (!review && (row.generation_status !== 'succeeded' || row.state !== 'pass' || (Number(row.user_id) !== Number(user.id) && (!row.is_public || row.gallery_state !== 'approved' || !row.reviewer_id || Number(row.reviewer_id) === Number(row.user_id)))))) throw error('视频不可访问', 404);
  const file = await store.verify(row.file_key, row.sha256).catch(() => { throw error('视频文件不可用或校验失败', 409); });
  if (review) await event(db.query.bind(db), id, user.id, 'review_view', row.state, 'restricted_full_video_preview', row.sha256);
  return file;
}
async function decide(id, user, state, reason, revision) {
  if (!['approved','rejected'].includes(state) || typeof reason !== 'string' || !reason.trim() || reason.length > 500 || !Number.isSafeInteger(revision)) throw error('请填写审核结论、理由并刷新版本', 400);
  return db.transaction(async query => {
    const generation = await authorize(id, user, query, true);
    const { rows } = await query('SELECT * FROM video_safety WHERE generation_id=? FOR UPDATE', [id]);
    const current = rows[0], approved = state === 'approved';
    if (!current || current.revision !== revision) throw error('视频已变更，请刷新后重新审核', 409);
    if (current.gallery_state !== 'pending' && !(['approved','removed','reported'].includes(current.gallery_state) && !approved)) throw error('视频已撤回或已审核', 409);
    if (approved) {
      if (!current.file_key || generation.status !== 'succeeded') throw error('请先导入并完整检查视频', 409);
      const { rows: limits } = await query('SELECT restricted FROM image_safety_restrictions WHERE user_id=? FOR UPDATE', [generation.user_id]);
      const { rows: blocked } = await query("SELECT generation_id FROM video_safety WHERE sha256=? AND state='block' LIMIT 1", [current.sha256]);
      if (limits[0]?.restricted || current.state === 'block' || blocked.length) throw error('已拦截的视频不能公开', 409);
      await store.verify(current.file_key, current.sha256).catch(() => { throw error('视频校验失败', 409); });
    }
    await query('UPDATE video_safety SET state=?,gallery_state=?,reviewer_id=?,reviewed_at=NOW(),gallery_reason=?,revision=revision+1,updated_at=NOW() WHERE generation_id=?', [approved ? 'pass' : 'block', state, user.id, reason.trim(), id]);
    await query('UPDATE video_generations SET is_public=?,gallery_approved_by=? WHERE id=?', [approved ? 1 : 0, approved ? user.id : null, id]);
    await event(query, id, user.id, 'gallery_decision', state, reason.trim(), current.sha256);
    return { is_public: approved ? 1 : 0, gallery_status: state };
  });
}
async function list(user, state, page) {
  const s = scope(user), reported = state === 'reported';
  const filter = reported ? "(s.gallery_state='reported' OR (s.gallery_state='approved' AND EXISTS (SELECT 1 FROM video_safety_reports r WHERE r.generation_id=s.generation_id AND r.resolved_at IS NULL)))" : 's.gallery_state=?';
  const params = [...s.params, user.id, ...(reported ? [] : [state])];
  const from = `FROM video_generations vg JOIN users u ON u.id=vg.user_id JOIN video_safety s ON s.generation_id=vg.id
    WHERE ${s.sql} AND vg.user_id<>? AND ${filter}`;
  const { rows: count } = await db.query(`SELECT COUNT(*) total ${from}`, params);
  const { rows } = await db.simpleQuery(`SELECT vg.id,vg.user_id,u.username,vg.prompt,vg.negative_prompt,s.state moderation_status,
    s.gallery_state,s.revision,s.gallery_reason,(SELECT COUNT(*) FROM video_safety_reports r WHERE r.generation_id=s.generation_id AND r.resolved_at IS NULL) reports,s.file_key IS NOT NULL has_asset,s.reviewer_id,s.reviewed_at ${from} ORDER BY s.requested_at,vg.id LIMIT 30 OFFSET ?`, [...params, (page - 1) * 30]);
  return { data: rows, total: count[0].total, page };
}
module.exports = { get, capture, fromUrl, framesForProvider, project, publish, authorize, asset, decide, list, event };

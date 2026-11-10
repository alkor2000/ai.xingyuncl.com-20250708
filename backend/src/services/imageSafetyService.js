const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const db = require('../database/connection');
const config = require('../config');
const provider = require('./imageCensorProvider');

const error = (message, code = 403) => Object.assign(new Error(message), { statusCode: code });
const root = () => path.join(config.storage.paths.uploads, '..', 'image-safety');
const hash = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const assetPath = key => {
  if (!/^[a-f0-9]{64}\.jpg$/.test(key || '')) throw error('图片文件不可用', 404);
  return path.join(root(), key);
};
async function event(query, id, actor, action, state, reason, sha = null) {
  await query('INSERT INTO image_safety_events (generation_id,actor_id,action,state,reason,sha256) VALUES (?,?,?,?,?,?)',
    [id, actor, action, state, reason, sha]);
}
async function get(id) {
  const { rows } = await db.query('SELECT * FROM image_safety WHERE generation_id=?', [id]);
  return rows[0] || { generation_id: id, state: 'pending', reason: 'awaiting_review', revision: 0 };
}
async function restricted(userId) {
  const { rows } = await db.query('SELECT restricted FROM image_safety_restrictions WHERE user_id=?', [userId]);
  return Boolean(rows[0]?.restricted);
}
async function assertUser(userId) {
  if (await restricted(userId)) throw error('此账号的图片生成和分享已暂停，请联系管理员');
}
async function checkPrompt(userId, prompt, negative = '') {
  await assertUser(userId);
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000 || typeof negative !== 'string' || negative.length > 4000) throw error('提示词格式或长度不正确', 400);
  const result = await provider.text(`${prompt}\n${negative}`);
  if (result.state !== 'pass') {
    await event(db.query.bind(db), null, userId, 'prompt', result.state, result.reason);
    throw error(result.state === 'error' ? '内容审核暂不可用，请稍后重试' : '提示词未通过内容审核，请修改后重试', result.state === 'error' ? 503 : 403);
  }
}
async function putImage(buffer) {
  const meta = await sharp(buffer, { limitInputPixels: 40000000 }).metadata();
  if ((meta.pages || 1) !== 1) throw error('暂不支持动态图片', 400);
  // Publish exactly the decoded, orientation-normalized pixels that are reviewed.
  const normalized = await sharp(buffer, { limitInputPixels: 40000000 }).rotate().jpeg({ quality: 95 }).toBuffer();
  const sha = hash(normalized), key = `${sha}.jpg`;
  await fs.mkdir(root(), { recursive: true, mode: 0o700 });
  await fs.writeFile(assetPath(key), normalized, { mode: 0o600, flag: 'wx' }).catch(e => { if (e.code !== 'EEXIST') throw e; });
  return { buffer: normalized, sha, key };
}
async function capture(id, userId, buffer) {
  const artifact = await putImage(buffer);
  const { rows: blocked } = await db.query("SELECT generation_id FROM image_safety WHERE sha256=? AND state='block' LIMIT 1", [artifact.sha]);
  const result = blocked.length ? { state: 'block', reason: 'blocked_fingerprint' } : await provider.image(artifact.buffer);
  await db.transaction(async query => {
    const { rows } = await query('SELECT id FROM image_generations WHERE id=? AND user_id=? FOR UPDATE', [id, userId]);
    if (!rows.length) throw error('记录不存在', 404);
    const { rows: previous } = await query('SELECT * FROM image_safety WHERE generation_id=? FOR UPDATE', [id]);
    if (previous[0]?.file_key) {
      // A duplicate poll/callback can never replace reviewed bytes or undo a takedown.
      if (previous[0].sha256 !== artifact.sha) throw error('图片结果已锁定', 409);
      return;
    }
    await query('INSERT INTO image_safety (generation_id,state,sha256,file_key,reason,revision) VALUES (?,?,?,?,?,1) ON DUPLICATE KEY UPDATE state=IF(state="pending" AND file_key IS NULL,VALUES(state),state),sha256=VALUES(sha256),file_key=VALUES(file_key),revision=revision+1',
      [id, result.state, artifact.sha, artifact.key, result.reason]);
    await query('UPDATE image_generations SET is_public=0,gallery_approved_by=NULL WHERE id=?', [id]);
    await event(query, id, null, 'output', result.state, result.reason, artifact.sha);
  });
  const decision = await get(id);
  return { localPath: `/api/image/generation/${id}/asset`, thumbnailPath: `/api/image/generation/${id}/asset?thumbnail=1`, fileSize: artifact.buffer.length, moderationStatus: decision.state };
}
async function project(value) {
  if (Array.isArray(value)) return Promise.all(value.map(project));
  if (!value || typeof value !== 'object') return value;
  const out = { ...value };
  // Only generation DTOs carry these image fields. Never emit original CDN URLs.
  if (out.id && ('local_path' in out || 'thumbnail_path' in out || 'image_url' in out)) {
    const safety = await get(out.id);
    out.moderation_status = safety.state;
    out.gallery_status = safety.gallery_state || 'private';
    out.gallery_reason = safety.gallery_state === 'approved' ? null : safety.gallery_reason || null;
    out.moderation_reason = safety.reason;
    out.local_path = safety.state === 'pass' && safety.file_key ? `/api/image/generation/${out.id}/asset` : null;
    out.thumbnail_path = out.local_path ? `${out.local_path}?thumbnail=1` : null;
    out.image_url = null;
    delete out.email;
    delete out.reference_images;
  }
  for (const key of ['data', 'results']) if (out[key]) out[key] = await project(out[key]);
  return out;
}
async function publish(id, userId) {
  return db.transaction(async query => {
    const { rows } = await query('SELECT id,is_public,status FROM image_generations WHERE id=? AND user_id=? FOR UPDATE', [id, userId]);
    if (!rows.length) throw error('记录不存在', 404);
    await query('INSERT IGNORE INTO image_safety (generation_id) VALUES (?)', [id]);
    const { rows: decisions } = await query('SELECT * FROM image_safety WHERE generation_id=? FOR UPDATE', [id]);
    const current = decisions[0];
    if (['removed', 'reported'].includes(current.gallery_state)) throw error('作品已暂时下架，须由管理员复核后恢复', 409);
    const cancel = rows[0].is_public || current.gallery_state === 'pending';
    if (!cancel) {
      const { rows: restriction } = await query('SELECT restricted FROM image_safety_restrictions WHERE user_id=? FOR UPDATE', [userId]);
      if (restriction[0]?.restricted || rows[0].status !== 'success' || current.state === 'block') throw error('图片未通过内容审核，不能提交公开申请');
    }
    const galleryState = cancel ? 'private' : 'pending';
    await query(`UPDATE image_safety SET gallery_state=?,gallery_reviewer_id=NULL,gallery_reviewed_at=NULL,
      gallery_requested_at=?,revision=revision+1,updated_at=NOW() WHERE generation_id=?`, [galleryState, cancel ? null : new Date(), id]);
    // A student request can never write is_public=1, including legacy clients.
    await query('UPDATE image_generations SET is_public=0,gallery_approved_by=NULL WHERE id=?', [id]);
    await event(query, id, userId, cancel ? 'gallery_withdraw' : 'gallery_submit', galleryState, 'owner_request');
    return { is_public: 0, gallery_status: galleryState };
  });
}
async function decide(id, actor, state, reason, revision) {
  if (!['pass', 'block', 'review'].includes(state) || typeof reason !== 'string' || !reason.trim() || reason.length > 500 || !Number.isSafeInteger(revision)) throw error('请填写审核结论、原因并刷新记录版本', 400);
  await db.transaction(async query => {
    const { rows } = await query('SELECT id,user_id FROM image_generations WHERE id=? FOR UPDATE', [id]);
    if (!rows.length) throw error('记录不存在', 404);
    await query('INSERT IGNORE INTO image_safety (generation_id) VALUES (?)', [id]);
    const { rows: current } = await query('SELECT * FROM image_safety WHERE generation_id=? FOR UPDATE', [id]);
    if (current[0].revision !== revision) throw error('内容已变更，请刷新后重新审核', 409);
    if (state === 'pass' && !current[0].file_key) throw error('请先将历史图片转入受限存储', 409);
    await query("UPDATE image_safety SET state=?,reason=?,gallery_state=IF(gallery_state='approved','pending',gallery_state),gallery_reviewer_id=NULL,gallery_reviewed_at=NULL,revision=revision+1,updated_at=NOW() WHERE generation_id=?", [state, 'manual_review', id]);
    await query('UPDATE image_generations SET is_public=0,gallery_approved_by=NULL WHERE id=?', [id]);
    await event(query, id, actor, 'decision', state, reason.trim(), current[0].sha256);
  });
}
async function asset(id, user, thumbnail = false, review = false) {
  const { rows } = await db.query('SELECT ig.user_id,ig.is_public,ig.status generation_status,s.* FROM image_generations ig JOIN image_safety s ON s.generation_id=ig.id WHERE ig.id=?', [id]);
  const row = rows[0];
  let admin = review === true && user.role === 'super_admin';
  if (review === 'teacher') {
    await require('./galleryReviewService').authorize(id, user);
    admin = true;
  }
  if (!row || (!admin && (row.generation_status !== 'success' || row.state !== 'pass' || (Number(row.user_id) !== Number(user.id) && (!row.is_public || row.gallery_state !== 'approved' || !row.gallery_reviewer_id || Number(row.gallery_reviewer_id) === Number(row.user_id)))))) throw error('图片不可访问', 404);
  const bytes = await fs.readFile(assetPath(row.file_key));
  if (hash(bytes) !== row.sha256) throw error('图片校验失败', 409);
  if (admin) await event(db.query.bind(db), id, user.id, 'review_view', row.state, 'restricted_preview', row.sha256);
  return thumbnail ? sharp(bytes).resize(400, 400, { fit: 'inside' }).jpeg().toBuffer() : bytes;
}
async function uploadReference(userId, buffer) {
  await assertUser(userId);
  const artifact = await putImage(buffer);
  const { rows: blocked } = await db.query("SELECT generation_id FROM image_safety WHERE sha256=? AND state='block' LIMIT 1", [artifact.sha]);
  const result = blocked.length ? { state: 'block', reason: 'blocked_fingerprint' } : await provider.image(artifact.buffer);
  await event(db.query.bind(db), null, userId, 'reference', result.state, result.reason, artifact.sha);
  if (result.state !== 'pass') throw error('参考图片未通过审核或审核服务暂不可用', result.state === 'error' ? 503 : 403);
  const id = crypto.randomUUID();
  await db.query('INSERT INTO image_safety_references (id,user_id,sha256,file_key,expires_at) VALUES (?,?,?,?,DATE_ADD(NOW(),INTERVAL 1 DAY))', [id, userId, artifact.sha, artifact.key]);
  return { url: `/api/image/reference/${id}`, fileName: `${id}.jpg`, mimeType: 'image/jpeg', size: artifact.buffer.length };
}
async function reference(id, userId) {
  const { rows } = await db.query('SELECT * FROM image_safety_references WHERE id=? AND user_id=? AND expires_at>NOW()', [id, userId]);
  if (!rows[0]) throw error('参考图片已失效，请重新上传', 400);
  const bytes = await fs.readFile(assetPath(rows[0].file_key));
  if (hash(bytes) !== rows[0].sha256) throw error('参考图片校验失败', 409);
  return bytes;
}
async function references(userId, values = []) {
  if (!Array.isArray(values) || values.length > 4) throw error('参考图片参数不正确', 400);
  return Promise.all(values.map(async value => {
    const match = typeof value === 'string' && /^\/api\/image\/reference\/([a-f0-9-]{36})$/.exec(value);
    if (!match) throw error('只允许使用本人上传且审核通过的参考图片', 400);
    return `data:image/jpeg;base64,${(await reference(match[1], userId)).toString('base64')}`;
  }));
}
async function inlineReferences(userId, values) {
  if (!Array.isArray(values) || values.length > 4) throw error('参考图片参数不正确', 400);
  const result = [];
  for (const value of values) {
    if (typeof value !== 'string' || value.length > 14 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw error('参考图片编码不正确', 400);
    const uploaded = await uploadReference(userId, Buffer.from(value, 'base64'));
    const bytes = await reference(uploaded.url.split('/').pop(), userId);
    result.push(bytes.toString('base64'));
  }
  return result;
}
module.exports = { get, restricted, assertUser, checkPrompt, putImage, capture, project, publish, decide, asset, event, hash, assetPath, error, uploadReference, reference, references, inlineReferences };

const crypto = require('crypto');
const db = require('../database/connection');
const config = require('../config');
const { scope } = require('./galleryReviewService');
const { idOf } = require('./galleryModerationService');
const { error } = require('./imageSafetyService');
const tables = { html: 'html_pages', mindmap: 'user_mindmaps' };
function table(kind) { if (!Object.hasOwn(tables, kind)) throw error('作品类型不正确', 400); return tables[kind]; }
function token(id, revision = 0) {
  // Revision zero preserves the exact legacy token, including its original key selection.
  const secret = config.jwt?.accessSecret || process.env.JWT_ACCESS_SECRET || 'mindmap-fallback-key';
  return crypto.createHmac('sha256', secret).update(`mindmap-share-${id}${Number(revision) ? `-${revision}` : ''}`).digest('base64url').substring(0, 12);
}
function verify(id, value, revision) {
  const expected = token(id, revision);
  return typeof value === 'string' && Buffer.byteLength(value) === Buffer.byteLength(expected) && crypto.timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}
const published = (kind, row) => kind === 'html' ? Boolean(Number(row.is_published)) : row.share_state === 'published';
const revisionOf = (kind, row) => Number(kind === 'html' ? row.version : row.share_revision);
async function work(query, kind, id, lock = false) {
  const { rows } = await query(`SELECT w.*,u.group_id owner_group,u.role owner_role FROM ${table(kind)} w JOIN users u ON u.id=w.user_id WHERE w.id=?${lock ? ' FOR UPDATE' : ''}`, [idOf(id)]);
  if (!rows[0]) throw error('作品不存在', 404);
  return rows[0];
}
function canWithdraw(user, row) {
  return Number(row.user_id) === Number(user.id) || user.role === 'super_admin' || (user.role === 'admin' && user.group_id && Number(user.group_id) === Number(row.owner_group) && row.owner_role === 'user');
}
async function event(query, kind, id, actor, action) {
  await query('INSERT INTO shared_work_events (work_type,work_id,actor_id,action) VALUES (?,?,?,?)', [kind, id, actor, action]);
}
async function withdraw(kind, id, user, revision) {
  if (!Number.isSafeInteger(revision)) throw error('请刷新作品版本', 400);
  return db.transaction(async query => {
    const row = await work(query, kind, id, true);
    if (!canWithdraw(user, row)) throw error('作品不存在或不在管理范围内', 404);
    if (revisionOf(kind, row) !== revision || !published(kind, row)) throw error('作品已变更，请刷新', 409);
    if (kind === 'html') await query('UPDATE html_pages SET is_published=0,publish_url=NULL,version=version+1 WHERE id=?', [id]);
    else await query("UPDATE user_mindmaps SET share_state='withdrawn',share_revision=share_revision+1 WHERE id=?", [id]);
    await query('UPDATE shared_work_reports SET resolved_at=NOW() WHERE work_type=? AND work_id=? AND resolved_at IS NULL', [kind, id]);
    await event(query, kind, id, user.id, 'withdraw');
    return { state: 'withdrawn', revision: revision + 1 };
  });
}
async function publishMindmap(id, user) {
  return db.transaction(async query => {
    const row = await work(query, 'mindmap', id, true);
    if (Number(row.user_id) !== Number(user.id)) throw error('作品不存在', 404);
    let revision = Number(row.share_revision);
    if (row.share_state !== 'published') {
      revision++;
      await query("UPDATE user_mindmaps SET share_state='published',share_revision=? WHERE id=?", [revision, id]);
      await event(query, 'mindmap', id, user.id, 'publish');
    }
    return { share_path: `/mindmap/share/${id}/${token(id, revision)}`, share_state: 'published', share_revision: revision };
  });
}
async function report(kind, id, user, reason) {
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) throw error('请填写举报原因（最多500字）', 400);
  return db.transaction(async query => {
    const row = await work(query, kind, id, true);
    if (!published(kind, row) || Number(row.user_id) === Number(user.id)) throw error('作品不可举报', 404);
    const { rows } = await query('INSERT INTO shared_work_reports (work_type,work_id,user_id,reason) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE reason=VALUES(reason),resolved_at=NULL,created_at=NOW()', [kind, id, user.id, reason.trim()]);
    await event(query, kind, id, user.id, 'report');
    return { reported: true, saved: Boolean(rows.affectedRows) };
  });
}
async function list(user, options = {}) {
  const s = scope(user);
  if (options.reported === 'true' && user.role !== 'super_admin') throw error('仅平台管理员可处理举报', 403);
  const page = Math.max(1, Math.min(100000, parseInt(options.page) || 1));
  const union = `SELECT 'html' kind,id,user_id,title,version revision,IF(is_published=1,'published','withdrawn') state,CONCAT('/pages/',user_id,'/',slug) link,published_at FROM html_pages WHERE published_at IS NOT NULL OR is_published=1
    UNION ALL SELECT 'mindmap',id,user_id,title,share_revision,share_state,NULL,created_at FROM user_mindmaps WHERE share_state<>'draft'`;
  const from = `FROM (${union}) w JOIN users u ON u.id=w.user_id LEFT JOIN user_groups g ON g.id=u.group_id`;
  const reportCount = '(SELECT COUNT(*) FROM shared_work_reports r WHERE r.work_type=w.kind AND r.work_id=w.id AND r.resolved_at IS NULL)';
  let where = s.sql; const params = [...s.params];
  if (options.reported === 'true') where += ` AND ${reportCount}>0`;
  if (options.group_id) { where += ' AND u.group_id=?'; params.push(idOf(options.group_id)); }
  const { rows: counts } = await db.query(`SELECT COUNT(*) total ${from} WHERE ${where}`, params);
  const { rows } = await db.simpleQuery(`SELECT w.*,u.username,g.name group_name,${reportCount} reports ${from} WHERE ${where} ORDER BY w.published_at DESC,w.kind,w.id DESC LIMIT 30 OFFSET ?`, [...params, (page - 1) * 30]);
  for (const row of rows) if (row.kind === 'mindmap') row.link = `/mindmap/share/${row.id}/${token(row.id, row.revision)}`;
  return { data: rows, total: Number(counts[0].total), page };
}
async function reports(kind, id, user) {
  table(kind); idOf(id);
  if (user.role !== 'super_admin') throw error('仅平台管理员可处理举报', 403);
  const { rows } = await db.query('SELECT reason,created_at,resolved_at FROM shared_work_reports WHERE work_type=? AND work_id=? ORDER BY id DESC LIMIT 100', [kind, id]);
  return rows;
}
async function resolve(kind, id, user) {
  table(kind); idOf(id);
  if (user.role !== 'super_admin') throw error('仅平台管理员可处理举报', 403);
  return db.transaction(async query => {
    await work(query, kind, id, true);
    await query('UPDATE shared_work_reports SET resolved_at=NOW() WHERE work_type=? AND work_id=? AND resolved_at IS NULL', [kind, id]);
    await event(query, kind, id, user.id, 'resolve_reports');
    return { resolved: true };
  });
}
module.exports = { token, verify, withdraw, publishMindmap, report, list, reports, resolve, canWithdraw };

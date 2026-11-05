const fs = require('fs');
const path = require('path');
const db = require('../database/connection');
const config = require('../config');
const oss = require('./ossService');
const safety = require('./videoSafetyService');
const store = require('./privateVideoStore');
const error = require('./imageSafetyService').error;
const fields = ['local_path','thumbnail_path','preview_gif_path','last_frame_path','oss_video_url','oss_thumbnail_url','oss_gif_url'];
function keyFor(value, row, remote) {
  if (!value) return null;
  const u = new URL(value, 'https://local.invalid');
  const key = decodeURIComponent(u.pathname).replace(/^\/(?:storage\/)?uploads\//, '').replace(/^\//, '');
  if (key.includes('..') || !key.startsWith(`videos/${row.user_id}/`) || !/\.(mp4|jpg|jpeg|png|webp|gif)$/i.test(key) || u.search) throw error('历史视频路径不符合预期', 409);
  if (remote && u.hostname !== `${oss.config.bucket}.${oss.config.region}.aliyuncs.com`) throw error('历史视频存储域名不符合预期', 409);
  return key;
}
async function importVideo(id, actor = null) {
  const { rows } = await db.query(`SELECT id,user_id,${fields.join(',')} FROM video_generations WHERE id=?`, [id]);
  if (!rows.length) throw error('视频不存在', 404);
  const row = rows[0], current = await safety.get(id);
  if (current.file_key) return current;
  await oss.initialize();
  const remote = !oss.isLocal;
  const key = keyFor(row.local_path || row.oss_video_url, row, remote);
  if (!key) throw error('原视频不存在，需要从受限备份恢复', 409);
  // Validate every legacy URL before changing storage or database state.
  const keys = new Set(fields.map(f => keyFor(row[f], row, remote)).filter(Boolean));
  const stream = remote ? (await oss.client.getStream(key)).stream : fs.createReadStream(path.join(config.storage.paths.uploads, key));
  const artifact = await store.putStream(stream);
  for (const old of keys) {
    if (remote) {
      await oss.client.putACL(old, 'private');
      if ((await oss.client.getACL(old)).acl !== 'private') throw error('旧视频链接隔离失败', 503);
    } else await fs.promises.unlink(path.join(config.storage.paths.uploads, old)).catch(e => { if (e.code !== 'ENOENT') throw e; });
  }
  await db.transaction(async query => {
    const { rows: live } = await query(`SELECT ${fields.join(',')} FROM video_generations WHERE id=? FOR UPDATE`, [id]);
    if (!live.length || fields.some(f => live[0][f] !== row[f])) throw error('视频已变更，请重新检查', 409);
    await query(`INSERT INTO video_safety (generation_id,sha256,file_key,file_size,revision) VALUES (?,?,?,?,1)
      ON DUPLICATE KEY UPDATE sha256=VALUES(sha256),file_key=VALUES(file_key),file_size=VALUES(file_size),revision=revision+1`, [id, artifact.sha, artifact.key, artifact.size]);
    await query(`UPDATE video_generations SET is_public=0,gallery_approved_by=NULL,local_path=?,video_url=NULL,
      thumbnail_path=NULL,preview_gif_path=NULL,last_frame_path=NULL,oss_video_url=NULL,oss_thumbnail_url=NULL,oss_gif_url=NULL,raw_response=NULL WHERE id=?`, [`/api/video/generation/${id}/asset`, id]);
    await safety.event(query, id, actor, 'legacy_quarantine', current.state, 'full_video_teacher_review_required', artifact.sha);
  });
  return safety.get(id);
}
module.exports = { importVideo, keyFor };

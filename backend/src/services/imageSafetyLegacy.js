const fs = require('fs').promises;
const path = require('path');
const db = require('../database/connection');
const config = require('../config');
const oss = require('./ossService');
const safety = require('./imageSafetyService');

function keyFor(value, generation, remote) {
  if (!value) return null;
  const url = new URL(value, 'https://local.invalid');
  let key = decodeURIComponent(url.pathname).replace(/^\/(?:storage\/)?uploads\//, '').replace(/^\//, '');
  if (key.includes('..') || !key.startsWith(`generations/${generation.user_id}/`) || !/\.(jpe?g|png|webp)$/i.test(key)) throw safety.error('历史图片路径不符合预期', 409);
  if (remote && !url.hostname.startsWith(`${oss.config.bucket}.`)) throw safety.error('历史图片存储域名不符合预期', 409);
  return key;
}
async function importImage(id, actor = null) {
  const { rows } = await db.query('SELECT id,user_id,local_path,thumbnail_path FROM image_generations WHERE id=?', [id]);
  const row = rows[0];
  if (!row) throw safety.error('记录不存在', 404);
  const current = await safety.get(id);
  if (current.file_key) return current;
  await oss.initialize();
  const remote = !oss.isLocal;
  const key = keyFor(row.local_path, row, remote);
  const thumb = keyFor(row.thumbnail_path, row, remote);
  if (!key) throw safety.error('原图不存在，需要从受限备份恢复', 409);
  const buffer = remote ? (await oss.client.get(key)).content : await fs.readFile(path.join(config.storage.paths.uploads, key));
  const artifact = await safety.putImage(buffer);
  // Quarantine old URLs before exposing the review record. Failure never approves.
  for (const old of new Set([key, thumb].filter(Boolean))) {
    if (remote) {
      await oss.client.putACL(old, 'private');
      if ((await oss.client.getACL(old)).acl !== 'private') throw safety.error('旧链接隔离失败', 503);
    } else {
      // The original pixels have been saved outside the public tree before unlink.
      await fs.unlink(path.join(config.storage.paths.uploads, old)).catch(e => { if (e.code !== 'ENOENT') throw e; });
    }
  }
  await db.transaction(async query => {
    const { rows: live } = await query('SELECT local_path,thumbnail_path FROM image_generations WHERE id=? FOR UPDATE', [id]);
    if (!live.length || live[0].local_path !== row.local_path || live[0].thumbnail_path !== row.thumbnail_path) throw safety.error('图片已发生变化，请重新检查', 409);
    await query('INSERT INTO image_safety (generation_id,sha256,file_key,reason,revision) VALUES (?,?,?,?,1) ON DUPLICATE KEY UPDATE sha256=VALUES(sha256),file_key=VALUES(file_key),revision=revision+1', [id, artifact.sha, artifact.key, 'legacy_review']);
    await query('UPDATE image_generations SET is_public=0,image_url=NULL,local_path=?,thumbnail_path=? WHERE id=?', [`/api/image/generation/${id}/asset`, `/api/image/generation/${id}/asset?thumbnail=1`, id]);
    await safety.event(query, id, actor, 'legacy_quarantine', current.state, 'legacy_review', artifact.sha);
  });
  return safety.get(id);
}
module.exports = { keyFor, importImage };

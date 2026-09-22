'use strict';

// Local assets for a fixed review revision.
//
// A revision must re-open completely later, so the bytes of the student's own uploads are copied into
// it. Three rules decide whether a referenced file may be copied, and a file that fails any of them is
// refused **by name** and listed in the manifest instead of being silently dropped or silently copied:
//   1. Ownership must be provable from a real model row that says this user owns this object. Today the
//      practice platform has three such models (chat uploads `files`, cloud-disk `user_files`, and the
//      editor's own `html_resources`, which has no write path yet). A path that merely exists under the
//      upload root proves nothing and is refused (`ownership_unproven`).
//   2. The bytes must be a regular file inside the upload root, reached without following a symlink.
//   3. Type and size must be inside the recorded limits.
// Nothing is ever fetched over the network: an http(s) or protocol-relative reference stays external and
// unfrozen, and object-storage rows whose bytes are not local are refused as `remote_object_storage`.
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const MAX_ASSET_BYTES = 2 * 1024 * 1024;
const MAX_ASSETS = 40;
const UPLOAD_PREFIX = '/uploads/';
// Types a frozen page may carry. Anything else (video, archives, executables) is refused by type so a
// revision can never become a delivery vehicle for unrelated content.
const TYPES = Object.freeze({
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.json': 'application/json'
});
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
// Reference shapes that can point at a local upload. Query strings and fragments are kept out of the
// lookup key and are dropped from the frozen reference.
const REFERENCE = /(?:src|href|data-src|poster)\s*=\s*["']([^"']{1,400})["']|url\(\s*["']?([^"')]{1,400})["']?\s*\)/gi;

function classify(reference) {
  const raw = String(reference || '').trim();
  if (!raw) return { kind: 'ignore' };
  if (/^(?:data|blob|mailto|tel|javascript):/i.test(raw)) return { kind: 'ignore' };
  if (/^(?:https?:)?\/\//i.test(raw)) return { kind: 'external', url: raw };
  const [withoutHash] = raw.split('#');
  const [pathname] = withoutHash.split('?');
  if (!pathname) return { kind: 'ignore' };
  if (pathname.startsWith(UPLOAD_PREFIX)) return { kind: 'upload', raw, pathname, key: pathname.slice(UPLOAD_PREFIX.length) };
  if (pathname.startsWith('/pages/')) return { kind: 'page_url', raw, pathname };
  if (pathname.startsWith('/')) return { kind: 'site_absolute', raw, pathname };
  return { kind: 'relative', raw, pathname };
}

function collect(text) {
  const found = new Map();
  for (const match of String(text).matchAll(REFERENCE)) {
    const reference = match[1] ?? match[2];
    const info = classify(reference);
    if (info.kind === 'ignore') continue;
    const key = `${info.kind}\u0000${info.raw || info.url}`;
    const seen = found.get(key);
    found.set(key, seen ? { ...seen, count: seen.count + 1 } : { ...info, count: 1 });
  }
  return [...found.values()];
}

// Ownership lookup across the three models that can actually prove it. `ownerUserId` is the
// authenticated student; a row belonging to anybody else is not a match, it is a refusal.
function createAssetResolver({ models, uploadRoot, maxBytes = MAX_ASSET_BYTES, maxAssets = MAX_ASSETS }) {
  async function owned(ownerUserId, projectId, key) {
    const like = `%${key}`;
    const checks = [
      { table: 'files', sql: `SELECT id, user_id, file_path AS local_path, mime_type, status FROM files
          WHERE user_id = ? AND file_path LIKE ? ORDER BY id DESC LIMIT 1`, params: [ownerUserId, like],
      accept: row => (row.status === 'ready' ? { source: 'files', local: row.local_path } : { refuse: 'source_not_ready' }) },
      { table: 'user_files', sql: `SELECT id, user_id, oss_key, mime_type, is_deleted FROM user_files
          WHERE user_id = ? AND oss_key = ? AND is_deleted = 0 ORDER BY id DESC LIMIT 1`, params: [ownerUserId, key],
      accept: row => ({ source: 'user_files', local: row.oss_key }) },
      { table: 'html_resources', sql: `SELECT id, user_id, project_id, storage_path, storage_type, oss_key, mime_type
          FROM html_resources WHERE user_id = ? AND (storage_path = ? OR storage_path LIKE ? OR oss_key = ?) ORDER BY id DESC LIMIT 1`,
      params: [ownerUserId, key, like, key],
      accept: row => (row.storage_type === 'oss' ? { refuse: 'remote_object_storage' }
        : { source: 'html_resources', local: row.storage_path || row.oss_key,
          projectMismatch: row.project_id != null && String(row.project_id) !== String(projectId) }) }
    ];
    for (const check of checks) {
      let rows;
      try { rows = await models.query(check.sql, check.params); }
      catch { return { refuse: 'ownership_lookup_failed' }; }
      const row = Array.isArray(rows) ? rows[0] : rows?.rows?.[0];
      if (!row) continue;
      const verdict = check.accept(row);
      if (verdict.refuse) return verdict;
      if (verdict.projectMismatch) return { refuse: 'other_project_resource' };
      return verdict;
    }
    return { refuse: 'ownership_unproven' };
  }

  // Read the bytes without following a symlink and without leaving the upload root.
  async function read(localPath, key) {
    let candidate = typeof localPath === 'string' ? localPath : '';
    // Stored paths differ per deployment (absolute under /var/www or /app in production, relative in the
    // cloud-disk model). Everything up to and including the last "uploads/" segment is deployment
    // prefix; what follows is the key inside the upload root — and containment is checked anyway.
    const marker = candidate.lastIndexOf('uploads/');
    if (marker >= 0) candidate = candidate.slice(marker + 'uploads/'.length);
    if (candidate === '') candidate = key;
    if (candidate.includes('..') || candidate.includes('\u0000')) return { refuse: 'path_rejected' };
    const target = path.resolve(uploadRoot, candidate.replace(/^\/+/, ''));
    let handle;
    try {
      const root = await fs.realpath(uploadRoot);
      const relative = path.relative(root, target);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return { refuse: 'outside_upload_root' };
      handle = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile()) return { refuse: 'not_a_regular_file' };
      if (stat.size > maxBytes) return { refuse: 'asset_too_large' };
      const buffer = Buffer.alloc(stat.size);
      const { bytesRead } = await handle.read(buffer, 0, stat.size, 0);
      return { bytes: buffer.subarray(0, bytesRead) };
    } catch (error) {
      if (error && (error.code === 'ELOOP' || error.code === 'EMLINK')) return { refuse: 'symlink_refused' };
      if (error && error.code === 'ENOENT') return { refuse: 'file_missing' };
      return { refuse: 'unreadable' };
    } finally { await handle?.close().catch(() => {}); }
  }

  // Resolve one referenced upload into either frozen bytes or a named refusal.
  async function resolve({ ownerUserId, projectId, reference }) {
    const extension = path.extname(reference.pathname).toLowerCase();
    const mediaType = TYPES[extension];
    if (!mediaType) return { refused: 'unsupported_type' };
    const ownership = await owned(ownerUserId, projectId, reference.key);
    if (ownership.refuse) return { refused: ownership.refuse };
    const bytes = await read(ownership.local, reference.key);
    if (bytes.refuse) return { refused: bytes.refuse };
    const digest = sha256(bytes.bytes);
    return { path: `assets/${digest.slice(0, 16)}${extension}`, media_type: mediaType, byte_length: bytes.bytes.length,
      sha256: digest, content: bytes.bytes, owned_by: ownership.source };
  }

  return { resolve, collect, classify, maxAssets, maxBytes, TYPES };
}
module.exports = { createAssetResolver, collect, classify, sha256, MAX_ASSET_BYTES, MAX_ASSETS, TYPES };

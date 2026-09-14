/**
 * 预置数据包纯函数工具（无 IO）
 *
 * - isValidPackKey(key)：包 key 只允许 [a-z0-9_-]{1,50}（目录名即 key，杜绝穿越）
 * - isSafeRelativePath(rel)：manifest 里的文件路径必须是包目录内的相对路径
 *     拒绝：空、绝对路径、Windows 盘符/反斜杠、含 '.' / '..' 段、NUL 字符、过长
 * - resolvePackFile(packDir, rel)：解析为绝对路径并再次确认落在 packDir 内，否则抛错
 * - selectPerClass(list, perClass)：每类最多取前 perClass 个（保持 manifest 顺序）
 * - computeCounts(manifest)：{train:{class_key:n}, shift:{set:{class_key:n}}}
 * - packUsesRows(kind)：table / text 包按 rows 计数与导入，image / audio 包按 files
 * - AUDIO_FILE_EXTENSIONS：音频包 manifest 里允许的文件扩展名
 */

const path = require('path');

const PACK_KEY_PATTERN = /^[a-z0-9_-]{1,50}$/;
const MAX_RELATIVE_PATH_LENGTH = 180;
const AUDIO_FILE_EXTENSIONS = ['wav', 'webm', 'ogg', 'mp3'];

/** table / text 包用 rows；image / audio 包用 files */
function packUsesRows(kind) {
  return kind === 'table' || kind === 'text';
}

/** 相对路径的扩展名（小写、不带点） */
function fileExtension(rel) {
  const name = String(rel || '').split('/').pop() || '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function isValidPackKey(key) {
  return typeof key === 'string' && PACK_KEY_PATTERN.test(key);
}

/**
 * 只接受包目录内的 POSIX 风格相对路径
 */
function isSafeRelativePath(rel) {
  if (typeof rel !== 'string' || rel.length === 0 || rel.length > MAX_RELATIVE_PATH_LENGTH) return false;
  if (rel.includes('\0') || rel.includes('\\')) return false;
  if (rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) return false;
  const segments = rel.split('/');
  return segments.every(segment => segment !== '' && segment !== '.' && segment !== '..');
}

/**
 * 解析包内文件的绝对路径；不在包目录内时抛 Error
 * @param {string} packDir - 包目录绝对路径
 * @param {string} rel - manifest 中的相对路径
 * @returns {string} 绝对路径
 */
function resolvePackFile(packDir, rel) {
  if (!isSafeRelativePath(rel)) {
    throw new Error(`预置包文件路径无效: ${String(rel).slice(0, 80)}`);
  }
  const root = path.resolve(packDir);
  const target = path.resolve(root, ...rel.split('/'));
  const relative = path.relative(root, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`预置包文件路径越界: ${rel.slice(0, 80)}`);
  }
  return target;
}

/**
 * 每类最多取 perClass 个；perClass 为空/非正数时取全部
 */
function selectPerClass(list, perClass) {
  const items = Array.isArray(list) ? list : [];
  const limit = Number(perClass);
  if (!Number.isFinite(limit) || limit <= 0) return items.slice();
  return items.slice(0, Math.floor(limit));
}

/**
 * 统计 manifest 中各集合每类的样本数（image / audio 数 files，table / text 数 rows）
 */
function computeCounts(manifest) {
  const counts = { train: {}, shift: {} };
  if (!manifest || typeof manifest !== 'object') return counts;

  if (packUsesRows(manifest.kind)) {
    const rows = manifest.rows && typeof manifest.rows === 'object' ? manifest.rows : {};
    (Array.isArray(rows.train) ? rows.train : []).forEach(row => {
      const key = row && row.class_key;
      if (key) counts.train[key] = (counts.train[key] || 0) + 1;
    });
    const shift = rows.shift && typeof rows.shift === 'object' && !Array.isArray(rows.shift) ? rows.shift : {};
    Object.keys(shift).forEach(setName => {
      counts.shift[setName] = {};
      (Array.isArray(shift[setName]) ? shift[setName] : []).forEach(row => {
        const key = row && row.class_key;
        if (key) counts.shift[setName][key] = (counts.shift[setName][key] || 0) + 1;
      });
    });
    return counts;
  }

  const files = manifest.files && typeof manifest.files === 'object' ? manifest.files : {};
  const train = files.train && typeof files.train === 'object' && !Array.isArray(files.train) ? files.train : {};
  Object.keys(train).forEach(key => {
    counts.train[key] = Array.isArray(train[key]) ? train[key].length : 0;
  });
  const shift = files.shift && typeof files.shift === 'object' && !Array.isArray(files.shift) ? files.shift : {};
  Object.keys(shift).forEach(setName => {
    counts.shift[setName] = {};
    const byClass = shift[setName] && typeof shift[setName] === 'object' ? shift[setName] : {};
    Object.keys(byClass).forEach(key => {
      counts.shift[setName][key] = Array.isArray(byClass[key]) ? byClass[key].length : 0;
    });
  });
  return counts;
}

module.exports = {
  PACK_KEY_PATTERN,
  AUDIO_FILE_EXTENSIONS,
  isValidPackKey,
  isSafeRelativePath,
  resolvePackFile,
  selectPerClass,
  computeCounts,
  packUsesRows,
  fileExtension
};

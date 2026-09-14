/**
 * 行样本 payload 规范化（纯函数，无 IO）
 *
 * normalizeRowPayload(payload, columns) → 规范化后的 {col_key: value}
 *
 * 规则：
 * - payload 必须是非空键值对象，键必须在 columns 内
 * - number   列：转数值（空值为 null），非数字报错
 * - category 列：转 ≤50 字的字符串（空值为 null），去首尾空白
 * - text     列：字符串，去首尾空白，1–1000 字，不做类别校验，不允许为空
 *
 * 由 AiLabService.normalizeRowPayload 与预置包解析共用；抛 ValidationError 表示输入无效。
 */

const { ValidationError } = require('../../utils/errors');

const MAX_CATEGORY_VALUE_LENGTH = 50;
const MAX_TEXT_VALUE_LENGTH = 1000;

/**
 * @param {Object} payload
 * @param {Array<{key:string,type:string}>} columns
 * @returns {Object}
 */
function normalizeRowPayload(payload, columns) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ValidationError('payload 必须是键值对象');
  }
  const columnMap = new Map((Array.isArray(columns) ? columns : []).map(col => [col.key, col]));
  if (columnMap.size === 0) throw new ValidationError('数据集尚未定义列（columns）');

  const keys = Object.keys(payload);
  if (keys.length === 0) throw new ValidationError('payload 不能为空');

  const normalized = {};
  for (const key of keys) {
    const column = columnMap.get(key);
    if (!column) throw new ValidationError(`payload 含未定义的列: ${key}`);
    const raw = payload[key];

    if (column.type === 'text') {
      if (raw !== null && raw !== undefined && typeof raw === 'object') {
        throw new ValidationError(`列 ${key} 的值必须是字符串`);
      }
      const text = raw === null || raw === undefined ? '' : String(raw).trim();
      if (text.length === 0) throw new ValidationError(`列 ${key} 不能为空`);
      if (text.length > MAX_TEXT_VALUE_LENGTH) {
        throw new ValidationError(`列 ${key} 的文本不能超过 ${MAX_TEXT_VALUE_LENGTH} 字`);
      }
      normalized[key] = text;
      continue;
    }

    if (raw === null || raw === undefined || raw === '') {
      normalized[key] = null;
      continue;
    }
    if (column.type === 'number') {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isFinite(n)) throw new ValidationError(`列 ${key} 必须是数字`);
      normalized[key] = n;
    } else {
      if (typeof raw === 'object') throw new ValidationError(`列 ${key} 的值必须是字符串`);
      const text = String(raw).trim();
      if (text.length > MAX_CATEGORY_VALUE_LENGTH) {
        throw new ValidationError(`列 ${key} 的值不能超过 ${MAX_CATEGORY_VALUE_LENGTH} 字`);
      }
      normalized[key] = text;
    }
  }
  return normalized;
}

module.exports = normalizeRowPayload;
module.exports.normalizeRowPayload = normalizeRowPayload;
module.exports.MAX_CATEGORY_VALUE_LENGTH = MAX_CATEGORY_VALUE_LENGTH;
module.exports.MAX_TEXT_VALUE_LENGTH = MAX_TEXT_VALUE_LENGTH;

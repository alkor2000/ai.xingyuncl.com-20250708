/**
 * 混入错标（纯函数，无 IO）
 *
 * pickMislabels(samples, ratio, seed, classKeys) → [{id, from, to}]
 *
 * 规则（契约 v2 §3 mislabel）：
 * - 按 class_key 分层随机取 ratio（四舍五入；该类 ≥ 3 时至少 1 个；绝不改掉某类的全部样本）
 *   —— 选样直接复用 splitHoldout 的分层规则与 mulberry32 洗牌，同一输入 + 同一 seed 结果完全一致
 * - 目标类别：从 classKeys 中除原类别外的其余类别里确定性随机选一个（独立的随机流，
 *   以 seed 派生，保证"选哪些样本"与"改成哪一类"都可复现）
 * - classKeys 少于 2 个时没有可改的目标，返回空数组
 *
 * 调用方负责只传入候选样本（split='train'、未删除、original_class_key IS NULL）。
 */

const splitHoldout = require('./splitHoldout');
const { createRng, normalizeSeed } = splitHoldout;

const TARGET_STREAM_SALT = 0x9E3779B9;

/**
 * @param {Array<{id:number|string, class_key:string}>} samples - 候选样本
 * @param {number} ratio - 错标比例 (0, 1]
 * @param {number|string} seed - 随机种子
 * @param {Array<string>} classKeys - 数据集全部类别 key
 * @returns {Array<{id:number|string, from:string, to:string}>} 按 id 升序
 */
function pickMislabels(samples, ratio = 0.2, seed = 0, classKeys = []) {
  if (!Array.isArray(samples) || samples.length === 0) return [];
  const keys = Array.from(new Set((Array.isArray(classKeys) ? classKeys : []).map(key => String(key)))).sort();
  if (keys.length < 2) return [];

  const byId = new Map();
  samples.forEach(sample => {
    if (sample && sample.id !== undefined && sample.id !== null) byId.set(String(sample.id), sample);
  });

  const selectedIds = splitHoldout(samples, ratio, seed);
  const rng = createRng((normalizeSeed(seed) ^ TARGET_STREAM_SALT) >>> 0);

  const changes = [];
  selectedIds.forEach(id => {
    const sample = byId.get(String(id));
    if (!sample) return;
    const from = String(sample.class_key ?? '');
    const others = keys.filter(key => key !== from);
    if (others.length === 0) return;
    const to = others[Math.floor(rng() * others.length)];
    changes.push({ id, from, to });
  });
  return changes;
}

module.exports = pickMislabels;
module.exports.pickMislabels = pickMislabels;

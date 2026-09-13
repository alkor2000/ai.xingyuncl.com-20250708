/**
 * 留出集分层划分（纯函数，无 IO）
 *
 * splitHoldout(samples, ratio, seed) → 应改为 holdout 的样本 id 数组（升序）
 *
 * 规则（契约 §4 lock）：
 * - 按 class_key 分层：每类独立按比例四舍五入取整
 * - 该类样本数 ≥ 3 时至少留 1 个
 * - 永远不把某类全部划走（至少保留 1 个训练样本，样本数 ≥ 2 时生效）
 * - 用 seed 驱动的 mulberry32 伪随机做 Fisher-Yates 洗牌，同一输入 + 同一 seed 结果完全一致
 *
 * 调用方负责只传入候选样本（本轮新加、split='train'、未删除），本函数不做过滤。
 */

/**
 * mulberry32：32 位状态的确定性伪随机数生成器
 * @param {number} seed - 任意整数（内部转 uint32）
 * @returns {() => number} 返回 [0, 1) 的函数
 */
function createRng(seed) {
  let state = normalizeSeed(seed);
  return function next() {
    state = (state + 0x6D2B79F5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 把任意 seed 归一为 uint32：数字直接取整；字符串用 FNV-1a 哈希；空值取 0
 */
function normalizeSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return Math.floor(seed) >>> 0;
  }
  if (typeof seed === 'string' && seed.length > 0) {
    const asNumber = Number(seed);
    if (Number.isFinite(asNumber) && /^-?\d+$/.test(seed.trim())) {
      return Math.floor(asNumber) >>> 0;
    }
    let hash = 0x811C9DC5;
    for (let i = 0; i < seed.length; i++) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }
  return 0;
}

/**
 * 计算某一类应划入留出集的数量
 * @param {number} count - 该类候选样本数
 * @param {number} ratio - 留出比例 (0, 1)
 */
function holdoutCountFor(count, ratio) {
  if (count <= 0 || ratio <= 0) return 0;
  let n = Math.round(count * ratio);
  if (count >= 3) n = Math.max(1, n);
  /* 至少保留 1 个训练样本 */
  if (count >= 2) n = Math.min(n, count - 1);
  else n = 0;
  return n;
}

/**
 * 分层留出划分
 * @param {Array<{id:number|string, class_key:string}>} samples - 候选样本
 * @param {number} ratio - 留出比例，默认 0.2
 * @param {number|string} seed - 随机种子
 * @returns {Array<number|string>} 选为 holdout 的样本 id（升序）
 */
function splitHoldout(samples, ratio = 0.2, seed = 0) {
  if (!Array.isArray(samples) || samples.length === 0) return [];
  const safeRatio = Number.isFinite(Number(ratio)) ? Number(ratio) : 0.2;
  if (safeRatio <= 0) return [];

  /* 分层：按 class_key 分组，组内按 id 升序保证输入顺序无关 */
  const byClass = new Map();
  for (const sample of samples) {
    if (!sample || sample.id === undefined || sample.id === null) continue;
    const key = String(sample.class_key ?? '');
    if (!byClass.has(key)) byClass.set(key, []);
    byClass.get(key).push(sample.id);
  }

  const rng = createRng(seed);
  const selected = [];
  const classKeys = Array.from(byClass.keys()).sort();

  for (const key of classKeys) {
    const ids = byClass.get(key).slice().sort(compareIds);
    const take = holdoutCountFor(ids.length, safeRatio);
    if (take === 0) continue;

    /* Fisher-Yates 洗牌（确定性） */
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = ids[i];
      ids[i] = ids[j];
      ids[j] = tmp;
    }
    selected.push(...ids.slice(0, take));
  }

  return selected.sort(compareIds);
}

function compareIds(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

module.exports = splitHoldout;
module.exports.splitHoldout = splitHoldout;
module.exports.createRng = createRng;
module.exports.normalizeSeed = normalizeSeed;
module.exports.holdoutCountFor = holdoutCountFor;

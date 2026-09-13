/**
 * splitHoldout - 留出集分层划分纯函数单元测试
 *
 * 测试范围：
 * - 分层：每个类别独立按比例四舍五入
 * - 至少留 1：类别样本数 ≥ 3 时至少 1 个进留出集
 * - 不清空：永远给每类保留至少 1 个训练样本
 * - 确定性：同一输入 + 同一 seed 结果一致，与输入顺序无关；不同 seed 通常不同
 * - 边界：空输入、ratio ≤ 0、字符串 seed、非法样本
 *
 * Mock策略：无外部依赖，纯逻辑测试
 */

const splitHoldout = require('../../../../services/aiLab/splitHoldout');
const { createRng, normalizeSeed, holdoutCountFor } = splitHoldout;

/** 生成 n 个某类样本，id 从 startId 起递增 */
function makeSamples(classKey, n, startId) {
  return Array.from({ length: n }, (_, i) => ({ id: startId + i, class_key: classKey }));
}

describe('splitHoldout - 留出集分层划分', () => {

  describe('holdoutCountFor - 单类留出数量', () => {
    test('按比例四舍五入', () => {
      expect(holdoutCountFor(10, 0.2)).toBe(2);
      expect(holdoutCountFor(15, 0.2)).toBe(3);
      expect(holdoutCountFor(12, 0.2)).toBe(2);   // 2.4 → 2
      expect(holdoutCountFor(13, 0.2)).toBe(3);   // 2.6 → 3
    });

    test('样本数 ≥ 3 时至少留 1', () => {
      expect(holdoutCountFor(3, 0.2)).toBe(1);    // 0.6 → 1
      expect(holdoutCountFor(4, 0.1)).toBe(1);    // 0.4 → 0 → 至少 1
    });

    test('样本数 < 3 时按四舍五入可为 0，且绝不划走全部', () => {
      expect(holdoutCountFor(2, 0.2)).toBe(0);    // 0.4 → 0
      expect(holdoutCountFor(1, 0.9)).toBe(0);    // 只剩 1 个不能划走
      expect(holdoutCountFor(2, 0.9)).toBe(1);    // 1.8 → 2 → 保留 1 个训练样本
    });

    test('ratio ≤ 0 或 count ≤ 0 返回 0', () => {
      expect(holdoutCountFor(10, 0)).toBe(0);
      expect(holdoutCountFor(0, 0.2)).toBe(0);
    });
  });

  describe('分层划分', () => {
    test('每类独立按比例划分，结果为升序 id 数组', () => {
      const samples = [
        ...makeSamples('cup', 10, 1),
        ...makeSamples('book', 15, 101),
        ...makeSamples('pen', 3, 201)
      ];
      const ids = splitHoldout(samples, 0.2, 42);
      const byClass = (key) => ids.filter(id => samples.find(s => s.id === id).class_key === key);

      expect(byClass('cup')).toHaveLength(2);
      expect(byClass('book')).toHaveLength(3);
      expect(byClass('pen')).toHaveLength(1);
      expect(ids).toHaveLength(6);
      expect([...ids].sort((a, b) => a - b)).toEqual(ids);
      /* 不重复 */
      expect(new Set(ids).size).toBe(ids.length);
    });

    test('只包含输入样本的 id', () => {
      const samples = makeSamples('a', 20, 1);
      const ids = splitHoldout(samples, 0.25, 7);
      expect(ids).toHaveLength(5);
      ids.forEach(id => expect(id).toBeGreaterThanOrEqual(1));
      ids.forEach(id => expect(id).toBeLessThanOrEqual(20));
    });

    test('某类只有 1-2 个样本时不会被清空', () => {
      const samples = [...makeSamples('a', 1, 1), ...makeSamples('b', 2, 10), ...makeSamples('c', 5, 20)];
      const ids = splitHoldout(samples, 0.5, 3);
      expect(ids).not.toContain(1);
      /* b 类 2 个最多划 1 个 */
      expect(ids.filter(id => id === 10 || id === 11).length).toBeLessThanOrEqual(1);
      /* c 类 5 个 → 2.5 → 3 */
      expect(ids.filter(id => id >= 20).length).toBe(3);
    });
  });

  describe('确定性', () => {
    const samples = [...makeSamples('cup', 20, 1), ...makeSamples('book', 20, 100)];

    test('同一输入 + 同一 seed → 完全相同的结果', () => {
      const a = splitHoldout(samples, 0.2, 2026);
      const b = splitHoldout(samples, 0.2, 2026);
      expect(a).toEqual(b);
      expect(a).toHaveLength(8);
    });

    test('与输入顺序无关', () => {
      const shuffled = samples.slice().reverse();
      expect(splitHoldout(shuffled, 0.2, 2026)).toEqual(splitHoldout(samples, 0.2, 2026));
    });

    test('不同 seed 通常得到不同的选择', () => {
      const results = new Set([1, 2, 3, 4, 5].map(seed => splitHoldout(samples, 0.2, seed).join(',')));
      expect(results.size).toBeGreaterThan(1);
    });

    test('字符串 seed 与数字 seed 等价（纯数字串），非数字串按哈希稳定', () => {
      expect(splitHoldout(samples, 0.2, '2026')).toEqual(splitHoldout(samples, 0.2, 2026));
      expect(splitHoldout(samples, 0.2, 'class-1')).toEqual(splitHoldout(samples, 0.2, 'class-1'));
    });

    test('createRng 输出在 [0,1) 且可复现', () => {
      const r1 = createRng(99);
      const r2 = createRng(99);
      for (let i = 0; i < 20; i++) {
        const v = r1();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
        expect(v).toBe(r2());
      }
    });

    test('normalizeSeed 归一为 uint32', () => {
      expect(normalizeSeed(-1)).toBe(0xFFFFFFFF);
      expect(normalizeSeed(3.9)).toBe(3);
      expect(normalizeSeed(undefined)).toBe(0);
      expect(normalizeSeed('abc')).toBe(normalizeSeed('abc'));
    });
  });

  describe('边界情况', () => {
    test('空输入返回空数组', () => {
      expect(splitHoldout([], 0.2, 1)).toEqual([]);
      expect(splitHoldout(null, 0.2, 1)).toEqual([]);
    });

    test('ratio ≤ 0 或非法时不划分', () => {
      const samples = makeSamples('a', 10, 1);
      expect(splitHoldout(samples, 0, 1)).toEqual([]);
      expect(splitHoldout(samples, -1, 1)).toEqual([]);
    });

    test('ratio 非法（NaN）时回退 0.2', () => {
      const samples = makeSamples('a', 10, 1);
      expect(splitHoldout(samples, 'abc', 1)).toHaveLength(2);
    });

    test('忽略没有 id 的样本', () => {
      const samples = [{ class_key: 'a' }, null, ...makeSamples('a', 5, 1)];
      const ids = splitHoldout(samples, 0.2, 1);
      expect(ids).toHaveLength(1);
      expect(ids[0]).toBeGreaterThanOrEqual(1);
    });
  });
});

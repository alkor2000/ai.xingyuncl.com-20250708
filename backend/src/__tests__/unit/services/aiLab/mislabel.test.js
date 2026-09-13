/**
 * pickMislabels - 混入错标纯函数单元测试
 *
 * 测试范围：
 * - 分层：每类独立按比例四舍五入（复用 splitHoldout 的规则）
 * - 至少 1：类别样本数 ≥ 3 时至少改 1 个；绝不改掉某类全部样本
 * - 目标类别：一定不等于原类别，且在给定的 classKeys 内
 * - 确定性：同一输入 + 同一 seed → 相同的样本与相同的目标；与输入顺序无关；不同 seed 通常不同
 * - 边界：空输入、少于两个类别、ratio ≤ 0、候选里出现 classKeys 之外的类别
 *
 * Mock策略：无外部依赖，纯逻辑测试
 */

const pickMislabels = require('../../../../services/aiLab/mislabel');
const splitHoldout = require('../../../../services/aiLab/splitHoldout');

function makeSamples(classKey, n, startId) {
  return Array.from({ length: n }, (_, i) => ({ id: startId + i, class_key: classKey }));
}

describe('pickMislabels - 混入错标', () => {
  const classKeys = ['apple', 'banana', 'cherry'];

  describe('分层选样', () => {
    test('每类独立按比例四舍五入，返回按 id 升序且不重复', () => {
      const samples = [
        ...makeSamples('apple', 10, 1),
        ...makeSamples('banana', 15, 101),
        ...makeSamples('cherry', 3, 201)
      ];
      const changes = pickMislabels(samples, 0.2, 42, classKeys);
      const byClass = (key) => changes.filter(change => change.from === key);

      expect(byClass('apple')).toHaveLength(2);
      expect(byClass('banana')).toHaveLength(3);
      expect(byClass('cherry')).toHaveLength(1);
      expect(changes).toHaveLength(6);
      const ids = changes.map(change => change.id);
      expect([...ids].sort((a, b) => a - b)).toEqual(ids);
      expect(new Set(ids).size).toBe(ids.length);
    });

    test('选样规则与 splitHoldout 完全一致', () => {
      const samples = [...makeSamples('apple', 12, 1), ...makeSamples('banana', 7, 50)];
      const changes = pickMislabels(samples, 0.3, 9, classKeys);
      expect(changes.map(change => change.id)).toEqual(splitHoldout(samples, 0.3, 9));
    });

    test('某类只有 1-2 个样本时不会全部被改', () => {
      const samples = [...makeSamples('apple', 1, 1), ...makeSamples('banana', 2, 10), ...makeSamples('cherry', 6, 20)];
      const changes = pickMislabels(samples, 0.5, 3, classKeys);
      expect(changes.some(change => change.id === 1)).toBe(false);
      expect(changes.filter(change => change.from === 'banana').length).toBeLessThanOrEqual(1);
      expect(changes.filter(change => change.from === 'cherry')).toHaveLength(3);
    });

    test('from 来自样本原类别', () => {
      const samples = [...makeSamples('apple', 5, 1), ...makeSamples('banana', 5, 10)];
      const changes = pickMislabels(samples, 0.4, 1, classKeys);
      changes.forEach(change => {
        const sample = samples.find(item => item.id === change.id);
        expect(change.from).toBe(sample.class_key);
      });
    });
  });

  describe('目标类别', () => {
    const samples = [...makeSamples('apple', 30, 1), ...makeSamples('banana', 30, 100), ...makeSamples('cherry', 30, 200)];

    test('目标一定不等于原类别且在 classKeys 内', () => {
      const changes = pickMislabels(samples, 0.5, 11, classKeys);
      expect(changes.length).toBeGreaterThan(0);
      changes.forEach(change => {
        expect(change.to).not.toBe(change.from);
        expect(classKeys).toContain(change.to);
      });
    });

    test('三类以上时目标不会只落在同一类（随机分布）', () => {
      const changes = pickMislabels(samples, 0.5, 11, classKeys);
      const targets = new Set(changes.filter(change => change.from === 'apple').map(change => change.to));
      expect(targets.size).toBe(2);
    });

    test('只有两类时目标必然是另一类', () => {
      const twoClasses = [...makeSamples('apple', 10, 1), ...makeSamples('banana', 10, 50)];
      const changes = pickMislabels(twoClasses, 0.3, 5, ['apple', 'banana']);
      changes.forEach(change => {
        expect(change.to).toBe(change.from === 'apple' ? 'banana' : 'apple');
      });
    });

    test('候选样本的类别不在 classKeys 内时，目标仍从 classKeys 中选', () => {
      const odd = makeSamples('zebra', 5, 1);
      const changes = pickMislabels(odd, 0.4, 2, ['apple', 'banana']);
      expect(changes).toHaveLength(2);
      changes.forEach(change => {
        expect(change.from).toBe('zebra');
        expect(['apple', 'banana']).toContain(change.to);
      });
    });
  });

  describe('确定性', () => {
    const samples = [...makeSamples('apple', 20, 1), ...makeSamples('banana', 20, 100), ...makeSamples('cherry', 20, 200)];

    test('同一输入 + 同一 seed → 相同的样本与目标', () => {
      const a = pickMislabels(samples, 0.2, 2026, classKeys);
      const b = pickMislabels(samples, 0.2, 2026, classKeys);
      expect(a).toEqual(b);
      expect(a).toHaveLength(12);
    });

    test('与输入顺序、classKeys 顺序无关', () => {
      const base = pickMislabels(samples, 0.2, 2026, classKeys);
      expect(pickMislabels(samples.slice().reverse(), 0.2, 2026, classKeys)).toEqual(base);
      expect(pickMislabels(samples, 0.2, 2026, ['cherry', 'apple', 'banana'])).toEqual(base);
    });

    test('不同 seed 通常得到不同的选择或目标', () => {
      const results = new Set([1, 2, 3, 4, 5].map(seed => JSON.stringify(pickMislabels(samples, 0.2, seed, classKeys))));
      expect(results.size).toBeGreaterThan(1);
    });

    test('字符串 seed 与数字 seed 等价（纯数字串）', () => {
      expect(pickMislabels(samples, 0.2, '2026', classKeys)).toEqual(pickMislabels(samples, 0.2, 2026, classKeys));
    });
  });

  describe('边界情况', () => {
    test('空输入返回空数组', () => {
      expect(pickMislabels([], 0.2, 1, classKeys)).toEqual([]);
      expect(pickMislabels(null, 0.2, 1, classKeys)).toEqual([]);
    });

    test('少于两个类别时无法改标，返回空数组', () => {
      const samples = makeSamples('apple', 10, 1);
      expect(pickMislabels(samples, 0.2, 1, ['apple'])).toEqual([]);
      expect(pickMislabels(samples, 0.2, 1, [])).toEqual([]);
      expect(pickMislabels(samples, 0.2, 1, undefined)).toEqual([]);
    });

    test('ratio ≤ 0 时不改标', () => {
      const samples = makeSamples('apple', 10, 1);
      expect(pickMislabels(samples, 0, 1, classKeys)).toEqual([]);
      expect(pickMislabels(samples, -1, 1, classKeys)).toEqual([]);
    });

    test('忽略没有 id 的样本', () => {
      const samples = [{ class_key: 'apple' }, null, ...makeSamples('apple', 5, 1)];
      const changes = pickMislabels(samples, 0.2, 1, classKeys);
      expect(changes).toHaveLength(1);
      expect(changes[0].id).toBeGreaterThanOrEqual(1);
    });
  });
});

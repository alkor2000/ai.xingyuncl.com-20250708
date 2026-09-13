/**
 * 表格引擎单测：决策树、手写规则、描述统计（纯 JS）
 */
import { describe, it, expect } from 'vitest'
import { trainTree, predictTree, treeToRules, treeDepth, countLeaves, serializeTree, deserializeTree } from '../../../pages/aiLab/engine/tabular/decisionTree'
import { evaluateRules, validateRuleSet, serializeRules, deserializeRules } from '../../../pages/aiLab/engine/tabular/rules'
import { summarizeColumns, columnValues, columnRange } from '../../../pages/aiLab/engine/tabular/stats'
import { computeMetrics } from '../../../pages/aiLab/engine/metrics'

const columns = [
  { key: 'length', type: 'number' },
  { key: 'weight', type: 'number' },
  { key: 'material', type: 'category' }
]
// 三类可分的合成数据：书本（纸、薄）、水杯（圆柱、重）、篮球（橡胶、大）
const rows = []
let id = 1
for (let i = 0; i < 20; i += 1) {
  rows.push({ id: id++, label: 'book', payload: { length: 20 + (i % 5), weight: 250 + i * 5, material: 'paper' } })
  rows.push({ id: id++, label: 'cup', payload: { length: 7 + (i % 3), weight: 240 + i * 4, material: i % 4 === 0 ? 'metal' : 'plastic' } })
  rows.push({ id: id++, label: 'ball', payload: { length: 24 + (i % 2), weight: 580 + i * 2, material: 'rubber' } })
}

describe('decision tree', () => {
  it('fits separable data and respects max depth', () => {
    const model = trainTree(rows, columns, { maxDepth: 2 })
    expect(treeDepth(model.root)).toBeLessThanOrEqual(2)
    expect(countLeaves(model.root)).toBeGreaterThanOrEqual(3)
    const preds = rows.map((r) => ({ actual: r.label, predicted: predictTree(model, r.payload).label }))
    const m = computeMetrics(preds, model.classKeys)
    expect(m.accuracy).toBe(1)
  })

  it('returns a decision path and handles missing values', () => {
    const model = trainTree(rows, columns, { maxDepth: 3 })
    const r = predictTree(model, { length: 21, weight: 300, material: 'paper' })
    expect(r.label).toBe('book')
    expect(r.path.length).toBeGreaterThan(0)
    expect(r.confidence).toBeGreaterThan(0.9)
    const missing = predictTree(model, {})
    expect(model.classKeys).toContain(missing.label)
  })

  it('a depth-1 stump has exactly two leaves and converts to two rules', () => {
    const model = trainTree(rows, columns, { maxDepth: 1 })
    expect(countLeaves(model.root)).toBe(2)
    const rules = treeToRules(model)
    expect(rules).toHaveLength(2)
    rules.forEach((rule) => { expect(rule.conditions).toHaveLength(1); expect(rule.n).toBeGreaterThan(0) })
  })

  it('serializes and deserializes to the same predictions', () => {
    const model = trainTree(rows, columns, { maxDepth: 3 })
    const back = deserializeTree(JSON.parse(JSON.stringify(serializeTree(model, { dataset_version: 1 }))))
    rows.slice(0, 10).forEach((r) => expect(predictTree(back, r.payload).label).toBe(predictTree(model, r.payload).label))
    expect(() => deserializeTree({ engine: 'image-knn' })).toThrow()
  })

  it('throws on empty input', () => {
    expect(() => trainTree([], columns)).toThrow()
  })
})

describe('rules', () => {
  const ruleSet = {
    rules: [
      { conditions: [{ col: 'material', op: '==', value: 'paper' }], label: 'book' },
      { conditions: [{ col: 'weight', op: '>=', value: 500 }, { col: 'length', op: '>', value: 20 }], label: 'ball' }
    ],
    default_label: 'cup'
  }

  it('applies the first matching rule, else the default', () => {
    expect(evaluateRules(ruleSet, { material: 'paper', weight: 999, length: 30 }, columns)).toEqual({ label: 'book', rule_index: 0 })
    expect(evaluateRules(ruleSet, { material: 'rubber', weight: 600, length: 24 }, columns)).toEqual({ label: 'ball', rule_index: 1 })
    expect(evaluateRules(ruleSet, { material: 'plastic', weight: 260, length: 8 }, columns)).toEqual({ label: 'cup', rule_index: -1 })
    // 缺失值：条件不成立
    expect(evaluateRules(ruleSet, { weight: 600 }, columns).label).toBe('cup')
    // 数值字符串也能比较
    expect(evaluateRules(ruleSet, { material: 'x', weight: '700', length: '25' }, columns).label).toBe('ball')
  })

  it('validates columns, operators, values and labels', () => {
    expect(validateRuleSet(ruleSet, columns, ['book', 'cup', 'ball'])).toEqual([])
    const bad = {
      rules: [
        { conditions: [{ col: 'nope', op: '==', value: 'a' }], label: 'book' },
        { conditions: [{ col: 'material', op: '<', value: 'paper' }], label: 'ghost' },
        { conditions: [{ col: 'weight', op: '>', value: 'abc' }], label: 'cup' },
        { conditions: [], label: 'cup' }
      ],
      default_label: 'zzz'
    }
    const codes = validateRuleSet(bad, columns, ['book', 'cup', 'ball']).map((p) => p.code)
    expect(codes).toEqual(expect.arrayContaining(['bad_column', 'bad_op', 'bad_label', 'not_number', 'no_conditions', 'bad_default']))
    expect(validateRuleSet({ rules: [] }, columns, ['a']).map((p) => p.code)).toContain('no_rules')
  })

  it('round-trips through serialization', () => {
    const back = deserializeRules(JSON.parse(JSON.stringify(serializeRules({ ...ruleSet, columns, classKeys: ['book', 'cup', 'ball'] }))))
    expect(back.rules).toHaveLength(2)
    expect(back.default_label).toBe('cup')
    expect(() => deserializeRules({ engine: 'table-tree' })).toThrow()
  })
})

describe('stats', () => {
  it('summarizes numeric and categorical columns per class', () => {
    const s = summarizeColumns(rows, columns)
    expect(s.length.book.min).toBe(20)
    expect(s.length.book.max).toBe(24)
    expect(s.length.book.n).toBe(20)
    expect(s.length.book.median).toBeGreaterThanOrEqual(20)
    expect(s.material.cup.plastic).toBe(15)
    expect(s.material.cup.metal).toBe(5)
    expect(columnValues(rows, 'material').sort()).toEqual(['metal', 'paper', 'plastic', 'rubber'])
    expect(columnValues(rows, 'material')[3]).toBe('metal')
    const range = columnRange(rows, 'weight')
    expect(range.min).toBeLessThan(240)
    expect(range.max).toBeGreaterThan(618)
    expect(columnRange(rows, 'material')).toBeNull()
  })
})

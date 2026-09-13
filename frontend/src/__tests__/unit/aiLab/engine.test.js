/**
 * AI训练专区引擎单测：kNN 分类器与评测指标（纯 JS，不依赖 TensorFlow）
 */
import { describe, it, expect } from 'vitest'
import { trainKnn, predictKnn, serializeKnn, deserializeKnn } from '../../../pages/aiLab/engine/knn'
import { computeMetrics, generalizationGap, formatPercent } from '../../../pages/aiLab/engine/metrics'

const unit = (arr) => {
  const n = Math.hypot(...arr) || 1
  return Float32Array.from(arr, (x) => x / n)
}

const samples = [
  { id: 1, label: 'cup', vec: unit([1, 0, 0]) },
  { id: 2, label: 'cup', vec: unit([0.9, 0.1, 0]) },
  { id: 3, label: 'pen', vec: unit([0, 1, 0]) },
  { id: 4, label: 'pen', vec: unit([0.1, 0.9, 0]) },
  { id: 5, label: 'book', vec: unit([0, 0, 1]) }
]

describe('knn', () => {
  it('predicts the nearest class with a confidence in (0,1]', () => {
    const model = trainKnn(samples, { k: 3 })
    const r = predictKnn(model, unit([0.95, 0.05, 0]))
    expect(r.label).toBe('cup')
    expect(r.confidence).toBeGreaterThan(0.5)
    expect(r.confidence).toBeLessThanOrEqual(1)
    expect(Object.keys(r.scores).sort()).toEqual(['book', 'cup', 'pen'])
    expect(r.neighbors).toHaveLength(3)
  })

  it('caps k at the number of samples and survives serialisation', () => {
    const model = trainKnn(samples, { k: 50 })
    expect(model.k).toBe(5)
    const json = JSON.parse(JSON.stringify(serializeKnn(model, { feature_extractor: 'test' })))
    expect(json.feature_extractor).toBe('test')
    const restored = deserializeKnn(json)
    expect(restored.classKeys).toEqual(model.classKeys)
    expect(predictKnn(restored, unit([0, 0, 1])).label).toBe('book')
  })

  it('refuses to train on an empty set', () => {
    expect(() => trainKnn([])).toThrow()
  })
})

describe('metrics', () => {
  it('computes accuracy, per-class recall and a confusion matrix', () => {
    const preds = [
      { id: 1, actual: 'cup', predicted: 'cup', confidence: 0.9 },
      { id: 2, actual: 'cup', predicted: 'pen', confidence: 0.6 },
      { id: 3, actual: 'pen', predicted: 'pen', confidence: 0.8 },
      { id: 4, actual: 'book', predicted: 'book', confidence: 0.7 }
    ]
    const m = computeMetrics(preds, ['cup', 'pen', 'book'])
    expect(m.accuracy).toBeCloseTo(0.75)
    expect(m.sample_count).toBe(4)
    expect(m.per_class.cup.recall).toBeCloseTo(0.5)
    expect(m.per_class.pen.precision).toBeCloseTo(0.5)
    expect(m.per_class.book.recall).toBe(1)
    expect(m.confusion.labels).toEqual(['cup', 'pen', 'book'])
    expect(m.confusion.matrix).toEqual([[1, 1, 0], [0, 1, 0], [0, 0, 1]])
  })

  it('handles labels missing from classKeys and empty input', () => {
    const m = computeMetrics([{ id: 1, actual: 'x', predicted: 'y', confidence: 0.5 }], [])
    expect(m.confusion.labels).toEqual(['x', 'y'])
    expect(computeMetrics([], ['a']).accuracy).toBeNull()
  })

  it('reports the generalisation gap against the worst shifted set', () => {
    expect(generalizationGap(0.95, [0.6, 0.8])).toBeCloseTo(0.35)
    expect(generalizationGap(0.95, [])).toBeNull()
    expect(generalizationGap(null, [0.5])).toBeNull()
    expect(formatPercent(0.4567, 1)).toBe('45.7%')
    expect(formatPercent(null)).toBe('—')
  })
})

/**
 * 表格 MLP 引擎单测（TF.js CPU 后端，小数据）
 */
import { describe, it, expect } from 'vitest'
import { buildEncoder, encodeRow, trainMlp, predictMlp, serializeMlp, deserializeMlp } from '../../../pages/aiLab/engine/tabular/mlp'

const columns = [{ key: 'length', type: 'number' }, { key: 'material', type: 'category' }, { key: 'name', type: 'text' }]
const rows = []
for (let i = 0; i < 24; i += 1) {
  rows.push({ id: `a${i}`, label: 'book', payload: { length: 20 + (i % 4), material: 'paper', name: `b${i}` } })
  rows.push({ id: `c${i}`, label: 'cup', payload: { length: 7 + (i % 3), material: i % 2 ? 'metal' : 'plastic', name: `c${i}` } })
}

describe('mlp', () => {
  it('encodes numeric (standardized) and categorical (one-hot) columns, ignoring text columns', () => {
    const enc = buildEncoder(rows, columns)
    expect(enc.fields.map((f) => f.key)).toEqual(['length', 'material'])
    expect(enc.dim).toBe(1 + 3)
    const x = encodeRow(enc, { length: 21, material: 'metal' })
    expect(x.length).toBe(4)
    expect(Array.from(x.slice(1)).filter((v) => v === 1)).toHaveLength(1)
    expect(Array.from(encodeRow(enc, { length: 21, material: 'wood' }).slice(1))).toEqual([0, 0, 0])
  })

  it('learns a separable table and survives serialization', async () => {
    const epochs = []
    const mlp = await trainMlp(rows, columns, { epochs: 40, hidden: 8, learningRate: 0.05, onEpoch: (e) => epochs.push(e) })
    expect(epochs).toHaveLength(40)
    expect(mlp.history[39].loss).toBeLessThan(mlp.history[0].loss)
    const correct = rows.filter((r) => predictMlp(mlp, r.payload).label === r.label).length
    expect(correct / rows.length).toBeGreaterThan(0.9)
    const json = JSON.parse(JSON.stringify(serializeMlp(mlp, { dataset_version: 1 })))
    const back = deserializeMlp(json)
    expect(predictMlp(back, { length: 21, material: 'paper' }).label).toBe('book')
    expect(predictMlp(back, { length: 8, material: 'metal' }).label).toBe('cup')
    expect(() => deserializeMlp({ engine: 'table-tree' })).toThrow()
  }, 60000)
})

describe('mlp reproducibility', () => {
  it('same seed → identical loss curve; different seed → different curve', async () => {
    const a = await trainMlp(rows, columns, { epochs: 12, hidden: 8, seed: 7 })
    const b = await trainMlp(rows, columns, { epochs: 12, hidden: 8, seed: 7 })
    const c = await trainMlp(rows, columns, { epochs: 12, hidden: 8, seed: 8 })
    expect(a.history.map((h) => h.loss.toFixed(6))).toEqual(b.history.map((h) => h.loss.toFixed(6)))
    expect(a.history[0].loss).not.toBeCloseTo(c.history[0].loss, 6)
    expect(serializeMlp(a).seed).toBe(7)
    expect(deserializeMlp(serializeMlp(a)).seed).toBe(7)
  })
})

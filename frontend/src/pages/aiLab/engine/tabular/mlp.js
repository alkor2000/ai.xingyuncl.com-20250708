/**
 * 表格数据的小神经网络（多层感知机）：数值列标准化、类别列独热 → 1 个隐藏层(ReLU) → softmax
 * 用 TF.js 在浏览器里训练几十轮，记录每轮损失与训练准确率；权重可序列化保存为 artifact。
 * 与决策树用同一批训练行、同一留出集，供 M3"决策树 vs 神经网络"对照。
 */
import * as tf from '@tensorflow/tfjs'

export const DEFAULT_MLP = { hidden: 16, epochs: 80, learningRate: 0.03, batchSize: 16, seed: 42 }

/* 与后端 splitHoldout 同一个 mulberry32：同一 seed 下权重初始化与样本顺序都固定，M3 对照才能复现 */
function mulberry32(a) {
  let state = a >>> 0
  return () => { state = (state + 0x6D2B79F5) | 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
function shuffled(rows, seed) {
  const rnd = mulberry32(seed)
  const out = rows.slice()
  for (let i = out.length - 1; i > 0; i -= 1) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]] }
  return out
}

/** 从训练行学出编码器：数值列 mean/std，类别列取值表；text 列忽略 */
export function buildEncoder(rows, columns) {
  const fields = []
  columns.forEach((col) => {
    if (col.type === 'number') {
      const vals = rows.map((r) => Number(r.payload?.[col.key])).filter(Number.isFinite)
      const mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1)
      const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length || 1)) || 1
      fields.push({ key: col.key, type: 'number', mean, std })
    } else if (col.type === 'category') {
      const values = Array.from(new Set(rows.map((r) => r.payload?.[col.key]).filter((v) => v !== undefined && v !== null && v !== '').map(String)))
      fields.push({ key: col.key, type: 'category', values })
    }
  })
  const dim = fields.reduce((a, f) => a + (f.type === 'number' ? 1 : f.values.length), 0)
  return { fields, dim }
}

export function encodeRow(encoder, payload) {
  const x = new Float32Array(encoder.dim)
  let o = 0
  encoder.fields.forEach((f) => {
    if (f.type === 'number') {
      const v = Number(payload?.[f.key])
      x[o] = Number.isFinite(v) ? (v - f.mean) / f.std : 0
      o += 1
    } else {
      const idx = f.values.indexOf(String(payload?.[f.key]))
      if (idx >= 0) x[o + idx] = 1
      o += f.values.length
    }
  })
  return x
}

function buildModel(dim, hidden, nClasses, seed) {
  const model = tf.sequential()
  model.add(tf.layers.dense({ inputShape: [dim], units: hidden, activation: 'relu', kernelInitializer: tf.initializers.glorotUniform({ seed }) }))
  model.add(tf.layers.dense({ units: nClasses, activation: 'softmax', kernelInitializer: tf.initializers.glorotUniform({ seed: seed + 1 }) }))
  return model
}

/**
 * @param {{id:any,label:string,payload:Object}[]} rows
 * @param {{key:string,type:string}[]} columns
 * @param {{hidden?:number,epochs?:number,learningRate?:number,batchSize?:number,onEpoch?:function}} [params]
 */
export async function trainMlp(rows, columns, params = {}) {
  if (!rows.length) throw new Error('no training rows')
  const p = { ...DEFAULT_MLP, ...params }
  const encoder = buildEncoder(rows, columns)
  const classKeys = Array.from(new Set(rows.map((r) => r.label)))
  const seed = Number.isInteger(p.seed) ? p.seed : DEFAULT_MLP.seed
  const ordered = shuffled(rows, seed)
  const xs = tf.tensor2d(ordered.map((r) => Array.from(encodeRow(encoder, r.payload))), [ordered.length, encoder.dim])
  const ys = tf.oneHot(tf.tensor1d(ordered.map((r) => classKeys.indexOf(r.label)), 'int32'), classKeys.length)
  const model = buildModel(encoder.dim, p.hidden, classKeys.length, seed)
  model.compile({ optimizer: tf.train.adam(p.learningRate), loss: 'categoricalCrossentropy', metrics: ['accuracy'] })
  const history = []
  await model.fit(xs, ys, {
    epochs: p.epochs,
    batchSize: Math.min(p.batchSize, rows.length),
    shuffle: false, // 顺序已用 seed 洗好，关掉 TF.js 自带的不可复现洗牌
    verbose: 0,
    callbacks: { onEpochEnd: (epoch, logs) => { history.push({ epoch: epoch + 1, loss: logs.loss, acc: logs.acc ?? logs.accuracy }); if (p.onEpoch) p.onEpoch(epoch + 1, p.epochs, logs) } }
  })
  xs.dispose(); ys.dispose()
  return { engine: 'table-mlp', model, encoder, classKeys, hidden: p.hidden, epochs: p.epochs, learningRate: p.learningRate, seed, history, trainIds: rows.map((r) => r.id) }
}

export function predictMlp(mlp, payload) {
  const x = encodeRow(mlp.encoder, payload)
  const probs = tf.tidy(() => mlp.model.predict(tf.tensor2d(Array.from(x), [1, mlp.encoder.dim])).dataSync())
  let best = 0
  for (let i = 1; i < probs.length; i += 1) if (probs[i] > probs[best]) best = i
  const scores = {}
  mlp.classKeys.forEach((c, i) => { scores[c] = probs[i] })
  return { label: mlp.classKeys[best], confidence: probs[best], scores }
}

export function serializeMlp(mlp, extra = {}) {
  const weights = mlp.model.getWeights().map((w) => ({ shape: w.shape, data: Array.from(w.dataSync()).map((v) => Number(v.toFixed(6))) }))
  return { engine: 'table-mlp', encoder: mlp.encoder, classKeys: mlp.classKeys, hidden: mlp.hidden, epochs: mlp.epochs, learningRate: mlp.learningRate, seed: mlp.seed, history: mlp.history, weights, trainIds: mlp.trainIds, ...extra }
}

export function deserializeMlp(json) {
  if (!json || json.engine !== 'table-mlp' || !json.weights) throw new Error('not a table-mlp artifact')
  const model = buildModel(json.encoder.dim, json.hidden, json.classKeys.length, Number.isInteger(json.seed) ? json.seed : DEFAULT_MLP.seed)
  model.setWeights(json.weights.map((w) => tf.tensor(w.data, w.shape)))
  return { engine: 'table-mlp', model, encoder: json.encoder, classKeys: json.classKeys, hidden: json.hidden, epochs: json.epochs, learningRate: json.learningRate, seed: json.seed, history: json.history || [], trainIds: json.trainIds || [] }
}

/**
 * k 近邻分类器（余弦相似度，向量已 L2 归一化，点积即相似度）
 *
 * 纯 JavaScript，不依赖 TensorFlow，便于单测与序列化。
 * 训练 = 记住训练样本的向量与标签；预测 = 找最近的 k 个邻居按相似度加权投票。
 */

export const DEFAULT_K = 5

/**
 * @param {{id:number|string, label:string, vec:Float32Array|number[]}[]} samples
 * @param {{k?:number}} [params]
 */
export function trainKnn(samples, params = {}) {
  if (!samples.length) throw new Error('no training samples')
  const dim = samples[0].vec.length
  const vectors = samples.map((s) => Float32Array.from(s.vec))
  const labels = samples.map((s) => s.label)
  const ids = samples.map((s) => s.id)
  const classKeys = Array.from(new Set(labels))
  const k = Math.max(1, Math.min(params.k || DEFAULT_K, samples.length))
  return { engine: 'image-knn', dim, k, vectors, labels, ids, classKeys }
}

function dot(a, b) {
  let s = 0
  for (let i = 0; i < a.length; i += 1) s += a[i] * b[i]
  return s
}

/**
 * @returns {{label:string, confidence:number, scores:Object<string,number>, neighbors:{id:any,label:string,sim:number}[]}}
 */
export function predictKnn(model, vec, kOverride) {
  const k = Math.max(1, Math.min(kOverride || model.k, model.vectors.length))
  const sims = model.vectors.map((v, i) => ({ i, sim: dot(v, vec) }))
  sims.sort((a, b) => b.sim - a.sim)
  const top = sims.slice(0, k)
  const scores = {}
  model.classKeys.forEach((c) => { scores[c] = 0 })
  let total = 0
  top.forEach(({ i, sim }) => {
    const w = Math.max(sim, 0) + 1e-6
    scores[model.labels[i]] += w
    total += w
  })
  let best = model.classKeys[0]
  model.classKeys.forEach((c) => { if (scores[c] > scores[best]) best = c })
  const normalized = {}
  model.classKeys.forEach((c) => { normalized[c] = total > 0 ? scores[c] / total : 0 })
  return {
    label: best,
    confidence: normalized[best],
    scores: normalized,
    neighbors: top.map(({ i, sim }) => ({ id: model.ids[i], label: model.labels[i], sim }))
  }
}

/** 序列化为可存到服务器的 JSON（向量保留 5 位小数） */
export function serializeKnn(model, extra = {}) {
  return {
    engine: model.engine,
    dim: model.dim,
    k: model.k,
    classKeys: model.classKeys,
    samples: model.vectors.map((v, i) => ({
      id: model.ids[i],
      label: model.labels[i],
      vec: Array.from(v, (x) => Math.round(x * 1e5) / 1e5)
    })),
    ...extra
  }
}

export function deserializeKnn(json) {
  return trainKnn(json.samples, { k: json.k })
}

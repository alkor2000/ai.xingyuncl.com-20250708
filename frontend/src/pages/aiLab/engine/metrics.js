/**
 * 评测指标：准确率、逐类精确率/召回率、混淆矩阵、泛化差距
 * 所有数字来自实际预测结果，不做任何估算。
 */

/**
 * @param {{id:any, actual:string, predicted:string, confidence:number}[]} predictions
 * @param {string[]} classKeys 固定标签顺序
 */
export function computeMetrics(predictions, classKeys) {
  const labels = [...classKeys]
  predictions.forEach((p) => {
    if (!labels.includes(p.actual)) labels.push(p.actual)
    if (!labels.includes(p.predicted)) labels.push(p.predicted)
  })
  const index = Object.fromEntries(labels.map((l, i) => [l, i]))
  const matrix = labels.map(() => labels.map(() => 0))
  let correct = 0
  predictions.forEach((p) => {
    matrix[index[p.actual]][index[p.predicted]] += 1
    if (p.actual === p.predicted) correct += 1
  })
  const per_class = {}
  labels.forEach((l, i) => {
    const support = matrix[i].reduce((a, b) => a + b, 0)
    const tp = matrix[i][i]
    const predictedAs = matrix.reduce((a, row) => a + row[i], 0)
    per_class[l] = {
      support,
      recall: support ? tp / support : null,
      precision: predictedAs ? tp / predictedAs : null
    }
  })
  return {
    accuracy: predictions.length ? correct / predictions.length : null,
    sample_count: predictions.length,
    per_class,
    confusion: { labels, matrix }
  }
}

/** 泛化差距 = 留出集准确率 − 最差的换条件集准确率（没有换条件测试时为 null） */
export function generalizationGap(holdoutAccuracy, shiftAccuracies) {
  const values = (shiftAccuracies || []).filter((v) => typeof v === 'number')
  if (typeof holdoutAccuracy !== 'number' || !values.length) return null
  return holdoutAccuracy - Math.min(...values)
}

/**
 * 准确率的 95% 置信区间（Wilson 区间）：测试集只有几十张时，分数本身有 ±10% 左右的抖动，
 * 比较两个版本前先看区间是否重叠。correct/total 为整数；total=0 时返回 null。
 */
export function wilsonInterval(correct, total, z = 1.96) {
  if (!Number.isFinite(correct) || !Number.isFinite(total) || total <= 0) return null
  const p = correct / total
  const z2 = z * z
  const denom = 1 + z2 / total
  const center = (p + z2 / (2 * total)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denom
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) }
}

export function formatPercent(v, digits = 0) {
  if (typeof v !== 'number' || Number.isNaN(v)) return '—'
  return `${(v * 100).toFixed(digits)}%`
}

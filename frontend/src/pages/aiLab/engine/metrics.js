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

export function formatPercent(v, digits = 0) {
  if (typeof v !== 'number' || Number.isNaN(v)) return '—'
  return `${(v * 100).toFixed(digits)}%`
}

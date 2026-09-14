/**
 * 两名标注者的一致性：观察一致率与 Cohen's kappa，以及不一致清单
 * @param {{id:any, a?:string, b?:string}[]} rows 只统计 a、b 都填了的行
 */
export function cohenKappa(rows) {
  const both = rows.filter((r) => r.a && r.b)
  const n = both.length
  if (!n) return { n: 0, agreement: null, kappa: null, disagreements: [] }
  const labels = Array.from(new Set(both.flatMap((r) => [r.a, r.b])))
  let agree = 0
  const countA = {}
  const countB = {}
  labels.forEach((l) => { countA[l] = 0; countB[l] = 0 })
  both.forEach((r) => { if (r.a === r.b) agree += 1; countA[r.a] += 1; countB[r.b] += 1 })
  const po = agree / n
  let pe = 0
  labels.forEach((l) => { pe += (countA[l] / n) * (countB[l] / n) })
  const kappa = pe === 1 ? 1 : (po - pe) / (1 - pe)
  return { n, agreement: po, kappa, disagreements: both.filter((r) => r.a !== r.b) }
}

/** kappa 的通俗等级 */
export function kappaLevel(k) {
  if (typeof k !== 'number' || Number.isNaN(k)) return 'none'
  if (k >= 0.8) return 'excellent'
  if (k >= 0.6) return 'good'
  if (k >= 0.4) return 'fair'
  return 'poor'
}

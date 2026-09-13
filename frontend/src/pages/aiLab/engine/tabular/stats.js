/**
 * 表格数据的描述统计：给学生看"每一类在每一列上大概是什么范围"，帮助写规则
 */

function quantile(sorted, q) {
  if (!sorted.length) return null
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/**
 * @param {{label:string,payload:Object}[]} rows
 * @param {{key:string,type:string}[]} columns
 * @returns {Object<string, Object<string, {n:number,min:number,q1:number,median:number,q3:number,max:number,mean:number}|Object<string,number>>>}
 *   colKey -> classKey -> 数值列五数概括 / 类别列取值计数
 */
export function summarizeColumns(rows, columns) {
  const out = {}
  columns.forEach((col) => {
    out[col.key] = {}
    const byClass = {}
    rows.forEach((r) => {
      const v = r.payload?.[col.key]
      if (v === undefined || v === null || v === '') return
      byClass[r.label] = byClass[r.label] || []
      byClass[r.label].push(v)
    })
    Object.entries(byClass).forEach(([label, values]) => {
      if (col.type === 'number') {
        const nums = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b)
        const mean = nums.reduce((a, b) => a + b, 0) / (nums.length || 1)
        out[col.key][label] = { n: nums.length, min: nums[0], q1: quantile(nums, 0.25), median: quantile(nums, 0.5), q3: quantile(nums, 0.75), max: nums[nums.length - 1], mean: Number(mean.toFixed(3)) }
      } else {
        const counts = {}
        values.forEach((v) => { counts[String(v)] = (counts[String(v)] || 0) + 1 })
        out[col.key][label] = counts
      }
    })
  })
  return out
}

/** 某列全部取值（类别列用于下拉），最多 max 个，按出现次数降序 */
export function columnValues(rows, colKey, max = 30) {
  const counts = {}
  rows.forEach((r) => {
    const v = r.payload?.[colKey]
    if (v === undefined || v === null || v === '') return
    counts[String(v)] = (counts[String(v)] || 0) + 1
  })
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, max).map(([v]) => v)
}

/** 数值列范围（用于散点图坐标） */
export function columnRange(rows, colKey) {
  let min = Infinity
  let max = -Infinity
  rows.forEach((r) => {
    const v = Number(r.payload?.[colKey])
    if (!Number.isFinite(v)) return
    if (v < min) min = v
    if (v > max) max = v
  })
  if (min === Infinity) return null
  if (min === max) return { min: min - 1, max: max + 1 }
  const pad = (max - min) * 0.05
  return { min: min - pad, max: max + pad }
}

/**
 * 决策树分类器（CART，基尼不纯度）——表格数据实验用，纯 JavaScript
 *
 * rows: [{id, label, payload:{colKey: value}}]；columns: [{key, type:'number'|'category'}]
 * 数值列按阈值二分（<= 走左），类别列按"等于某个值"二分（等于走左）；缺失值一律走右。
 * 树结构可直接 JSON 序列化保存为模型 artifact，也能转成与手写规则同构的规则列表，便于并排对照。
 */

export const DEFAULT_MAX_DEPTH = 3
const MAX_NUMERIC_THRESHOLDS = 64

function gini(counts, n) {
  if (!n) return 0
  let s = 0
  Object.values(counts).forEach((c) => { const p = c / n; s += p * p })
  return 1 - s
}

function countLabels(rows) {
  const counts = {}
  rows.forEach((r) => { counts[r.label] = (counts[r.label] || 0) + 1 })
  return counts
}

function majority(counts) {
  let best = null
  Object.entries(counts).forEach(([label, c]) => { if (best === null || c > counts[best]) best = label })
  return best
}

function goesLeft(node, payload) {
  const v = payload ? payload[node.col] : undefined
  if (v === undefined || v === null || v === '') return false
  if (node.type === 'number') {
    const num = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(num) && num <= node.threshold
  }
  return String(v) === String(node.value)
}

function candidateThresholds(values) {
  const uniq = Array.from(new Set(values)).sort((a, b) => a - b)
  if (uniq.length < 2) return []
  const mids = []
  for (let i = 1; i < uniq.length; i += 1) mids.push((uniq[i - 1] + uniq[i]) / 2)
  if (mids.length <= MAX_NUMERIC_THRESHOLDS) return mids
  const step = mids.length / MAX_NUMERIC_THRESHOLDS
  const picked = []
  for (let i = 0; i < MAX_NUMERIC_THRESHOLDS; i += 1) picked.push(mids[Math.floor(i * step)])
  return picked
}

function bestSplit(rows, columns, parentGini) {
  const n = rows.length
  let best = null
  columns.forEach((col) => {
    const candidates = []
    if (col.type === 'number') {
      const nums = rows.map((r) => Number(r.payload?.[col.key])).filter((x) => Number.isFinite(x))
      candidateThresholds(nums).forEach((threshold) => candidates.push({ col: col.key, type: 'number', threshold }))
    } else {
      const values = new Set(rows.map((r) => r.payload?.[col.key]).filter((v) => v !== undefined && v !== null && v !== ''))
      values.forEach((value) => candidates.push({ col: col.key, type: 'category', value: String(value) }))
    }
    candidates.forEach((cand) => {
      const left = []
      const right = []
      rows.forEach((r) => (goesLeft(cand, r.payload) ? left : right).push(r))
      if (!left.length || !right.length) return
      const g = (left.length / n) * gini(countLabels(left), left.length) + (right.length / n) * gini(countLabels(right), right.length)
      const gain = parentGini - g
      if (gain > 1e-9 && (!best || gain > best.gain)) best = { ...cand, gain, left, right }
    })
  })
  return best
}

function build(rows, columns, depth, opts) {
  const counts = countLabels(rows)
  const n = rows.length
  const label = majority(counts)
  const parentGini = gini(counts, n)
  const leaf = { leaf: true, label, counts, n }
  if (depth >= opts.maxDepth || n < opts.minSamples * 2 || parentGini === 0) return leaf
  const split = bestSplit(rows, columns, parentGini)
  if (!split || split.left.length < opts.minSamples || split.right.length < opts.minSamples) return leaf
  const node = { leaf: false, col: split.col, type: split.type, counts, n, label, gain: Number(split.gain.toFixed(6)) }
  if (split.type === 'number') node.threshold = Number(split.threshold.toFixed(4))
  else node.value = split.value
  node.left = build(split.left, columns, depth + 1, opts)
  node.right = build(split.right, columns, depth + 1, opts)
  return node
}

/**
 * @param {{id:any,label:string,payload:Object}[]} rows
 * @param {{key:string,type:string}[]} columns
 * @param {{maxDepth?:number,minSamples?:number}} [params]
 */
export function trainTree(rows, columns, params = {}) {
  if (!rows.length) throw new Error('no training rows')
  const maxDepth = Math.max(1, params.maxDepth || DEFAULT_MAX_DEPTH)
  const minSamples = Math.max(1, params.minSamples || 2)
  const usable = columns.filter((c) => c && c.key)
  const root = build(rows, usable, 0, { maxDepth, minSamples })
  const classKeys = Array.from(new Set(rows.map((r) => r.label)))
  return { engine: 'table-tree', maxDepth, minSamples, columns: usable.map((c) => ({ key: c.key, type: c.type })), classKeys, root, trainIds: rows.map((r) => r.id) }
}

/** @returns {{label:string, confidence:number, path:{col:string,type:string,threshold?:number,value?:string,left:boolean}[]}} */
export function predictTree(model, payload) {
  let node = model.root
  const path = []
  while (!node.leaf) {
    const left = goesLeft(node, payload)
    path.push({ col: node.col, type: node.type, threshold: node.threshold, value: node.value, left })
    node = left ? node.left : node.right
  }
  return { label: node.label, confidence: node.n ? (node.counts[node.label] || 0) / node.n : 0, path }
}

export function treeDepth(node) {
  if (!node || node.leaf) return 0
  return 1 + Math.max(treeDepth(node.left), treeDepth(node.right))
}

export function countLeaves(node) {
  if (!node) return 0
  if (node.leaf) return 1
  return countLeaves(node.left) + countLeaves(node.right)
}

/**
 * 把树展开成"条件列表 → 类别"的规则，与手写规则（rules.js）同构，便于并排展示
 * 数值列：左支 op '<='，右支 op '>'；类别列：左支 '=='，右支 '!='
 */
export function treeToRules(model) {
  const rules = []
  const walk = (node, conditions) => {
    if (node.leaf) {
      rules.push({ conditions, label: node.label, n: node.n, purity: node.n ? (node.counts[node.label] || 0) / node.n : 0 })
      return
    }
    const isNum = node.type === 'number'
    walk(node.left, [...conditions, { col: node.col, op: isNum ? '<=' : '==', value: isNum ? node.threshold : node.value }])
    walk(node.right, [...conditions, { col: node.col, op: isNum ? '>' : '!=', value: isNum ? node.threshold : node.value }])
  }
  walk(model.root, [])
  return rules
}

export function serializeTree(model, extra = {}) {
  return { engine: 'table-tree', maxDepth: model.maxDepth, minSamples: model.minSamples, columns: model.columns, classKeys: model.classKeys, root: model.root, trainIds: model.trainIds, ...extra }
}

export function deserializeTree(json) {
  if (!json || json.engine !== 'table-tree' || !json.root) throw new Error('not a table-tree artifact')
  return { engine: 'table-tree', maxDepth: json.maxDepth, minSamples: json.minSamples, columns: json.columns || [], classKeys: json.classKeys || [], root: json.root, trainIds: json.trainIds || [] }
}

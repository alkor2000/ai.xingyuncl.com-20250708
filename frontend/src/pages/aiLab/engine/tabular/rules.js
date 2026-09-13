/**
 * 手写规则分类器——学生用"如果 … 那么 …"写出的判断规则，与数据训练出的决策树在同一批测试集上对照
 *
 * ruleSet = { rules:[{ conditions:[{col, op, value}], label }], default_label }
 * 自上而下取第一条全部条件成立的规则；都不成立取 default_label。缺失值使任何条件都不成立。
 */

export const RULE_OPS = ['<', '<=', '>', '>=', '==', '!=']
export const NUMBER_OPS = ['<', '<=', '>', '>=', '==', '!=']
export const CATEGORY_OPS = ['==', '!=']

function conditionHolds(cond, payload, columnTypes) {
  const raw = payload ? payload[cond.col] : undefined
  if (raw === undefined || raw === null || raw === '') return false
  const type = columnTypes[cond.col] || (typeof raw === 'number' ? 'number' : 'category')
  if (type === 'number') {
    const a = typeof raw === 'number' ? raw : Number(raw)
    const b = Number(cond.value)
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false
    switch (cond.op) {
      case '<': return a < b
      case '<=': return a <= b
      case '>': return a > b
      case '>=': return a >= b
      case '==': return a === b
      case '!=': return a !== b
      default: return false
    }
  }
  const s = String(raw)
  if (cond.op === '==') return s === String(cond.value)
  if (cond.op === '!=') return s !== String(cond.value)
  return false
}

/** @returns {{label:string|null, rule_index:number}} rule_index = -1 表示落到默认类别 */
export function evaluateRules(ruleSet, payload, columns = []) {
  const columnTypes = Object.fromEntries((columns || []).map((c) => [c.key, c.type]))
  const rules = ruleSet?.rules || []
  for (let i = 0; i < rules.length; i += 1) {
    const r = rules[i]
    const conds = r.conditions || []
    if (conds.length && conds.every((c) => conditionHolds(c, payload, columnTypes))) return { label: r.label, rule_index: i }
  }
  return { label: ruleSet?.default_label ?? null, rule_index: -1 }
}

/** 返回问题列表（空数组 = 合法）；每项 {rule, condition, code} */
export function validateRuleSet(ruleSet, columns, classKeys) {
  const problems = []
  const colMap = Object.fromEntries((columns || []).map((c) => [c.key, c]))
  const rules = ruleSet?.rules || []
  if (!rules.length) problems.push({ rule: -1, condition: -1, code: 'no_rules' })
  rules.forEach((r, ri) => {
    if (!classKeys.includes(r.label)) problems.push({ rule: ri, condition: -1, code: 'bad_label' })
    if (!r.conditions?.length) problems.push({ rule: ri, condition: -1, code: 'no_conditions' })
    ;(r.conditions || []).forEach((c, ci) => {
      const col = colMap[c.col]
      if (!col) { problems.push({ rule: ri, condition: ci, code: 'bad_column' }); return }
      const ops = col.type === 'number' ? NUMBER_OPS : CATEGORY_OPS
      if (!ops.includes(c.op)) problems.push({ rule: ri, condition: ci, code: 'bad_op' })
      if (c.value === undefined || c.value === null || c.value === '') problems.push({ rule: ri, condition: ci, code: 'no_value' })
      else if (col.type === 'number' && !Number.isFinite(Number(c.value))) problems.push({ rule: ri, condition: ci, code: 'not_number' })
    })
  })
  if (ruleSet?.default_label && !classKeys.includes(ruleSet.default_label)) problems.push({ rule: -1, condition: -1, code: 'bad_default' })
  return problems
}

export function serializeRules(ruleSet, extra = {}) {
  return { engine: 'table-rules', rules: ruleSet.rules, default_label: ruleSet.default_label ?? null, columns: ruleSet.columns || [], classKeys: ruleSet.classKeys || [], ...extra }
}

export function deserializeRules(json) {
  if (!json || json.engine !== 'table-rules' || !Array.isArray(json.rules)) throw new Error('not a table-rules artifact')
  return { engine: 'table-rules', rules: json.rules, default_label: json.default_label ?? null, columns: json.columns || [], classKeys: json.classKeys || [] }
}

/**
 * 多项式朴素贝叶斯文本分类器（拉普拉斯平滑），纯 JavaScript。
 * 训练 = 数每类里每个 token 出现的次数；预测 = 先验 + Σ log P(token|类)；
 * 解释 = 哪些 token 把结果推向预测类（相对于第二名的对数似然差）。
 */
import { tokenize } from './tokenize'

export const DEFAULT_ALPHA = 1

/**
 * @param {{id:any,label:string,text:string}[]} samples
 * @param {{alpha?:number}} [params]
 */
export function trainNaiveBayes(samples, params = {}) {
  if (!samples.length) throw new Error('no training samples')
  const alpha = params.alpha > 0 ? params.alpha : DEFAULT_ALPHA
  const classKeys = Array.from(new Set(samples.map((s) => s.label)))
  const docCounts = {}
  const tokenCounts = {}
  const totals = {}
  const vocab = new Set()
  classKeys.forEach((c) => { docCounts[c] = 0; tokenCounts[c] = {}; totals[c] = 0 })
  samples.forEach((s) => {
    docCounts[s.label] += 1
    tokenize(s.text).forEach((tok) => {
      vocab.add(tok)
      tokenCounts[s.label][tok] = (tokenCounts[s.label][tok] || 0) + 1
      totals[s.label] += 1
    })
  })
  return { engine: 'text-nb', alpha, classKeys, docCounts, tokenCounts, totals, vocabSize: vocab.size, docTotal: samples.length, ids: samples.map((s) => s.id) }
}

function logProb(model, cls, tok) {
  return Math.log(((model.tokenCounts[cls][tok] || 0) + model.alpha) / (model.totals[cls] + model.alpha * model.vocabSize))
}

/**
 * @returns {{label:string, confidence:number, scores:Object<string,number>, tokens:string[], contributions:{token:string, weight:number}[]}}
 *   contributions：token 对"预测类 vs 第二名"的对数似然差，正数支持预测类
 */
export function predictNaiveBayes(model, text) {
  const tokens = tokenize(text)
  const logPost = {}
  model.classKeys.forEach((c) => {
    let lp = Math.log((model.docCounts[c] + model.alpha) / (model.docTotal + model.alpha * model.classKeys.length))
    tokens.forEach((tok) => { lp += logProb(model, c, tok) })
    logPost[c] = lp
  })
  const ranked = [...model.classKeys].sort((a, b) => logPost[b] - logPost[a])
  const best = ranked[0]
  const runner = ranked[1]
  const max = logPost[best]
  let z = 0
  model.classKeys.forEach((c) => { z += Math.exp(logPost[c] - max) })
  const scores = {}
  model.classKeys.forEach((c) => { scores[c] = Math.exp(logPost[c] - max) / z })
  const seen = new Set()
  const contributions = []
  tokens.forEach((tok) => {
    if (seen.has(tok)) return
    seen.add(tok)
    const w = runner ? logProb(model, best, tok) - logProb(model, runner, tok) : 0
    contributions.push({ token: tok, weight: w })
  })
  contributions.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
  return { label: best, confidence: scores[best], scores, tokens, contributions }
}

/** 每个类最有代表性的 token（按 P(tok|类) / 平均 P(tok|其他类) 排序），给"模型学到了什么"看 */
export function topTokens(model, cls, n = 12, minCount = 2) {
  const others = model.classKeys.filter((c) => c !== cls)
  const rows = Object.entries(model.tokenCounts[cls])
    .filter(([, count]) => count >= minCount)
    .map(([tok]) => {
      const own = Math.exp(logProb(model, cls, tok))
      const rest = others.length ? others.reduce((a, c) => a + Math.exp(logProb(model, c, tok)), 0) / others.length : 1e-9
      return { token: tok, ratio: own / rest, count: model.tokenCounts[cls][tok] }
    })
  rows.sort((a, b) => b.ratio - a.ratio)
  return rows.slice(0, n)
}

export function serializeNaiveBayes(model, extra = {}) {
  return { engine: 'text-nb', alpha: model.alpha, classKeys: model.classKeys, docCounts: model.docCounts, tokenCounts: model.tokenCounts, totals: model.totals, vocabSize: model.vocabSize, docTotal: model.docTotal, ids: model.ids, ...extra }
}

export function deserializeNaiveBayes(json) {
  if (!json || json.engine !== 'text-nb' || !json.tokenCounts) throw new Error('not a text-nb artifact')
  return { engine: 'text-nb', alpha: json.alpha || DEFAULT_ALPHA, classKeys: json.classKeys, docCounts: json.docCounts, tokenCounts: json.tokenCounts, totals: json.totals, vocabSize: json.vocabSize, docTotal: json.docTotal, ids: json.ids || [] }
}

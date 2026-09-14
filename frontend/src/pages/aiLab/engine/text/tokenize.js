/**
 * 中文短文本分词（无词典）：汉字按"单字 + 相邻双字"切，英文/数字按整词，标点与空白丢弃。
 * 双字词让模型能抓住"好吃""难受"这类情绪词，单字保证生僻组合也有覆盖。
 */
const CJK = /[㐀-鿿]/
const WORD = /[a-z0-9]+/g

export function tokenize(text) {
  const s = String(text || '').toLowerCase()
  const tokens = []
  let run = []
  const flushRun = () => {
    for (let i = 0; i < run.length; i += 1) {
      tokens.push(run[i])
      if (i + 1 < run.length) tokens.push(run[i] + run[i + 1])
    }
    run = []
  }
  let latin = ''
  const flushLatin = () => { if (latin) { tokens.push(latin); latin = '' } }
  for (const ch of s) {
    if (CJK.test(ch)) { flushLatin(); run.push(ch) } else if (/[a-z0-9]/.test(ch)) { flushRun(); latin += ch } else { flushRun(); flushLatin() }
  }
  flushRun(); flushLatin()
  return tokens
}

/** 去重后的 token 集合（伯努利式计数用不到，这里给解释用） */
export function uniqueTokens(text) {
  return Array.from(new Set(tokenize(text)))
}

export { WORD }

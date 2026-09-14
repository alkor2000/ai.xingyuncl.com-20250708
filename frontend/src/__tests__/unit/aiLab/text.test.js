/**
 * 文本引擎单测：分词、朴素贝叶斯、标注一致性（纯 JS）
 */
import { describe, it, expect } from 'vitest'
import { tokenize } from '../../../pages/aiLab/engine/text/tokenize'
import { trainNaiveBayes, predictNaiveBayes, topTokens, serializeNaiveBayes, deserializeNaiveBayes } from '../../../pages/aiLab/engine/text/naiveBayes'
import { cohenKappa, kappaLevel } from '../../../pages/aiLab/engine/text/agreement'

describe('tokenize', () => {
  it('splits CJK into chars and bigrams, keeps latin words, drops punctuation', () => {
    expect(tokenize('好吃！')).toEqual(['好', '好吃', '吃'])
    expect(tokenize('Wi-Fi 很快')).toEqual(['wi', 'fi', '很', '很快', '快'])
    expect(tokenize('')).toEqual([])
  })
})

const samples = [
  { id: 1, label: 'pos', text: '今天的饭很好吃，阿姨很热情' },
  { id: 2, label: 'pos', text: '老师讲得很清楚，我很开心' },
  { id: 3, label: 'pos', text: '操场翻新了，跑起来很舒服' },
  { id: 4, label: 'neg', text: '米饭又硬又凉，太难吃了' },
  { id: 5, label: 'neg', text: '作业太多了，写到很晚很难受' },
  { id: 6, label: 'neg', text: '厕所又堵了，味道很难闻' },
  { id: 7, label: 'neu', text: '食堂十一点半开门' },
  { id: 8, label: 'neu', text: '明天数学课带圆规' },
  { id: 9, label: 'neu', text: '图书馆晚上九点关门' }
]

describe('naive bayes', () => {
  it('classifies obvious sentences and explains with tokens', () => {
    const model = trainNaiveBayes(samples)
    expect(model.classKeys.sort()).toEqual(['neg', 'neu', 'pos'])
    const r = predictNaiveBayes(model, '今天的菜很好吃')
    expect(r.label).toBe('pos')
    expect(r.confidence).toBeGreaterThan(0.4)
    expect(Object.keys(r.scores)).toHaveLength(3)
    expect(r.contributions[0].token).toBeTruthy()
    expect(predictNaiveBayes(model, '太难吃了').label).toBe('neg')
    expect(predictNaiveBayes(model, '几点开门').label).toBe('neu')
  })
  it('exposes top tokens per class and round-trips serialization', () => {
    const model = trainNaiveBayes(samples)
    const tops = topTokens(model, 'neg', 5, 1).map((t) => t.token)
    expect(tops.length).toBeGreaterThan(0)
    const back = deserializeNaiveBayes(JSON.parse(JSON.stringify(serializeNaiveBayes(model, { dataset_version: 1 }))))
    expect(predictNaiveBayes(back, '今天的菜很好吃').label).toBe('pos')
    expect(() => deserializeNaiveBayes({ engine: 'image-knn' })).toThrow()
    expect(() => trainNaiveBayes([])).toThrow()
  })
})

describe('agreement', () => {
  it('computes agreement rate and kappa', () => {
    const perfect = cohenKappa([{ id: 1, a: 'x', b: 'x' }, { id: 2, a: 'y', b: 'y' }])
    expect(perfect.agreement).toBe(1)
    expect(perfect.kappa).toBe(1)
    const mixed = cohenKappa([{ id: 1, a: 'x', b: 'x' }, { id: 2, a: 'x', b: 'y' }, { id: 3, a: 'y', b: 'y' }, { id: 4, a: 'y', b: 'x' }, { id: 5, a: 'x' }])
    expect(mixed.n).toBe(4)
    expect(mixed.agreement).toBe(0.5)
    expect(mixed.kappa).toBeCloseTo(0, 5)
    expect(mixed.disagreements.map((d) => d.id)).toEqual([2, 4])
    expect(cohenKappa([]).kappa).toBeNull()
    expect(kappaLevel(0.85)).toBe('excellent')
    expect(kappaLevel(0.1)).toBe('poor')
    expect(kappaLevel(null)).toBe('none')
  })
})

/**
 * latexToText 测试：模型在课件/文档里写的 LaTeX 公式折成可读 Unicode 文本
 */
import { describe, it, expect } from 'vitest'
import { latexToText, convertMathInMarkdown, hasMath } from '../../../utils/canvas/latexToText'

describe('latexToText()', () => {
  it('光合作用方程式：\\text、\\xrightarrow 上下标注都折成文字', () => {
    const src = String.raw`\text{二氧化碳} + \text{水} \xrightarrow[\text{叶绿体}]{\text{光能}} \text{有机物（储存能量）} + \text{氧气}`
    expect(latexToText(src)).toBe('二氧化碳 + 水 ─光能（叶绿体）→ 有机物（储存能量） + 氧气')
  })

  it('化学式上下标、\\ce、希腊字母与运算符', () => {
    expect(latexToText(String.raw`6CO_2 + 6H_2O \xrightarrow{光能} C_6H_{12}O_6 + 6O_2`)).toBe('6CO₂ + 6H₂O ─光能→ C₆H₁₂O₆ + 6O₂')
    expect(latexToText(String.raw`\ce{2H2 + O2 -> 2H2O}`)).toBe('2H₂ + O₂ → 2H₂O')
    expect(latexToText(String.raw`\alpha + \beta \le \gamma \times 10^{-3}`)).toBe('α + β ≤ γ × 10⁻³')
    expect(latexToText('E = mc^2')).toBe('E = mc²')
  })

  it('分数、根号、求和；中文下标直接跟在后面', () => {
    expect(latexToText(String.raw`x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`)).toBe('x = (-b ± √(b² - 4ac))/2a')
    expect(latexToText(String.raw`\sum_{i=1}^{n} x_i`)).toBe('Σᵢ₌₁ⁿ xᵢ')
    expect(latexToText(String.raw`v_{平均} = \frac{s}{t}`)).toBe('v平均 = s/t')
  })

  it('未知命令保留参数文字，排版命令被忽略', () => {
    expect(latexToText(String.raw`\left( \foo{abc} \right) \displaystyle x`)).toBe('( abc ) x')
  })
})

describe('convertMathInMarkdown()', () => {
  it('替换 $$…$$、$…$、\\(…\\)，跳过代码块与行内代码，不碰美元金额', () => {
    const md = '价格 $5 和 $10 不是公式；行内 $H_2O$ 是；`$x$` 代码不动\n\n$$\nE=mc^2\n$$\n\n```\n$a$ 代码块不动\n```\n结束 \\(x^2\\)'
    expect(convertMathInMarkdown(md)).toBe('价格 $5 和 $10 不是公式；行内 H₂O 是；`$x$` 代码不动\n\nE=mc²\n\n```\n$a$ 代码块不动\n```\n结束 x²')
  })

  it('没有公式时原样返回', () => {
    expect(convertMathInMarkdown('普通文字')).toBe('普通文字')
    expect(hasMath('普通文字 $5')).toBe(false)
    expect(hasMath('$x^2$')).toBe(true)
  })
})

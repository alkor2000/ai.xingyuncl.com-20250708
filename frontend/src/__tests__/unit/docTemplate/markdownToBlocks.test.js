/**
 * Markdown → 公文内容（字段猜测 + 正文块）
 */
import { describe, it, expect } from 'vitest'
import { markdownToContent, textToContent, detectFields } from '../../../utils/docTemplate/markdownToBlocks'

const md = `# 关于举办冬季读书月活动的通知

各年级组、图书馆：

为营造书香校园，学校决定于 **12 月**举办读书月活动，现将有关事项通知如下。

## 一、活动安排

1. 每班推荐 3 本好书
2. 图书馆汇总后展出

| 日期 | 活动 |
| --- | --- |
| 12月1日 | 启动仪式 |

附件：1. 读书月活动安排表
2. 好书推荐表

北京市某某中学
教务处
二〇二六年十一月二十日
`

describe('markdownToContent', () => {
  it('猜出标题、主送机关、附件、落款、日期，其余是正文块', () => {
    const c = markdownToContent(md)
    expect(c.title).toBe('关于举办冬季读书月活动的通知')
    expect(c.recipient).toBe('各年级组、图书馆：')
    expect(c.attachments).toEqual(['附件：1. 读书月活动安排表', '2. 好书推荐表'])
    expect(c.signer).toEqual(['北京市某某中学', '教务处'])
    expect(c.date).toBe('二〇二六年十一月二十日')
    expect(c.blocks.map((b) => b.type)).toEqual(['paragraph', 'heading', 'list', 'table'])
    expect(c.blocks[0].runs.find((r) => r.bold).text).toBe('12 月')
    expect(c.blocks[1]).toMatchObject({ level: 2 })
    expect(c.blocks[2]).toMatchObject({ ordered: true })
    expect(c.blocks[2].items).toHaveLength(2)
    expect(c.blocks[3].rows[1][0].runs[0].text).toBe('12月1日')
  })

  it('没有公文结构时字段为空，全部当正文', () => {
    const c = markdownToContent('第一段。\n\n第二段很长很长很长很长很长很长很长很长很长很长。')
    expect(c.title).toBe('')
    expect(c.recipient).toBe('')
    expect(c.date).toBe('')
    expect(c.blocks).toHaveLength(2)
  })

  it('嵌套列表扁平化并缩进', () => {
    const c = markdownToContent('- 甲\n  - 乙\n- 丙')
    expect(c.blocks[0].items.map((i) => i.runs.map((r) => r.text).join(''))).toEqual(['甲', '　乙', '丙'])
  })
})

describe('textToContent / detectFields', () => {
  it('粘贴文字：# 当标题，末尾日期与落款', () => {
    const c = textToContent('# 通知\n各位老师：\n明天开会。\n办公室\n2026年1月8日')
    expect(c.title).toBe('通知')
    expect(c.recipient).toBe('各位老师：')
    expect(c.signer).toEqual(['办公室'])
    expect(c.date).toBe('2026年1月8日')
    expect(c.blocks).toEqual([{ type: 'paragraph', runs: [{ text: '明天开会。' }] }])
  })

  it('粘贴文字没有 # 时第一行短句当标题', () => {
    const c = textToContent('关于放假的通知\n各位同学：\n明天放假，请注意安全。')
    expect(c.title).toBe('关于放假的通知')
    expect(c.recipient).toBe('各位同学：')
    expect(c.blocks).toHaveLength(1)
  })

  it('以句号结尾的短句不当落款', () => {
    const { fields } = detectFields([{ type: 'paragraph', runs: [{ text: '请知悉。' }] }, { type: 'paragraph', runs: [{ text: '2026年1月8日' }] }])
    expect(fields.date).toBe('2026年1月8日')
    expect(fields.signer).toEqual([])
  })
})

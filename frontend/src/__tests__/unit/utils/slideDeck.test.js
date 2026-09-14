/**
 * slideDeck 解析器测试：Marp 风格 Markdown → 结构化 deck
 */
import { describe, it, expect } from 'vitest'
import { parseSlideDeck, parseInlineRuns, runsToText, SLIDE_LAYOUTS, SMART_LAYOUTS } from '../../../utils/canvas/slideDeck'

const SAMPLE = `---
marp: true
theme: default
---

# 光合作用
初中生物 · 第三单元

---

# 什么是光合作用

- 植物利用**光能**把二氧化碳和水转化为有机物
- 同时释放氧气
  - 场所：叶绿体
  - 条件：光照
- 意义：生物圈的能量来源

<!-- 提醒学生回忆上节课的叶片结构 -->

---

# 对照实验

| 组别 | 光照 | 结果 |
| --- | --- | --- |
| 甲 | 有 | 变蓝 |
| 乙 | 无 | 不变蓝 |

> 结论：光是光合作用的必要条件

---

# 第二部分

---

# 代码示例

~~~python
print("hello")
~~~

1. 第一步
2. 第二步
`

describe('parseSlideDeck()', () => {
  const deck = parseSlideDeck(SAMPLE)

  it('剥掉 front matter，按 --- 分页', () => {
    expect(deck.slides).toHaveLength(5)
    expect(deck.title).toBe('光合作用')
  })

  it('第一页只有标题和一句副标题 → 封面', () => {
    const cover = deck.slides[0]
    expect(cover.layout).toBe(SLIDE_LAYOUTS.TITLE)
    expect(cover.titleText).toBe('光合作用')
    expect(cover.subtitle).toBe('初中生物 · 第三单元')
    expect(cover.blocks).toEqual([])
  })

  it('要点页：嵌套要点、行内粗体、HTML 注释变备注', () => {
    const slide = deck.slides[1]
    expect(slide.layout).toBe(SLIDE_LAYOUTS.CONTENT)
    expect(slide.blocks).toHaveLength(1)
    const [bullets] = slide.blocks
    expect(bullets.type).toBe('bullets')
    expect(bullets.items.map(i => i.level)).toEqual([0, 0, 1, 1, 0])
    expect(bullets.items[0].runs.some(r => r.bold && r.text === '光能')).toBe(true)
    expect(slide.notes).toBe('提醒学生回忆上节课的叶片结构')
  })

  it('表格页：表头、数据行、引用', () => {
    const slide = deck.slides[2]
    const table = slide.blocks.find(b => b.type === 'table')
    expect(runsToText(table.header[1])).toBe('光照')
    expect(table.rows).toHaveLength(2)
    expect(runsToText(table.rows[1][2])).toBe('不变蓝')
    const quote = slide.blocks.find(b => b.type === 'quote')
    expect(runsToText(quote.runs)).toContain('必要条件')
  })

  it('只有标题的中间页 → 章节页', () => {
    expect(deck.slides[3].layout).toBe(SLIDE_LAYOUTS.SECTION)
    expect(deck.slides[3].titleText).toBe('第二部分')
  })

  it('~~~ 代码块与有序列表', () => {
    const slide = deck.slides[4]
    const code = slide.blocks.find(b => b.type === 'code')
    expect(code.lang).toBe('python')
    expect(code.text).toBe('print("hello")')
    const numbered = slide.blocks.find(b => b.type === 'numbered')
    expect(numbered.items.map(i => runsToText(i.runs))).toEqual(['第一步', '第二步'])
  })

  it('空内容与只有分隔线的内容都得到空 deck', () => {
    expect(parseSlideDeck('').slides).toEqual([])
    expect(parseSlideDeck('---\n\n---').slides).toEqual([])
  })

  it('没有 front matter、以 --- 开头的 deck 不会产生空白首页', () => {
    const deck2 = parseSlideDeck('---\n# 封面\n---\n# 内容\n- a')
    expect(deck2.slides).toHaveLength(2)
    expect(deck2.slides[0].layout).toBe(SLIDE_LAYOUTS.TITLE)
  })

  it('代码块内的 --- 不算分页', () => {
    const deck3 = parseSlideDeck('# 页\n~~~\n---\n~~~\n- a')
    expect(deck3.slides).toHaveLength(1)
  })
})

describe('parseInlineRuns()', () => {
  it('解析粗体、斜体、行内代码、删除线、链接', () => {
    const runs = parseInlineRuns('普通 **粗** *斜* `code` ~~删~~ [链接](https://a.b)')
    expect(runs.find(r => r.bold).text).toBe('粗')
    expect(runs.find(r => r.italic).text).toBe('斜')
    expect(runs.find(r => r.code).text).toBe('code')
    expect(runs.find(r => r.strike).text).toBe('删')
    expect(runs.find(r => r.link).link).toBe('https://a.b')
    expect(runsToText(runs)).toBe('普通 粗 斜 code 删 链接')
  })

  it('***粗斜*** 嵌套与 snake_case 不被误判为斜体', () => {
    const nested = parseInlineRuns('***both***')
    expect(nested[0]).toMatchObject({ text: 'both', bold: true, italic: true })
    const snake = parseInlineRuns('file_name_here 和 a * b * c')
    expect(snake).toHaveLength(1)
    expect(snake[0].text).toBe('file_name_here 和 a * b * c')
  })

  it('去掉 HTML 标签，<br> 变空格', () => {
    expect(runsToText(parseInlineRuns('a<br>b <span>c</span>'))).toBe('a b c')
  })
})

describe('detectSmartLayout() 智能排版', () => {
  const deckOf = (body) => parseSlideDeck('# 封面\n---\n# 页\n\n' + body).slides[1]

  it('同页两个小标题各带内容 → 分栏', () => {
    const s = deckOf('## 优点\n- 快\n- 便宜\n\n## 缺点\n- 不稳定')
    expect(s.smart.type).toBe(SMART_LAYOUTS.COLUMNS)
    expect(s.smart.columns.map(c => runsToText(c.title))).toEqual(['优点', '缺点'])
    expect(s.smart.columns[0].blocks[0].items).toHaveLength(2)
  })

  it('小标题之前允许一段引导文字，超过或不是段落则不分栏', () => {
    expect(deckOf('先说一句。\n\n## A\n- a\n\n## B\n- b').smart.type).toBe(SMART_LAYOUTS.COLUMNS)
    expect(deckOf('- 要点\n\n## A\n- a\n\n## B\n- b').smart).toBeNull()
  })

  it('3–6 步短语的有序列表 → 流程；步骤太长或带子级则不是', () => {
    const s = deckOf('1. 准备材料\n2. 暗处理一昼夜\n3. 部分遮光光照\n4. 脱色染色')
    expect(s.smart.type).toBe(SMART_LAYOUTS.FLOW)
    expect(s.smart.steps).toHaveLength(4)
    expect(deckOf('1. ' + '很长'.repeat(30) + '\n2. b\n3. c').smart).toBeNull()
    expect(deckOf('1. a\n  - 子\n2. b\n3. c').smart).toBeNull()
    expect(deckOf('1. a\n2. b').smart).toBeNull()
  })

  it('- **名称**：说明 ×3 → 卡片，标题去掉冒号；没有说明则退回普通要点', () => {
    const s = deckOf('- **光**：提供能量\n- **叶绿体**：反应场所\n- **二氧化碳**：原料之一')
    expect(s.smart.type).toBe(SMART_LAYOUTS.CARDS)
    expect(s.smart.cards.map(c => runsToText(c.title))).toEqual(['光', '叶绿体', '二氧化碳'])
    expect(runsToText(s.smart.cards[0].body)).toBe('提供能量')
    expect(deckOf('- **光**\n- **叶绿体**\n- **二氧化碳**').smart).toBeNull()
  })

  it('一张图 + 要点 → 图文；只有引文 → 引言', () => {
    const it1 = deckOf('![叶片](https://example.com/a.png)\n\n- 上表皮\n- 叶肉')
    expect(it1.smart.type).toBe(SMART_LAYOUTS.IMAGE_TEXT)
    expect(it1.smart.image.url).toBe('https://example.com/a.png')
    expect(deckOf('> 万物生长靠太阳').smart.type).toBe(SMART_LAYOUTS.QUOTE)
  })

  it('layout 指令可强制或关闭；封面/章节页没有 smart', () => {
    expect(deckOf('<!-- layout: none -->\n\n1. 一\n2. 二\n3. 三').smart).toBeNull()
    expect(deckOf('<!-- layout: flow -->\n\n1. 一\n2. 二\n3. 三').smart.type).toBe(SMART_LAYOUTS.FLOW)
    // 结构不满足时忽略强制
    expect(deckOf('<!-- layout: columns -->\n\n- a\n- b').smart).toBeNull()
    const deck = parseSlideDeck('# 封面\n副标题\n---\n# 章节')
    expect(deck.slides[0].smart).toBeNull()
    expect(deck.slides[1].smart).toBeNull()
  })

  it('普通要点页 smart 为 null', () => {
    expect(deckOf('- a\n- b\n- c').smart).toBeNull()
  })
})

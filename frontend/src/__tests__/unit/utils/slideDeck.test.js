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

  it('年份/阶段标签开头的条目 → 时间线；"第一步"归流程不归时间线', () => {
    const s = deckOf('- 1771年：普利斯特利发现植物更新空气\n- 1779年：英格豪斯证明需要光\n- 1864年：萨克斯证明产物是淀粉')
    expect(s.smart.type).toBe(SMART_LAYOUTS.TIMELINE)
    expect(s.smart.items.map(i => i.label)).toEqual(['1771年', '1779年', '1864年'])
    expect(runsToText(s.smart.items[1].runs)).toBe('英格豪斯证明需要光')
    expect(deckOf('- 第一阶段：准备\n- 第二阶段：实施\n- 第三阶段：总结').smart.type).toBe(SMART_LAYOUTS.TIMELINE)
    expect(deckOf('1. 第一步：准备\n2. 第二步：实施\n3. 第三步：总结').smart.type).toBe(SMART_LAYOUTS.FLOW)
  })

  it('数字开头的 2–4 条 → 数据亮点', () => {
    const s = deckOf('- 90%：地球氧气来自光合作用\n- 1000亿吨：每年固定的碳\n- 6：叶绿体的六大结构')
    expect(s.smart.type).toBe(SMART_LAYOUTS.STATS)
    expect(s.smart.stats.map(x => x.value)).toEqual(['90%', '1000亿吨', '6'])
    expect(deckOf('- 90%：a\n- 80%：b\n- 70%：c\n- 60%：d\n- 50%：e').smart?.type).not.toBe(SMART_LAYOUTS.STATS)
  })

  it('emoji 开头的要点 → 图标列表，emoji 从文字里剥掉', () => {
    const s = deckOf('- 🌱 理解光合作用的概念\n- 🔬 掌握探究实验的方法\n- 💡 认识其对生物圈的意义')
    expect(s.smart.type).toBe(SMART_LAYOUTS.ICON_LIST)
    expect(s.smart.items.map(i => i.icon)).toEqual(['🌱', '🔬', '💡'])
    expect(runsToText(s.smart.items[0].runs)).toBe('理解光合作用的概念')
  })

  it('标题是目录/议程的列表页 → 目录；其他标题不算', () => {
    const deck = parseSlideDeck('# 封面\n---\n# 目录\n\n- 概念\n- 实验\n- 意义\n---\n# 内容\n\n- 概念\n- 实验\n- 意义')
    expect(deck.slides[1].smart.type).toBe(SMART_LAYOUTS.AGENDA)
    expect(deck.slides[1].smart.items).toHaveLength(3)
    expect(deck.slides[2].smart).toBeNull()
  })

  it('"结论：…"段落变成提示框块；谢谢页是结束页；章节页带序号', () => {
    const deck = parseSlideDeck('# 封面\n---\n# 第一部分\n---\n# 页\n\n结论：光是必要条件。\n\n- a\n- b\n---\n# 第二部分\n---\n# 谢谢大家\n欢迎提问')
    expect(deck.slides[1].layout).toBe(SLIDE_LAYOUTS.SECTION)
    expect(deck.slides[1].sectionIndex).toBe(1)
    expect(deck.slides[3].sectionIndex).toBe(2)
    const callout = deck.slides[2].blocks[0]
    expect(callout.type).toBe('callout')
    expect(callout.label).toBe('结论')
    expect(runsToText(callout.runs)).toBe('光是必要条件。')
    expect(deck.slides[4].layout).toBe(SLIDE_LAYOUTS.CLOSING)
    expect(deck.slides[4].subtitle).toBe('欢迎提问')
  })

  it('"A → B → C" 箭头链（段落或裸代码块里）→ chain 块；整页只有一条链 → 流程图', () => {
    const md = [
      '# 封面', '---', '# 探究实验', '', '```', '暗处理 → 选叶遮光 → 光照照射 → 酒精脱色 → 清水漂洗', '```', '',
      '- **第一步：暗处理**', '- **第二步：遮光**', '---', '# 步骤', '', '取材 -> 固定 -> 染色 -> 观察', '---',
      '# 不是链', '', '只有一个 → 箭头'
    ].join('\n')
    const deck = parseSlideDeck(md)
    const chain = deck.slides[1].blocks[0]
    expect(chain.type).toBe('chain')
    expect(chain.steps).toEqual(['暗处理', '选叶遮光', '光照照射', '酒精脱色', '清水漂洗'])
    expect(deck.slides[1].smart).toBeNull()               // 链 + 要点列表：按普通块序列渲染
    expect(deck.slides[2].smart.type).toBe(SMART_LAYOUTS.FLOW)
    expect(deck.slides[2].smart.steps).toHaveLength(4)
    expect(deck.slides[3].blocks.some(b => b.type === 'chain')).toBe(false)
  })
})

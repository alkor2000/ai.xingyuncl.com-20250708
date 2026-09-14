/**
 * Marp 风格幻灯片 Markdown → 结构化 deck（纯函数，无 DOM 依赖，可单测）
 *
 * 输入约定（与后端 outputFormatInstructions 的 pptx 指令一致）：
 *   - 单独一行 --- 分页；可选的 YAML front matter（--- marp: true ---）会被剥掉
 *   - 每页第一个标题（# / ## ...）作为页标题，其余标题按小标题块处理
 *   - 要点用 - / * / + 或 1. 开头，两个空格缩进表示子级（最多三级）
 *   - GFM 表格、引用（>）、图片 ![alt](url)、~~~ 或 ``` 代码块
 *   - HTML 注释 <!-- ... --> 视为演讲备注（形如 key: value 的 Marp 指令忽略）
 *
 * 输出：
 *   { title, slides: [{ index, layout, title, subtitle, blocks, smart, notes, textLength }] }
 *   layout: 'title'（封面）| 'section'（章节页，只有标题，带 sectionIndex 序号）| 'content' |
 *           'closing'（结束页：标题是谢谢/Q&A 之类且最多两段短文字，按封面样式渲染）
 *   blocks: [{ type: 'paragraph'|'heading'|'bullets'|'numbered'|'table'|'image'|'quote'|'code'|'callout', ... }]
 *     callout：以"结论：/要点：/注意：/提示：/Tips:"等开头的段落，渲染成高亮提示框（label + runs）
 *   smart: 内容页的智能排版（detectSmartLayout），null 表示普通"标题+要点"：
 *     columns   { columns: [{ title: runs, blocks }] }     同页 2–3 个 ##/### 小标题各带内容
 *     flow      { steps: [runs] }                           一个 3–6 步的有序列表（每步一句短语）
 *     timeline  { items: [{ label, runs }] }                3–6 条以年份/月份/阶段/Q1 等时间标签开头的条目
 *     stats     { stats: [{ value, runs }] }                2–4 条以数字开头的条目（85%、3.2亿、120+）
 *     cards     { cards: [{ title: runs, body: runs }] }   3–6 条 "- **名称**：说明"
 *     iconList  { items: [{ icon, runs }] }                 3–8 条以 emoji 开头的要点
 *     agenda    { items: [runs] }                           标题是目录/议程/大纲/Agenda 的列表页
 *     imageText { image, blocks }                           一张图 + 文字
 *     quote     { runs }                                    整页只有一段引文
 *   可用 <!-- layout: columns|flow|timeline|stats|cards|iconList|agenda|quote|imageText|none --> 强制或关闭
 *   （结构不满足时忽略）。
 *   文本一律拆成 runs（parseInlineRuns），预览与 pptx 导出共用同一份结构。
 */

export const SLIDE_LAYOUTS = Object.freeze({
  TITLE: 'title',
  SECTION: 'section',
  CONTENT: 'content',
  CLOSING: 'closing'
})

export const MAX_LIST_LEVEL = 2

const LINE_ENDING_RE = /\r\n?/g
const SLIDE_SEPARATOR_RE = /^\s{0,3}(-{3,}|\*{3,})\s*$/
const FRONT_MATTER_LINE_RE = /^[\w-]+\s*:/
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/
const BULLET_RE = /^(\s*)[-*+]\s+(.*)$/
const NUMBERED_RE = /^(\s*)\d+[.)]\s+(.*)$/
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/
const TABLE_ALIGN_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
const IMAGE_RE = /^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/
const QUOTE_RE = /^\s*>\s?(.*)$/
const FENCE_OPEN_RE = /^\s{0,3}(`{3,}|~{3,})\s*(\S*)\s*$/
const COMMENT_RE = /<!--([\s\S]*?)-->/g
const DIRECTIVE_RE = /^\s*_?[A-Za-z][\w-]*\s*:\s*\S[\s\S]*$/
const HTML_BREAK_RE = /<br\s*\/?>/gi
const HTML_TAG_RE = /<\/?[a-zA-Z][^>]*>/g
/** 提示框段落：以这些词开头并紧跟冒号 */
const CALLOUT_RE = /^(结论|小结|总结|要点|重点|关键|注意|提示|提醒|思考|Tips?|Note|Key|Takeaway|Summary)\s*[：:]\s*(.+)$/i

/** 封面副标题最多接受的段落数与总长度（超过则按普通内容页处理） */
const SUBTITLE_MAX_PARAGRAPHS = 2
const SUBTITLE_MAX_LENGTH = 120

// ============================================================================
// 行内格式
// ============================================================================

/**
 * 行内 Markdown → runs
 * 支持 `code`、**粗体**、__粗体__、*斜体*、_斜体_（要求前后不是字母数字，避免误伤 snake_case）、
 * ~~删除线~~、[文字](链接)。粗体/斜体内部递归解析，允许 ***粗斜*** 嵌套。
 *
 * @param {string} text
 * @param {Object} [inherit] - 继承的样式（递归用）
 * @returns {Array<{text: string, bold?: boolean, italic?: boolean, code?: boolean, strike?: boolean, link?: string}>}
 */
export const parseInlineRuns = (text, inherit = {}) => {
  const source = String(text || '')
    .replace(HTML_BREAK_RE, ' ')
    .replace(HTML_TAG_RE, '')
  if (!source) return []

  // 分组：2 行内代码 | 3 粗斜(***) | 4/5 粗体 | 6/7 斜体 | 8 删除线 | 9+10 链接
  const pattern = /(`+)([^`]+?)\1|\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|__(.+?)__|\*([^*\s](?:[^*]*?[^*\s])?)\*|(?<![A-Za-z0-9])_([^_\s](?:[^_]*?[^_\s])?)_(?![A-Za-z0-9])|~~(.+?)~~|\[([^\]]+)\]\(([^)\s]+)\)/g
  const runs = []
  let last = 0
  let match

  const pushPlain = (chunk) => {
    if (chunk) runs.push({ ...inherit, text: chunk })
  }

  while ((match = pattern.exec(source)) !== null) {
    pushPlain(source.slice(last, match.index))
    last = match.index + match[0].length

    if (match[2] !== undefined) {
      runs.push({ ...inherit, text: match[2], code: true })
    } else if (match[3] !== undefined) {
      runs.push(...parseInlineRuns(match[3], { ...inherit, bold: true, italic: true }))
    } else if (match[4] !== undefined || match[5] !== undefined) {
      runs.push(...parseInlineRuns(match[4] ?? match[5], { ...inherit, bold: true }))
    } else if (match[6] !== undefined || match[7] !== undefined) {
      runs.push(...parseInlineRuns(match[6] ?? match[7], { ...inherit, italic: true }))
    } else if (match[8] !== undefined) {
      runs.push(...parseInlineRuns(match[8], { ...inherit, strike: true }))
    } else {
      runs.push(...parseInlineRuns(match[9], { ...inherit, link: match[10] }))
    }
  }
  pushPlain(source.slice(last))

  return runs
}

/** runs → 纯文本 */
export const runsToText = (runs) => (runs || []).map(r => r.text).join('')

// ============================================================================
// 内部工具
// ============================================================================

const stripFrontMatter = (lines) => {
  if (lines.length < 2 || lines[0].trim() !== '---') return lines
  const limit = Math.min(lines.length, 20)
  for (let i = 1; i < limit; i += 1) {
    const line = lines[i]
    if (line.trim() === '---') {
      return lines.slice(i + 1)
    }
    if (line.trim() !== '' && !FRONT_MATTER_LINE_RE.test(line)) {
      return lines
    }
  }
  return lines
}

/**
 * 按分页线切分，围栏代码块内部的 --- 不算分页
 * @returns {string[][]} 每页的行数组
 */
const splitSlides = (lines) => {
  const slides = []
  let current = []
  let fence = null

  for (const line of lines) {
    if (fence) {
      current.push(line)
      const close = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(line)
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null
      continue
    }
    const open = FENCE_OPEN_RE.exec(line)
    if (open) {
      fence = open[1]
      current.push(line)
      continue
    }
    if (SLIDE_SEPARATOR_RE.test(line)) {
      slides.push(current)
      current = []
      continue
    }
    current.push(line)
  }
  slides.push(current)
  return slides
}

/**
 * 抽出 HTML 注释：备注返回，形如 key: value 的指令收进 directives（只用 layout，其余 Marp 指令忽略）
 * @returns {{ text: string, notes: string[], directives: Object }}
 */
const extractComments = (text) => {
  const notes = []
  const directives = {}
  const stripped = text.replace(COMMENT_RE, (_, body) => {
    const content = body.trim()
    if (!content) return '\n'
    if (DIRECTIVE_RE.test(content)) {
      const m = /^\s*_?([A-Za-z][\w-]*)\s*:\s*(\S[\s\S]*?)\s*$/.exec(content)
      if (m) directives[m[1].toLowerCase()] = m[2]
    } else {
      notes.push(content)
    }
    return '\n'
  })
  return { text: stripped, notes, directives }
}

const listLevel = (indent) => {
  const width = indent.replace(/\t/g, '  ').length
  return Math.min(MAX_LIST_LEVEL, Math.floor(width / 2))
}

const splitTableRow = (line) => {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split(/(?<!\\)\|/).map(cell => parseInlineRuns(cell.replace(/\\\|/g, '|').trim()))
}

/**
 * 单页正文 → blocks
 */
const parseSlideBody = (lines) => {
  const blocks = []
  let title = null
  let paragraph = []

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    const text = paragraph.join(' ').trim()
    paragraph = []
    if (!text) return
    const callout = CALLOUT_RE.exec(text.replace(/^\*\*(.+?)\*\*/, '$1'))
    if (callout) {
      blocks.push({ type: 'callout', label: callout[1], runs: parseInlineRuns(callout[2]) })
    } else {
      blocks.push({ type: 'paragraph', runs: parseInlineRuns(text) })
    }
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // 代码块
    const fenceOpen = FENCE_OPEN_RE.exec(line)
    if (fenceOpen) {
      flushParagraph()
      const marker = fenceOpen[1]
      const codeLines = []
      let j = i + 1
      let closed = false
      for (; j < lines.length; j += 1) {
        const close = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(lines[j])
        if (close && close[1][0] === marker[0] && close[1].length >= marker.length) { closed = true; break }
        codeLines.push(lines[j])
      }
      blocks.push({ type: 'code', lang: fenceOpen[2] || '', text: codeLines.join('\n') })
      i = closed ? j + 1 : j
      continue
    }

    if (line.trim() === '') {
      flushParagraph()
      i += 1
      continue
    }

    const heading = HEADING_RE.exec(line)
    if (heading) {
      flushParagraph()
      const runs = parseInlineRuns(heading[2])
      if (title === null) {
        title = runs
      } else {
        blocks.push({ type: 'heading', level: heading[1].length, runs })
      }
      i += 1
      continue
    }

    const image = IMAGE_RE.exec(line)
    if (image) {
      flushParagraph()
      blocks.push({ type: 'image', alt: image[1] || '', url: image[2] })
      i += 1
      continue
    }

    if (TABLE_ROW_RE.test(line)) {
      flushParagraph()
      const rowLines = []
      while (i < lines.length && TABLE_ROW_RE.test(lines[i])) {
        rowLines.push(lines[i])
        i += 1
      }
      const header = splitTableRow(rowLines[0])
      const bodyLines = rowLines.slice(1).filter(l => !TABLE_ALIGN_RE.test(l))
      const colCount = header.length
      const rows = bodyLines.map(l => {
        const cells = splitTableRow(l)
        while (cells.length < colCount) cells.push([])
        return cells.slice(0, colCount)
      })
      blocks.push({ type: 'table', header, rows })
      continue
    }

    if (BULLET_RE.test(line) || NUMBERED_RE.test(line)) {
      flushParagraph()
      const ordered = NUMBERED_RE.test(line) && !BULLET_RE.test(line)
      const items = []
      while (i < lines.length) {
        const m = BULLET_RE.exec(lines[i]) || NUMBERED_RE.exec(lines[i])
        if (!m) break
        items.push({ level: listLevel(m[1]), runs: parseInlineRuns(m[2]) })
        i += 1
      }
      blocks.push({ type: ordered ? 'numbered' : 'bullets', items })
      continue
    }

    const quote = QUOTE_RE.exec(line)
    if (quote) {
      flushParagraph()
      const parts = []
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        parts.push(QUOTE_RE.exec(lines[i])[1])
        i += 1
      }
      const text = parts.join(' ').trim()
      if (text) blocks.push({ type: 'quote', runs: parseInlineRuns(text) })
      continue
    }

    paragraph.push(line.trim())
    i += 1
  }
  flushParagraph()

  return { title, blocks }
}

const blockTextLength = (block) => {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
    case 'quote':
    case 'callout':
      return runsToText(block.runs).length
    case 'bullets':
    case 'numbered':
      return block.items.reduce((sum, item) => sum + runsToText(item.runs).length, 0)
    case 'table':
      return [block.header, ...block.rows].reduce(
        (sum, row) => sum + row.reduce((s, cell) => s + runsToText(cell).length, 0), 0
      )
    case 'code':
      return block.text.length
    default:
      return 0
  }
}

// ============================================================================
// 智能排版：按内容结构自动选版式（预览与 pptx 导出共用同一份判定）
// ============================================================================

export const SMART_LAYOUTS = Object.freeze({
  COLUMNS: 'columns',
  FLOW: 'flow',
  TIMELINE: 'timeline',
  STATS: 'stats',
  CARDS: 'cards',
  ICON_LIST: 'iconList',
  AGENDA: 'agenda',
  IMAGE_TEXT: 'imageText',
  QUOTE: 'quote'
})

/** 时间线标签：年份 / 月份 / 第X阶段 / Q1 / Day 3 / Week 2 / 上半年 … */
const TIMELINE_LABEL_RE = /^(\d{4}(?:\s*[-–~至]\s*\d{2,4})?\s*年?|\d{4}年\d{1,2}月|\d{1,2}月(?:\d{1,2}日)?|第[一二三四五六七八九十百\d]+(?:阶段|期|年|周|天|课时|季度)|(?:Day|Week|Phase|Stage|Q)\s*\d+|Q[1-4]|[上下]半年|(?:周|星期)[一二三四五六日天]|(?:早|中|晚)期|过去|现在|未来|(?:春|夏|秋|冬)季)$/i
/** 数字亮点：85% / 3.2亿 / 120+ / 10x / ¥99 / 1/3 */
const STAT_VALUE_RE = /^[¥$€]?\d[\d,.]*(?:\s*[%％+xX×])?(?:\s*[\u4e00-\u9fa5A-Za-z℃]{1,3})?(?:\s*\/\s*\d+)?$/
const EMOJI_RE = /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)\s*/u
const AGENDA_TITLE_RE = /目录|议程|大纲|提纲|本节内容|今天(?:要)?(?:讲|学)|课程安排|内容概览|Agenda|Outline|Contents|Overview/i

/** 拆出条目开头的"标签：正文" */
const splitLead = (runs) => {
  const text = runsToText(runs)
  const m = /^(.{1,24}?)\s*[：:—–-]\s*(.+)$/.exec(text)
  return m ? { lead: m[1].trim(), rest: m[2].trim() } : null
}

const FLOW_MIN = 3
const FLOW_MAX = 6
const FLOW_STEP_MAX_CHARS = 40
const CARDS_MIN = 3
const CARDS_MAX = 6
const LIST_TYPES = new Set(['bullets', 'numbered'])

/** 同页 2–3 个小标题各带内容 → 分栏（首个小标题之前最多允许一段引导文字） */
const detectColumns = (blocks) => {
  const headingIdx = blocks.map((b, i) => (b.type === 'heading' ? i : -1)).filter(i => i >= 0)
  if (headingIdx.length < 2 || headingIdx.length > 3) return null
  if (headingIdx[0] > 1) return null
  if (headingIdx[0] === 1 && blocks[0].type !== 'paragraph') return null
  const columns = []
  for (let k = 0; k < headingIdx.length; k += 1) {
    const from = headingIdx[k]
    const to = k + 1 < headingIdx.length ? headingIdx[k + 1] : blocks.length
    const inner = blocks.slice(from + 1, to)
    if (inner.length === 0) return null
    columns.push({ title: blocks[from].runs, blocks: inner })
  }
  return { type: SMART_LAYOUTS.COLUMNS, intro: headingIdx[0] === 1 ? blocks[0] : null, columns }
}

/** 一个 3–6 步的有序列表（每步一句短语，无子级）→ 流程 */
const detectFlow = (blocks) => {
  const lists = blocks.filter(b => LIST_TYPES.has(b.type))
  const others = blocks.filter(b => !LIST_TYPES.has(b.type))
  if (lists.length !== 1 || lists[0].type !== 'numbered') return null
  if (others.some(b => b.type !== 'paragraph') || others.length > 1) return null
  const items = lists[0].items
  if (items.length < FLOW_MIN || items.length > FLOW_MAX) return null
  if (items.some(item => item.level > 0 || runsToText(item.runs).length > FLOW_STEP_MAX_CHARS)) return null
  return { type: SMART_LAYOUTS.FLOW, intro: others[0] || null, steps: items.map(item => item.runs) }
}

/** 3–6 条以时间标签开头的条目 → 时间线 */
const detectTimeline = (blocks) => {
  const lists = blocks.filter(b => LIST_TYPES.has(b.type))
  const others = blocks.filter(b => !LIST_TYPES.has(b.type))
  if (lists.length !== 1 || others.some(b => b.type !== 'paragraph') || others.length > 1) return null
  const items = lists[0].items
  if (items.length < 3 || items.length > 6 || items.some(item => item.level > 0)) return null
  const parsed = []
  for (const item of items) {
    const split = splitLead(item.runs)
    if (!split || !TIMELINE_LABEL_RE.test(split.lead)) return null
    parsed.push({ label: split.lead, runs: parseInlineRuns(split.rest) })
  }
  return { type: SMART_LAYOUTS.TIMELINE, intro: others[0] || null, items: parsed }
}

/** 2–4 条以数字开头的条目 → 数据亮点 */
const detectStats = (blocks) => {
  const lists = blocks.filter(b => LIST_TYPES.has(b.type))
  const others = blocks.filter(b => !LIST_TYPES.has(b.type))
  if (lists.length !== 1 || others.some(b => b.type !== 'paragraph') || others.length > 1) return null
  const items = lists[0].items
  if (items.length < 2 || items.length > 4 || items.some(item => item.level > 0)) return null
  const stats = []
  for (const item of items) {
    const text = runsToText(item.runs)
    const m = /^([¥$€]?[\d][^\s：:—–-]{0,9})\s*[：:—–-]?\s*(.+)$/.exec(text)
    if (!m || !STAT_VALUE_RE.test(m[1].trim()) || m[2].trim().length > 40) return null
    stats.push({ value: m[1].trim(), runs: parseInlineRuns(m[2].trim()) })
  }
  return { type: SMART_LAYOUTS.STATS, intro: others[0] || null, stats }
}

/** 3–8 条以 emoji 开头的要点 → 图标列表 */
const detectIconList = (blocks) => {
  const lists = blocks.filter(b => LIST_TYPES.has(b.type))
  const others = blocks.filter(b => !LIST_TYPES.has(b.type))
  if (lists.length !== 1 || others.some(b => b.type !== 'paragraph') || others.length > 1) return null
  const items = lists[0].items
  if (items.length < 3 || items.length > 8 || items.some(item => item.level > 0)) return null
  const parsed = []
  for (const item of items) {
    const text = runsToText(item.runs)
    const m = EMOJI_RE.exec(text)
    if (!m) return null
    const rest = text.slice(m[0].length).trim()
    if (!rest) return null
    // 保留原 runs 的粗体等格式：把首个 run 的 emoji 前缀剥掉
    const runs = item.runs.map((r, i) => (i === 0 ? { ...r, text: r.text.replace(EMOJI_RE, '') } : r)).filter(r => r.text !== '')
    parsed.push({ icon: m[1], runs })
  }
  return { type: SMART_LAYOUTS.ICON_LIST, intro: others[0] || null, items: parsed }
}

/** 目录/议程页：标题命中关键词且只有一个 3–8 条的列表 → 编号目录 */
const detectAgenda = (blocks, titleText) => {
  if (!AGENDA_TITLE_RE.test(titleText || '')) return null
  const lists = blocks.filter(b => LIST_TYPES.has(b.type))
  if (lists.length !== 1 || blocks.length > 2) return null
  const items = lists[0].items.filter(item => item.level === 0)
  if (items.length < 3 || items.length > 8) return null
  return { type: SMART_LAYOUTS.AGENDA, items: items.map(item => item.runs) }
}

/** 3–6 条 "- **名称**：说明"（或 **名称** 后跟说明）→ 卡片 */
const detectCards = (blocks) => {
  const lists = blocks.filter(b => LIST_TYPES.has(b.type))
  const others = blocks.filter(b => !LIST_TYPES.has(b.type))
  if (lists.length !== 1 || others.some(b => b.type !== 'paragraph') || others.length > 1) return null
  const items = lists[0].items
  if (items.length < CARDS_MIN || items.length > CARDS_MAX) return null
  if (items.some(item => item.level > 0)) return null
  const cards = []
  for (const item of items) {
    const runs = item.runs
    const lead = runs.findIndex(r => !r.bold && r.text.trim() !== '')
    const bold = runs.filter((r, i) => (lead < 0 || i < lead) && r.bold)
    if (bold.length === 0 || (lead >= 0 && runs.slice(0, lead).some(r => !r.bold && r.text.trim() !== ''))) return null
    const titleText = runsToText(bold).replace(/[：:]\s*$/, '').trim()
    if (!titleText) return null
    const body = lead >= 0 ? runs.slice(lead) : []
    if (body.length > 0) body[0] = { ...body[0], text: body[0].text.replace(/^\s*[：:—–-]\s*/, '') }
    cards.push({ title: [{ text: titleText, bold: true }], body })
  }
  // 卡片要有说明才有意义，否则退回普通要点
  if (cards.every(c => runsToText(c.body).trim() === '')) return null
  return { type: SMART_LAYOUTS.CARDS, intro: others[0] || null, cards }
}

/** 一张图 + 文字 → 图文左右排 */
const detectImageText = (blocks) => {
  const images = blocks.filter(b => b.type === 'image')
  if (images.length !== 1) return null
  const rest = blocks.filter(b => b.type !== 'image')
  if (rest.length === 0 || rest.some(b => b.type === 'table' || b.type === 'code')) return null
  return { type: SMART_LAYOUTS.IMAGE_TEXT, image: images[0], blocks: rest }
}

/** 整页只有一段引文 → 大字引言 */
const detectQuote = (blocks) => {
  if (blocks.length !== 1 || blocks[0].type !== 'quote') return null
  return { type: SMART_LAYOUTS.QUOTE, runs: blocks[0].runs }
}

/** 判定顺序即优先级：更具体的结构在前（目录 > 时间线 > 数字 > emoji > 流程 > 卡片 …） */
const DETECTORS = {
  [SMART_LAYOUTS.AGENDA]: detectAgenda,
  [SMART_LAYOUTS.COLUMNS]: detectColumns,
  [SMART_LAYOUTS.TIMELINE]: detectTimeline,
  [SMART_LAYOUTS.STATS]: detectStats,
  [SMART_LAYOUTS.ICON_LIST]: detectIconList,
  [SMART_LAYOUTS.FLOW]: detectFlow,
  [SMART_LAYOUTS.CARDS]: detectCards,
  [SMART_LAYOUTS.IMAGE_TEXT]: detectImageText,
  [SMART_LAYOUTS.QUOTE]: detectQuote
}

/**
 * @param {Array} blocks - 内容页 blocks
 * @param {string} [forced] - <!-- layout: x --> 指定的版式；none 关闭智能排版；不满足结构时忽略
 * @param {string} [titleText] - 页标题（目录页判定用）
 * @returns {Object|null}
 */
export const detectSmartLayout = (blocks, forced, titleText = '') => {
  const key = String(forced || '').trim().toLowerCase()
  if (key === 'none' || key === 'default') return null
  if (key) {
    const detector = DETECTORS[Object.values(SMART_LAYOUTS).find(v => v.toLowerCase() === key)]
    if (detector) return detector(blocks, titleText)
  }
  for (const detector of Object.values(DETECTORS)) {
    const result = detector(blocks, titleText)
    if (result) return result
  }
  return null
}

/**
 * 判断封面/章节页：只有标题，或标题加至多两段简短文字
 */
const CLOSING_TITLE_RE = /^(谢谢|感谢|敬请|Thank|Thanks|Q\s*&\s*A|问答|答疑|讨论|结束|The End|再见|欢迎(?:提问|交流|讨论))/i

const decideLayout = (slideIndex, title, blocks) => {
  if (!title) return SLIDE_LAYOUTS.CONTENT
  const onlyShortParagraphs = blocks.length <= SUBTITLE_MAX_PARAGRAPHS
    && blocks.every(b => b.type === 'paragraph')
    && blocks.reduce((sum, b) => sum + runsToText(b.runs).length, 0) <= SUBTITLE_MAX_LENGTH
  if (!onlyShortParagraphs) return SLIDE_LAYOUTS.CONTENT
  if (slideIndex === 0) return SLIDE_LAYOUTS.TITLE
  if (CLOSING_TITLE_RE.test(runsToText(title))) return SLIDE_LAYOUTS.CLOSING
  return SLIDE_LAYOUTS.SECTION
}

// ============================================================================
// 对外
// ============================================================================

/**
 * @param {string} markdown - pptx 代码块内容
 * @returns {{ title: string|null, slides: Array }}
 */
export const parseSlideDeck = (markdown) => {
  const normalized = String(markdown || '').replace(LINE_ENDING_RE, '\n')
  const lines = stripFrontMatter(normalized.split('\n'))
  const rawSlides = splitSlides(lines)

  const slides = []
  let sectionCount = 0
  for (const rawLines of rawSlides) {
    const { text, notes, directives } = extractComments(rawLines.join('\n'))
    const bodyLines = text.split('\n')
    const { title, blocks } = parseSlideBody(bodyLines)
    if (!title && blocks.length === 0) continue

    const index = slides.length
    const layout = decideLayout(index, title, blocks)
    const isCover = layout !== SLIDE_LAYOUTS.CONTENT
    const subtitle = isCover ? blocks.map(b => runsToText(b.runs)).join(' ').trim() : ''
    const titleText = runsToText(title || [])
    if (layout === SLIDE_LAYOUTS.SECTION) sectionCount += 1

    slides.push({
      index,
      layout,
      title: title || [],
      titleText,
      subtitle,
      sectionIndex: layout === SLIDE_LAYOUTS.SECTION ? sectionCount : 0,
      blocks: isCover ? [] : blocks,
      smart: isCover ? null : detectSmartLayout(blocks, directives.layout, titleText),
      notes: notes.join('\n'),
      textLength: blocks.reduce((sum, b) => sum + blockTextLength(b), 0)
    })
  }

  const firstTitled = slides.find(s => s.titleText)
  return {
    title: firstTitled ? firstTitled.titleText : null,
    slides
  }
}

export default { parseSlideDeck, parseInlineRuns, runsToText, detectSmartLayout, SLIDE_LAYOUTS, SMART_LAYOUTS }

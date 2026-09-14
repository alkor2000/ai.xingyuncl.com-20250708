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
 *   { title, slides: [{ index, layout, title, subtitle, blocks, notes, textLength }] }
 *   layout: 'title'（封面）| 'section'（章节页，只有标题）| 'content'
 *   blocks: [{ type: 'paragraph'|'heading'|'bullets'|'numbered'|'table'|'image'|'quote'|'code', ... }]
 *   文本一律拆成 runs（parseInlineRuns），预览与 pptx 导出共用同一份结构。
 */

export const SLIDE_LAYOUTS = Object.freeze({
  TITLE: 'title',
  SECTION: 'section',
  CONTENT: 'content'
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
 * 抽出 HTML 注释：备注返回，Marp 指令丢弃
 * @returns {{ text: string, notes: string[] }}
 */
const extractComments = (text) => {
  const notes = []
  const stripped = text.replace(COMMENT_RE, (_, body) => {
    const content = body.trim()
    if (content && !DIRECTIVE_RE.test(content)) notes.push(content)
    return '\n'
  })
  return { text: stripped, notes }
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
    if (text) blocks.push({ type: 'paragraph', runs: parseInlineRuns(text) })
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

/**
 * 判断封面/章节页：只有标题，或标题加至多两段简短文字
 */
const decideLayout = (slideIndex, title, blocks) => {
  if (!title) return SLIDE_LAYOUTS.CONTENT
  const onlyShortParagraphs = blocks.length <= SUBTITLE_MAX_PARAGRAPHS
    && blocks.every(b => b.type === 'paragraph')
    && blocks.reduce((sum, b) => sum + runsToText(b.runs).length, 0) <= SUBTITLE_MAX_LENGTH
  if (!onlyShortParagraphs) return SLIDE_LAYOUTS.CONTENT
  return slideIndex === 0 ? SLIDE_LAYOUTS.TITLE : SLIDE_LAYOUTS.SECTION
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
  for (const rawLines of rawSlides) {
    const { text, notes } = extractComments(rawLines.join('\n'))
    const bodyLines = text.split('\n')
    const { title, blocks } = parseSlideBody(bodyLines)
    if (!title && blocks.length === 0) continue

    const index = slides.length
    const layout = decideLayout(index, title, blocks)
    const isCover = layout !== SLIDE_LAYOUTS.CONTENT
    const subtitle = isCover ? blocks.map(b => runsToText(b.runs)).join(' ').trim() : ''

    slides.push({
      index,
      layout,
      title: title || [],
      titleText: runsToText(title || []),
      subtitle,
      blocks: isCover ? [] : blocks,
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

export default { parseSlideDeck, parseInlineRuns, runsToText, SLIDE_LAYOUTS }

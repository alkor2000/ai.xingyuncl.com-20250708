/**
 * 幻灯片 deck → .pptx（pptxgenjs，按需动态加载）
 *
 * 版式与 SlidesPreview 的 HTML 预览保持同一套比例（16:9，10in × 5.625in）
 * 和同一份主题色（slideThemes），让"预览看到的"和"下载得到的"结构一致。
 * PowerPoint 不会替我们自动缩字，所以正文按内容量估算行数、自选字号；
 * 估算只求不出格，不求像素级精确——模型端已被要求每页 3–6 条要点。
 *
 * 图片：pptxgenjs 在浏览器里无法自己跨域取图，这里先 fetch 成 data URL 再
 * 内嵌；取不到就退化为一行文字占位，保证整份文件仍能导出。
 */

import { parseSlideDeck, runsToText, SLIDE_LAYOUTS } from './slideDeck'
import { getSlideTheme, SLIDE_FONT_FACE, SLIDE_CODE_FONT_FACE } from './slideThemes'
import { fetchImageForEmbedding } from './download'

// ---- 版面常量（英寸，16:9 = 10 × 5.625） ----
const SLIDE_W = 10
const TITLE_BOX = { x: 0.5, y: 0.35, w: 9.0, h: 0.8 }
const ACCENT_BAR = { x: 0.5, y: 1.17, w: 1.0, h: 0.06 }
const BODY = { x: 0.5, y: 1.4, w: 9.0, h: 3.7 }
const FOOTER = { y: 5.2, h: 0.3 }
const BLOCK_GAP = 0.12

/** 正文候选字号，从大到小挑第一个装得下的 */
const BODY_FONT_SIZES = [20, 18, 16, 14, 12]
const MIN_BODY_FONT_SIZE = 12
const LINE_HEIGHT_RATIO = 1.45
const CJK_RE = /[⺀-鿿豈-﫿＀-￯]/

// ============================================================================
// 尺寸估算
// ============================================================================

/** 文本在给定字号、宽度下大约占几行（CJK 按 1em、拉丁按 0.55em 估） */
const estimateLines = (text, fontSizePt, boxWidthIn) => {
  let units = 0
  for (const ch of text) {
    if (ch === ' ') units += 0.3
    else units += CJK_RE.test(ch) ? 1 : 0.55
  }
  const unitsPerLine = Math.max(1, boxWidthIn / (fontSizePt / 72))
  return Math.max(1, Math.ceil(units / unitsPerLine))
}

const lineHeightIn = (fontSizePt) => fontSizePt * LINE_HEIGHT_RATIO / 72

/** 一组文本块的"段落列表"：每段一个纯文本，用于估高 */
const textGroupParagraphs = (blocks) => {
  const paragraphs = []
  for (const block of blocks) {
    if (block.type === 'bullets' || block.type === 'numbered') {
      block.items.forEach(item => paragraphs.push({ text: runsToText(item.runs), indent: item.level * 0.4 }))
    } else {
      paragraphs.push({ text: runsToText(block.runs), indent: 0 })
    }
  }
  return paragraphs
}

const estimateGroupHeight = (paragraphs, fontSize, boxWidthIn) => {
  let height = 0
  for (const p of paragraphs) {
    height += estimateLines(p.text, fontSize, boxWidthIn - p.indent) * lineHeightIn(fontSize)
    height += 0.06 // 段后距
  }
  return height
}

const pickBodyFontSize = (paragraphs, availableHeight, boxWidthIn) => {
  for (const size of BODY_FONT_SIZES) {
    if (estimateGroupHeight(paragraphs, size, boxWidthIn) <= availableHeight) return size
  }
  return MIN_BODY_FONT_SIZE
}

// ============================================================================
// runs → pptxgenjs 文本对象
// ============================================================================

const runToTextObject = (run, theme, extra = {}) => {
  const options = { ...extra }
  if (run.bold) options.bold = true
  if (run.italic) options.italic = true
  if (run.strike) options.strike = 'sngStrike'
  if (run.code) {
    options.fontFace = SLIDE_CODE_FONT_FACE
    options.color = theme.accent
  }
  if (run.link) options.hyperlink = { url: run.link }
  return { text: run.text, options }
}

/**
 * 一段（段落 / 要点 / 小标题 / 引用）→ 文本对象数组
 * 段落属性（bullet / indentLevel / paraSpaceAfter）挂在第一个 run 上，
 * breakLine 挂在最后一个 run 上，这是 pptxgenjs 组段的规则。
 */
const paragraphToTextObjects = (runs, theme, paragraphOptions, runExtra = {}) => {
  const list = runs.length > 0 ? runs : [{ text: ' ' }]
  return list.map((run, idx) => {
    const obj = runToTextObject(run, theme, runExtra)
    if (idx === 0) Object.assign(obj.options, paragraphOptions)
    if (idx === list.length - 1) obj.options.breakLine = true
    return obj
  })
}

const textGroupToObjects = (blocks, theme, fontSize) => {
  const objects = []
  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
        objects.push(...paragraphToTextObjects(
          block.runs, theme,
          { paraSpaceBefore: 4, paraSpaceAfter: 4 },
          { bold: true, color: theme.title, fontSize: fontSize + 2 }
        ))
        break
      case 'bullets':
      case 'numbered':
        block.items.forEach(item => {
          objects.push(...paragraphToTextObjects(
            item.runs, theme,
            {
              bullet: block.type === 'numbered' ? { type: 'number' } : true,
              indentLevel: item.level,
              paraSpaceAfter: 4
            },
            item.level > 0 ? { fontSize: Math.max(MIN_BODY_FONT_SIZE, fontSize - 2) } : {}
          ))
        })
        break
      case 'quote':
        objects.push(...paragraphToTextObjects(
          block.runs, theme,
          { paraSpaceAfter: 6, indentLevel: 1 },
          { italic: true, color: theme.muted }
        ))
        break
      default: // paragraph
        objects.push(...paragraphToTextObjects(block.runs, theme, { paraSpaceAfter: 6 }))
    }
  }
  return objects
}

// ============================================================================
// 正文分组：连续文本块合成一个文本框，表格/图片/代码各自独立
// ============================================================================

const TEXT_BLOCK_TYPES = new Set(['paragraph', 'heading', 'bullets', 'numbered', 'quote'])

const groupBlocks = (blocks) => {
  const groups = []
  let textBlocks = []
  const flush = () => {
    if (textBlocks.length > 0) {
      groups.push({ type: 'text', blocks: textBlocks })
      textBlocks = []
    }
  }
  for (const block of blocks) {
    if (TEXT_BLOCK_TYPES.has(block.type)) {
      textBlocks.push(block)
    } else {
      flush()
      groups.push({ type: block.type, block })
    }
  }
  flush()
  return groups
}

// ============================================================================
// 各类元素落到 slide 上
// ============================================================================

const addTextGroup = (slide, group, theme, y, availableHeight, fontFace) => {
  const paragraphs = textGroupParagraphs(group.blocks)
  const fontSize = pickBodyFontSize(paragraphs, availableHeight, BODY.w)
  const height = Math.max(0.4, estimateGroupHeight(paragraphs, fontSize, BODY.w))

  slide.addText(textGroupToObjects(group.blocks, theme, fontSize), {
    x: BODY.x, y, w: BODY.w, h: height,
    fontSize, fontFace, color: theme.text,
    valign: 'top', margin: 2
  })
  return height
}

const addTable = (slide, block, theme, y, fontFace) => {
  const cellText = (cellRuns) => runsToText(cellRuns) || ' '
  const header = block.header.map(cell => ({
    text: cellText(cell),
    options: { bold: true, fill: { color: theme.accent }, color: theme.accentText }
  }))
  const rows = block.rows.map((row, rowIdx) => row.map(cell => ({
    text: cellText(cell),
    options: rowIdx % 2 === 1 ? { fill: { color: theme.surface } } : {}
  })))
  const allRows = [header, ...rows]
  const rowH = block.header.length > 4 ? 0.32 : 0.36
  const height = rowH * allRows.length

  slide.addTable(allRows, {
    x: BODY.x, y, w: BODY.w, rowH,
    fontSize: 12, fontFace, color: theme.text,
    border: { type: 'solid', pt: 0.5, color: 'D9DEE7' },
    valign: 'middle', autoPage: false
  })
  return height
}

const addImage = async (slide, block, theme, y, availableHeight, fontFace) => {
  const image = await fetchImageForEmbedding(block.url)
  if (!image) {
    const placeholder = `[图片：${block.alt || block.url}]`
    slide.addText(placeholder, {
      x: BODY.x, y, w: BODY.w, h: 0.4,
      fontSize: 12, fontFace, color: theme.muted, italic: true
    })
    return 0.4
  }

  const maxH = Math.max(1.2, Math.min(availableHeight, 3.2))
  const ratio = image.width / image.height
  let w = Math.min(BODY.w, maxH * ratio)
  let h = w / ratio
  if (h > maxH) { h = maxH; w = h * ratio }

  slide.addImage({ data: image.dataUrl, x: (SLIDE_W - w) / 2, y, w, h })
  return h
}

const addCodeBlock = (slide, block, theme, y, fontFace) => {
  const lines = block.text.split('\n')
  const height = Math.min(3.0, lines.length * 0.22 + 0.2)
  slide.addText(
    lines.map((line, idx) => ({ text: line || ' ', options: { breakLine: idx < lines.length - 1 } })),
    {
      x: BODY.x, y, w: BODY.w, h: height,
      fontSize: 11, fontFace: SLIDE_CODE_FONT_FACE, color: theme.text,
      fill: { color: theme.surface }, valign: 'top', margin: 6
    }
  )
  return height
}

const addCoverSlide = (pptx, slide, deckSlide, theme, fontFace) => {
  slide.background = { color: theme.coverBg }
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 5.25, w: SLIDE_W, h: 0.375,
    fill: { color: theme.accent }, line: { color: theme.accent, width: 0 }
  })
  slide.addText(deckSlide.titleText || ' ', {
    x: 0.7, y: 1.5, w: 8.6, h: 1.5,
    fontSize: deckSlide.titleText.length > 18 ? 32 : 40, bold: true,
    color: theme.coverFg, fontFace, align: 'center', valign: 'middle'
  })
  if (deckSlide.subtitle) {
    slide.addText(deckSlide.subtitle, {
      x: 1.0, y: 3.1, w: 8.0, h: 1.0,
      fontSize: 20, color: theme.coverFg, fontFace, align: 'center', valign: 'top'
    })
  }
}

const addSectionSlide = (pptx, slide, deckSlide, theme, fontFace) => {
  slide.background = { color: theme.surface }
  slide.addText(deckSlide.titleText || ' ', {
    x: 0.7, y: 1.8, w: 8.6, h: 1.3,
    fontSize: 34, bold: true, color: theme.title, fontFace, align: 'center', valign: 'middle'
  })
  slide.addShape(pptx.ShapeType.rect, {
    x: 4.4, y: 3.2, w: 1.2, h: 0.06,
    fill: { color: theme.accent }, line: { color: theme.accent, width: 0 }
  })
  if (deckSlide.subtitle) {
    slide.addText(deckSlide.subtitle, {
      x: 1.0, y: 3.45, w: 8.0, h: 0.9,
      fontSize: 18, color: theme.muted, fontFace, align: 'center', valign: 'top'
    })
  }
}

const addContentSlide = async (pptx, slide, deckSlide, deckTitle, theme, fontFace) => {
  slide.background = { color: theme.bg }

  // 标题：过长时降字号
  const titleText = deckSlide.titleText
  const titleFontSize = estimateLines(titleText, 28, TITLE_BOX.w) > 1 ? 22 : 28
  slide.addText(
    deckSlide.title.length > 0
      ? deckSlide.title.map((run, idx) => {
        const obj = runToTextObject(run, theme)
        if (idx === deckSlide.title.length - 1) obj.options.breakLine = false
        return obj
      })
      : ' ',
    {
      ...TITLE_BOX, fontSize: titleFontSize, bold: true,
      color: theme.title, fontFace, valign: 'middle', margin: 0
    }
  )
  slide.addShape(pptx.ShapeType.rect, {
    ...ACCENT_BAR, fill: { color: theme.accent }, line: { color: theme.accent, width: 0 }
  })

  // 正文
  let y = BODY.y
  const bottom = BODY.y + BODY.h
  for (const group of groupBlocks(deckSlide.blocks)) {
    const available = Math.max(0.5, bottom - y)
    let used = 0
    switch (group.type) {
      case 'text':
        used = addTextGroup(slide, group, theme, y, available, fontFace)
        break
      case 'table':
        used = addTable(slide, group.block, theme, y, fontFace)
        break
      case 'image':
        used = await addImage(slide, group.block, theme, y, available, fontFace)
        break
      case 'code':
        used = addCodeBlock(slide, group.block, theme, y, fontFace)
        break
      default:
        used = 0
    }
    y += used + BLOCK_GAP
  }

  // 页脚：左侧 deck 标题，右侧页码
  if (deckTitle) {
    slide.addText(deckTitle, {
      x: 0.5, y: FOOTER.y, w: 6.5, h: FOOTER.h,
      fontSize: 10, color: theme.muted, fontFace, valign: 'middle', margin: 0
    })
  }
  slide.slideNumber = {
    x: 8.8, y: FOOTER.y, w: 0.7, h: FOOTER.h,
    fontSize: 10, color: theme.muted, fontFace, align: 'right'
  }
}

// ============================================================================
// 对外
// ============================================================================

/**
 * 生成 .pptx
 * @param {string} markdown - pptx 代码块内容
 * @param {Object} [options]
 * @param {string} [options.themeKey] - slideThemes 的主题键
 * @returns {Promise<{ blob: Blob, deck: Object }>}
 */
export const buildPptxBlob = async (markdown, { themeKey } = {}) => {
  const deck = parseSlideDeck(markdown)
  if (deck.slides.length === 0) {
    throw new Error('EMPTY_DECK')
  }

  const { default: PptxGenJS } = await import('pptxgenjs')
  const theme = getSlideTheme(themeKey)
  const fontFace = SLIDE_FONT_FACE

  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_16x9'
  if (deck.title) pptx.title = deck.title

  for (const deckSlide of deck.slides) {
    const slide = pptx.addSlide()
    if (deckSlide.layout === SLIDE_LAYOUTS.TITLE) {
      addCoverSlide(pptx, slide, deckSlide, theme, fontFace)
    } else if (deckSlide.layout === SLIDE_LAYOUTS.SECTION) {
      addSectionSlide(pptx, slide, deckSlide, theme, fontFace)
    } else {
      await addContentSlide(pptx, slide, deckSlide, deck.title, theme, fontFace)
    }
    if (deckSlide.notes) slide.addNotes(deckSlide.notes)
  }

  const blob = await pptx.write({ outputType: 'blob' })
  return { blob, deck }
}

export default { buildPptxBlob }

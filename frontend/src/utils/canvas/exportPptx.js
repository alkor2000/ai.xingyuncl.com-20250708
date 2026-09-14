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
 *
 * v2.1 模板：封面背景 = 用户自备图（slideBackgrounds，盖 58% 主题色）> 程序生成图（slideArt）
 * > 纯色；内容页按主题 content 版式画 header（accent-bar / title-band / side-stripe / minimal /
 * card），正文区坐标由 addContentHeader 返回，元素落位函数都接收这个 box。
 * pptxgenjs 没有渐变填充，渐变一律走 canvas 生成的 PNG（背景/色带）。
 */

import { parseSlideDeck, runsToText, SLIDE_LAYOUTS } from './slideDeck'
import { getSlideTheme, SLIDE_CODE_FONT_FACE } from './slideThemes'
import { renderCoverArt, renderBandArt } from './slideArt'
import { getThemeBackgrounds } from './slideBackgrounds'
import { fetchImageForEmbedding } from './download'

// ---- 版面常量（英寸，16:9 = 10 × 5.625）；与 SlidesPreview.less 的 960×540 像素版面同比例 ----
const SLIDE_W = 10
const SLIDE_H = 5.625
/** 内容页：header 152px → 1.58in，正文 355px → 3.7in，页脚贴底 */
const TITLE_BOX = { x: 0.5, y: 0.35, w: 9.0, h: 0.9 }
const ACCENT_BAR = { x: 0.5, y: 1.3, w: 1.0, h: 0.06 }
const BODY = { x: 0.5, y: 1.58, w: 9.0, h: 3.7 }
const FOOTER = { y: 5.2, h: 0.3 }
const BLOCK_GAP = 0.12
/** side-stripe 版式：内容整体右移 70px → 0.73in */
const STRIPE_INSET = 0.73
/** split 封面左色块宽 400px → 4.17in */
const SPLIT_W = 4.17

/** 无线条的形状描边（pptxgenjs 默认会画细线） */
const noLine = (color) => ({ color, width: 0 })

/** 背景是否偏暗（决定表格边框用浅灰还是深灰） */
const isDarkHex = (hex) => {
  const n = parseInt(String(hex).slice(0, 6), 16)
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)
  return lum < 110
}

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

const addTextGroup = (slide, group, theme, y, availableHeight, fontFace, box = BODY) => {
  const paragraphs = textGroupParagraphs(group.blocks)
  const fontSize = pickBodyFontSize(paragraphs, availableHeight, box.w)
  const height = Math.max(0.4, estimateGroupHeight(paragraphs, fontSize, box.w))

  slide.addText(textGroupToObjects(group.blocks, theme, fontSize), {
    x: box.x, y, w: box.w, h: height,
    fontSize, fontFace, color: theme.text,
    valign: 'top', margin: 2
  })
  return height
}

const addTable = (slide, block, theme, y, fontFace, box = BODY) => {
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
    x: box.x, y, w: box.w, rowH,
    fontSize: 12, fontFace, color: theme.text,
    border: { type: 'solid', pt: 0.5, color: isDarkHex(theme.bg) ? '3A4556' : 'D9DEE7' },
    valign: 'middle', autoPage: false
  })
  return height
}

const addImage = async (slide, block, theme, y, availableHeight, fontFace, box = BODY) => {
  const image = await fetchImageForEmbedding(block.url)
  if (!image) {
    const placeholder = `[图片：${block.alt || block.url}]`
    slide.addText(placeholder, {
      x: box.x, y, w: box.w, h: 0.4,
      fontSize: 12, fontFace, color: theme.muted, italic: true
    })
    return 0.4
  }

  const maxH = Math.max(1.2, Math.min(availableHeight, 3.2))
  const ratio = image.width / image.height
  let w = Math.min(box.w, maxH * ratio)
  let h = w / ratio
  if (h > maxH) { h = maxH; w = h * ratio }

  slide.addImage({ data: image.dataUrl, x: box.x + (box.w - w) / 2, y, w, h })
  return h
}

const addCodeBlock = (slide, block, theme, y, fontFace, box = BODY) => {
  const lines = block.text.split('\n')
  const height = Math.min(3.0, lines.length * 0.22 + 0.2)
  slide.addText(
    lines.map((line, idx) => ({ text: line || ' ', options: { breakLine: idx < lines.length - 1 } })),
    {
      x: box.x, y, w: box.w, h: height,
      fontSize: 11, fontFace: SLIDE_CODE_FONT_FACE, color: theme.text,
      fill: { color: theme.surface }, valign: 'top', margin: 6
    }
  )
  return height
}

// ============================================================================
// 背景：用户自备图 > 程序生成图 > 纯色
// ============================================================================

/**
 * 解析主题背景资源（导出时）
 * @returns {Promise<{ coverData: string|null, coverIsPhoto: boolean, contentData: string|null }>}
 */
const resolveBackgrounds = async (theme) => {
  const custom = getThemeBackgrounds(theme.key)
  let coverData = null
  let coverIsPhoto = false
  if (custom.cover) {
    const img = await fetchImageForEmbedding(custom.cover)
    if (img) { coverData = img.dataUrl; coverIsPhoto = true }
  }
  if (!coverData) coverData = renderCoverArt(theme.key)
  let contentData = null
  if (custom.content) {
    const img = await fetchImageForEmbedding(custom.content)
    if (img) contentData = img.dataUrl
  }
  return { coverData, coverIsPhoto, contentData }
}

const addRect = (pptx, slide, box, color, extra = {}) => {
  slide.addShape(pptx.ShapeType.rect, { ...box, fill: { color, ...extra }, line: noLine(color) })
}

// ============================================================================
// 封面 / 章节页
// ============================================================================

const addCoverSlide = (pptx, slide, deckSlide, theme, backgrounds) => {
  const titleFont = theme.titleFont
  const bodyFont = theme.bodyFont
  const { coverData, coverIsPhoto } = backgrounds
  const isSplit = theme.cover === 'split'
  const isLightCover = theme.cover === 'solid' && theme.decor === 'lines' // minimal / academic 这类浅底封面

  if (isSplit) {
    // 左色块（图或纯色）+ 右侧白底深色标题
    slide.background = { color: theme.bg }
    if (coverData) {
      slide.addImage({ data: coverData, x: 0, y: 0, w: SPLIT_W, h: SLIDE_H, sizing: { type: 'cover', w: SPLIT_W, h: SLIDE_H } })
      if (coverIsPhoto) addRect(pptx, slide, { x: 0, y: 0, w: SPLIT_W, h: SLIDE_H }, theme.coverBg, { transparency: 42 })
    } else {
      addRect(pptx, slide, { x: 0, y: 0, w: SPLIT_W, h: SLIDE_H }, theme.coverBg)
    }
    addRect(pptx, slide, { x: SPLIT_W, y: SLIDE_H - 0.1, w: SLIDE_W - SPLIT_W, h: 0.1 }, theme.accent)
    slide.addText(deckSlide.titleText || ' ', {
      x: SPLIT_W + 0.45, y: 1.4, w: SLIDE_W - SPLIT_W - 0.9, h: 1.7,
      fontSize: deckSlide.titleText.length > 16 ? 30 : 36, bold: true,
      color: theme.title, fontFace: titleFont, align: 'left', valign: 'middle'
    })
    if (deckSlide.subtitle) {
      slide.addText(deckSlide.subtitle, {
        x: SPLIT_W + 0.45, y: 3.15, w: SLIDE_W - SPLIT_W - 0.9, h: 0.9,
        fontSize: 18, color: theme.muted, fontFace: bodyFont, align: 'left', valign: 'top'
      })
    }
    return
  }

  // 整页背景
  if (coverData) {
    slide.background = { data: coverData }
    if (coverIsPhoto) addRect(pptx, slide, { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H }, theme.coverBg, { transparency: 42 })
  } else {
    slide.background = { color: theme.coverBg }
  }

  // 装饰：半透明大圆
  if (theme.decor === 'circles') {
    slide.addShape(pptx.ShapeType.ellipse, {
      x: 6.6, y: -2.3, w: 5.4, h: 5.4,
      fill: { color: theme.coverFg, transparency: 90 }, line: noLine(theme.coverFg)
    })
    slide.addShape(pptx.ShapeType.ellipse, {
      x: -0.9, y: 3.7, w: 2.7, h: 2.7,
      fill: { color: theme.accent2, transparency: 78 }, line: noLine(theme.accent2)
    })
  }

  // 底部强调条
  addRect(pptx, slide, { x: 0, y: SLIDE_H - (theme.decor === 'lines' ? 0.125 : 0.375), w: SLIDE_W, h: theme.decor === 'lines' ? 0.125 : 0.375 }, theme.accent)

  // 标题（decor=lines 时上下各一条细线）
  const titleBox = { x: 0.8, y: 1.55, w: 8.4, h: 1.5 }
  if (theme.decor === 'lines') {
    addRect(pptx, slide, { x: 1.6, y: titleBox.y - 0.05, w: 6.8, h: 0.025 }, theme.coverFg)
    addRect(pptx, slide, { x: 1.6, y: titleBox.y + titleBox.h + 0.02, w: 6.8, h: 0.025 }, theme.coverFg)
  }
  slide.addText(deckSlide.titleText || ' ', {
    ...titleBox,
    fontSize: deckSlide.titleText.length > 18 ? 32 : 40, bold: true,
    color: theme.coverFg, fontFace: titleFont, align: 'center', valign: 'middle',
    shadow: isLightCover ? undefined : { type: 'outer', color: '000000', blur: 6, offset: 1, angle: 90, opacity: 0.18 }
  })
  if (deckSlide.subtitle) {
    slide.addText(deckSlide.subtitle, {
      x: 1.0, y: 3.25, w: 8.0, h: 0.9,
      fontSize: 20, color: theme.coverFg, fontFace: bodyFont, align: 'center', valign: 'top',
      transparency: 15
    })
  }
}

const addSectionSlide = (pptx, slide, deckSlide, theme) => {
  slide.background = { color: theme.surface }
  slide.addText(deckSlide.titleText || ' ', {
    x: 0.7, y: 1.8, w: 8.6, h: 1.3,
    fontSize: 34, bold: true, color: theme.title, fontFace: theme.titleFont, align: 'center', valign: 'middle'
  })
  addRect(pptx, slide, { x: 4.4, y: 3.2, w: 1.2, h: 0.06 }, theme.accent)
  if (deckSlide.subtitle) {
    slide.addText(deckSlide.subtitle, {
      x: 1.0, y: 3.45, w: 8.0, h: 0.9,
      fontSize: 18, color: theme.muted, fontFace: theme.bodyFont, align: 'center', valign: 'top'
    })
  }
}

// ============================================================================
// 内容页：按主题 content 版式排 header，正文区共用
// ============================================================================

/**
 * 画 header 并返回正文区域 { x, y, w, h } 与页脚左边距
 */
const addContentHeader = (pptx, slide, deckSlide, theme) => {
  const layout = theme.content
  const titleFont = theme.titleFont
  const titleText = deckSlide.titleText
  const titleRuns = deckSlide.title.length > 0
    ? deckSlide.title.map(run => runToTextObject(run, theme))
    : ' '
  const inset = layout === 'side-stripe' ? STRIPE_INSET : 0.5
  const width = SLIDE_W - inset - 0.5
  const titleFontSize = estimateLines(titleText, 28, width) > 1 ? 22 : 28

  if (layout === 'title-band') {
    const band = renderBandArt(theme.key)
    if (band) {
      slide.addImage({ data: band, x: 0, y: 0, w: SLIDE_W, h: BODY.y, sizing: { type: 'cover', w: SLIDE_W, h: BODY.y } })
    } else {
      addRect(pptx, slide, { x: 0, y: 0, w: SLIDE_W, h: BODY.y }, theme.coverBg)
    }
    slide.addText(titleRuns, {
      x: 0.5, y: 0.3, w: 9.0, h: 0.9, fontSize: titleFontSize, bold: true,
      color: theme.coverFg, fontFace: titleFont, valign: 'middle', margin: 0
    })
    addRect(pptx, slide, { x: 0.5, y: 1.25, w: 0.73, h: 0.05 }, theme.accent)
  } else if (layout === 'minimal') {
    slide.addText(titleRuns, {
      ...TITLE_BOX, fontSize: titleFontSize, bold: true,
      color: theme.title, fontFace: titleFont, valign: 'middle', margin: 0
    })
    addRect(pptx, slide, { x: 0.5, y: 1.36, w: 9.0, h: 0.02 }, theme.muted, { transparency: 45 })
  } else {
    if (layout === 'side-stripe') {
      addRect(pptx, slide, { x: 0, y: 0, w: 0.167, h: SLIDE_H / 2 }, theme.accent)
      addRect(pptx, slide, { x: 0, y: SLIDE_H / 2, w: 0.167, h: SLIDE_H / 2 }, theme.accent2)
    }
    slide.addText(titleRuns, {
      x: inset, y: TITLE_BOX.y, w: width, h: TITLE_BOX.h, fontSize: titleFontSize, bold: true,
      color: theme.title, fontFace: titleFont, valign: 'middle', margin: 0
    })
    addRect(pptx, slide, { x: inset, y: ACCENT_BAR.y, w: layout === 'card' ? 0.63 : ACCENT_BAR.w, h: ACCENT_BAR.h }, theme.accent)
  }

  let body = { x: inset, y: BODY.y, w: width, h: BODY.h }
  if (layout === 'card') {
    slide.addShape(pptx.ShapeType.roundRect, {
      ...body, fill: { color: theme.surface }, line: noLine(theme.surface), rectRadius: 0.15
    })
    body = { x: body.x + 0.25, y: body.y + 0.18, w: body.w - 0.5, h: body.h - 0.36 }
  }
  return { body, footerX: inset }
}

const addContentSlide = async (pptx, slide, deckSlide, deckTitle, theme, backgrounds) => {
  const bodyFont = theme.bodyFont
  if (backgrounds.contentData) {
    slide.background = { data: backgrounds.contentData }
  } else {
    slide.background = { color: theme.bg }
  }

  const { body, footerX } = addContentHeader(pptx, slide, deckSlide, theme)

  // 用户自备内容页背景：正文区盖一层底色保证可读（与预览一致）
  if (backgrounds.contentData) {
    slide.addShape(pptx.ShapeType.roundRect, {
      ...body, fill: { color: theme.bg, transparency: 10 }, line: noLine(theme.bg), rectRadius: 0.12
    })
  }

  // 正文
  let y = body.y
  const bottom = body.y + body.h
  for (const group of groupBlocks(deckSlide.blocks)) {
    const available = Math.max(0.5, bottom - y)
    let used = 0
    switch (group.type) {
      case 'text':
        used = addTextGroup(slide, group, theme, y, available, bodyFont, body)
        break
      case 'table':
        used = addTable(slide, group.block, theme, y, bodyFont, body)
        break
      case 'image':
        used = await addImage(slide, group.block, theme, y, available, bodyFont, body)
        break
      case 'code':
        used = addCodeBlock(slide, group.block, theme, y, bodyFont, body)
        break
      default:
        used = 0
    }
    y += used + BLOCK_GAP
  }

  // 页脚：左侧 deck 标题，右侧页码
  if (deckTitle) {
    slide.addText(deckTitle, {
      x: footerX, y: FOOTER.y, w: 6.5, h: FOOTER.h,
      fontSize: 10, color: theme.muted, fontFace: bodyFont, valign: 'middle', margin: 0
    })
  }
  slide.slideNumber = {
    x: 8.8, y: FOOTER.y, w: 0.7, h: FOOTER.h,
    fontSize: 10, color: theme.muted, fontFace: bodyFont, align: 'right'
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
  const backgrounds = await resolveBackgrounds(theme)

  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_16x9'
  if (deck.title) pptx.title = deck.title

  for (const deckSlide of deck.slides) {
    const slide = pptx.addSlide()
    if (deckSlide.layout === SLIDE_LAYOUTS.TITLE) {
      addCoverSlide(pptx, slide, deckSlide, theme, backgrounds)
    } else if (deckSlide.layout === SLIDE_LAYOUTS.SECTION) {
      addSectionSlide(pptx, slide, deckSlide, theme)
    } else {
      await addContentSlide(pptx, slide, deckSlide, deck.title, theme, backgrounds)
    }
    if (deckSlide.notes) slide.addNotes(deckSlide.notes)
  }

  const blob = await pptx.write({ outputType: 'blob' })
  return { blob, deck }
}

export default { buildPptxBlob }

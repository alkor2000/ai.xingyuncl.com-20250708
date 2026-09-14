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
 * pptxgenjs 没有渐变填充，渐变一律走 canvas 生成的 JPEG（背景/色带）。
 *
 * v2.2 智能排版：deckSlide.smart（slideDeck.detectSmartLayout）非空时正文按分栏/流程图/
 * 卡片/图文/引言用形状+文本框排，与 SlidesPreview 的对应视图同构。
 */

import { parseSlideDeck, runsToText, isCompactTitle, SLIDE_LAYOUTS, SMART_LAYOUTS } from './slideDeck'
import { getSlideTheme, isDarkHex, SLIDE_CODE_FONT_FACE } from './slideThemes'
import { renderCoverArt, renderContentArt, renderBandArt } from './slideArt'
import { getThemeBackgrounds } from './slideBackgrounds'
import { fetchImageForEmbedding } from './download'

// ---- 版面常量（英寸，16:9 = 10 × 5.625）；与 SlidesPreview.less 的 960×540 像素版面同比例 ----
const SLIDE_W = 10
const SLIDE_H = 5.625
/** 内容页：header 152px → 1.58in，正文 355px → 3.7in，页脚贴底 */
const TITLE_BOX = { x: 0.5, y: 0.35, w: 9.0, h: 0.9 }
const ACCENT_BAR = { x: 0.5, y: 1.3, w: 1.0, h: 0.06 }
const BODY = { x: 0.5, y: 1.58, w: 9.0, h: 3.7 }
/** 标题一行放得下时的紧凑页眉：header 114px → 1.19in，正文 393px → 4.09in（与预览 .compact-header 一致） */
const COMPACT = { titleH: 0.55, barY: 0.97, bodyY: 1.19, bodyH: 4.09, bandTitleY: 0.3, bandBarY: 0.9, minimalLineY: 0.98 }
const REGULAR = { titleH: 0.9, barY: 1.3, bodyY: 1.58, bodyH: 3.7, bandTitleY: 0.3, bandBarY: 1.25, minimalLineY: 1.36 }
const FOOTER = { y: 5.2, h: 0.3 }
const BLOCK_GAP = 0.12
/** side-stripe 版式：内容整体右移 70px → 0.73in */
const STRIPE_INSET = 0.73
/** split 封面左色块宽 400px → 4.17in */
const SPLIT_W = 4.17

/** 无线条的形状描边（pptxgenjs 默认会画细线） */
const noLine = (color) => ({ color, width: 0 })


/** 正文候选字号，从大到小挑第一个装得下的（预览缩到 13px≈10pt 为止，这里同样到 10） */
const BODY_FONT_SIZES = [20, 18, 16, 14, 12, 11, 10]
const MIN_BODY_FONT_SIZE = 10
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

/** 提示框：浅色圆角底 + 左侧强调条 + "标签：正文" */
const addCallout = (pptx, slide, block, theme, y, fontFace, box = BODY) => {
  const text = `${block.label}：${runsToText(block.runs)}`
  const lines = estimateLines(text, 14, box.w - 0.5)
  const height = Math.max(0.5, lines * lineHeightIn(14) + 0.22)
  slide.addShape(pptx.ShapeType.roundRect, {
    x: box.x, y, w: box.w, h: height, fill: { color: theme.surface }, line: noLine(theme.surface), rectRadius: 0.08
  })
  addRect(pptx, slide, { x: box.x, y: y + 0.06, w: 0.07, h: height - 0.12 }, theme.accent)
  slide.addText([
    { text: `${block.label}：`, options: { bold: true, color: theme.accent } },
    ...block.runs.map(run => runToTextObject(run, theme))
  ], {
    x: box.x + 0.2, y, w: box.w - 0.3, h: height, fontSize: 14, color: theme.text, fontFace, valign: 'middle', margin: 2
  })
  return height
}

/**
 * 箭头链 "A → B → C"：一行胶囊 + 小箭头的流程条；超过 4 步折两行（与预览 .slide-chain 一致）
 */
const addChain = (pptx, slide, block, theme, y, fontFace, box = BODY) => {
  const steps = block.steps
  const perRow = steps.length <= 4 ? steps.length : Math.ceil(steps.length / 2)
  const rows = Math.ceil(steps.length / perRow)
  const rowH = 0.5
  const gapY = 0.14
  const arrowW = 0.3
  const pillW = (box.w - arrowW * (perRow - 1)) / perRow
  const fontSize = perRow >= 4 ? 12 : 14
  steps.forEach((step, idx) => {
    const col = idx % perRow
    const row = Math.floor(idx / perRow)
    const x = box.x + col * (pillW + arrowW)
    const py = y + row * (rowH + gapY)
    slide.addShape(pptx.ShapeType.roundRect, {
      x, y: py, w: pillW, h: rowH, fill: { color: theme.surface }, line: { color: theme.accent, width: 1.25 }, rectRadius: 0.25
    })
    slide.addText(step, {
      x, y: py, w: pillW, h: rowH, fontSize, bold: true, color: theme.title, fontFace, align: 'center', valign: 'middle', margin: 2
    })
    if (col < perRow - 1 && idx < steps.length - 1) {
      slide.addText('→', {
        x: x + pillW, y: py, w: arrowW, h: rowH, fontSize: 16, bold: true, color: theme.accent,
        fontFace: 'Arial', align: 'center', valign: 'middle', margin: 0
      })
    }
  })
  return rows * rowH + (rows - 1) * gapY
}

/** 公式块：浅底居中大字（文本已由 latexToText 折成 Unicode） */
const addFormula = (pptx, slide, block, theme, y, fontFace, box = BODY) => {
  const fontSize = 16
  const lines = block.text.split('\n').reduce((sum, line) => sum + estimateLines(line, fontSize, box.w - 0.6), 0)
  const height = Math.max(0.55, lines * lineHeightIn(fontSize) * 1.15 + 0.3)
  slide.addShape(pptx.ShapeType.roundRect, {
    x: box.x, y, w: box.w, h: height, fill: { color: theme.surface }, line: noLine(theme.surface), rectRadius: 0.1
  })
  slide.addText(block.text, {
    x: box.x + 0.2, y, w: box.w - 0.4, h: height, fontSize, bold: true, color: theme.title, fontFace,
    align: 'center', valign: 'middle', margin: 2
  })
  return height
}

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
  // 文本框不越出正文区；估行数偏小时让 PowerPoint 自己再缩（normAutofit）
  const height = Math.min(Math.max(0.4, estimateGroupHeight(paragraphs, fontSize, box.w)), Math.max(0.4, availableHeight))

  slide.addText(textGroupToObjects(group.blocks, theme, fontSize), {
    x: box.x, y, w: box.w, h: height,
    fontSize, fontFace, color: theme.text,
    valign: 'top', margin: 2, fit: 'shrink'
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
  let contentIsPhoto = false
  if (custom.content) {
    const img = await fetchImageForEmbedding(custom.content)
    if (img) { contentData = img.dataUrl; contentIsPhoto = true }
  }
  if (!contentData) contentData = renderContentArt(theme.key)
  return { coverData, coverIsPhoto, contentData, contentIsPhoto }
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
  if (deckSlide.sectionIndex > 0) {
    // 章节大编号：淡色压在右上（与预览的 .slide-section-num 一致）
    slide.addText(String(deckSlide.sectionIndex).padStart(2, '0'), {
      x: 5.4, y: 0.1, w: 4.3, h: 2.6, fontSize: 150, bold: true, color: theme.accent, transparency: 86,
      fontFace: 'Arial', align: 'right', valign: 'top', margin: 0
    })
  }
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
  const geo = isCompactTitle(titleText) ? COMPACT : REGULAR
  const titleFontSize = estimateLines(titleText, 28, width) > 1 ? 22 : 28

  if (layout === 'title-band') {
    const band = renderBandArt(theme.key)
    if (band) {
      slide.addImage({ data: band, x: 0, y: 0, w: SLIDE_W, h: geo.bodyY, sizing: { type: 'cover', w: SLIDE_W, h: geo.bodyY } })
    } else {
      addRect(pptx, slide, { x: 0, y: 0, w: SLIDE_W, h: geo.bodyY }, theme.coverBg)
    }
    slide.addText(titleRuns, {
      x: 0.5, y: geo.bandTitleY, w: 9.0, h: geo.titleH, fontSize: titleFontSize, bold: true,
      color: theme.coverFg, fontFace: titleFont, valign: 'middle', margin: 0
    })
    addRect(pptx, slide, { x: 0.5, y: geo.bandBarY, w: 0.73, h: 0.05 }, theme.accent)
  } else if (layout === 'minimal') {
    slide.addText(titleRuns, {
      ...TITLE_BOX, h: geo.titleH, fontSize: titleFontSize, bold: true,
      color: theme.title, fontFace: titleFont, valign: 'middle', margin: 0
    })
    addRect(pptx, slide, { x: 0.5, y: geo.minimalLineY, w: 9.0, h: 0.02 }, theme.muted, { transparency: 45 })
  } else {
    if (layout === 'side-stripe') {
      addRect(pptx, slide, { x: 0, y: 0, w: 0.167, h: SLIDE_H / 2 }, theme.accent)
      addRect(pptx, slide, { x: 0, y: SLIDE_H / 2, w: 0.167, h: SLIDE_H / 2 }, theme.accent2)
    }
    slide.addText(titleRuns, {
      x: inset, y: TITLE_BOX.y, w: width, h: geo.titleH, fontSize: titleFontSize, bold: true,
      color: theme.title, fontFace: titleFont, valign: 'middle', margin: 0
    })
    addRect(pptx, slide, { x: inset, y: geo.barY, w: layout === 'card' ? 0.63 : ACCENT_BAR.w, h: ACCENT_BAR.h }, theme.accent)
  }

  let body = { x: inset, y: geo.bodyY, w: width, h: geo.bodyH }
  if (layout === 'card') {
    slide.addShape(pptx.ShapeType.roundRect, {
      ...body, fill: { color: theme.surface }, line: noLine(theme.surface), rectRadius: 0.15
    })
    body = { x: body.x + 0.25, y: body.y + 0.18, w: body.w - 0.5, h: body.h - 0.36 }
  }
  return { body, footerX: inset }
}

// ============================================================================
// 智能排版：与 SlidesPreview 的 ColumnsView / FlowView / CardsView / ImageTextView / QuoteView 对应
// ============================================================================

/** 正文块序列落到给定 box 里（分栏/图文共用），返回用掉的高度 */
const addBlocksInBox = async (pptx, slide, blocks, theme, box, fontFace) => {
  let y = box.y
  const bottom = box.y + box.h
  for (const group of groupBlocks(blocks)) {
    const available = Math.max(0.5, bottom - y)
    let used = 0
    switch (group.type) {
      case 'text': used = addTextGroup(slide, group, theme, y, available, fontFace, box); break
      case 'table': used = addTable(slide, group.block, theme, y, fontFace, box); break
      case 'image': used = await addImage(slide, group.block, theme, y, available, fontFace, box); break
      case 'code': used = addCodeBlock(slide, group.block, theme, y, fontFace, box); break
      case 'callout': used = addCallout(pptx, slide, group.block, theme, y, fontFace, box); break
      case 'chain': used = addChain(pptx, slide, group.block, theme, y, fontFace, box); break
      case 'formula': used = addFormula(pptx, slide, group.block, theme, y, fontFace, box); break
      default: used = 0
    }
    y += used + BLOCK_GAP
  }
  return y - box.y
}

const addIntro = (slide, intro, theme, box, fontFace) => {
  if (!intro) return 0
  const h = 0.45
  slide.addText(intro.runs.map(run => runToTextObject(run, theme)), {
    x: box.x, y: box.y, w: box.w, h, fontSize: 13, color: theme.muted, fontFace, valign: 'top', margin: 0
  })
  return h + 0.1
}

const addSmartColumns = async (pptx, slide, smart, theme, box, fontFace) => {
  const top = addIntro(slide, smart.intro, theme, box, fontFace)
  const n = smart.columns.length
  const gap = 0.3
  const colW = (box.w - gap * (n - 1)) / n
  const titleH = 0.5
  for (let i = 0; i < n; i += 1) {
    const col = smart.columns[i]
    const x = box.x + i * (colW + gap)
    slide.addText(col.title.map(run => runToTextObject(run, theme)), {
      x, y: box.y + top, w: colW, h: titleH, fontSize: n === 3 ? 15 : 17, bold: true,
      color: theme.title, fontFace: theme.titleFont, valign: 'middle', margin: 0
    })
    addRect(pptx, slide, { x, y: box.y + top + titleH, w: colW, h: 0.035 }, theme.accent)
    await addBlocksInBox(pptx, slide, col.blocks, theme, {
      x, y: box.y + top + titleH + 0.15, w: colW, h: box.h - top - titleH - 0.15
    }, fontFace)
  }
}

const addSmartFlow = (pptx, slide, smart, theme, box, fontFace) => {
  const top = addIntro(slide, smart.intro, theme, box, fontFace)
  const steps = smart.steps
  const n = steps.length
  const perRow = n <= 4 ? n : Math.ceil(n / 2)
  const rows = Math.ceil(n / perRow)
  const arrowW = 0.35
  const gap = 0.12
  const cardW = (box.w - (perRow - 1) * (arrowW + gap * 2)) / perRow
  const cardH = rows === 1 ? 1.5 : 1.25
  const rowGap = 0.5
  const blockH = rows * cardH + (rows - 1) * rowGap
  const startY = box.y + top + Math.max(0, (box.h - top - blockH) / 2)
  const badge = 0.42

  steps.forEach((runs, idx) => {
    const row = Math.floor(idx / perRow)
    const colIdx = idx % perRow
    const x = box.x + colIdx * (cardW + arrowW + gap * 2)
    const y = startY + row * (cardH + rowGap)
    slide.addShape(pptx.ShapeType.roundRect, {
      x, y, w: cardW, h: cardH, fill: { color: theme.surface }, line: noLine(theme.surface), rectRadius: 0.12
    })
    slide.addShape(pptx.ShapeType.ellipse, {
      x: x + cardW / 2 - badge / 2, y: y - badge / 2, w: badge, h: badge,
      fill: { color: theme.accent }, line: noLine(theme.accent)
    })
    slide.addText(String(idx + 1), {
      x: x + cardW / 2 - badge / 2, y: y - badge / 2, w: badge, h: badge,
      fontSize: 13, bold: true, color: theme.accentText, fontFace, align: 'center', valign: 'middle', margin: 0
    })
    slide.addText(runs.map(run => runToTextObject(run, theme)), {
      x: x + 0.08, y: y + badge / 2, w: cardW - 0.16, h: cardH - badge / 2 - 0.08,
      fontSize: n > 4 ? 12 : 14, color: theme.text, fontFace, align: 'center', valign: 'middle', margin: 2
    })
    if (colIdx < perRow - 1 && idx < n - 1) {
      slide.addShape(pptx.ShapeType.rightArrow, {
        x: x + cardW + gap, y: y + cardH / 2 - 0.16, w: arrowW, h: 0.32,
        fill: { color: theme.accent }, line: noLine(theme.accent)
      })
    }
  })
}

const addSmartCards = (pptx, slide, smart, theme, box, fontFace) => {
  const top = addIntro(slide, smart.intro, theme, box, fontFace)
  const cards = smart.cards
  const n = cards.length
  const cols = n <= 4 ? 2 : 3
  const rows = Math.ceil(n / cols)
  const gap = 0.2
  const cardW = (box.w - gap * (cols - 1)) / cols
  const cardH = Math.min(1.7, (box.h - top - gap * (rows - 1)) / rows)
  const startY = box.y + top + Math.max(0, (box.h - top - (rows * cardH + (rows - 1) * gap)) / 2)

  cards.forEach((card, idx) => {
    const x = box.x + (idx % cols) * (cardW + gap)
    const y = startY + Math.floor(idx / cols) * (cardH + gap)
    slide.addShape(pptx.ShapeType.roundRect, {
      x, y, w: cardW, h: cardH, fill: { color: theme.surface }, line: noLine(theme.surface), rectRadius: 0.1
    })
    addRect(pptx, slide, { x: x + 0.15, y, w: cardW - 0.3, h: 0.05 }, theme.accent)
    slide.addText(card.title.map(run => runToTextObject(run, theme)), {
      x: x + 0.15, y: y + 0.12, w: cardW - 0.3, h: 0.42, fontSize: cols === 3 ? 14 : 16, bold: true,
      color: theme.title, fontFace: theme.titleFont, valign: 'middle', margin: 0
    })
    slide.addText(card.body.length ? card.body.map(run => runToTextObject(run, theme)) : ' ', {
      x: x + 0.15, y: y + 0.56, w: cardW - 0.3, h: cardH - 0.64, fontSize: cols === 3 ? 11 : 13,
      color: theme.text, fontFace, valign: 'top', margin: 0
    })
  })
}

const addSmartImageText = async (pptx, slide, smart, theme, box, fontFace) => {
  const textW = box.w * 0.52
  const imgBox = { x: box.x + textW + 0.3, y: box.y, w: box.w - textW - 0.3, h: box.h }
  await addBlocksInBox(pptx, slide, smart.blocks, theme, { x: box.x, y: box.y, w: textW, h: box.h }, fontFace)
  const image = await fetchImageForEmbedding(smart.image.url)
  if (!image) {
    slide.addText(`[图片：${smart.image.alt || smart.image.url}]`, {
      ...imgBox, fontSize: 12, color: theme.muted, fontFace, italic: true, align: 'center', valign: 'middle'
    })
    return
  }
  const ratio = image.width / image.height
  let w = imgBox.w
  let h = w / ratio
  if (h > imgBox.h) { h = imgBox.h; w = h * ratio }
  slide.addImage({ data: image.dataUrl, x: imgBox.x + (imgBox.w - w) / 2, y: imgBox.y + (imgBox.h - h) / 2, w, h, rounding: true })
}

const addSmartQuote = (slide, smart, theme, box, fontFace) => {
  slide.addText('\u201C', {
    x: box.x, y: box.y - 0.1, w: 1.2, h: 1.2, fontSize: 96, color: theme.accent, fontFace: 'Georgia',
    transparency: 70, valign: 'top', margin: 0
  })
  slide.addText(smart.runs.map(run => runToTextObject(run, theme)), {
    x: box.x + 0.6, y: box.y, w: box.w - 1.2, h: box.h, fontSize: 24, italic: true,
    color: theme.title, fontFace: theme.titleFont, align: 'center', valign: 'middle'
  })
}

const addSmartTimeline = (pptx, slide, smart, theme, box, fontFace) => {
  const top = addIntro(slide, smart.intro, theme, box, fontFace)
  const items = smart.items
  const n = items.length
  const lineY = box.y + top + 1.45
  addRect(pptx, slide, { x: box.x + 0.3, y: lineY - 0.03, w: box.w - 0.6, h: 0.06 }, theme.accent, { transparency: 25 })
  const slotW = box.w / n
  items.forEach((item, idx) => {
    const cx = box.x + slotW * idx + slotW / 2
    slide.addText(item.label, {
      x: cx - slotW / 2, y: lineY - 0.85, w: slotW, h: 0.5, fontSize: n > 4 ? 14 : 18, bold: true,
      color: theme.accent, fontFace, align: 'center', valign: 'bottom', margin: 0
    })
    // 外圈淡色光环 + 实心描边圆点，对应预览的 box-shadow 光环
    slide.addShape(pptx.ShapeType.ellipse, {
      x: cx - 0.2, y: lineY - 0.2, w: 0.4, h: 0.4,
      fill: { color: theme.accent, transparency: 78 }, line: noLine(theme.accent)
    })
    slide.addShape(pptx.ShapeType.ellipse, {
      x: cx - 0.14, y: lineY - 0.14, w: 0.28, h: 0.28,
      fill: { color: theme.bg }, line: { color: theme.accent, width: 3.5 }
    })
    slide.addText(item.runs.map(run => runToTextObject(run, theme)), {
      x: cx - slotW / 2 + 0.05, y: lineY + 0.35, w: slotW - 0.1, h: box.h - top - 1.9, fontSize: n > 4 ? 11 : 13,
      color: theme.text, fontFace, align: 'center', valign: 'top', margin: 0
    })
  })
}

/** 数值字号：按字数分三档（与预览 statValueSizeClass 一致） */
const statValueFontSize = (value, n) => {
  const len = [...String(value)].length
  const tiers = n >= 4 ? [34, 27, 21] : [46, 36, 27]
  return len >= 7 ? tiers[2] : len >= 5 ? tiers[1] : tiers[0]
}

const addSmartStats = (pptx, slide, smart, theme, box, fontFace) => {
  const top = addIntro(slide, smart.intro, theme, box, fontFace)
  const n = smart.stats.length
  const gap = n >= 4 ? 0.18 : 0.25
  const inset = n === 2 ? 0.6 : 0
  const tileW = (box.w - inset * 2 - gap * (n - 1)) / n
  const tileH = 2.5
  const y = box.y + top + Math.max(0, (box.h - top - tileH) / 2)
  smart.stats.forEach((stat, idx) => {
    const x = box.x + inset + idx * (tileW + gap)
    slide.addShape(pptx.ShapeType.roundRect, {
      x, y, w: tileW, h: tileH, fill: { color: theme.surface }, line: noLine(theme.surface), rectRadius: 0.14,
      shadow: { type: 'outer', blur: 6, offset: 2, angle: 90, color: '000000', opacity: 0.08 }
    })
    addRect(pptx, slide, { x: x + 0.14, y: y + tileH - 0.08, w: tileW - 0.28, h: 0.08 }, theme.accent)
    slide.addText(stat.value, {
      x, y: y + 0.3, w: tileW, h: 1.1, fontSize: statValueFontSize(stat.value, n), bold: true, color: theme.accent,
      fontFace: 'Arial', align: 'center', valign: 'middle', margin: 0
    })
    slide.addText(stat.runs.map(run => runToTextObject(run, theme)), {
      x: x + 0.15, y: y + 1.5, w: tileW - 0.3, h: 0.85, fontSize: n >= 4 ? 12 : 14, color: theme.text,
      fontFace, align: 'center', valign: 'top', margin: 0
    })
  })
}

const addSmartIconList = (pptx, slide, smart, theme, box, fontFace) => {
  const top = addIntro(slide, smart.intro, theme, box, fontFace)
  const items = smart.items
  const cols = items.length >= 4 ? 2 : 1
  const rows = Math.ceil(items.length / cols)
  const gap = 0.16
  const rowCap = items.length <= 4 ? 1.0 : items.length <= 6 ? 0.88 : 0.78   // 与预览 min-height 分档对应
  const rowH = Math.min(rowCap, (box.h - top - gap * (rows - 1)) / rows)
  const colW = (box.w - (cols - 1) * 0.25) / cols
  const startY = box.y + top + Math.max(0, (box.h - top - (rows * rowH + (rows - 1) * gap)) / 2)
  const badge = Math.min(0.62, rowH - 0.2)
  items.forEach((item, idx) => {
    const x = box.x + (idx % cols) * (colW + 0.25)
    const y = startY + Math.floor(idx / cols) * (rowH + gap)
    slide.addShape(pptx.ShapeType.roundRect, {
      x, y, w: colW, h: rowH, fill: { color: theme.surface }, line: noLine(theme.surface), rectRadius: 0.12
    })
    // 圆形淡色徽章托着 emoji
    slide.addShape(pptx.ShapeType.ellipse, {
      x: x + 0.18, y: y + (rowH - badge) / 2, w: badge, h: badge,
      fill: { color: theme.accent, transparency: 84 }, line: noLine(theme.accent)
    })
    slide.addText(item.icon, {
      x: x + 0.18, y: y + (rowH - badge) / 2, w: badge, h: badge, fontSize: cols === 2 ? 18 : 22, fontFace: 'Segoe UI Emoji',
      align: 'center', valign: 'middle', margin: 0
    })
    slide.addText(item.runs.map(run => runToTextObject(run, theme)), {
      x: x + 0.3 + badge, y, w: colW - badge - 0.45, h: rowH, fontSize: cols === 2 ? 14 : 18, color: theme.text,
      fontFace, valign: 'middle', margin: 0
    })
  })
}

const addSmartAgenda = (pptx, slide, smart, theme, box, fontFace) => {
  const items = smart.items
  const cols = items.length > 5 ? 2 : 1
  const rows = Math.ceil(items.length / cols)
  const rowH = Math.min(0.72, box.h / rows)
  const colW = (box.w - (cols - 1) * 0.5) / cols
  const startY = box.y + Math.max(0, (box.h - rows * rowH) / 2)
  items.forEach((runs, idx) => {
    const x = box.x + (idx % cols) * (colW + 0.5)
    const y = startY + Math.floor(idx / cols) * rowH
    slide.addText(String(idx + 1).padStart(2, '0'), {
      x, y, w: 0.8, h: rowH, fontSize: cols === 2 ? 20 : 26, bold: true, color: theme.accent,
      fontFace: 'Arial', valign: 'middle', margin: 0
    })
    slide.addText(runs.map(run => runToTextObject(run, theme)), {
      x: x + 0.85, y, w: colW - 0.85, h: rowH, fontSize: cols === 2 ? 15 : 18, color: theme.text,
      fontFace, valign: 'middle', margin: 0
    })
    addRect(pptx, slide, { x, y: y + rowH - 0.02, w: colW, h: 0.012 }, theme.muted, { transparency: 60 })
  })
}

const addSmartBody = async (pptx, slide, smart, theme, box, fontFace) => {
  switch (smart.type) {
    case SMART_LAYOUTS.COLUMNS: return addSmartColumns(pptx, slide, smart, theme, box, fontFace)
    case SMART_LAYOUTS.FLOW: return addSmartFlow(pptx, slide, smart, theme, box, fontFace)
    case SMART_LAYOUTS.TIMELINE: return addSmartTimeline(pptx, slide, smart, theme, box, fontFace)
    case SMART_LAYOUTS.STATS: return addSmartStats(pptx, slide, smart, theme, box, fontFace)
    case SMART_LAYOUTS.ICON_LIST: return addSmartIconList(pptx, slide, smart, theme, box, fontFace)
    case SMART_LAYOUTS.AGENDA: return addSmartAgenda(pptx, slide, smart, theme, box, fontFace)
    case SMART_LAYOUTS.CARDS: return addSmartCards(pptx, slide, smart, theme, box, fontFace)
    case SMART_LAYOUTS.IMAGE_TEXT: return addSmartImageText(pptx, slide, smart, theme, box, fontFace)
    case SMART_LAYOUTS.QUOTE: return addSmartQuote(slide, smart, theme, box, fontFace)
    default: return null
  }
}

const addContentSlide = async (pptx, slide, deckSlide, deckTitle, theme, backgrounds) => {
  const bodyFont = theme.bodyFont
  if (backgrounds.contentData) {
    slide.background = { data: backgrounds.contentData }
  } else {
    slide.background = { color: theme.bg }
  }

  const { body, footerX } = addContentHeader(pptx, slide, deckSlide, theme)

  // 用户自备内容页背景（照片）：正文区盖一层底色保证可读（与预览一致）；程序生成的装饰很淡，不盖
  if (backgrounds.contentIsPhoto) {
    slide.addShape(pptx.ShapeType.roundRect, {
      ...body, fill: { color: theme.bg, transparency: 10 }, line: noLine(theme.bg), rectRadius: 0.12
    })
  }

  // 正文：智能排版或普通块序列
  if (deckSlide.smart) {
    await addSmartBody(pptx, slide, deckSlide.smart, theme, body, bodyFont)
  } else {
    await addBlocksInBox(pptx, slide, deckSlide.blocks, theme, body, bodyFont)
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
    if (deckSlide.layout === SLIDE_LAYOUTS.TITLE || deckSlide.layout === SLIDE_LAYOUTS.CLOSING) {
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

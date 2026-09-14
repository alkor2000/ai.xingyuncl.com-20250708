/**
 * Markdown（docx 代码块内容）→ .docx（remark 解析 + docx 库按需动态加载）
 *
 * 流程：unified + remark-parse + remark-gfm 解析成 mdast → 逐节点映射成 docx 的
 * Paragraph / Table / ImageRun。react-markdown 在消息里渲染的就是同一棵 mdast，
 * 所以"预览看到的结构"与"下载得到的结构"一致。
 *
 * 覆盖的语法：标题 1–6、段落、粗体/斜体/删除线/行内代码、超链接、有序/无序
 * 列表（三级嵌套）、GFM 表格、引用、围栏代码块、分隔线、图片（取不到时文字
 * 占位）。原始 HTML 节点忽略（只保留 <br> 换行）。
 */

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import { convertMathInMarkdown } from './latexToText'
import remarkGfm from 'remark-gfm'
import { fetchImageForEmbedding } from './download'

// ---- 页面：A4，四边 1 英寸（单位 DXA = 1/20 pt） ----
const PAGE = { width: 11906, height: 16838, margin: 1440 }
const CONTENT_WIDTH_DXA = PAGE.width - PAGE.margin * 2
/** 图片最大宽度（像素，docx 的 transformation 用 px；6.27in × 96dpi ≈ 602） */
const IMAGE_MAX_WIDTH_PX = 600

const BODY_FONT = 'Microsoft YaHei'
const CODE_FONT = 'Consolas'
const NUMBERING_REF = 'md-numbered'
const MAX_LIST_LEVEL = 2

const COLORS = {
  heading: '1F3B73',
  muted: '8A919C',
  border: 'D9DEE7',
  codeBg: 'F3F4F6',
  tableHeaderBg: 'E8EEF9',
  quoteBar: 'C9D3E6'
}

/** 标题字号（半磅）与 HeadingLevel 的映射在运行时按 depth 取 */
const HEADING_SIZES = [36, 30, 26, 24, 22, 22]

const IMAGE_TYPE_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/bmp': 'bmp'
}

// ============================================================================
// 转换器
// ============================================================================

class MarkdownToDocx {
  constructor(docx) {
    this.docx = docx
    this.orderedListInstance = 0
  }

  /** 行内节点 → runs（TextRun / ExternalHyperlink） */
  inlineChildren(nodes, inherit = {}) {
    const { TextRun, ExternalHyperlink } = this.docx
    const runs = []
    for (const node of nodes || []) {
      switch (node.type) {
        case 'text':
          runs.push(new TextRun({ text: node.value, ...inherit }))
          break
        case 'strong':
          runs.push(...this.inlineChildren(node.children, { ...inherit, bold: true }))
          break
        case 'emphasis':
          runs.push(...this.inlineChildren(node.children, { ...inherit, italics: true }))
          break
        case 'delete':
          runs.push(...this.inlineChildren(node.children, { ...inherit, strike: true }))
          break
        case 'inlineCode':
          runs.push(new TextRun({
            text: node.value, ...inherit,
            font: CODE_FONT,
            shading: { type: this.docx.ShadingType.CLEAR, fill: COLORS.codeBg, color: 'auto' }
          }))
          break
        case 'link':
          runs.push(new ExternalHyperlink({
            link: node.url,
            children: this.inlineChildren(node.children, { ...inherit, style: 'Hyperlink' })
          }))
          break
        case 'break':
          runs.push(new TextRun({ text: '', break: 1 }))
          break
        case 'html':
          if (/<br\s*\/?>/i.test(node.value)) runs.push(new TextRun({ text: '', break: 1 }))
          break
        case 'image':
          // 行内图片延后到块级处理；这里只放占位（块级 paragraph 会先拦截纯图片段落）
          runs.push(new TextRun({ text: `[图片：${node.alt || node.url}]`, italics: true, color: COLORS.muted }))
          break
        default:
          if (node.children) runs.push(...this.inlineChildren(node.children, inherit))
          else if (typeof node.value === 'string') runs.push(new TextRun({ text: node.value, ...inherit }))
      }
    }
    return runs
  }

  async imageParagraph(node) {
    const { Paragraph, TextRun, ImageRun, AlignmentType } = this.docx
    const image = await fetchImageForEmbedding(node.url)
    const type = image ? IMAGE_TYPE_BY_MIME[image.mime] : null
    if (!image || !type) {
      return new Paragraph({
        children: [new TextRun({ text: `[图片：${node.alt || node.url}]`, italics: true, color: COLORS.muted })]
      })
    }
    const scale = Math.min(1, IMAGE_MAX_WIDTH_PX / image.width)
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new ImageRun({
        type,
        data: image.arrayBuffer,
        transformation: { width: Math.round(image.width * scale), height: Math.round(image.height * scale) }
      })]
    })
  }

  heading(node) {
    const { Paragraph, HeadingLevel } = this.docx
    const levels = [
      HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
      HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6
    ]
    const depth = Math.min(6, Math.max(1, node.depth))
    return new Paragraph({
      heading: levels[depth - 1],
      children: this.inlineChildren(node.children)
    })
  }

  async paragraph(node, extra = {}) {
    // 纯图片段落 → 图片
    const children = node.children || []
    if (children.length === 1 && children[0].type === 'image') {
      return [await this.imageParagraph(children[0])]
    }
    const { Paragraph } = this.docx
    const { run, ...paragraphOptions } = extra
    return [new Paragraph({ ...paragraphOptions, children: this.inlineChildren(children, run) })]
  }

  async list(node, level = 0, instance = null) {
    const { Paragraph } = this.docx
    const ordered = !!node.ordered
    const listInstance = ordered
      ? (instance ?? ++this.orderedListInstance)
      : null
    const paragraphs = []

    for (const item of node.children || []) {
      const blocks = item.children || []
      for (let i = 0; i < blocks.length; i += 1) {
        const block = blocks[i]
        if (block.type === 'list') {
          paragraphs.push(...await this.list(block, Math.min(MAX_LIST_LEVEL, level + 1), null))
          continue
        }
        const marker = ordered
          ? { numbering: { reference: NUMBERING_REF, level, instance: listInstance } }
          : { bullet: { level } }
        if (block.type === 'paragraph') {
          const [p] = await this.paragraph(block, i === 0 ? marker : { indent: { left: 720 * (level + 1) } })
          paragraphs.push(p)
        } else {
          const converted = await this.block(block)
          paragraphs.push(...converted)
        }
      }
      if (blocks.length === 0) paragraphs.push(new Paragraph({ ...(ordered ? { numbering: { reference: NUMBERING_REF, level, instance: listInstance } } : { bullet: { level } }), children: [] }))
    }
    return paragraphs
  }

  table(node) {
    const { Table, TableRow, TableCell, Paragraph, WidthType, ShadingType, BorderStyle } = this.docx
    const rows = node.children || []
    if (rows.length === 0) return []
    const colCount = Math.max(...rows.map(r => (r.children || []).length), 1)
    const colWidth = Math.floor(CONTENT_WIDTH_DXA / colCount)
    const border = { style: BorderStyle.SINGLE, size: 4, color: COLORS.border }

    const tableRows = rows.map((row, rowIdx) => {
      const cells = []
      for (let c = 0; c < colCount; c += 1) {
        const cell = (row.children || [])[c]
        const runs = cell ? this.inlineChildren(cell.children, rowIdx === 0 ? { bold: true } : {}) : []
        cells.push(new TableCell({
          width: { size: colWidth, type: WidthType.DXA },
          shading: rowIdx === 0 ? { type: ShadingType.CLEAR, fill: COLORS.tableHeaderBg, color: 'auto' } : undefined,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: [new Paragraph({ children: runs })]
        }))
      }
      return new TableRow({ tableHeader: rowIdx === 0, children: cells })
    })

    return [
      new Table({
        width: { size: CONTENT_WIDTH_DXA, type: WidthType.DXA },
        columnWidths: new Array(colCount).fill(colWidth),
        borders: {
          top: border, bottom: border, left: border, right: border,
          insideHorizontal: border, insideVertical: border
        },
        rows: tableRows
      }),
      new Paragraph({ children: [] })
    ]
  }

  code(node) {
    const { Paragraph, TextRun, ShadingType } = this.docx
    const lines = String(node.value || '').split('\n')
    return lines.map(line => new Paragraph({
      style: 'CodeBlock',
      shading: { type: ShadingType.CLEAR, fill: COLORS.codeBg, color: 'auto' },
      children: [new TextRun({ text: line || ' ', font: CODE_FONT })]
    }))
  }

  async blockquote(node) {
    const { BorderStyle } = this.docx
    const result = []
    for (const child of node.children || []) {
      if (child.type === 'paragraph') {
        result.push(...await this.paragraph(child, {
          indent: { left: 720 },
          border: { left: { style: BorderStyle.SINGLE, size: 18, color: COLORS.quoteBar, space: 8 } },
          run: { italics: true, color: '555555' }
        }))
      } else {
        result.push(...await this.block(child))
      }
    }
    return result
  }

  thematicBreak() {
    const { Paragraph, BorderStyle } = this.docx
    return [new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: COLORS.border, space: 1 } },
      children: []
    })]
  }

  /** 块级节点 → Paragraph/Table 数组 */
  async block(node) {
    switch (node.type) {
      case 'heading': return [this.heading(node)]
      case 'paragraph': return this.paragraph(node)
      case 'list': return this.list(node)
      case 'table': return this.table(node)
      case 'code': return this.code(node)
      case 'blockquote': return this.blockquote(node)
      case 'thematicBreak': return this.thematicBreak()
      case 'html': return []
      default:
        if (node.children) {
          const result = []
          for (const child of node.children) result.push(...await this.block(child))
          return result
        }
        return []
    }
  }

  async convert(tree) {
    const children = []
    for (const node of tree.children || []) {
      children.push(...await this.block(node))
    }
    return children
  }
}

// ============================================================================
// 文档骨架
// ============================================================================

const buildDocument = (docx, children, title) => {
  const { Document, LevelFormat, AlignmentType } = docx

  const numberingLevels = [0, 1, 2].map(level => ({
    level,
    format: LevelFormat.DECIMAL,
    text: `%${level + 1}.`,
    alignment: AlignmentType.START,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } }
  }))

  const headingStyles = HEADING_SIZES.map((size, idx) => ({
    id: `Heading${idx + 1}`,
    name: `heading ${idx + 1}`,
    basedOn: 'Normal',
    next: 'Normal',
    quickFormat: true,
    run: { size, bold: true, color: COLORS.heading, font: BODY_FONT },
    paragraph: {
      spacing: { before: idx === 0 ? 240 : 200, after: 120 },
      alignment: idx === 0 ? AlignmentType.CENTER : AlignmentType.LEFT,
      outlineLevel: idx
    }
  }))

  return new Document({
    title: title || undefined,
    styles: {
      default: {
        document: { run: { font: BODY_FONT, size: 22 } }
      },
      paragraphStyles: [
        ...headingStyles,
        {
          id: 'CodeBlock',
          name: 'Code Block',
          basedOn: 'Normal',
          run: { font: CODE_FONT, size: 18 },
          paragraph: { spacing: { before: 0, after: 0, line: 276 } }
        }
      ]
    },
    numbering: { config: [{ reference: NUMBERING_REF, levels: numberingLevels }] },
    sections: [{
      properties: {
        page: {
          size: { width: PAGE.width, height: PAGE.height },
          margin: { top: PAGE.margin, right: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin }
        }
      },
      children
    }]
  })
}

/** 取文档标题：第一个一级标题，其次第一个任意标题 */
const extractTitle = (tree) => {
  const headings = (tree.children || []).filter(n => n.type === 'heading')
  const pick = headings.find(h => h.depth === 1) || headings[0]
  if (!pick) return null
  const text = (nodes) => (nodes || []).map(n => (n.value ?? text(n.children))).join('')
  return text(pick.children).trim() || null
}

// ============================================================================
// 对外
// ============================================================================

/**
 * 生成 .docx
 * @param {string} markdown - docx 代码块内容
 * @returns {Promise<{ blob: Blob, title: string|null }>}
 */
export const buildDocxBlob = async (markdown) => {
  // remark 系列已随 react-markdown 进主包，只有 docx 库需要按需加载
  const docx = await import('docx')

  // $$…$$ / $…$ 公式先折成 Unicode 文本（docx 没有公式排版）
  const tree = unified().use(remarkParse).use(remarkGfm).parse(convertMathInMarkdown(String(markdown || '')))
  const title = extractTitle(tree)
  const converter = new MarkdownToDocx(docx)
  const children = await converter.convert(tree)
  if (children.length === 0) {
    throw new Error('EMPTY_DOCUMENT')
  }

  const document = buildDocument(docx, children, title)
  const blob = await docx.Packer.toBlob(document)
  return { blob, title }
}

export default { buildDocxBlob }

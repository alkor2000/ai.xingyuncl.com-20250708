/**
 * 画布里的 docx Markdown → 公文模板需要的内容（纯函数）
 *
 * 后端 fillDocx 只认 {title, recipient, blocks, attachments, signer, date}：
 *  - blocks：paragraph / heading(level 1-3) / list(ordered, items) / table(rows)，行内只保留 bold/italic/strike
 *  - 字段按公文习惯从 Markdown 里猜：第一个一级标题是标题；标题后第一段以中文冒号结尾的短行是主送机关；
 *    末尾符合"二〇二六年九月十五日 / 2026年9月15日"的段落是成文日期；日期前最多 3 行短句是落款；
 *    以"附件："开头的段落（及紧随其后的编号行）是附件说明
 * 用的是与 exportDocx 同一套 remark 解析，所以画布预览看到的结构和套模板得到的一致。
 */
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { convertMathInMarkdown } from '../canvas/latexToText'

export const DATE_RE = /^[\s　]*([0-9０-９]{4}|[〇零一二三四五六七八九○Ｏ]{4})[\s　]*年[\s　]*([0-9０-９]{1,2}|[一二三四五六七八九十]{1,3})[\s　]*月[\s　]*([0-9０-９]{1,2}|[一二三四五六七八九十]{1,3})[\s　]*日[\s　]*$/

/** 行内节点 → runs（只保留模板会用到的样式） */
export const inlineRuns = (nodes, inherit = {}) => {
  const runs = []
  for (const node of nodes || []) {
    switch (node.type) {
      case 'text': runs.push({ text: node.value, ...inherit }); break
      case 'strong': runs.push(...inlineRuns(node.children, { ...inherit, bold: true })); break
      case 'emphasis': runs.push(...inlineRuns(node.children, { ...inherit, italic: true })); break
      case 'delete': runs.push(...inlineRuns(node.children, { ...inherit, strike: true })); break
      case 'inlineCode': runs.push({ text: node.value, ...inherit }); break
      case 'link': runs.push(...inlineRuns(node.children, inherit)); break
      case 'break': runs.push({ text: '\n', ...inherit }); break
      case 'html': if (/<br\s*\/?>/i.test(node.value)) runs.push({ text: '\n', ...inherit }); break
      case 'image': runs.push({ text: `[图片：${node.alt || node.url}]`, ...inherit }); break
      default:
        if (node.children) runs.push(...inlineRuns(node.children, inherit))
        else if (typeof node.value === 'string') runs.push({ text: node.value, ...inherit })
    }
  }
  return runs
}
const runsText = (runs) => (runs || []).map((r) => r.text || '').join('')

/** Markdown 里连续几行（软换行）是同一段；公文里一行就是一段，所以按 \n 拆成多段 */
export const splitRunsByLine = (runs) => {
  const lines = [[]]
  ;(runs || []).forEach((r) => {
    const parts = String(r.text || '').split('\n')
    parts.forEach((part, i) => {
      if (i > 0) lines.push([])
      if (part) lines[lines.length - 1].push({ ...r, text: part })
    })
  })
  return lines.filter((l) => l.some((r) => r.text.trim()))
}

/** mdast 顶层节点 → blocks（列表扁平化，嵌套项用全角空格缩进） */
export const mdastToBlocks = (tree) => {
  const blocks = []
  const listItems = (list, depth, out) => {
    ;(list.children || []).forEach((item, i) => {
      const paragraphs = (item.children || []).filter((c) => c.type === 'paragraph')
      const runs = paragraphs.length ? inlineRuns(paragraphs[0].children) : [{ text: '' }]
      out.push({ runs: depth ? [{ text: '　'.repeat(depth) }, ...runs] : runs })
      paragraphs.slice(1).forEach((pp) => out.push({ runs: [{ text: '　'.repeat(depth + 1) }, ...inlineRuns(pp.children)] }))
      ;(item.children || []).filter((c) => c.type === 'list').forEach((sub) => listItems(sub, depth + 1, out))
    })
  }
  const walk = (node) => {
    switch (node.type) {
      case 'heading': blocks.push({ type: 'heading', level: Math.min(3, Math.max(1, node.depth)), runs: inlineRuns(node.children) }); break
      case 'paragraph': splitRunsByLine(inlineRuns(node.children)).forEach((runs) => blocks.push({ type: 'paragraph', runs })); break
      case 'list': { const items = []; listItems(node, 0, items); blocks.push({ type: 'list', ordered: !!node.ordered, items }); break }
      case 'table': blocks.push({ type: 'table', rows: (node.children || []).map((row) => (row.children || []).map((cell) => ({ runs: inlineRuns(cell.children) }))) }); break
      case 'blockquote': (node.children || []).forEach(walk); break
      case 'code': blocks.push({ type: 'paragraph', runs: [{ text: node.value || '' }] }); break
      case 'thematicBreak': case 'html': case 'definition': break
      default: if (node.children) node.children.forEach(walk)
    }
  }
  ;(tree.children || []).forEach(walk)
  return blocks
}

/** 从 blocks 里抽出公文字段，其余留作正文 */
export const detectFields = (blocks) => {
  const rest = blocks.slice()
  const fields = { title: '', recipient: '', attachments: [], signer: [], date: '' }
  const textOf = (b) => (b.type === 'paragraph' || b.type === 'heading' ? runsText(b.runs).trim() : '')
  const titleAt = rest.findIndex((b) => b.type === 'heading' && b.level === 1)
  if (titleAt >= 0) { fields.title = textOf(rest[titleAt]); rest.splice(titleAt, 1) }
  const firstP = rest.findIndex((b) => b.type === 'paragraph' && textOf(b))
  if (firstP >= 0 && firstP <= 1) {
    const t = textOf(rest[firstP])
    if (t.length <= 40 && /[：:]$/.test(t)) { fields.recipient = t; rest.splice(firstP, 1) }
  }
  /* 末尾：日期、落款 */
  let end = rest.length - 1
  while (end >= 0 && rest[end].type === 'paragraph' && !textOf(rest[end])) end -= 1
  if (end >= 0 && rest[end].type === 'paragraph' && DATE_RE.test(textOf(rest[end]))) {
    fields.date = textOf(rest[end]); rest.splice(end, 1); end -= 1
    while (end >= 0 && rest[end].type === 'paragraph' && fields.signer.length < 3) {
      const t = textOf(rest[end])
      if (!t || t.length > 30 || /[。；;，,]$/.test(t) || /^附件/.test(t) || /^[0-9０-９]{1,2}[．.、]/.test(t)) break
      fields.signer.unshift(t); rest.splice(end, 1); end -= 1
    }
  }
  /* 附件说明："附件：" 开头的段落及紧随其后的编号短行 */
  for (let i = rest.length - 1; i >= 0; i -= 1) {
    const t = textOf(rest[i])
    if (rest[i].type !== 'paragraph' || !t) continue
    if (/^附件[:：\s　]/.test(t)) {
      const group = [t]
      let j = i + 1
      while (j < rest.length && rest[j].type === 'paragraph' && /^[0-9０-９]{1,2}[．.、]/.test(textOf(rest[j])) && textOf(rest[j]).length <= 60) { group.push(textOf(rest[j])); j += 1 }
      rest.splice(i, j - i)
      fields.attachments = [...group, ...fields.attachments]
    }
  }
  return { fields, blocks: rest }
}

/**
 * @param {string} markdown docx 代码块内容
 * @returns {{title:string, recipient:string, blocks:Array, attachments:string[], signer:string[], date:string}}
 */
export const markdownToContent = (markdown) => {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(convertMathInMarkdown(String(markdown || '')))
  const { fields, blocks } = detectFields(mdastToBlocks(tree))
  return { ...fields, blocks }
}

/** 老师粘贴的纯文字（每行一段；# 开头当标题）→ 内容 */
export const textToContent = (text) => {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const blocks = lines.map((l) => {
    const m = l.match(/^(#{1,3})\s+(.*)$/)
    return m ? { type: 'heading', level: m[1].length, runs: [{ text: m[2] }] } : { type: 'paragraph', runs: [{ text: l }] }
  })
  /* 没有用 # 标标题时，第一行如果是短句（不以冒号/句号结尾）就当标题 */
  if (blocks.length && !blocks.some((b) => b.type === 'heading' && b.level === 1)) {
    const first = runsText(blocks[0].runs)
    if (blocks[0].type === 'paragraph' && first.length <= 40 && !/[：:。；;，,]$/.test(first)) blocks[0] = { type: 'heading', level: 1, runs: [{ text: first }] }
  }
  const { fields, blocks: rest } = detectFields(blocks)
  return { ...fields, blocks: rest }
}

export default { markdownToContent, textToContent, detectFields, mdastToBlocks }

/**
 * htmlBlockParser 测试
 * - v2.0 画布产物多格式提取（html / pdf / pptx / docx 与别名）
 * - 与后端 outputFormatInstructions 的约定：外层 ```kind 围栏、内部 ~~~ 围栏
 */
import { describe, it, expect } from 'vitest'
import {
  extractArtifactBlocks,
  collectArtifactsFromMessages,
  collectHtmlFromMessages,
  replaceArtifactBlocksWithCards,
  artifactTitle,
  ARTIFACT_KINDS
} from '../../../utils/htmlBlockParser'

const HTML_DOC = '<!DOCTYPE html>\n<html><head><title>T</title></head><body><p>hi</p></body></html>'

describe('extractArtifactBlocks()', () => {
  it('识别四种产物并保留顺序', () => {
    const content = [
      '说明文字',
      '```html', HTML_DOC, '```',
      '```pptx', '# 封面', '---', '# 第二页', '- 要点一', '```',
      '```docx', '# 标题', '这是一段足够长的正文段落。', '```',
      '```pdf', HTML_DOC, '```'
    ].join('\n')

    const blocks = extractArtifactBlocks(content)
    expect(blocks.map(b => b.kind)).toEqual(['html', 'pptx', 'docx', 'pdf'])
    expect(blocks[1].code).toContain('# 第二页')
  })

  it('接受 ppt / slides / marp / doc / word 等别名', () => {
    const content = [
      '```ppt', '# a', '---', '# b', '- c', '```',
      '```word', '# 标题', '正文内容足够长', '```'
    ].join('\n')
    expect(extractArtifactBlocks(content).map(b => b.kind)).toEqual(['pptx', 'docx'])
  })

  it('普通语言的代码块（js / json）不算产物', () => {
    const content = '```js\nconsole.log(1)\nconsole.log(2)\n```\n```json\n{"a":1,"b":2}\n```'
    expect(extractArtifactBlocks(content)).toEqual([])
  })

  it('流式输出中未闭合的块默认不提取', () => {
    const content = '```pptx\n# 封面\n---\n# 第二页\n- 正在生成'
    expect(extractArtifactBlocks(content)).toEqual([])
    expect(extractArtifactBlocks(content, { requireClosed: false })).toHaveLength(1)
  })

  it('pptx / docx 内部的 ~~~ 代码围栏不会提前闭合外层块', () => {
    const content = [
      '```docx', '# 标题', '~~~python', 'print("x")', '~~~', '结尾段落', '```'
    ].join('\n')
    const blocks = extractArtifactBlocks(content)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].code).toContain('结尾段落')
  })

  it('模型无视约定在 pptx 里嵌套 ```python 时，外层块不会被内层闭合围栏截断', () => {
    const content = [
      '```pptx', '# 封面', '---', '# 代码页', '```python', 'print(1)', '```', '---', '# 最后一页', '- 结束', '```',
      '', '后面还有说明文字'
    ].join('\n')
    const blocks = extractArtifactBlocks(content)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe('pptx')
    expect(blocks[0].code).toContain('# 最后一页')
    expect(blocks[0].code).not.toContain('后面还有说明文字')
  })

  it('pptx 块后面紧跟另一个普通代码块时不会被吞并', () => {
    const content = '```pptx\n# 封面\n---\n# 页\n- a\n```\n\n```json\n{"a":1,"b":2}\n```'
    const blocks = extractArtifactBlocks(content)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].code).not.toContain('json')
  })

  it('pptx 里用裸 ``` 包了一段流程时，溢出到围栏外的后续页面会被找回', () => {
    // 线上实际出现的截断：模型想用代码块画 "A → B → C"，第一个裸 ``` 把外层块闭合，
    // 之后的整份课件都掉到了围栏外
    const content = [
      '```pptx', '# 封面', '---', '# 经典探究：绿叶在光下制造有机物',
      '```', '暗处理 → 选叶遮光 → 光照照射 → 显色观察', '```',
      '- **第一步：暗处理**', '  - 将天竺葵置于黑暗中一昼夜', '---', '# 结论', '- 光是必要条件', '```',
      '', '这份课件共 3 页，可以按需修改。'
    ].join('\n')
    const blocks = extractArtifactBlocks(content)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe('pptx')
    expect(blocks[0].code).toContain('# 结论')
    expect(blocks[0].code).toContain('暗处理 → 选叶遮光')
    expect(blocks[0].code).not.toContain('这份课件共 3 页')
  })

  it('pptx 正常闭合后跟着说明要点和一个裸代码块时不会被吞并', () => {
    const content = [
      '```pptx', '# 封面', '---', '# 页', '- a', '```',
      '说明：', '- 共 2 页', '- 可按需修改', '```', 'npm run build', '```'
    ].join('\n')
    const blocks = extractArtifactBlocks(content)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].code).not.toContain('npm run build')
    expect(blocks[0].code).not.toContain('共 2 页')
  })

  it('溢出修复遇到另一个产物块的开启围栏会停下', () => {
    const content = [
      '```pptx', '# 封面', '---', '# 页', '```', 'A → B', '```', '- 要点',
      '```html', HTML_DOC, '```'
    ].join('\n')
    const blocks = extractArtifactBlocks(content)
    expect(blocks[0].kind).toBe('pptx')
    expect(blocks[0].code).not.toContain('<html>')
    expect(blocks[0].code).not.toContain('- 要点')
  })

  it('html / pdf 必须至少含一个标签，纯文本不算', () => {
    expect(extractArtifactBlocks('```pdf\n这只是一段没有标签的文字而已\n```')).toEqual([])
  })
})

describe('collectArtifactsFromMessages()', () => {
  const messages = [
    { id: 'u1', role: 'user', content: '```pptx\n# 用户自己贴的\n---\n# x\n- y\n```' },
    { id: 'a1', role: 'assistant', content: '```html\n' + HTML_DOC + '\n```' },
    { id: 'a2', role: 'assistant', content: '```pptx\n# A\n---\n# B\n- c\n```\n```pptx\n# C\n---\n# D\n- e\n```' }
  ]

  it('只收集助手消息，并为每种产物编独立序号', () => {
    const artifacts = collectArtifactsFromMessages(messages)
    expect(artifacts.map(a => a.kind)).toEqual(['html', 'pptx', 'pptx'])
    expect(artifacts.map(a => a.kindOrdinal)).toEqual([1, 1, 2])
    expect(artifacts.map(a => a.messageId)).toEqual(['a1', 'a2', 'a2'])
    expect(artifacts[0].html).toBe(HTML_DOC)
    expect(artifacts[1].html).toBeUndefined()
    expect(artifacts[2].index).toBe(2)
  })

  it('旧接口 collectHtmlFromMessages 仍只返回 HTML 块', () => {
    const htmlBlocks = collectHtmlFromMessages(messages)
    expect(htmlBlocks).toHaveLength(1)
    expect(htmlBlocks[0].html).toBe(HTML_DOC)
  })

  it('空列表返回空数组', () => {
    expect(collectArtifactsFromMessages([])).toEqual([])
    expect(collectArtifactsFromMessages(null)).toEqual([])
  })

  it('ARTIFACT_KINDS 与后端 OUTPUT_FORMATS 一致', () => {
    expect(Object.values(ARTIFACT_KINDS).sort()).toEqual(['docx', 'html', 'pdf', 'pptx'])
  })
})

describe('replaceArtifactBlocksWithCards()', () => {
  it('产物块整段（含找回的溢出部分）换成 artifact:// 链接，说明文字保留', () => {
    const content = [
      '这是课件：', '```pptx', '# 光合作用', '---', '# 实验', '```', '流程', '```', '- 步骤', '---', '# 结论', '```', '', '共 3 页。'
    ].join('\n')
    const { text, cards } = replaceArtifactBlocksWithCards(content)
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ ordinal: 0, kind: 'pptx', title: '光合作用', closed: true, pages: 3 })
    expect(text).toContain('这是课件：')
    expect(text).toContain('[pptx](artifact://0)')
    expect(text).toContain('共 3 页。')
    expect(text).not.toContain('# 结论')
  })

  it('流式输出中未闭合的块也换成卡片并标记 closed=false；没有产物时原样返回', () => {
    const { text, cards } = replaceArtifactBlocksWithCards('先说明\n```docx\n# 报告\n\n正文还在写')
    expect(cards[0]).toMatchObject({ kind: 'docx', title: '报告', closed: false })
    expect(text).not.toContain('正文还在写')
    expect(replaceArtifactBlocksWithCards('普通回答\n```js\nconsole.log(1)\n```')).toEqual({ text: '普通回答\n```js\nconsole.log(1)\n```', cards: [] })
  })

  it('artifactTitle：Markdown 取首个标题去掉强调，HTML 取 <title>', () => {
    expect(artifactTitle('pptx', '# **光合作用** 🌿\n---')).toBe('光合作用 🌿')
    expect(artifactTitle('html', '<html><head><title> 我的 网页 </title></head></html>')).toBe('我的 网页')
    expect(artifactTitle('docx', '没有标题')).toBe('')
  })
})

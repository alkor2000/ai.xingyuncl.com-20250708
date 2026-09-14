/**
 * 导出器冒烟测试：真实调用 pptxgenjs / docx 生成文件，再用 JSZip 打开检查结构。
 * 不做像素级校验，只保证"能生成、结构正确、文本进去了"。
 */
import { describe, it, expect, vi } from 'vitest'
import JSZip from 'jszip'
import { buildPptxBlob } from '../../../utils/canvas/exportPptx'
import { buildDocxBlob } from '../../../utils/canvas/exportDocx'

// 图片取回在 jsdom 下没有真实网络，统一让它失败 → 走文字占位分支
vi.mock('../../../utils/canvas/download', async (importOriginal) => {
  const mod = await importOriginal()
  return { ...mod, fetchImageForEmbedding: vi.fn().mockResolvedValue(null) }
})

// jsdom 的 Blob 没有 arrayBuffer()，用 FileReader 读
const readZip = async (blob) => {
  const buffer = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
  return JSZip.loadAsync(buffer)
}

const DECK = `# 光合作用
初中生物

---

# 什么是光合作用

- 植物利用**光能**合成有机物
- 释放氧气
  - 场所：叶绿体

| 组别 | 结果 |
| --- | --- |
| 甲 | 变蓝 |

![示意图](https://example.com/x.png)

<!-- 备注：提问导入 -->

---

# 结束
`

describe('buildPptxBlob()', () => {
  it('生成含封面、内容页、章节页的 pptx，文本与备注写入 XML', async () => {
    const { blob, deck } = await buildPptxBlob(DECK, { themeKey: 'classic' })
    expect(deck.slides).toHaveLength(3)
    expect(blob.size).toBeGreaterThan(1000)

    const zip = await readZip(blob)
    const files = Object.keys(zip.files)
    expect(files).toContain('ppt/slides/slide1.xml')
    expect(files).toContain('ppt/slides/slide3.xml')

    const slide2 = await zip.file('ppt/slides/slide2.xml').async('string')
    expect(slide2).toContain('什么是光合作用')
    expect(slide2).toContain('光能')
    expect(slide2).toContain('变蓝')
    expect(slide2).toContain('[图片：示意图]')

    const notes = files.filter(f => /ppt\/notesSlides\/notesSlide\d+\.xml$/.test(f))
    const notesXml = await Promise.all(notes.map(f => zip.file(f).async('string')))
    expect(notesXml.some(x => x.includes('提问导入'))).toBe(true)
  })

  it('空 deck 抛 EMPTY_DECK', async () => {
    await expect(buildPptxBlob('')).rejects.toThrow('EMPTY_DECK')
  })
})

const DOC = `# 实验报告

## 目的

验证 **光** 是光合作用的条件，参考 [教材](https://example.com)。

1. 第一步
2. 第二步
   - 子项

| 组别 | 结果 |
| --- | --- |
| 甲 | 变蓝 |

> 引用一句话

~~~python
print("hi")
~~~

---

![图](https://example.com/a.png)
`

describe('buildDocxBlob()', () => {
  it('生成 docx，标题取一级标题，正文/表格/代码写入 document.xml', async () => {
    const { blob, title } = await buildDocxBlob(DOC)
    expect(title).toBe('实验报告')
    expect(blob.size).toBeGreaterThan(1000)

    const zip = await readZip(blob)
    const xml = await zip.file('word/document.xml').async('string')
    expect(xml).toContain('实验报告')
    expect(xml).toContain('验证')
    expect(xml).toContain('变蓝')
    expect(xml).toContain('print(&quot;hi&quot;)')
    expect(xml).toContain('引用一句话')
    expect(xml).toContain('[图片：图]')
    expect(xml).toContain('<w:tbl>')
    expect(xml).toContain('<w:numPr>')
    expect(await zip.file('word/numbering.xml').async('string')).toContain('w:numFmt w:val="decimal"')
  })

  it('空文档抛 EMPTY_DOCUMENT', async () => {
    await expect(buildDocxBlob('   ')).rejects.toThrow('EMPTY_DOCUMENT')
  })
})

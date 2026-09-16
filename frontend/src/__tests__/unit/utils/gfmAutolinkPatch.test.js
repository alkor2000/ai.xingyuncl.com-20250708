/**
 * mdast-util-gfm-autolink-literal 补丁（frontend/patches/）
 *
 * 原版邮箱自动链接的正则用了 lookbehind，Safari 16.4 才支持；iOS 16.0–16.3 渲染带 remark-gfm
 * 的聊天消息时会在运行时抛 SyntaxError（esbuild 只把正则字面量改写成 new RegExp，不会翻译语法）。
 * 补丁改成捕获前导字符再原样放回。这里既验证 node_modules 里的源码确实没有 lookbehind
 * （postinstall 没跑 patch-package 时这条会红），也验证补丁后的链接行为与原版一致。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'

const parse = (md) => unified().use(remarkParse).use(remarkGfm).parse(md)
const flatten = (node, out = []) => {
  if (node.type === 'link') out.push({ type: 'link', url: node.url, text: node.children.map(c => c.value).join('') })
  else if (node.type === 'text') out.push({ type: 'text', value: node.value })
  else (node.children || []).forEach(child => flatten(child, out))
  return out
}

describe('mdast-util-gfm-autolink-literal 去 lookbehind 补丁', () => {
  it('node_modules 里的依赖源码没有 lookbehind（patch-package 已生效）', () => {
    const file = path.join(process.cwd(), 'node_modules/mdast-util-gfm-autolink-literal/lib/index.js')
    const src = fs.readFileSync(file, 'utf8')
    expect(src).not.toMatch(/\(\?<[=!]/)
    expect(src).toContain('ai-platform patch')
  })

  it('邮箱仍会自动成为 mailto 链接，前导字符原样保留', () => {
    const nodes = flatten(parse('联系 zhang@example.com 或访问 https://example.com 。'))
    expect(nodes).toEqual([
      { type: 'text', value: '联系 ' },
      { type: 'link', url: 'mailto:zhang@example.com', text: 'zhang@example.com' },
      { type: 'text', value: ' 或访问 ' },
      { type: 'link', url: 'https://example.com', text: 'https://example.com' },
      { type: 'text', value: ' 。' }
    ])
  })

  it('行首邮箱、标点相邻的邮箱、斜杠前置与结尾非法的地址与原版判定一致', () => {
    expect(flatten(parse('a@b.com 开头'))[0]).toEqual({ type: 'link', url: 'mailto:a@b.com', text: 'a@b.com' })
    expect(flatten(parse('两个：a@b.com,c@d.org')).filter(n => n.type === 'link').map(n => n.text)).toEqual(['a@b.com', 'c@d.org'])
    // 前一个字符是斜杠 → 不算邮箱；label 以数字/下划线/连字符结尾 → 不算
    expect(flatten(parse('path/a@b.com')).some(n => n.type === 'link')).toBe(false)
    expect(flatten(parse('看 a@b.c_')).some(n => n.type === 'link')).toBe(false)
  })
})

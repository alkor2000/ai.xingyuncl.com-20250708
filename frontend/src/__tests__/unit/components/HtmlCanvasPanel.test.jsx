/**
 * HtmlCanvasPanel 回归测试
 * 2026-09-14 线上事故：打开历史里已有 ≥2 个产物的会话时，面板首次渲染在"切到最新"的 effect
 * 跑之前读 null.kindOrdinal，整个对话页白屏。这里直接用"一次性给两个产物"的消息列表挂载。
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import HtmlCanvasPanel from '../../../components/chat/new/HtmlCanvasPanel'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key })
}))

const HTML = (title) => '<!DOCTYPE html><html><head><title>' + title + '</title></head><body><p>' + title + '</p></body></html>'
const msg = (id, content) => ({ id, role: 'assistant', content, created_at: '2026-09-14T00:00:00Z' })

describe('HtmlCanvasPanel', () => {
  it('首次挂载就有多个产物时不崩溃，默认显示最新一块', () => {
    const messages = [
      msg('a1', '```html\n' + HTML('第一页') + '\n```'),
      msg('a2', '```html\n' + HTML('第二页') + '\n```'),
      msg('a3', '```pptx\n# 封面\n---\n# 内容\n- 要点\n```')
    ]
    const { container } = render(
      <HtmlCanvasPanel messages={messages} isStreaming={false} visible onClose={() => {}} />
    )
    expect(container.querySelector('.html-canvas-panel.kind-pptx')).not.toBeNull()
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
    expect(container.querySelector('.slides-preview')).not.toBeNull()
  })

  it('产物减少到比当前索引少时回落到最新一块而不是读到 null', () => {
    const many = [
      msg('a1', '```html\n' + HTML('一') + '\n```'),
      msg('a2', '```html\n' + HTML('二') + '\n```')
    ]
    const { container, rerender } = render(
      <HtmlCanvasPanel messages={many} isStreaming={false} visible onClose={() => {}} />
    )
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
    rerender(<HtmlCanvasPanel messages={many.slice(0, 1)} isStreaming={false} visible onClose={() => {}} />)
    expect(container.querySelector('.html-canvas-panel.kind-html')).not.toBeNull()
    expect(container.querySelector('iframe.preview-iframe')).not.toBeNull()
  })

  it('没有产物时不渲染', () => {
    const { container } = render(
      <HtmlCanvasPanel messages={[msg('a1', '普通回复')]} isStreaming={false} visible onClose={() => {}} />
    )
    expect(container.firstChild).toBeNull()
  })
})

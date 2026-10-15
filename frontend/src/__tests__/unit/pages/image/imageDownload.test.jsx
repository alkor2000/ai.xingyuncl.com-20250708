/**
 * 反馈 eebafb84（生成图片后点下载"没有反应"）的定向用例。
 *
 * 测的是下载链本身，不测样式：
 *   - 同源地址：取回成功才触发真正的 Blob 下载，扩展名跟着实际 MIME 走；404/403/返回 HTML 都算失败，绝不保存假文件；
 *   - 跨源地址：对方允许跨域读取就照常下载；不允许就在新标签页打开（当前页面不动），并把"为什么"说出来；
 *   - 地址缺失：不发请求、不点任何 <a>；
 *   - 卡片按钮：下载中禁用、结果逐种提示、点击不冒泡到卡片。
 * 全部用假 fetch / 假 window.open，不连后端、不碰真实图片。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const notices = []
vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, message: { success: (m) => notices.push(['success', m]), info: (m) => notices.push(['info', m]), error: (m) => notices.push(['error', m]), warning: (m) => notices.push(['warning', m]) } }
})
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key, opts) => (opts ? `${key}:${JSON.stringify(opts)}` : key), i18n: { language: 'zh-CN' } })
}))

import { downloadImage, resolveImageDownloadUrl, withImageExtension } from '../../../../pages/image/utils/imageHelpers'
import ImageCard from '../../../../pages/image/components/ImageGallery/ImageCard'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const response = (status, body, type) => new Response(body, { status, headers: type ? { 'content-type': type } : {} })
const clicks = []

beforeEach(() => {
  notices.length = 0
  clicks.length = 0
  window.URL.createObjectURL = vi.fn(() => 'blob:mock')
  window.URL.revokeObjectURL = vi.fn()
  window.open = vi.fn(() => ({ closed: false, opener: window }))
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() { clicks.push({ href: this.getAttribute('href'), download: this.getAttribute('download') }) })
})
afterEach(() => { vi.restoreAllMocks(); delete global.fetch })

describe('resolveImageDownloadUrl / withImageExtension', () => {
  it('accepts absolute, relative, blob and data urls and rejects everything else', () => {
    expect(resolveImageDownloadUrl('/uploads/generations/a.jpg').href).toBe(`${window.location.origin}/uploads/generations/a.jpg`)
    expect(resolveImageDownloadUrl('https://bucket.example/generations/a.jpg').origin).toBe('https://bucket.example')
    expect(resolveImageDownloadUrl('blob:http://localhost/x').protocol).toBe('blob:')
    for (const bad of ['', '   ', null, undefined, 42, 'javascript:alert(1)', 'ftp://x/y', 'generations/a.jpg']) expect(resolveImageDownloadUrl(bad)).toBeNull()
  })
  it('fixes the extension from the real mime type', () => {
    expect(withImageExtension('ai_12.jpg', 'image/png')).toBe('ai_12.png')
    expect(withImageExtension('ai_12.jpg', 'image/jpeg; charset=binary')).toBe('ai_12.jpg')
    expect(withImageExtension('a prompt with spaces', 'image/webp')).toBe('a prompt with spaces.webp')
    expect(withImageExtension('', '')).toBe('image.jpg')
  })
})

describe('downloadImage', () => {
  it('same-origin image: fetched once, saved as a blob with the mime-correct name, object url released', async () => {
    global.fetch = vi.fn(async () => response(200, PNG, 'image/png'))
    const result = await downloadImage('/uploads/generations/2026-10/gen_1.jpg', 'ai_1.jpg')
    expect(result).toMatchObject({ status: 'downloaded', fileName: 'ai_1.png' })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(global.fetch.mock.calls[0][1]).toMatchObject({ mode: 'same-origin', credentials: 'same-origin' })
    expect(clicks).toEqual([{ href: 'blob:mock', download: 'ai_1.png' }])
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock')
    expect(window.open).not.toHaveBeenCalled()
  })
  it('same-origin 404 / 403 / html fallback: nothing is saved and the reason is reported', async () => {
    for (const [res, detail] of [[response(404, 'nope', 'text/plain'), '404'], [response(403, 'no', 'text/plain'), '403'], [response(200, '<!doctype html>', 'text/html'), 'not-image']]) {
      global.fetch = vi.fn(async () => res)
      const result = await downloadImage('/uploads/generations/gone.jpg', 'ai_2.jpg')
      expect(result.status).toBe('failed'); expect(result.detail).toBe(detail)
    }
    expect(clicks).toEqual([]); expect(window.open).not.toHaveBeenCalled()
  })
  it('cross-origin with CORS allowed downloads normally without credentials', async () => {
    global.fetch = vi.fn(async () => response(200, PNG, 'image/jpeg'))
    const result = await downloadImage('https://bucket.oss-cn-beijing.aliyuncs.com/generations/u/2026-10/gen.jpg', 'ai_3.jpg')
    expect(result).toMatchObject({ status: 'downloaded', fileName: 'ai_3.jpg' })
    expect(global.fetch.mock.calls[0][1]).toMatchObject({ mode: 'cors', credentials: 'omit' })
    expect(clicks).toHaveLength(1); expect(window.open).not.toHaveBeenCalled()
  })
  it('cross-origin without CORS falls back to a new tab and never navigates the current page', async () => {
    global.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    const result = await downloadImage('https://bucket.oss-cn-beijing.aliyuncs.com/generations/u/gen.jpg', 'ai_4.jpg')
    expect(result.status).toBe('opened')
    expect(window.open).toHaveBeenCalledWith('https://bucket.oss-cn-beijing.aliyuncs.com/generations/u/gen.jpg', '_blank')
    expect(window.open.mock.results[0].value.opener).toBeNull()
    expect(clicks).toEqual([])
    window.open = vi.fn(() => null)
    expect((await downloadImage('https://bucket.oss-cn-beijing.aliyuncs.com/generations/u/gen.jpg', 'ai_4.jpg')).status).toBe('blocked')
  })
  it('cross-origin 403/404 readable through CORS are reported, not opened', async () => {
    global.fetch = vi.fn(async () => response(403, '<Error/>', 'application/xml'))
    expect(await downloadImage('https://bucket.example/private.jpg', 'ai_5.jpg')).toMatchObject({ status: 'failed', httpStatus: 403 })
    expect(window.open).not.toHaveBeenCalled()
  })
  it('same-origin network failure is a failure, not a new tab; http on an https page is upgraded for the same host', async () => {
    global.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    expect(await downloadImage('/uploads/x.jpg', 'ai_6.jpg')).toMatchObject({ status: 'failed', detail: 'network' })
    expect(window.open).not.toHaveBeenCalled()
    const loc = window.location
    const upgraded = resolveImageDownloadUrl(`http://${loc.host}/uploads/x.jpg`)
    expect(upgraded.protocol).toBe(loc.protocol === 'https:' ? 'https:' : 'http:')
  })
  it('missing url: no request, no click, no tab', async () => {
    global.fetch = vi.fn()
    for (const bad of ['', null, undefined]) expect(await downloadImage(bad, 'ai_7.jpg')).toEqual({ status: 'missing-url' })
    expect(global.fetch).not.toHaveBeenCalled(); expect(clicks).toEqual([]); expect(window.open).not.toHaveBeenCalled()
  })
})

describe('ImageCard download button', () => {
  const item = { id: 42, status: 'success', local_path: 'https://bucket.oss-cn-beijing.aliyuncs.com/generations/7/2026-10/gen_42.jpg', prompt: 'a cat', created_at: '2026-10-14T10:00:00Z' }
  const renderCard = () => {
    const onCard = vi.fn()
    const utils = render(<div onClick={onCard}><ImageCard item={item} onView={vi.fn()} onToggleFavorite={vi.fn()} onTogglePublic={vi.fn()} onDelete={vi.fn()} /></div>)
    const buttons = utils.container.querySelectorAll('.image-overlay button')
    return { ...utils, onCard, downloadButton: buttons[1] }
  }
  it('downloads once, disables itself while running, reports the real outcome and does not bubble to the card', async () => {
    let release
    global.fetch = vi.fn(() => new Promise(resolve => { release = () => resolve(response(200, PNG, 'image/png')) }))
    const { downloadButton, onCard } = renderCard()
    fireEvent.click(downloadButton)
    expect(onCard).not.toHaveBeenCalled()
    await waitFor(() => expect(downloadButton).toBeDisabled())
    /* 真实浏览器不会把点击派发给 disabled 按钮；jsdom 会，但 React 不会再调用 handler —— 只断言没有第二次取回 */
    fireEvent.click(downloadButton)
    expect(global.fetch).toHaveBeenCalledTimes(1)
    release()
    await waitFor(() => expect(downloadButton).not.toBeDisabled())
    expect(notices).toEqual([['success', 'image.download.started:{"fileName":"ai_42.png"}']])
  })
  it('explains a cross-origin fallback and a failure instead of staying silent', async () => {
    global.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    const first = renderCard()
    fireEvent.click(first.downloadButton)
    await waitFor(() => expect(notices).toEqual([['info', 'image.download.openedInNewTab']]))
    expect(window.open).toHaveBeenCalledTimes(1)
    first.unmount(); notices.length = 0
    global.fetch = vi.fn(async () => response(404, '', 'text/plain'))
    const second = renderCard()
    fireEvent.click(second.downloadButton)
    await waitFor(() => expect(notices).toEqual([['error', 'image.download.failed:{"detail":"404"}']]))
  })
})

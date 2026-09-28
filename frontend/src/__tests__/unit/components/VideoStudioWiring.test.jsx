/**
 * 视频工作台的页面接线：这一轮到底算哪一条，以及谁能看到这套新东西。
 *
 * 全部隔离替身：不连后端、不调模型、不发一次真实生成。
 */
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

let store
/* vi.mock 会被提升，工厂里不能碰普通顶层变量；用 hoisted 把桩也提上去 */
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key, opts) => (opts && opts.price !== undefined ? `${key}:${opts.price}` : key) })
}))
vi.mock('../../../utils/api', () => ({ default: api }))
vi.mock('../../../stores/videoStore', () => ({ default: () => globalThis.__videoStore }))
vi.mock('../../../stores/authStore', () => ({
  default: () => ({ user: { id: 7, credits_stats: { total: 5000, used: 100, remaining: 4900 } } })
}))

import VideoGeneration from '../../../pages/video/VideoGeneration'

const MODEL = {
  id: 1, name: 'v1', display_name: '视频模型甲', provider: 'volcano', has_api_key: true,
  base_price: 50, price_config: {}, supports_text_to_video: true, supports_first_frame: true,
  supports_last_frame: true, resolutions_supported: ['720p'], durations_supported: [5], max_prompt_length: 500
}
const row = (id, extra = {}) => ({
  id, prompt: '镜头缓缓推近的校园水池', status: 'succeeded', local_path: `/v/${id}.mp4`,
  thumbnail_path: `/v/${id}.jpg`, user_id: 7, ratio: '16:9', progress: 100, task_id: `t-${id}`, ...extra
})

const ELIGIBLE = { capability: 'video_studio', available: true, reason: null, message: null, batch_ref: 'm0-video-01' }
const REFUSED = { capability: 'video_studio', available: false, reason: 'pilot_provider_not_installed',
  retryable: false, message: '这个功能还没有对你所在的学校开放' }
const capability = (data) => api.get.mockResolvedValue({ data: { success: true, data } })

beforeEach(() => {
  localStorage.clear()
  api.get.mockReset(); api.post.mockReset()
  capability(ELIGIBLE)
  globalThis.__videoStore = store = {
    models: [MODEL], selectedModel: MODEL, generating: false, generationProgress: 0,
    generationHistory: [], historyPagination: { total: 0 },
    publicGallery: [], galleryPagination: { total: 0 },
    loading: false, userStats: {}, processingTasks: {},
    keyword: '', setKeyword: vi.fn(k => { store.keyword = k }),
    getModels: vi.fn(), selectModel: vi.fn(), generateVideo: vi.fn(),
    getUserHistory: vi.fn(async () => ({ data: store.generationHistory })),
    getPublicGallery: vi.fn(async () => ({ data: store.publicGallery })),
    deleteGeneration: vi.fn(async () => true), toggleFavorite: vi.fn(), togglePublic: vi.fn(),
    getUserStats: vi.fn()
  }
})

async function studio() {
  const view = render(<VideoGeneration />)
  await screen.findByTestId('video-studio')
  return view
}
async function generateOnce(result) {
  store.generateVideo.mockResolvedValue(result)
  fireEvent.change(screen.getByTestId('studio-prompt'), { target: { value: '镜头缓缓推近的校园水池' } })
  fireEvent.click(screen.getByTestId('studio-generate'))
  await waitFor(() => expect(screen.getAllByTestId('studio-turn').length).toBe(1))
}
const turnVideos = () =>
  [...document.querySelectorAll('[data-testid="studio-turn"] video')].map(v => v.getAttribute('src'))

describe('本轮只认生成响应给的真实 id', () => {
  it('提交后先挂一条排队中，不假装已经做好了', async () => {
    store.generationHistory = [row(9, { prompt: '上一次的旧视频' })]   // 历史里躺着旧的
    await studio()
    await generateOnce({ taskId: 't-501', generationId: 501 })
    expect(screen.getByTestId('studio-turn-pending')).toBeTruthy()
    expect(turnVideos()).toEqual([])
    expect(screen.queryByText('上一次的旧视频')).toBeNull()     // 旧视频一条都不进本轮
  })

  it('任务跑起来、做完了，本轮跟着走：排队中 → 生成中 → 出片', async () => {
    const view = await studio()
    await generateOnce({ taskId: 't-501', generationId: 501 })

    store.generationHistory = [row(501, { status: 'running', progress: 40, local_path: null })]
    view.rerender(<VideoGeneration />)
    await waitFor(() => expect(screen.getByText('video.studio.rendering')).toBeTruthy())

    store.generationHistory = [row(501, { status: 'succeeded', progress: 100 })]
    view.rerender(<VideoGeneration />)
    await waitFor(() => expect(turnVideos()).toEqual(['/v/501.mp4']))
  })

  it('这一条失败了就说失败并写明原因，不拿旧视频顶上', async () => {
    store.generationHistory = [row(9, { prompt: '上一次的旧视频' })]
    const view = await studio()
    await generateOnce({ taskId: 't-502', generationId: 502 })

    store.generationHistory = [
      row(502, { status: 'failed', local_path: null, error_message: '上游渲染超时' }),
      row(9, { prompt: '上一次的旧视频' })
    ]
    view.rerender(<VideoGeneration />)
    await waitFor(() => expect(screen.getByTestId('studio-turn-failed')).toBeTruthy())
    expect(screen.getByText('上游渲染超时')).toBeTruthy()
    expect(turnVideos()).toEqual([])
  })

  it('响应里没有真实 id 就不登记，不猜一条出来', async () => {
    await studio()
    store.generateVideo.mockResolvedValue({ message: '已提交' })
    fireEvent.change(screen.getByTestId('studio-prompt'), { target: { value: '随便写点' } })
    fireEvent.click(screen.getByTestId('studio-generate'))
    await waitFor(() => expect(store.generateVideo).toHaveBeenCalled())
    expect(screen.queryAllByTestId('studio-turn').length).toBe(0)
  })
})

describe('本轮结果与图库切片分离', () => {
  it('图库切到公开画廊，本轮的视频还在对话区', async () => {
    const view = await studio()
    await generateOnce({ taskId: 't-503', generationId: 503 })
    store.generationHistory = [row(503)]
    view.rerender(<VideoGeneration />)
    await waitFor(() => expect(turnVideos()).toEqual(['/v/503.mp4']))

    fireEvent.click(screen.getByTestId('studio-open-gallery'))
    store.publicGallery = [row(99, { prompt: '别人的视频' })]
    fireEvent.click(await screen.findByText('video.publicGallery'))
    await waitFor(() => expect(store.getPublicGallery).toHaveBeenCalled())
    expect(turnVideos()).toEqual(['/v/503.mp4'])
  })

  it('搜索把历史换成别的结果，本轮的视频还在', async () => {
    const view = await studio()
    await generateOnce({ taskId: 't-504', generationId: 504 })
    store.generationHistory = [row(504)]
    view.rerender(<VideoGeneration />)
    await waitFor(() => expect(turnVideos()).toEqual(['/v/504.mp4']))

    store.generationHistory = [row(77, { prompt: '毫不相干' })]
    fireEvent.click(screen.getByTestId('studio-open-gallery'))
    const box = await screen.findByPlaceholderText('video.searchPlaceholder')
    fireEvent.change(box, { target: { value: '毫不相干' } })
    fireEvent.keyDown(box, { key: 'Enter', code: 'Enter' })
    await waitFor(() => expect(store.setKeyword).toHaveBeenCalledWith('毫不相干'))
    expect(turnVideos()).toEqual(['/v/504.mp4'])
  })

  it('图库里真的画得出视频卡（有数据也不白屏）', async () => {
    store.generationHistory = [row(11), row(12)]
    await studio()
    fireEvent.click(screen.getByTestId('studio-open-gallery'))
    const drawer = await screen.findByPlaceholderText('video.searchPlaceholder')
    expect(drawer).toBeTruthy()
    await waitFor(() => expect(document.querySelectorAll('.studio-gallery .video-card').length).toBe(2))
  })
})

describe('整套新体验的门只由服务端决定', () => {
  it('没资格：不进新版，留在经典视图，也没有切过去的入口', async () => {
    capability(REFUSED)
    render(<VideoGeneration />)
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/studio-pilot/capability',
      { params: { capability: 'video_studio' } }))
    await waitFor(() => expect(document.querySelector('.video-generation-page')).toBeTruthy())
    expect(screen.queryByTestId('video-studio')).toBeNull()
    expect(screen.queryByTestId('classic-to-studio')).toBeNull()
  })

  it('没资格时本机强设 studio 也进不去', async () => {
    capability(REFUSED)
    localStorage.setItem('video.layoutMode', 'studio')
    render(<VideoGeneration />)
    await waitFor(() => expect(document.querySelector('.video-generation-page')).toBeTruthy())
    expect(screen.queryByTestId('video-studio')).toBeNull()
  })

  it('资格查询失败当作没资格，不冒充可用', async () => {
    api.get.mockRejectedValue(new Error('网络不通'))
    localStorage.setItem('video.layoutMode', 'studio')
    render(<VideoGeneration />)
    await waitFor(() => expect(document.querySelector('.video-generation-page')).toBeTruthy())
    expect(screen.queryByTestId('video-studio')).toBeNull()
  })

  it('有资格：经典与新版可以来回切', async () => {
    await studio()
    fireEvent.click(screen.getByTestId('studio-to-classic'))
    const back = await screen.findByTestId('classic-to-studio')
    expect(screen.queryByTestId('video-studio')).toBeNull()
    fireEvent.click(back)
    expect(await screen.findByTestId('video-studio')).toBeTruthy()
  })
})

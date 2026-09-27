/**
 * 「本次生成」接线的定向反例。
 *
 * 这一组测的不是样式，是**这一轮到底算哪几张图**：
 *   - 图库切 Tab / 搜索 / 翻页会换掉图库那份切片，本轮结果不能跟着一起消失；
 *   - 点开大图只在这一轮里翻，不能混进图库当前页；
 *   - 本轮是哪几张只能认生成响应（成功的 results / 异步的 generationId），
 *     绝不能拿"刷新后历史最前面几条"顶替——部分成功时那就是把上一次的旧图算进来。
 *
 * 全部用隔离响应，不连后端、不调模型。
 */
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

let store
let generation
let upload
const viewer = { props: null }

/* 只换 useTranslation，其余原样留着——链路里有别的模块要 initReactI18next */
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key, opts) => (opts && opts.price !== undefined ? `${key}:${opts.price}` : key) })
}))
vi.mock('../../../utils/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../../../stores/imageStore', () => ({ default: () => store }))
vi.mock('../../../stores/authStore', () => ({ default: () => ({ user: { id: 7 } }) }))
vi.mock('../../../pages/image/hooks/useImageGeneration', () => ({ useImageGeneration: () => generation }))
vi.mock('../../../pages/image/hooks/useImageUpload', () => ({ useImageUpload: () => upload }))
vi.mock('../../../components/common/ImageViewer', () => ({
  default: (props) => {
    if (props.visible) viewer.props = props
    return props.visible
      ? <div data-testid="viewer" data-ids={props.images.map(i => i.id).join(',')} />
      : null
  }
}))
vi.mock('../../../pages/image/components/ImageGallery/ImageCard', () => ({
  default: ({ item }) => <div data-testid={`card-${item.id}`}>{item.prompt}</div>
}))
vi.mock('../../../pages/image/components/GenerationPanel/ParameterSettings', () => ({
  default: () => <div data-testid="params-body" />
}))
vi.mock('../../../pages/image/components/ImageGallery/MidjourneyActions', () => ({
  default: () => <div data-testid="mj-actions" />
}))

import api from '../../../utils/api'
import ImageGeneration from '../../../pages/image/index'

const row = (id, prompt, extra = {}) => ({
  id, prompt, status: 'success', local_path: `/u/${id}.png`, user_id: 7, size: '1024x1024', ...extra
})

const MODEL = { id: 1, name: 'sd', display_name: '模型甲', provider: 'openai', generation_type: 'sync' }
const MJ_MODEL = { id: 2, name: 'mj', display_name: 'MJ', provider: 'midjourney', generation_type: 'async' }

/* 默认：服务端说这台部署还没对谁开放（和真实缺省一致——没装配资格提供方就一律拒绝） */
const capability = (data) => api.get.mockResolvedValue({ data: { success: true, data: data } })

beforeEach(() => {
  viewer.props = null
  localStorage.clear()
  api.get.mockReset(); api.post.mockReset()
  capability({ available: false, reason: 'pilot_provider_not_installed', message: '这个功能还没有对你所在的学校开放' })
  store = {
    generationHistory: [],
    historyPagination: { total: 0, page: 1 },
    publicGallery: [],
    galleryPagination: { total: 0, page: 1 },
    loading: false,
    processingTasks: {},
    keyword: '',
    setKeyword: vi.fn(k => { store.keyword = k }),
    getUserHistory: vi.fn(async () => ({ data: store.generationHistory })),
    getPublicGallery: vi.fn(async () => ({ data: store.publicGallery })),
    deleteGeneration: vi.fn(async () => true),
    toggleFavorite: vi.fn(async () => true),
    togglePublic: vi.fn(async () => true),
    getUserStats: vi.fn(async () => ({})),
    midjourneyAction: vi.fn(async () => true),
    cleanupFailedTasks: vi.fn()
  }
  generation = {
    models: [MODEL, MJ_MODEL], selectedModel: MODEL, handleModelChange: vi.fn(),
    prompt: '操场的黄昏', setPrompt: vi.fn(), negativePrompt: '', setNegativePrompt: vi.fn(),
    generating: false, generationProgress: null, quantity: 1, selectedSize: '1024x1024',
    seed: -1, guidanceScale: 7, watermark: false, setSelectedSize: vi.fn(), setSeed: vi.fn(),
    setGuidanceScale: vi.fn(), setWatermark: vi.fn(), setQuantity: vi.fn(),
    getTotalPrice: () => 6, handleGenerate: vi.fn()
  }
  upload = {
    referenceImages: [], clearReferenceImages: vi.fn(),
    handleReferenceUpload: vi.fn(), handleRemoveReference: vi.fn()
  }
})

/* 打开工作台（StudioLayout 是懒加载的），并生成一轮 */
async function studio() {
  const view = render(<ImageGeneration />)
  await screen.findByTestId('image-studio')
  return view
}
async function generateOnce() {
  fireEvent.click(screen.getByTestId('studio-generate'))
  await waitFor(() => expect(screen.getAllByTestId('studio-turn').length).toBe(1))
}
const turnImageIds = () =>
  [...document.querySelectorAll('[data-testid="studio-turn"] img')].map(img => img.getAttribute('src'))

describe('本轮结果与图库切片必须分离', () => {
  it('图库切到公开画廊后，本轮的图还在对话区', async () => {
    store.generationHistory = [row(11, '操场的黄昏')]
    generation.handleGenerate.mockResolvedValue(row(11, '操场的黄昏'))
    await studio()
    await generateOnce()
    expect(turnImageIds()).toEqual(['/u/11.png'])

    /* 切公开画廊：图库那份数据整个换人，本轮结果不该受影响 */
    fireEvent.click(screen.getByTestId('studio-open-gallery'))
    store.publicGallery = [row(99, '别人的图')]
    fireEvent.click(await screen.findByText('image.publicGallery'))
    await waitFor(() => expect(store.getPublicGallery).toHaveBeenCalled())
    expect(turnImageIds()).toEqual(['/u/11.png'])
  })

  it('搜索/翻页把历史换成别的结果后，本轮的图还在', async () => {
    store.generationHistory = [row(12, '操场的黄昏')]
    generation.handleGenerate.mockResolvedValue(row(12, '操场的黄昏'))
    await studio()
    await generateOnce()

    /* 搜一个搜不到本轮的词：历史列表被换成别的页 */
    store.generationHistory = [row(77, '毫不相干')]
    fireEvent.click(screen.getByTestId('studio-open-gallery'))
    const box = await screen.findByPlaceholderText('image.searchPlaceholder')
    fireEvent.change(box, { target: { value: '毫不相干' } })
    fireEvent.keyDown(box, { key: 'Enter', code: 'Enter' })
    await waitFor(() => expect(turnImageIds()).toEqual(['/u/12.png']))
  })

  it('从对话区点开大图，只在这一轮里翻，不混进图库当前页', async () => {
    store.generationHistory = [row(13, '操场的黄昏'), row(9, '上一次的旧图')]
    generation.handleGenerate.mockResolvedValue(row(13, '操场的黄昏'))
    await studio()
    await generateOnce()
    fireEvent.click(document.querySelector('[data-testid="studio-turn"] img'))
    const v = await screen.findByTestId('viewer')
    expect(v.getAttribute('data-ids')).toBe('13')
  })
})

describe('本轮是哪几张只认生成响应', () => {
  it('两张只成功一张：只登记成功的那张，不用旧图补位', async () => {
    generation.quantity = 2
    generation.handleGenerate.mockResolvedValue({
      success: true, requested: 2, succeeded: 1, failed: 1,
      results: [row(21, '操场的黄昏')], errors: [{ index: 2, error: '上游超时' }]
    })
    /* 刷新回来的历史里，第二条是上一次的旧图 */
    store.generationHistory = [row(21, '操场的黄昏'), row(9, '上一次的旧图')]
    await studio()
    await generateOnce()
    expect(turnImageIds()).toEqual(['/u/21.png'])
    expect(screen.queryByText('上一次的旧图')).toBeNull()
  })

  it('异步任务：本轮先挂 generationId，完成后跟着更新，旧图一张都不进来', async () => {
    generation.selectedModel = MJ_MODEL
    generation.handleGenerate.mockResolvedValue({
      success: true, taskId: 'task-1', generationId: 31, creditsConsumed: 24
    })
    /* 提交时那条还没进历史列表，最前面躺着的是上一次的旧图 */
    store.generationHistory = [row(9, '上一次的旧图')]
    const view = await studio()
    await generateOnce()
    expect(screen.queryByText('上一次的旧图')).toBeNull()
    expect(turnImageIds()).toEqual([])
    expect(screen.getByText('image.studio.stillRunning')).toBeTruthy()

    /* 轮询完成后历史里出现真正的那条（store 变了，页面跟着重渲染）：本轮跟着变成图 */
    store.generationHistory = [row(31, '操场的黄昏'), row(9, '上一次的旧图')]
    view.rerender(<ImageGeneration />)
    await waitFor(() => expect(turnImageIds()).toEqual(['/u/31.png']))
    expect(screen.queryByText('上一次的旧图')).toBeNull()
  })
})

describe('新能力的门只由服务端决定', () => {
  it('服务端说不可用：「帮我写」不出现，生图与图库照旧可用', async () => {
    store.generationHistory = [row(41, '操场的黄昏')]
    await studio()
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/prompt-assist/capability'))
    expect(screen.queryByTestId('studio-assist')).toBeNull()
    expect(screen.getByTestId('studio-generate')).toBeTruthy()
    expect(screen.getByTestId('studio-open-gallery')).toBeTruthy()
  })

  it('本机 localStorage 塞什么都开不了这个门', async () => {
    localStorage.setItem('image.assist.enabled', 'true')
    localStorage.setItem('image.pilot', 'pku')
    await studio()
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    expect(screen.queryByTestId('studio-assist')).toBeNull()
  })

  it('服务端说可用才出现', async () => {
    capability({ available: true, reason: null, message: null, batch_ref: 'm0-2026-09' })
    await studio()
    expect(await screen.findByTestId('studio-assist')).toBeTruthy()
  })

  it('能力查询自己失败时当作不可用，不冒充可用', async () => {
    api.get.mockRejectedValue(new Error('网络不通'))
    await studio()
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    expect(screen.queryByTestId('studio-assist')).toBeNull()
  })
})

import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PromptComposer from '../../../pages/image/components/Studio/PromptComposer'
import GallerySection from '../../../pages/image/components/Studio/GallerySection'
import ConversationArea from '../../../pages/image/components/Studio/ConversationArea'
import api from '../../../utils/api'

vi.mock('../../../utils/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))

const t = (key, opts) => (opts && opts.price !== undefined ? `${key}:${opts.price}`
  : opts && opts.credits !== undefined ? `${key}:${opts.credits}`
  : opts && opts.count !== undefined ? `${key}:${opts.count}` : key)
const models = [{ id: 1, name: 'sd', display_name: '模型甲' }]

function composer(extra = {}) {
  const props = {
    t, models, selectedModel: models[0], onModelChange: vi.fn(),
    prompt: '', onPromptChange: vi.fn(), onGenerate: vi.fn(), generating: false,
    totalPrice: 6, quantity: 1, selectedSize: '1024x1024', seed: -1,
    parameterPanel: <div data-testid="params-body" />, ...extra
  }
  return { props, ...render(<PromptComposer {...props} />) }
}

beforeEach(() => { vi.clearAllMocks() })

describe('图像工作台的底部输入条', () => {
  it('写字的地方常驻，价格写在按钮上，没写提示词就不让生成', () => {
    composer()
    expect(screen.getByTestId('studio-prompt')).toBeTruthy()
    expect(screen.getByTestId('studio-generate').textContent).toContain('6')
    expect(screen.getByTestId('studio-generate')).toBeDisabled()
  })

  it('有提示词才点得动，点一次只调一次生成', () => {
    const onGenerate = vi.fn()
    composer({ prompt: '校园的黄昏', onGenerate })
    fireEvent.click(screen.getByTestId('studio-generate'))
    expect(onGenerate).toHaveBeenCalledTimes(1)
  })

  it('参数平时不占地方，点开才在抽屉里', async () => {
    composer()
    expect(screen.queryByTestId('params-body')).toBeNull()
    fireEvent.click(screen.getByTestId('studio-params'))
    await waitFor(() => expect(screen.getByTestId('params-body')).toBeTruthy())
  })

  it('AI 写好的提示词由学生决定用不用：替换是替换，追加接在后面', async () => {
    api.post.mockResolvedValue({ data: { data: { candidates: ['夜色中的操场'], credits_charged: 3 } } })
    const onPromptChange = vi.fn()
    composer({ prompt: '校园', onPromptChange })
    fireEvent.click(screen.getByTestId('studio-assist'))
    fireEvent.click(await screen.findByTestId('assist-ask'))
    await screen.findByTestId('assist-candidate-0')
    expect(screen.getByTestId('assist-charged').textContent).toContain('3')   // 花了多少当场说
    fireEvent.click(screen.getAllByText('image.assist.append')[0])
    expect(onPromptChange).toHaveBeenCalledWith('校园，夜色中的操场')
  })

  it('AI 没写出来时照搬后端原话，不假装成功，也不动输入框', async () => {
    api.post.mockRejectedValue({ response: { data: { error: { message: '积分不足：这次需要 6 积分' } } } })
    const onPromptChange = vi.fn()
    composer({ prompt: '校园', onPromptChange })
    fireEvent.click(screen.getByTestId('studio-assist'))
    fireEvent.click(await screen.findByTestId('assist-ask'))
    await waitFor(() => expect(screen.getByTestId('assist-failed').textContent).toContain('积分不足'))
    expect(onPromptChange).not.toHaveBeenCalled()
  })

  it('没选模型时说清楚，而不是让人对着灰按钮猜', () => {
    composer({ selectedModel: null, prompt: '校园' })
    expect(screen.getByTestId('studio-no-model')).toBeTruthy()
    expect(screen.getByTestId('studio-generate')).toBeDisabled()
  })
})

/* 图库这一块是从原页面整段搬出来的，搬家最容易丢的就是"原来在外层作用域里的东西"。
   所以这里必须真的渲染出一张卡片——只渲染空图库是看不出来的。 */
vi.mock('../../../pages/image/components/ImageGallery/ImageCard', () => ({
  default: ({ item, generationProgress }) => (
    <div data-testid={`card-${item.id}`} data-progress={String(generationProgress)}>{item.prompt}</div>
  )
}))

const item = { id: 11, prompt: '操场的黄昏', status: 'success', local_path: '/u/11.png', user_id: 7 }

function gallery(extra = {}) {
  const props = {
    t, user: { id: 7 }, activeTab: 'all', handleTabChange: vi.fn(),
    searchInput: '', setSearchInput: vi.fn(), handleSearch: vi.fn(),
    isComposingRef: { current: false }, viewMode: 'grid', setViewMode: vi.fn(),
    handleRefresh: vi.fn(), loading: false, isSearchActive: false, currentTotal: 1, keyword: '',
    getCurrentData: () => [item], getCurrentPagination: { current: 1, pageSize: 12, total: 1 },
    handlePageChange: vi.fn(), processingTasks: {}, generationProgress: 42,
    handleViewImage: vi.fn(), handleToggleFavorite: vi.fn(), handleTogglePublic: vi.fn(),
    handleDelete: vi.fn(), ...extra
  }
  return { props, ...render(<GallerySection {...props} />) }
}

describe('图库这一块（经典视图与新版抽屉共用同一份）', () => {
  it('有图片时画得出来，进度用传进来的那个，不去摸外层的 generation', () => {
    gallery()
    const card = screen.getByTestId('card-11')
    expect(card.textContent).toContain('操场的黄昏')
    expect(card.getAttribute('data-progress')).toBe('42')
  })
})

describe('对话区', () => {
  const turns = [{ key: 'k1', prompt: '操场的黄昏', ids: [11] }]
  const itemById = id => (id === 11 ? item : undefined)

  it('只显示本次生成的轮次，收藏/公开/删除不出现在对话里', () => {
    render(<ConversationArea t={t} turns={turns} itemById={itemById}
      generating={false} progress={0} onView={vi.fn()} onRerun={vi.fn()} />)
    expect(screen.getAllByTestId('studio-turn').length).toBe(1)
    expect(screen.getByText('操场的黄昏')).toBeTruthy()
    for (const key of ['image.favorite', 'image.setPublic', 'common.delete']) {
      expect(screen.queryByText(key)).toBeNull()
    }
  })

  it('一张都还没生成时给一句话，而不是空白', () => {
    render(<ConversationArea t={t} turns={[]} itemById={itemById}
      generating={false} progress={0} onView={vi.fn()} onRerun={vi.fn()} />)
    expect(screen.getByTestId('studio-conversation').className).toContain('empty')
  })
})

/**
 * 视频输入条：价钱写在按钮上，视频自己的前置条件不满足就别让人白点。
 */
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PromptComposer from '../../../pages/video/components/Studio/PromptComposer'

const t = (key, opts) => (opts && opts.price !== undefined ? `${key}:${opts.price}`
  : opts && opts.count !== undefined ? `${key}:${opts.count}` : key)
const MODEL = { id: 1, display_name: '视频模型甲', has_api_key: true, max_prompt_length: 500 }

function composer(extra = {}) {
  const props = {
    t, models: [MODEL], selectedModel: MODEL, onModelChange: vi.fn(),
    prompt: '镜头缓缓推近', onPromptChange: vi.fn(), onGenerate: vi.fn(), generating: false,
    price: 75, resolution: '720p', duration: 5, ratio: '16:9', generationMode: 'text_to_video',
    frameCount: 0, parameterPanel: <div data-testid="params-body" />, ...extra
  }
  return { props, ...render(<PromptComposer {...props} />) }
}

describe('视频工作台的底部输入条', () => {
  it('按钮上直接写这次要花多少积分，点一次只生成一次', () => {
    const onGenerate = vi.fn()
    composer({ onGenerate })
    expect(screen.getByTestId('studio-generate').textContent).toContain('75')
    fireEvent.click(screen.getByTestId('studio-generate'))
    expect(onGenerate).toHaveBeenCalledTimes(1)
  })

  it('首尾帧模式缺图时不让生成，并说清楚缺什么', () => {
    composer({ generationMode: 'first_last_frame', frameCount: 1 })
    expect(screen.getByTestId('studio-generate')).toBeDisabled()
    expect(screen.getByTestId('studio-need-frame')).toBeTruthy()
  })

  it('两张帧都给了就能生成', () => {
    composer({ generationMode: 'first_last_frame', frameCount: 2 })
    expect(screen.getByTestId('studio-generate')).not.toBeDisabled()
  })

  it('视频自己的参数收在抽屉里，点开才出现——模式/时长/分辨率一个不少', async () => {
    composer()
    expect(screen.queryByTestId('params-body')).toBeNull()
    fireEvent.click(screen.getByTestId('studio-params'))
    await waitFor(() => expect(screen.getByTestId('params-body')).toBeTruthy())
    expect(screen.getByText('720p')).toBeTruthy()
    expect(screen.getByText('5video.seconds')).toBeTruthy()
    expect(screen.getByText('16:9')).toBeTruthy()
  })

  it('模型没配好密钥时不让点', () => {
    composer({ selectedModel: { ...MODEL, has_api_key: false } })
    expect(screen.getByTestId('studio-generate')).toBeDisabled()
  })
})

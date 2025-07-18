/**
 * ChatInputArea组件测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatInputArea from '../../../components/chat/new/ChatInputArea'
import { renderWithProviders } from '../../utils/testUtils'

describe('ChatInputArea', () => {
  const defaultProps = {
    inputValue: '',
    uploadedImage: null,
    uploading: false,
    typing: false,
    isStreaming: false,
    modelCredits: 10,
    remainingCredits: 100,
    imageUploadEnabled: true,
    onInputChange: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    onUploadImage: vi.fn(),
    onRemoveImage: vi.fn(),
    onKeyPress: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('应该渲染输入框和按钮', () => {
    renderWithProviders(<ChatInputArea {...defaultProps} />)
    
    expect(screen.getByPlaceholderText(/输入消息/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /发送/i })).toBeInTheDocument()
    expect(screen.getByText(/本次消耗: 10 积分/i)).toBeInTheDocument()
  })

  it('应该在输入时调用onInputChange', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ChatInputArea {...defaultProps} />)
    
    const input = screen.getByPlaceholderText(/输入消息/i)
    await user.type(input, 'Hello AI')
    
    expect(defaultProps.onInputChange).toHaveBeenCalled()
  })

  it('应该在按Enter时调用onKeyPress', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ChatInputArea {...defaultProps} inputValue="Hello" />)
    
    const input = screen.getByPlaceholderText(/输入消息/i)
    await user.type(input, '{Enter}')
    
    expect(defaultProps.onKeyPress).toHaveBeenCalled()
  })

  it('应该在输入为空时禁用发送按钮', () => {
    renderWithProviders(<ChatInputArea {...defaultProps} inputValue="" />)
    
    const sendButton = screen.getByRole('button', { name: /发送/i })
    expect(sendButton).toBeDisabled()
  })

  it('应该在有输入时启用发送按钮', () => {
    renderWithProviders(<ChatInputArea {...defaultProps} inputValue="Hello" />)
    
    const sendButton = screen.getByRole('button', { name: /发送/i })
    expect(sendButton).not.toBeDisabled()
  })

  it('应该在streaming时显示停止按钮', () => {
    renderWithProviders(<ChatInputArea {...defaultProps} isStreaming={true} />)
    
    expect(screen.getByRole('button', { name: /停止/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /发送/i })).not.toBeInTheDocument()
  })

  it('应该显示已上传的图片', () => {
    const uploadedImage = {
      id: 1,
      url: '/uploads/test.jpg',
      original_name: 'test.jpg'
    }
    
    renderWithProviders(<ChatInputArea {...defaultProps} uploadedImage={uploadedImage} />)
    
    expect(screen.getByAltText('test.jpg')).toBeInTheDocument()
    expect(screen.getByText('test.jpg')).toBeInTheDocument()
  })

  it('应该在支持图片时显示上传按钮', () => {
    renderWithProviders(<ChatInputArea {...defaultProps} imageUploadEnabled={true} />)
    
    expect(screen.getByTitle(/上传图片/i)).toBeInTheDocument()
  })

  it('应该在不支持图片时隐藏上传按钮', () => {
    renderWithProviders(<ChatInputArea {...defaultProps} imageUploadEnabled={false} />)
    
    expect(screen.queryByTitle(/上传图片/i)).not.toBeInTheDocument()
  })

  it('应该在typing时显示loading状态', () => {
    renderWithProviders(<ChatInputArea {...defaultProps} typing={true} inputValue="Hello" />)
    
    const sendButton = screen.getByRole('button', { name: /发送/i })
    expect(sendButton).toHaveClass('ant-btn-loading')
  })
})

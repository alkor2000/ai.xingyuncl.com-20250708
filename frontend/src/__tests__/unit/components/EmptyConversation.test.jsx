/**
 * EmptyConversation组件测试
 */

import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EmptyConversation from '../../../components/chat/new/EmptyConversation'
import { renderWithProviders } from '../../utils/testUtils'

describe('EmptyConversation', () => {
  it('应该渲染欢迎信息', () => {
    renderWithProviders(<EmptyConversation onCreateConversation={() => {}} />)
    
    expect(screen.getByText(/欢迎使用AI助手/i)).toBeInTheDocument()
    expect(screen.getByText(/请选择一个对话或创建新对话开始/i)).toBeInTheDocument()
  })
  
  it('应该显示创建对话按钮', () => {
    renderWithProviders(<EmptyConversation onCreateConversation={() => {}} />)
    
    const button = screen.getByRole('button', { name: /开始新对话/i })
    expect(button).toBeInTheDocument()
    expect(button).toHaveClass('ant-btn-primary')
  })
  
  it('点击按钮应该调用onCreateConversation', async () => {
    const handleCreate = vi.fn()
    const user = userEvent.setup()
    
    renderWithProviders(<EmptyConversation onCreateConversation={handleCreate} />)
    
    const button = screen.getByRole('button', { name: /开始新对话/i })
    await user.click(button)
    
    expect(handleCreate).toHaveBeenCalledTimes(1)
  })
  
  it('应该显示机器人图标', () => {
    const { container } = renderWithProviders(<EmptyConversation onCreateConversation={() => {}} />)
    
    // antd的RobotOutlined会渲染为svg
    const robotIcon = container.querySelector('[data-icon="robot"]')
    expect(robotIcon).toBeTruthy()
  })
})

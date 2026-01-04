/**
 * 工作流测试抽屉 - 对话式测试界面
 * 类似 FastGPT 的运行预览，支持多轮对话
 * 
 * v1.1 优化：删除顶部无用的说明文字，调整 z-index 避免被遮挡
 */

import React, { useState, useEffect, useRef } from 'react'
import { Drawer, Input, Button, Empty, Space, Tag, Spin } from 'antd'
import {
  SendOutlined,
  DeleteOutlined,
  RobotOutlined,
  UserOutlined
} from '@ant-design/icons'
import useAgentStore from '../../../../stores/agentStore'
import './TestDrawer.less'

const { TextArea } = Input

const TestDrawer = ({ open, onClose, workflow }) => {
  const {
    testSession,
    testMessages,
    testLoading,
    createTestSession,
    sendTestMessage,
    clearTestSession
  } = useAgentStore()
  
  const [inputValue, setInputValue] = useState('')
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  
  // 滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }
  
  // 消息更新时滚动
  useEffect(() => {
    scrollToBottom()
  }, [testMessages])
  
  // 打开抽屉时创建会话并聚焦输入框
  useEffect(() => {
    if (open && workflow?.id) {
      handleCreateSession()
    }
    
    if (open) {
      setTimeout(() => {
        inputRef.current?.focus()
      }, 300)
    }
  }, [open])
  
  // 创建测试会话
  const handleCreateSession = async () => {
    if (!testSession) {
      try {
        await createTestSession(workflow.id)
      } catch (error) {
        console.error('创建会话失败:', error)
      }
    }
  }
  
  // 发送消息
  const handleSend = async () => {
    if (!inputValue.trim()) return
    
    const messageContent = inputValue.trim()
    setInputValue('')
    
    try {
      await sendTestMessage(workflow.id, messageContent)
    } catch (error) {
      console.error('发送消息失败:', error)
    }
  }
  
  // 按Enter发送（Shift+Enter换行）
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }
  
  // 清空对话
  const handleClear = () => {
    clearTestSession()
    handleCreateSession()
  }
  
  // 关闭抽屉时清理
  const handleClose = () => {
    clearTestSession()
    onClose()
  }
  
  return (
    <Drawer
      title={
        <Space>
          <RobotOutlined />
          测试运行 - {workflow?.name}
        </Space>
      }
      placement="right"
      width={480}
      onClose={handleClose}
      open={open}
      destroyOnClose={false}
      className="test-drawer"
      // v1.1 设置较高的 z-index 确保不被遮挡
      zIndex={1100}
    >
      <div className="test-chat-container">
        {/* v1.1 删除了无用的 Alert 说明文字 */}
        
        {/* 对话消息列表 */}
        <div className="test-messages-container">
          {testMessages.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="开始对话吧！"
              style={{ marginTop: 60 }}
            />
          ) : (
            <div className="test-messages-list">
              {testMessages.map((msg, index) => (
                <div
                  key={index}
                  className={`test-message ${msg.role === 'user' ? 'user-message' : 'ai-message'}`}
                >
                  <div className="message-avatar">
                    {msg.role === 'user' ? (
                      <UserOutlined style={{ fontSize: 18 }} />
                    ) : (
                      <RobotOutlined style={{ fontSize: 18 }} />
                    )}
                  </div>
                  <div className="message-content">
                    <div className="message-header">
                      <span className="message-role">
                        {msg.role === 'user' ? '你' : 'AI助手'}
                      </span>
                      <span className="message-time">
                        {new Date(msg.timestamp).toLocaleTimeString('zh-CN', {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    </div>
                    <div className="message-text">
                      {msg.content}
                    </div>
                  </div>
                </div>
              ))}
              
              {/* 加载中指示器 */}
              {testLoading && (
                <div className="test-message ai-message">
                  <div className="message-avatar">
                    <RobotOutlined style={{ fontSize: 18 }} />
                  </div>
                  <div className="message-content">
                    <div className="message-header">
                      <span className="message-role">AI助手</span>
                    </div>
                    <div className="message-text">
                      <Spin size="small" /> 思考中...
                    </div>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
        
        {/* 输入区域 */}
        <div className="test-input-container">
          {testMessages.length > 0 && (
            <div className="test-actions">
              <Button
                type="text"
                size="small"
                icon={<DeleteOutlined />}
                onClick={handleClear}
                disabled={testLoading}
              >
                清空对话
              </Button>
              <Tag color="blue">
                {testMessages.length} 条消息
              </Tag>
            </div>
          )}
          
          <div className="test-input-wrapper">
            <TextArea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="输入消息... (Enter发送，Shift+Enter换行)"
              autoSize={{ minRows: 1, maxRows: 4 }}
              disabled={testLoading}
              className="test-input"
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleSend}
              loading={testLoading}
              disabled={!inputValue.trim() || testLoading}
              className="test-send-button"
            >
              发送
            </Button>
          </div>
        </div>
      </div>
    </Drawer>
  )
}

export default TestDrawer

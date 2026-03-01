/**
 * 工作流测试抽屉 - 对话式测试界面 v2.2
 * v1.1 - 删除顶部说明文字，调整z-index
 * v2.0 - 重新设计对话气泡+打字机效果
 * v2.2 - 新增功能：
 *   1. 停止输出按钮（打字机期间可跳过，等待API期间可取消）
 *   2. 消息区滚动条加粗+始终可见
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Drawer, Input, Button, Tag } from 'antd'
import {
  SendOutlined,
  DeleteOutlined,
  RobotOutlined,
  UserOutlined,
  CloseOutlined,
  PauseCircleOutlined
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
  
  // 打字机效果状态
  const [displayedText, setDisplayedText] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const typingRef = useRef(null)
  
  // API请求中止控制器
  const abortControllerRef = useRef(null)
  
  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])
  
  useEffect(() => {
    scrollToBottom()
  }, [testMessages, displayedText, scrollToBottom])
  
  /**
   * 打字机效果
   */
  useEffect(() => {
    if (typingRef.current) {
      clearInterval(typingRef.current)
      typingRef.current = null
    }
    
    if (testMessages.length === 0) return
    const lastMsg = testMessages[testMessages.length - 1]
    if (lastMsg.role !== 'assistant') return
    
    const fullText = lastMsg.content || ''
    if (displayedText === fullText) return
    
    if (!fullText.startsWith(displayedText) || displayedText === '') {
      setIsTyping(true)
      setDisplayedText('')
      let charIndex = 0
      
      typingRef.current = setInterval(() => {
        charIndex++
        if (charIndex >= fullText.length) {
          setDisplayedText(fullText)
          setIsTyping(false)
          clearInterval(typingRef.current)
          typingRef.current = null
        } else {
          setDisplayedText(fullText.substring(0, charIndex))
        }
      }, 18)
    }
    
    return () => {
      if (typingRef.current) clearInterval(typingRef.current)
    }
  }, [testMessages])
  
  // 打开/关闭抽屉
  useEffect(() => {
    if (open && workflow?.id) {
      handleCreateSession()
    }
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 300)
    }
    if (!open) {
      setDisplayedText('')
      setIsTyping(false)
      if (typingRef.current) { clearInterval(typingRef.current); typingRef.current = null }
    }
  }, [open])
  
  const handleCreateSession = async () => {
    if (!testSession) {
      try { await createTestSession(workflow.id) } catch (e) { console.error(e) }
    }
  }
  
  /**
   * 发送消息
   */
  const handleSend = async () => {
    if (!inputValue.trim()) return
    const messageContent = inputValue.trim()
    setInputValue('')
    setDisplayedText('')
    
    try {
      await sendTestMessage(workflow.id, messageContent)
    } catch (error) {
      console.error('发送消息失败:', error)
    }
  }
  
  /**
   * v2.2: 停止输出
   * 如果正在打字机效果中 → 立即跳到全文
   * 如果正在等待API响应 → 无法真正取消HTTP，但停止前端等待状态
   */
  const handleStop = useCallback(() => {
    // 情况1: 打字机效果进行中，跳到全文
    if (isTyping && typingRef.current) {
      clearInterval(typingRef.current)
      typingRef.current = null
      
      // 获取完整文本
      const lastMsg = testMessages[testMessages.length - 1]
      if (lastMsg?.role === 'assistant') {
        setDisplayedText(lastMsg.content || '')
      }
      setIsTyping(false)
      return
    }
    
    // 情况2: 等待API响应中（打字机还没开始）
    // 目前无法取消后端执行，但可以提示用户
    if (testLoading && !isTyping) {
      // 暂时仅作为UI反馈，后端请求仍会继续
      // 未来可以通过AbortController实现真正取消
    }
  }, [isTyping, testLoading, testMessages])
  
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }
  
  const handleClear = () => {
    clearTestSession()
    setDisplayedText('')
    setIsTyping(false)
    if (typingRef.current) { clearInterval(typingRef.current); typingRef.current = null }
    handleCreateSession()
  }
  
  const handleClose = () => {
    clearTestSession()
    setDisplayedText('')
    setIsTyping(false)
    if (typingRef.current) { clearInterval(typingRef.current); typingRef.current = null }
    onClose()
  }
  
  const getMessageText = (msg, index) => {
    if (
      msg.role === 'assistant' && 
      index === testMessages.length - 1 && 
      (isTyping || displayedText !== msg.content)
    ) {
      return displayedText || ''
    }
    return msg.content
  }
  
  // 是否显示停止按钮：打字机进行中或等待API响应
  const showStopBtn = isTyping || testLoading
  
  return (
    <Drawer
      title={null}
      placement="right"
      width={480}
      onClose={handleClose}
      open={open}
      destroyOnClose={false}
      className="test-drawer-v2"
      zIndex={1100}
      closable={false}
    >
      <div className="td-container">
        {/* 头部 */}
        <div className="td-header">
          <div className="td-header-left">
            <div className="td-header-icon"><RobotOutlined /></div>
            <div className="td-header-info">
              <div className="td-header-title">测试运行</div>
              <div className="td-header-subtitle">{workflow?.name}</div>
            </div>
          </div>
          <Button type="text" icon={<CloseOutlined />} onClick={handleClose} className="td-close-btn" />
        </div>
        
        {/* 消息列表 */}
        <div className="td-messages">
          {testMessages.length === 0 ? (
            <div className="td-empty">
              <div className="td-empty-icon"><RobotOutlined /></div>
              <div className="td-empty-text">开始测试对话吧</div>
              <div className="td-empty-hint">输入消息测试工作流运行效果</div>
            </div>
          ) : (
            <>
              {testMessages.map((msg, index) => (
                <div key={index} className={`td-msg ${msg.role === 'user' ? 'td-msg-user' : 'td-msg-ai'}`}>
                  {msg.role === 'assistant' && (
                    <div className="td-avatar td-avatar-ai"><RobotOutlined /></div>
                  )}
                  <div className="td-bubble-wrap">
                    <div className="td-sender">{msg.role === 'user' ? '你' : 'AI助手'}</div>
                    <div className={`td-bubble ${msg.role === 'user' ? 'td-bubble-user' : 'td-bubble-ai'}`}>
                      <div className="td-text">
                        {getMessageText(msg, index)}
                        {msg.role === 'assistant' && index === testMessages.length - 1 && isTyping && (
                          <span className="td-cursor">|</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {msg.role === 'user' && (
                    <div className="td-avatar td-avatar-user"><UserOutlined /></div>
                  )}
                </div>
              ))}
              
              {/* 等待响应指示器 */}
              {testLoading && !isTyping && (
                <div className="td-msg td-msg-ai">
                  <div className="td-avatar td-avatar-ai"><RobotOutlined /></div>
                  <div className="td-bubble-wrap">
                    <div className="td-sender">AI助手</div>
                    <div className="td-bubble td-bubble-ai">
                      <div className="td-typing-dots">
                        <span></span><span></span><span></span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </>
          )}
        </div>
        
        {/* 底部输入区域 */}
        <div className="td-input-area">
          {testMessages.length > 0 && (
            <div className="td-input-toolbar">
              <Button
                type="text"
                size="small"
                icon={<DeleteOutlined />}
                onClick={handleClear}
                disabled={testLoading}
                className="td-clear-btn"
              >
                清空对话
              </Button>
              <Tag color="blue" className="td-msg-count">
                {testMessages.length} 条消息
              </Tag>
            </div>
          )}
          
          <div className="td-input-row">
            <TextArea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="输入消息... (Enter发送，Shift+Enter换行)"
              autoSize={{ minRows: 1, maxRows: 4 }}
              disabled={testLoading}
              className="td-textarea"
            />
            
            {/* v2.2: 发送/停止按钮切换 */}
            {showStopBtn ? (
              <Button
                type="default"
                shape="circle"
                size="large"
                icon={<PauseCircleOutlined />}
                onClick={handleStop}
                className="td-stop-btn"
                title={isTyping ? '跳过动画' : '等待响应中...'}
              />
            ) : (
              <Button
                type="primary"
                shape="circle"
                size="large"
                icon={<SendOutlined />}
                onClick={handleSend}
                loading={testLoading}
                disabled={!inputValue.trim() || testLoading}
                className="td-send-btn"
              />
            )}
          </div>
        </div>
      </div>
    </Drawer>
  )
}

export default TestDrawer

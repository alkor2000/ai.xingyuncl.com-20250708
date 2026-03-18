/**
 * 工作流测试抽屉 - 对话式测试界面 v2.4
 * v2.3 - UI修复：去掉消息上方文字标签
 * v2.4 - 修复：清空对话后无法发送消息
 *   原因: clearTestSession将testSession置null，handleCreateSession
 *         检查if(!testSession)时因React状态未同步读到旧值，跳过创建
 *   修复: handleClear直接调用createTestSession，不依赖state检查
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
  
  /* 打字机效果状态 */
  const [displayedText, setDisplayedText] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const typingRef = useRef(null)
  
  /* 滚动到底部 */
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
  
  /* 打开抽屉时创建会话 */
  useEffect(() => {
    if (open && workflow?.id && !testSession) {
      createTestSession(workflow.id).catch(e => console.error(e))
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
  
  /** 发送消息 */
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
   * 打字机效果中 → 跳到全文
   * 等待API响应 → 前端提示
   */
  const handleStop = useCallback(() => {
    if (isTyping && typingRef.current) {
      clearInterval(typingRef.current)
      typingRef.current = null
      const lastMsg = testMessages[testMessages.length - 1]
      if (lastMsg?.role === 'assistant') {
        setDisplayedText(lastMsg.content || '')
      }
      setIsTyping(false)
      return
    }
  }, [isTyping, testMessages])
  
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }
  
  /**
   * v2.4: 清空对话 - 直接创建新会话
   * 先清空状态，再立即调用createTestSession创建新会话
   * 不再通过handleCreateSession间接调用，避免state同步问题
   */
  const handleClear = async () => {
    /* 清空打字机状态 */
    setDisplayedText('')
    setIsTyping(false)
    if (typingRef.current) { clearInterval(typingRef.current); typingRef.current = null }
    
    /* 清空会话状态 */
    clearTestSession()
    
    /* 直接创建新的测试会话 */
    if (workflow?.id) {
      try {
        await createTestSession(workflow.id)
      } catch (e) {
        console.error('重新创建会话失败:', e)
      }
    }
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
  
  /* 是否显示停止按钮 */
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
                  {/* AI头像在左侧 */}
                  {msg.role === 'assistant' && (
                    <div className="td-avatar td-avatar-ai"><RobotOutlined /></div>
                  )}
                  {/* 消息气泡 */}
                  <div className="td-bubble-wrap">
                    <div className={`td-bubble ${msg.role === 'user' ? 'td-bubble-user' : 'td-bubble-ai'}`}>
                      <div className="td-text">
                        {getMessageText(msg, index)}
                        {msg.role === 'assistant' && index === testMessages.length - 1 && isTyping && (
                          <span className="td-cursor">|</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* 用户头像在右侧 */}
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
            
            {/* 发送/停止按钮切换 */}
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

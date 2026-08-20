/**
 * 工作流测试抽屉 - 对话式测试界面 v2.5
 *
 * v2.3 - UI修复：去掉消息上方文字标签
 * v2.4 - 修复：清空对话后无法发送消息
 *   原因: clearTestSession将testSession置null，handleCreateSession
 *         检查if(!testSession)时因React状态未同步读到旧值，跳过创建
 *   修复: handleClear直接调用createTestSession，不依赖state检查
 * v2.5 - 国际化改造：
 *   接入 useTranslation，将 12 处硬编码中文替换为 agent.test.* 翻译键
 *   （测试运行标题、空状态标题与提示、清空对话、消息计数、
 *     输入框占位、停止按钮 title、错误日志提示等）
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
import { useTranslation } from 'react-i18next'
import useAgentStore from '../../../../stores/agentStore'
import './TestDrawer.less'

const { TextArea } = Input

/** 打字机效果每个字符的间隔（毫秒） */
const TYPING_INTERVAL_MS = 18

const TestDrawer = ({ open, onClose, workflow }) => {
  const { t } = useTranslation()

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

  /* 滚动到消息列表底部 */
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [testMessages, displayedText, scrollToBottom])

  /**
   * 打字机效果
   * 监听最后一条 AI 消息，逐字符输出，模拟流式打字
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
      }, TYPING_INTERVAL_MS)
    }

    return () => {
      if (typingRef.current) clearInterval(typingRef.current)
    }
  }, [testMessages])

  /* 打开抽屉时创建测试会话，关闭时清理打字机状态 */
  useEffect(() => {
    if (open && workflow?.id && !testSession) {
      createTestSession(workflow.id).catch(e => {
        console.error('[TestDrawer]', t('agent.test.createSessionFailed'), e)
      })
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
      console.error('[TestDrawer]', t('agent.test.sendFailed'), error)
    }
  }

  /**
   * 停止输出
   * 打字机效果中 → 直接跳到全文
   * 等待API响应中 → 仅前端提示，不中断请求
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

  /* Enter 发送，Shift+Enter 换行 */
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  /**
   * 清空对话 - 直接创建新会话
   * 先清空状态，再立即调用 createTestSession，
   * 不通过间接判断 testSession，避免 React 状态未同步导致漏创建
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
        console.error('[TestDrawer]', t('agent.test.createSessionFailed'), e)
      }
    }
  }

  /** 关闭抽屉并清理全部状态 */
  const handleClose = () => {
    clearTestSession()
    setDisplayedText('')
    setIsTyping(false)
    if (typingRef.current) { clearInterval(typingRef.current); typingRef.current = null }
    onClose()
  }

  /**
   * 获取消息显示文本
   * 最后一条 AI 消息在打字过程中显示逐字文本，其余显示完整内容
   */
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

  /* 是否显示停止按钮（打字中或等待响应中） */
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
        {/* 头部：图标 + 标题 + 工作流名称 + 关闭按钮 */}
        <div className="td-header">
          <div className="td-header-left">
            <div className="td-header-icon"><RobotOutlined /></div>
            <div className="td-header-info">
              <div className="td-header-title">{t('agent.test.title')}</div>
              <div className="td-header-subtitle">{workflow?.name}</div>
            </div>
          </div>
          <Button
            type="text"
            icon={<CloseOutlined />}
            onClick={handleClose}
            className="td-close-btn"
          />
        </div>

        {/* 消息列表区 */}
        <div className="td-messages">
          {testMessages.length === 0 ? (
            <div className="td-empty">
              <div className="td-empty-icon"><RobotOutlined /></div>
              <div className="td-empty-text">{t('agent.test.emptyTitle')}</div>
              <div className="td-empty-hint">{t('agent.test.emptyHint')}</div>
            </div>
          ) : (
            <>
              {testMessages.map((msg, index) => (
                <div
                  key={index}
                  className={`td-msg ${msg.role === 'user' ? 'td-msg-user' : 'td-msg-ai'}`}
                >
                  {/* AI头像在左侧 */}
                  {msg.role === 'assistant' && (
                    <div className="td-avatar td-avatar-ai"><RobotOutlined /></div>
                  )}
                  {/* 消息气泡 */}
                  <div className="td-bubble-wrap">
                    <div
                      className={`td-bubble ${msg.role === 'user' ? 'td-bubble-user' : 'td-bubble-ai'}`}
                    >
                      <div className="td-text">
                        {getMessageText(msg, index)}
                        {msg.role === 'assistant' &&
                          index === testMessages.length - 1 &&
                          isTyping && <span className="td-cursor">|</span>}
                      </div>
                    </div>
                  </div>
                  {/* 用户头像在右侧 */}
                  {msg.role === 'user' && (
                    <div className="td-avatar td-avatar-user"><UserOutlined /></div>
                  )}
                </div>
              ))}

              {/* 等待响应指示器（三点跳动动画） */}
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
          {/* 工具栏：清空对话 + 消息计数（仅有消息时显示） */}
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
                {t('agent.test.clear')}
              </Button>
              <Tag color="blue" className="td-msg-count">
                {t('agent.test.messageCount', { count: testMessages.length })}
              </Tag>
            </div>
          )}

          <div className="td-input-row">
            <TextArea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={t('agent.test.inputPlaceholder')}
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
                title={
                  isTyping
                    ? t('agent.test.skipAnimation')
                    : t('agent.test.waitingResponse')
                }
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

/**
 * 消息列表组件
 * 负责渲染对话中的所有消息，包含用户消息和AI消息
 * 
 * v3.0 变更：
 *   - 新增 showThinking prop 透传给 MessageContent
 *   - 支持控制是否显示 Claude 推理模型的思考过程
 *   - MessageItem 的 React.memo 比较函数新增 showThinking 比较
 */

import React, { useState, useEffect } from 'react'
import { Avatar, Card, Spin, Empty, Typography, Alert } from 'antd'
import { ThunderboltFilled, LoadingOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import MessageContent from './MessageContent'
import apiClient from '../../utils/api'
import './MessageList.less'

const { Text } = Typography

/**
 * 单个消息组件
 * 使用 React.memo 优化渲染性能，只在关键 props 变化时重新渲染
 * 
 * v3.0: 新增 showThinking prop，透传给 MessageContent 控制思考过程显示
 */
const MessageItem = React.memo(({ msg, isStreamingMsg, isStreaming, user, currentModel, aiModels, onDeleteMessage, showThinking }) => {
  const { t } = useTranslation()
  
  // 获取用户首字母
  const getUserInitial = () => {
    if (user && user.username) {
      return user.username.charAt(0).toUpperCase()
    }
    return 'U'
  }
  
  // AI头像的自定义SVG图标 - 简洁的闪电符号
  const AIIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="currentColor" stroke="none" />
    </svg>
  )
  
  return (
    <div 
      style={{ 
        display: 'flex', 
        marginBottom: 16,
        justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start'
      }}
    >
      {/* AI助手头像 - 显示在消息左侧 */}
      {msg.role === 'assistant' && (
        <Avatar 
          size={36}
          style={{ 
            backgroundColor: 'var(--primary-color)',
            marginRight: 8,
            alignSelf: 'flex-start',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }} 
        >
          <AIIcon />
        </Avatar>
      )}
      
      {/* 消息卡片 */}
      <Card
        size="small"
        style={{
          maxWidth: '70%',
          backgroundColor: msg.role === 'user' ? 'var(--user-message-bg)' : 'var(--ai-message-bg)',
          color: msg.role === 'user' ? 'var(--user-message-text)' : 'var(--ai-message-text)'
        }}
        bodyStyle={{ padding: '12px 16px' }}
      >
        {/* v3.0: 传递 showThinking prop 给 MessageContent */}
        <MessageContent 
          message={msg} 
          isStreaming={isStreamingMsg && isStreaming}
          currentModel={currentModel}
          aiModels={aiModels}
          onDeleteMessage={onDeleteMessage}
          showThinking={showThinking}
        />
      </Card>
      
      {/* 用户头像 - 显示在消息右侧 */}
      {msg.role === 'user' && (
        <Avatar 
          size={36}
          style={{ 
            background: '#1a1a1a',
            marginLeft: 8,
            alignSelf: 'flex-start',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            fontWeight: 700,
            fontSize: '18px',
            color: '#ffffff'
          }} 
        >
          {getUserInitial()}
        </Avatar>
      )}
    </div>
  )
}, (prevProps, nextProps) => {
  // v3.0: 新增 showThinking 比较，确保开关切换时重新渲染
  return prevProps.msg.id === nextProps.msg.id &&
         prevProps.msg.content === nextProps.msg.content &&
         prevProps.isStreamingMsg === nextProps.isStreamingMsg &&
         prevProps.isStreaming === nextProps.isStreaming &&
         prevProps.user?.username === nextProps.user?.username &&
         prevProps.currentModel?.name === nextProps.currentModel?.name &&
         prevProps.aiModels?.length === nextProps.aiModels?.length &&
         prevProps.showThinking === nextProps.showThinking
})

MessageItem.displayName = 'MessageItem'

/**
 * 空消息状态组件 - 显示系统公告
 * 当对话中没有消息时显示，包含系统公告和空状态提示
 */
const EmptyMessages = () => {
  const { t } = useTranslation()
  const [announcement, setAnnouncement] = useState(null)
  const [loading, setLoading] = useState(true)

  // 获取系统公告
  useEffect(() => {
    const fetchAnnouncement = async () => {
      try {
        setLoading(true)
        const response = await apiClient.get('/admin/announcement')
        if (response.data.success) {
          setAnnouncement(response.data.data)
        }
      } catch (error) {
        console.error('获取系统公告失败:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchAnnouncement()
  }, [])

  return (
    <div className="chat-empty">
      {/* 系统公告 */}
      {loading ? (
        <div className="announcement-loading">
          <Spin size="large" />
        </div>
      ) : (
        announcement?.content && (
          <Card className="announcement-card">
            <div className="announcement-header">
              <InfoCircleOutlined style={{ color: 'var(--primary-color)', marginRight: 8 }} />
              <span>系统公告</span>
            </div>
            <div className="announcement-content markdown-content">
              <ReactMarkdown>{announcement.content}</ReactMarkdown>
            </div>
          </Card>
        )
      )}
      
      {/* 原有的空状态提示 */}
      <Empty 
        description={t('chat.startChat')}
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    </div>
  )
}

/**
 * 消息列表主组件
 * 使用 React.memo 优化性能
 * 
 * v3.0: 新增 showThinking prop，控制是否显示 AI 思考过程
 * 
 * @param {Array} messages - 消息列表
 * @param {boolean} typing - 是否正在输入
 * @param {boolean} isStreaming - 是否正在流式输出
 * @param {string} streamingMessageId - 正在流式输出的消息ID
 * @param {Object} messagesEndRef - 消息列表底部的ref（用于自动滚动）
 * @param {Object} user - 当前用户信息
 * @param {Object} currentModel - 当前使用的AI模型
 * @param {Array} aiModels - 可用的AI模型列表
 * @param {Function} onDeleteMessage - 删除消息的回调函数
 * @param {boolean} showThinking - 是否显示AI思考过程（v3.0新增）
 */
const MessageList = React.memo(({ 
  messages, 
  typing, 
  isStreaming, 
  streamingMessageId,
  messagesEndRef,
  user,
  currentModel,
  aiModels = [],
  onDeleteMessage,
  showThinking = false
}) => {
  const { t } = useTranslation()
  
  // 消息列表为空时显示空状态（包含系统公告）
  if (messages.length === 0) {
    return <EmptyMessages />
  }

  return (
    <div className="chat-messages-list">
      {messages.map(msg => {
        const isStreamingMsg = msg.id === streamingMessageId || msg.streaming
        return (
          <MessageItem 
            key={msg.id}
            msg={msg}
            isStreamingMsg={isStreamingMsg}
            isStreaming={isStreaming}
            user={user}
            currentModel={currentModel}
            aiModels={aiModels}
            onDeleteMessage={onDeleteMessage}
            showThinking={showThinking}
          />
        )
      })}
      
      {/* typing状态时只显示转圈图标，不显示文字 */}
      {typing && !isStreaming && (
        <div style={{ textAlign: 'left', marginTop: 16 }}>
          <Spin size="small" />
        </div>
      )}
      
      <div ref={messagesEndRef} />
    </div>
  )
})

MessageList.displayName = 'MessageList'

export default MessageList

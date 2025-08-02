import React, { useState, useEffect } from 'react'
import { Avatar, Card, Spin, Empty, Typography, Alert } from 'antd'
import { ThunderboltFilled, LoadingOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import MessageContent from './MessageContent'
import apiClient from '../../utils/api'
import './MessageList.less'

const { Text } = Typography

// 单个消息组件
const MessageItem = React.memo(({ msg, isStreamingMsg, isStreaming, user, currentModel, aiModels, onDeleteMessage }) => {
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
      
      <Card
        size="small"
        style={{
          maxWidth: '70%',
          backgroundColor: msg.role === 'user' ? 'var(--user-message-bg)' : 'var(--ai-message-bg)',
          color: msg.role === 'user' ? 'var(--user-message-text)' : 'var(--ai-message-text)'
        }}
        bodyStyle={{ padding: '12px 16px' }}
      >
        <MessageContent 
          message={msg} 
          isStreaming={isStreamingMsg && isStreaming}
          currentModel={currentModel}
          aiModels={aiModels}
          onDeleteMessage={onDeleteMessage}
        />
      </Card>
      
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
  return prevProps.msg.id === nextProps.msg.id &&
         prevProps.msg.content === nextProps.msg.content &&
         prevProps.isStreamingMsg === nextProps.isStreamingMsg &&
         prevProps.isStreaming === nextProps.isStreaming &&
         prevProps.user?.username === nextProps.user?.username &&
         prevProps.currentModel?.name === nextProps.currentModel?.name &&
         prevProps.aiModels?.length === nextProps.aiModels?.length
})

MessageItem.displayName = 'MessageItem'

// 空消息状态组件 - 显示系统公告
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

// 消息列表组件
const MessageList = React.memo(({ 
  messages, 
  typing, 
  isStreaming, 
  streamingMessageId,
  messagesEndRef,
  user,
  currentModel,
  aiModels = [],
  onDeleteMessage
}) => {
  const { t } = useTranslation()
  
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

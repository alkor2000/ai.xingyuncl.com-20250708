import React from 'react'
import { Avatar, Card, Spin, Empty, Typography } from 'antd'
import { ThunderboltFilled, LoadingOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import MessageContent from './MessageContent'

const { Text } = Typography

// 单个消息组件
const MessageItem = React.memo(({ msg, isStreamingMsg, isStreaming, user, currentModel, onDeleteMessage }) => {
  const { t } = useTranslation()
  
  // 获取用户首字母
  const getUserInitial = () => {
    if (user && user.username) {
      return user.username.charAt(0).toUpperCase()
    }
    return 'U'
  }
  
  // AI头像的自定义SVG图标
  const AIIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2L2 7L12 12L22 7L12 2Z" />
      <path d="M2 17L12 22L22 17" opacity="0.6" />
      <path d="M2 12L12 17L22 12" opacity="0.8" />
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
            background: 'linear-gradient(135deg, #1E3A8A 0%, #06B6D4 100%)',
            marginRight: 8,
            alignSelf: 'flex-start',
            boxShadow: '0 2px 8px rgba(30, 58, 138, 0.3)',
            border: '2px solid rgba(255, 255, 255, 0.2)'
          }} 
        >
          <AIIcon />
        </Avatar>
      )}
      
      <Card
        size="small"
        style={{
          maxWidth: '70%',
          backgroundColor: msg.role === 'user' ? '#e8e8e8' : '#f6f6f6',
          color: msg.role === 'user' ? 'inherit' : 'inherit'
        }}
        bodyStyle={{ padding: '12px 16px' }}
      >
        <MessageContent 
          message={msg} 
          isStreaming={isStreamingMsg && isStreaming}
          currentModel={currentModel}
          onDeleteMessage={onDeleteMessage}
        />
        
        {/* 流式加载指示器 - 去掉文字，只保留图标 */}
        {isStreamingMsg && isStreaming && (
          <div style={{ marginTop: 8 }}>
            <LoadingOutlined style={{ fontSize: 14 }} />
          </div>
        )}
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
         prevProps.currentModel?.name === nextProps.currentModel?.name
})

MessageItem.displayName = 'MessageItem'

// 消息列表组件
const MessageList = React.memo(({ 
  messages, 
  typing, 
  isStreaming, 
  streamingMessageId,
  messagesEndRef,
  user,
  currentModel,
  onDeleteMessage
}) => {
  const { t } = useTranslation()
  
  if (messages.length === 0) {
    return (
      <div className="chat-empty">
        <Empty 
          description={t('chat.startChat')}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </div>
    )
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

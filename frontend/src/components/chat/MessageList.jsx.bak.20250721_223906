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
            backgroundColor: '#1890ff',
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

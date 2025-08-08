/**
 * 虚拟滚动消息列表 - 优化长对话性能
 */

import React, { useRef, useCallback, forwardRef, useImperativeHandle, useState, useEffect } from 'react'
import { VariableSizeList as List } from 'react-window'
import { Avatar, Card, Spin, Empty, Typography } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import MessageContent from './MessageContent'
import apiClient from '../../utils/api'
import { useTranslation } from 'react-i18next'
import './MessageList.less'

const { Text } = Typography

// AI头像图标
const AIIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="currentColor" stroke="none" />
  </svg>
)

// 空消息状态组件 - 复用原有实现
const EmptyMessages = () => {
  const { t } = useTranslation()
  const [announcement, setAnnouncement] = useState(null)
  const [loading, setLoading] = useState(true)

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
      
      <Empty 
        description={t('chat.startChat')}
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    </div>
  )
}

// 虚拟滚动的消息行组件
const VirtualMessageRow = React.memo(({ index, style, data }) => {
  const { messages, user, currentModel, aiModels, isStreaming, streamingMessageId, onDeleteMessage } = data
  const msg = messages[index]
  
  if (!msg) return null
  
  const isStreamingMsg = msg.id === streamingMessageId || msg.streaming
  
  // 获取用户首字母
  const getUserInitial = () => {
    if (user && user.username) {
      return user.username.charAt(0).toUpperCase()
    }
    return 'U'
  }
  
  return (
    <div style={style}>
      <div 
        style={{ 
          display: 'flex', 
          marginBottom: 16,
          padding: '0 20px',
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
    </div>
  )
})

VirtualMessageRow.displayName = 'VirtualMessageRow'

// 虚拟滚动消息列表主组件
const VirtualMessageList = forwardRef(({ 
  messages = [], 
  typing, 
  isStreaming, 
  streamingMessageId,
  messagesEndRef,
  user,
  currentModel,
  aiModels = [],
  onDeleteMessage,
  containerHeight
}, ref) => {
  const { t } = useTranslation()
  const listRef = useRef(null)
  const itemHeights = useRef({})
  const [isScrolling, setIsScrolling] = useState(false)
  
  // 如果没有消息，显示空状态
  if (messages.length === 0) {
    return <EmptyMessages />
  }
  
  // 计算每个消息的高度
  const getItemSize = useCallback((index) => {
    // 如果已缓存，返回缓存值
    if (itemHeights.current[index]) {
      return itemHeights.current[index]
    }
    
    const msg = messages[index]
    if (!msg) return 100
    
    // 基础高度
    let height = 80
    
    // 根据内容长度估算
    if (msg.content) {
      const lines = Math.ceil(msg.content.length / 100)
      height += lines * 20
    }
    
    // 如果有图片，增加高度
    if (msg.file) {
      height += 320
    }
    
    // 限制最大高度
    height = Math.min(height, 800)
    
    // 缓存计算结果
    itemHeights.current[index] = height
    
    return height
  }, [messages])
  
  // 暴露方法给父组件
  useImperativeHandle(ref, () => ({
    scrollToBottom: () => {
      if (listRef.current) {
        listRef.current.scrollToItem(messages.length - 1, 'end')
      }
    },
    scrollToTop: () => {
      if (listRef.current) {
        listRef.current.scrollToItem(0, 'start')
      }
    }
  }))
  
  // 当有新消息时滚动到底部
  useEffect(() => {
    if (listRef.current && !isScrolling) {
      // 延迟一下确保高度计算完成
      setTimeout(() => {
        listRef.current.scrollToItem(messages.length - 1, 'end')
      }, 100)
    }
  }, [messages.length, isScrolling])
  
  // 准备传递给行组件的数据
  const itemData = {
    messages,
    user,
    currentModel,
    aiModels,
    isStreaming,
    streamingMessageId,
    onDeleteMessage
  }
  
  // 计算列表高度（使用容器高度或默认值）
  const listHeight = containerHeight || window.innerHeight - 250
  
  return (
    <div className="chat-messages-list" style={{ height: '100%' }}>
      <List
        ref={listRef}
        height={listHeight}
        itemCount={messages.length}
        itemSize={getItemSize}
        itemData={itemData}
        width="100%"
        onScroll={({ scrollDirection, scrollOffset, scrollUpdateWasRequested }) => {
          // 如果是用户滚动（不是程序触发的）
          if (!scrollUpdateWasRequested) {
            setIsScrolling(true)
            // 如果滚动到底部附近，取消滚动标记
            const isNearBottom = scrollOffset > (messages.length * 100) - listHeight - 100
            if (isNearBottom) {
              setIsScrolling(false)
            }
          }
        }}
        overscanCount={3}
      >
        {VirtualMessageRow}
      </List>
      
      {/* typing状态指示器 */}
      {typing && !isStreaming && (
        <div style={{ 
          position: 'absolute', 
          bottom: 10, 
          left: 20,
          background: 'var(--ai-message-bg)',
          padding: '8px 12px',
          borderRadius: '8px'
        }}>
          <Spin size="small" />
        </div>
      )}
      
      {/* 保留原有的messagesEndRef用于兼容 */}
      <div ref={messagesEndRef} style={{ height: 0 }} />
    </div>
  )
})

VirtualMessageList.displayName = 'VirtualMessageList'

export default VirtualMessageList

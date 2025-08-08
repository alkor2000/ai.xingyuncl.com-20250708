/**
 * 虚拟滚动消息列表组件 - 优化长对话性能
 */

import React, { useState, useEffect, useRef, useCallback, memo, forwardRef } from 'react'
import { VariableSizeList as List } from 'react-window'
import InfiniteLoader from 'react-window-infinite-loader'
import { Avatar, Card, Spin, Empty, Typography, message as antMessage } from 'antd'
import { LoadingOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import MessageContent from './MessageContent'
import apiClient from '../../utils/api'
import './MessageList.less'

const { Text } = Typography

// AI头像图标组件
const AIIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="currentColor" stroke="none" />
  </svg>
)

// 单个消息行组件 - 使用memo优化
const MessageRow = memo(({ 
  index, 
  style, 
  data 
}) => {
  const { 
    messages, 
    user, 
    currentModel, 
    aiModels, 
    isStreaming, 
    streamingMessageId,
    onDeleteMessage,
    loadingMore 
  } = data
  
  // 处理加载更多的占位符
  if (index === 0 && loadingMore) {
    return (
      <div style={style}>
        <div style={{ textAlign: 'center', padding: '20px' }}>
          <Spin size="small" />
          <Text type="secondary" style={{ marginLeft: 8 }}>
            加载历史消息...
          </Text>
        </div>
      </div>
    )
  }
  
  const messageIndex = loadingMore ? index - 1 : index
  const msg = messages[messageIndex]
  
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

MessageRow.displayName = 'MessageRow'

// 空消息状态组件
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

// 虚拟滚动消息列表主组件
const VirtualMessageList = forwardRef(({ 
  messages = [], 
  typing, 
  isStreaming, 
  streamingMessageId,
  user,
  currentModel,
  aiModels = [],
  onDeleteMessage,
  onLoadMore,
  hasMore = false,
  totalCount = 0,
  conversationId
}, ref) => {
  const { t } = useTranslation()
  const listRef = useRef(null)
  const itemHeights = useRef({})
  const [loadingMore, setLoadingMore] = useState(false)
  
  // 如果没有消息，显示空状态
  if (messages.length === 0) {
    return <EmptyMessages />
  }
  
  // 计算项目高度
  const getItemSize = useCallback((index) => {
    // 如果是加载更多的占位符
    if (index === 0 && loadingMore) {
      return 60
    }
    
    const messageIndex = loadingMore ? index - 1 : index
    const msg = messages[messageIndex]
    if (!msg) return 100
    
    // 根据内容长度估算高度
    const baseHeight = 80
    const contentLength = msg.content ? msg.content.length : 0
    const hasImage = !!msg.file
    
    // 粗略估算：每100字符增加20px高度
    const textHeight = Math.ceil(contentLength / 100) * 20
    const imageHeight = hasImage ? 320 : 0
    
    // 缓存计算结果
    const height = baseHeight + textHeight + imageHeight
    itemHeights.current[index] = height
    
    return height
  }, [messages, loadingMore])
  
  // 加载更多历史消息
  const handleLoadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !onLoadMore) return
    
    setLoadingMore(true)
    try {
      await onLoadMore()
    } catch (error) {
      console.error('加载更多消息失败:', error)
      antMessage.error('加载历史消息失败')
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, onLoadMore])
  
  // 检查是否需要加载更多
  const isItemLoaded = useCallback((index) => {
    return !hasMore || index > 0
  }, [hasMore])
  
  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    if (listRef.current) {
      const itemCount = loadingMore ? messages.length + 1 : messages.length
      listRef.current.scrollToItem(itemCount - 1, 'end')
    }
  }, [messages.length, loadingMore])
  
  // 暴露方法给父组件
  React.useImperativeHandle(ref, () => ({
    scrollToBottom,
    scrollToTop: () => {
      if (listRef.current) {
        listRef.current.scrollToItem(0, 'start')
      }
    },
    getListRef: () => listRef.current
  }))
  
  // 当有新消息或流式输出时自动滚动
  useEffect(() => {
    if (isStreaming || typing) {
      scrollToBottom()
    }
  }, [messages.length, isStreaming, typing, scrollToBottom])
  
  // 处理滚动事件，判断是否接近顶部需要加载更多
  const handleScroll = useCallback(({ scrollOffset }) => {
    if (scrollOffset < 200 && hasMore && !loadingMore) {
      handleLoadMore()
    }
  }, [hasMore, loadingMore, handleLoadMore])
  
  const itemCount = loadingMore ? messages.length + 1 : messages.length
  
  const itemData = {
    messages,
    user,
    currentModel,
    aiModels,
    isStreaming,
    streamingMessageId,
    onDeleteMessage,
    loadingMore
  }
  
  return (
    <div style={{ height: '100%', position: 'relative' }}>
      <List
        ref={listRef}
        height={window.innerHeight - 200} // 动态计算高度
        itemCount={itemCount}
        itemSize={getItemSize}
        itemData={itemData}
        onScroll={handleScroll}
        overscanCount={3} // 预渲染3个项目
      >
        {MessageRow}
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
    </div>
  )
})

VirtualMessageList.displayName = 'VirtualMessageList'

export default VirtualMessageList

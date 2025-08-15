/**
 * 虚拟滚动消息列表 - 优化长对话性能
 * 修复：改进高度计算逻辑，解决消息显示混乱问题
 */

import React, { useRef, useCallback, forwardRef, useImperativeHandle, useState, useEffect, useMemo } from 'react'
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

// 虚拟滚动的消息行组件
const VirtualMessageRow = React.memo(({ index, style, data }) => {
  const { 
    messages, 
    user, 
    currentModel, 
    aiModels, 
    isStreaming, 
    streamingMessageId, 
    onDeleteMessage,
    onHeightChange  // 新增：高度变化回调
  } = data
  
  const msg = messages[index]
  const rowRef = useRef(null)
  
  if (!msg) return null
  
  const isStreamingMsg = msg.id === streamingMessageId || msg.streaming
  
  // 监测实际高度并通知父组件
  useEffect(() => {
    if (rowRef.current && onHeightChange) {
      const observer = new ResizeObserver((entries) => {
        for (let entry of entries) {
          const height = entry.contentRect.height
          if (height > 0) {
            onHeightChange(index, height + 16) // 加上margin
          }
        }
      })
      
      observer.observe(rowRef.current)
      
      return () => {
        observer.disconnect()
      }
    }
  }, [index, onHeightChange])
  
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
        ref={rowRef}
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
  const [itemHeights, setItemHeights] = useState({})
  const [isScrolling, setIsScrolling] = useState(false)
  const [forceUpdate, setForceUpdate] = useState(0)
  
  // 如果没有消息，显示空状态
  if (messages.length === 0) {
    return <EmptyMessages />
  }
  
  // 改进的高度计算函数
  const getItemSize = useCallback((index) => {
    // 如果有实测高度，使用实测值
    if (itemHeights[index]) {
      return itemHeights[index]
    }
    
    const msg = messages[index]
    if (!msg) return 100
    
    // 更精确的初始高度估算
    let height = 80 // 基础高度（头像、padding等）
    
    if (msg.content) {
      // 估算文本高度
      const contentLength = msg.content.length
      
      // 基于内容类型的不同估算
      if (msg.content.includes('```')) {
        // 包含代码块，需要更多高度
        height += Math.min(contentLength * 0.5, 600)
      } else if (msg.content.includes('|') && msg.content.includes('---')) {
        // 可能包含表格
        height += Math.min(contentLength * 0.4, 500)
      } else {
        // 普通文本
        const estimatedLines = Math.ceil(contentLength / 80) // 假设每行80字符
        height += estimatedLines * 24 // 每行约24px
      }
    }
    
    // 如果有图片
    if (msg.file && msg.file.type?.startsWith('image/')) {
      height += 320
    }
    
    // 如果有文档
    if (msg.file && !msg.file.type?.startsWith('image/')) {
      height += 60
    }
    
    // 限制高度范围
    height = Math.max(100, Math.min(height, 1000))
    
    return height
  }, [messages, itemHeights])
  
  // 处理高度变化
  const handleHeightChange = useCallback((index, newHeight) => {
    setItemHeights(prev => {
      const currentHeight = prev[index]
      // 只有当高度变化超过10px时才更新，避免频繁重渲染
      if (!currentHeight || Math.abs(currentHeight - newHeight) > 10) {
        const updated = { ...prev, [index]: newHeight }
        
        // 如果是流式消息，强制列表重新计算
        const msg = messages[index]
        if (msg && (msg.streaming || msg.id === streamingMessageId)) {
          // 重置列表缓存
          if (listRef.current) {
            listRef.current.resetAfterIndex(index)
          }
        }
        
        return updated
      }
      return prev
    })
  }, [messages, streamingMessageId])
  
  // 暴露方法给父组件
  useImperativeHandle(ref, () => ({
    scrollToBottom: () => {
      if (listRef.current && messages.length > 0) {
        listRef.current.scrollToItem(messages.length - 1, 'end')
      }
    },
    scrollToTop: () => {
      if (listRef.current) {
        listRef.current.scrollToItem(0, 'start')
      }
    },
    resetHeightCache: () => {
      setItemHeights({})
      if (listRef.current) {
        listRef.current.resetAfterIndex(0)
      }
    }
  }))
  
  // 当消息内容变化时，清除对应的高度缓存
  useEffect(() => {
    const streamingMsg = messages.find(m => m.id === streamingMessageId)
    if (streamingMsg) {
      const index = messages.indexOf(streamingMsg)
      if (index >= 0 && listRef.current) {
        // 流式消息内容变化，重置该消息之后的所有高度缓存
        listRef.current.resetAfterIndex(index)
      }
    }
  }, [messages, streamingMessageId])
  
  // 当有新消息时滚动到底部
  useEffect(() => {
    if (listRef.current && !isScrolling && messages.length > 0) {
      // 延迟滚动，确保高度计算完成
      const timer = setTimeout(() => {
        if (listRef.current) {
          listRef.current.scrollToItem(messages.length - 1, 'end')
        }
      }, 100)
      
      return () => clearTimeout(timer)
    }
  }, [messages.length, isScrolling])
  
  // 流式输出时定期滚动到底部
  useEffect(() => {
    if (isStreaming && !isScrolling && listRef.current) {
      const interval = setInterval(() => {
        if (listRef.current && !isScrolling) {
          listRef.current.scrollToItem(messages.length - 1, 'end')
        }
      }, 500)
      
      return () => clearInterval(interval)
    }
  }, [isStreaming, isScrolling, messages.length])
  
  // 准备传递给行组件的数据
  const itemData = useMemo(() => ({
    messages,
    user,
    currentModel,
    aiModels,
    isStreaming,
    streamingMessageId,
    onDeleteMessage,
    onHeightChange: handleHeightChange
  }), [messages, user, currentModel, aiModels, isStreaming, streamingMessageId, onDeleteMessage, handleHeightChange])
  
  // 计算列表高度
  const listHeight = containerHeight || window.innerHeight - 250
  
  return (
    <div className="chat-messages-list" style={{ height: '100%', position: 'relative' }}>
      <List
        ref={listRef}
        height={listHeight}
        itemCount={messages.length}
        itemSize={getItemSize}
        itemData={itemData}
        width="100%"
        estimatedItemSize={150}
        overscanCount={3}
        onScroll={({ scrollDirection, scrollOffset, scrollUpdateWasRequested }) => {
          // 只有用户滚动时才设置滚动标记
          if (!scrollUpdateWasRequested) {
            // 计算是否接近底部
            let totalHeight = 0
            for (let i = 0; i < messages.length; i++) {
              totalHeight += getItemSize(i)
            }
            
            const isNearBottom = scrollOffset > totalHeight - listHeight - 100
            setIsScrolling(!isNearBottom)
          }
        }}
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
          borderRadius: '8px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
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

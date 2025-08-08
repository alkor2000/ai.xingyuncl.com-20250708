/**
 * 聊天页面 - 主界面（移动端适配版）
 * 优化：响应式布局 + 移动端单页切换
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Layout, Modal, Form, message, Spin, Drawer, Button } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { MenuOutlined, ArrowLeftOutlined, PlusOutlined } from '@ant-design/icons'
import useChatStore from '../../stores/chatStore'
import useAuthStore from '../../stores/authStore'
import MessageList from '../../components/chat/MessageList'
import VirtualMessageList from '../../components/chat/VirtualMessageList'
import apiClient from '../../utils/api'

// 导入子组件
import {
  ConversationSidebar,
  ChatHeader,
  ChatInputArea,
  ConversationSettingsDrawer,
  ConversationFormModal,
  EmptyConversation
} from '../../components/chat/new'

import './Chat.less'

// 设置全局引用供authStore使用
if (typeof window !== "undefined") {
  window.useChatStore = useChatStore;
}

const { Sider, Content } = Layout

// 简单的防抖函数
function debounce(func, wait) {
  let timeout
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout)
      func(...args)
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}

// 自定义Hook - 检测是否为移动设备
const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768)
  
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768)
    }
    
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])
  
  return isMobile
}

// 获取实际的视口高度（解决iOS Safari的100vh问题）
const useViewportHeight = () => {
  const [viewportHeight, setViewportHeight] = useState(window.innerHeight)
  
  useEffect(() => {
    const updateHeight = () => {
      // 使用window.innerHeight而不是100vh
      const vh = window.innerHeight
      setViewportHeight(vh)
      // 设置CSS变量供样式使用
      document.documentElement.style.setProperty('--vh', `${vh * 0.01}px`)
    }
    
    updateHeight()
    window.addEventListener('resize', updateHeight)
    window.addEventListener('orientationchange', updateHeight)
    
    return () => {
      window.removeEventListener('resize', updateHeight)
      window.removeEventListener('orientationchange', updateHeight)
    }
  }, [])
  
  return viewportHeight
}

const Chat = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const isMobile = useIsMobile()
  const viewportHeight = useViewportHeight()
  
  // 从store获取状态和方法
  const {
    conversations,
    conversationsLoading,
    currentConversationId,
    currentConversation,
    messages,
    messagesLoading,
    initialLoading,
    sendMessage,
    getConversations,
    selectConversation,
    createConversation,
    updateConversation,
    deleteConversation,
    deleteMessagePair,
    togglePin,
    getAIModels,
    aiModels,
    userCredits,
    getUserCredits,
    typing,
    isStreaming,
    streamingMessageId,
    stopStreaming,
    clearMessages,
  } = useChatStore()

  // 本地状态
  const [inputValue, setInputValue] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [deleteModalVisible, setDeleteModalVisible] = useState(false)
  const [deletingConversation, setDeletingConversation] = useState(null)
  const [showNewChatModal, setShowNewChatModal] = useState(false)
  const [uploadedImage, setUploadedImage] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [isSending, setIsSending] = useState(false)
  
  // 移动端专用状态
  const [mobileView, setMobileView] = useState('list') // 'list' | 'chat'
  const [mobileDrawerVisible, setMobileDrawerVisible] = useState(false)
  
  // 用户手动滚动标志
  const [userScrolled, setUserScrolled] = useState(false)
  
  const [settingsForm] = Form.useForm()
  const [newChatForm] = Form.useForm()
  
  const messagesEndRef = useRef(null)
  const messagesContainerRef = useRef(null)
  const virtualListRef = useRef(null)
  const inputRef = useRef(null)

  // 决定是否使用虚拟滚动（消息数>=50时启用）
  const useVirtualScroll = messages.length >= 50

  // 初始化
  useEffect(() => {
    getConversations(true, true)
    getAIModels()
    getUserCredits()
  }, [])

  // 移动端：选择会话后自动切换到聊天视图
  useEffect(() => {
    if (isMobile && currentConversationId) {
      setMobileView('chat')
      setMobileDrawerVisible(false)
    }
  }, [currentConversationId, isMobile])

  // 当切换虚拟滚动模式时，显示提示
  useEffect(() => {
    if (useVirtualScroll && messages.length === 50) {
      message.info('消息较多，已启用虚拟滚动优化性能', 3)
    }
  }, [useVirtualScroll, messages.length])

  // 草稿管理函数
  const saveDraft = useCallback((conversationId, content) => {
    if (content.trim() && !isSending) {
      const drafts = JSON.parse(localStorage.getItem('chatDrafts') || '{}')
      drafts[conversationId] = {
        content,
        timestamp: Date.now()
      }
      localStorage.setItem('chatDrafts', JSON.stringify(drafts))
    }
  }, [isSending])
  
  const getDraft = (conversationId) => {
    const drafts = JSON.parse(localStorage.getItem('chatDrafts') || '{}')
    return drafts[conversationId]?.content || ''
  }
  
  const clearDraft = (conversationId) => {
    const drafts = JSON.parse(localStorage.getItem('chatDrafts') || '{}')
    delete drafts[conversationId]
    localStorage.setItem('chatDrafts', JSON.stringify(drafts))
  }

  // 创建防抖的草稿保存
  const debouncedSaveDraft = useCallback(
    debounce((conversationId, content) => {
      saveDraft(conversationId, content)
    }, 1000),
    [saveDraft]
  )

  // 恢复草稿
  useEffect(() => {
    if (currentConversation && !isSending) {
      const draft = getDraft(currentConversation.id)
      if (draft && !inputValue) {
        setInputValue(draft)
      }
    }
  }, [currentConversation?.id])

  // 监听typing和isStreaming状态
  useEffect(() => {
    if (!typing && !isStreaming && currentConversation && inputRef.current && !isSending) {
      setTimeout(() => {
        if (!userScrolled && !isMobile) {
          inputRef.current?.focus()
        }
      }, 100)
    }
  }, [typing, isStreaming, currentConversation, userScrolled, isSending, isMobile])

  // 当选择对话后聚焦输入框（仅PC端）
  useEffect(() => {
    if (currentConversation && !initialLoading && inputRef.current && !isMobile) {
      setTimeout(() => {
        inputRef.current?.focus()
      }, 300)
    }
  }, [currentConversation?.id, initialLoading, isMobile])

  // 改进草稿保存逻辑
  useEffect(() => {
    if (!inputValue.trim() && currentConversation) {
      clearDraft(currentConversation.id)
      return
    }
    
    if (currentConversation && inputValue.trim() && !isSending) {
      debouncedSaveDraft(currentConversation.id, inputValue)
    }
  }, [inputValue, currentConversation?.id, isSending, debouncedSaveDraft])

  // 滚动函数（兼容两种模式）
  const scrollToBottom = useCallback((force = false) => {
    if (useVirtualScroll && virtualListRef.current) {
      // 虚拟滚动模式
      virtualListRef.current.scrollToBottom()
    } else if (messagesEndRef.current && (!userScrolled || force)) {
      // 普通滚动模式
      const behavior = isStreaming ? 'instant' : 'smooth'
      messagesEndRef.current.scrollIntoView({ 
        behavior,
        block: 'end'
      })
    }
  }, [userScrolled, isStreaming, useVirtualScroll])

  // 监听用户滚动（仅在普通模式下）
  useEffect(() => {
    if (useVirtualScroll) return
    
    const container = messagesContainerRef.current
    if (!container) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 100
      
      if (!isAtBottom && isStreaming) {
        setUserScrolled(true)
      } else if (isAtBottom) {
        setUserScrolled(false)
      }
    }

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [isStreaming, useVirtualScroll])

  // 流式输出结束时，重置用户滚动标志
  useEffect(() => {
    if (!isStreaming) {
      setUserScrolled(false)
    }
  }, [isStreaming])

  // 自动滚动到消息底部
  useEffect(() => {
    if (!userScrolled) {
      scrollToBottom()
    }
  }, [messages, typing, userScrolled, scrollToBottom])
  
  // 流式输出时降低滚动频率
  useEffect(() => {
    if (isStreaming && streamingMessageId && !userScrolled) {
      const scrollInterval = setInterval(() => {
        if (!userScrolled) {
          scrollToBottom()
        }
      }, 500)
      
      return () => clearInterval(scrollInterval)
    }
  }, [isStreaming, streamingMessageId, userScrolled, scrollToBottom])

  // 创建新对话
  const handleCreateConversation = async (values) => {
    try {
      await createConversation({
        title: values.title,
        model_name: values.model_name,
        system_prompt: values.system_prompt,
        system_prompt_id: values.system_prompt_id,
        module_combination_id: values.module_combination_id,
        context_length: values.context_length,
        ai_temperature: values.ai_temperature,
        priority: values.priority || 0
      })
      
      setShowNewChatModal(false)
      newChatForm.resetFields()
      message.success(t('chat.conversation.create.success'))
    } catch (error) {
      message.error(t('chat.conversation.create.failed'))
    }
  }

  // 快速创建对话
  const handleQuickCreateConversation = async () => {
    if (!aiModels.length) return
    
    try {
      await createConversation({
        title: t('chat.newConversation'),
        model_name: aiModels[0].name
      })
      message.success(t('chat.conversation.create.success'))
    } catch (error) {
      message.error(t('chat.conversation.create.failed'))
    }
  }

  // 移动端返回列表
  const handleMobileBack = () => {
    setMobileView('list')
    selectConversation(null)
  }

  // 编辑对话
  const handleEditConversation = (conversation) => {
    settingsForm.setFieldsValue({
      title: conversation.title,
      model_name: conversation.model_name,
      system_prompt: conversation.system_prompt,
      system_prompt_id: conversation.system_prompt_id,
      module_combination_id: conversation.module_combination_id,
      is_pinned: conversation.is_pinned,
      context_length: conversation.context_length,
      ai_temperature: conversation.ai_temperature,
      priority: conversation.priority || 0
    })
    setShowSettings(true)
  }

  // 更新对话设置
  const handleUpdateSettings = async (values) => {
    if (!currentConversation) return

    try {
      await updateConversation(currentConversation.id, values)
      setShowSettings(false)
      message.success(t('chat.conversation.update.success'))
      getConversations(true)
    } catch (error) {
      message.error(t('chat.conversation.update.failed'))
    }
  }

  // 删除对话
  const handleDeleteConversation = async () => {
    if (!deletingConversation) return

    try {
      await deleteConversation(deletingConversation.id)
      setDeleteModalVisible(false)
      setDeletingConversation(null)
      message.success(t('chat.conversation.delete.success'))
      
      if (deletingConversation.id === currentConversationId) {
        selectConversation(null)
        if (isMobile) {
          setMobileView('list')
        }
      }
      
      getConversations(true)
    } catch (error) {
      message.error(t('chat.conversation.delete.failed'))
    }
  }

  // 切换置顶
  const handleTogglePin = async (conversationId, isPinned) => {
    try {
      await togglePin(conversationId, !isPinned)
      getConversations(true)
    } catch (error) {
      message.error(t('chat.conversation.pin.failed'))
    }
  }

  // 处理模型切换
  const handleModelChange = async (model) => {
    if (!currentConversation || !model) return
    
    try {
      await updateConversation(currentConversation.id, {
        model_name: model.name
      })
      message.success(`已切换到 ${model.display_name || model.name}`)
    } catch (error) {
      message.error('切换模型失败')
    }
  }

  // 发送消息 - 优化版
  const handleSendMessage = useCallback(async () => {
    if (!inputValue.trim() && !uploadedImage) return
    if (!currentConversation) {
      message.warning(t('chat.selectConversation'))
      return
    }

    const messageContent = inputValue.trim()
    const fileInfo = uploadedImage || null
    
    setIsSending(true)
    setInputValue('')
    setUploadedImage(null)
    clearDraft(currentConversation.id)
    
    try {
      await sendMessage(messageContent, fileInfo)
      if (!isMobile) {
        setTimeout(() => {
          inputRef.current?.focus()
        }, 100)
      }
    } catch (error) {
      console.error('Send message error:', error)
      message.error(error.message || t('chat.send.failed'))
      
      setInputValue(messageContent)
      setUploadedImage(fileInfo)
      
      if (!isMobile) {
        setTimeout(() => {
          inputRef.current?.focus()
        }, 100)
      }
    } finally {
      setIsSending(false)
    }
  }, [inputValue, uploadedImage, currentConversation, sendMessage, t, isMobile])

  // 停止流式输出
  const handleStopStreaming = () => {
    stopStreaming()
    message.info(t('chat.stopGeneration') || '已停止生成')
  }

  // 删除消息对
  const handleDeleteMessage = async (aiMessageId) => {
    try {
      await deleteMessagePair(aiMessageId)
    } catch (error) {
      console.error('Delete message error:', error)
      throw error
    }
  }

  // 优化输入处理 - 使用本地状态
  const handleInputChange = useCallback((value) => {
    setInputValue(value)
  }, [])

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  // 处理图片上传
  const handleImageUpload = async (file) => {
    if (!file) return

    setUploading(true)
    const formData = new FormData()
    formData.append('image', file)

    try {
      const response = await apiClient.post('/chat/upload-image', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })

      if (response.data?.success && response.data?.data) {
        setUploadedImage(response.data.data)
        message.success(t('chat.image.upload.success'))
        if (!isMobile) {
          setTimeout(() => {
            inputRef.current?.focus()
          }, 100)
        }
      } else {
        throw new Error(response.data?.message || 'Upload failed')
      }
    } catch (error) {
      console.error('Image upload error:', error)
      message.error(t('chat.image.upload.failed'))
    } finally {
      setUploading(false)
    }
  }

  // 导出聊天记录
  const handleExportChat = () => {
    if (!messages || messages.length === 0) {
      message.warning(t('chat.export.empty'))
      return
    }

    try {
      const formatDateTime = (dateStr) => {
        const date = new Date(dateStr)
        return date.toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        })
      }

      const now = new Date()
      const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5)
      const conversationTitle = currentConversation?.title || '未命名对话'
      const fileName = `${conversationTitle}_${timestamp}.txt`

      let content = '========================================\n'
      content += `对话标题：${conversationTitle}\n`
      content += `AI模型：${currentModel?.display_name || currentConversation?.model_name}\n`
      content += `创建时间：${formatDateTime(currentConversation?.created_at)}\n`
      content += `导出时间：${formatDateTime(now)}\n`
      content += `消息数量：${messages.length}\n`
      content += '========================================\n\n'

      messages.forEach((msg, index) => {
        const role = msg.role === 'user' ? '【用户】' : '【AI助手】'
        const time = formatDateTime(msg.created_at)
        
        content += `${role} ${time}\n`
        
        if (msg.file && msg.file.original_name) {
          content += `[图片：${msg.file.original_name}]\n`
        }
        
        content += `${msg.content}\n`
        
        if (msg.role === 'assistant' && msg.tokens) {
          content += `(消耗 ${msg.tokens} tokens)\n`
        }
        
        content += '\n' + '-'.repeat(40) + '\n\n'
      })

      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)

      message.success(t('chat.export.success'))
    } catch (error) {
      console.error('Export chat error:', error)
      message.error(t('chat.export.failed'))
    }
  }

  // 清空对话
  const handleClearChat = () => {
    if (!currentConversation) return
    
    Modal.confirm({
      title: t('chat.clear.title'),
      content: t('chat.clear.confirm'),
      okText: t('button.confirm'),
      cancelText: t('button.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await clearMessages(currentConversation.id)
          message.success(t('chat.clear.success'))
          if (!isMobile) {
            setTimeout(() => {
              inputRef.current?.focus()
            }, 100)
          }
        } catch (error) {
          console.error('Clear chat error:', error)
          message.error(t('chat.clear.failed'))
        }
      }
    })
  }

  const currentModel = aiModels.find(m => m.name === currentConversation?.model_name)
  const availableModels = aiModels.filter(m => m.is_active)

  // 计算消息容器高度
  const [containerHeight, setContainerHeight] = useState(window.innerHeight - 250)
  
  useEffect(() => {
    const handleResize = () => {
      setContainerHeight(window.innerHeight - 250)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // 移动端：渲染会话列表视图（不包含输入框）
  const renderMobileListView = () => (
    <div className="mobile-conversations-view" style={{ height: viewportHeight }}>
      <div className="mobile-header">
        <h3>{t('chat.conversations')}</h3>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setShowNewChatModal(true)}
        >
          {t('chat.new')}
        </Button>
      </div>
      <div className="mobile-conversations-list">
        <ConversationSidebar
          conversations={conversations}
          conversationsLoading={conversationsLoading}
          currentConversation={null}
          userCredits={userCredits}
          aiModels={aiModels}
          onSelectConversation={selectConversation}
          onCreateConversation={() => setShowNewChatModal(true)}
          onEditConversation={handleEditConversation}
          onDeleteConversation={(conversation) => {
            setDeletingConversation(conversation)
            setDeleteModalVisible(true)
          }}
          onTogglePin={handleTogglePin}
        />
      </div>
    </div>
  )

  // 移动端：渲染聊天视图
  const renderMobileChatView = () => (
    <div className="mobile-chat-view" style={{ height: viewportHeight }}>
      {/* 移动端顶部导航 */}
      <div className="mobile-chat-header">
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={handleMobileBack}
        />
        <div className="mobile-chat-title">
          {currentConversation?.title || t('chat.newConversation')}
        </div>
        <Button
          type="text"
          icon={<MenuOutlined />}
          onClick={() => setMobileDrawerVisible(true)}
        />
      </div>

      {/* 聊天内容区域 */}
      <div className="mobile-chat-content">
        {!currentConversation ? (
          <EmptyConversation onCreateConversation={handleQuickCreateConversation} />
        ) : (
          <>
            {/* 消息列表 */}
            <div className="mobile-messages-container" ref={messagesContainerRef}>
              <MessageList
                messages={messages}
                loading={messagesLoading}
                typing={typing}
                isStreaming={isStreaming}
                currentModel={currentModel}
                aiModels={aiModels}
                user={user}
                streamingMessageId={streamingMessageId}
                messagesEndRef={messagesEndRef}
                onDeleteMessage={handleDeleteMessage}
              />
              <div ref={messagesEndRef} />
            </div>

            {/* 输入区域 - 只在聊天视图显示 */}
            <div className="mobile-input-container">
              <ChatInputArea
                ref={inputRef}
                inputValue={inputValue}
                uploadedImage={uploadedImage}
                uploading={uploading}
                typing={typing}
                isStreaming={isStreaming}
                imageUploadEnabled={currentModel?.image_upload_enabled}
                hasMessages={messages && messages.length > 0}
                currentModel={currentModel}
                availableModels={availableModels}
                disabled={!currentConversation || isSending}
                onInputChange={handleInputChange}
                onKeyPress={handleKeyPress}
                onSend={handleSendMessage}
                onStop={handleStopStreaming}
                onImageUpload={handleImageUpload}
                onRemoveImage={() => setUploadedImage(null)}
                onExportChat={handleExportChat}
                onClearChat={handleClearChat}
                onModelChange={handleModelChange}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )

  // 移动端布局
  if (isMobile) {
    return (
      <div className="chat-mobile-container">
        {initialLoading ? (
          <div className="mobile-loading">
            <Spin size="large" tip={t('status.loading')} />
          </div>
        ) : mobileView === 'list' ? (
          renderMobileListView()
        ) : (
          renderMobileChatView()
        )}

        {/* 移动端侧边抽屉（会话列表） */}
        <Drawer
          title={t('chat.conversations')}
          placement="left"
          onClose={() => setMobileDrawerVisible(false)}
          open={mobileDrawerVisible}
          width="85%"
          className="mobile-conversations-drawer"
        >
          <ConversationSidebar
            conversations={conversations}
            conversationsLoading={conversationsLoading}
            currentConversation={currentConversation}
            userCredits={userCredits}
            aiModels={aiModels}
            onSelectConversation={(id) => {
              selectConversation(id)
              setMobileDrawerVisible(false)
            }}
            onCreateConversation={() => {
              setShowNewChatModal(true)
              setMobileDrawerVisible(false)
            }}
            onEditConversation={(conversation) => {
              handleEditConversation(conversation)
              setMobileDrawerVisible(false)
            }}
            onDeleteConversation={(conversation) => {
              setDeletingConversation(conversation)
              setDeleteModalVisible(true)
              setMobileDrawerVisible(false)
            }}
            onTogglePin={handleTogglePin}
          />
        </Drawer>

        {/* 对话设置抽屉 */}
        <ConversationSettingsDrawer
          visible={showSettings}
          conversation={currentConversation}
          aiModels={aiModels}
          form={settingsForm}
          onClose={() => setShowSettings(false)}
          onSubmit={handleUpdateSettings}
        />

        {/* 新建对话弹窗 */}
        <ConversationFormModal
          visible={showNewChatModal}
          aiModels={aiModels}
          form={newChatForm}
          onCancel={() => setShowNewChatModal(false)}
          onSubmit={handleCreateConversation}
        />

        {/* 删除确认弹窗 */}
        <Modal
          open={deleteModalVisible}
          title={t('chat.conversation.delete.title')}
          onOk={handleDeleteConversation}
          onCancel={() => {
            setDeleteModalVisible(false)
            setDeletingConversation(null)
          }}
          okText={t('button.confirm')}
          cancelText={t('button.cancel')}
          okButtonProps={{ danger: true }}
        >
          <p>{t('chat.conversation.delete.confirm')}</p>
        </Modal>
      </div>
    )
  }

  // PC端布局（保持原样）
  return (
    <Layout className="chat-container">
      {/* 侧边栏 */}
      <Sider
        width={220}
        collapsed={sidebarCollapsed}
        collapsedWidth={0}
        breakpoint="xl"
        onBreakpoint={(broken) => {
          if (window.innerWidth > 1600) {
            setSidebarCollapsed(broken)
          }
        }}
        className="chat-sidebar"
        trigger={null}
      >
        <div style={{ height: '100%', overflow: 'hidden' }}>
          <ConversationSidebar
            conversations={conversations}
            conversationsLoading={conversationsLoading}
            currentConversation={currentConversation}
            userCredits={userCredits}
            aiModels={aiModels}
            onSelectConversation={selectConversation}
            onCreateConversation={() => setShowNewChatModal(true)}
            onEditConversation={handleEditConversation}
            onDeleteConversation={(conversation) => {
              setDeletingConversation(conversation)
              setDeleteModalVisible(true)
            }}
            onTogglePin={handleTogglePin}
          />
        </div>
      </Sider>

      {/* 主内容区 */}
      <Layout className="chat-main">
        <Content className="chat-content">
          {initialLoading ? (
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              height: '100%',
              flexDirection: 'column',
              gap: '16px'
            }}>
              <Spin size="large" tip={t('status.loading')} />
              <div style={{ color: '#666', fontSize: '14px' }}>
                {t('chat.loadingConversations') || '正在加载对话列表...'}
              </div>
            </div>
          ) : !currentConversation ? (
            <EmptyConversation onCreateConversation={handleQuickCreateConversation} />
          ) : (
            <>
              {/* 对话头部 */}
              <ChatHeader
                conversation={currentConversation}
                sidebarCollapsed={sidebarCollapsed}
                onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
                onOpenSettings={() => handleEditConversation(currentConversation)}
              />

              {/* 消息列表 - 智能切换虚拟滚动 */}
              {useVirtualScroll ? (
                // 虚拟滚动模式（>=50条消息）
                <div className="messages-container" style={{ height: containerHeight }}>
                  <VirtualMessageList
                    ref={virtualListRef}
                    messages={messages}
                    typing={typing}
                    isStreaming={isStreaming}
                    streamingMessageId={streamingMessageId}
                    messagesEndRef={messagesEndRef}
                    user={user}
                    currentModel={currentModel}
                    aiModels={aiModels}
                    onDeleteMessage={handleDeleteMessage}
                    containerHeight={containerHeight}
                  />
                </div>
              ) : (
                // 普通滚动模式（<50条消息）
                <div className="messages-container" ref={messagesContainerRef}>
                  <MessageList
                    messages={messages}
                    loading={messagesLoading}
                    typing={typing}
                    isStreaming={isStreaming}
                    currentModel={currentModel}
                    aiModels={aiModels}
                    user={user}
                    streamingMessageId={streamingMessageId}
                    messagesEndRef={messagesEndRef}
                    onDeleteMessage={handleDeleteMessage}
                  />
                  <div ref={messagesEndRef} />
                </div>
              )}

              {/* 输入区域 - 使用原有组件 */}
              <ChatInputArea
                ref={inputRef}
                inputValue={inputValue}
                uploadedImage={uploadedImage}
                uploading={uploading}
                typing={typing}
                isStreaming={isStreaming}
                imageUploadEnabled={currentModel?.image_upload_enabled}
                hasMessages={messages && messages.length > 0}
                currentModel={currentModel}
                availableModels={availableModels}
                disabled={!currentConversation || isSending}
                onInputChange={handleInputChange}
                onKeyPress={handleKeyPress}
                onSend={handleSendMessage}
                onStop={handleStopStreaming}
                onImageUpload={handleImageUpload}
                onRemoveImage={() => setUploadedImage(null)}
                onExportChat={handleExportChat}
                onClearChat={handleClearChat}
                onModelChange={handleModelChange}
              />
            </>
          )}
        </Content>
      </Layout>

      {/* 对话设置抽屉 */}
      <ConversationSettingsDrawer
        visible={showSettings}
        conversation={currentConversation}
        aiModels={aiModels}
        form={settingsForm}
        onClose={() => setShowSettings(false)}
        onSubmit={handleUpdateSettings}
      />

      {/* 新建对话弹窗 */}
      <ConversationFormModal
        visible={showNewChatModal}
        aiModels={aiModels}
        form={newChatForm}
        onCancel={() => setShowNewChatModal(false)}
        onSubmit={handleCreateConversation}
      />

      {/* 删除确认弹窗 */}
      <Modal
        open={deleteModalVisible}
        title={t('chat.conversation.delete.title')}
        onOk={handleDeleteConversation}
        onCancel={() => {
          setDeleteModalVisible(false)
          setDeletingConversation(null)
        }}
        okText={t('button.confirm')}
        cancelText={t('button.cancel')}
        okButtonProps={{ danger: true }}
      >
        <p>{t('chat.conversation.delete.confirm')}</p>
      </Modal>
    </Layout>
  )
}

export default Chat

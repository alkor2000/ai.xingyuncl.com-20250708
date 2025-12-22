/**
 * 聊天页面 - 主界面（移动端适配版）
 * 优化：改进滚动逻辑，解决代码块输出时的滚动冲突
 * 修复：对话名称更新和置顶功能问题
 * 修复：编辑非当前对话时配置覆盖错误的bug - 使用editingConversation状态
 * 新增：移动端返回工作台功能
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Layout, Modal, Form, message, Spin, Drawer, Button, Dropdown } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { 
  MenuOutlined, 
  ArrowLeftOutlined, 
  PlusOutlined, 
  HomeOutlined,
  SettingOutlined,
  MoreOutlined
} from '@ant-design/icons'
import useChatStore from '../../stores/chatStore'
import useAuthStore from '../../stores/authStore'
import MessageList from '../../components/chat/MessageList'
import apiClient from '../../utils/api'

// 导入子组件
import {
  ConversationSidebar,
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
      const vh = window.innerHeight
      setViewportHeight(vh)
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
  const [uploadedDocument, setUploadedDocument] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [isSending, setIsSending] = useState(false)
  
  // 🔥 新增：正在编辑的对话状态，解决编辑非当前对话时配置覆盖错误的bug
  const [editingConversation, setEditingConversation] = useState(null)
  
  // 移动端专用状态
  const [mobileView, setMobileView] = useState('list')
  const [mobileDrawerVisible, setMobileDrawerVisible] = useState(false)
  
  // 改进的滚动控制状态
  const [userScrolled, setUserScrolled] = useState(false)
  const [lastScrollTop, setLastScrollTop] = useState(0)
  
  const [settingsForm] = Form.useForm()
  const [newChatForm] = Form.useForm()
  
  const messagesEndRef = useRef(null)
  const messagesContainerRef = useRef(null)
  const inputRef = useRef(null)

  const useVirtualScroll = false

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

  // 切换对话时清空输入框和重置滚动状态
  useEffect(() => {
    setInputValue('')
    setUserScrolled(false)
    setLastScrollTop(0)
  }, [currentConversationId])

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

  // 滚动函数
  const scrollToBottom = useCallback((force = false) => {
    if (messagesEndRef.current && (!userScrolled || force)) {
      const behavior = isStreaming ? 'instant' : 'smooth'
      messagesEndRef.current.scrollIntoView({ 
        behavior,
        block: 'end'
      })
    }
  }, [userScrolled, isStreaming])

  // 改进的滚动监听逻辑
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight
      
      const isAtBottom = distanceFromBottom < 300
      
      const isScrollingUp = scrollTop < lastScrollTop
      const isScrollingDown = scrollTop > lastScrollTop
      
      if (isScrollingUp && isStreaming) {
        setUserScrolled(true)
      } 
      else if (isScrollingDown && distanceFromBottom < 50) {
        setUserScrolled(false)
      }
      
      setLastScrollTop(scrollTop)
    }

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [isStreaming, lastScrollTop])

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
  
  // 移动端返回工作台
  const handleBackToHome = () => {
    navigate('/dashboard')
  }

  // 🔥 修复：编辑对话 - 保存正在编辑的对话引用
  const handleEditConversation = (conversation) => {
    // 保存正在编辑的对话，用于后续保存时使用正确的ID
    setEditingConversation(conversation)
    
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

  // 🔥 修复：更新对话设置 - 使用editingConversation而不是currentConversation
  const handleUpdateSettings = async (values) => {
    // 使用正在编辑的对话，而不是当前选中的对话
    const targetConversation = editingConversation
    
    if (!targetConversation) {
      message.error('未找到要编辑的对话')
      return
    }

    try {
      await updateConversation(targetConversation.id, values)
      setShowSettings(false)
      setEditingConversation(null)  // 清除编辑状态
      message.success(t('chat.conversation.update.success'))
    } catch (error) {
      message.error(t('chat.conversation.update.failed'))
    }
  }

  // 🔥 修复：关闭设置弹窗时清除编辑状态
  const handleCloseSettings = () => {
    setShowSettings(false)
    setEditingConversation(null)
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
  const handleTogglePin = async (conversationId, currentPriority) => {
    try {
      const newPriority = (currentPriority > 0) ? 0 : 5
      
      await updateConversation(conversationId, {
        priority: newPriority
      })
      
      await getConversations(true)
      
      message.success(newPriority > 0 ? '已置顶' : '已取消置顶')
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

  // 发送消息
  const handleSendMessage = useCallback(async () => {
    if (!inputValue.trim() && !uploadedImage && !uploadedDocument) return
    if (!currentConversation) {
      message.warning(t('chat.selectConversation'))
      return
    }

    const messageContent = inputValue.trim()
    const fileInfo = uploadedImage || uploadedDocument || null
    
    setUserScrolled(false)
    
    setIsSending(true)
    setInputValue('')
    setUploadedImage(null)
    setUploadedDocument(null)
    
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
      if (fileInfo) {
        if (fileInfo.type?.startsWith('image/')) {
          setUploadedImage(fileInfo)
        } else {
          setUploadedDocument(fileInfo)
        }
      }
      
      if (!isMobile) {
        setTimeout(() => {
          inputRef.current?.focus()
        }, 100)
      }
    } finally {
      setIsSending(false)
    }
  }, [inputValue, uploadedImage, uploadedDocument, currentConversation, sendMessage, t, isMobile])

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

  // 输入处理
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

  // 处理文档上传
  const handleDocumentUpload = async (file) => {
    if (!file) return

    setUploading(true)
    const formData = new FormData()
    formData.append('document', file)

    try {
      const response = await apiClient.post('/chat/upload-document', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })

      if (response.data?.success && response.data?.data) {
        setUploadedDocument(response.data.data)
        message.success(t('chat.document.upload.success'))
        if (!isMobile) {
          setTimeout(() => {
            inputRef.current?.focus()
          }, 100)
        }
      } else {
        throw new Error(response.data?.message || 'Upload failed')
      }
    } catch (error) {
      console.error('Document upload error:', error)
      message.error(t('chat.document.upload.failed'))
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
          const fileType = msg.file.type?.startsWith('image/') ? '图片' : '文档'
          content += `[${fileType}：${msg.file.original_name}]\n`
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

  // 移动端聊天视图右上角下拉菜单
  const chatMenuItems = [
    {
      key: 'home',
      icon: <HomeOutlined />,
      label: '返回工作台',
      onClick: handleBackToHome
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: '对话设置',
      onClick: () => {
        if (currentConversation) {
          handleEditConversation(currentConversation)
        }
      }
    },
    {
      key: 'conversations',
      icon: <MenuOutlined />,
      label: '对话列表',
      onClick: () => setMobileDrawerVisible(true)
    }
  ]

  // 移动端：渲染会话列表视图
  const renderMobileListView = () => (
    <div className="mobile-conversations-view" style={{ height: viewportHeight }}>
      <div className="mobile-header">
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={handleBackToHome}
          style={{ marginRight: 8 }}
        />
        <h3 style={{ flex: 1, margin: 0 }}>{t('chat.conversations')}</h3>
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
          onTogglePin={(conversationId) => {
            const conv = conversations.find(c => c.id === conversationId)
            if (conv) {
              handleTogglePin(conversationId, conv.priority)
            }
          }}
        />
      </div>
    </div>
  )

  // 移动端：渲染聊天视图
  const renderMobileChatView = () => (
    <div className="mobile-chat-view" style={{ height: viewportHeight }}>
      {/* 移动端顶部导航 - 使用下拉菜单 */}
      <div className="mobile-chat-header">
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={handleMobileBack}
        />
        <div className="mobile-chat-title">
          {currentConversation?.title || t('chat.newConversation')}
        </div>
        <Dropdown
          menu={{ items: chatMenuItems }}
          trigger={['click']}
          placement="bottomRight"
        >
          <Button
            type="text"
            icon={<MoreOutlined />}
          />
        </Dropdown>
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

            {/* 输入区域 */}
            <div className="mobile-input-container">
              <ChatInputArea
                ref={inputRef}
                inputValue={inputValue}
                uploadedImage={uploadedImage}
                uploadedDocument={uploadedDocument}
                uploading={uploading}
                typing={typing}
                isStreaming={isStreaming}
                imageUploadEnabled={currentModel?.image_upload_enabled}
                documentUploadEnabled={currentModel?.document_upload_enabled}
                hasMessages={messages && messages.length > 0}
                currentModel={currentModel}
                availableModels={availableModels}
                disabled={!currentConversation || isSending}
                onInputChange={handleInputChange}
                onKeyPress={handleKeyPress}
                onSend={handleSendMessage}
                onStop={handleStopStreaming}
                onImageUpload={handleImageUpload}
                onDocumentUpload={handleDocumentUpload}
                onRemoveImage={() => setUploadedImage(null)}
                onRemoveDocument={() => setUploadedDocument(null)}
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

        {/* 移动端侧边抽屉 */}
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
            onTogglePin={(conversationId) => {
              const conv = conversations.find(c => c.id === conversationId)
              if (conv) {
                handleTogglePin(conversationId, conv.priority)
              }
            }}
          />
        </Drawer>

        {/* 🔥 修复：对话设置抽屉 - 传入editingConversation而不是currentConversation */}
        <ConversationSettingsDrawer
          visible={showSettings}
          conversation={editingConversation}
          aiModels={aiModels}
          form={settingsForm}
          onClose={handleCloseSettings}
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

  // PC端布局（保持不变）
  return (
    <Layout className="chat-container">
      <Sider
        width={220}
        collapsed={sidebarCollapsed}
        collapsedWidth={50}
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
            onTogglePin={(conversationId) => {
              const conv = conversations.find(c => c.id === conversationId)
              if (conv) {
                handleTogglePin(conversationId, conv.priority)
              }
            }}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          />
        </div>
      </Sider>

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

              <ChatInputArea
                ref={inputRef}
                inputValue={inputValue}
                uploadedImage={uploadedImage}
                uploadedDocument={uploadedDocument}
                uploading={uploading}
                typing={typing}
                isStreaming={isStreaming}
                imageUploadEnabled={currentModel?.image_upload_enabled}
                documentUploadEnabled={currentModel?.document_upload_enabled}
                hasMessages={messages && messages.length > 0}
                currentModel={currentModel}
                availableModels={availableModels}
                disabled={!currentConversation || isSending}
                onInputChange={handleInputChange}
                onKeyPress={handleKeyPress}
                onSend={handleSendMessage}
                onStop={handleStopStreaming}
                onImageUpload={handleImageUpload}
                onDocumentUpload={handleDocumentUpload}
                onRemoveImage={() => setUploadedImage(null)}
                onRemoveDocument={() => setUploadedDocument(null)}
                onExportChat={handleExportChat}
                onClearChat={handleClearChat}
                onModelChange={handleModelChange}
              />
            </>
          )}
        </Content>
      </Layout>

      {/* 🔥 修复：对话设置抽屉 - 传入editingConversation而不是currentConversation */}
      <ConversationSettingsDrawer
        visible={showSettings}
        conversation={editingConversation}
        aiModels={aiModels}
        form={settingsForm}
        onClose={handleCloseSettings}
        onSubmit={handleUpdateSettings}
      />

      <ConversationFormModal
        visible={showNewChatModal}
        aiModels={aiModels}
        form={newChatForm}
        onCancel={() => setShowNewChatModal(false)}
        onSubmit={handleCreateConversation}
      />

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

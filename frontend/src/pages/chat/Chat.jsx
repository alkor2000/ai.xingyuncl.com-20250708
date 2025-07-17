/**
 * 聊天主页面 - 重构版
 * 将原来900+行的代码拆分为6个子组件
 */

import React, { useState, useEffect, useRef } from 'react'
// 设置全局引用供authStore使用
if (typeof window !== "undefined") {
  window.useChatStore = useChatStore;
}

import { Layout, Modal, Form, message } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import useChatStore from '../../stores/chatStore'
import useAuthStore from '../../stores/authStore'
import MessageList from '../../components/chat/MessageList'

// 导入新的子组件
import {
  ConversationSidebar,
  ChatHeader,
  ChatInputArea,
  ConversationSettingsDrawer,
  ConversationFormModal,
  EmptyConversation
} from '../../components/chat/new'

import './Chat.less'

const { Sider, Content } = Layout

const Chat = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  
  const {
    conversations,
    currentConversation,
    messages,
    aiModels,
    userCredits,
    typing,
    isStreaming,
    conversationsLoading,
    messagesLoading,
    getConversations,
    createConversation,
    selectConversation,
    updateConversation,
    deleteConversation,
    sendMessage,
    stopGeneration,
    getAIModels,
    getUserCredits,
    checkCreditsForModel,
    getModelCredits,
    saveDraft,
    getDraft,
    clearDraft
  } = useChatStore()

  // 状态管理
  const [inputValue, setInputValue] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [deleteModalVisible, setDeleteModalVisible] = useState(false)
  const [deletingConversation, setDeletingConversation] = useState(null)
  const [showNewChatModal, setShowNewChatModal] = useState(false)
  const [uploadedImage, setUploadedImage] = useState(null)
  const [uploading, setUploading] = useState(false)
  
  const [settingsForm] = Form.useForm()
  const [newChatForm] = Form.useForm()
  
  const messagesEndRef = useRef(null)
  const draftTimerRef = useRef(null)

  // 初始化
  useEffect(() => {
    getConversations(true, true)
    getAIModels()
    getUserCredits()
  }, [])

  // 恢复草稿
  useEffect(() => {
    if (currentConversation) {
      const draft = getDraft(currentConversation.id)
      if (draft && !inputValue) {
        setInputValue(draft)
      }
    }
  }, [currentConversation?.id])

  // 自动保存草稿
  useEffect(() => {
    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current)
    }
    
    if (currentConversation && inputValue.trim()) {
      draftTimerRef.current = setTimeout(() => {
        saveDraft(currentConversation.id, inputValue)
      }, 1000)
    }
    
    return () => {
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current)
      }
    }
  }, [inputValue, currentConversation?.id])

  // 滚动到底部
  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  // 创建新对话
  const handleCreateConversation = async (values) => {
    try {
      await createConversation({
        title: values.title || 'New Chat',
        model_name: values.model_name,
        system_prompt: values.system_prompt,
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
    try {
      const defaultModel = aiModels.find(m => m.is_active)?.name || 'gpt-3.5-turbo'
      await createConversation({
        model_name: defaultModel
      })
      message.success(t('chat.conversation.create.success'))
    } catch (error) {
      message.error(t('chat.conversation.create.failed'))
    }
  }

  // 图片上传
  const handleImageUpload = async (file) => {
    if (file.size > 10 * 1024 * 1024) {
      message.error(t('chat.upload.size.error'))
      return false
    }
    
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      message.error(t('chat.upload.type.error'))
      return false
    }
    
    setUploading(true)
    const formData = new FormData()
    formData.append('image', file)
    
    try {
      const response = await fetch('/api/chat/upload-image', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth-storage') ? JSON.parse(localStorage.getItem('auth-storage')).state.accessToken : ''}`
        },
        body: formData
      })
      
      const result = await response.json()
      
      if (result.success) {
        setUploadedImage(result.data)
        message.success(t('chat.upload.success'))
      } else {
        message.error(result.message || t('chat.upload.failed'))
      }
    } catch (error) {
      console.error('图片上传失败:', error)
      message.error(t('chat.upload.failed'))
    } finally {
      setUploading(false)
    }
    
    return false
  }

  // 发送消息
  const handleSendMessage = async () => {
    if (!currentConversation) {
      message.warning(t('chat.selectConversation'))
      return
    }

    const trimmedValue = inputValue.trim()
    if (!trimmedValue && !uploadedImage) {
      return
    }

    // 检查积分
    const model = aiModels.find(m => m.name === currentConversation.model_name)
    const requiredCredits = model?.credits_per_chat || 10
    
    if (!checkCreditsForModel(currentConversation.model_name)) {
      Modal.confirm({
        title: t('chat.credits.insufficient.title'),
        content: t('chat.credits.insufficient.content', { 
          required: requiredCredits,
          current: userCredits?.credits_stats?.remaining || 0 
        }),
        okText: t('chat.credits.recharge'),
        cancelText: t('button.cancel'),
        onOk: () => {
          navigate('/profile')
        }
      })
      return
    }

    // 如果有图片但模型不支持
    if (uploadedImage && !model?.image_upload_enabled) {
      message.warning(t('chat.model.noImageSupport'))
      return
    }

    // 清空输入和图片
    setInputValue('')
    setUploadedImage(null)
    
    try {
      await sendMessage(trimmedValue, uploadedImage?.id)
      getUserCredits()
    } catch (error) {
      console.error('发送消息失败:', error)
      message.error(t('chat.send.failed'))
      setInputValue(trimmedValue)
    }
  }

  // 处理回车发送
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  // 更新对话设置
  const handleUpdateSettings = async (values) => {
    try {
      await updateConversation(currentConversation.id, values)
      setShowSettings(false)
      message.success(t('chat.conversation.update.success'))
    } catch (error) {
      message.error(t('chat.conversation.update.failed'))
    }
  }

  // 删除对话
  const handleDeleteConversation = async () => {
    try {
      await deleteConversation(deletingConversation.id)
      setDeleteModalVisible(false)
      setDeletingConversation(null)
      message.success(t('chat.conversation.delete.success'))
    } catch (error) {
      message.error(t('chat.conversation.delete.failed'))
    }
  }

  // 编辑对话
  const handleEditConversation = (conversation) => {
    settingsForm.setFieldsValue({
      title: conversation.title,
      model_name: conversation.model_name,
      system_prompt: conversation.system_prompt,
      context_length: conversation.context_length,
      ai_temperature: conversation.ai_temperature,
      priority: conversation.priority
    })
    setShowSettings(true)
  }

  // 固定/取消固定对话
  const handleTogglePin = async (conversationId, isPinned) => {
    try {
      await updateConversation(conversationId, { is_pinned: !isPinned })
    } catch (error) {
      message.error(t('chat.conversation.update.failed'))
    }
  }

  const currentModel = aiModels.find(m => m.name === currentConversation?.model_name)

  return (
    <Layout className="chat-container">
      {/* 侧边栏 */}
      <Sider
        width={300}
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
      </Sider>

      {/* 主内容区 */}
      <Layout className="chat-main">
        <Content className="chat-content">
          {!currentConversation ? (
            <EmptyConversation 
              onCreateConversation={handleQuickCreateConversation}
            />
          ) : (
            <>
              {/* 对话头部 */}
              <ChatHeader
                currentConversation={currentConversation}
                aiModel={currentModel}
                sidebarCollapsed={sidebarCollapsed}
                onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
                onNewConversation={() => setShowNewChatModal(true)}
                onOpenSettings={() => {
                  if (currentConversation) {
                    handleEditConversation(currentConversation)
                  }
                }}
              />

              {/* 消息列表 */}
              <div className="messages-container">
                <MessageList
                  messages={messages}
                  currentModel={currentConversation.model_name}
                  typing={typing}
                  isStreaming={isStreaming}
                />
                <div ref={messagesEndRef} />
              </div>

              {/* 输入区域 */}
              <ChatInputArea
                inputValue={inputValue}
                uploadedImage={uploadedImage}
                uploading={uploading}
                typing={typing}
                isStreaming={isStreaming}
                modelCredits={getModelCredits(currentConversation?.model_name)}
                remainingCredits={userCredits?.credits_stats?.remaining}
                imageUploadEnabled={currentModel?.image_upload_enabled}
                onInputChange={setInputValue}
                onSend={handleSendMessage}
                onStop={stopGeneration}
                onUploadImage={handleImageUpload}
                onRemoveImage={() => setUploadedImage(null)}
                onKeyPress={handleKeyPress}
              />
            </>
          )}
        </Content>
      </Layout>

      {/* 对话设置抽屉 */}
      <ConversationSettingsDrawer
        visible={showSettings}
        form={settingsForm}
        aiModels={aiModels}
        onClose={() => setShowSettings(false)}
        onSubmit={handleUpdateSettings}
      />

      {/* 删除确认弹窗 */}
      <Modal
        title={t('chat.conversation.delete.title')}
        open={deleteModalVisible}
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

      {/* 新建对话弹窗 */}
      <ConversationFormModal
        visible={showNewChatModal}
        form={newChatForm}
        aiModels={aiModels}
        onCancel={() => {
          setShowNewChatModal(false)
          newChatForm.resetFields()
        }}
        onSubmit={handleCreateConversation}
      />
    </Layout>
  )
}

export default Chat

/**
 * 聊天页面 - 主界面（移动端适配版）
 * 
 * v2.0 变更：
 *   - uploadedImage(单对象) -> uploadedImages(数组)，支持最多5张图片
 *   - handleImageUpload: 接收文件数组，批量上传后追加到 uploadedImages
 *   - handleSendMessage: 传 file_ids 数组给后端
 *   - handleRemoveImage: 接收 index 参数删除指定图片
 *   - ChatInputArea props 全部适配多图
 * 
 * v2.2 变更：
 *   - 新增上下文Token计算功能 calculateContextTokens
 *   - 实时计算系统提示词 + 万智魔方 + 历史消息 + 图片/文档的Token总量
 *   - 通过 contextTokens prop 传递给 ChatInputArea 显示
 *   - 每次消息变化、对话切换时重新计算
 * 
 * v3.0 变更：
 *   - 新增HTML画布面板：对话中AI回复含HTML代码块时，右侧自动渲染预览
 *   - PC端左右双栏布局（对话区 + 画布区），画布开关默认开启
 *   - 画布开关状态保存到 localStorage
 *   - 支持全屏预览和返回
 *   - 移动端不显示画布（仅PC端可用）
 * 
 * v3.1 修复：
 *   - 画布关闭按钮(X)只隐藏当前画布，不关闭canvasEnabled开关
 *   - 新增canvasDismissed状态，切换对话时自动重置
 *   - 工具栏的画布开关按钮才真正控制canvasEnabled
 * 
 * 修复记录：
 *   - 对话名称更新和置顶功能问题
 *   - 编辑非当前对话时配置覆盖错误 - 使用 editingConversation 状态
 *   - 移动端返回工作台功能
 *   - 滚动逻辑优化，解决代码块输出时的滚动冲突
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Layout, Modal, Form, message, Spin, Drawer, Button, Dropdown } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  MenuOutlined, ArrowLeftOutlined, PlusOutlined,
  HomeOutlined, SettingOutlined, MoreOutlined
} from '@ant-design/icons'
import useChatStore from '../../stores/chatStore'
import useAuthStore from '../../stores/authStore'
import MessageList from '../../components/chat/MessageList'
import apiClient from '../../utils/api'
import { calculateTokens } from '../../utils/tokenCalculator'

import {
  ConversationSidebar, ChatInputArea,
  ConversationSettingsDrawer, ConversationFormModal, EmptyConversation,
  HtmlCanvasPanel
} from '../../components/chat/new'

import './Chat.less'

// 设置全局引用供authStore使用
if (typeof window !== 'undefined') {
  window.useChatStore = useChatStore
}

const { Sider, Content } = Layout

// ================================================================
// 常量定义
// ================================================================

/** 每张图片估算的Token数（图片经过vision模型处理，约85 token） */
const TOKENS_PER_IMAGE = 85
/** 文档的默认Token估算（如果没有extracted_content） */
const TOKENS_PER_DOCUMENT_DEFAULT = 500
/** localStorage 中画布开关的键名 */
const CANVAS_ENABLED_KEY = 'chat_html_canvas_enabled'

// ================================================================
// 自定义Hooks
// ================================================================

/** 检测是否为移动设备 */
const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768)
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])
  return isMobile
}

/** 获取实际视口高度（解决iOS Safari的100vh问题） */
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

/**
 * v3.0: 检测消息列表中是否包含已完成的HTML代码块
 * 用于决定是否显示右侧画布面板
 * 
 * @param {Array} messages - 消息列表
 * @returns {boolean} - 是否有HTML代码块
 */
const useHasHtmlContent = (messages) => {
  return useMemo(() => {
    if (!messages || messages.length === 0) return false
    // 只检查AI助手消息中是否有完整的 ```html ... ``` 代码块
    return messages.some(msg => {
      if (msg.role !== 'assistant' || !msg.content) return false
      // 匹配已闭合的HTML代码块
      return /```(?:html|HTML)\s*\n[\s\S]*?```/.test(msg.content)
    })
  }, [messages])
}

// ================================================================
// 主组件
// ================================================================

const Chat = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const isMobile = useIsMobile()
  const viewportHeight = useViewportHeight()

  // 从store获取状态和方法
  const {
    conversations, conversationsLoading, currentConversationId, currentConversation,
    messages, messagesLoading, initialLoading, sendMessage, getConversations,
    selectConversation, createConversation, updateConversation, deleteConversation,
    deleteMessagePair, togglePin, getAIModels, aiModels, userCredits, getUserCredits,
    typing, isStreaming, streamingMessageId, stopStreaming, clearMessages,
    systemPrompts, getSystemPrompts, moduleCombinations, getModuleCombinations,
  } = useChatStore()

  // 本地状态
  const [inputValue, setInputValue] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [deleteModalVisible, setDeleteModalVisible] = useState(false)
  const [deletingConversation, setDeletingConversation] = useState(null)
  const [showNewChatModal, setShowNewChatModal] = useState(false)
  const [uploadedImages, setUploadedImages] = useState([])         // v2.0: 图片数组
  const [uploadedDocument, setUploadedDocument] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [editingConversation, setEditingConversation] = useState(null)

  // v3.0: HTML画布状态
  // 画布功能开关（全局偏好，默认开启，从localStorage读取）
  const [canvasEnabled, setCanvasEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem(CANVAS_ENABLED_KEY)
      return saved !== null ? saved === 'true' : true
    } catch {
      return true
    }
  })

  // v3.1: 画布临时关闭状态（用户点了X关闭按钮，只在当前对话有效）
  // 切换对话时自动重置为false，这样新对话的画布还会自动出现
  const [canvasDismissed, setCanvasDismissed] = useState(false)

  // 移动端专用状态
  const [mobileView, setMobileView] = useState('list')
  const [mobileDrawerVisible, setMobileDrawerVisible] = useState(false)

  // 滚动控制状态
  const [userScrolled, setUserScrolled] = useState(false)
  const [lastScrollTop, setLastScrollTop] = useState(0)

  const [settingsForm] = Form.useForm()
  const [newChatForm] = Form.useForm()
  const messagesEndRef = useRef(null)
  const messagesContainerRef = useRef(null)
  const inputRef = useRef(null)

  // v3.0: 检测当前对话消息中是否有HTML内容
  const hasHtmlContent = useHasHtmlContent(messages)
  // v3.1: 画布是否实际显示：功能开关开启 + 未被临时关闭 + 有HTML内容 + 不是移动端
  const showCanvas = canvasEnabled && !canvasDismissed && hasHtmlContent && !isMobile

  // ================================================================
  // v3.0/v3.1: 画布开关和关闭处理
  // ================================================================

  /** 切换画布开关（工具栏按钮），保存到localStorage */
  const handleToggleCanvas = useCallback(() => {
    setCanvasEnabled(prev => {
      const newValue = !prev
      try {
        localStorage.setItem(CANVAS_ENABLED_KEY, String(newValue))
      } catch {
        // localStorage不可用时静默忽略
      }
      // 如果重新开启画布，清除临时关闭状态
      if (newValue) {
        setCanvasDismissed(false)
      }
      return newValue
    })
  }, [])

  /**
   * v3.1: 关闭画布（画布面板的X按钮触发）
   * 只临时隐藏当前对话的画布，不改变canvasEnabled全局开关
   * 切换对话后画布会自动恢复显示
   */
  const handleDismissCanvas = useCallback(() => {
    setCanvasDismissed(true)
  }, [])

  // ================================================================
  // 初始化和副作用
  // ================================================================

  useEffect(() => {
    getConversations(true, true)
    getAIModels()
    getUserCredits()
    // v2.2: 加载系统提示词和模块组合列表（用于Token计算）
    getSystemPrompts()
    getModuleCombinations()
  }, [])

  // 移动端：选择会话后自动切换到聊天视图
  useEffect(() => {
    if (isMobile && currentConversationId) {
      setMobileView('chat')
      setMobileDrawerVisible(false)
    }
  }, [currentConversationId, isMobile])

  // 切换对话时清空输入、重置滚动、重置画布临时关闭状态
  useEffect(() => {
    setInputValue('')
    setUserScrolled(false)
    setLastScrollTop(0)
    // v3.1: 切换对话时重置画布临时关闭状态，让新对话的画布自动出现
    setCanvasDismissed(false)
  }, [currentConversationId])

  // 完成输入后聚焦
  useEffect(() => {
    if (!typing && !isStreaming && currentConversation && inputRef.current && !isSending) {
      setTimeout(() => {
        if (!userScrolled && !isMobile) inputRef.current?.focus()
      }, 100)
    }
  }, [typing, isStreaming, currentConversation, userScrolled, isSending, isMobile])

  useEffect(() => {
    if (currentConversation && !initialLoading && inputRef.current && !isMobile) {
      setTimeout(() => inputRef.current?.focus(), 300)
    }
  }, [currentConversation?.id, initialLoading, isMobile])

  // 滚动函数
  const scrollToBottom = useCallback((force = false) => {
    if (messagesEndRef.current && (!userScrolled || force)) {
      messagesEndRef.current.scrollIntoView({ behavior: isStreaming ? 'instant' : 'smooth', block: 'end' })
    }
  }, [userScrolled, isStreaming])

  // 滚动监听
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight
      if (scrollTop < lastScrollTop && isStreaming) setUserScrolled(true)
      else if (scrollTop > lastScrollTop && distanceFromBottom < 50) setUserScrolled(false)
      setLastScrollTop(scrollTop)
    }
    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [isStreaming, lastScrollTop])

  useEffect(() => {
    if (!userScrolled) scrollToBottom()
  }, [messages, typing, userScrolled, scrollToBottom])

  useEffect(() => {
    if (isStreaming && streamingMessageId && !userScrolled) {
      const scrollInterval = setInterval(() => { if (!userScrolled) scrollToBottom() }, 500)
      return () => clearInterval(scrollInterval)
    }
  }, [isStreaming, streamingMessageId, userScrolled, scrollToBottom])

  // ================================================================
  // v2.2: 上下文Token计算
  // ================================================================

  const contextTokens = useMemo(() => {
    if (!currentConversation) return 0

    let totalTokens = 0

    // ---- 1. 系统提示词 Token ----
    if (currentConversation.system_prompt_id && systemPrompts.length > 0) {
      const matchedPrompt = systemPrompts.find(p => p.id === currentConversation.system_prompt_id)
      if (matchedPrompt && matchedPrompt.token_count) {
        totalTokens += matchedPrompt.token_count
      }
    }
    if (currentConversation.system_prompt) {
      totalTokens += calculateTokens(currentConversation.system_prompt)
    }

    // ---- 2. 万智魔方（模块组合）Token ----
    if (currentConversation.module_combination_id && moduleCombinations.length > 0) {
      const matchedCombination = moduleCombinations.find(
        c => c.id === currentConversation.module_combination_id
      )
      if (matchedCombination && matchedCombination.estimated_tokens) {
        totalTokens += matchedCombination.estimated_tokens
      }
    }

    // ---- 3. 历史消息上下文 Token ----
    if (messages && messages.length > 0) {
      const contextLength = currentConversation.context_length || 20
      const recentMessages = messages.slice(-contextLength)

      for (const msg of recentMessages) {
        if (msg.content) {
          totalTokens += calculateTokens(msg.content)
        }

        const files = msg.files || (msg.file ? [msg.file] : [])
        for (const file of files) {
          if (file.mime_type && file.mime_type.startsWith('image/')) {
            totalTokens += TOKENS_PER_IMAGE
          } else {
            if (file.extracted_content) {
              totalTokens += calculateTokens(file.extracted_content)
            } else {
              totalTokens += TOKENS_PER_DOCUMENT_DEFAULT
            }
          }
        }
      }
    }

    return totalTokens
  }, [
    currentConversation?.id,
    currentConversation?.system_prompt_id,
    currentConversation?.system_prompt,
    currentConversation?.module_combination_id,
    currentConversation?.context_length,
    messages,
    systemPrompts,
    moduleCombinations
  ])

  // ================================================================
  // 会话操作
  // ================================================================

  const handleCreateConversation = async (values) => {
    try {
      await createConversation({
        title: values.title, model_name: values.model_name,
        system_prompt: values.system_prompt, system_prompt_id: values.system_prompt_id,
        module_combination_id: values.module_combination_id,
        context_length: values.context_length, ai_temperature: values.ai_temperature,
        priority: values.priority || 0
      })
      setShowNewChatModal(false)
      newChatForm.resetFields()
      message.success(t('chat.conversation.create.success'))
    } catch (error) {
      message.error(t('chat.conversation.create.failed'))
    }
  }

  const handleQuickCreateConversation = async () => {
    if (!aiModels.length) return
    try {
      await createConversation({ title: t('chat.newConversation'), model_name: aiModels[0].name })
      message.success(t('chat.conversation.create.success'))
    } catch (error) {
      message.error(t('chat.conversation.create.failed'))
    }
  }

  const handleMobileBack = () => { setMobileView('list'); selectConversation(null) }
  const handleBackToHome = () => navigate('/dashboard')

  const handleEditConversation = (conversation) => {
    setEditingConversation(conversation)
    settingsForm.setFieldsValue({
      title: conversation.title, model_name: conversation.model_name,
      system_prompt: conversation.system_prompt, system_prompt_id: conversation.system_prompt_id,
      module_combination_id: conversation.module_combination_id, is_pinned: conversation.is_pinned,
      context_length: conversation.context_length, ai_temperature: conversation.ai_temperature,
      priority: conversation.priority || 0
    })
    setShowSettings(true)
  }

  const handleUpdateSettings = async (values) => {
    const targetConversation = editingConversation
    if (!targetConversation) { message.error('未找到要编辑的对话'); return }
    try {
      await updateConversation(targetConversation.id, values)
      setShowSettings(false)
      setEditingConversation(null)
      message.success(t('chat.conversation.update.success'))
    } catch (error) {
      message.error(t('chat.conversation.update.failed'))
    }
  }

  const handleCloseSettings = () => { setShowSettings(false); setEditingConversation(null) }

  const handleDeleteConversation = async () => {
    if (!deletingConversation) return
    try {
      await deleteConversation(deletingConversation.id)
      setDeleteModalVisible(false); setDeletingConversation(null)
      message.success(t('chat.conversation.delete.success'))
      if (deletingConversation.id === currentConversationId) {
        selectConversation(null)
        if (isMobile) setMobileView('list')
      }
      getConversations(true)
    } catch (error) {
      message.error(t('chat.conversation.delete.failed'))
    }
  }

  const handleTogglePin = async (conversationId, currentPriority) => {
    try {
      const newPriority = (currentPriority > 0) ? 0 : 5
      await updateConversation(conversationId, { priority: newPriority })
      await getConversations(true)
      message.success(newPriority > 0 ? '已置顶' : '已取消置顶')
    } catch (error) {
      message.error(t('chat.conversation.pin.failed'))
    }
  }

  const handleModelChange = async (model) => {
    if (!currentConversation || !model) return
    try {
      await updateConversation(currentConversation.id, { model_name: model.name })
      message.success(`已切换到 ${model.display_name || model.name}`)
    } catch (error) {
      message.error('切换模型失败')
    }
  }

  // ================================================================
  // 消息发送 - v2.0: 支持多图 file_ids
  // ================================================================

  const handleSendMessage = useCallback(async () => {
    if (!inputValue.trim() && uploadedImages.length === 0 && !uploadedDocument) return
    if (!currentConversation) { message.warning(t('chat.selectConversation')); return }

    const messageContent = inputValue.trim()
    const currentImages = [...uploadedImages]
    const currentDocument = uploadedDocument

    const fileInfo = currentImages.length > 0 ? currentImages[0] : (currentDocument || null)
    const fileIds = currentImages.length > 0
      ? currentImages.map(img => img.id)
      : (currentDocument ? [currentDocument.id] : [])

    setUserScrolled(false)
    setIsSending(true)
    setInputValue('')
    setUploadedImages([])
    setUploadedDocument(null)

    try {
      await sendMessage(messageContent, fileInfo, fileIds)
      if (!isMobile) setTimeout(() => inputRef.current?.focus(), 100)
    } catch (error) {
      console.error('Send message error:', error)
      message.error(error.message || t('chat.send.failed'))
      setInputValue(messageContent)
      if (currentImages.length > 0) setUploadedImages(currentImages)
      if (currentDocument) setUploadedDocument(currentDocument)
      if (!isMobile) setTimeout(() => inputRef.current?.focus(), 100)
    } finally {
      setIsSending(false)
    }
  }, [inputValue, uploadedImages, uploadedDocument, currentConversation, sendMessage, t, isMobile])

  const handleStopStreaming = () => { stopStreaming(); message.info(t('chat.stopGeneration') || '已停止生成') }

  const handleDeleteMessage = async (aiMessageId) => {
    try { await deleteMessagePair(aiMessageId) } catch (error) { console.error('Delete message error:', error); throw error }
  }

  const handleInputChange = useCallback((value) => setInputValue(value), [])

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage() }
  }

  // ================================================================
  // v2.0: 多图上传处理
  // ================================================================

  const handleImageUpload = async (files) => {
    if (!files || files.length === 0) return

    setUploading(true)
    const formData = new FormData()

    for (const file of files) {
      formData.append('image', file)
    }

    try {
      const response = await apiClient.post('/chat/upload-image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })

      if (response.data?.success && response.data?.data) {
        const newFiles = Array.isArray(response.data.data) ? response.data.data : [response.data.data]

        setUploadedImages(prev => {
          const combined = [...prev, ...newFiles]
          return combined.slice(0, 5)
        })

        const count = newFiles.length
        message.success(
          count === 1
            ? (t('chat.image.upload.success') || '图片上传成功')
            : (t('chat.image.upload.multiSuccess') || `成功上传 ${count} 张图片`)
        )

        if (!isMobile) setTimeout(() => inputRef.current?.focus(), 100)
      } else {
        throw new Error(response.data?.message || 'Upload failed')
      }
    } catch (error) {
      console.error('Image upload error:', error)
      message.error(t('chat.image.upload.failed') || '图片上传失败')
    } finally {
      setUploading(false)
    }
  }

  const handleRemoveImage = (index) => {
    setUploadedImages(prev => prev.filter((_, i) => i !== index))
  }

  // ================================================================
  // 文档上传
  // ================================================================

  const handleDocumentUpload = async (file) => {
    if (!file) return
    setUploading(true)
    const formData = new FormData()
    formData.append('document', file)
    try {
      const response = await apiClient.post('/chat/upload-document', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      if (response.data?.success && response.data?.data) {
        setUploadedDocument(response.data.data)
        message.success(t('chat.document.upload.success'))
        if (!isMobile) setTimeout(() => inputRef.current?.focus(), 100)
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

  // ================================================================
  // 导出和清空
  // ================================================================

  const handleExportChat = () => {
    if (!messages || messages.length === 0) { message.warning(t('chat.export.empty')); return }
    try {
      const formatDateTime = (dateStr) => new Date(dateStr).toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
      })
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

      messages.forEach((msg) => {
        const role = msg.role === 'user' ? '【用户】' : '【AI助手】'
        const time = formatDateTime(msg.created_at)
        content += `${role} ${time}\n`
        if (msg.files && msg.files.length > 0) {
          msg.files.forEach(f => {
            const fileType = f.mime_type?.startsWith('image/') ? '图片' : '文档'
            content += `[${fileType}：${f.original_name}]\n`
          })
        } else if (msg.file && msg.file.original_name) {
          const fileType = msg.file.type?.startsWith('image/') || msg.file.mime_type?.startsWith('image/') ? '图片' : '文档'
          content += `[${fileType}：${msg.file.original_name}]\n`
        }
        content += `${msg.content}\n`
        if (msg.role === 'assistant' && msg.tokens) content += `(消耗 ${msg.tokens} tokens)\n`
        content += '\n' + '-'.repeat(40) + '\n\n'
      })

      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url; link.download = fileName
      document.body.appendChild(link); link.click()
      document.body.removeChild(link); window.URL.revokeObjectURL(url)
      message.success(t('chat.export.success'))
    } catch (error) {
      console.error('Export chat error:', error)
      message.error(t('chat.export.failed'))
    }
  }

  const handleClearChat = () => {
    if (!currentConversation) return
    Modal.confirm({
      title: t('chat.clear.title'), content: t('chat.clear.confirm'),
      okText: t('button.confirm'), cancelText: t('button.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await clearMessages(currentConversation.id)
          message.success(t('chat.clear.success'))
          if (!isMobile) setTimeout(() => inputRef.current?.focus(), 100)
        } catch (error) {
          message.error(t('chat.clear.failed'))
        }
      }
    })
  }

  const currentModel = aiModels.find(m => m.name === currentConversation?.model_name)
  const availableModels = aiModels.filter(m => m.is_active)

  // ================================================================
  // 构建 ChatInputArea 通用 props
  // v3.0: 新增 canvasEnabled / hasHtmlContent / onToggleCanvas props
  // ================================================================

  const inputAreaProps = {
    ref: inputRef,
    inputValue,
    uploadedImages,
    uploadedDocument,
    uploading, typing, isStreaming,
    imageUploadEnabled: currentModel?.image_upload_enabled,
    documentUploadEnabled: currentModel?.document_upload_enabled,
    hasMessages: messages && messages.length > 0,
    currentModel, availableModels,
    contextTokens,
    canvasEnabled,
    hasHtmlContent,
    onToggleCanvas: handleToggleCanvas,
    disabled: !currentConversation || isSending,
    onInputChange: handleInputChange,
    onKeyPress: handleKeyPress,
    onSend: handleSendMessage,
    onStop: handleStopStreaming,
    onImageUpload: handleImageUpload,
    onDocumentUpload: handleDocumentUpload,
    onRemoveImage: handleRemoveImage,
    onRemoveDocument: () => setUploadedDocument(null),
    onExportChat: handleExportChat,
    onClearChat: handleClearChat,
    onModelChange: handleModelChange
  }

  // ================================================================
  // 移动端菜单
  // ================================================================

  const chatMenuItems = [
    { key: 'home', icon: <HomeOutlined />, label: '返回工作台', onClick: handleBackToHome },
    { key: 'settings', icon: <SettingOutlined />, label: '对话设置', onClick: () => { if (currentConversation) handleEditConversation(currentConversation) } },
    { key: 'conversations', icon: <MenuOutlined />, label: '对话列表', onClick: () => setMobileDrawerVisible(true) }
  ]

  // ================================================================
  // 移动端渲染
  // ================================================================

  const renderMobileListView = () => (
    <div className="mobile-conversations-view" style={{ height: viewportHeight }}>
      <div className="mobile-header">
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={handleBackToHome} style={{ marginRight: 8 }} />
        <h3 style={{ flex: 1, margin: 0 }}>{t('chat.conversations')}</h3>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setShowNewChatModal(true)}>{t('chat.new')}</Button>
      </div>
      <div className="mobile-conversations-list">
        <ConversationSidebar conversations={conversations} conversationsLoading={conversationsLoading}
          currentConversation={null} userCredits={userCredits} aiModels={aiModels}
          onSelectConversation={selectConversation} onCreateConversation={() => setShowNewChatModal(true)}
          onEditConversation={handleEditConversation}
          onDeleteConversation={(c) => { setDeletingConversation(c); setDeleteModalVisible(true) }}
          onTogglePin={(id) => { const c = conversations.find(x => x.id === id); if (c) handleTogglePin(id, c.priority) }}
        />
      </div>
    </div>
  )

  const renderMobileChatView = () => (
    <div className="mobile-chat-view" style={{ height: viewportHeight }}>
      <div className="mobile-chat-header">
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={handleMobileBack} />
        <div className="mobile-chat-title">{currentConversation?.title || t('chat.newConversation')}</div>
        <Dropdown menu={{ items: chatMenuItems }} trigger={['click']} placement="bottomRight">
          <Button type="text" icon={<MoreOutlined />} />
        </Dropdown>
      </div>
      <div className="mobile-chat-content">
        {!currentConversation ? (
          <EmptyConversation onCreateConversation={handleQuickCreateConversation} />
        ) : (
          <>
            <div className="mobile-messages-container" ref={messagesContainerRef}>
              <MessageList messages={messages} loading={messagesLoading} typing={typing}
                isStreaming={isStreaming} currentModel={currentModel} aiModels={aiModels}
                user={user} streamingMessageId={streamingMessageId}
                messagesEndRef={messagesEndRef} onDeleteMessage={handleDeleteMessage} />
              <div ref={messagesEndRef} />
            </div>
            <div className="mobile-input-container">
              <ChatInputArea {...inputAreaProps} />
            </div>
          </>
        )}
      </div>
    </div>
  )

  // ================================================================
  // 移动端布局
  // ================================================================

  if (isMobile) {
    return (
      <div className="chat-mobile-container">
        {initialLoading ? (
          <div className="mobile-loading"><Spin size="large" tip={t('status.loading')} /></div>
        ) : mobileView === 'list' ? renderMobileListView() : renderMobileChatView()}

        <Drawer title={t('chat.conversations')} placement="left" onClose={() => setMobileDrawerVisible(false)}
          open={mobileDrawerVisible} width="85%" className="mobile-conversations-drawer">
          <ConversationSidebar conversations={conversations} conversationsLoading={conversationsLoading}
            currentConversation={currentConversation} userCredits={userCredits} aiModels={aiModels}
            onSelectConversation={(id) => { selectConversation(id); setMobileDrawerVisible(false) }}
            onCreateConversation={() => { setShowNewChatModal(true); setMobileDrawerVisible(false) }}
            onEditConversation={(c) => { handleEditConversation(c); setMobileDrawerVisible(false) }}
            onDeleteConversation={(c) => { setDeletingConversation(c); setDeleteModalVisible(true); setMobileDrawerVisible(false) }}
            onTogglePin={(id) => { const c = conversations.find(x => x.id === id); if (c) handleTogglePin(id, c.priority) }}
          />
        </Drawer>

        <ConversationSettingsDrawer visible={showSettings} conversation={editingConversation}
          aiModels={aiModels} form={settingsForm} onClose={handleCloseSettings} onSubmit={handleUpdateSettings} />
        <ConversationFormModal visible={showNewChatModal} aiModels={aiModels}
          form={newChatForm} onCancel={() => setShowNewChatModal(false)} onSubmit={handleCreateConversation} />
        <Modal open={deleteModalVisible} title={t('chat.conversation.delete.title')}
          onOk={handleDeleteConversation}
          onCancel={() => { setDeleteModalVisible(false); setDeletingConversation(null) }}
          okText={t('button.confirm')} cancelText={t('button.cancel')} okButtonProps={{ danger: true }}>
          <p>{t('chat.conversation.delete.confirm')}</p>
        </Modal>
      </div>
    )
  }

  // ================================================================
  // PC端布局 - v3.0: 支持左右双栏（对话区 + HTML画布）
  // ================================================================

  return (
    <Layout className="chat-container">
      <Sider width={220} collapsed={sidebarCollapsed} collapsedWidth={50} breakpoint="xl"
        onBreakpoint={(broken) => { if (window.innerWidth > 1600) setSidebarCollapsed(broken) }}
        className="chat-sidebar" trigger={null}>
        <div style={{ height: '100%', overflow: 'hidden' }}>
          <ConversationSidebar conversations={conversations} conversationsLoading={conversationsLoading}
            currentConversation={currentConversation} userCredits={userCredits} aiModels={aiModels}
            onSelectConversation={selectConversation} onCreateConversation={() => setShowNewChatModal(true)}
            onEditConversation={handleEditConversation}
            onDeleteConversation={(c) => { setDeletingConversation(c); setDeleteModalVisible(true) }}
            onTogglePin={(id) => { const c = conversations.find(x => x.id === id); if (c) handleTogglePin(id, c.priority) }}
            collapsed={sidebarCollapsed} onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          />
        </div>
      </Sider>

      {/* v3.0: 主区域改为水平双栏布局 */}
      <Layout className="chat-main">
        <div className={`chat-main-split ${showCanvas ? 'with-canvas' : ''}`}>
          {/* 左侧：对话区域 */}
          <div className="chat-conversation-area">
            <Content className="chat-content">
              {initialLoading ? (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', flexDirection: 'column', gap: '16px' }}>
                  <Spin size="large" tip={t('status.loading')} />
                  <div style={{ color: '#666', fontSize: '14px' }}>{t('chat.loadingConversations') || '正在加载对话列表...'}</div>
                </div>
              ) : !currentConversation ? (
                <EmptyConversation onCreateConversation={handleQuickCreateConversation} />
              ) : (
                <>
                  <div className="messages-container" ref={messagesContainerRef}>
                    <MessageList messages={messages} loading={messagesLoading} typing={typing}
                      isStreaming={isStreaming} currentModel={currentModel} aiModels={aiModels}
                      user={user} streamingMessageId={streamingMessageId}
                      messagesEndRef={messagesEndRef} onDeleteMessage={handleDeleteMessage} />
                    <div ref={messagesEndRef} />
                  </div>
                  <ChatInputArea {...inputAreaProps} />
                </>
              )}
            </Content>
          </div>

          {/* v3.0/v3.1: 右侧：HTML画布面板，onClose改为handleDismissCanvas */}
          {showCanvas && (
            <div className="chat-canvas-area">
              <HtmlCanvasPanel
                messages={messages}
                isStreaming={isStreaming}
                visible={showCanvas}
                onClose={handleDismissCanvas}
              />
            </div>
          )}
        </div>
      </Layout>

      <ConversationSettingsDrawer visible={showSettings} conversation={editingConversation}
        aiModels={aiModels} form={settingsForm} onClose={handleCloseSettings} onSubmit={handleUpdateSettings} />
      <ConversationFormModal visible={showNewChatModal} aiModels={aiModels}
        form={newChatForm} onCancel={() => setShowNewChatModal(false)} onSubmit={handleCreateConversation} />
      <Modal open={deleteModalVisible} title={t('chat.conversation.delete.title')}
        onOk={handleDeleteConversation}
        onCancel={() => { setDeleteModalVisible(false); setDeletingConversation(null) }}
        okText={t('button.confirm')} cancelText={t('button.cancel')} okButtonProps={{ danger: true }}>
        <p>{t('chat.conversation.delete.confirm')}</p>
      </Modal>
    </Layout>
  )
}

export default Chat

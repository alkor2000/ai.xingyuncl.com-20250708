import { create } from 'zustand'
import apiClient from '../utils/api'

const useChatStore = create((set, get) => ({
  // 🔥 状态分离 - 对话列表状态独立
  conversations: [],
  conversationsLoading: false,
  conversationsLoaded: false,
  
  // 🔥 当前对话状态独立
  currentConversationId: null,
  currentConversation: null,
  messages: [],
  messagesLoading: false,
  
  // 其他状态保持不变
  aiModels: [],
  userCredits: null,
  typing: false,
  creditsLoading: false,
  
  // 流式相关状态
  streamingMessageId: null,
  streamingContent: '',
  isStreaming: false,
  
  // 🔥 新增：存储当前活跃的非流式请求
  activeRequest: null,
  
  // 🔥 新增：草稿相关状态
  drafts: {}, // conversationId -> draft content
  draftSaving: false,
  
  // 🔥 获取会话列表 - 添加自动选择逻辑
  getConversations: async (force = false, autoSelectFirst = false) => {
    const state = get()
    
    // 如果已加载过且不是强制刷新，跳过
    if (state.conversationsLoaded && !force) {
      return state.conversations
    }
    
    set({ conversationsLoading: true })
    try {
      const response = await apiClient.get('/chat/conversations')
      const conversations = response.data.data
      
      set({ 
        conversations: conversations,
        conversationsLoading: false,
        conversationsLoaded: true
      })
      
      // 🔥 新增：如果需要自动选择且没有当前选中的对话
      if (autoSelectFirst && conversations.length > 0 && !state.currentConversationId) {
        // 选择优先级最高的对话（后端已经按优先级排序）
        const firstConversation = conversations[0]
        get().selectConversation(firstConversation.id)
      }
      
      return conversations
    } catch (error) {
      console.error('获取会话列表失败:', error)
      set({ conversationsLoading: false })
      throw error
    }
  },

  // 获取用户积分状态 - 改为按需调用，不再自动定时刷新
  getUserCredits: async () => {
    set({ creditsLoading: true })
    try {
      const response = await apiClient.get('/chat/credits')
      set({ 
        userCredits: response.data.data,
        creditsLoading: false 
      })
      return response.data.data
    } catch (error) {
      console.error('获取用户积分失败:', error)
      set({ creditsLoading: false })
    }
  },
  
  // 🔥 创建新会话 - 支持上下文数量、temperature设置和优先级
  createConversation: async (conversationData) => {
    set({ conversationsLoading: true })
    try {
      // 创建会话前确保有积分状态用于验证
      const state = get()
      if (!state.userCredits) {
        await get().getUserCredits()
      }
      
      // 创建会话后立即刷新模型列表，确保流式设置最新
      if (!state.aiModels.length) {
        await get().getAIModels()
      }
      
      const response = await apiClient.post('/chat/conversations', conversationData)
      const newConversation = response.data.data
      
      // 根据优先级插入到正确的位置
      const conversations = [...state.conversations]
      const insertIndex = conversations.findIndex(c => 
        (c.priority || 0) < (newConversation.priority || 0)
      )
      
      if (insertIndex === -1) {
        conversations.push(newConversation)
      } else {
        conversations.splice(insertIndex, 0, newConversation)
      }
      
      set({
        conversations: conversations,
        currentConversationId: newConversation.id,
        currentConversation: newConversation,
        messages: [],
        conversationsLoading: false
      })
      
      return newConversation
    } catch (error) {
      console.error('创建会话失败:', error)
      set({ conversationsLoading: false })
      throw error
    }
  },
  
  // 🔥 选择会话 - 优化为使用缓存，支持草稿恢复
  selectConversation: async (conversationId) => {
    const state = get()
    
    // 如果选择的是当前会话，跳过
    if (state.currentConversationId === conversationId && state.currentConversation) {
      return
    }
    
    set({ 
      messagesLoading: true,
      currentConversationId: conversationId
    })
    
    try {
      // 获取会话详情（可能包含草稿）
      const conversationResponse = await apiClient.get(`/chat/conversations/${conversationId}`)
      const conversation = conversationResponse.data.data
      
      // 如果有草稿，更新草稿状态
      if (conversation.draft) {
        set(state => ({
          drafts: { ...state.drafts, [conversationId]: conversation.draft }
        }))
      }
      
      // 尝试从缓存获取消息（通过API，后端会自动处理缓存）
      const messagesResponse = await apiClient.get(`/chat/conversations/${conversationId}/messages`)
      const messages = messagesResponse.data.data
      
      set({
        currentConversation: conversation,
        messages: messages,
        messagesLoading: false
      })
      
      // 选择会话后，如果没有模型列表，加载一次
      if (!state.aiModels.length) {
        get().getAIModels()
      }
      
    } catch (error) {
      console.error('获取会话失败:', error)
      set({ 
        messagesLoading: false,
        currentConversationId: null,
        currentConversation: null,
        messages: []
      })
    }
  },
  
  // 🔥 保存草稿
  saveDraft: async (conversationId, content) => {
    if (!conversationId || !content) return
    
    // 更新本地草稿状态
    set(state => ({
      drafts: { ...state.drafts, [conversationId]: content }
    }))
    
    // 保存到后端（静默，不阻塞）
    try {
      set({ draftSaving: true })
      await apiClient.post(`/chat/conversations/${conversationId}/draft`, { content })
      set({ draftSaving: false })
    } catch (error) {
      console.error('保存草稿失败:', error)
      set({ draftSaving: false })
    }
  },
  
  // 🔥 获取草稿
  getDraft: (conversationId) => {
    const state = get()
    return state.drafts[conversationId] || ''
  },
  
  // 🔥 清除草稿
  clearDraft: async (conversationId) => {
    // 清除本地草稿
    set(state => {
      const newDrafts = { ...state.drafts }
      delete newDrafts[conversationId]
      return { drafts: newDrafts }
    })
    
    // 清除后端草稿（静默）
    try {
      await apiClient.delete(`/chat/conversations/${conversationId}/draft`)
    } catch (error) {
      console.error('清除草稿失败:', error)
    }
  },
  
  // 发送消息 - 支持传递完整的file对象用于临时消息显示
  sendMessage: async (content, fileInfo = null) => {
    const state = get()
    if (!state.currentConversation) return
    
    // 发送消息时清除草稿
    get().clearDraft(state.currentConversationId)
    
    // 确保有最新的模型列表
    if (!state.aiModels.length) {
      await get().getAIModels()
    }
    
    // 检查模型是否支持流式 - 修复判断逻辑
    const model = state.aiModels.find(m => m.name === state.currentConversation.model_name)
    // 🔥 关键修复：处理数字1和布尔true的情况
    const useStream = !!(model?.stream_enabled)
    
    // 添加调试日志
    console.log('发送消息调试:', {
      currentModel: state.currentConversation.model_name,
      foundModel: model,
      streamEnabled: model?.stream_enabled,
      streamEnabledType: typeof model?.stream_enabled,
      useStream
    })
    
    if (useStream) {
      // 使用流式发送
      console.log('使用流式发送')
      return get().sendStreamMessage(content, fileInfo)
    }
    
    console.log('使用非流式发送')
    set({ typing: true })
    
    // 确保有积分状态用于发送前验证
    if (!state.userCredits) {
      await get().getUserCredits()
    }
    
    // 立即添加用户消息到界面，包含file信息
    const userMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content,
      file: fileInfo, // 添加完整的file信息用于显示
      created_at: new Date().toISOString(),
      temp: true
    }
    
    set(state => ({
      messages: [...state.messages, userMessage]
    }))
    
    try {
      // 🔥 创建可取消的请求，只发送file_id给后端
      const request = apiClient.post(
        `/chat/conversations/${state.currentConversation.id}/messages`,
        { content, file_id: fileInfo?.id || null, stream: false }
      )
      
      // 保存请求引用
      set({ activeRequest: request })
      
      const response = await request
      const responseData = response.data.data
      
      // 移除临时消息，添加真实的用户消息和AI回复
      set(state => ({
        messages: [
          ...state.messages.filter(msg => !msg.temp),
          responseData.user_message,
          responseData.assistant_message
        ],
        typing: false,
        activeRequest: null
      }))
      
      // 🔥 更新积分状态 - 静默更新，不触发界面刷新
      if (responseData.credits_info) {
        set(state => ({
          userCredits: state.userCredits ? {
            ...state.userCredits,
            credits_stats: {
              ...state.userCredits.credits_stats,
              remaining: responseData.credits_info.credits_remaining,
              used: state.userCredits.credits_stats.used + responseData.credits_info.credits_consumed
            }
          } : null
        }))
      }
      
      // 🔥 更新会话信息 - 只更新对话列表中的统计，不重新加载
      if (responseData.conversation) {
        set(state => ({
          currentConversation: responseData.conversation,
          conversations: state.conversations.map(conv => 
            conv.id === responseData.conversation.id 
              ? responseData.conversation 
              : conv
          )
        }))
      }
      
      return responseData
    } catch (error) {
      // 移除临时消息
      set(state => ({
        messages: state.messages.filter(msg => !msg.temp),
        typing: false,
        activeRequest: null
      }))
      
      console.error('发送消息失败:', error)
      throw error
    }
  },
  
  // 发送流式消息 - 支持传递完整的file对象用于临时消息显示
  sendStreamMessage: async (content, fileInfo = null) => {
    const state = get()
    if (!state.currentConversation) return
    
    // 发送消息时清除草稿
    get().clearDraft(state.currentConversationId)
    
    console.log('开始流式发送消息')
    set({ typing: true, isStreaming: true, streamingContent: '' })
    
    // 确保有积分状态
    if (!state.userCredits) {
      await get().getUserCredits()
    }
    
    // 立即添加用户消息到界面（临时），包含file信息
    const tempUserMessageId = `temp-user-${Date.now()}`
    const tempUserMessage = {
      id: tempUserMessageId,
      role: 'user',
      content,
      file: fileInfo, // 添加完整的file信息用于显示
      created_at: new Date().toISOString(),
      temp: true
    }
    
    // 预创建AI消息占位（临时）
    const tempAiMessageId = `temp-ai-${Date.now()}`
    const tempAiMessage = {
      id: tempAiMessageId,
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString(),
      temp: true,
      streaming: true
    }
    
    set(state => ({
      messages: [...state.messages, tempUserMessage, tempAiMessage],
      streamingMessageId: tempAiMessageId
    }))
    
    try {
      let realUserMessage = null
      let realAiMessageId = null
      let fullContent = ''
      let isCancelled = false
      
      // 使用流式POST请求 - 只发送file_id给后端
      await apiClient.postStream(
        `/chat/conversations/${state.currentConversation.id}/messages`,
        { content, file_id: fileInfo?.id || null, stream: true },
        {
          onInit: (data) => {
            console.log('流式初始化:', data)
            // 获取真实的用户消息和AI消息ID
            realUserMessage = data.user_message
            realAiMessageId = data.ai_message_id
            
            // 更新为真实的用户消息，保留AI占位消息
            set(state => ({
              messages: state.messages.map(msg => 
                msg.id === tempUserMessageId ? realUserMessage : 
                msg.id === tempAiMessageId ? { ...msg, id: realAiMessageId } : 
                msg
              ),
              streamingMessageId: realAiMessageId
            }))
            
            // 更新积分信息
            if (data.credits_info) {
              set(state => ({
                userCredits: state.userCredits ? {
                  ...state.userCredits,
                  credits_stats: {
                    ...state.userCredits.credits_stats,
                    remaining: data.credits_info.credits_remaining
                  }
                } : null
              }))
            }
          },
          
          onMessage: (data) => {
            // 检查是否已取消
            const currentState = get()
            if (!currentState.isStreaming) {
              isCancelled = true
              return
            }
            
            console.log('收到流式片段:', data.content)
            // 累加内容
            fullContent += data.content || ''
            
            // 更新流式内容 - 实时更新消息内容
            set(state => ({
              streamingContent: fullContent,
              messages: state.messages.map(msg => 
                msg.id === realAiMessageId
                  ? { ...msg, content: fullContent, streaming: true }
                  : msg
              )
            }))
          },
          
          onComplete: (data) => {
            console.log('流式完成:', data)
            
            // 如果被取消了，显示部分内容
            if (isCancelled || data.cancelled) {
              const finalContent = fullContent || data.content || ''
              
              // 创建最终的AI消息（被中断的）
              const finalAiMessage = {
                id: realAiMessageId,
                role: 'assistant',
                content: finalContent + '\n\n[已停止生成]',
                tokens: data.tokens || 0,
                created_at: new Date().toISOString(),
                streaming: false
              }
              
              set(state => ({
                messages: state.messages.map(msg => 
                  msg.id === realAiMessageId
                    ? finalAiMessage
                    : msg
                ),
                typing: false,
                isStreaming: false,
                streamingContent: '',
                streamingMessageId: null
              }))
            } else {
              // 正常完成
              const finalAiMessage = {
                id: data.messageId || realAiMessageId,
                role: 'assistant',
                content: data.content || fullContent,
                tokens: data.tokens || 0,
                created_at: new Date().toISOString(),
                streaming: false
              }
              
              set(state => ({
                messages: state.messages.map(msg => 
                  msg.id === realAiMessageId
                    ? finalAiMessage
                    : msg
                ),
                typing: false,
                isStreaming: false,
                streamingContent: '',
                streamingMessageId: null
              }))
            }
            
            // 更新会话信息
            if (data.conversationId) {
              // 可以选择性地刷新会话信息
              // get().selectConversation(data.conversationId)
            }
          },
          
          onError: (error) => {
            console.error('流式传输错误:', error)
            
            // 移除临时消息
            set(state => ({
              messages: state.messages.filter(msg => 
                msg.id !== tempUserMessageId && 
                msg.id !== tempAiMessageId &&
                msg.id !== realAiMessageId
              ),
              typing: false,
              isStreaming: false,
              streamingContent: '',
              streamingMessageId: null
            }))
            
            throw error
          }
        }
      )
      
    } catch (error) {
      // 清理状态
      set(state => ({
        messages: state.messages.filter(msg => !msg.temp && !msg.streaming),
        typing: false,
        isStreaming: false,
        streamingContent: '',
        streamingMessageId: null
      }))
      
      console.error('流式消息发送失败:', error)
      throw error
    }
  },
  
  // 🔥 删除消息对（用户消息和AI回复）
  deleteMessagePair: async (aiMessageId) => {
    const state = get()
    if (!state.currentConversation) return
    
    try {
      // 调用后端API删除消息对
      const response = await apiClient.delete(
        `/chat/conversations/${state.currentConversation.id}/messages/${aiMessageId}`
      )
      
      const { deletedUserMessageId, deletedAiMessageId } = response.data.data
      
      // 从本地状态中移除这两条消息
      set(state => ({
        messages: state.messages.filter(msg => 
          msg.id !== deletedUserMessageId && msg.id !== deletedAiMessageId
        )
      }))
      
      // 更新会话统计（消息数量和token）
      set(state => ({
        currentConversation: {
          ...state.currentConversation,
          message_count: Math.max(0, (state.currentConversation.message_count || 0) - 2)
        }
      }))
      
      console.log('消息对删除成功', { deletedUserMessageId, deletedAiMessageId })
      return response.data.data
      
    } catch (error) {
      console.error('删除消息对失败:', error)
      throw error
    }
  },
  
  // 🔥 停止生成 - 支持流式和非流式
  stopGeneration: () => {
    console.log('停止生成')
    
    const state = get()
    
    // 如果是流式，取消流式请求
    if (state.isStreaming) {
      apiClient.cancelStream()
    }
    
    // 如果有活跃的非流式请求，取消它
    if (state.activeRequest && state.activeRequest.cancel) {
      state.activeRequest.cancel()
    }
    
    // 更新状态
    set({
      isStreaming: false,
      typing: false,
      activeRequest: null
    })
  },
  
  // 兼容旧的停止流式传输方法
  stopStreaming: () => {
    get().stopGeneration()
  },
  
  // 更新会话 - 支持上下文数量、temperature和优先级更新
  updateConversation: async (conversationId, updateData) => {
    try {
      const response = await apiClient.put(`/chat/conversations/${conversationId}`, updateData)
      const updatedConversation = response.data.data
      
      // 更新会话列表，考虑优先级变化后的排序
      const state = get()
      let conversations = state.conversations.filter(conv => conv.id !== conversationId)
      
      // 找到正确的插入位置
      const insertIndex = conversations.findIndex(c => 
        (c.priority || 0) < (updatedConversation.priority || 0)
      )
      
      if (insertIndex === -1) {
        conversations.push(updatedConversation)
      } else {
        conversations.splice(insertIndex, 0, updatedConversation)
      }
      
      set({
        conversations: conversations,
        currentConversation: state.currentConversationId === conversationId 
          ? updatedConversation 
          : state.currentConversation
      })
      
      return updatedConversation
    } catch (error) {
      console.error('更新会话失败:', error)
      throw error
    }
  },
  
  // 🔥 删除会话 - 优化状态管理
  deleteConversation: async (conversationId) => {
    try {
      await apiClient.delete(`/chat/conversations/${conversationId}`)
      
      // 清除相关草稿
      set(state => {
        const newDrafts = { ...state.drafts }
        delete newDrafts[conversationId]
        return { drafts: newDrafts }
      })
      
      set(state => ({
        conversations: state.conversations.filter(conv => conv.id !== conversationId),
        // 如果删除的是当前会话，清空当前会话状态
        currentConversationId: state.currentConversationId === conversationId ? null : state.currentConversationId,
        currentConversation: state.currentConversationId === conversationId ? null : state.currentConversation,
        messages: state.currentConversationId === conversationId ? [] : state.messages
      }))
    } catch (error) {
      console.error('删除会话失败:', error)
      throw error
    }
  },
  
  // 获取AI模型列表 - 包含积分信息
  getAIModels: async () => {
    try {
      const response = await apiClient.get('/chat/models')
      const models = response.data.data
      
      // 添加调试日志
      console.log('获取到的AI模型列表:', models)
      
      set({ aiModels: models })
      return models
    } catch (error) {
      console.error('获取AI模型列表失败:', error)
    }
  },

  // 检查积分是否充足 - 如果没有积分状态，先获取一次
  checkCreditsForModel: (modelName) => {
    const state = get()
    
    // 如果没有积分状态，可能需要获取积分状态
    if (!state.userCredits || !state.aiModels.length) {
      // 静默获取一次积分状态
      if (!state.creditsLoading) {
        get().getUserCredits().catch(() => {})
      }
      return false
    }
    
    const model = state.aiModels.find(m => m.name === modelName)
    const requiredCredits = model?.credits_per_chat || 10
    
    return state.userCredits.credits_stats.remaining >= requiredCredits
  },

  // 获取模型所需积分
  getModelCredits: (modelName) => {
    const state = get()
    const model = state.aiModels.find(m => m.name === modelName)
    return model?.credits_per_chat || 10
  },
  
  // 🔥 手动刷新会话列表 - 新增方法
  refreshConversations: async () => {
    return await get().getConversations(true)
  },
  
  // 清除当前会话
  clearCurrentConversation: () => {
    set({
      currentConversationId: null,
      currentConversation: null,
      messages: []
    })
  },
  
  // 重置store
  reset: () => {
    // 取消所有活跃的请求
    const state = get()
    if (state.activeRequest && state.activeRequest.cancel) {
      state.activeRequest.cancel()
    }
    apiClient.cancelStream()
    
    set({
      conversations: [],
      conversationsLoading: false,
      conversationsLoaded: false,
      currentConversationId: null,
      currentConversation: null,
      messages: [],
      messagesLoading: false,
      aiModels: [],
      userCredits: null,
      typing: false,
      creditsLoading: false,
      streamingMessageId: null,
      streamingContent: '',
      isStreaming: false,
      activeRequest: null,
      drafts: {},
      draftSaving: false
    })
  }
}))

export default useChatStore

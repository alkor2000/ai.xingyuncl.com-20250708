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
  
  // 🔥 获取会话列表 - 只在首次或手动刷新时调用
  getConversations: async (force = false) => {
    const state = get()
    
    // 如果已加载过且不是强制刷新，跳过
    if (state.conversationsLoaded && !force) {
      return state.conversations
    }
    
    set({ conversationsLoading: true })
    try {
      const response = await apiClient.get('/chat/conversations')
      set({ 
        conversations: response.data.data,
        conversationsLoading: false,
        conversationsLoaded: true
      })
      return response.data.data
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
  
  // 🔥 创建新会话 - 支持上下文数量和temperature设置
  createConversation: async (conversationData) => {
    set({ conversationsLoading: true })
    try {
      // 创建会话前确保有积分状态用于验证
      const state = get()
      if (!state.userCredits) {
        await get().getUserCredits()
      }
      
      const response = await apiClient.post('/chat/conversations', conversationData)
      const newConversation = response.data.data
      
      set(state => ({
        conversations: [newConversation, ...state.conversations],
        currentConversationId: newConversation.id,
        currentConversation: newConversation,
        messages: [],
        conversationsLoading: false
      }))
      
      return newConversation
    } catch (error) {
      console.error('创建会话失败:', error)
      set({ conversationsLoading: false })
      throw error
    }
  },
  
  // 🔥 选择会话 - 优化为只加载消息，不触碰对话列表
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
      // 并行加载会话详情和消息
      const [conversationResponse, messagesResponse] = await Promise.all([
        apiClient.get(`/chat/conversations/${conversationId}`),
        apiClient.get(`/chat/conversations/${conversationId}/messages`)
      ])
      
      const conversation = conversationResponse.data.data
      const messages = messagesResponse.data.data
      
      set({
        currentConversation: conversation,
        messages: messages,
        messagesLoading: false
      })
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
  
  // 发送消息 - 集成积分扣减
  sendMessage: async (content, fileId = null) => {
    if (!get().currentConversation) return
    
    set({ typing: true })
    
    // 确保有积分状态用于发送前验证
    const state = get()
    if (!state.userCredits) {
      await get().getUserCredits()
    }
    
    // 立即添加用户消息到界面
    const userMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content,
      created_at: new Date().toISOString(),
      temp: true
    }
    
    set(state => ({
      messages: [...state.messages, userMessage]
    }))
    
    try {
      const response = await apiClient.post(
        `/chat/conversations/${get().currentConversation.id}/messages`,
        { content, file_id: fileId }
      )
      
      const responseData = response.data.data
      
      // 移除临时消息，添加真实的用户消息和AI回复
      set(state => ({
        messages: [
          ...state.messages.filter(msg => !msg.temp),
          responseData.user_message,
          responseData.assistant_message
        ],
        typing: false
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
        typing: false
      }))
      
      console.error('发送消息失败:', error)
      throw error
    }
  },
  
  // 更新会话 - 支持上下文数量和temperature更新
  updateConversation: async (conversationId, updateData) => {
    try {
      const response = await apiClient.put(`/chat/conversations/${conversationId}`, updateData)
      const updatedConversation = response.data.data
      
      set(state => ({
        conversations: state.conversations.map(conv =>
          conv.id === conversationId ? updatedConversation : conv
        ),
        currentConversation: state.currentConversationId === conversationId 
          ? updatedConversation 
          : state.currentConversation
      }))
      
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
      set({ aiModels: response.data.data })
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
      creditsLoading: false
    })
  }
}))

export default useChatStore

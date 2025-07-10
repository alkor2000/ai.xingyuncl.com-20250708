import { create } from 'zustand'
import apiClient from '../utils/api'

const useChatStore = create((set, get) => ({
  // 状态
  conversations: [],
  currentConversation: null,
  messages: [],
  aiModels: [],
  userCredits: null,
  loading: false,
  typing: false,
  creditsLoading: false,
  
  // 获取会话列表
  getConversations: async () => {
    set({ loading: true })
    try {
      const response = await apiClient.get('/chat/conversations')
      set({ 
        conversations: response.data.data,
        loading: false 
      })
    } catch (error) {
      console.error('获取会话列表失败:', error)
      set({ loading: false })
    }
  },

  // 获取用户积分状态
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
  
  // 创建新会话 - 支持上下文数量和temperature设置
  createConversation: async (conversationData) => {
    set({ loading: true })
    try {
      const response = await apiClient.post('/chat/conversations', conversationData)
      const newConversation = response.data.data
      
      set(state => ({
        conversations: [newConversation, ...state.conversations],
        currentConversation: newConversation,
        messages: [],
        loading: false
      }))
      
      return newConversation
    } catch (error) {
      console.error('创建会话失败:', error)
      set({ loading: false })
      throw error
    }
  },
  
  // 选择会话
  selectConversation: async (conversationId) => {
    set({ loading: true })
    try {
      const response = await apiClient.get(`/chat/conversations/${conversationId}`)
      const conversation = response.data.data
      
      // 获取会话消息
      const messagesResponse = await apiClient.get(`/chat/conversations/${conversationId}/messages`)
      const messages = messagesResponse.data.data
      
      set({
        currentConversation: conversation,
        messages: messages,
        loading: false
      })
    } catch (error) {
      console.error('获取会话失败:', error)
      set({ loading: false })
    }
  },
  
  // 发送消息 - 集成积分扣减
  sendMessage: async (content, fileId = null) => {
    if (!get().currentConversation) return
    
    set({ typing: true })
    
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
      
      // 更新积分状态
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
      
      // 更新会话信息
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
        currentConversation: state.currentConversation?.id === conversationId 
          ? updatedConversation 
          : state.currentConversation
      }))
      
      return updatedConversation
    } catch (error) {
      console.error('更新会话失败:', error)
      throw error
    }
  },
  
  // 删除会话
  deleteConversation: async (conversationId) => {
    try {
      await apiClient.delete(`/chat/conversations/${conversationId}`)
      
      set(state => ({
        conversations: state.conversations.filter(conv => conv.id !== conversationId),
        currentConversation: state.currentConversation?.id === conversationId 
          ? null 
          : state.currentConversation,
        messages: state.currentConversation?.id === conversationId ? [] : state.messages
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

  // 检查积分是否充足
  checkCreditsForModel: (modelName) => {
    const state = get()
    if (!state.userCredits || !state.aiModels.length) return false
    
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
  
  // 清除当前会话
  clearCurrentConversation: () => {
    set({
      currentConversation: null,
      messages: []
    })
  },
  
  // 重置store
  reset: () => {
    set({
      conversations: [],
      currentConversation: null,
      messages: [],
      aiModels: [],
      userCredits: null,
      loading: false,
      typing: false,
      creditsLoading: false
    })
  }
}))

export default useChatStore

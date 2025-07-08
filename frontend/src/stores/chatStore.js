import { create } from 'zustand'
import apiClient from '../utils/api'

const useChatStore = create((set, get) => ({
  // 状态
  conversations: [],
  currentConversation: null,
  messages: [],
  aiModels: [],
  loading: false,
  typing: false,
  
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
  
  // 创建新会话
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
  
  // 发送消息
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
  
  // 更新会话
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
  
  // 获取AI模型列表
  getAIModels: async () => {
    try {
      const response = await apiClient.get('/chat/models')
      set({ aiModels: response.data.data })
    } catch (error) {
      console.error('获取AI模型列表失败:', error)
    }
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
      loading: false,
      typing: false
    })
  }
}))

export default useChatStore

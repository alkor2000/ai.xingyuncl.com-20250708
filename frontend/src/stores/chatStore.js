/**
 * 聊天状态管理 Store
 * 使用 Zustand 管理对话相关状态
 * 
 * v2.0 变更：
 *   - sendMessage: 新增第三个参数 fileIds（文件ID数组），API请求传 file_ids
 *   - sendStreamMessage: 新增第三个参数 fileIds，API请求传 file_ids
 *   - 临时消息同时设置 file（向后兼容）和 files（数组，多图渲染）
 * 
 * 修复记录：
 *   - API错误信息显示给用户
 *   - 流式超时机制
 *   - 空内容error事件处理
 */

import { create } from 'zustand'
import { message } from 'antd'
import apiClient from '../utils/api'

const useChatStore = create((set, get) => ({
  // 对话列表状态
  conversations: [],
  conversationsLoading: false,
  conversationsLoaded: false,
  initialLoading: true,
  
  // 当前对话状态
  currentConversationId: null,
  currentConversation: null,
  messages: [],
  messagesLoading: false,
  
  // 其他状态
  aiModels: [],
  systemPrompts: [],
  moduleCombinations: [],
  userCredits: null,
  creditsLoading: false,
  
  // 流式相关状态
  typing: false,
  isStreaming: false,
  streamingMessageId: null,
  streamingContent: '',
  
  // 用户主动停止标记
  userStoppedStreaming: false,
  
  // 流式超时定时器
  streamingTimeout: null,
  
  // 存储每个对话的完整状态
  conversationStates: new Map(),
  
  // 存储当前活跃的非流式请求
  activeRequest: null,
  
  // 保存对话状态（包括流式状态）
  saveConversationState: (conversationId) => {
    const state = get()
    if (!conversationId || !state.conversationStates) return
    
    const currentState = {
      messages: [...state.messages],
      typing: state.typing,
      isStreaming: state.isStreaming,
      streamingMessageId: state.streamingMessageId,
      streamingContent: state.streamingContent
    }
    
    const newStates = new Map(state.conversationStates)
    newStates.set(conversationId, currentState)
    set({ conversationStates: newStates })
  },
  
  // 恢复对话状态
  restoreConversationState: (conversationId) => {
    const state = get()
    if (!conversationId || !state.conversationStates) return null
    return state.conversationStates.get(conversationId)
  },
  
  // 更新非当前对话的状态
  updateBackgroundConversationState: (conversationId, updates) => {
    const state = get()
    if (!conversationId || !state.conversationStates) return
    
    const currentState = state.conversationStates.get(conversationId) || {
      messages: [], typing: false, isStreaming: false,
      streamingMessageId: null, streamingContent: ''
    }
    
    const newState = { ...currentState, ...updates }
    const newStates = new Map(state.conversationStates)
    newStates.set(conversationId, newState)
    set({ conversationStates: newStates })
  },
  
  // 获取会话列表
  getConversations: async (force = false, autoSelectFirst = false) => {
    const state = get()
    
    if (state.conversationsLoaded && !force) {
      if (state.initialLoading) set({ initialLoading: false })
      return state.conversations
    }
    
    set({ conversationsLoading: true })
    try {
      const response = await apiClient.get('/chat/conversations', {
        params: { limit: 500, page: 1 }
      })
      const conversations = response.data.data
      
      set({ conversations, conversationsLoading: false, conversationsLoaded: true })
      
      if (autoSelectFirst && conversations.length > 0 && !state.currentConversationId) {
        const firstConversation = conversations[0]
        await get().selectConversation(firstConversation.id)
      }
      
      set({ initialLoading: false })
      return conversations
    } catch (error) {
      console.error('获取会话列表失败:', error)
      set({ conversationsLoading: false, initialLoading: false })
      throw error
    }
  },

  // 获取用户积分状态
  getUserCredits: async () => {
    set({ creditsLoading: true })
    try {
      const response = await apiClient.get('/chat/credits')
      set({ userCredits: response.data.data, creditsLoading: false })
      return response.data.data
    } catch (error) {
      console.error('获取用户积分失败:', error)
      set({ creditsLoading: false })
    }
  },
  
  // 创建新会话
  createConversation: async (conversationData) => {
    set({ conversationsLoading: true })
    try {
      const state = get()
      if (!state.userCredits) await get().getUserCredits()
      if (!state.aiModels.length) await get().getAIModels()
      
      const response = await apiClient.post('/chat/conversations', conversationData)
      const newConversation = response.data.data
      
      const conversations = [...state.conversations]
      const insertIndex = conversations.findIndex(c => {
        if ((c.priority || 0) < (newConversation.priority || 0)) return true
        if ((c.priority || 0) === (newConversation.priority || 0)) return true
        return false
      })
      
      if (insertIndex === -1) {
        conversations.push(newConversation)
      } else {
        conversations.splice(insertIndex, 0, newConversation)
      }
      
      set({
        conversations,
        currentConversationId: newConversation.id,
        currentConversation: newConversation,
        messages: [],
        conversationsLoading: false,
        typing: false, isStreaming: false,
        streamingMessageId: null, streamingContent: '',
        userStoppedStreaming: false
      })
      
      return newConversation
    } catch (error) {
      console.error('创建会话失败:', error)
      set({ conversationsLoading: false })
      throw error
    }
  },
  
  // 选择会话
  selectConversation: async (conversationId) => {
    const state = get()
    
    if (!conversationId) {
      set({
        currentConversationId: null, currentConversation: null, messages: [],
        messagesLoading: false, typing: false, isStreaming: false,
        streamingMessageId: null, streamingContent: '', userStoppedStreaming: false
      })
      return
    }
    
    if (state.currentConversationId === conversationId && state.currentConversation) return
    
    if (state.currentConversationId) {
      state.saveConversationState(state.currentConversationId)
    }
    
    set({ messagesLoading: true, currentConversationId: conversationId })
    
    try {
      const conversationResponse = await apiClient.get(`/chat/conversations/${conversationId}`)
      const conversation = conversationResponse.data.data
      
      const savedState = state.restoreConversationState(conversationId)
      if (savedState && savedState.messages && savedState.messages.length > 0) {
        set({
          currentConversation: conversation,
          messages: savedState.messages, messagesLoading: false,
          typing: savedState.typing || false, isStreaming: savedState.isStreaming || false,
          streamingMessageId: savedState.streamingMessageId || null,
          streamingContent: savedState.streamingContent || '',
          userStoppedStreaming: false
        })
      } else {
        const messagesResponse = await apiClient.get(`/chat/conversations/${conversationId}/messages`, {
          params: { limit: 1000, page: 1 }
        })
        const messages = messagesResponse.data.data
        
        set({
          currentConversation: conversation, messages, messagesLoading: false,
          typing: false, isStreaming: false, streamingMessageId: null,
          streamingContent: '', userStoppedStreaming: false
        })
      }
      
      if (!state.aiModels.length) get().getAIModels()
    } catch (error) {
      console.error('获取会话失败:', error)
      set({ messagesLoading: false, currentConversationId: null, currentConversation: null, messages: [] })
    }
  },
  
  /**
   * 发送消息（非流式）
   * v2.0: 新增第三个参数 fileIds，支持多文件上传
   * 
   * @param {string} content - 消息文本
   * @param {Object|null} fileInfo - 第一个文件信息（用于临时消息显示，向后兼容）
   * @param {string[]} fileIds - v2.0: 文件ID数组
   */
  sendMessage: async (content, fileInfo = null, fileIds = []) => {
    const state = get()
    if (!state.currentConversation) return
    
    if (!state.aiModels.length) await get().getAIModels()
    
    const model = state.aiModels.find(m => m.name === state.currentConversation.model_name)
    const useStream = !!(model?.stream_enabled)
    
    console.log('发送消息调试:', {
      currentModel: state.currentConversation.model_name,
      foundModel: model,
      streamEnabled: model?.stream_enabled,
      useStream,
      fileCount: fileIds.length
    })
    
    if (useStream) {
      console.log('使用流式发送')
      return get().sendStreamMessage(content, fileInfo, fileIds)
    }
    
    console.log('使用非流式发送')
    set({ typing: true })
    
    if (!state.userCredits) await get().getUserCredits()
    
    // 立即添加用户消息到界面 - v2.0: 同时设置 file 和 files
    const userMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content,
      file: fileInfo,                               // 向后兼容：单个文件
      files: fileInfo ? [fileInfo] : [],             // v2.0: 文件数组（供 MessageContent 多图渲染）
      created_at: new Date().toISOString(),
      temp: true,
      model_name: state.currentConversation.model_name
    }
    
    set(state => ({ messages: [...state.messages, userMessage] }))
    
    try {
      // v2.0: API请求体传 file_ids 数组（同时保留 file_id 向后兼容）
      const requestBody = {
        content,
        file_id: fileIds.length > 0 ? fileIds[0] : (fileInfo?.id || null),
        file_ids: fileIds.length > 0 ? fileIds : (fileInfo?.id ? [fileInfo.id] : []),
        stream: false
      }
      
      const request = apiClient.post(
        `/chat/conversations/${state.currentConversation.id}/messages`,
        requestBody
      )
      
      set({ activeRequest: request })
      
      const response = await request
      const responseData = response.data.data
      
      // 移除临时消息，添加真实消息
      set(state => ({
        messages: [
          ...state.messages.filter(msg => !msg.temp),
          responseData.user_message,
          responseData.assistant_message
        ],
        typing: false,
        activeRequest: null
      }))
      
      // 更新积分
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
            conv.id === responseData.conversation.id ? responseData.conversation : conv
          )
        }))
      }
      
      return responseData
    } catch (error) {
      set(state => ({
        messages: state.messages.filter(msg => !msg.temp),
        typing: false,
        activeRequest: null
      }))
      console.error('发送消息失败:', error)
      throw error
    }
  },
  
  /**
   * 发送流式消息
   * v2.0: 新增第三个参数 fileIds，支持多文件上传
   * 
   * @param {string} content - 消息文本
   * @param {Object|null} fileInfo - 第一个文件信息（用于临时消息显示）
   * @param {string[]} fileIds - v2.0: 文件ID数组
   */
  sendStreamMessage: async (content, fileInfo = null, fileIds = []) => {
    const state = get()
    if (!state.currentConversation) return
    
    const conversationId = state.currentConversationId
    const modelName = state.currentConversation.model_name
    
    // 清除之前的超时定时器
    if (state.streamingTimeout) {
      clearTimeout(state.streamingTimeout)
      set({ streamingTimeout: null })
    }
    
    console.log('开始流式发送消息', { fileIds })
    set({ typing: true, isStreaming: true, streamingContent: '', userStoppedStreaming: false })
    
    if (!state.userCredits) await get().getUserCredits()
    
    // 立即添加用户消息到界面（临时）- v2.0: 同时设置 file 和 files
    const tempUserMessageId = `temp-user-${Date.now()}`
    const tempUserMessage = {
      id: tempUserMessageId,
      role: 'user',
      content,
      file: fileInfo,
      files: fileInfo ? [fileInfo] : [],
      created_at: new Date().toISOString(),
      temp: true,
      model_name: modelName
    }
    
    // 预创建AI消息占位（临时）
    const tempAiMessageId = `temp-ai-${Date.now()}`
    const tempAiMessage = {
      id: tempAiMessageId,
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString(),
      temp: true,
      streaming: true,
      model_name: modelName
    }
    
    set(state => ({
      messages: [...state.messages, tempUserMessage, tempAiMessage],
      streamingMessageId: tempAiMessageId
    }))
    
    // 动态超时机制
    let lastMessageTime = Date.now()
    let timeoutId = null
    
    const createTimeout = () => {
      if (timeoutId) clearTimeout(timeoutId)
      
      timeoutId = setTimeout(() => {
        const timeSinceLastMessage = Date.now() - lastMessageTime
        console.warn(`流式传输可能卡住了，${timeSinceLastMessage / 1000}秒没有新消息`)
        
        const currentState = get()
        
        if (currentState.currentConversationId === conversationId &&
            currentState.isStreaming && timeSinceLastMessage > 30000) {
          
          console.error('流式传输真的超时了，强制重置状态')
          
          set({
            typing: false, isStreaming: false, streamingContent: '',
            streamingMessageId: null, userStoppedStreaming: false, streamingTimeout: null
          })
          
          const messages = currentState.messages
          const streamingMsg = messages.find(m => m.streaming)
          if (streamingMsg && streamingMsg.content) {
            set(state => ({
              messages: state.messages.map(msg =>
                msg.id === streamingMsg.id
                  ? { ...msg, streaming: false, content: msg.content + '\n\n[响应超时]' }
                  : msg
              )
            }))
          }
        }
      }, 30000)
      
      return timeoutId
    }
    
    timeoutId = createTimeout()
    set({ streamingTimeout: timeoutId })
    
    try {
      let realUserMessage = null
      let realAiMessageId = null
      let hasCompleted = false
      
      // v2.0: API请求体传 file_ids 数组
      const requestBody = {
        content,
        file_id: fileIds.length > 0 ? fileIds[0] : (fileInfo?.id || null),
        file_ids: fileIds.length > 0 ? fileIds : (fileInfo?.id ? [fileInfo.id] : []),
        stream: true
      }
      
      await apiClient.postStream(
        `/chat/conversations/${state.currentConversation.id}/messages`,
        requestBody,
        {
          onInit: (data) => {
            console.log('流式初始化:', data)
            realUserMessage = data.user_message
            realAiMessageId = data.ai_message_id
            
            lastMessageTime = Date.now()
            
            set(state => ({
              messages: state.messages.map(msg =>
                msg.id === tempUserMessageId ? realUserMessage :
                msg.id === tempAiMessageId ? { ...msg, id: realAiMessageId, model_name: modelName } :
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
            const currentFullContent = data.fullContent || ''
            const currentState = get()
            
            lastMessageTime = Date.now()
            
            if (currentState.streamingTimeout === timeoutId) {
              timeoutId = createTimeout()
              set({ streamingTimeout: timeoutId })
            }
            
            if (currentState.userStoppedStreaming && currentState.currentConversationId === conversationId) return
            
            if (currentState.currentConversationId === conversationId) {
              set(state => ({
                streamingContent: currentFullContent,
                messages: state.messages.map(msg =>
                  msg.id === realAiMessageId
                    ? { ...msg, content: currentFullContent, streaming: true, model_name: modelName }
                    : msg
                )
              }))
            } else {
              const bgState = currentState.conversationStates.get(conversationId) || { messages: [] }
              const updatedMessages = bgState.messages.map(msg =>
                msg.id === realAiMessageId
                  ? { ...msg, content: currentFullContent, streaming: true, model_name: modelName }
                  : msg
              )
              currentState.updateBackgroundConversationState(conversationId, {
                messages: updatedMessages, isStreaming: true,
                streamingMessageId: realAiMessageId, streamingContent: currentFullContent
              })
            }
          },
          
          onComplete: (data) => {
            console.log('流式完成:', data)
            
            if (hasCompleted) { console.warn('onComplete已经调用过，忽略重复调用'); return }
            hasCompleted = true
            
            const currentState = get()
            if (timeoutId) { clearTimeout(timeoutId); set({ streamingTimeout: null }) }
            
            // 兜底stream_end且无content，忽略
            if (data.reason === 'stream_end' && !data.content) {
              console.log('兜底stream_end且无content，忽略')
              if (currentState.currentConversationId === conversationId) {
                set({ typing: false, isStreaming: false, streamingContent: '', streamingMessageId: null, userStoppedStreaming: false })
              }
              return
            }
            
            // cancelled忽略
            if (data.cancelled) {
              console.log('流式请求已取消，忽略onComplete')
              if (currentState.currentConversationId === conversationId) {
                set({ typing: false, isStreaming: false, streamingContent: '', streamingMessageId: null, userStoppedStreaming: false })
              }
              return
            }
            
            const finalContent = data.content || ''
            const wasUserStopped = currentState.userStoppedStreaming && currentState.currentConversationId === conversationId
            
            const finalAiMessage = {
              id: data.messageId || realAiMessageId,
              role: 'assistant',
              content: wasUserStopped ? finalContent + '\n\n[已停止生成]' : finalContent,
              tokens: data.tokens || 0,
              created_at: new Date().toISOString(),
              streaming: false,
              model_name: modelName
            }
            
            if (currentState.currentConversationId === conversationId) {
              set(state => ({
                messages: state.messages.map(msg => msg.id === realAiMessageId ? finalAiMessage : msg),
                typing: false, isStreaming: false, streamingContent: '',
                streamingMessageId: null, userStoppedStreaming: false
              }))
            } else {
              const bgState = currentState.conversationStates.get(conversationId) || { messages: [] }
              const updatedMessages = bgState.messages.map(msg => msg.id === realAiMessageId ? finalAiMessage : msg)
              currentState.updateBackgroundConversationState(conversationId, {
                messages: updatedMessages, typing: false, isStreaming: false,
                streamingMessageId: null, streamingContent: ''
              })
            }
          },
          
          // 错误处理 - 显示错误信息给用户
          onError: (error) => {
            console.error('流式传输错误:', error)
            
            if (timeoutId) { clearTimeout(timeoutId); set({ streamingTimeout: null }) }
            
            let errorMessage = '请求失败，请稍后重试'
            if (error && error.message) errorMessage = error.message
            let fullErrorMessage = errorMessage
            if (error && error.details) fullErrorMessage = errorMessage + '\n[详情] ' + error.details
            if (error && error.code) fullErrorMessage = fullErrorMessage + ' (HTTP ' + error.code + ')'
            
            message.error(errorMessage)
            
            const currentState = get()
            
            if (currentState.currentConversationId === conversationId) {
              const effectiveAiMessageId = realAiMessageId || tempAiMessageId
              
              set(state => ({
                messages: state.messages.map(msg => {
                  if (msg.id === tempUserMessageId) return { ...msg, temp: false }
                  if (msg.id === effectiveAiMessageId || msg.id === tempAiMessageId) {
                    return {
                      ...msg, id: effectiveAiMessageId, content: fullErrorMessage,
                      streaming: false, temp: false, error: true, model_name: modelName
                    }
                  }
                  return msg
                }),
                typing: false, isStreaming: false, streamingContent: '',
                streamingMessageId: null, userStoppedStreaming: false
              }))
            } else {
              currentState.updateBackgroundConversationState(conversationId, {
                typing: false, isStreaming: false, streamingMessageId: null, streamingContent: ''
              })
            }
          }
        }
      )
      
      // 流式传输完成后清除超时定时器
      if (timeoutId) { clearTimeout(timeoutId); set({ streamingTimeout: null }) }
      
    } catch (error) {
      const currentState = get()
      if (currentState.streamingTimeout) {
        clearTimeout(currentState.streamingTimeout)
      }
      
      let errorMessage = '消息发送失败，请稍后重试'
      if (error && error.message) errorMessage = error.message
      let fullErrorMsg = errorMessage
      if (error && error.details) fullErrorMsg = errorMessage + '\n[详情] ' + error.details
      if (error && error.code) fullErrorMsg = fullErrorMsg + ' (HTTP ' + error.code + ')'
      
      message.error(errorMessage)
      
      set(state => ({
        messages: state.messages.map(msg => {
          if (msg.id === tempUserMessageId) return { ...msg, temp: false }
          if (msg.id === tempAiMessageId) {
            return { ...msg, content: fullErrorMsg, streaming: false, temp: false, error: true, model_name: modelName }
          }
          return msg
        }).filter(msg => !msg.streaming || msg.error),
        typing: false, isStreaming: false, streamingContent: '',
        streamingMessageId: null, userStoppedStreaming: false, streamingTimeout: null
      }))
      
      console.error('流式消息发送失败:', error)
    }
  },
  
  // 删除消息对
  deleteMessagePair: async (aiMessageId) => {
    const state = get()
    if (!state.currentConversation) return
    
    try {
      const response = await apiClient.delete(
        `/chat/conversations/${state.currentConversation.id}/messages/${aiMessageId}`
      )
      
      const { deletedUserMessageId, deletedAiMessageId } = response.data.data
      
      set(state => ({
        messages: state.messages.filter(msg =>
          msg.id !== deletedUserMessageId && msg.id !== deletedAiMessageId
        )
      }))
      
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
  
  // 清空消息
  clearMessages: async (conversationId) => {
    const state = get()
    if (!conversationId || conversationId !== state.currentConversationId) return
    
    try {
      const response = await apiClient.post(`/chat/conversations/${conversationId}/clear`)
      
      set({ messages: [] })
      
      const newStates = new Map(state.conversationStates)
      newStates.delete(conversationId)
      set({ conversationStates: newStates })
      
      set(state => ({
        currentConversation: {
          ...state.currentConversation,
          message_count: 0, total_tokens: 0
        }
      }))
      
      console.log('对话已清空', { conversationId })
      return response.data.data
    } catch (error) {
      console.error('清空对话失败:', error)
      throw error
    }
  },
  
  // 停止生成
  stopGeneration: () => {
    console.log('停止生成')
    const state = get()
    
    if (state.isStreaming) {
      set({ userStoppedStreaming: true, isStreaming: false, typing: false })
      apiClient.cancelStream()
    }
    
    if (state.activeRequest && state.activeRequest.cancel) {
      state.activeRequest.cancel()
    }
    
    if (state.streamingTimeout) {
      clearTimeout(state.streamingTimeout)
      set({ streamingTimeout: null })
    }
    
    set({ typing: false, activeRequest: null })
  },
  
  // 兼容旧的停止方法
  stopStreaming: () => { get().stopGeneration() },
  
  // 更新会话
  updateConversation: async (conversationId, updateData) => {
    try {
      const response = await apiClient.put(`/chat/conversations/${conversationId}`, updateData)
      const updatedConversation = response.data.data
      
      const state = get()
      let conversations = state.conversations.filter(conv => conv.id !== conversationId)
      
      const insertIndex = conversations.findIndex(c => {
        if ((c.priority || 0) < (updatedConversation.priority || 0)) return true
        if ((c.priority || 0) === (updatedConversation.priority || 0)) {
          return new Date(c.created_at) < new Date(updatedConversation.created_at)
        }
        return false
      })
      
      if (insertIndex === -1) {
        conversations.push(updatedConversation)
      } else {
        conversations.splice(insertIndex, 0, updatedConversation)
      }
      
      set({
        conversations,
        currentConversation: state.currentConversationId === conversationId
          ? updatedConversation : state.currentConversation
      })
      
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
      
      set(state => {
        const newStates = new Map(state.conversationStates)
        newStates.delete(conversationId)
        return { conversationStates: newStates }
      })
      
      set(state => ({
        conversations: state.conversations.filter(conv => conv.id !== conversationId),
        currentConversationId: state.currentConversationId === conversationId ? null : state.currentConversationId,
        currentConversation: state.currentConversationId === conversationId ? null : state.currentConversation,
        messages: state.currentConversationId === conversationId ? [] : state.messages
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
      const models = response.data.data
      console.log('获取到的AI模型列表:', models)
      set({ aiModels: models })
      return models
    } catch (error) {
      console.error('获取AI模型列表失败:', error)
    }
  },

  // 获取系统提示词列表
  getSystemPrompts: async () => {
    try {
      const response = await apiClient.get('/chat/system-prompts')
      const prompts = response.data.data
      console.log('获取到的系统提示词列表:', prompts)
      set({ systemPrompts: prompts })
      return prompts
    } catch (error) {
      console.error('获取系统提示词列表失败:', error)
      return []
    }
  },

  // 获取模块组合列表
  getModuleCombinations: async () => {
    try {
      const response = await apiClient.get('/knowledge/combinations', {
        params: { include_inactive: false }
      })
      const combinations = response.data.data
      console.log('获取到的模块组合列表:', combinations)
      set({ moduleCombinations: combinations })
      return combinations
    } catch (error) {
      console.error('获取模块组合列表失败:', error)
      return []
    }
  },

  // 检查积分
  checkCreditsForModel: (modelName) => {
    const state = get()
    if (!state.userCredits || !state.aiModels.length) {
      if (!state.creditsLoading) get().getUserCredits().catch(() => {})
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
  
  // 手动刷新会话列表
  refreshConversations: async () => {
    return await get().getConversations(true)
  },
  
  // 清除当前会话
  clearCurrentConversation: () => {
    set({
      currentConversationId: null, currentConversation: null, messages: [],
      typing: false, isStreaming: false, streamingMessageId: null,
      streamingContent: '', userStoppedStreaming: false
    })
  },
  
  // 重置store
  reset: () => {
    const state = get()
    if (state.activeRequest && state.activeRequest.cancel) state.activeRequest.cancel()
    if (state.streamingTimeout) clearTimeout(state.streamingTimeout)
    apiClient.cancelStream()
    
    set({
      conversations: [], conversationsLoading: false, conversationsLoaded: false,
      initialLoading: true, currentConversationId: null, currentConversation: null,
      messages: [], messagesLoading: false, aiModels: [], systemPrompts: [],
      moduleCombinations: [], userCredits: null, creditsLoading: false,
      typing: false, isStreaming: false, streamingMessageId: null, streamingContent: '',
      userStoppedStreaming: false, streamingTimeout: null,
      conversationStates: new Map(), activeRequest: null
    })
  }
}))

export default useChatStore

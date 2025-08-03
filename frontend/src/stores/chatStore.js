import { create } from 'zustand'
import apiClient from '../utils/api'

const useChatStore = create((set, get) => ({
  // 🔥 状态分离 - 对话列表状态独立
  conversations: [],
  conversationsLoading: false,
  conversationsLoaded: false,
  initialLoading: true, // 🔥 新增：初始加载状态，用于解决闪烁问题
  
  // 🔥 当前对话状态独立
  currentConversationId: null,
  currentConversation: null,
  messages: [],
  messagesLoading: false,
  
  // 其他状态保持不变
  aiModels: [],
  systemPrompts: [], // 新增：系统提示词列表
  userCredits: null,
  creditsLoading: false,
  
  // 🔥 保持流式相关状态作为直接的响应式状态（当前对话的）
  typing: false,
  isStreaming: false,
  streamingMessageId: null,
  streamingContent: '',
  
  // 🔥 新增：用户主动停止的标记
  userStoppedStreaming: false,
  
  // 🔥 改进：存储每个对话的完整状态（包括流式状态）
  conversationStates: new Map(), // conversationId -> { messages, typing, isStreaming, streamingMessageId, streamingContent }
  
  // 🔥 新增：存储当前活跃的非流式请求
  activeRequest: null,
  
  // 🔥 新增：草稿相关状态
  drafts: {}, // conversationId -> draft content
  draftSaving: false,
  
  // 🔥 改进：保存对话状态（包括流式状态）
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
  
  // 🔥 改进：恢复对话状态（包括流式状态）
  restoreConversationState: (conversationId) => {
    const state = get()
    if (!conversationId || !state.conversationStates) return null
    
    return state.conversationStates.get(conversationId)
  },
  
  // 🔥 新增：更新非当前对话的状态
  updateBackgroundConversationState: (conversationId, updates) => {
    const state = get()
    if (!conversationId || !state.conversationStates) return
    
    const currentState = state.conversationStates.get(conversationId) || {
      messages: [],
      typing: false,
      isStreaming: false,
      streamingMessageId: null,
      streamingContent: ''
    }
    
    const newState = { ...currentState, ...updates }
    const newStates = new Map(state.conversationStates)
    newStates.set(conversationId, newState)
    set({ conversationStates: newStates })
  },
  
  // 🔥 获取会话列表 - 添加自动选择逻辑，增加默认limit到100
  getConversations: async (force = false, autoSelectFirst = false) => {
    const state = get()
    
    // 如果已加载过且不是强制刷新，跳过
    if (state.conversationsLoaded && !force) {
      // 即使跳过加载，也要更新initialLoading状态
      if (state.initialLoading) {
        set({ initialLoading: false })
      }
      return state.conversations
    }
    
    set({ conversationsLoading: true })
    try {
      // 🔥 修改：添加limit参数，增加到100
      const response = await apiClient.get('/chat/conversations', {
        params: {
          limit: 100,  // 增加默认获取数量到100
          page: 1
        }
      })
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
        await get().selectConversation(firstConversation.id)
      }
      
      // 🔥 更新initialLoading状态
      set({ initialLoading: false })
      
      return conversations
    } catch (error) {
      console.error('获取会话列表失败:', error)
      set({ 
        conversationsLoading: false,
        initialLoading: false // 即使失败也要更新初始加载状态
      })
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
  
  // 🔥 创建新会话 - 支持上下文数量、temperature设置、优先级和系统提示词
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
      
      // 🔥 修复：根据优先级和创建时间找到正确的插入位置
      const conversations = [...state.conversations]
      
      // 找到第一个优先级更低的位置，或者相同优先级但创建时间更早的位置
      const insertIndex = conversations.findIndex(c => {
        // 如果当前对话优先级更低，插入到它前面
        if ((c.priority || 0) < (newConversation.priority || 0)) {
          return true
        }
        // 如果优先级相同，比较创建时间（新的应该在前）
        if ((c.priority || 0) === (newConversation.priority || 0)) {
          // 新对话应该在相同优先级的最前面，所以返回true
          return true
        }
        return false
      })
      
      if (insertIndex === -1) {
        // 没有找到更低优先级的，添加到末尾
        conversations.push(newConversation)
      } else {
        conversations.splice(insertIndex, 0, newConversation)
      }
      
      set({
        conversations: conversations,
        currentConversationId: newConversation.id,
        currentConversation: newConversation,
        messages: [],
        conversationsLoading: false,
        // 重置流式状态
        typing: false,
        isStreaming: false,
        streamingMessageId: null,
        streamingContent: '',
        userStoppedStreaming: false
      })
      
      return newConversation
    } catch (error) {
      console.error('创建会话失败:', error)
      set({ conversationsLoading: false })
      throw error
    }
  },
  
  // 🔥 选择会话 - 修复：不重置流式状态，避免影响后台生成
  selectConversation: async (conversationId) => {
    const state = get()
    
    // 🔥 修复：处理null或undefined的情况
    if (!conversationId) {
      // 清空当前对话状态，不发起API请求
      set({
        currentConversationId: null,
        currentConversation: null,
        messages: [],
        messagesLoading: false,
        typing: false,
        isStreaming: false,
        streamingMessageId: null,
        streamingContent: '',
        userStoppedStreaming: false
      })
      return
    }
    
    // 如果选择的是当前会话，跳过
    if (state.currentConversationId === conversationId && state.currentConversation) {
      return
    }
    
    // 🔥 保存当前对话的完整状态（如果有）
    if (state.currentConversationId) {
      state.saveConversationState(state.currentConversationId)
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
      
      // 🔥 尝试恢复保存的完整状态
      const savedState = state.restoreConversationState(conversationId)
      if (savedState && savedState.messages && savedState.messages.length > 0) {
        // 如果有保存的状态，恢复完整状态（包括流式状态）
        set({
          currentConversation: conversation,
          messages: savedState.messages,
          messagesLoading: false,
          typing: savedState.typing || false,
          isStreaming: savedState.isStreaming || false,
          streamingMessageId: savedState.streamingMessageId || null,
          streamingContent: savedState.streamingContent || '',
          userStoppedStreaming: false // 🔥 重置用户停止标记
        })
      } else {
        // 否则从API获取消息
        const messagesResponse = await apiClient.get(`/chat/conversations/${conversationId}/messages`)
        const messages = messagesResponse.data.data
        
        set({
          currentConversation: conversation,
          messages: messages,
          messagesLoading: false,
          typing: false,
          isStreaming: false,
          streamingMessageId: null,
          streamingContent: '',
          userStoppedStreaming: false // 🔥 重置用户停止标记
        })
      }
      
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
      temp: true,
      model_name: state.currentConversation.model_name // 🔥 添加model_name
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
  
  // 🔥 发送流式消息 - 修复：添加model_name到消息
  sendStreamMessage: async (content, fileInfo = null) => {
    const state = get()
    if (!state.currentConversation) return
    
    const conversationId = state.currentConversationId
    const modelName = state.currentConversation.model_name // 🔥 保存当前模型名
    
    // 发送消息时清除草稿
    get().clearDraft(conversationId)
    
    console.log('开始流式发送消息')
    set({ typing: true, isStreaming: true, streamingContent: '', userStoppedStreaming: false })
    
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
      temp: true,
      model_name: modelName // 🔥 添加model_name
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
      model_name: modelName // 🔥 添加model_name
    }
    
    set(state => ({
      messages: [...state.messages, tempUserMessage, tempAiMessage],
      streamingMessageId: tempAiMessageId
    }))
    
    try {
      let realUserMessage = null
      let realAiMessageId = null
      // 🔥 关键修复：不再使用本地累加，直接使用后端的fullContent
      
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
                msg.id === tempAiMessageId ? { ...msg, id: realAiMessageId, model_name: modelName } : // 🔥 保留model_name
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
            // 🔥 关键修复：直接使用后端发送的完整内容
            const currentFullContent = data.fullContent || ''
            
            // 🔥 检查当前状态和对话ID
            const currentState = get()
            
            // 🔥 修复：只检查用户是否主动停止，不检查isStreaming
            if (currentState.userStoppedStreaming && currentState.currentConversationId === conversationId) {
              return
            }
            
            // 🔥 如果是当前对话，更新UI
            if (currentState.currentConversationId === conversationId) {
              set(state => ({
                streamingContent: currentFullContent,
                messages: state.messages.map(msg => 
                  msg.id === realAiMessageId
                    ? { ...msg, content: currentFullContent, streaming: true, model_name: modelName } // 🔥 使用fullContent
                    : msg
                )
              }))
            } else {
              // 🔥 如果不是当前对话，更新后台状态
              const bgState = currentState.conversationStates.get(conversationId) || { messages: [] }
              const updatedMessages = bgState.messages.map(msg => 
                msg.id === realAiMessageId
                  ? { ...msg, content: currentFullContent, streaming: true, model_name: modelName } // 🔥 使用fullContent
                  : msg
              )
              
              currentState.updateBackgroundConversationState(conversationId, {
                messages: updatedMessages,
                isStreaming: true,
                streamingMessageId: realAiMessageId,
                streamingContent: currentFullContent
              })
            }
          },
          
          onComplete: (data) => {
            console.log('流式完成:', data)
            
            const currentState = get()
            const finalContent = data.content || ''
            
            // 🔥 修复：只在用户主动停止时添加标记
            const wasUserStopped = currentState.userStoppedStreaming && currentState.currentConversationId === conversationId
            
            // 🔥 创建最终的AI消息（添加model_name）
            const finalAiMessage = {
              id: data.messageId || realAiMessageId,
              role: 'assistant',
              content: wasUserStopped ? finalContent + '\n\n[已停止生成]' : finalContent,
              tokens: data.tokens || 0,
              created_at: new Date().toISOString(),
              streaming: false,
              model_name: modelName // 🔥 关键修复：添加model_name字段
            }
            
            // 🔥 如果是当前对话，更新UI
            if (currentState.currentConversationId === conversationId) {
              set(state => ({
                messages: state.messages.map(msg => 
                  msg.id === realAiMessageId
                    ? finalAiMessage
                    : msg
                ),
                typing: false,
                isStreaming: false,
                streamingContent: '',
                streamingMessageId: null,
                userStoppedStreaming: false
              }))
            } else {
              // 🔥 如果不是当前对话，更新后台状态
              const bgState = currentState.conversationStates.get(conversationId) || { messages: [] }
              const updatedMessages = bgState.messages.map(msg => 
                msg.id === realAiMessageId
                  ? finalAiMessage
                  : msg
              )
              
              currentState.updateBackgroundConversationState(conversationId, {
                messages: updatedMessages,
                typing: false,
                isStreaming: false,
                streamingMessageId: null,
                streamingContent: ''
              })
            }
          },
          
          onError: (error) => {
            console.error('流式传输错误:', error)
            
            const currentState = get()
            
            // 🔥 清理状态（当前对话或后台对话）
            if (currentState.currentConversationId === conversationId) {
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
                streamingMessageId: null,
                userStoppedStreaming: false
              }))
            } else {
              // 更新后台状态
              currentState.updateBackgroundConversationState(conversationId, {
                typing: false,
                isStreaming: false,
                streamingMessageId: null,
                streamingContent: ''
              })
            }
            
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
        streamingMessageId: null,
        userStoppedStreaming: false
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
  
  // 🔥 清空消息 - 新增方法
  clearMessages: async (conversationId) => {
    const state = get()
    if (!conversationId || conversationId !== state.currentConversationId) return
    
    try {
      // 调用后端API清空消息
      const response = await apiClient.post(
        `/chat/conversations/${conversationId}/clear`
      )
      
      // 清空本地消息状态
      set({
        messages: []
      })
      
      // 🔥 清空保存的对话状态
      const newStates = new Map(state.conversationStates)
      newStates.delete(conversationId)
      set({ conversationStates: newStates })
      
      // 更新会话统计
      set(state => ({
        currentConversation: {
          ...state.currentConversation,
          message_count: 0,
          total_tokens: 0
        }
      }))
      
      console.log('对话已清空', { conversationId })
      return response.data.data
      
    } catch (error) {
      console.error('清空对话失败:', error)
      throw error
    }
  },
  
  // 🔥 停止生成 - 修复：设置用户主动停止标记
  stopGeneration: () => {
    console.log('停止生成')
    
    const state = get()
    
    // 🔥 标记为用户主动停止
    if (state.isStreaming) {
      set({ 
        userStoppedStreaming: true,
        isStreaming: false 
      })
      // 取消流式请求
      apiClient.cancelStream()
    }
    
    // 如果有活跃的非流式请求，取消它
    if (state.activeRequest && state.activeRequest.cancel) {
      state.activeRequest.cancel()
    }
    
    // 更新状态
    set({
      typing: false,
      activeRequest: null
    })
  },
  
  // 兼容旧的停止流式传输方法
  stopStreaming: () => {
    get().stopGeneration()
  },
  
  // 更新会话 - 支持上下文数量、temperature、优先级和系统提示词更新
  updateConversation: async (conversationId, updateData) => {
    try {
      const response = await apiClient.put(`/chat/conversations/${conversationId}`, updateData)
      const updatedConversation = response.data.data
      
      // 🔥 修复：更新会话列表，考虑优先级变化后的排序
      const state = get()
      let conversations = state.conversations.filter(conv => conv.id !== conversationId)
      
      // 找到正确的插入位置（与createConversation相同的逻辑）
      const insertIndex = conversations.findIndex(c => {
        // 如果当前对话优先级更低，插入到它前面
        if ((c.priority || 0) < (updatedConversation.priority || 0)) {
          return true
        }
        // 如果优先级相同，保持原有的创建时间顺序
        if ((c.priority || 0) === (updatedConversation.priority || 0)) {
          // 比较创建时间，更新的对话应该保持在它原来的相对位置
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
      
      // 🔥 清除保存的对话状态
      set(state => {
        const newStates = new Map(state.conversationStates)
        newStates.delete(conversationId)
        return { conversationStates: newStates }
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
  
  // 切换置顶
  togglePin: async (conversationId, isPinned) => {
    try {
      const response = await apiClient.put(`/chat/conversations/${conversationId}`, {
        is_pinned: isPinned
      })
      return response.data.data
    } catch (error) {
      console.error('切换置顶失败:', error)
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

  // 获取系统提示词列表 - 新增方法
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
      messages: [],
      typing: false,
      isStreaming: false,
      streamingMessageId: null,
      streamingContent: '',
      userStoppedStreaming: false
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
      initialLoading: true, // 🔥 重置时恢复初始加载状态
      currentConversationId: null,
      currentConversation: null,
      messages: [],
      messagesLoading: false,
      aiModels: [],
      systemPrompts: [], // 重置系统提示词
      userCredits: null,
      creditsLoading: false,
      typing: false,
      isStreaming: false,
      streamingMessageId: null,
      streamingContent: '',
      userStoppedStreaming: false,
      conversationStates: new Map(),
      activeRequest: null,
      drafts: {},
      draftSaving: false
    })
  }
}))

export default useChatStore

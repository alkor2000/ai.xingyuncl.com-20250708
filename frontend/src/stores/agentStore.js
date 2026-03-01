/**
 * Agent工作流状态管理
 * 使用 Zustand 管理工作流的CRUD、执行、历史等状态
 * v2.0 - 新增知识库集成
 * v2.1 - P0修复：执行历史响应字段名修正(data→兼容两种格式)
 */

import { create } from 'zustand'
import apiClient from '../utils/api'
import { message } from 'antd'

const useAgentStore = create((set, get) => ({
  // ========== 状态 ==========
  
  // 节点类型列表
  nodeTypes: [],
  nodeTypesLoading: false,
  
  // 用户可用模型列表
  availableModels: [],
  modelsLoading: false,
  
  // 用户可访问的知识库列表（v2.0新增）
  wikiItems: [],
  wikiItemsLoading: false,
  
  // 工作流列表
  workflows: [],
  workflowsLoading: false,
  workflowsPagination: {
    current: 1,
    pageSize: 20,
    total: 0
  },
  
  // 当前编辑的工作流
  currentWorkflow: null,
  currentWorkflowLoading: false,
  
  // 执行历史
  executions: [],
  executionsLoading: false,
  executionsPagination: {
    current: 1,
    pageSize: 20,
    total: 0
  },
  
  // 当前执行详情
  currentExecution: null,
  currentExecutionLoading: false,
  
  // 统计信息
  stats: null,
  statsLoading: false,
  
  // 测试会话状态
  testSession: null,
  testMessages: [],
  testLoading: false,
  
  // ========== 节点类型相关 ==========
  
  /**
   * 获取可用节点类型
   */
  fetchNodeTypes: async () => {
    set({ nodeTypesLoading: true })
    try {
      const response = await apiClient.get('/agent/node-types')
      if (response.data.success) {
        set({ 
          nodeTypes: response.data.data,
          nodeTypesLoading: false 
        })
      }
    } catch (error) {
      console.error('获取节点类型失败:', error)
      message.error('获取节点类型失败')
      set({ nodeTypesLoading: false })
    }
  },
  
  /**
   * 根据 type_key 获取节点类型配置
   */
  getNodeTypeByKey: (typeKey) => {
    const { nodeTypes } = get()
    return nodeTypes.find(nt => nt.type_key === typeKey)
  },
  
  // ========== 模型相关 ==========
  
  /**
   * 获取用户可用的AI模型列表
   */
  fetchAvailableModels: async () => {
    set({ modelsLoading: true })
    try {
      const response = await apiClient.get('/chat/models')
      if (response.data.success) {
        set({ 
          availableModels: response.data.data,
          modelsLoading: false 
        })
        return response.data.data
      }
    } catch (error) {
      console.error('获取可用模型失败:', error)
      message.error('获取可用模型失败')
      set({ modelsLoading: false })
      return []
    }
  },
  
  /**
   * 根据模型名称获取模型信息
   */
  getModelByName: (modelName) => {
    const { availableModels } = get()
    return availableModels.find(m => m.name === modelName)
  },
  
  // ========== 知识库相关（v2.0新增）==========
  
  /**
   * 获取用户可访问的知识库列表
   */
  fetchWikiItems: async () => {
    set({ wikiItemsLoading: true })
    try {
      const response = await apiClient.get('/agent/wiki-items')
      if (response.data.success) {
        set({ 
          wikiItems: response.data.data,
          wikiItemsLoading: false 
        })
        return response.data.data
      }
    } catch (error) {
      console.error('获取知识库列表失败:', error)
      message.error('获取知识库列表失败')
      set({ wikiItemsLoading: false })
      return []
    }
  },
  
  /**
   * 根据ID获取知识库信息
   */
  getWikiById: (wikiId) => {
    const { wikiItems } = get()
    return wikiItems.find(w => w.id === wikiId)
  },
  
  /**
   * 根据多个ID获取知识库列表
   */
  getWikisByIds: (wikiIds) => {
    const { wikiItems } = get()
    return wikiIds
      .map(id => wikiItems.find(w => w.id === id))
      .filter(Boolean)
  },
  
  // ========== 工作流列表相关 ==========
  
  /**
   * 获取工作流列表
   */
  fetchWorkflows: async (params = {}) => {
    set({ workflowsLoading: true })
    try {
      const { current = 1, pageSize = 20, is_published } = params
      
      const queryParams = new URLSearchParams({
        page: current,
        limit: pageSize
      })
      
      if (is_published !== undefined) {
        queryParams.append('is_published', is_published)
      }
      
      const response = await apiClient.get(`/agent/workflows?${queryParams}`)
      
      if (response.data.success) {
        const { workflows, pagination } = response.data.data
        
        set({
          workflows,
          workflowsPagination: {
            current: pagination.page,
            pageSize: pagination.limit,
            total: pagination.total
          },
          workflowsLoading: false
        })
      }
    } catch (error) {
      console.error('获取工作流列表失败:', error)
      message.error('获取工作流列表失败')
      set({ workflowsLoading: false })
    }
  },
  
  /**
   * 获取单个工作流详情
   */
  fetchWorkflowById: async (id) => {
    set({ currentWorkflowLoading: true })
    try {
      const response = await apiClient.get(`/agent/workflows/${id}`)
      
      if (response.data.success) {
        set({
          currentWorkflow: response.data.data,
          currentWorkflowLoading: false
        })
        return response.data.data
      }
    } catch (error) {
      console.error('获取工作流详情失败:', error)
      message.error('获取工作流详情失败')
      set({ currentWorkflowLoading: false })
      throw error
    }
  },
  
  /**
   * 创建工作流
   */
  createWorkflow: async (workflowData) => {
    try {
      const response = await apiClient.post('/agent/workflows', workflowData)
      
      if (response.data.success) {
        message.success('工作流创建成功')
        
        // 刷新列表
        await get().fetchWorkflows({ current: 1 })
        
        return response.data.data
      }
    } catch (error) {
      console.error('创建工作流失败:', error)
      message.error(error.response?.data?.message || '创建工作流失败')
      throw error
    }
  },
  
  /**
   * 更新工作流
   */
  updateWorkflow: async (id, workflowData) => {
    try {
      const response = await apiClient.put(`/agent/workflows/${id}`, workflowData)
      
      if (response.data.success) {
        message.success('工作流更新成功')
        
        // 更新当前工作流
        if (get().currentWorkflow?.id === id) {
          await get().fetchWorkflowById(id)
        }
        
        // 刷新列表
        await get().fetchWorkflows()
        
        return response.data.data
      }
    } catch (error) {
      console.error('更新工作流失败:', error)
      message.error(error.response?.data?.message || '更新工作流失败')
      throw error
    }
  },
  
  /**
   * 删除工作流
   */
  deleteWorkflow: async (id) => {
    try {
      const response = await apiClient.delete(`/agent/workflows/${id}`)
      
      if (response.data.success) {
        message.success('工作流删除成功')
        
        // 刷新列表
        await get().fetchWorkflows()
        
        return true
      }
    } catch (error) {
      console.error('删除工作流失败:', error)
      message.error(error.response?.data?.message || '删除工作流失败')
      throw error
    }
  },
  
  /**
   * 切换发布状态
   */
  togglePublish: async (id) => {
    try {
      const response = await apiClient.post(`/agent/workflows/${id}/toggle-publish`)
      
      if (response.data.success) {
        message.success('发布状态已更新')
        
        // 刷新列表
        await get().fetchWorkflows()
        
        return true
      }
    } catch (error) {
      console.error('切换发布状态失败:', error)
      message.error(error.response?.data?.message || '操作失败')
      throw error
    }
  },
  
  /**
   * 设置当前工作流（用于编辑器）
   */
  setCurrentWorkflow: (workflow) => {
    set({ currentWorkflow: workflow })
  },
  
  /**
   * 清空当前工作流
   */
  clearCurrentWorkflow: () => {
    set({ currentWorkflow: null })
  },
  
  // ========== 执行相关 ==========
  
  /**
   * 执行工作流（一次性执行，非对话模式）
   */
  executeWorkflow: async (id, inputData = {}) => {
    try {
      const response = await apiClient.post(
        `/agent/workflows/${id}/execute`,
        { input_data: inputData },
        { timeout: 120000 } // 2分钟超时
      )
      
      if (response.data.success) {
        message.success('工作流执行成功')
        
        // 刷新执行历史
        await get().fetchExecutions({ current: 1 })
        
        return response.data.data
      }
    } catch (error) {
      console.error('执行工作流失败:', error)
      
      if (error.response?.status === 402) {
        message.error('积分不足，请先充值')
      } else {
        message.error(error.response?.data?.message || '执行工作流失败')
      }
      
      throw error
    }
  },
  
  // ========== 测试对话相关 ==========
  
  /**
   * 创建测试会话
   */
  createTestSession: async (workflowId) => {
    set({ testLoading: true })
    try {
      const response = await apiClient.post(`/agent/workflows/${workflowId}/test/session`)
      
      if (response.data.success) {
        set({
          testSession: response.data.data,
          testMessages: [],
          testLoading: false
        })
        return response.data.data
      }
    } catch (error) {
      console.error('创建测试会话失败:', error)
      message.error('创建测试会话失败')
      set({ testLoading: false })
      throw error
    }
  },
  
  /**
   * 发送测试消息
   */
  sendTestMessage: async (workflowId, messageContent) => {
    const { testSession, testMessages } = get()
    
    if (!testSession) {
      throw new Error('测试会话不存在')
    }
    
    set({ testLoading: true })
    
    // 添加用户消息到本地状态
    const userMessage = {
      role: 'user',
      content: messageContent,
      timestamp: new Date().toISOString()
    }
    
    set({ testMessages: [...testMessages, userMessage] })
    
    try {
      const response = await apiClient.post(
        `/agent/workflows/${workflowId}/test/message`,
        {
          session_id: testSession.session_id,
          message: messageContent
        },
        { timeout: 120000 }
      )
      
      if (response.data.success) {
        // 添加AI回复到本地状态
        const aiMessage = response.data.data.message
        
        set({ 
          testMessages: [...get().testMessages, aiMessage],
          testLoading: false
        })
        
        return response.data.data
      }
    } catch (error) {
      console.error('发送测试消息失败:', error)
      
      // 移除用户消息（因为发送失败）
      set({ 
        testMessages: testMessages,
        testLoading: false 
      })
      
      if (error.response?.status === 402) {
        message.error('积分不足，请先充值')
      } else {
        message.error(error.response?.data?.message || '发送消息失败')
      }
      
      throw error
    }
  },
  
  /**
   * 获取测试会话历史
   */
  getTestSessionHistory: async (workflowId, sessionId) => {
    try {
      const response = await apiClient.get(
        `/agent/workflows/${workflowId}/test/history?session_id=${sessionId}`
      )
      
      if (response.data.success) {
        set({ testMessages: response.data.data.messages })
        return response.data.data
      }
    } catch (error) {
      console.error('获取会话历史失败:', error)
      message.error('获取会话历史失败')
      throw error
    }
  },
  
  /**
   * 删除测试会话
   */
  deleteTestSession: async (workflowId, sessionId) => {
    try {
      const response = await apiClient.delete(
        `/agent/workflows/${workflowId}/test/session`,
        { data: { session_id: sessionId } }
      )
      
      if (response.data.success) {
        set({
          testSession: null,
          testMessages: []
        })
        return true
      }
    } catch (error) {
      console.error('删除测试会话失败:', error)
      message.error('删除测试会话失败')
      throw error
    }
  },
  
  /**
   * 清空测试状态
   */
  clearTestSession: () => {
    set({
      testSession: null,
      testMessages: [],
      testLoading: false
    })
  },
  
  // ========== 执行历史相关 ==========
  
  /**
   * 获取执行历史
   * v2.1 修复：后端返回字段名是 data 而非 executions，做兼容处理
   */
  fetchExecutions: async (params = {}) => {
    set({ executionsLoading: true })
    try {
      const { current = 1, pageSize = 20, workflow_id, status } = params
      
      const queryParams = new URLSearchParams({
        page: current,
        limit: pageSize
      })
      
      if (workflow_id) queryParams.append('workflow_id', workflow_id)
      if (status) queryParams.append('status', status)
      
      const response = await apiClient.get(`/agent/executions?${queryParams}`)
      
      if (response.data.success) {
        const responseData = response.data.data
        
        // v2.1 修复：兼容后端返回的 data 字段名和 executions 字段名
        // 后端 AgentExecution.findByUserId 返回 { data: [...], pagination: {...} }
        // 前端之前错误地解构为 { executions, pagination }
        const executionList = responseData.executions || responseData.data || []
        const pagination = responseData.pagination || {}
        
        set({
          executions: executionList,
          executionsPagination: {
            current: pagination.page || current,
            pageSize: pagination.limit || pageSize,
            total: pagination.total || 0
          },
          executionsLoading: false
        })
      }
    } catch (error) {
      console.error('获取执行历史失败:', error)
      message.error('获取执行历史失败')
      set({ executionsLoading: false })
    }
  },
  
  /**
   * 获取单个执行记录详情
   */
  fetchExecutionById: async (id) => {
    set({ currentExecutionLoading: true })
    try {
      const response = await apiClient.get(`/agent/executions/${id}`)
      
      if (response.data.success) {
        set({
          currentExecution: response.data.data,
          currentExecutionLoading: false
        })
        return response.data.data
      }
    } catch (error) {
      console.error('获取执行详情失败:', error)
      message.error('获取执行详情失败')
      set({ currentExecutionLoading: false })
      throw error
    }
  },
  
  /**
   * 删除执行记录
   */
  deleteExecution: async (id) => {
    try {
      const response = await apiClient.delete(`/agent/executions/${id}`)
      
      if (response.data.success) {
        message.success('执行记录已删除')
        
        // 刷新列表
        await get().fetchExecutions()
        
        return true
      }
    } catch (error) {
      console.error('删除执行记录失败:', error)
      message.error('删除执行记录失败')
      throw error
    }
  },
  
  // ========== 统计相关 ==========
  
  /**
   * 获取统计信息
   */
  fetchStats: async () => {
    set({ statsLoading: true })
    try {
      const response = await apiClient.get('/agent/stats')
      
      if (response.data.success) {
        set({
          stats: response.data.data,
          statsLoading: false
        })
      }
    } catch (error) {
      console.error('获取统计信息失败:', error)
      set({ statsLoading: false })
    }
  }
}))

export default useAgentStore

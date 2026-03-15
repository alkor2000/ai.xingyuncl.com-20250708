/**
 * Agent工作流状态管理
 * 使用 Zustand 管理工作流CRUD、执行、历史、API Key等状态
 */

import { create } from 'zustand'
import apiClient from '../utils/api'
import { message } from 'antd'

const useAgentStore = create((set, get) => ({
  /* ========== 状态 ========== */

  nodeTypes: [],
  nodeTypesLoading: false,
  availableModels: [],
  modelsLoading: false,
  wikiItems: [],
  wikiItemsLoading: false,

  workflows: [],
  workflowsLoading: false,
  workflowsPagination: { current: 1, pageSize: 20, total: 0 },

  currentWorkflow: null,
  currentWorkflowLoading: false,

  executions: [],
  executionsLoading: false,
  executionsPagination: { current: 1, pageSize: 20, total: 0 },

  currentExecution: null,
  currentExecutionLoading: false,

  stats: null,
  statsLoading: false,

  testSession: null,
  testMessages: [],
  testLoading: false,

  /* API Key 状态 */
  apiKeyInfo: null,
  apiKeyLoading: false,
  apiKeyLogs: null,
  apiKeyLogsLoading: false,

  /* ========== 节点类型 ========== */

  fetchNodeTypes: async () => {
    set({ nodeTypesLoading: true })
    try {
      const response = await apiClient.get('/agent/node-types')
      if (response.data.success) {
        set({ nodeTypes: response.data.data, nodeTypesLoading: false })
      }
    } catch (error) {
      console.error('获取节点类型失败:', error)
      message.error('获取节点类型失败')
      set({ nodeTypesLoading: false })
    }
  },

  getNodeTypeByKey: (typeKey) => {
    return get().nodeTypes.find(nt => nt.type_key === typeKey)
  },

  /* ========== 模型 ========== */

  fetchAvailableModels: async () => {
    set({ modelsLoading: true })
    try {
      const response = await apiClient.get('/chat/models')
      if (response.data.success) {
        set({ availableModels: response.data.data, modelsLoading: false })
        return response.data.data
      }
    } catch (error) {
      console.error('获取可用模型失败:', error)
      message.error('获取可用模型失败')
      set({ modelsLoading: false })
      return []
    }
  },

  getModelByName: (modelName) => {
    return get().availableModels.find(m => m.name === modelName)
  },

  /* ========== 知识库 ========== */

  fetchWikiItems: async () => {
    set({ wikiItemsLoading: true })
    try {
      const response = await apiClient.get('/agent/wiki-items')
      if (response.data.success) {
        set({ wikiItems: response.data.data, wikiItemsLoading: false })
        return response.data.data
      }
    } catch (error) {
      console.error('获取知识库列表失败:', error)
      message.error('获取知识库列表失败')
      set({ wikiItemsLoading: false })
      return []
    }
  },

  getWikiById: (wikiId) => get().wikiItems.find(w => w.id === wikiId),
  getWikisByIds: (ids) => ids.map(id => get().wikiItems.find(w => w.id === id)).filter(Boolean),

  /* ========== 工作流列表 ========== */

  fetchWorkflows: async (params = {}) => {
    set({ workflowsLoading: true })
    try {
      const { current = 1, pageSize = 20, is_published } = params
      const qp = new URLSearchParams({ page: current, limit: pageSize })
      if (is_published !== undefined) qp.append('is_published', is_published)

      const response = await apiClient.get(`/agent/workflows?${qp}`)
      if (response.data.success) {
        const { workflows, pagination } = response.data.data
        set({
          workflows,
          workflowsPagination: {
            current: pagination.page, pageSize: pagination.limit, total: pagination.total
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

  fetchWorkflowById: async (id) => {
    set({ currentWorkflowLoading: true })
    try {
      const response = await apiClient.get(`/agent/workflows/${id}`)
      if (response.data.success) {
        set({ currentWorkflow: response.data.data, currentWorkflowLoading: false })
        return response.data.data
      }
    } catch (error) {
      console.error('获取工作流详情失败:', error)
      message.error('获取工作流详情失败')
      set({ currentWorkflowLoading: false })
      throw error
    }
  },

  createWorkflow: async (workflowData) => {
    try {
      const response = await apiClient.post('/agent/workflows', workflowData)
      if (response.data.success) {
        message.success('工作流创建成功')
        await get().fetchWorkflows({ current: 1 })
        return response.data.data
      }
    } catch (error) {
      console.error('创建工作流失败:', error)
      message.error(error.response?.data?.message || '创建工作流失败')
      throw error
    }
  },

  updateWorkflow: async (id, workflowData) => {
    try {
      const response = await apiClient.put(`/agent/workflows/${id}`, workflowData)
      if (response.data.success) {
        if (get().currentWorkflow?.id === id) await get().fetchWorkflowById(id)
        await get().fetchWorkflows()
        return response.data.data
      }
    } catch (error) {
      console.error('更新工作流失败:', error)
      message.error(error.response?.data?.message || '更新工作流失败')
      throw error
    }
  },

  deleteWorkflow: async (id) => {
    try {
      const response = await apiClient.delete(`/agent/workflows/${id}`)
      if (response.data.success) {
        message.success('工作流删除成功')
        await get().fetchWorkflows()
        return true
      }
    } catch (error) {
      console.error('删除工作流失败:', error)
      message.error(error.response?.data?.message || '删除工作流失败')
      throw error
    }
  },

  togglePublish: async (id) => {
    try {
      const response = await apiClient.post(`/agent/workflows/${id}/toggle-publish`)
      if (response.data.success) {
        message.success('发布状态已更新')
        await get().fetchWorkflows()
        return true
      }
    } catch (error) {
      console.error('切换发布状态失败:', error)
      message.error(error.response?.data?.message || '操作失败')
      throw error
    }
  },

  setCurrentWorkflow: (workflow) => set({ currentWorkflow: workflow }),
  clearCurrentWorkflow: () => set({ currentWorkflow: null }),

  /* ========== 执行 ========== */

  executeWorkflow: async (id, inputData = {}) => {
    try {
      const response = await apiClient.post(
        `/agent/workflows/${id}/execute`,
        { input_data: inputData },
        { timeout: 120000 }
      )
      if (response.data.success) {
        message.success('工作流执行成功')
        await get().fetchExecutions({ current: 1 })
        return response.data.data
      }
    } catch (error) {
      console.error('执行工作流失败:', error)
      if (error.response?.status === 402) message.error('积分不足，请先充值')
      else message.error(error.response?.data?.message || '执行工作流失败')
      throw error
    }
  },

  /* ========== 测试对话 ========== */

  createTestSession: async (workflowId) => {
    set({ testLoading: true })
    try {
      const response = await apiClient.post(`/agent/workflows/${workflowId}/test/session`)
      if (response.data.success) {
        set({ testSession: response.data.data, testMessages: [], testLoading: false })
        return response.data.data
      }
    } catch (error) {
      console.error('创建测试会话失败:', error)
      message.error('创建测试会话失败')
      set({ testLoading: false })
      throw error
    }
  },

  sendTestMessage: async (workflowId, messageContent) => {
    const { testSession, testMessages } = get()
    if (!testSession) throw new Error('测试会话不存在')

    set({ testLoading: true })
    const userMessage = { role: 'user', content: messageContent, timestamp: new Date().toISOString() }
    set({ testMessages: [...testMessages, userMessage] })

    try {
      const response = await apiClient.post(
        `/agent/workflows/${workflowId}/test/message`,
        { session_id: testSession.session_id, message: messageContent },
        { timeout: 120000 }
      )
      if (response.data.success) {
        const aiMessage = response.data.data.message
        set({ testMessages: [...get().testMessages, aiMessage], testLoading: false })
        return response.data.data
      }
    } catch (error) {
      console.error('发送测试消息失败:', error)
      set({ testMessages: testMessages, testLoading: false })
      if (error.response?.status === 402) message.error('积分不足，请先充值')
      else message.error(error.response?.data?.message || '发送消息失败')
      throw error
    }
  },

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

  deleteTestSession: async (workflowId, sessionId) => {
    try {
      const response = await apiClient.delete(
        `/agent/workflows/${workflowId}/test/session`,
        { data: { session_id: sessionId } }
      )
      if (response.data.success) {
        set({ testSession: null, testMessages: [] })
        return true
      }
    } catch (error) {
      console.error('删除测试会话失败:', error)
      message.error('删除测试会话失败')
      throw error
    }
  },

  clearTestSession: () => set({ testSession: null, testMessages: [], testLoading: false }),

  /* ========== API Key 管理 ========== */

  /** 获取工作流的API Key信息 */
  fetchApiKey: async (workflowId) => {
    set({ apiKeyLoading: true })
    try {
      const response = await apiClient.get(`/agent/workflows/${workflowId}/api-key`)
      if (response.data.success) {
        set({ apiKeyInfo: response.data.data, apiKeyLoading: false })
        return response.data.data
      }
    } catch (error) {
      console.error('获取API Key失败:', error)
      set({ apiKeyInfo: null, apiKeyLoading: false })
    }
  },

  /** 创建或重新生成API Key */
  createApiKey: async (workflowId, regenerate = false) => {
    try {
      const response = await apiClient.post(
        `/agent/workflows/${workflowId}/api-key`,
        { regenerate }
      )
      if (response.data.success) {
        message.success(response.data.data?.message || 'API Key生成成功')
        return response.data.data
      }
    } catch (error) {
      console.error('生成API Key失败:', error)
      message.error(error.response?.data?.message || '生成API Key失败')
      throw error
    }
  },

  /** 更新API Key配置 */
  updateApiKeyConfig: async (workflowId, config) => {
    try {
      const response = await apiClient.put(
        `/agent/workflows/${workflowId}/api-key`,
        config
      )
      if (response.data.success) {
        /* 刷新API Key信息 */
        await get().fetchApiKey(workflowId)
        return true
      }
    } catch (error) {
      console.error('更新API Key配置失败:', error)
      message.error(error.response?.data?.message || '更新配置失败')
      throw error
    }
  },

  /** 删除API Key */
  deleteApiKey: async (workflowId) => {
    try {
      const response = await apiClient.delete(`/agent/workflows/${workflowId}/api-key`)
      if (response.data.success) {
        message.success('API Key已删除')
        set({ apiKeyInfo: null })
        return true
      }
    } catch (error) {
      console.error('删除API Key失败:', error)
      message.error(error.response?.data?.message || '删除失败')
      throw error
    }
  },

  /** 获取API调用日志 */
  fetchApiKeyLogs: async (workflowId, page = 1) => {
    set({ apiKeyLogsLoading: true })
    try {
      const response = await apiClient.get(
        `/agent/workflows/${workflowId}/api-key/logs?page=${page}&limit=20`
      )
      if (response.data.success) {
        set({ apiKeyLogs: response.data.data, apiKeyLogsLoading: false })
        return response.data.data
      }
    } catch (error) {
      console.error('获取调用日志失败:', error)
      set({ apiKeyLogsLoading: false })
    }
  },

  /* ========== 执行历史 ========== */

  fetchExecutions: async (params = {}) => {
    set({ executionsLoading: true })
    try {
      const { current = 1, pageSize = 20, workflow_id, status } = params
      const qp = new URLSearchParams({ page: current, limit: pageSize })
      if (workflow_id) qp.append('workflow_id', workflow_id)
      if (status) qp.append('status', status)

      const response = await apiClient.get(`/agent/executions?${qp}`)
      if (response.data.success) {
        const data = response.data.data
        const list = data.executions || data.data || []
        const pagination = data.pagination || {}
        set({
          executions: list,
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

  fetchExecutionById: async (id) => {
    set({ currentExecutionLoading: true })
    try {
      const response = await apiClient.get(`/agent/executions/${id}`)
      if (response.data.success) {
        set({ currentExecution: response.data.data, currentExecutionLoading: false })
        return response.data.data
      }
    } catch (error) {
      console.error('获取执行详情失败:', error)
      message.error('获取执行详情失败')
      set({ currentExecutionLoading: false })
      throw error
    }
  },

  deleteExecution: async (id) => {
    try {
      const response = await apiClient.delete(`/agent/executions/${id}`)
      if (response.data.success) {
        message.success('执行记录已删除')
        await get().fetchExecutions()
        return true
      }
    } catch (error) {
      console.error('删除执行记录失败:', error)
      message.error('删除执行记录失败')
      throw error
    }
  },

  /* ========== 统计 ========== */

  fetchStats: async () => {
    set({ statsLoading: true })
    try {
      const response = await apiClient.get('/agent/stats')
      if (response.data.success) {
        set({ stats: response.data.data, statsLoading: false })
      }
    } catch (error) {
      console.error('获取统计信息失败:', error)
      set({ statsLoading: false })
    }
  }
}))

export default useAgentStore

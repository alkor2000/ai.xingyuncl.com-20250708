/**
 * Agent工作流状态管理
 * 使用 Zustand 管理工作流CRUD、执行、历史、API Key等状态
 *
 * v1.1 国际化：
 *   本文件为非React模块（Zustand store），无法使用useTranslation hook，
 *   改为直接import i18n实例调用i18n.t()。
 *   全部console日志属开发者诊断信息，统一改英文不进语言包；
 *   message.*用户可见文案改i18n.t()，新建agent.json的agent.store子命名空间(27键)，
 *   语义与既有workflow/execution/api分组的UI专属文案存在歧义风险，保守新建不复用；
 *   仅"操作失败"/"删除失败"两处与common.json的message.error/message.deleteFailed
 *   文案完全一致，复用既有键；
 *   sendTestMessage中throw new Error('测试会话不存在')属业务校验失败、可能被上层
 *   展示给用户，同样改为i18n.t()
 */

import { create } from 'zustand'
import apiClient from '../utils/api'
import { message } from 'antd'
import i18n from '../utils/i18n'

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
      console.error('Failed to get node types:', error)
      message.error(i18n.t('agent.store.nodeTypesLoadFailed'))
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
      console.error('Failed to get available models:', error)
      message.error(i18n.t('agent.store.modelsLoadFailed'))
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
      console.error('Failed to get knowledge base list:', error)
      message.error(i18n.t('agent.store.wikiItemsLoadFailed'))
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
      console.error('Failed to get workflow list:', error)
      message.error(i18n.t('agent.store.workflowsLoadFailed'))
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
      console.error('Failed to get workflow detail:', error)
      message.error(i18n.t('agent.store.workflowDetailLoadFailed'))
      set({ currentWorkflowLoading: false })
      throw error
    }
  },

  createWorkflow: async (workflowData) => {
    try {
      const response = await apiClient.post('/agent/workflows', workflowData)
      if (response.data.success) {
        message.success(i18n.t('agent.store.createSuccess'))
        await get().fetchWorkflows({ current: 1 })
        return response.data.data
      }
    } catch (error) {
      console.error('Failed to create workflow:', error)
      message.error(error.response?.data?.message || i18n.t('agent.store.createFailed'))
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
      console.error('Failed to update workflow:', error)
      message.error(error.response?.data?.message || i18n.t('agent.store.updateFailed'))
      throw error
    }
  },

  deleteWorkflow: async (id) => {
    try {
      const response = await apiClient.delete(`/agent/workflows/${id}`)
      if (response.data.success) {
        message.success(i18n.t('agent.store.deleteSuccess'))
        await get().fetchWorkflows()
        return true
      }
    } catch (error) {
      console.error('Failed to delete workflow:', error)
      message.error(error.response?.data?.message || i18n.t('agent.store.deleteFailed'))
      throw error
    }
  },

  togglePublish: async (id) => {
    try {
      const response = await apiClient.post(`/agent/workflows/${id}/toggle-publish`)
      if (response.data.success) {
        message.success(i18n.t('agent.store.publishStatusUpdated'))
        await get().fetchWorkflows()
        return true
      }
    } catch (error) {
      console.error('Failed to toggle publish status:', error)
      message.error(error.response?.data?.message || i18n.t('message.error'))
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
        message.success(i18n.t('agent.store.executeSuccess'))
        await get().fetchExecutions({ current: 1 })
        return response.data.data
      }
    } catch (error) {
      console.error('Failed to execute workflow:', error)
      if (error.response?.status === 402) message.error(i18n.t('agent.store.insufficientCredits'))
      else message.error(error.response?.data?.message || i18n.t('agent.store.executeFailed'))
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
      console.error('Failed to create test session:', error)
      message.error(i18n.t('agent.store.createTestSessionFailed'))
      set({ testLoading: false })
      throw error
    }
  },

  sendTestMessage: async (workflowId, messageContent) => {
    const { testSession, testMessages } = get()
    if (!testSession) throw new Error(i18n.t('agent.store.testSessionNotFound'))

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
      console.error('Failed to send test message:', error)
      set({ testMessages: testMessages, testLoading: false })
      if (error.response?.status === 402) message.error(i18n.t('agent.store.insufficientCredits'))
      else message.error(error.response?.data?.message || i18n.t('agent.store.sendTestMessageFailed'))
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
      console.error('Failed to get session history:', error)
      message.error(i18n.t('agent.store.sessionHistoryLoadFailed'))
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
      console.error('Failed to delete test session:', error)
      message.error(i18n.t('agent.store.deleteTestSessionFailed'))
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
      console.error('Failed to get API Key:', error)
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
        message.success(response.data.data?.message || i18n.t('agent.store.apiKeyCreateSuccess'))
        return response.data.data
      }
    } catch (error) {
      console.error('Failed to generate API Key:', error)
      message.error(error.response?.data?.message || i18n.t('agent.store.apiKeyCreateFailed'))
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
      console.error('Failed to update API Key config:', error)
      message.error(error.response?.data?.message || i18n.t('agent.store.apiKeyConfigUpdateFailed'))
      throw error
    }
  },

  /** 删除API Key */
  deleteApiKey: async (workflowId) => {
    try {
      const response = await apiClient.delete(`/agent/workflows/${workflowId}/api-key`)
      if (response.data.success) {
        message.success(i18n.t('agent.store.apiKeyDeleteSuccess'))
        set({ apiKeyInfo: null })
        return true
      }
    } catch (error) {
      console.error('Failed to delete API Key:', error)
      message.error(error.response?.data?.message || i18n.t('message.deleteFailed'))
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
      console.error('Failed to get call logs:', error)
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
      console.error('Failed to get execution history:', error)
      message.error(i18n.t('agent.store.executionsLoadFailed'))
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
      console.error('Failed to get execution detail:', error)
      message.error(i18n.t('agent.store.executionDetailLoadFailed'))
      set({ currentExecutionLoading: false })
      throw error
    }
  },

  deleteExecution: async (id) => {
    try {
      const response = await apiClient.delete(`/agent/executions/${id}`)
      if (response.data.success) {
        message.success(i18n.t('agent.store.executionDeleteSuccess'))
        await get().fetchExecutions()
        return true
      }
    } catch (error) {
      console.error('Failed to delete execution record:', error)
      message.error(i18n.t('agent.store.executionDeleteFailed'))
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
      console.error('Failed to get stats:', error)
      set({ statsLoading: false })
    }
  }
}))

export default useAgentStore

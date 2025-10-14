/**
 * Agent工作流状态管理
 * 使用 Zustand 管理工作流的CRUD、执行、历史等状态
 */

import { create } from 'zustand'
import axios from 'axios'
import { message } from 'antd'

const useAgentStore = create((set, get) => ({
  // ========== 状态 ==========
  
  // 节点类型列表
  nodeTypes: [],
  nodeTypesLoading: false,
  
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
  
  // ========== 节点类型相关 ==========
  
  /**
   * 获取可用节点类型
   */
  fetchNodeTypes: async () => {
    set({ nodeTypesLoading: true })
    try {
      const response = await axios.get('/api/agent/node-types')
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
      
      const response = await axios.get(`/api/agent/workflows?${queryParams}`)
      
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
      const response = await axios.get(`/api/agent/workflows/${id}`)
      
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
      const response = await axios.post('/api/agent/workflows', workflowData)
      
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
      const response = await axios.put(`/api/agent/workflows/${id}`, workflowData)
      
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
      const response = await axios.delete(`/api/agent/workflows/${id}`)
      
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
      const response = await axios.post(`/api/agent/workflows/${id}/toggle-publish`)
      
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
   * 执行工作流
   */
  executeWorkflow: async (id, inputData = {}) => {
    try {
      const response = await axios.post(
        `/api/agent/workflows/${id}/execute`,
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
  
  /**
   * 获取执行历史
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
      
      const response = await axios.get(`/api/agent/executions?${queryParams}`)
      
      if (response.data.success) {
        const { executions, pagination } = response.data.data
        
        set({
          executions,
          executionsPagination: {
            current: pagination.page,
            pageSize: pagination.limit,
            total: pagination.total
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
      const response = await axios.get(`/api/agent/executions/${id}`)
      
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
      const response = await axios.delete(`/api/agent/executions/${id}`)
      
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
      const response = await axios.get('/api/agent/stats')
      
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

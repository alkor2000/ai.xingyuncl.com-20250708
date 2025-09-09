/**
 * 数据分析Store - 管理BI面板的状态和数据
 */

import { create } from 'zustand'
import { message } from 'antd'
import api from '../utils/api'

const useAnalyticsStore = create((set, get) => ({
  // 状态
  loading: false,
  analyticsData: null,
  dashboardData: null,
  filters: {
    startDate: null,
    endDate: null,
    groupId: null,
    tagIds: [],
    timeGranularity: 'day'
  },

  // 设置过滤条件
  setFilters: (newFilters) => {
    set({ filters: { ...get().filters, ...newFilters } })
  },

  // 重置过滤条件
  resetFilters: () => {
    set({
      filters: {
        startDate: null,
        endDate: null,
        groupId: null,
        tagIds: [],
        timeGranularity: 'day'
      }
    })
  },

  // 获取综合分析数据 - 修复：去掉/api前缀
  getAnalytics: async (customFilters = {}) => {
    set({ loading: true })
    try {
      const filters = { ...get().filters, ...customFilters }
      
      // 构建查询参数
      const params = new URLSearchParams()
      if (filters.startDate) params.append('startDate', filters.startDate)
      if (filters.endDate) params.append('endDate', filters.endDate)
      if (filters.groupId) params.append('groupId', filters.groupId)
      if (filters.tagIds.length > 0) params.append('tagIds', filters.tagIds.join(','))
      if (filters.timeGranularity) params.append('timeGranularity', filters.timeGranularity)

      // 修复：使用正确的路径 /admin/analytics 而不是 /api/admin/analytics
      const response = await api.get(`/admin/analytics?${params.toString()}`)
      
      if (response.data.success) {
        set({ analyticsData: response.data.data })
        return response.data.data
      } else {
        throw new Error(response.data.message)
      }
    } catch (error) {
      console.error('获取分析数据失败:', error)
      message.error(error.response?.data?.message || '获取分析数据失败')
      throw error
    } finally {
      set({ loading: false })
    }
  },

  // 获取实时数据看板 - 修复：去掉/api前缀
  getDashboard: async () => {
    set({ loading: true })
    try {
      // 修复：使用正确的路径
      const response = await api.get('/admin/analytics/dashboard')
      
      if (response.data.success) {
        set({ dashboardData: response.data.data })
        return response.data.data
      } else {
        throw new Error(response.data.message)
      }
    } catch (error) {
      console.error('获取实时看板失败:', error)
      message.error(error.response?.data?.message || '获取实时看板失败')
      throw error
    } finally {
      set({ loading: false })
    }
  },

  // 导出分析报表 - 修复：去掉/api前缀
  exportAnalytics: async (customFilters = {}) => {
    set({ loading: true })
    try {
      const filters = { ...get().filters, ...customFilters }
      
      // 构建查询参数
      const params = new URLSearchParams()
      if (filters.startDate) params.append('startDate', filters.startDate)
      if (filters.endDate) params.append('endDate', filters.endDate)
      if (filters.groupId) params.append('groupId', filters.groupId)
      if (filters.tagIds.length > 0) params.append('tagIds', filters.tagIds.join(','))
      if (filters.timeGranularity) params.append('timeGranularity', filters.timeGranularity)

      // 修复：使用正确的路径
      const response = await api.get(`/admin/analytics/export?${params.toString()}`, {
        responseType: 'blob'
      })

      // 创建下载链接
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `analytics_${new Date().toISOString().split('T')[0]}.xlsx`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)

      message.success('报表导出成功')
    } catch (error) {
      console.error('导出报表失败:', error)
      message.error(error.response?.data?.message || '导出报表失败')
      throw error
    } finally {
      set({ loading: false })
    }
  },

  // 清空数据
  clearData: () => {
    set({
      analyticsData: null,
      dashboardData: null
    })
  }
}))

export default useAnalyticsStore

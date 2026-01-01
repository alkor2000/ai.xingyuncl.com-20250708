/**
 * 知识库状态管理
 * 
 * 功能：
 * - 知识库列表管理（按范围筛选）
 * - 知识库CRUD操作
 * - 版本管理（保存、历史、回滚）
 * - 编辑者管理
 * 
 * 创建时间：2026-01-02
 */

import { create } from 'zustand'
import apiClient from '../utils/api'
import { message } from 'antd'

const useWikiStore = create((set, get) => ({
  // ==================== 状态 ====================
  
  // 知识库列表
  items: [],
  // 当前选中的知识库
  currentItem: null,
  // 版本历史
  versions: [],
  // 编辑者列表
  editors: [],
  // 加载状态
  loading: false,
  // 详情加载状态
  detailLoading: false,
  // 版本加载状态
  versionsLoading: false,
  // 当前筛选范围
  currentScope: null,
  // 错误信息
  error: null,

  // ==================== 知识库列表操作 ====================

  /**
   * 获取知识库列表
   * @param {string} scope - 筛选范围：personal/team/global/null(全部)
   */
  getItems: async (scope = null) => {
    set({ loading: true, error: null, currentScope: scope })
    try {
      const params = scope ? { scope } : {}
      const response = await apiClient.get('/wiki/items', { params })
      set({ 
        items: response.data.data || [],
        loading: false 
      })
      return response.data.data
    } catch (error) {
      console.error('获取知识库列表失败:', error)
      set({ 
        error: error.response?.data?.message || '获取知识库列表失败',
        loading: false 
      })
      message.error(error.response?.data?.message || '获取知识库列表失败')
      throw error
    }
  },

  /**
   * 获取知识库详情
   * @param {number} id - 知识库ID
   */
  getItem: async (id) => {
    set({ detailLoading: true, error: null })
    try {
      const response = await apiClient.get(`/wiki/items/${id}`)
      const item = response.data.data
      set({ 
        currentItem: item,
        detailLoading: false 
      })
      return item
    } catch (error) {
      console.error('获取知识库详情失败:', error)
      set({ 
        error: error.response?.data?.message || '获取知识库详情失败',
        detailLoading: false 
      })
      if (error.response?.status === 403) {
        message.error('无权访问此知识库')
      } else if (error.response?.status === 404) {
        message.error('知识库不存在')
      } else {
        message.error(error.response?.data?.message || '获取知识库详情失败')
      }
      throw error
    }
  },

  /**
   * 创建知识库
   * @param {Object} data - 知识库数据
   */
  createItem: async (data) => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.post('/wiki/items', data)
      const newItem = response.data.data
      
      // 更新列表
      set(state => ({
        items: [newItem, ...state.items],
        loading: false
      }))
      
      message.success('创建成功')
      return newItem
    } catch (error) {
      console.error('创建知识库失败:', error)
      set({ 
        error: error.response?.data?.message || '创建知识库失败',
        loading: false 
      })
      message.error(error.response?.data?.message || '创建知识库失败')
      throw error
    }
  },

  /**
   * 更新知识库
   * @param {number} id - 知识库ID
   * @param {Object} data - 更新数据
   */
  updateItem: async (id, data) => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.put(`/wiki/items/${id}`, data)
      const updatedItem = response.data.data
      
      // 更新列表中的项
      set(state => ({
        items: state.items.map(item => 
          item.id === id ? { ...item, ...updatedItem } : item
        ),
        currentItem: state.currentItem?.id === id ? updatedItem : state.currentItem,
        loading: false
      }))
      
      message.success('保存成功')
      return updatedItem
    } catch (error) {
      console.error('更新知识库失败:', error)
      set({ 
        error: error.response?.data?.message || '更新知识库失败',
        loading: false 
      })
      message.error(error.response?.data?.message || '更新知识库失败')
      throw error
    }
  },

  /**
   * 删除知识库
   * @param {number} id - 知识库ID
   */
  deleteItem: async (id) => {
    set({ loading: true, error: null })
    try {
      await apiClient.delete(`/wiki/items/${id}`)
      
      // 从列表中移除
      set(state => ({
        items: state.items.filter(item => item.id !== id),
        currentItem: state.currentItem?.id === id ? null : state.currentItem,
        loading: false
      }))
      
      message.success('删除成功')
      return true
    } catch (error) {
      console.error('删除知识库失败:', error)
      set({ 
        error: error.response?.data?.message || '删除知识库失败',
        loading: false 
      })
      message.error(error.response?.data?.message || '删除知识库失败')
      throw error
    }
  },

  /**
   * 切换置顶状态
   * @param {number} id - 知识库ID
   */
  togglePin: async (id) => {
    try {
      const response = await apiClient.put(`/wiki/items/${id}/pin`)
      const updatedItem = response.data.data
      
      // 更新列表
      set(state => ({
        items: state.items.map(item => 
          item.id === id ? { ...item, is_pinned: updatedItem.is_pinned } : item
        ),
        currentItem: state.currentItem?.id === id 
          ? { ...state.currentItem, is_pinned: updatedItem.is_pinned }
          : state.currentItem
      }))
      
      message.success(updatedItem.is_pinned ? '已置顶' : '已取消置顶')
      return updatedItem
    } catch (error) {
      console.error('切换置顶状态失败:', error)
      message.error(error.response?.data?.message || '操作失败')
      throw error
    }
  },

  // ==================== 版本管理 ====================

  /**
   * 保存新版本
   * @param {number} id - 知识库ID
   * @param {string} changeSummary - 版本说明（可选）
   */
  saveVersion: async (id, changeSummary = null) => {
    try {
      const response = await apiClient.post(`/wiki/items/${id}/version`, {
        change_summary: changeSummary
      })
      
      // 更新版本号
      set(state => ({
        currentItem: state.currentItem?.id === id 
          ? { 
              ...state.currentItem, 
              current_version: response.data.data.version,
              version_count: (state.currentItem.version_count || 1) + 1
            }
          : state.currentItem
      }))
      
      message.success('版本保存成功')
      return response.data.data
    } catch (error) {
      console.error('保存版本失败:', error)
      message.error(error.response?.data?.message || '保存版本失败')
      throw error
    }
  },

  /**
   * 获取版本历史
   * @param {number} id - 知识库ID
   */
  getVersions: async (id) => {
    set({ versionsLoading: true })
    try {
      const response = await apiClient.get(`/wiki/items/${id}/versions`)
      set({ 
        versions: response.data.data || [],
        versionsLoading: false 
      })
      return response.data.data
    } catch (error) {
      console.error('获取版本历史失败:', error)
      set({ versionsLoading: false })
      message.error(error.response?.data?.message || '获取版本历史失败')
      throw error
    }
  },

  /**
   * 获取版本详情
   * @param {number} versionId - 版本ID
   */
  getVersionDetail: async (versionId) => {
    try {
      const response = await apiClient.get(`/wiki/versions/${versionId}`)
      return response.data.data
    } catch (error) {
      console.error('获取版本详情失败:', error)
      message.error(error.response?.data?.message || '获取版本详情失败')
      throw error
    }
  },

  /**
   * 回滚到指定版本
   * @param {number} wikiId - 知识库ID
   * @param {number} versionId - 版本ID
   */
  rollbackToVersion: async (wikiId, versionId) => {
    try {
      const response = await apiClient.post(`/wiki/items/${wikiId}/rollback/${versionId}`)
      const updatedItem = response.data.data
      
      // 更新当前项
      set(state => ({
        currentItem: updatedItem,
        items: state.items.map(item => 
          item.id === wikiId ? { ...item, ...updatedItem } : item
        )
      }))
      
      message.success('版本回滚成功')
      return updatedItem
    } catch (error) {
      console.error('版本回滚失败:', error)
      message.error(error.response?.data?.message || '版本回滚失败')
      throw error
    }
  },

  // ==================== 编辑者管理 ====================

  /**
   * 获取编辑者列表
   * @param {number} id - 知识库ID
   */
  getEditors: async (id) => {
    try {
      const response = await apiClient.get(`/wiki/items/${id}/editors`)
      set({ editors: response.data.data || [] })
      return response.data.data
    } catch (error) {
      console.error('获取编辑者列表失败:', error)
      message.error(error.response?.data?.message || '获取编辑者列表失败')
      throw error
    }
  },

  /**
   * 添加编辑者
   * @param {number} wikiId - 知识库ID
   * @param {number} userId - 用户ID
   */
  addEditor: async (wikiId, userId) => {
    try {
      const response = await apiClient.post(`/wiki/items/${wikiId}/editors`, {
        user_id: userId
      })
      set({ editors: response.data.data || [] })
      message.success('添加编辑者成功')
      return response.data.data
    } catch (error) {
      console.error('添加编辑者失败:', error)
      message.error(error.response?.data?.message || '添加编辑者失败')
      throw error
    }
  },

  /**
   * 移除编辑者
   * @param {number} wikiId - 知识库ID
   * @param {number} userId - 用户ID
   */
  removeEditor: async (wikiId, userId) => {
    try {
      const response = await apiClient.delete(`/wiki/items/${wikiId}/editors/${userId}`)
      set({ editors: response.data.data || [] })
      message.success('移除编辑者成功')
      return response.data.data
    } catch (error) {
      console.error('移除编辑者失败:', error)
      message.error(error.response?.data?.message || '移除编辑者失败')
      throw error
    }
  },

  // ==================== 辅助方法 ====================

  /**
   * 清除当前选中项
   */
  clearCurrentItem: () => {
    set({ currentItem: null, versions: [], editors: [] })
  },

  /**
   * 清除错误
   */
  clearError: () => {
    set({ error: null })
  },

  /**
   * 重置状态
   */
  reset: () => {
    set({
      items: [],
      currentItem: null,
      versions: [],
      editors: [],
      loading: false,
      detailLoading: false,
      versionsLoading: false,
      currentScope: null,
      error: null
    })
  }
}))

export default useWikiStore

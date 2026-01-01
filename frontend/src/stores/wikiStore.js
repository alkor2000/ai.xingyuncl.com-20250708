/**
 * 知识库状态管理 v2.1
 * 
 * 功能：
 * - 知识库列表管理（按范围筛选）
 * - 知识库CRUD操作
 * - 版本管理（创建、切换、删除）
 * - 编辑者管理
 * 
 * 更新：2026-01-02 v2.1 
 *   - 修复updateItem后can_edit丢失问题
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
  // 当前选中的版本号（用于版本切换）
  selectedVersionNumber: null,
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
   */
  getItem: async (id) => {
    set({ detailLoading: true, error: null })
    try {
      const response = await apiClient.get(`/wiki/items/${id}`)
      const item = response.data.data
      set({ 
        currentItem: item,
        selectedVersionNumber: item.current_version,
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
   */
  createItem: async (data) => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.post('/wiki/items', data)
      const newItem = response.data.data
      
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
   * 更新知识库（覆盖保存，不创建版本）
   * v2.1修复：确保can_edit不丢失
   */
  updateItem: async (id, data) => {
    set({ loading: true, error: null })
    try {
      // 保存当前的can_edit状态，以防后端返回不完整
      const currentCanEdit = get().currentItem?.can_edit
      
      const response = await apiClient.put(`/wiki/items/${id}`, data)
      const updatedItem = response.data.data
      
      // 确保can_edit不丢失：优先使用后端返回的，如果没有则保留原值
      if (updatedItem.can_edit === undefined || updatedItem.can_edit === null) {
        updatedItem.can_edit = currentCanEdit
      }
      
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
        error: error.response?.data?.message || '保存失败',
        loading: false 
      })
      message.error(error.response?.data?.message || '保存失败')
      throw error
    }
  },

  /**
   * 删除知识库
   */
  deleteItem: async (id) => {
    set({ loading: true, error: null })
    try {
      await apiClient.delete(`/wiki/items/${id}`)
      
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
   */
  togglePin: async (id) => {
    try {
      const response = await apiClient.put(`/wiki/items/${id}/pin`)
      const updatedItem = response.data.data
      
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
   * 创建新版本
   */
  createVersion: async (id) => {
    try {
      const response = await apiClient.post(`/wiki/items/${id}/version`)
      
      // 更新版本号和版本数
      set(state => ({
        currentItem: state.currentItem?.id === id 
          ? { 
              ...state.currentItem, 
              current_version: response.data.data.version,
              version_count: (state.currentItem.version_count || 1) + 1
            }
          : state.currentItem,
        selectedVersionNumber: response.data.data.version
      }))
      
      // 刷新版本列表
      get().getVersions(id)
      
      message.success('新版本创建成功')
      return response.data.data
    } catch (error) {
      console.error('创建版本失败:', error)
      message.error(error.response?.data?.message || '创建版本失败')
      throw error
    }
  },

  /**
   * 获取版本历史
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
   * 切换到指定版本（加载版本内容到表单，不改变数据库）
   */
  switchToVersion: async (versionId) => {
    try {
      const response = await apiClient.get(`/wiki/versions/${versionId}`)
      const versionData = response.data.data
      
      // 更新selectedVersionNumber，返回版本数据供前端填充表单
      set({ selectedVersionNumber: versionData.version_number })
      
      return versionData
    } catch (error) {
      console.error('切换版本失败:', error)
      message.error(error.response?.data?.message || '切换版本失败')
      throw error
    }
  },

  /**
   * 删除指定版本
   */
  deleteVersion: async (wikiId, versionId) => {
    try {
      const response = await apiClient.delete(`/wiki/items/${wikiId}/versions/${versionId}`)
      const result = response.data.data
      
      // 更新currentItem的版本信息
      set(state => ({
        currentItem: state.currentItem?.id === wikiId 
          ? { 
              ...state.currentItem, 
              current_version: result.currentVersion,
              version_count: result.versionCount
            }
          : state.currentItem,
        selectedVersionNumber: result.currentVersion
      }))
      
      // 刷新版本列表
      get().getVersions(wikiId)
      
      message.success(`版本 v${result.deletedVersion} 已删除`)
      return result
    } catch (error) {
      console.error('删除版本失败:', error)
      message.error(error.response?.data?.message || '删除版本失败')
      throw error
    }
  },

  /**
   * 保存新版本（兼容旧接口）
   */
  saveVersion: async (id, changeSummary = null) => {
    return get().createVersion(id)
  },

  /**
   * 获取版本详情（兼容旧接口）
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
   * 回滚到指定版本（兼容旧接口）
   */
  rollbackToVersion: async (wikiId, versionId) => {
    try {
      const response = await apiClient.post(`/wiki/items/${wikiId}/rollback/${versionId}`)
      const updatedItem = response.data.data
      
      set(state => ({
        currentItem: updatedItem,
        items: state.items.map(item => 
          item.id === wikiId ? { ...item, ...updatedItem } : item
        ),
        selectedVersionNumber: updatedItem.current_version
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
    set({ currentItem: null, versions: [], editors: [], selectedVersionNumber: null })
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
      selectedVersionNumber: null,
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

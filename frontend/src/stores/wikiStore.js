/**
 * 知识库状态管理 v3.0
 * 
 * 版本管理逻辑（v3.0重构）：
 * - 所有版本平等，没有"当前版本"和"历史版本"的区分
 * - 切换版本 = 切换工作区，加载该版本的完整内容
 * - 保存 = 保存到当前查看的版本
 * - 新建版本 = 基于当前查看的版本复制一份
 * 
 * 更新：2026-01-02 v3.0 重构版本管理
 */

import { create } from 'zustand'
import apiClient from '../utils/api'
import { message } from 'antd'

const useWikiStore = create((set, get) => ({
  // ==================== 状态 ====================
  items: [],                      // 知识库列表
  currentItem: null,              // 当前知识库元信息
  currentVersion: null,           // 当前查看的版本（完整数据）
  versions: [],                   // 版本历史列表
  editors: [],                    // 编辑者列表
  loading: false,
  detailLoading: false,
  versionsLoading: false,
  currentScope: null,
  error: null,

  // ==================== 知识库列表操作 ====================

  getItems: async (scope = null) => {
    set({ loading: true, error: null, currentScope: scope })
    try {
      const params = scope ? { scope } : {}
      const response = await apiClient.get('/wiki/items', { params })
      set({ items: response.data.data || [], loading: false })
      return response.data.data
    } catch (error) {
      set({ error: error.response?.data?.message || '获取列表失败', loading: false })
      message.error(error.response?.data?.message || '获取列表失败')
      throw error
    }
  },

  /**
   * 获取知识库详情（元信息）
   */
  getItem: async (id) => {
    set({ detailLoading: true, error: null })
    try {
      const response = await apiClient.get(`/wiki/items/${id}`)
      const item = response.data.data
      set({ currentItem: item, detailLoading: false })
      return item
    } catch (error) {
      set({ error: error.response?.data?.message || '获取详情失败', detailLoading: false })
      message.error(error.response?.data?.message || '获取详情失败')
      throw error
    }
  },

  createItem: async (data) => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.post('/wiki/items', data)
      const newItem = response.data.data
      set(state => ({ items: [newItem, ...state.items], loading: false }))
      message.success('创建成功')
      return newItem
    } catch (error) {
      set({ error: error.response?.data?.message || '创建失败', loading: false })
      message.error(error.response?.data?.message || '创建失败')
      throw error
    }
  },

  deleteItem: async (id) => {
    set({ loading: true, error: null })
    try {
      await apiClient.delete(`/wiki/items/${id}`)
      set(state => ({
        items: state.items.filter(item => item.id !== id),
        currentItem: state.currentItem?.id === id ? null : state.currentItem,
        currentVersion: state.currentItem?.id === id ? null : state.currentVersion,
        loading: false
      }))
      message.success('删除成功')
      return true
    } catch (error) {
      set({ error: error.response?.data?.message || '删除失败', loading: false })
      message.error(error.response?.data?.message || '删除失败')
      throw error
    }
  },

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
      message.error(error.response?.data?.message || '操作失败')
      throw error
    }
  },

  // ==================== 版本管理（v3.0核心） ====================

  /**
   * 获取版本历史列表
   */
  getVersions: async (wikiId) => {
    set({ versionsLoading: true })
    try {
      const response = await apiClient.get(`/wiki/items/${wikiId}/versions`)
      set({ versions: response.data.data || [], versionsLoading: false })
      return response.data.data
    } catch (error) {
      set({ versionsLoading: false })
      message.error(error.response?.data?.message || '获取版本历史失败')
      throw error
    }
  },

  /**
   * 切换到指定版本（加载完整内容）
   * 这是v3.0的核心：切换版本=切换工作区
   */
  switchToVersion: async (versionId) => {
    set({ detailLoading: true })
    try {
      const response = await apiClient.get(`/wiki/versions/${versionId}`)
      const versionData = response.data.data
      set({ currentVersion: versionData, detailLoading: false })
      return versionData
    } catch (error) {
      set({ detailLoading: false })
      message.error(error.response?.data?.message || '切换版本失败')
      throw error
    }
  },

  /**
   * 保存到当前版本（v3.0核心API）
   * 保存的是currentVersion，不是某个固定的"当前版本"
   */
  saveVersion: async (versionId, data) => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.put(`/wiki/versions/${versionId}`, data)
      const updatedVersion = response.data.data
      
      set(state => ({
        currentVersion: updatedVersion,
        // 同步更新currentItem的标题等信息
        currentItem: state.currentItem ? {
          ...state.currentItem,
          title: updatedVersion.title,
          description: updatedVersion.description,
          current_version: updatedVersion.version_number
        } : null,
        // 更新列表中的条目
        items: state.items.map(item => 
          item.id === updatedVersion.wiki_id 
            ? { ...item, title: updatedVersion.title, current_version: updatedVersion.version_number }
            : item
        ),
        loading: false
      }))
      
      message.success('保存成功')
      return updatedVersion
    } catch (error) {
      set({ error: error.response?.data?.message || '保存失败', loading: false })
      message.error(error.response?.data?.message || '保存失败')
      throw error
    }
  },

  /**
   * 创建新版本（基于当前查看的版本）
   */
  createVersion: async (wikiId, baseVersionId = null) => {
    set({ loading: true })
    try {
      const response = await apiClient.post(`/wiki/items/${wikiId}/version`, {
        base_version_id: baseVersionId
      })
      const result = response.data.data
      
      // 刷新版本列表
      await get().getVersions(wikiId)
      // 切换到新版本
      await get().switchToVersion(result.id)
      
      // 更新currentItem
      set(state => ({
        currentItem: state.currentItem ? {
          ...state.currentItem,
          current_version: result.version_number,
          version_count: (state.currentItem.version_count || 1) + 1
        } : null,
        loading: false
      }))
      
      message.success(`新版本 v${result.version_number} 创建成功`)
      return result
    } catch (error) {
      set({ loading: false })
      message.error(error.response?.data?.message || '创建版本失败')
      throw error
    }
  },

  /**
   * 删除指定版本
   */
  deleteVersion: async (wikiId, versionId) => {
    set({ loading: true })
    try {
      const response = await apiClient.delete(`/wiki/items/${wikiId}/versions/${versionId}`)
      const result = response.data.data
      
      // 刷新版本列表
      await get().getVersions(wikiId)
      
      // 如果删除的是当前查看的版本，切换到最新版本
      const currentVersion = get().currentVersion
      if (currentVersion && currentVersion.id === versionId) {
        const versions = get().versions
        if (versions.length > 0) {
          await get().switchToVersion(versions[0].id)
        }
      }
      
      set(state => ({
        currentItem: state.currentItem ? {
          ...state.currentItem,
          current_version: result.currentVersion,
          version_count: result.versionCount
        } : null,
        loading: false
      }))
      
      message.success(`版本 v${result.deletedVersion} 已删除`)
      return result
    } catch (error) {
      set({ loading: false })
      message.error(error.response?.data?.message || '删除版本失败')
      throw error
    }
  },

  // ==================== 编辑者管理 ====================

  getEditors: async (id) => {
    try {
      const response = await apiClient.get(`/wiki/items/${id}/editors`)
      set({ editors: response.data.data || [] })
      return response.data.data
    } catch (error) {
      message.error(error.response?.data?.message || '获取编辑者列表失败')
      throw error
    }
  },

  addEditor: async (wikiId, userId) => {
    try {
      const response = await apiClient.post(`/wiki/items/${wikiId}/editors`, { user_id: userId })
      set({ editors: response.data.data || [] })
      message.success('添加编辑者成功')
      return response.data.data
    } catch (error) {
      message.error(error.response?.data?.message || '添加编辑者失败')
      throw error
    }
  },

  removeEditor: async (wikiId, userId) => {
    try {
      const response = await apiClient.delete(`/wiki/items/${wikiId}/editors/${userId}`)
      set({ editors: response.data.data || [] })
      message.success('移除编辑者成功')
      return response.data.data
    } catch (error) {
      message.error(error.response?.data?.message || '移除编辑者失败')
      throw error
    }
  },

  // ==================== 辅助方法 ====================

  clearCurrentItem: () => {
    set({ currentItem: null, currentVersion: null, versions: [], editors: [] })
  },

  clearError: () => set({ error: null }),

  reset: () => set({
    items: [],
    currentItem: null,
    currentVersion: null,
    versions: [],
    editors: [],
    loading: false,
    detailLoading: false,
    versionsLoading: false,
    currentScope: null,
    error: null
  })
}))

export default useWikiStore

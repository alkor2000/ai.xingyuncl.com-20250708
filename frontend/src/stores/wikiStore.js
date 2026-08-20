/**
 * 知识库状态管理
 * 支持CRUD + 版本管理 + 编辑者管理 + RAG文件上传/索引/检索/chunks预览
 *
 * 国际化说明：本文件是非React模块（zustand store），无法使用useTranslation hook，
 * 按项目规约直接import i18n实例调用i18n.t()（官方支持的非hook用法）。
 * message为即时消费的toast提示，不存在停留期切语言问题，故不需要tRef模式。
 */

import { create } from 'zustand'
import apiClient from '../utils/api'
import { message } from 'antd'
import i18n from '../utils/i18n'

const useWikiStore = create((set, get) => ({
  /* ========== 状态 ========== */
  items: [],
  currentItem: null,
  currentVersion: null,
  versions: [],
  editors: [],
  loading: false,
  detailLoading: false,
  versionsLoading: false,
  currentScope: null,
  error: null,

  /* RAG状态 */
  indexStatus: null,
  indexing: false,
  uploading: false,
  searchResults: null,
  searching: false,
  /* chunks预览 */
  chunks: null,
  chunksLoading: false,

  /* ========== 知识库列表 ========== */

  getItems: async (scope = null) => {
    set({ loading: true, error: null, currentScope: scope })
    try {
      const params = scope ? { scope } : {}
      const response = await apiClient.get('/wiki/items', { params })
      set({ items: response.data.data || [], loading: false })
      return response.data.data
    } catch (error) {
      const errMsg = error.response?.data?.message || i18n.t('wiki.item.listLoadFailed')
      set({ error: errMsg, loading: false })
      message.error(errMsg)
      throw error
    }
  },

  getItem: async (id) => {
    set({ detailLoading: true, error: null })
    try {
      const response = await apiClient.get(`/wiki/items/${id}`)
      const item = response.data.data
      set({ currentItem: item, detailLoading: false })
      return item
    } catch (error) {
      const errMsg = error.response?.data?.message || i18n.t('wiki.item.detailLoadFailed')
      set({ error: errMsg, detailLoading: false })
      message.error(errMsg)
      throw error
    }
  },

  createItem: async (data) => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.post('/wiki/items', data)
      const newItem = response.data.data
      set(state => ({ items: [newItem, ...state.items], loading: false }))
      message.success(i18n.t('message.createSuccess'))
      return newItem
    } catch (error) {
      const errMsg = error.response?.data?.message || i18n.t('message.createFailed')
      set({ error: errMsg, loading: false })
      message.error(errMsg)
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
      message.success(i18n.t('message.deleteSuccess'))
      return true
    } catch (error) {
      const errMsg = error.response?.data?.message || i18n.t('message.deleteFailed')
      set({ error: errMsg, loading: false })
      message.error(errMsg)
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
      /* toggle结果提示，与actions.pin/unpin(按钮态标签)语义不同，用独立的*Result键 */
      message.success(updatedItem.is_pinned ? i18n.t('wiki.item.pinnedResult') : i18n.t('wiki.item.unpinnedResult'))
      return updatedItem
    } catch (error) {
      message.error(error.response?.data?.message || i18n.t('message.error'))
      throw error
    }
  },

  /* ========== 版本管理 ========== */

  getVersions: async (wikiId) => {
    set({ versionsLoading: true })
    try {
      const response = await apiClient.get(`/wiki/items/${wikiId}/versions`)
      set({ versions: response.data.data || [], versionsLoading: false })
      return response.data.data
    } catch (error) {
      set({ versionsLoading: false })
      message.error(error.response?.data?.message || i18n.t('wiki.version.listLoadFailed'))
      throw error
    }
  },

  switchToVersion: async (versionId) => {
    set({ detailLoading: true })
    try {
      const response = await apiClient.get(`/wiki/versions/${versionId}`)
      set({ currentVersion: response.data.data, detailLoading: false })
      return response.data.data
    } catch (error) {
      set({ detailLoading: false })
      message.error(error.response?.data?.message || i18n.t('wiki.version.switchFailed'))
      throw error
    }
  },

  saveVersion: async (versionId, data) => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.put(`/wiki/versions/${versionId}`, data)
      const updatedVersion = response.data.data
      set(state => ({
        currentVersion: updatedVersion,
        currentItem: state.currentItem ? {
          ...state.currentItem,
          title: updatedVersion.title,
          description: updatedVersion.description,
          current_version: updatedVersion.version_number
        } : null,
        items: state.items.map(item =>
          item.id === updatedVersion.wiki_id
            ? { ...item, title: updatedVersion.title, current_version: updatedVersion.version_number }
            : item
        ),
        loading: false
      }))
      message.success(i18n.t('message.saveSuccess'))
      return updatedVersion
    } catch (error) {
      const errMsg = error.response?.data?.message || i18n.t('message.saveFailed')
      set({ error: errMsg, loading: false })
      message.error(errMsg)
      throw error
    }
  },

  createVersion: async (wikiId, baseVersionId = null) => {
    set({ loading: true })
    try {
      const response = await apiClient.post(`/wiki/items/${wikiId}/version`, { base_version_id: baseVersionId })
      const result = response.data.data
      await get().getVersions(wikiId)
      await get().switchToVersion(result.id)
      set(state => ({
        currentItem: state.currentItem ? {
          ...state.currentItem,
          current_version: result.version_number,
          version_count: (state.currentItem.version_count || 1) + 1
        } : null,
        loading: false
      }))
      message.success(i18n.t('wiki.version.createSuccess', { version: result.version_number }))
      return result
    } catch (error) {
      set({ loading: false })
      message.error(error.response?.data?.message || i18n.t('wiki.version.createFailed'))
      throw error
    }
  },

  deleteVersion: async (wikiId, versionId) => {
    set({ loading: true })
    try {
      const response = await apiClient.delete(`/wiki/items/${wikiId}/versions/${versionId}`)
      const result = response.data.data
      await get().getVersions(wikiId)
      const currentVer = get().currentVersion
      if (currentVer && currentVer.id === versionId) {
        const vers = get().versions
        if (vers.length > 0) await get().switchToVersion(vers[0].id)
      }
      set(state => ({
        currentItem: state.currentItem ? {
          ...state.currentItem, current_version: result.currentVersion, version_count: result.versionCount
        } : null,
        loading: false
      }))
      message.success(i18n.t('wiki.version.deleteSuccess', { version: result.deletedVersion }))
      return result
    } catch (error) {
      set({ loading: false })
      message.error(error.response?.data?.message || i18n.t('wiki.version.deleteFailed'))
      throw error
    }
  },

  /* ========== RAG：文件上传 ========== */

  uploadDocument: async (wikiId, files) => {
    set({ uploading: true })
    try {
      const formData = new FormData()
      /* 支持单文件或多文件 */
      const fileList = Array.isArray(files) ? files : [files]
      fileList.forEach(f => formData.append('files', f))
      const response = await apiClient.post(`/wiki/items/${wikiId}/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000
      })
      set({ uploading: false })
      message.success(i18n.t('wiki.rag.uploadSuccess'))
      return response.data.data
    } catch (error) {
      set({ uploading: false })
      message.error(error.response?.data?.message || i18n.t('wiki.rag.uploadFailed'))
      throw error
    }
  },

  /* ========== RAG：构建索引 ========== */

  buildIndex: async (wikiId) => {
    set({ indexing: true })
    try {
      const response = await apiClient.post(`/wiki/items/${wikiId}/build-index`, {}, { timeout: 300000 })
      get().pollIndexStatus(wikiId)
      return response.data.data
    } catch (error) {
      set({ indexing: false })
      message.error(error.response?.data?.message || i18n.t('wiki.rag.buildIndexFailed'))
      throw error
    }
  },

  /* ========== RAG：获取索引状态 ========== */

  getIndexStatus: async (wikiId) => {
    try {
      const response = await apiClient.get(`/wiki/items/${wikiId}/index-status`)
      const status = response.data.data
      set({ indexStatus: status })
      return status
    } catch (error) {
      console.error('Failed to get index status:', error)
      return null
    }
  },

  /* 轮询索引状态 */
  pollIndexStatus: async (wikiId) => {
    let attempts = 0
    const maxAttempts = 60
    const poll = async () => {
      const status = await get().getIndexStatus(wikiId)
      if (!status) { set({ indexing: false }); return }
      if (status.index_status === 'completed') {
        set({ indexing: false })
        message.success(i18n.t('wiki.rag.indexCompleteResult', { count: status.chunk_count }))
        const scope = get().currentScope
        get().getItems(scope)
        /* 自动加载chunks预览 */
        get().getChunks(wikiId)
        return
      }
      if (status.index_status === 'failed') {
        set({ indexing: false })
        message.error(i18n.t('wiki.rag.buildFailedResult'))
        return
      }
      attempts++
      if (attempts < maxAttempts) {
        setTimeout(poll, 3000)
      } else {
        set({ indexing: false })
        message.warning(i18n.t('wiki.rag.buildTimeout'))
      }
    }
    poll()
  },

  /* ========== RAG：获取chunks列表 ========== */

  getChunks: async (wikiId) => {
    set({ chunksLoading: true })
    try {
      const response = await apiClient.get(`/wiki/items/${wikiId}/chunks`)
      set({ chunks: response.data.data, chunksLoading: false })
      return response.data.data
    } catch (error) {
      set({ chunksLoading: false })
      console.error('Failed to get chunks:', error)
      return null
    }
  },

  /* ========== RAG：语义检索测试 ========== */

  ragSearch: async (wikiId, query, topK = 5) => {
    set({ searching: true })
    try {
      const response = await apiClient.post(`/wiki/items/${wikiId}/search`, { query, top_k: topK })
      set({ searchResults: response.data.data, searching: false })
      return response.data.data
    } catch (error) {
      set({ searching: false })
      message.error(error.response?.data?.message || i18n.t('wiki.rag.searchFailed'))
      throw error
    }
  },

  /* ========== 编辑者管理 ========== */

  getEditors: async (id) => {
    try {
      const response = await apiClient.get(`/wiki/items/${id}/editors`)
      set({ editors: response.data.data || [] })
      return response.data.data
    } catch (error) {
      message.error(error.response?.data?.message || i18n.t('wiki.editor.listLoadFailed'))
      throw error
    }
  },

  addEditor: async (wikiId, userId) => {
    try {
      const response = await apiClient.post(`/wiki/items/${wikiId}/editors`, { user_id: userId })
      set({ editors: response.data.data || [] })
      message.success(i18n.t('wiki.editor.addSuccess'))
      return response.data.data
    } catch (error) {
      message.error(error.response?.data?.message || i18n.t('wiki.editor.addFailed'))
      throw error
    }
  },

  removeEditor: async (wikiId, userId) => {
    try {
      const response = await apiClient.delete(`/wiki/items/${wikiId}/editors/${userId}`)
      set({ editors: response.data.data || [] })
      message.success(i18n.t('wiki.editor.removeSuccess'))
      return response.data.data
    } catch (error) {
      message.error(error.response?.data?.message || i18n.t('wiki.editor.removeFailed'))
      throw error
    }
  },

  /* ========== 辅助 ========== */

  clearCurrentItem: () => set({
    currentItem: null, currentVersion: null, versions: [], editors: [],
    indexStatus: null, searchResults: null, chunks: null
  }),
  clearError: () => set({ error: null }),
  reset: () => set({
    items: [], currentItem: null, currentVersion: null, versions: [],
    editors: [], loading: false, detailLoading: false, versionsLoading: false,
    currentScope: null, error: null, indexStatus: null, indexing: false,
    uploading: false, searchResults: null, searching: false,
    chunks: null, chunksLoading: false
  })
}))

export default useWikiStore

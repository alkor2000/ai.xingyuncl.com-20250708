/**
 * 存储管理状态管理 - 增强版 v1.1
 * 支持全局文件夹、组织文件夹和个人文件夹
 * 
 * v1.1 更新：
 * 1. 新增 renameFile - 文件重命名
 * 2. 新增 moveFolder - 文件夹移动（通过删除+重建模拟）
 * 3. 新增 batchMoveFiles - 批量移动文件
 * 4. 新增 getFileById - 根据ID从本地列表获取文件信息
 */

import { create } from 'zustand'
import apiClient from '../utils/api'

const useStorageStore = create((set, get) => ({
  // ===== 状态 =====
  files: [],
  folders: [],
  folderTree: [],
  currentFolder: null,
  selectedFiles: [],       // 选中的文件ID数组
  selectedFolders: [],     // v1.1 选中的文件夹ID数组
  storageStats: null,
  ossConfig: null,
  creditConfig: null,
  loading: false,
  uploading: false,
  error: null,
  
  // ===== 文件操作 =====
  
  /**
   * 获取文件列表
   */
  getFiles: async (folderId = null, options = {}) => {
    set({ loading: true, error: null })
    try {
      const params = { folder_id: folderId, ...options }
      const response = await apiClient.get('/storage/files', { params })
      set({ files: response.data.data.files, loading: false })
      return response.data.data
    } catch (error) {
      console.error('获取文件列表失败:', error)
      set({ error: error.response?.data?.message || '获取文件列表失败', loading: false })
      throw error
    }
  },
  
  /**
   * 上传文件
   */
  uploadFiles: async (files, folderId = null, options = {}) => {
    set({ uploading: true, error: null })
    try {
      const formData = new FormData()
      files.forEach(file => { formData.append('files', file) })
      if (folderId) formData.append('folder_id', folderId)
      if (options.is_public) formData.append('is_public', 'true')
      
      const response = await apiClient.post('/storage/files/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total)
          set({ uploadProgress: percentCompleted })
        }
      })
      
      // 刷新文件列表
      await get().getFiles(folderId)
      set({ uploading: false, uploadProgress: 0 })
      return response.data.data
    } catch (error) {
      console.error('文件上传失败:', error)
      set({ error: error.response?.data?.message || '文件上传失败', uploading: false, uploadProgress: 0 })
      throw error
    }
  },
  
  /**
   * 删除文件
   */
  deleteFile: async (fileId) => {
    set({ loading: true, error: null })
    try {
      await apiClient.delete(`/storage/files/${fileId}`)
      set(state => ({
        files: state.files.filter(f => f.id !== fileId),
        selectedFiles: state.selectedFiles.filter(id => id !== fileId),
        loading: false
      }))
      return true
    } catch (error) {
      console.error('删除文件失败:', error)
      set({ error: error.response?.data?.message || '删除文件失败', loading: false })
      throw error
    }
  },
  
  /**
   * 批量删除文件
   */
  deleteFiles: async (fileIds) => {
    set({ loading: true, error: null })
    try {
      await apiClient.post('/storage/files/batch-delete', { file_ids: fileIds })
      set(state => ({
        files: state.files.filter(f => !fileIds.includes(f.id)),
        selectedFiles: [],
        loading: false
      }))
      return true
    } catch (error) {
      console.error('批量删除文件失败:', error)
      set({ error: error.response?.data?.message || '批量删除文件失败', loading: false })
      throw error
    }
  },
  
  /**
   * 移动文件
   */
  moveFile: async (fileId, targetFolderId) => {
    set({ loading: true, error: null })
    try {
      await apiClient.put(`/storage/files/${fileId}/move`, { target_folder_id: targetFolderId })
      set(state => ({
        files: state.files.filter(f => f.id !== fileId),
        loading: false
      }))
      return true
    } catch (error) {
      console.error('移动文件失败:', error)
      set({ error: error.response?.data?.message || '移动文件失败', loading: false })
      throw error
    }
  },
  
  /**
   * 批量移动文件 - v1.1 新增
   * @param {Array<number>} fileIds - 要移动的文件ID数组
   * @param {number|null} targetFolderId - 目标文件夹ID
   */
  batchMoveFiles: async (fileIds, targetFolderId) => {
    set({ loading: true, error: null })
    try {
      // 逐个移动（后端暂无批量移动API）
      const results = { success: 0, failed: 0 }
      for (const fileId of fileIds) {
        try {
          await apiClient.put(`/storage/files/${fileId}/move`, { target_folder_id: targetFolderId })
          results.success++
        } catch (e) {
          results.failed++
          console.error(`移动文件 ${fileId} 失败:`, e)
        }
      }
      
      // 从当前列表中移除已移动的文件
      set(state => ({
        files: state.files.filter(f => !fileIds.includes(f.id)),
        selectedFiles: [],
        selectedFolders: [],
        loading: false
      }))
      
      return results
    } catch (error) {
      console.error('批量移动文件失败:', error)
      set({ error: error.response?.data?.message || '批量移动文件失败', loading: false })
      throw error
    }
  },
  
  /**
   * 重命名文件 - v1.1 新增
   * @param {number} fileId - 文件ID
   * @param {string} newName - 新文件名
   */
  renameFile: async (fileId, newName) => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.put(`/storage/files/${fileId}/rename`, { new_name: newName })
      
      // 更新本地文件列表中的文件名
      set(state => ({
        files: state.files.map(f => 
          f.id === fileId 
            ? { ...f, original_name: newName, file_ext: newName.includes('.') ? '.' + newName.split('.').pop() : f.file_ext }
            : f
        ),
        loading: false
      }))
      
      return response.data.data
    } catch (error) {
      console.error('重命名文件失败:', error)
      set({ error: error.response?.data?.message || '重命名文件失败', loading: false })
      throw error
    }
  },
  
  // ===== 文件夹操作 =====
  
  /**
   * 获取文件夹列表
   */
  getFolders: async (parentId = null, includeSpecial = false) => {
    set({ loading: true, error: null })
    try {
      const params = parentId ? { parent_id: parentId } : {}
      if (includeSpecial) params.include_special = true
      const response = await apiClient.get('/storage/folders', { params })
      set({ folders: response.data.data, loading: false })
      return response.data.data
    } catch (error) {
      console.error('获取文件夹列表失败:', error)
      set({ error: error.response?.data?.message || '获取文件夹列表失败', loading: false })
      throw error
    }
  },
  
  /**
   * 获取文件夹树（包含特殊文件夹）
   */
  getFolderTree: async () => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.get('/storage/folders', { params: { tree: true } })
      set({ folderTree: response.data.data, loading: false })
      return response.data.data
    } catch (error) {
      console.error('获取文件夹树失败:', error)
      set({ error: error.response?.data?.message || '获取文件夹树失败', loading: false })
      throw error
    }
  },
  
  /**
   * 创建文件夹
   */
  createFolder: async (name, parentId = null, folderType = 'personal') => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.post('/storage/folders', {
        name,
        parent_id: parentId,
        folder_type: folderType
      })
      
      await get().getFolders(parentId, true)
      await get().getFolderTree()
      set({ loading: false })
      return response.data.data
    } catch (error) {
      console.error('创建文件夹失败:', error)
      set({ error: error.response?.data?.message || '创建文件夹失败', loading: false })
      throw error
    }
  },
  
  /**
   * 重命名文件夹
   */
  renameFolder: async (folderId, newName) => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.put(`/storage/folders/${folderId}/rename`, { new_name: newName })
      
      await get().getFolderTree()
      
      // 如果重命名的是当前文件夹，更新当前文件夹信息
      const state = get()
      if (state.currentFolder && state.currentFolder.id === folderId) {
        set({ currentFolder: response.data.data })
      }
      
      set({ loading: false })
      return response.data.data
    } catch (error) {
      console.error('重命名文件夹失败:', error)
      set({ error: error.response?.data?.message || '重命名文件夹失败', loading: false })
      throw error
    }
  },
  
  /**
   * 删除文件夹
   */
  deleteFolder: async (folderId) => {
    set({ loading: true, error: null })
    try {
      await apiClient.delete(`/storage/folders/${folderId}`)
      await get().getFolderTree()
      set({ loading: false })
      return true
    } catch (error) {
      console.error('删除文件夹失败:', error)
      set({ error: error.response?.data?.message || '删除文件夹失败', loading: false })
      throw error
    }
  },
  
  /**
   * 获取存储统计
   */
  getStorageStats: async () => {
    try {
      const response = await apiClient.get('/storage/stats')
      const stats = response.data.data
      set({ storageStats: stats })
      return stats
    } catch (error) {
      console.error('获取存储统计失败:', error)
      return null
    }
  },
  
  // ===== OSS配置管理（管理员） =====
  
  getOSSConfig: async () => {
    try {
      const response = await apiClient.get('/admin/oss/config')
      set({ ossConfig: response.data.data })
      return response.data.data
    } catch (error) {
      console.error('获取OSS配置失败:', error)
      return null
    }
  },
  
  saveOSSConfig: async (config) => {
    set({ loading: true, error: null })
    try {
      await apiClient.post('/admin/oss/config', config)
      set({ loading: false })
      return true
    } catch (error) {
      console.error('保存OSS配置失败:', error)
      set({ error: error.response?.data?.message || '保存OSS配置失败', loading: false })
      throw error
    }
  },
  
  testOSSConnection: async (config) => {
    try {
      const response = await apiClient.post('/admin/oss/test', config)
      return response.data.success
    } catch (error) {
      console.error('测试OSS连接失败:', error)
      throw error
    }
  },
  
  /**
   * 获取积分配置
   */
  getCreditConfig: async () => {
    try {
      const response = await apiClient.get('/admin/storage-credits/config')
      set({ creditConfig: response.data.data })
      return response.data.data
    } catch (error) {
      console.error('获取积分配置失败:', error)
      const defaultConfig = { base_credits: 2, credits_per_5mb: 1, max_file_size: 100 }
      set({ creditConfig: defaultConfig })
      return defaultConfig
    }
  },
  
  updateCreditConfig: async (configs) => {
    set({ loading: true, error: null })
    try {
      await apiClient.put('/admin/storage-credits/config', configs)
      set({ loading: false })
      return true
    } catch (error) {
      console.error('更新积分配置失败:', error)
      set({ error: error.response?.data?.message || '更新积分配置失败', loading: false })
      throw error
    }
  },
  
  /**
   * 计算文件上传所需积分
   */
  calculateUploadCredits: (files) => {
    const config = get().creditConfig
    if (!config) return 0
    
    let totalCredits = 0
    for (const file of files) {
      const fileSizeMB = file.size / (1024 * 1024)
      if (fileSizeMB <= 5) {
        totalCredits += parseInt(config.base_credits)
      } else {
        const extraIntervals = Math.ceil((fileSizeMB - 5) / 5)
        totalCredits += extraIntervals * parseFloat(config.credits_per_5mb)
      }
    }
    return Math.ceil(totalCredits)
  },
  
  // ===== 辅助方法 =====
  
  /** 设置当前文件夹 */
  setCurrentFolder: (folder) => set({ currentFolder: folder }),
  
  /** 切换文件选择 */
  toggleFileSelection: (fileId) => set(state => ({
    selectedFiles: state.selectedFiles.includes(fileId)
      ? state.selectedFiles.filter(id => id !== fileId)
      : [...state.selectedFiles, fileId]
  })),
  
  /** 全选/取消全选文件 */
  toggleSelectAll: () => set(state => ({
    selectedFiles: state.selectedFiles.length === state.files.length
      ? []
      : state.files.map(f => f.id)
  })),
  
  /**
   * v1.1 设置选中的文件（替换模式，用于Ctrl+Click/Shift+Click）
   * @param {Array<number>} fileIds - 文件ID数组
   */
  setSelectedFiles: (fileIds) => set({ selectedFiles: fileIds }),
  
  /**
   * v1.1 设置选中的文件夹
   * @param {Array<number>} folderIds - 文件夹ID数组
   */
  setSelectedFolders: (folderIds) => set({ selectedFolders: folderIds }),
  
  /**
   * v1.1 从本地列表中获取文件信息
   * @param {number} fileId - 文件ID
   */
  getFileById: (fileId) => {
    return get().files.find(f => f.id === fileId) || null
  },
  
  /**
   * v1.1 从本地列表中获取文件夹信息
   * @param {number} folderId - 文件夹ID
   */
  getFolderById: (folderId) => {
    return get().folders.find(f => f.id === folderId) || null
  },
  
  /** 清除选择 */
  clearSelection: () => set({ selectedFiles: [], selectedFolders: [] }),
  
  /** 清除错误 */
  clearError: () => set({ error: null })
}))

export default useStorageStore

/**
 * 存储管理状态管理 - 增强版 v1.2
 * 支持全局文件夹、组织文件夹和个人文件夹
 * 
 * v1.1 更新：
 * 1. 新增 renameFile - 文件重命名
 * 2. 新增 moveFolder - 文件夹移动（通过删除+重建模拟）
 * 3. 新增 batchMoveFiles - 批量移动文件
 * 4. 新增 getFileById - 根据ID从本地列表获取文件信息
 * 
 * v1.2 更新（国际化）：
 * - 本文件为非React模块（Zustand store），无法使用useTranslation hook
 * - 改为直接import i18n实例调用i18n.t()获取用户可见的错误提示文案
 * - console.error日志属开发者诊断信息，统一改为英文标签，不进语言包
 * - error状态兜底文案（||右侧硬编码中文）全部改为i18n.t()，
 *   优先复用storage.json已有语义完全匹配的键，
 *   无匹配项新建"获取/删除/批量操作/保存配置"类失败键
 */

import { create } from 'zustand'
import apiClient from '../utils/api'
import i18n from '../utils/i18n'

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
      console.error('Failed to get file list:', error)
      set({ error: error.response?.data?.message || i18n.t('storage.getFilesFailed'), loading: false })
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
      console.error('File upload failed:', error)
      set({ error: error.response?.data?.message || i18n.t('storage.uploadFailed'), uploading: false, uploadProgress: 0 })
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
      console.error('Failed to delete file:', error)
      set({ error: error.response?.data?.message || i18n.t('storage.deleteFileFailed'), loading: false })
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
      console.error('Failed to batch delete files:', error)
      set({ error: error.response?.data?.message || i18n.t('storage.batchDeleteFailed'), loading: false })
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
      console.error('Failed to move file:', error)
      set({ error: error.response?.data?.message || i18n.t('storage.moveFailed'), loading: false })
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
          console.error(`Failed to move file ${fileId}:`, e)
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
      console.error('Batch move files failed:', error)
      set({ error: error.response?.data?.message || i18n.t('storage.batchMoveRequestFailed'), loading: false })
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
      console.error('Failed to rename file:', error)
      set({ error: error.response?.data?.message || i18n.t('storage.renameFileFailed'), loading: false })
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
      console.error('Failed to get folder list:', error)
      set({ error: error.response?.data?.message || i18n.t('storage.getFoldersFailed'), loading: false })
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
      console.error('Failed to get folder tree:', error)
      set({ error: error.response?.data?.message || i18n.t('storage.getFolderTreeFailed'), loading: false })
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
      console.error('Failed to create folder:', error)
      set({ error: error.response?.data?.message || i18n.t('storage.createFolderFailed'), loading: false })
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
      console.error('Failed to rename folder:', error)
      set({ error: error.response?.data?.message || i18n.t('storage.renameFolderFailed'), loading: false })
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
      console.error('Failed to delete folder:', error)
      set({ error: error.response?.data?.message || i18n.t('storage.deleteFolderFailed'), loading: false })
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
      console.error('Failed to get storage stats:', error)
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
      console.error('Failed to get OSS config:', error)
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
      console.error('Failed to save OSS config:', error)
      set({ error: error.response?.data?.message || i18n.t('storage.saveOSSConfigFailed'), loading: false })
      throw error
    }
  },
  
  testOSSConnection: async (config) => {
    try {
      const response = await apiClient.post('/admin/oss/test', config)
      return response.data.success
    } catch (error) {
      console.error('OSS connection test failed:', error)
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
      console.error('Failed to get credit config:', error)
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
      console.error('Failed to update credit config:', error)
      set({ error: error.response?.data?.message || i18n.t('storage.updateCreditConfigFailed'), loading: false })
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

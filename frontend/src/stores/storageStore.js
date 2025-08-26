/**
 * 存储管理状态管理
 */

import { create } from 'zustand'
import apiClient from '../utils/api'

const useStorageStore = create((set, get) => ({
  // 状态
  files: [],
  folders: [],
  folderTree: [],
  currentFolder: null,
  selectedFiles: [],
  storageStats: null,
  ossConfig: null,
  creditConfig: null,
  loading: false,
  uploading: false,
  error: null,
  
  // 文件操作
  
  /**
   * 获取文件列表
   */
  getFiles: async (folderId = null, options = {}) => {
    set({ loading: true, error: null })
    try {
      const params = {
        folder_id: folderId,
        ...options
      }
      const response = await apiClient.get('/storage/files', { params })
      set({ 
        files: response.data.data.files,
        loading: false 
      })
      return response.data.data
    } catch (error) {
      console.error('获取文件列表失败:', error)
      set({ 
        error: error.response?.data?.message || '获取文件列表失败',
        loading: false 
      })
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
      files.forEach(file => {
        formData.append('files', file)
      })
      if (folderId) {
        formData.append('folder_id', folderId)
      }
      if (options.is_public) {
        formData.append('is_public', 'true')
      }
      
      const response = await apiClient.post('/storage/files/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        },
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
      set({ 
        error: error.response?.data?.message || '文件上传失败',
        uploading: false,
        uploadProgress: 0
      })
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
      
      // 从列表中移除
      set(state => ({
        files: state.files.filter(f => f.id !== fileId),
        selectedFiles: state.selectedFiles.filter(id => id !== fileId),
        loading: false
      }))
      
      return true
    } catch (error) {
      console.error('删除文件失败:', error)
      set({ 
        error: error.response?.data?.message || '删除文件失败',
        loading: false 
      })
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
      
      // 从列表中移除
      set(state => ({
        files: state.files.filter(f => !fileIds.includes(f.id)),
        selectedFiles: [],
        loading: false
      }))
      
      return true
    } catch (error) {
      console.error('批量删除文件失败:', error)
      set({ 
        error: error.response?.data?.message || '批量删除文件失败',
        loading: false 
      })
      throw error
    }
  },
  
  /**
   * 移动文件
   */
  moveFile: async (fileId, targetFolderId) => {
    set({ loading: true, error: null })
    try {
      await apiClient.put(`/storage/files/${fileId}/move`, {
        target_folder_id: targetFolderId
      })
      
      // 从当前列表中移除
      set(state => ({
        files: state.files.filter(f => f.id !== fileId),
        loading: false
      }))
      
      return true
    } catch (error) {
      console.error('移动文件失败:', error)
      set({ 
        error: error.response?.data?.message || '移动文件失败',
        loading: false 
      })
      throw error
    }
  },
  
  // 文件夹操作
  
  /**
   * 获取文件夹列表
   */
  getFolders: async (parentId = null) => {
    set({ loading: true, error: null })
    try {
      const params = parentId ? { parent_id: parentId } : {}
      const response = await apiClient.get('/storage/folders', { params })
      set({ 
        folders: response.data.data,
        loading: false 
      })
      return response.data.data
    } catch (error) {
      console.error('获取文件夹列表失败:', error)
      set({ 
        error: error.response?.data?.message || '获取文件夹列表失败',
        loading: false 
      })
      throw error
    }
  },
  
  /**
   * 获取文件夹树
   */
  getFolderTree: async () => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.get('/storage/folders', { params: { tree: true } })
      set({ 
        folderTree: response.data.data,
        loading: false 
      })
      return response.data.data
    } catch (error) {
      console.error('获取文件夹树失败:', error)
      set({ 
        error: error.response?.data?.message || '获取文件夹树失败',
        loading: false 
      })
      throw error
    }
  },
  
  /**
   * 创建文件夹
   */
  createFolder: async (name, parentId = null) => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.post('/storage/folders', {
        name,
        parent_id: parentId
      })
      
      // 刷新文件夹列表
      await get().getFolders(parentId)
      await get().getFolderTree()
      
      set({ loading: false })
      return response.data.data
    } catch (error) {
      console.error('创建文件夹失败:', error)
      set({ 
        error: error.response?.data?.message || '创建文件夹失败',
        loading: false 
      })
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
      
      // 刷新文件夹列表
      await get().getFolderTree()
      
      set({ loading: false })
      return true
    } catch (error) {
      console.error('删除文件夹失败:', error)
      set({ 
        error: error.response?.data?.message || '删除文件夹失败',
        loading: false 
      })
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
  
  // OSS配置管理（管理员）
  
  /**
   * 获取OSS配置
   */
  getOSSConfig: async () => {
    try {
      const response = await apiClient.get('/admin/oss/config')
      const config = response.data.data
      set({ ossConfig: config })
      return config
    } catch (error) {
      console.error('获取OSS配置失败:', error)
      return null
    }
  },
  
  /**
   * 保存OSS配置
   */
  saveOSSConfig: async (config) => {
    set({ loading: true, error: null })
    try {
      await apiClient.post('/admin/oss/config', config)
      set({ loading: false })
      return true
    } catch (error) {
      console.error('保存OSS配置失败:', error)
      set({ 
        error: error.response?.data?.message || '保存OSS配置失败',
        loading: false 
      })
      throw error
    }
  },
  
  /**
   * 测试OSS连接
   */
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
      const response = await apiClient.get('/admin/oss/credit-config')
      const config = response.data.data
      set({ creditConfig: config })
      return config
    } catch (error) {
      console.error('获取积分配置失败:', error)
      return null
    }
  },
  
  /**
   * 更新积分配置
   */
  updateCreditConfig: async (configs) => {
    set({ loading: true, error: null })
    try {
      await apiClient.put('/admin/oss/credit-config', { configs })
      set({ loading: false })
      return true
    } catch (error) {
      console.error('更新积分配置失败:', error)
      set({ 
        error: error.response?.data?.message || '更新积分配置失败',
        loading: false 
      })
      throw error
    }
  },
  
  // 辅助方法
  
  /**
   * 设置当前文件夹
   */
  setCurrentFolder: (folder) => set({ currentFolder: folder }),
  
  /**
   * 切换文件选择
   */
  toggleFileSelection: (fileId) => set(state => ({
    selectedFiles: state.selectedFiles.includes(fileId)
      ? state.selectedFiles.filter(id => id !== fileId)
      : [...state.selectedFiles, fileId]
  })),
  
  /**
   * 全选/取消全选
   */
  toggleSelectAll: () => set(state => ({
    selectedFiles: state.selectedFiles.length === state.files.length
      ? []
      : state.files.map(f => f.id)
  })),
  
  /**
   * 清除选择
   */
  clearSelection: () => set({ selectedFiles: [] }),
  
  /**
   * 清除错误
   */
  clearError: () => set({ error: null })
}))

export default useStorageStore

/**
 * 管理员状态管理
 */

import { create } from 'zustand'
import apiClient from '../utils/api'

const useAdminStore = create((set, get) => ({
  // 状态
  users: [],
  userDetail: null,
  aiModels: [],
  modules: [],
  systemStats: {},
  systemSettings: {},
  loading: false,
  
  // 获取系统统计
  getSystemStats: async () => {
    set({ loading: true })
    try {
      const response = await apiClient.get('/admin/stats')
      set({ 
        systemStats: response.data.data,
        loading: false 
      })
    } catch (error) {
      console.error('获取系统统计失败:', error)
      set({ loading: false })
      throw error
    }
  },
  
  // 获取用户列表
  getUsers: async (params = {}) => {
    set({ loading: true })
    try {
      const response = await apiClient.get('/admin/users', { params })
      set({ 
        users: response.data.data,
        loading: false 
      })
      return response.data
    } catch (error) {
      console.error('获取用户列表失败:', error)
      set({ loading: false })
      throw error
    }
  },
  
  // 获取用户详情
  getUserDetail: async (userId) => {
    set({ loading: true })
    try {
      const response = await apiClient.get(`/admin/users/${userId}`)
      set({ 
        userDetail: response.data.data,
        loading: false 
      })
      return response.data.data
    } catch (error) {
      console.error('获取用户详情失败:', error)
      set({ loading: false })
      throw error
    }
  },
  
  // 创建用户
  createUser: async (userData) => {
    try {
      const response = await apiClient.post('/admin/users', userData)
      const newUser = response.data.data
      
      set(state => ({
        users: [newUser, ...state.users]
      }))
      
      return newUser
    } catch (error) {
      console.error('创建用户失败:', error)
      throw error
    }
  },
  
  // 更新用户
  updateUser: async (userId, userData) => {
    try {
      const response = await apiClient.put(`/admin/users/${userId}`, userData)
      const updatedUser = response.data.data
      
      set(state => ({
        users: state.users.map(user => 
          user.id === userId ? updatedUser : user
        ),
        userDetail: state.userDetail?.user.id === userId 
          ? { ...state.userDetail, user: updatedUser }
          : state.userDetail
      }))
      
      return updatedUser
    } catch (error) {
      console.error('更新用户失败:', error)
      throw error
    }
  },
  
  // 删除用户
  deleteUser: async (userId) => {
    try {
      await apiClient.delete(`/admin/users/${userId}`)
      
      set(state => ({
        users: state.users.filter(user => user.id !== userId),
        userDetail: state.userDetail?.user.id === userId ? null : state.userDetail
      }))
    } catch (error) {
      console.error('删除用户失败:', error)
      throw error
    }
  },
  
  // 获取AI模型列表
  getAIModels: async () => {
    set({ loading: true })
    try {
      const response = await apiClient.get('/admin/models')
      set({ 
        aiModels: response.data.data,
        loading: false 
      })
    } catch (error) {
      console.error('获取AI模型列表失败:', error)
      set({ loading: false })
      throw error
    }
  },
  
  // 创建AI模型
  createAIModel: async (modelData) => {
    try {
      const response = await apiClient.post('/admin/models', modelData)
      const newModel = response.data.data
      
      set(state => ({
        aiModels: [...state.aiModels, newModel]
      }))
      
      return newModel
    } catch (error) {
      console.error('创建AI模型失败:', error)
      throw error
    }
  },
  
  // 更新AI模型
  updateAIModel: async (modelId, modelData) => {
    try {
      const response = await apiClient.put(`/admin/models/${modelId}`, modelData)
      const updatedModel = response.data.data
      
      set(state => ({
        aiModels: state.aiModels.map(model => 
          model.id === modelId ? updatedModel : model
        )
      }))
      
      return updatedModel
    } catch (error) {
      console.error('更新AI模型失败:', error)
      throw error
    }
  },
  
  // 删除AI模型
  deleteAIModel: async (modelId) => {
    try {
      await apiClient.delete(`/admin/models/${modelId}`)
      
      set(state => ({
        aiModels: state.aiModels.filter(model => model.id !== modelId)
      }))
    } catch (error) {
      console.error('删除AI模型失败:', error)
      throw error
    }
  },
  
  // 测试AI模型连通性
  testAIModel: async (modelId) => {
    try {
      const response = await apiClient.post(`/admin/models/${modelId}/test`)
      
      // 刷新模型列表以获取最新状态
      await get().getAIModels()
      
      return response.data
    } catch (error) {
      console.error('测试AI模型失败:', error)
      throw error
    }
  },

  // 获取系统模块列表
  getModules: async () => {
    set({ loading: true })
    try {
      const response = await apiClient.get('/admin/modules')
      set({ 
        modules: response.data.data,
        loading: false 
      })
    } catch (error) {
      console.error('获取系统模块列表失败:', error)
      set({ loading: false })
      throw error
    }
  },

  // 创建系统模块
  createModule: async (moduleData) => {
    try {
      const response = await apiClient.post('/admin/modules', moduleData)
      const newModule = response.data.data
      
      set(state => ({
        modules: [...state.modules, newModule]
      }))
      
      return newModule
    } catch (error) {
      console.error('创建系统模块失败:', error)
      throw error
    }
  },

  // 更新系统模块  
  updateModule: async (moduleId, moduleData) => {
    try {
      const response = await apiClient.put(`/admin/modules/${moduleId}`, moduleData)
      const updatedModule = response.data.data
      
      set(state => ({
        modules: state.modules.map(module => 
          module.id === moduleId ? updatedModule : module
        )
      }))
      
      return updatedModule
    } catch (error) {
      console.error('更新系统模块失败:', error)
      throw error
    }
  },

  // 删除系统模块
  deleteModule: async (moduleId) => {
    try {
      await apiClient.delete(`/admin/modules/${moduleId}`)
      
      set(state => ({
        modules: state.modules.filter(module => module.id !== moduleId)
      }))
    } catch (error) {
      console.error('删除系统模块失败:', error)
      throw error
    }
  },

  // 检查模块健康状态
  checkModuleHealth: async (moduleId) => {
    try {
      const response = await apiClient.post(`/admin/modules/${moduleId}/health-check`)
      
      // 更新模块状态
      set(state => ({
        modules: state.modules.map(module => 
          module.id === moduleId 
            ? { ...module, status: response.data.data.status, last_check_at: response.data.data.checked_at }
            : module
        )
      }))
      
      return response.data
    } catch (error) {
      console.error('检查模块健康状态失败:', error)
      throw error
    }
  },
  
  // 获取系统设置
  getSystemSettings: async () => {
    set({ loading: true })
    try {
      const response = await apiClient.get('/admin/settings')
      set({ 
        systemSettings: response.data.data,
        loading: false 
      })
    } catch (error) {
      console.error('获取系统设置失败:', error)
      set({ loading: false })
      throw error
    }
  },
  
  // 更新系统设置
  updateSystemSettings: async (settings) => {
    try {
      const response = await apiClient.put('/admin/settings', settings)
      set({ systemSettings: response.data.data })
      return response.data.data
    } catch (error) {
      console.error('更新系统设置失败:', error)
      throw error
    }
  },
  
  // 重置状态
  reset: () => {
    set({
      users: [],
      userDetail: null,
      aiModels: [],
      modules: [],
      systemStats: {},
      systemSettings: {},
      loading: false
    })
  }
}))

export default useAdminStore

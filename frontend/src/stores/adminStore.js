import { create } from 'zustand'
import apiClient from '../utils/api'

const useAdminStore = create((set, get) => ({
  // 状态
  users: [],
  userDetail: null,
  aiModels: [],
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
  
  // 测试AI模型连通性
  testAIModel: async (modelId) => {
    try {
      const response = await apiClient.post(`/admin/models/${modelId}/test`)
      return response.data
    } catch (error) {
      console.error('测试AI模型失败:', error)
      // 如果是401错误，可能是token过期，抛出具体错误信息
      if (error.response?.status === 401) {
        throw new Error('认证失败，请重新登录')
      }
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
      systemStats: {},
      systemSettings: {},
      loading: false
    })
  }
}))

export default useAdminStore

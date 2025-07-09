/**
 * 管理员状态管理 - 支持用户分组管理和积分管理
 */

import { create } from 'zustand'
import apiClient from '../utils/api'

const useAdminStore = create((set, get) => ({
  // 状态
  users: [],
  userDetail: null,
  userGroups: [],
  aiModels: [],
  modules: [],
  systemStats: {},
  systemSettings: {},
  loading: false,
  
  // 积分管理状态
  userCredits: {},
  creditsHistory: {},
  creditsLoading: false,
  
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
  
  // 获取用户列表 (支持分组过滤)
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
  
  // 创建用户 (支持分组设置)
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
  
  // 更新用户 (支持分组更新)
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

  // ===== 积分管理方法 (新增核心功能) =====

  /**
   * 获取用户积分信息
   */
  getUserCredits: async (userId) => {
    set({ creditsLoading: true })
    try {
      const response = await apiClient.get(`/admin/users/${userId}/credits`)
      
      set(state => ({
        userCredits: {
          ...state.userCredits,
          [userId]: response.data.data
        },
        creditsLoading: false
      }))
      
      return response.data.data
    } catch (error) {
      console.error('获取用户积分信息失败:', error)
      set({ creditsLoading: false })
      throw error
    }
  },

  /**
   * 设置用户积分配额
   */
  setUserCreditsQuota: async (userId, credits_quota, reason = '管理员调整配额') => {
    try {
      const response = await apiClient.put(`/admin/users/${userId}/credits`, {
        credits_quota,
        reason
      })
      
      // 更新本地状态
      set(state => ({
        userCredits: {
          ...state.userCredits,
          [userId]: {
            ...state.userCredits[userId],
            credits_quota: response.data.data.newQuota,
            credits_stats: {
              ...state.userCredits[userId]?.credits_stats,
              quota: response.data.data.newQuota,
              remaining: response.data.data.balanceAfter
            }
          }
        },
        // 同时更新用户列表中的数据
        users: state.users.map(user => 
          user.id === userId ? { ...user, credits_quota: response.data.data.newQuota } : user
        ),
        // 更新用户详情
        userDetail: state.userDetail?.user.id === userId 
          ? { 
              ...state.userDetail, 
              user: { ...state.userDetail.user, credits_quota: response.data.data.newQuota }
            }
          : state.userDetail
      }))
      
      return response.data.data
    } catch (error) {
      console.error('设置用户积分配额失败:', error)
      throw error
    }
  },

  /**
   * 充值用户积分
   */
  addUserCredits: async (userId, amount, reason = '管理员充值') => {
    try {
      const response = await apiClient.post(`/admin/users/${userId}/credits/add`, {
        amount,
        reason
      })
      
      // 更新本地状态
      set(state => ({
        userCredits: {
          ...state.userCredits,
          [userId]: {
            ...state.userCredits[userId],
            credits_quota: response.data.data.newQuota,
            credits_stats: {
              ...state.userCredits[userId]?.credits_stats,
              quota: response.data.data.newQuota,
              remaining: response.data.data.balanceAfter
            }
          }
        },
        // 同时更新用户列表中的数据
        users: state.users.map(user => 
          user.id === userId ? { ...user, credits_quota: response.data.data.newQuota } : user
        )
      }))
      
      return response.data.data
    } catch (error) {
      console.error('充值用户积分失败:', error)
      throw error
    }
  },

  /**
   * 扣减用户积分
   */
  deductUserCredits: async (userId, amount, reason = '管理员扣减') => {
    try {
      const response = await apiClient.post(`/admin/users/${userId}/credits/deduct`, {
        amount,
        reason
      })
      
      // 更新本地状态
      set(state => ({
        userCredits: {
          ...state.userCredits,
          [userId]: {
            ...state.userCredits[userId],
            used_credits: response.data.data.newUsed,
            credits_stats: {
              ...state.userCredits[userId]?.credits_stats,
              used: response.data.data.newUsed,
              remaining: response.data.data.balanceAfter
            }
          }
        },
        // 同时更新用户列表中的数据
        users: state.users.map(user => 
          user.id === userId ? { ...user, used_credits: response.data.data.newUsed } : user
        )
      }))
      
      return response.data.data
    } catch (error) {
      console.error('扣减用户积分失败:', error)
      throw error
    }
  },

  /**
   * 获取用户积分历史
   */
  getUserCreditsHistory: async (userId, params = {}) => {
    set({ creditsLoading: true })
    try {
      const response = await apiClient.get(`/admin/users/${userId}/credits/history`, { params })
      
      set(state => ({
        creditsHistory: {
          ...state.creditsHistory,
          [userId]: response.data
        },
        creditsLoading: false
      }))
      
      return response.data
    } catch (error) {
      console.error('获取用户积分历史失败:', error)
      set({ creditsLoading: false })
      throw error
    }
  },

  // ===== 用户分组管理 (保持不变) =====

  // 获取用户分组列表
  getUserGroups: async () => {
    try {
      const response = await apiClient.get('/admin/user-groups')
      set({ userGroups: response.data.data })
      return response.data.data
    } catch (error) {
      console.error('获取用户分组失败:', error)
      throw error
    }
  },

  // 创建用户分组
  createUserGroup: async (groupData) => {
    try {
      const response = await apiClient.post('/admin/user-groups', groupData)
      const newGroup = response.data.data
      
      set(state => ({
        userGroups: [...state.userGroups, newGroup]
      }))
      
      return newGroup
    } catch (error) {
      console.error('创建用户分组失败:', error)
      throw error
    }
  },

  // 更新用户分组
  updateUserGroup: async (groupId, groupData) => {
    try {
      const response = await apiClient.put(`/admin/user-groups/${groupId}`, groupData)
      const updatedGroup = response.data.data
      
      set(state => ({
        userGroups: state.userGroups.map(group => 
          group.id === groupId ? updatedGroup : group
        )
      }))
      
      return updatedGroup
    } catch (error) {
      console.error('更新用户分组失败:', error)
      throw error
    }
  },

  // 删除用户分组
  deleteUserGroup: async (groupId) => {
    try {
      await apiClient.delete(`/admin/user-groups/${groupId}`)
      
      set(state => ({
        userGroups: state.userGroups.filter(group => group.id !== groupId)
      }))
    } catch (error) {
      console.error('删除用户分组失败:', error)
      throw error
    }
  },
  
  // ===== AI模型管理 (支持积分配置) =====

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
      userGroups: [],
      aiModels: [],
      modules: [],
      systemStats: {},
      systemSettings: {},
      loading: false,
      userCredits: {},
      creditsHistory: {},
      creditsLoading: false
    })
  }
}))

export default useAdminStore

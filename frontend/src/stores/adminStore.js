import { create } from 'zustand'
import apiClient from '../utils/api'

const useAdminStore = create((set) => ({
  // 状态
  users: [],
  userDetail: null,
  userGroups: [],
  userCredits: {},
  creditsHistory: [],
  aiModels: [],
  modules: [],
  apiServices: [],
  systemPrompts: [],  // 新增：系统提示词列表
  systemPromptsEnabled: false,  // 新增：系统提示词功能开关状态
  systemStats: {
    users: {},
    groups: [],
    conversations: {},
    models: []
  },
  systemSettings: {},
  systemHealth: null,
  loading: false,
  creditsLoading: false,
  
  // 用户管理
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
  
  createUser: async (userData) => {
    try {
      const response = await apiClient.post('/admin/users', userData)
      return response.data.data
    } catch (error) {
      console.error('创建用户失败:', error)
      throw error
    }
  },
  
  updateUser: async (userId, updateData) => {
    try {
      const response = await apiClient.put(`/admin/users/${userId}`, updateData)
      return response.data.data
    } catch (error) {
      console.error('更新用户失败:', error)
      throw error
    }
  },
  
  deleteUser: async (userId) => {
    try {
      await apiClient.delete(`/admin/users/${userId}`)
    } catch (error) {
      console.error('删除用户失败:', error)
      throw error
    }
  },
  
  // 将用户挪出当前组
  removeUserFromGroup: async (userId) => {
    try {
      const response = await apiClient.post(`/admin/users/${userId}/remove-from-group`)
      return response.data.data
    } catch (error) {
      console.error('挪出用户失败:', error)
      throw error
    }
  },
  
  resetUserPassword: async (userId, newPassword) => {
    try {
      const response = await apiClient.put(`/admin/users/${userId}/password`, {
        newPassword: newPassword
      })
      return response.data.data
    } catch (error) {
      console.error('重置密码失败:', error)
      throw error
    }
  },
  
  // 用户分组管理
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
  
  // 新增：在获取用户组时使用别名，避免与系统提示词的冲突
  fetchUserGroups: async () => {
    return useAdminStore.getState().getUserGroups()
  },
  
  createUserGroup: async (groupData) => {
    try {
      const response = await apiClient.post('/admin/user-groups', groupData)
      return response.data.data
    } catch (error) {
      console.error('创建用户分组失败:', error)
      throw error
    }
  },
  
  updateUserGroup: async (groupId, updateData) => {
    try {
      const response = await apiClient.put(`/admin/user-groups/${groupId}`, updateData)
      return response.data.data
    } catch (error) {
      console.error('更新用户分组失败:', error)
      throw error
    }
  },
  
  deleteUserGroup: async (groupId) => {
    try {
      await apiClient.delete(`/admin/user-groups/${groupId}`)
    } catch (error) {
      console.error('删除用户分组失败:', error)
      throw error
    }
  },
  
  // 设置组积分池
  setGroupCreditsPool: async (groupId, creditsPool) => {
    try {
      const response = await apiClient.put(`/admin/user-groups/${groupId}/credits-pool`, {
        credits_pool: creditsPool
      })
      // 刷新组列表以更新积分池信息
      await useAdminStore.getState().getUserGroups()
      return response.data.data
    } catch (error) {
      console.error('设置组积分池失败:', error)
      throw error
    }
  },
  
  // 从组积分池分配/回收积分
  distributeGroupCredits: async (groupId, userId, amount, reason, operation = 'distribute') => {
    try {
      const response = await apiClient.post(`/admin/user-groups/${groupId}/distribute-credits`, {
        user_id: userId,
        amount,
        reason,
        operation
      })
      return response.data.data
    } catch (error) {
      console.error(`组积分${operation === 'distribute' ? '分配' : '回收'}失败:`, error)
      throw error
    }
  },
  
  // 设置组员上限
  setGroupUserLimit: async (groupId, userLimit) => {
    try {
      const response = await apiClient.put(`/admin/user-groups/${groupId}/user-limit`, {
        user_limit: userLimit
      })
      // 刷新组列表以更新组员上限信息
      await useAdminStore.getState().getUserGroups()
      return response.data.data
    } catch (error) {
      console.error('设置组员上限失败:', error)
      throw error
    }
  },
  
  // 设置组有效期
  setGroupExpireDate: async (groupId, expireDate, syncToUsers = false) => {
    try {
      const response = await apiClient.put(`/admin/user-groups/${groupId}/expire-date`, {
        expire_date: expireDate,
        sync_to_users: syncToUsers
      })
      // 刷新组列表以更新有效期信息
      await useAdminStore.getState().getUserGroups()
      return response.data.data
    } catch (error) {
      console.error('设置组有效期失败:', error)
      throw error
    }
  },
  
  // 同步组有效期到所有组员
  syncGroupExpireDateToUsers: async (groupId) => {
    try {
      const response = await apiClient.post(`/admin/user-groups/${groupId}/sync-expire-date`)
      return response.data.data
    } catch (error) {
      console.error('同步组有效期失败:', error)
      throw error
    }
  },
  
  // 切换组站点自定义开关（新增）
  toggleGroupSiteCustomization: async (groupId, enabled) => {
    try {
      const response = await apiClient.put(`/admin/user-groups/${groupId}/site-customization`, {
        enabled
      })
      // 刷新组列表以更新配置
      await useAdminStore.getState().getUserGroups()
      return response.data.data
    } catch (error) {
      console.error('切换站点自定义开关失败:', error)
      throw error
    }
  },
  
  // 更新组站点配置（新增）
  updateGroupSiteConfig: async (groupId, config) => {
    try {
      const response = await apiClient.put(`/admin/user-groups/${groupId}/site-config`, config)
      // 刷新组列表以更新配置
      await useAdminStore.getState().getUserGroups()
      return response.data.data
    } catch (error) {
      console.error('更新站点配置失败:', error)
      throw error
    }
  },
  
  // 积分管理
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
  
  setUserCreditsQuota: async (userId, quota, reason) => {
    try {
      const response = await apiClient.put(`/admin/users/${userId}/credits`, {
        credits_quota: quota,
        reason
      })
      return response.data.data
    } catch (error) {
      console.error('设置用户积分配额失败:', error)
      throw error
    }
  },
  
  getUserCreditsHistory: async (userId, params = {}) => {
    try {
      const response = await apiClient.get(`/admin/users/${userId}/credits/history`, { params })
      return response.data.data
    } catch (error) {
      console.error('获取用户积分历史失败:', error)
      throw error
    }
  },
  
  addUserCredits: async (userId, amount, reason, extendDays) => {
    try {
      const response = await apiClient.post(`/admin/users/${userId}/credits/add`, {
        amount,
        reason,
        extend_days: extendDays
      })
      return response.data.data
    } catch (error) {
      console.error('充值用户积分失败:', error)
      throw error
    }
  },
  
  deductUserCredits: async (userId, amount, reason) => {
    try {
      const response = await apiClient.post(`/admin/users/${userId}/credits/deduct`, {
        amount,
        reason
      })
      return response.data.data
    } catch (error) {
      console.error('扣减用户积分失败:', error)
      throw error
    }
  },
  
  setUserCreditsExpire: async (userId, params) => {
    try {
      const response = await apiClient.put(`/admin/users/${userId}/credits/expire`, params)
      return response.data.data
    } catch (error) {
      console.error('设置积分有效期失败:', error)
      throw error
    }
  },
  
  // 设置用户账号有效期
  setUserAccountExpireDate: async (userId, expireDate, reason = '管理员设置') => {
    try {
      const response = await apiClient.put(`/admin/users/${userId}/expire-date`, {
        expire_date: expireDate,
        reason
      })
      return response.data.data
    } catch (error) {
      console.error('设置账号有效期失败:', error)
      throw error
    }
  },
  
  // 延长用户账号有效期
  extendUserAccountExpireDate: async (userId, days, reason = '管理员延期') => {
    try {
      const response = await apiClient.put(`/admin/users/${userId}/extend-expire-date`, {
        days,
        reason
      })
      return response.data.data
    } catch (error) {
      console.error('延长账号有效期失败:', error)
      throw error
    }
  },
  
  // 同步用户有效期到组有效期
  syncUserAccountExpireWithGroup: async (userId) => {
    try {
      const response = await apiClient.post(`/admin/users/${userId}/sync-expire-date`)
      return response.data.data
    } catch (error) {
      console.error('同步账号有效期失败:', error)
      throw error
    }
  },
  
  // AI模型管理
  getAIModels: async () => {
    set({ loading: true })
    try {
      const response = await apiClient.get('/admin/models')
      set({ 
        aiModels: response.data.data,
        loading: false 
      })
      return response.data.data
    } catch (error) {
      console.error('获取AI模型列表失败:', error)
      set({ loading: false })
      throw error
    }
  },
  
  createAIModel: async (modelData) => {
    try {
      const response = await apiClient.post('/admin/models', modelData)
      return response.data.data
    } catch (error) {
      console.error('创建AI模型失败:', error)
      throw error
    }
  },
  
  updateAIModel: async (modelId, updateData) => {
    try {
      const response = await apiClient.put(`/admin/models/${modelId}`, updateData)
      return response.data.data
    } catch (error) {
      console.error('更新AI模型失败:', error)
      throw error
    }
  },
  
  deleteAIModel: async (modelId) => {
    try {
      await apiClient.delete(`/admin/models/${modelId}`)
    } catch (error) {
      console.error('删除AI模型失败:', error)
      throw error
    }
  },
  
  toggleAIModelStatus: async (modelId) => {
    try {
      const response = await apiClient.post(`/admin/models/${modelId}/toggle-status`)
      return response.data.data
    } catch (error) {
      console.error('切换AI模型状态失败:', error)
      throw error
    }
  },
  
  // 测试AI模型连接
  testAIModel: async (modelId) => {
    try {
      const response = await apiClient.post(`/admin/models/${modelId}/test`)
      return response.data
    } catch (error) {
      console.error('测试AI模型失败:', error)
      throw error
    }
  },
  
  // 获取模型分配的用户组
  getModelGroups: async (modelId) => {
    try {
      const response = await apiClient.get(`/admin/models/${modelId}/groups`)
      return response.data.data
    } catch (error) {
      console.error('获取模型分配组失败:', error)
      throw error
    }
  },
  
  // 更新模型分配的用户组
  updateModelGroups: async (modelId, groupIds) => {
    try {
      const response = await apiClient.put(`/admin/models/${modelId}/groups`, {
        group_ids: groupIds
      })
      // 刷新AI模型列表
      await useAdminStore.getState().getAIModels()
      return response.data.data
    } catch (error) {
      console.error('更新模型分配组失败:', error)
      throw error
    }
  },
  
  // 系统统计
  getSystemStats: async (params = {}) => {
    try {
      const response = await apiClient.get('/admin/stats', { params })
      set({ systemStats: response.data.data })
      return response.data.data
    } catch (error) {
      console.error('获取系统统计失败:', error)
      throw error
    }
  },
  
  getRealtimeStats: async () => {
    try {
      const response = await apiClient.get('/admin/stats/realtime')
      return response.data.data
    } catch (error) {
      console.error('获取实时统计失败:', error)
      throw error
    }
  },
  
  // 系统健康监控
  getSystemHealth: async () => {
    try {
      const response = await apiClient.get('/admin/stats/health')
      set({ systemHealth: response.data.data })
      return response.data.data
    } catch (error) {
      console.error('获取系统健康状态失败:', error)
      throw error
    }
  },
  
  // 执行系统维护操作
  performMaintenance: async (action) => {
    try {
      const response = await apiClient.post('/admin/stats/maintenance', { action })
      return response.data
    } catch (error) {
      console.error('执行维护操作失败:', error)
      throw error
    }
  },
  
  // 系统设置
  getSystemSettings: async () => {
    try {
      const response = await apiClient.get('/admin/settings')
      set({ systemSettings: response.data.data })
      return response.data.data
    } catch (error) {
      console.error('获取系统设置失败:', error)
      throw error
    }
  },
  
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
  
  // 模块管理 - 超级管理员使用
  getModules: async () => {
    set({ loading: true })
    try {
      const response = await apiClient.get('/admin/modules')
      set({ 
        modules: response.data.data,
        loading: false 
      })
      return response.data.data
    } catch (error) {
      console.error('获取模块列表失败:', error)
      set({ loading: false })
      throw error
    }
  },
  
  // 获取用户可访问的模块 - 所有登录用户都可以使用
  getUserModules: async () => {
    set({ loading: true })
    try {
      const response = await apiClient.get('/admin/modules/user-modules')
      set({ 
        modules: response.data.data,
        loading: false 
      })
      return response.data.data
    } catch (error) {
      console.error('获取用户模块失败:', error)
      set({ loading: false })
      throw error
    }
  },
  
  createModule: async (moduleData) => {
    try {
      const response = await apiClient.post('/admin/modules', moduleData)
      // 刷新模块列表
      await useAdminStore.getState().getModules()
      return response.data.data
    } catch (error) {
      console.error('创建模块失败:', error)
      throw error
    }
  },
  
  updateModule: async (moduleId, updateData) => {
    try {
      const response = await apiClient.put(`/admin/modules/${moduleId}`, updateData)
      // 刷新模块列表
      await useAdminStore.getState().getModules()
      return response.data.data
    } catch (error) {
      console.error('更新模块失败:', error)
      throw error
    }
  },
  
  deleteModule: async (moduleId) => {
    try {
      await apiClient.delete(`/admin/modules/${moduleId}`)
      // 刷新模块列表
      await useAdminStore.getState().getModules()
    } catch (error) {
      console.error('删除模块失败:', error)
      throw error
    }
  },
  
  toggleModuleStatus: async (moduleId) => {
    try {
      const response = await apiClient.patch(`/admin/modules/${moduleId}/toggle-status`)
      // 刷新模块列表
      await useAdminStore.getState().getModules()
      return response.data.data
    } catch (error) {
      console.error('切换模块状态失败:', error)
      throw error
    }
  },
  
  checkModuleHealth: async (moduleId) => {
    try {
      const response = await apiClient.post(`/admin/modules/${moduleId}/check-health`)
      return response.data
    } catch (error) {
      console.error('检查模块健康状态失败:', error)
      throw error
    }
  },

  // API服务管理
  getApiServices: async () => {
    set({ loading: true })
    try {
      const response = await apiClient.get('/admin/api-services')
      set({ 
        apiServices: response.data.data,
        loading: false 
      })
      return response.data.data
    } catch (error) {
      console.error('获取API服务列表失败:', error)
      set({ loading: false })
      throw error
    }
  },

  getApiService: async (serviceId) => {
    try {
      const response = await apiClient.get(`/admin/api-services/${serviceId}`)
      return response.data.data
    } catch (error) {
      console.error('获取API服务详情失败:', error)
      throw error
    }
  },

  createApiService: async (serviceData) => {
    try {
      const response = await apiClient.post('/admin/api-services', serviceData)
      // 刷新服务列表
      await useAdminStore.getState().getApiServices()
      return response.data.data
    } catch (error) {
      console.error('创建API服务失败:', error)
      throw error
    }
  },

  updateApiService: async (serviceId, updateData) => {
    try {
      const response = await apiClient.put(`/admin/api-services/${serviceId}`, updateData)
      // 刷新服务列表
      await useAdminStore.getState().getApiServices()
      return response.data.data
    } catch (error) {
      console.error('更新API服务失败:', error)
      throw error
    }
  },

  deleteApiService: async (serviceId) => {
    try {
      await apiClient.delete(`/admin/api-services/${serviceId}`)
      // 刷新服务列表
      await useAdminStore.getState().getApiServices()
    } catch (error) {
      console.error('删除API服务失败:', error)
      throw error
    }
  },

  resetApiServiceKey: async (serviceId) => {
    try {
      const response = await apiClient.post(`/admin/api-services/${serviceId}/reset-key`)
      // 刷新服务列表
      await useAdminStore.getState().getApiServices()
      return response.data.data
    } catch (error) {
      console.error('重置API密钥失败:', error)
      throw error
    }
  },

  getApiServiceActions: async (serviceId) => {
    try {
      const response = await apiClient.get(`/admin/api-services/${serviceId}/actions`)
      return response.data.data
    } catch (error) {
      console.error('获取服务操作配置失败:', error)
      throw error
    }
  },

  upsertApiServiceAction: async (serviceId, actionData) => {
    try {
      const response = await apiClient.post(`/admin/api-services/${serviceId}/actions`, actionData)
      return response.data.data
    } catch (error) {
      console.error('保存服务操作配置失败:', error)
      throw error
    }
  },

  deleteApiServiceAction: async (serviceId, actionType) => {
    try {
      await apiClient.delete(`/admin/api-services/${serviceId}/actions/${actionType}`)
    } catch (error) {
      console.error('删除服务操作配置失败:', error)
      throw error
    }
  },

  getApiServiceStats: async (serviceId, params = {}) => {
    try {
      const response = await apiClient.get(`/admin/api-services/${serviceId}/stats`, { params })
      return response.data.data
    } catch (error) {
      console.error('获取服务统计失败:', error)
      throw error
    }
  },

  // ===== 系统提示词管理 =====
  // 获取系统提示词列表
  getSystemPrompts: async (includeInactive = false) => {
    set({ loading: true })
    try {
      const response = await apiClient.get('/admin/system-prompts', { 
        params: { include_inactive: includeInactive } 
      })
      set({ 
        systemPrompts: response.data.data,
        loading: false 
      })
      // 同时获取功能开关状态
      await useAdminStore.getState().getSystemPromptsStatus()
      return response.data.data
    } catch (error) {
      console.error('获取系统提示词列表失败:', error)
      set({ loading: false })
      throw error
    }
  },

  // 获取系统提示词功能状态
  getSystemPromptsStatus: async () => {
    try {
      const response = await apiClient.get('/admin/system-prompts/status')
      set({ systemPromptsEnabled: response.data.data.enabled })
      return response.data.data
    } catch (error) {
      console.error('获取系统提示词功能状态失败:', error)
      return { success: false, error: error.message }
    }
  },

  // 获取单个系统提示词详情
  getSystemPrompt: async (promptId) => {
    try {
      const response = await apiClient.get(`/admin/system-prompts/${promptId}`)
      return response.data.data
    } catch (error) {
      console.error('获取系统提示词详情失败:', error)
      throw error
    }
  },

  // 创建系统提示词
  createSystemPrompt: async (promptData) => {
    try {
      const response = await apiClient.post('/admin/system-prompts', promptData)
      // 刷新列表
      await useAdminStore.getState().getSystemPrompts()
      return { success: true, data: response.data.data }
    } catch (error) {
      console.error('创建系统提示词失败:', error)
      return { success: false, error: error.response?.data?.message || error.message }
    }
  },

  // 更新系统提示词
  updateSystemPrompt: async (promptId, updateData) => {
    try {
      const response = await apiClient.put(`/admin/system-prompts/${promptId}`, updateData)
      // 刷新列表
      await useAdminStore.getState().getSystemPrompts()
      return { success: true, data: response.data.data }
    } catch (error) {
      console.error('更新系统提示词失败:', error)
      return { success: false, error: error.response?.data?.message || error.message }
    }
  },

  // 删除系统提示词
  deleteSystemPrompt: async (promptId) => {
    try {
      await apiClient.delete(`/admin/system-prompts/${promptId}`)
      // 刷新列表
      await useAdminStore.getState().getSystemPrompts()
      return { success: true }
    } catch (error) {
      console.error('删除系统提示词失败:', error)
      return { success: false, error: error.response?.data?.message || error.message }
    }
  },

  // 切换系统提示词功能开关
  toggleSystemPromptsFeature: async (enabled) => {
    try {
      const response = await apiClient.put('/admin/system-prompts/toggle', { enabled })
      set({ systemPromptsEnabled: enabled })
      return { success: true, data: response.data.data }
    } catch (error) {
      console.error('切换系统提示词功能失败:', error)
      return { success: false, error: error.response?.data?.message || error.message }
    }
  }
}))

export default useAdminStore

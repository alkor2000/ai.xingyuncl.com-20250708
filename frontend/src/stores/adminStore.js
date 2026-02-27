/**
 * 管理后台状态管理
 * 
 * 功能包含：
 * - 用户管理（含批量创建 v1.1新增）
 * - 用户分组管理
 * - 积分管理
 * - AI模型管理（v1.2新增拖拽排序）
 * - 系统模块管理
 * - API服务管理
 * - 系统提示词管理
 * - 使用记录管理
 */
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
  systemPrompts: [],
  systemPromptsEnabled: false,
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
  
  // ===== 用户管理 =====
  
  // 获取用户列表 - 支持include_tags参数
  getUsers: async (params = {}) => {
    set({ loading: true })
    try {
      const requestParams = {
        ...params,
        include_tags: params.include_tags !== false
      }
      
      const response = await apiClient.get('/admin/users', { params: requestParams })
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
  
  // 创建单个用户
  createUser: async (userData) => {
    try {
      const response = await apiClient.post('/admin/users', userData)
      return response.data.data
    } catch (error) {
      console.error('创建用户失败:', error)
      throw error
    }
  },
  
  /**
   * 批量创建用户（v1.1新增）
   * 
   * @param {Object} batchData - 批量创建参数
   * @param {number} batchData.group_id - 目标组ID
   * @param {string} batchData.username_prefix - 用户名前缀
   * @param {string} batchData.username_connector - 连接符（默认_）
   * @param {number} batchData.start_number - 起始序号
   * @param {number} batchData.number_digits - 序号位数
   * @param {number} batchData.count - 创建数量
   * @param {number} batchData.credits_per_user - 每用户积分
   * @param {string} batchData.password - 统一密码（可选）
   * @returns {Object} 创建结果
   */
  batchCreateUsers: async (batchData) => {
    try {
      const response = await apiClient.post('/admin/users/batch-create', batchData)
      return response.data
    } catch (error) {
      console.error('批量创建用户失败:', error)
      throw error
    }
  },
  
  // 更新用户
  updateUser: async (userId, updateData) => {
    try {
      const response = await apiClient.put(`/admin/users/${userId}`, updateData)
      return response.data.data
    } catch (error) {
      console.error('更新用户失败:', error)
      throw error
    }
  },
  
  // 删除用户
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
  
  // 重置用户密码
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
  
  // ===== 用户分组管理 =====
  
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
  
  // 切换组站点自定义开关
  toggleGroupSiteCustomization: async (groupId, enabled) => {
    try {
      const response = await apiClient.put(`/admin/user-groups/${groupId}/site-customization`, {
        enabled
      })
      await useAdminStore.getState().getUserGroups()
      return response.data.data
    } catch (error) {
      console.error('切换站点自定义开关失败:', error)
      throw error
    }
  },
  
  // 更新组站点配置
  updateGroupSiteConfig: async (groupId, config) => {
    try {
      const response = await apiClient.put(`/admin/user-groups/${groupId}/site-config`, config)
      await useAdminStore.getState().getUserGroups()
      return response.data.data
    } catch (error) {
      console.error('更新站点配置失败:', error)
      throw error
    }
  },
  
  // ===== 邀请码管理 =====
  
  setGroupInvitationCode: async (groupId, invitationData) => {
    try {
      const response = await apiClient.put(`/admin/user-groups/${groupId}/invitation-code`, invitationData)
      await useAdminStore.getState().getUserGroups()
      return response.data.data
    } catch (error) {
      console.error('设置组邀请码失败:', error)
      throw error
    }
  },
  
  getInvitationCodeLogs: async (groupId, params = {}) => {
    try {
      const response = await apiClient.get(`/admin/user-groups/${groupId}/invitation-logs`, { params })
      return response.data.data
    } catch (error) {
      console.error('获取邀请码使用记录失败:', error)
      throw error
    }
  },
  
  // ===== 积分管理 =====
  
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
  
  // ===== AI模型管理 =====
  
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
  
  /**
   * v1.2 批量更新模型排序（拖拽排序）
   * 先乐观更新本地状态（即时响应），再同步到后端
   * 
   * @param {Array<{id: number, sort_order: number}>} sortOrders - 排序数组
   * @param {Array} newModels - 排序后的完整模型数组（用于乐观更新）
   */
  updateModelSortOrder: async (sortOrders, newModels) => {
    // 乐观更新：先更新本地列表顺序，用户立即看到效果
    if (newModels) {
      set({ aiModels: newModels })
    }
    try {
      await apiClient.put('/admin/models/sort-order', { sort_orders: sortOrders })
      // 成功后从后端刷新，确保数据一致
      await useAdminStore.getState().getAIModels()
    } catch (error) {
      console.error('更新模型排序失败:', error)
      // 失败则回滚：重新从后端获取
      await useAdminStore.getState().getAIModels()
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
  
  testAIModel: async (modelId) => {
    try {
      const response = await apiClient.post(`/admin/models/${modelId}/test`)
      return response.data
    } catch (error) {
      console.error('测试AI模型失败:', error)
      throw error
    }
  },
  
  getModelGroups: async (modelId) => {
    try {
      const response = await apiClient.get(`/admin/models/${modelId}/groups`)
      return response.data.data
    } catch (error) {
      console.error('获取模型分配组失败:', error)
      throw error
    }
  },
  
  updateModelGroups: async (modelId, groupIds) => {
    try {
      const response = await apiClient.put(`/admin/models/${modelId}/groups`, {
        group_ids: groupIds
      })
      await useAdminStore.getState().getAIModels()
      return response.data.data
    } catch (error) {
      console.error('更新模型分配组失败:', error)
      throw error
    }
  },
  
  // ===== 系统统计 =====
  
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
  
  performMaintenance: async (action) => {
    try {
      const response = await apiClient.post('/admin/stats/maintenance', { action })
      return response.data
    } catch (error) {
      console.error('执行维护操作失败:', error)
      throw error
    }
  },
  
  // ===== 系统设置 =====
  
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
  
  // ===== 模块管理 =====
  
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
      await useAdminStore.getState().getModules()
    } catch (error) {
      console.error('删除模块失败:', error)
      throw error
    }
  },
  
  toggleModuleStatus: async (moduleId) => {
    try {
      const response = await apiClient.patch(`/admin/modules/${moduleId}/toggle-status`)
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

  // ===== API服务管理 =====
  
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
      await useAdminStore.getState().getApiServices()
    } catch (error) {
      console.error('删除API服务失败:', error)
      throw error
    }
  },

  resetApiServiceKey: async (serviceId) => {
    try {
      const response = await apiClient.post(`/admin/api-services/${serviceId}/reset-key`)
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
      await useAdminStore.getState().getSystemPromptsStatus()
      return response.data.data
    } catch (error) {
      console.error('获取系统提示词列表失败:', error)
      set({ loading: false })
      throw error
    }
  },

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

  getSystemPrompt: async (promptId) => {
    try {
      const response = await apiClient.get(`/admin/system-prompts/${promptId}`)
      return response.data.data
    } catch (error) {
      console.error('获取系统提示词详情失败:', error)
      throw error
    }
  },

  createSystemPrompt: async (promptData) => {
    try {
      const response = await apiClient.post('/admin/system-prompts', promptData)
      await useAdminStore.getState().getSystemPrompts()
      return { success: true, data: response.data.data }
    } catch (error) {
      console.error('创建系统提示词失败:', error)
      return { success: false, error: error.response?.data?.message || error.message }
    }
  },

  updateSystemPrompt: async (promptId, updateData) => {
    try {
      const response = await apiClient.put(`/admin/system-prompts/${promptId}`, updateData)
      await useAdminStore.getState().getSystemPrompts()
      return { success: true, data: response.data.data }
    } catch (error) {
      console.error('更新系统提示词失败:', error)
      return { success: false, error: error.response?.data?.message || error.message }
    }
  },

  deleteSystemPrompt: async (promptId) => {
    try {
      await apiClient.delete(`/admin/system-prompts/${promptId}`)
      await useAdminStore.getState().getSystemPrompts()
      return { success: true }
    } catch (error) {
      console.error('删除系统提示词失败:', error)
      return { success: false, error: error.response?.data?.message || error.message }
    }
  },

  toggleSystemPromptsFeature: async (enabled) => {
    try {
      const response = await apiClient.put('/admin/system-prompts/toggle', { enabled })
      set({ systemPromptsEnabled: enabled })
      return { success: true, data: response.data.data }
    } catch (error) {
      console.error('切换系统提示词功能失败:', error)
      return { success: false, error: error.response?.data?.message || error.message }
    }
  },

  // ===== 使用记录管理 =====
  
  getUsageLogs: async (params = {}) => {
    try {
      const response = await apiClient.get('/admin/usage-logs', { params })
      return response.data.data
    } catch (error) {
      console.error('获取使用记录失败:', error)
      throw error
    }
  },

  getUsageSummary: async (params = {}) => {
    try {
      const response = await apiClient.get('/admin/usage-logs/summary', { params })
      return response.data.data
    } catch (error) {
      console.error('获取使用统计汇总失败:', error)
      throw error
    }
  },

  exportUsageLogs: async (params = {}) => {
    try {
      const response = await apiClient.get('/admin/usage-logs/export', {
        params,
        responseType: 'blob'
      })
      
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `usage_logs_${new Date().toISOString().split('T')[0]}.xlsx`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      
      return { success: true }
    } catch (error) {
      console.error('导出使用记录失败:', error)
      throw error
    }
  }
}))

export default useAdminStore

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
 * - 学校批量导入与按组导出（v1.3 新增 2026-05-09）
 *
 * v1.4 学校导入异步化（2026-06-08）：
 *   executeSchoolImport 由"同步等待整个导入完成"改为"提交任务拿 task_id（秒级返回）"，
 *   新增 getSchoolImportStatus（单次查询）与 pollSchoolImportStatus（轮询直到完成），
 *   彻底规避大批量导入的 HTTP 30 秒超时问题。
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
  
  // 批量创建用户（v1.1）
  batchCreateUsers: async (batchData) => {
    try {
      const response = await apiClient.post('/admin/users/batch-create', batchData)
      return response.data
    } catch (error) {
      console.error('批量创建用户失败:', error)
      throw error
    }
  },
  
  // ============================================================
  // v1.3 学校批量导入与按组导出
  // v1.4 异步化：execute 改为提交任务 + 轮询进度
  // ============================================================
  
  /**
   * 下载学校导入 Excel 模板（直接触发浏览器下载）
   */
  downloadSchoolImportTemplate: async () => {
    try {
      const response = await apiClient.get('/admin/users/school-import/template', {
        responseType: 'blob',
        timeout: 30000
      })
      const blob = new Blob(
        [response.data],
        { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
      )
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      const dateStr = new Date().toISOString().split('T')[0]
      link.setAttribute('download', `学校批量导入模板_${dateStr}.xlsx`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      return { success: true }
    } catch (error) {
      console.error('下载导入模板失败:', error)
      throw error
    }
  },

  /**
   * 预览学校批量导入（不入库，仅校验）
   * @param {File} file - 用户上传的 Excel File 对象
   */
  previewSchoolImport: async (file) => {
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await apiClient.post(
        '/admin/users/school-import/preview',
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 60000
        }
      )
      return response.data.data
    } catch (error) {
      console.error('预览学校导入失败:', error)
      throw error
    }
  },

  /**
   * 提交学校批量导入任务（v1.4 异步化）
   * 仅提交并返回 task_id，实际导入由后端后台异步执行。
   * 前端拿到 task_id 后调用 pollSchoolImportStatus 轮询进度与结果。
   * @param {File} file - 用户上传的 Excel File 对象
   * @returns {Promise<string>} task_id
   */
  executeSchoolImport: async (file) => {
    try {
      const formData = new FormData()
      formData.append('file', file)
      // 仅提交任务，秒级返回 task_id（请求很快完成，沿用全局/管理请求超时即可）
      const response = await apiClient.post(
        '/admin/users/school-import/execute',
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data' }
        }
      )
      // 后端返回 { task_id: '...' }
      return response.data.data.task_id
    } catch (error) {
      console.error('提交学校导入任务失败:', error)
      throw error
    }
  },

  /**
   * 查询学校导入任务状态（单次）
   * @param {string} taskId
   * @returns {Promise<Object>} { task_id, status, progress, result, error }
   */
  getSchoolImportStatus: async (taskId) => {
    try {
      const response = await apiClient.get(
        `/admin/users/school-import/execute/status/${taskId}`
      )
      return response.data.data
    } catch (error) {
      console.error('查询学校导入任务状态失败:', error)
      throw error
    }
  },

  /**
   * 轮询学校导入任务直到完成/失败（v1.4 新增）
   *
   * 参照视频生成轮询思路：固定间隔 + 超时上限 + 进度回调。
   * 大批量导入（数千用户）后端约 1-2 分钟完成，这里给足 20 分钟上限兜底。
   *
   * @param {string} taskId
   * @param {Object} options
   *   - onProgress: (progress) => void   每次轮询拿到进度时回调（progress = { phase, processed, total, groups }）
   *   - intervalMs: number               轮询间隔，默认 2500ms
   *   - maxAttempts: number              最大轮询次数，默认 480（480 × 2.5s ≈ 20 分钟）
   * @returns {Promise<Object>} 完成时 resolve 完整导入报告（result）；失败时 reject(Error)
   */
  pollSchoolImportStatus: (taskId, options = {}) => {
    const {
      onProgress,
      intervalMs = 2500,
      maxAttempts = 480
    } = options

    return new Promise((resolve, reject) => {
      let attempts = 0
      let timer = null

      const clear = () => {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
      }

      const tick = async () => {
        attempts += 1
        try {
          const data = await useAdminStore.getState().getSchoolImportStatus(taskId)

          // 上报进度（无论什么状态都把当前进度透出去）
          if (onProgress && data.progress) {
            onProgress(data.progress)
          }

          if (data.status === 'completed') {
            clear()
            resolve(data.result)
            return
          }
          if (data.status === 'failed') {
            clear()
            reject(new Error(data.error || '导入失败'))
            return
          }

          // pending / running：继续轮询
          if (attempts >= maxAttempts) {
            clear()
            reject(new Error('导入超时：任务执行时间过长，请稍后到用户列表确认导入结果'))
            return
          }
          timer = setTimeout(tick, intervalMs)
        } catch (error) {
          // 查询出错（如任务过期被清理返回 404）→ 停止轮询并抛出
          clear()
          reject(error)
        }
      }

      // 立即发起首次查询，之后按间隔轮询
      tick()
    })
  },

  /**
   * 按用户组导出全部用户为 Excel
   * @param {number} groupId
   * @param {string} groupName - 用于设置下载文件名
   */
  exportGroupUsers: async (groupId, groupName) => {
    try {
      const response = await apiClient.get(
        `/admin/users/export-by-group/${groupId}`,
        {
          responseType: 'blob',
          timeout: 120000
        }
      )
      const blob = new Blob(
        [response.data],
        { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
      )
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      const safeName = (groupName || 'group').replace(/[\\/:*?"<>|]/g, '_')
      const dateStr = new Date().toISOString().split('T')[0]
      link.setAttribute('download', `${safeName}_用户列表_${dateStr}.xlsx`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      return { success: true }
    } catch (error) {
      console.error('导出组用户失败:', error)
      throw error
    }
  },
  
  // ===== 用户管理 - 其他方法 =====
  
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
  
  syncGroupExpireDateToUsers: async (groupId) => {
    try {
      const response = await apiClient.post(`/admin/user-groups/${groupId}/sync-expire-date`)
      return response.data.data
    } catch (error) {
      console.error('同步组有效期失败:', error)
      throw error
    }
  },
  
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
  
  updateModelSortOrder: async (sortOrders, newModels) => {
    if (newModels) {
      set({ aiModels: newModels })
    }
    try {
      await apiClient.put('/admin/models/sort-order', { sort_orders: sortOrders })
      await useAdminStore.getState().getAIModels()
    } catch (error) {
      console.error('更新模型排序失败:', error)
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

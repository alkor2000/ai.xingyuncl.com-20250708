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
 *
 * v1.5 国际化（本文件为非React模块，无法使用useTranslation hook，
 *   改为直接import i18n实例调用i18n.t()）：
 *   - 全部console.error日志属开发者诊断信息，统一改英文不进语言包
 *   - 导出Excel的下载文件名前缀（学校导入模板/按组导出用户列表）改i18n.t()，
 *     浏览器下载对话框与文件系统中会显示该文件名，属用户可见文本
 *   - pollSchoolImportStatus内的失败兜底与超时Error改i18n.t()
 *   - setUserAccountExpireDate/extendUserAccountExpireDate的reason默认参数改i18n.t()，
 *     该值会写入数据库供后续查看，随当次操作发生时的界面语言固化（与后端message
 *     恒为中文的既定行为模式一致，非模块加载期求值，JS默认参数在每次调用时求值无陈旧闭包风险）
 */
import { create } from 'zustand'
import apiClient from '../utils/api'
import i18n from '../utils/i18n'

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
      console.error('Failed to get user list:', error)
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
      console.error('Failed to get user detail:', error)
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
      console.error('Failed to create user:', error)
      throw error
    }
  },
  
  // 批量创建用户（v1.1）
  batchCreateUsers: async (batchData) => {
    try {
      const response = await apiClient.post('/admin/users/batch-create', batchData)
      return response.data
    } catch (error) {
      console.error('Failed to batch create users:', error)
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
      link.setAttribute('download', `${i18n.t('admin.store.schoolImportTemplateFilename')}_${dateStr}.xlsx`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      return { success: true }
    } catch (error) {
      console.error('Failed to download import template:', error)
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
      console.error('Failed to preview school import:', error)
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
      console.error('Failed to submit school import task:', error)
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
      console.error('Failed to query school import task status:', error)
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
            reject(new Error(data.error || i18n.t('admin.store.importFailed')))
            return
          }

          // pending / running：继续轮询
          if (attempts >= maxAttempts) {
            clear()
            reject(new Error(i18n.t('admin.store.importTimeout')))
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
      link.setAttribute('download', `${safeName}_${i18n.t('admin.store.groupUserListFilename')}_${dateStr}.xlsx`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      return { success: true }
    } catch (error) {
      console.error('Failed to export group users:', error)
      throw error
    }
  },
  
  // ===== 用户管理 - 其他方法 =====
  
  updateUser: async (userId, updateData) => {
    try {
      const response = await apiClient.put(`/admin/users/${userId}`, updateData)
      return response.data.data
    } catch (error) {
      console.error('Failed to update user:', error)
      throw error
    }
  },
  
  deleteUser: async (userId) => {
    try {
      await apiClient.delete(`/admin/users/${userId}`)
    } catch (error) {
      console.error('Failed to delete user:', error)
      throw error
    }
  },
  
  removeUserFromGroup: async (userId) => {
    try {
      const response = await apiClient.post(`/admin/users/${userId}/remove-from-group`)
      return response.data.data
    } catch (error) {
      console.error('Failed to remove user from group:', error)
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
      console.error('Failed to reset password:', error)
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
      console.error('Failed to get user groups:', error)
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
      console.error('Failed to create user group:', error)
      throw error
    }
  },
  
  updateUserGroup: async (groupId, updateData) => {
    try {
      const response = await apiClient.put(`/admin/user-groups/${groupId}`, updateData)
      return response.data.data
    } catch (error) {
      console.error('Failed to update user group:', error)
      throw error
    }
  },
  
  deleteUserGroup: async (groupId) => {
    try {
      await apiClient.delete(`/admin/user-groups/${groupId}`)
    } catch (error) {
      console.error('Failed to delete user group:', error)
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
      console.error('Failed to set group credits pool:', error)
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
      console.error(`Group credits ${operation === 'distribute' ? 'distribution' : 'recycling'} failed:`, error)
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
      console.error('Failed to set group user limit:', error)
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
      console.error('Failed to set group expire date:', error)
      throw error
    }
  },
  
  syncGroupExpireDateToUsers: async (groupId) => {
    try {
      const response = await apiClient.post(`/admin/user-groups/${groupId}/sync-expire-date`)
      return response.data.data
    } catch (error) {
      console.error('Failed to sync group expire date:', error)
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
      console.error('Failed to toggle site customization:', error)
      throw error
    }
  },
  
  updateGroupSiteConfig: async (groupId, config) => {
    try {
      const response = await apiClient.put(`/admin/user-groups/${groupId}/site-config`, config)
      await useAdminStore.getState().getUserGroups()
      return response.data.data
    } catch (error) {
      console.error('Failed to update site config:', error)
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
      console.error('Failed to set group invitation code:', error)
      throw error
    }
  },
  
  getInvitationCodeLogs: async (groupId, params = {}) => {
    try {
      const response = await apiClient.get(`/admin/user-groups/${groupId}/invitation-logs`, { params })
      return response.data.data
    } catch (error) {
      console.error('Failed to get invitation code logs:', error)
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
      console.error('Failed to get user credits info:', error)
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
      console.error('Failed to set user credits quota:', error)
      throw error
    }
  },
  
  getUserCreditsHistory: async (userId, params = {}) => {
    try {
      const response = await apiClient.get(`/admin/users/${userId}/credits/history`, { params })
      return response.data.data
    } catch (error) {
      console.error('Failed to get user credits history:', error)
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
      console.error('Failed to add user credits:', error)
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
      console.error('Failed to deduct user credits:', error)
      throw error
    }
  },
  
  setUserCreditsExpire: async (userId, params) => {
    try {
      const response = await apiClient.put(`/admin/users/${userId}/credits/expire`, params)
      return response.data.data
    } catch (error) {
      console.error('Failed to set credits expire date:', error)
      throw error
    }
  },
  
  setUserAccountExpireDate: async (userId, expireDate, reason = i18n.t('admin.store.defaultReasonSetExpire')) => {
    try {
      const response = await apiClient.put(`/admin/users/${userId}/expire-date`, {
        expire_date: expireDate,
        reason
      })
      return response.data.data
    } catch (error) {
      console.error('Failed to set account expire date:', error)
      throw error
    }
  },
  
  extendUserAccountExpireDate: async (userId, days, reason = i18n.t('admin.store.defaultReasonExtendExpire')) => {
    try {
      const response = await apiClient.put(`/admin/users/${userId}/extend-expire-date`, {
        days,
        reason
      })
      return response.data.data
    } catch (error) {
      console.error('Failed to extend account expire date:', error)
      throw error
    }
  },
  
  syncUserAccountExpireWithGroup: async (userId) => {
    try {
      const response = await apiClient.post(`/admin/users/${userId}/sync-expire-date`)
      return response.data.data
    } catch (error) {
      console.error('Failed to sync account expire date:', error)
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
      console.error('Failed to get AI model list:', error)
      set({ loading: false })
      throw error
    }
  },
  
  createAIModel: async (modelData) => {
    try {
      const response = await apiClient.post('/admin/models', modelData)
      return response.data.data
    } catch (error) {
      console.error('Failed to create AI model:', error)
      throw error
    }
  },
  
  updateAIModel: async (modelId, updateData) => {
    try {
      const response = await apiClient.put(`/admin/models/${modelId}`, updateData)
      return response.data.data
    } catch (error) {
      console.error('Failed to update AI model:', error)
      throw error
    }
  },
  
  deleteAIModel: async (modelId) => {
    try {
      await apiClient.delete(`/admin/models/${modelId}`)
    } catch (error) {
      console.error('Failed to delete AI model:', error)
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
      console.error('Failed to update model sort order:', error)
      await useAdminStore.getState().getAIModels()
      throw error
    }
  },
  
  toggleAIModelStatus: async (modelId) => {
    try {
      const response = await apiClient.post(`/admin/models/${modelId}/toggle-status`)
      return response.data.data
    } catch (error) {
      console.error('Failed to toggle AI model status:', error)
      throw error
    }
  },
  
  testAIModel: async (modelId) => {
    try {
      const response = await apiClient.post(`/admin/models/${modelId}/test`)
      return response.data
    } catch (error) {
      console.error('Failed to test AI model:', error)
      throw error
    }
  },
  
  getModelGroups: async (modelId) => {
    try {
      const response = await apiClient.get(`/admin/models/${modelId}/groups`)
      return response.data.data
    } catch (error) {
      console.error('Failed to get model assigned groups:', error)
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
      console.error('Failed to update model assigned groups:', error)
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
      console.error('Failed to get system stats:', error)
      throw error
    }
  },
  
  getRealtimeStats: async () => {
    try {
      const response = await apiClient.get('/admin/stats/realtime')
      return response.data.data
    } catch (error) {
      console.error('Failed to get realtime stats:', error)
      throw error
    }
  },
  
  getSystemHealth: async () => {
    try {
      const response = await apiClient.get('/admin/stats/health')
      set({ systemHealth: response.data.data })
      return response.data.data
    } catch (error) {
      console.error('Failed to get system health status:', error)
      throw error
    }
  },
  
  performMaintenance: async (action) => {
    try {
      const response = await apiClient.post('/admin/stats/maintenance', { action })
      return response.data
    } catch (error) {
      console.error('Failed to perform maintenance action:', error)
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
      console.error('Failed to get system settings:', error)
      throw error
    }
  },
  
  updateSystemSettings: async (settings) => {
    try {
      const response = await apiClient.put('/admin/settings', settings)
      set({ systemSettings: response.data.data })
      return response.data.data
    } catch (error) {
      console.error('Failed to update system settings:', error)
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
      console.error('Failed to get module list:', error)
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
      console.error('Failed to get user modules:', error)
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
      console.error('Failed to create module:', error)
      throw error
    }
  },
  
  updateModule: async (moduleId, updateData) => {
    try {
      const response = await apiClient.put(`/admin/modules/${moduleId}`, updateData)
      await useAdminStore.getState().getModules()
      return response.data.data
    } catch (error) {
      console.error('Failed to update module:', error)
      throw error
    }
  },
  
  deleteModule: async (moduleId) => {
    try {
      await apiClient.delete(`/admin/modules/${moduleId}`)
      await useAdminStore.getState().getModules()
    } catch (error) {
      console.error('Failed to delete module:', error)
      throw error
    }
  },
  
  toggleModuleStatus: async (moduleId) => {
    try {
      const response = await apiClient.patch(`/admin/modules/${moduleId}/toggle-status`)
      await useAdminStore.getState().getModules()
      return response.data.data
    } catch (error) {
      console.error('Failed to toggle module status:', error)
      throw error
    }
  },
  
  checkModuleHealth: async (moduleId) => {
    try {
      const response = await apiClient.post(`/admin/modules/${moduleId}/check-health`)
      return response.data
    } catch (error) {
      console.error('Failed to check module health status:', error)
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
      console.error('Failed to get API service list:', error)
      set({ loading: false })
      throw error
    }
  },

  getApiService: async (serviceId) => {
    try {
      const response = await apiClient.get(`/admin/api-services/${serviceId}`)
      return response.data.data
    } catch (error) {
      console.error('Failed to get API service detail:', error)
      throw error
    }
  },

  createApiService: async (serviceData) => {
    try {
      const response = await apiClient.post('/admin/api-services', serviceData)
      await useAdminStore.getState().getApiServices()
      return response.data.data
    } catch (error) {
      console.error('Failed to create API service:', error)
      throw error
    }
  },

  updateApiService: async (serviceId, updateData) => {
    try {
      const response = await apiClient.put(`/admin/api-services/${serviceId}`, updateData)
      await useAdminStore.getState().getApiServices()
      return response.data.data
    } catch (error) {
      console.error('Failed to update API service:', error)
      throw error
    }
  },

  deleteApiService: async (serviceId) => {
    try {
      await apiClient.delete(`/admin/api-services/${serviceId}`)
      await useAdminStore.getState().getApiServices()
    } catch (error) {
      console.error('Failed to delete API service:', error)
      throw error
    }
  },

  resetApiServiceKey: async (serviceId) => {
    try {
      const response = await apiClient.post(`/admin/api-services/${serviceId}/reset-key`)
      await useAdminStore.getState().getApiServices()
      return response.data.data
    } catch (error) {
      console.error('Failed to reset API key:', error)
      throw error
    }
  },

  getApiServiceActions: async (serviceId) => {
    try {
      const response = await apiClient.get(`/admin/api-services/${serviceId}/actions`)
      return response.data.data
    } catch (error) {
      console.error('Failed to get service action config:', error)
      throw error
    }
  },

  upsertApiServiceAction: async (serviceId, actionData) => {
    try {
      const response = await apiClient.post(`/admin/api-services/${serviceId}/actions`, actionData)
      return response.data.data
    } catch (error) {
      console.error('Failed to save service action config:', error)
      throw error
    }
  },

  deleteApiServiceAction: async (serviceId, actionType) => {
    try {
      await apiClient.delete(`/admin/api-services/${serviceId}/actions/${actionType}`)
    } catch (error) {
      console.error('Failed to delete service action config:', error)
      throw error
    }
  },

  getApiServiceStats: async (serviceId, params = {}) => {
    try {
      const response = await apiClient.get(`/admin/api-services/${serviceId}/stats`, { params })
      return response.data.data
    } catch (error) {
      console.error('Failed to get service stats:', error)
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
      console.error('Failed to get system prompt list:', error)
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
      console.error('Failed to get system prompts feature status:', error)
      return { success: false, error: error.message }
    }
  },

  getSystemPrompt: async (promptId) => {
    try {
      const response = await apiClient.get(`/admin/system-prompts/${promptId}`)
      return response.data.data
    } catch (error) {
      console.error('Failed to get system prompt detail:', error)
      throw error
    }
  },

  createSystemPrompt: async (promptData) => {
    try {
      const response = await apiClient.post('/admin/system-prompts', promptData)
      await useAdminStore.getState().getSystemPrompts()
      return { success: true, data: response.data.data }
    } catch (error) {
      console.error('Failed to create system prompt:', error)
      return { success: false, error: error.response?.data?.message || error.message }
    }
  },

  updateSystemPrompt: async (promptId, updateData) => {
    try {
      const response = await apiClient.put(`/admin/system-prompts/${promptId}`, updateData)
      await useAdminStore.getState().getSystemPrompts()
      return { success: true, data: response.data.data }
    } catch (error) {
      console.error('Failed to update system prompt:', error)
      return { success: false, error: error.response?.data?.message || error.message }
    }
  },

  deleteSystemPrompt: async (promptId) => {
    try {
      await apiClient.delete(`/admin/system-prompts/${promptId}`)
      await useAdminStore.getState().getSystemPrompts()
      return { success: true }
    } catch (error) {
      console.error('Failed to delete system prompt:', error)
      return { success: false, error: error.response?.data?.message || error.message }
    }
  },

  toggleSystemPromptsFeature: async (enabled) => {
    try {
      const response = await apiClient.put('/admin/system-prompts/toggle', { enabled })
      set({ systemPromptsEnabled: enabled })
      return { success: true, data: response.data.data }
    } catch (error) {
      console.error('Failed to toggle system prompts feature:', error)
      return { success: false, error: error.response?.data?.message || error.message }
    }
  },

  // ===== 使用记录管理 =====
  
  getUsageLogs: async (params = {}) => {
    try {
      const response = await apiClient.get('/admin/usage-logs', { params })
      return response.data.data
    } catch (error) {
      console.error('Failed to get usage logs:', error)
      throw error
    }
  },

  getUsageSummary: async (params = {}) => {
    try {
      const response = await apiClient.get('/admin/usage-logs/summary', { params })
      return response.data.data
    } catch (error) {
      console.error('Failed to get usage summary:', error)
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
      console.error('Failed to export usage logs:', error)
      throw error
    }
  }
}))

export default useAdminStore

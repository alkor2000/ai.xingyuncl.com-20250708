/**
 * 系统配置Store
 * 管理站点名称、Logo等全局配置（支持组级别配置）
 */

import { create } from 'zustand'
import apiClient from '../utils/api'

const useSystemConfigStore = create((set, get) => ({
  // 系统配置
  systemConfig: {
    site: {
      name: 'AI Platform',
      description: '企业级AI应用聚合平台',
      logo: '',
      favicon: ''
    },
    user: {
      allow_register: true,
      default_tokens: 10000,
      default_credits: 1000,
      default_group_id: 1
    },
    ai: {
      default_model: 'gpt-4.1-mini-op',
      temperature: 0.0
    },
    chat: {
      font_family: 'system-ui',
      font_size: 14
    }
  },
  
  // 用户站点配置（可能来自组配置）
  userSiteConfig: null,
  
  loading: false,
  initialized: false,
  
  // 初始化系统配置
  initSystemConfig: async () => {
    const state = get()
    if (state.initialized) return
    
    try {
      set({ loading: true })
      const response = await apiClient.get('/admin/settings')
      
      if (response.data.success && response.data.data) {
        // 处理配置兼容性
        const config = response.data.data
        
        // 处理用户配置兼容性
        if (config.user) {
          // 兼容旧字段名
          if (config.user.default_token_quota !== undefined && config.user.default_tokens === undefined) {
            config.user.default_tokens = config.user.default_token_quota
          }
          if (config.user.default_credits_quota !== undefined && config.user.default_credits === undefined) {
            config.user.default_credits = config.user.default_credits_quota
          }
          // 如果credits配置中有default_credits，优先使用
          if (config.credits && config.credits.default_credits !== undefined) {
            config.user.default_credits = config.credits.default_credits
          }
        }
        
        // 添加chat配置的默认值（如果不存在）
        if (!config.chat) {
          config.chat = {
            font_family: 'system-ui',
            font_size: 14
          }
        } else {
          // 确保有默认值
          if (!config.chat.font_family) {
            config.chat.font_family = 'system-ui'
          }
          if (!config.chat.font_size) {
            config.chat.font_size = 14
          }
        }
        
        // 移除不需要的配置节
        delete config.credits
        
        set({ 
          systemConfig: config,
          initialized: true,
          loading: false
        })
      }
    } catch (error) {
      console.error('初始化系统配置失败:', error)
      set({ loading: false })
    }
  },
  
  // 设置用户站点配置（来自登录或刷新用户信息时）
  setUserSiteConfig: (siteConfig) => {
    set({ userSiteConfig: siteConfig })
  },
  
  // 更新系统配置
  updateSystemConfig: async (config) => {
    try {
      const response = await apiClient.put('/admin/settings', config)
      
      if (response.data.success) {
        set({ systemConfig: config })
        return { success: true }
      }
      
      return { success: false, error: response.data.message }
    } catch (error) {
      console.error('更新系统配置失败:', error)
      return { success: false, error: error.message }
    }
  },
  
  // 上传站点Logo
  uploadSiteLogo: async (file) => {
    try {
      const formData = new FormData()
      formData.append('logo', file)
      
      const response = await apiClient.post('/admin/settings/upload-logo', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })
      
      if (response.data.success) {
        // 更新本地配置
        const state = get()
        const newConfig = {
          ...state.systemConfig,
          site: {
            ...state.systemConfig.site,
            logo: response.data.data.url
          }
        }
        set({ systemConfig: newConfig })
        
        return { success: true, url: response.data.data.url }
      }
      
      return { success: false, error: response.data.message }
    } catch (error) {
      console.error('上传Logo失败:', error)
      return { success: false, error: error.message }
    }
  },
  
  // 获取站点名称（优先使用用户站点配置）
  getSiteName: () => {
    const state = get()
    
    // 如果有用户站点配置（来自组配置）
    if (state.userSiteConfig?.name) {
      return state.userSiteConfig.name
    }
    
    // 否则使用系统配置
    return state.systemConfig?.site?.name || 'AI Platform'
  },
  
  // 获取站点Logo（优先使用用户站点配置）
  getSiteLogo: () => {
    const state = get()
    
    // 如果有用户站点配置（来自组配置）
    if (state.userSiteConfig?.logo) {
      return state.userSiteConfig.logo
    }
    
    // 否则使用系统配置
    return state.systemConfig?.site?.logo || ''
  },
  
  // 获取是否使用组配置
  isUsingGroupConfig: () => {
    const state = get()
    return state.userSiteConfig?.is_group_config === true
  },
  
  // 获取站点描述
  getSiteDescription: () => {
    const state = get()
    // 描述始终使用系统配置
    return state.systemConfig?.site?.description || '企业级AI应用聚合平台'
  },
  
  // 获取默认AI模型
  getDefaultAIModel: () => {
    const state = get()
    return state.systemConfig?.ai?.default_model || 'gpt-4.1-mini-op'
  },
  
  // 获取默认Temperature
  getDefaultTemperature: () => {
    const state = get()
    const temperature = state.systemConfig?.ai?.temperature
    // 确保返回数字类型
    if (temperature !== undefined && temperature !== null) {
      return parseFloat(temperature)
    }
    return 0.0
  },
  
  // 获取默认Token数量
  getDefaultTokens: () => {
    const state = get()
    return state.systemConfig?.user?.default_tokens || 10000
  },
  
  // 获取默认积分数量
  getDefaultCredits: () => {
    const state = get()
    return state.systemConfig?.user?.default_credits || 1000
  },
  
  // 获取AI相关配置
  getAIConfig: () => {
    const state = get()
    return {
      defaultModel: state.systemConfig?.ai?.default_model || 'gpt-4.1-mini-op',
      defaultTemperature: parseFloat(state.systemConfig?.ai?.temperature) || 0.0
    }
  },
  
  // 获取对话字体设置
  getChatFontConfig: () => {
    const state = get()
    return {
      fontFamily: state.systemConfig?.chat?.font_family || 'system-ui',
      fontSize: state.systemConfig?.chat?.font_size || 14
    }
  }
}))

export default useSystemConfigStore

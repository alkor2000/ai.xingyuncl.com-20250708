/**
 * 系统配置Store
 * 管理站点名称、Logo等全局配置
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
    }
  },
  
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
        set({ 
          systemConfig: response.data.data,
          initialized: true,
          loading: false
        })
      }
    } catch (error) {
      console.error('初始化系统配置失败:', error)
      set({ loading: false })
    }
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
  
  // 获取站点名称
  getSiteName: () => {
    const state = get()
    return state.systemConfig?.site?.name || 'AI Platform'
  },
  
  // 获取站点Logo
  getSiteLogo: () => {
    const state = get()
    return state.systemConfig?.site?.logo || ''
  },
  
  // 获取站点描述
  getSiteDescription: () => {
    const state = get()
    return state.systemConfig?.site?.description || '企业级AI应用聚合平台'
  }
}))

export default useSystemConfigStore

/**
 * 模块管理Store - 管理用户可访问的模块
 */

import { create } from 'zustand'
import apiClient from '../utils/api'

const useModuleStore = create((set, get) => ({
  // 状态
  userModules: [], // 用户可访问的模块列表
  loading: false,
  error: null,
  
  // 获取用户可访问的模块
  getUserModules: async () => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.get('/admin/modules/user-modules')
      const modules = response.data.data || []
      
      // 过滤出激活的模块
      const activeModules = modules.filter(m => m.is_active)
      
      set({ 
        userModules: activeModules,
        loading: false 
      })
      
      return activeModules
    } catch (error) {
      console.error('获取用户模块失败:', error)
      set({ 
        error: error.message,
        loading: false 
      })
      return []
    }
  },
  
  // 根据模块名称获取模块信息
  getModuleByName: (name) => {
    const { userModules } = get()
    return userModules.find(m => m.name === name)
  },
  
  // 清空模块列表
  clearModules: () => {
    set({ userModules: [], error: null })
  }
}))

export default useModuleStore

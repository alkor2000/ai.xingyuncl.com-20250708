/**
 * 知识模块状态管理
 * 
 * v1.1 变更（i18n国际化适配）：
 *   - 非React模块无法用useTranslation，改用i18next实例i18n.t()直接调用
 *   - error.response?.data?.message的兜底文案（会展示给调用方组件）改为i18n.t()
 *     新增knowledge.module.*与knowledge.combination.*两个子命名空间共11个键
 *   - 纯开发者日志（console.error）统一改英文，不进语言包
 */

import { create } from 'zustand'
import apiClient from '../utils/api'
import i18n from '../utils/i18n'

const useKnowledgeStore = create((set, get) => ({
  // 状态
  modules: [],
  combinations: [],
  categories: [],
  loading: false,
  error: null,
  
  // 知识模块相关方法
  
  /**
   * 获取知识模块列表
   */
  getModules: async (includeInactive = false) => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.get('/knowledge/modules', {
        params: { include_inactive: includeInactive }
      })
      set({ 
        modules: response.data.data,
        loading: false 
      })
      return response.data.data
    } catch (error) {
      console.error('Failed to fetch knowledge module list:', error)
      set({ 
        error: error.response?.data?.message || i18n.t('knowledge.module.listLoadFailed'),
        loading: false 
      })
      throw error
    }
  },

  /**
   * 获取单个知识模块
   */
  getModule: async (moduleId) => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.get(`/knowledge/modules/${moduleId}`)
      return response.data.data
    } catch (error) {
      console.error('Failed to fetch knowledge module detail:', error)
      set({ 
        error: error.response?.data?.message || i18n.t('knowledge.module.detailLoadFailed'),
        loading: false 
      })
      throw error
    } finally {
      set({ loading: false })
    }
  },

  /**
   * 创建知识模块
   */
  createModule: async (moduleData) => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.post('/knowledge/modules', moduleData)
      const newModule = response.data.data
      
      // 更新列表
      set(state => ({
        modules: [newModule, ...state.modules],
        loading: false
      }))
      
      return newModule
    } catch (error) {
      console.error('Failed to create knowledge module:', error)
      set({ 
        error: error.response?.data?.message || i18n.t('knowledge.module.createFailed'),
        loading: false 
      })
      throw error
    }
  },

  /**
   * 更新知识模块
   */
  updateModule: async (moduleId, updateData) => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.put(`/knowledge/modules/${moduleId}`, updateData)
      const updatedModule = response.data.data
      
      // 更新列表中的模块
      set(state => ({
        modules: state.modules.map(m => 
          m.id === moduleId ? updatedModule : m
        ),
        loading: false
      }))
      
      return updatedModule
    } catch (error) {
      console.error('Failed to update knowledge module:', error)
      set({ 
        error: error.response?.data?.message || i18n.t('knowledge.module.updateFailed'),
        loading: false 
      })
      throw error
    }
  },

  /**
   * 删除知识模块
   */
  deleteModule: async (moduleId) => {
    set({ loading: true, error: null })
    try {
      await apiClient.delete(`/knowledge/modules/${moduleId}`)
      
      // 从列表中移除
      set(state => ({
        modules: state.modules.filter(m => m.id !== moduleId),
        loading: false
      }))
      
      return true
    } catch (error) {
      console.error('Failed to delete knowledge module:', error)
      set({ 
        error: error.response?.data?.message || i18n.t('knowledge.module.deleteFailed'),
        loading: false 
      })
      throw error
    }
  },

  /**
   * 获取模块分类
   */
  getCategories: async () => {
    try {
      const response = await apiClient.get('/knowledge/modules/categories')
      const categories = response.data.data
      set({ categories })
      return categories
    } catch (error) {
      console.error('Failed to fetch category list:', error)
      return []
    }
  },

  // 模块组合相关方法
  
  /**
   * 获取模块组合列表
   */
  getCombinations: async (includeInactive = false) => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.get('/knowledge/combinations', {
        params: { include_inactive: includeInactive }
      })
      set({ 
        combinations: response.data.data,
        loading: false 
      })
      return response.data.data
    } catch (error) {
      console.error('Failed to fetch combination list:', error)
      set({ 
        error: error.response?.data?.message || i18n.t('knowledge.combination.listLoadFailed'),
        loading: false 
      })
      throw error
    }
  },

  /**
   * 获取单个模块组合
   */
  getCombination: async (combinationId) => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.get(`/knowledge/combinations/${combinationId}`)
      return response.data.data
    } catch (error) {
      console.error('Failed to fetch combination detail:', error)
      set({ 
        error: error.response?.data?.message || i18n.t('knowledge.combination.detailLoadFailed'),
        loading: false 
      })
      throw error
    } finally {
      set({ loading: false })
    }
  },

  /**
   * 创建模块组合
   */
  createCombination: async (combinationData) => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.post('/knowledge/combinations', combinationData)
      const newCombination = response.data.data
      
      // 更新列表
      set(state => ({
        combinations: [newCombination, ...state.combinations],
        loading: false
      }))
      
      return newCombination
    } catch (error) {
      console.error('Failed to create combination:', error)
      set({ 
        error: error.response?.data?.message || i18n.t('knowledge.combination.createFailed'),
        loading: false 
      })
      throw error
    }
  },

  /**
   * 更新模块组合
   */
  updateCombination: async (combinationId, updateData) => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.put(`/knowledge/combinations/${combinationId}`, updateData)
      const updatedCombination = response.data.data
      
      // 更新列表中的组合
      set(state => ({
        combinations: state.combinations.map(c => 
          c.id === combinationId ? updatedCombination : c
        ),
        loading: false
      }))
      
      return updatedCombination
    } catch (error) {
      console.error('Failed to update combination:', error)
      set({ 
        error: error.response?.data?.message || i18n.t('knowledge.combination.updateFailed'),
        loading: false 
      })
      throw error
    }
  },

  /**
   * 删除模块组合
   */
  deleteCombination: async (combinationId) => {
    set({ loading: true, error: null })
    try {
      await apiClient.delete(`/knowledge/combinations/${combinationId}`)
      
      // 从列表中移除
      set(state => ({
        combinations: state.combinations.filter(c => c.id !== combinationId),
        loading: false
      }))
      
      return true
    } catch (error) {
      console.error('Failed to delete combination:', error)
      set({ 
        error: error.response?.data?.message || i18n.t('knowledge.combination.deleteFailed'),
        loading: false 
      })
      throw error
    }
  },

  /**
   * 复制模块组合
   */
  copyCombination: async (combinationId, name) => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.post(`/knowledge/combinations/${combinationId}/copy`, { name })
      const newCombination = response.data.data
      
      // 添加到列表
      set(state => ({
        combinations: [newCombination, ...state.combinations],
        loading: false
      }))
      
      return newCombination
    } catch (error) {
      console.error('Failed to copy combination:', error)
      set({ 
        error: error.response?.data?.message || i18n.t('knowledge.combination.copyFailed'),
        loading: false 
      })
      throw error
    }
  },

  /**
   * 清除错误
   */
  clearError: () => set({ error: null })
}))

export default useKnowledgeStore

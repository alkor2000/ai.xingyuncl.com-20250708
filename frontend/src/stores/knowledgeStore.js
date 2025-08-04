/**
 * 知识模块状态管理
 */

import { create } from 'zustand'
import apiClient from '../utils/api'

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
      console.error('获取知识模块列表失败:', error)
      set({ 
        error: error.response?.data?.message || '获取知识模块列表失败',
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
      console.error('获取知识模块详情失败:', error)
      set({ 
        error: error.response?.data?.message || '获取知识模块详情失败',
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
      console.error('创建知识模块失败:', error)
      set({ 
        error: error.response?.data?.message || '创建知识模块失败',
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
      console.error('更新知识模块失败:', error)
      set({ 
        error: error.response?.data?.message || '更新知识模块失败',
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
      console.error('删除知识模块失败:', error)
      set({ 
        error: error.response?.data?.message || '删除知识模块失败',
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
      console.error('获取分类列表失败:', error)
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
      console.error('获取模块组合列表失败:', error)
      set({ 
        error: error.response?.data?.message || '获取模块组合列表失败',
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
      console.error('获取模块组合详情失败:', error)
      set({ 
        error: error.response?.data?.message || '获取模块组合详情失败',
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
      console.error('创建模块组合失败:', error)
      set({ 
        error: error.response?.data?.message || '创建模块组合失败',
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
      console.error('更新模块组合失败:', error)
      set({ 
        error: error.response?.data?.message || '更新模块组合失败',
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
      console.error('删除模块组合失败:', error)
      set({ 
        error: error.response?.data?.message || '删除模块组合失败',
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
      console.error('复制模块组合失败:', error)
      set({ 
        error: error.response?.data?.message || '复制模块组合失败',
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

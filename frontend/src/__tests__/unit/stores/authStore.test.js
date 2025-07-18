/**
 * authStore测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from '@testing-library/react'
import useAuthStore from '../../../stores/authStore'
import apiClient from '../../../utils/api'
import { mockApiResponse } from '../../utils/testUtils'

// Mock API client
vi.mock('../../../utils/api', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn()
  }
}))

describe('authStore', () => {
  beforeEach(() => {
    // 重置store状态
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      loading: false,
      error: null
    })
    
    // 清理mock
    vi.clearAllMocks()
    localStorage.clear()
  })
  
  describe('login', () => {
    it('应该成功登录并保存用户信息', async () => {
      const mockResponse = {
        success: true,
        data: {
          user: {
            id: 1,
            email: 'test@example.com',
            username: 'testuser',
            role: 'user'
          },
          tokens: {
            accessToken: 'mock-access-token',
            refreshToken: 'mock-refresh-token'
          }
        }
      }
      
      apiClient.post.mockResolvedValueOnce({ data: mockResponse })
      
      const { login } = useAuthStore.getState()
      const result = await login('test@example.com', 'password123')
      
      expect(apiClient.post).toHaveBeenCalledWith('/auth/login', {
        email: 'test@example.com',
        password: 'password123'
      })
      
      const state = useAuthStore.getState()
      expect(state.isAuthenticated).toBe(true)
      expect(state.user).toEqual(mockResponse.data.user)
      expect(state.accessToken).toBe('mock-access-token')
      expect(result).toEqual(mockResponse.data)
    })
    
    it('应该处理登录失败', async () => {
      const mockError = {
        response: {
          data: {
            success: false,
            message: '邮箱或密码错误'
          }
        }
      }
      
      apiClient.post.mockRejectedValueOnce(mockError)
      
      const { login } = useAuthStore.getState()
      
      await expect(login('test@example.com', 'wrong-password'))
        .rejects.toThrow('邮箱或密码错误')
      
      const state = useAuthStore.getState()
      expect(state.isAuthenticated).toBe(false)
      expect(state.user).toBeNull()
      expect(state.error).toBe('邮箱或密码错误')
    })
  })
  
  describe('logout', () => {
    it('应该清除用户状态并调用登出API', async () => {
      // 设置初始登录状态
      useAuthStore.setState({
        user: { id: 1, email: 'test@example.com' },
        accessToken: 'mock-token',
        refreshToken: 'mock-refresh',
        isAuthenticated: true
      })
      
      apiClient.post.mockResolvedValueOnce({ data: { success: true } })
      
      const { logout } = useAuthStore.getState()
      await logout()
      
      expect(apiClient.post).toHaveBeenCalledWith('/auth/logout')
      
      const state = useAuthStore.getState()
      expect(state.isAuthenticated).toBe(false)
      expect(state.user).toBeNull()
      expect(state.accessToken).toBeNull()
    })
  })
  
  describe('getCurrentUser', () => {
    it('应该获取当前用户信息', async () => {
      const mockUser = {
        id: 1,
        email: 'test@example.com',
        username: 'testuser',
        role: 'user'
      }
      
      apiClient.get.mockResolvedValueOnce({
        data: {
          success: true,
          data: mockUser
        }
      })
      
      const { getCurrentUser } = useAuthStore.getState()
      await getCurrentUser()
      
      expect(apiClient.get).toHaveBeenCalledWith('/auth/me')
      
      const state = useAuthStore.getState()
      expect(state.user).toEqual(mockUser)
      expect(state.isAuthenticated).toBe(true)
    })
  })
})

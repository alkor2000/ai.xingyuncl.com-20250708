/**
 * 前端测试工具函数
 */

import React from 'react'
import { render } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n/config'

/**
 * 自定义render函数，包含所有必要的Provider
 */
export function renderWithProviders(ui, options = {}) {
  const AllProviders = ({ children }) => (
    <BrowserRouter>
      <I18nextProvider i18n={i18n}>
        <ConfigProvider locale={zhCN}>
          {children}
        </ConfigProvider>
      </I18nextProvider>
    </BrowserRouter>
  )

  return render(ui, { wrapper: AllProviders, ...options })
}

/**
 * 创建mock的store
 */
export const createMockStore = (initialState = {}) => {
  return {
    getState: () => initialState,
    setState: vi.fn(),
    subscribe: vi.fn(),
    destroy: vi.fn()
  }
}

/**
 * 等待异步更新
 */
export const waitForAsync = () => {
  return new Promise(resolve => setTimeout(resolve, 0))
}

/**
 * Mock API响应
 */
export const mockApiResponse = (data, options = {}) => {
  const { status = 200, delay = 0 } = options
  
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        ok: status >= 200 && status < 300,
        status,
        json: async () => data,
        text: async () => JSON.stringify(data)
      })
    }, delay)
  })
}

export * from '@testing-library/react'
export { userEvent } from '@testing-library/user-event'

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './utils/i18n' // 导入i18n配置
import networkService from './services/networkService' // 导入网络监测服务
import './index.css'

// 初始化网络监测服务
if (typeof window !== 'undefined') {
  // 将网络服务挂载到window对象，方便调试
  window.networkService = networkService
  
  // 监听网络状态变化
  networkService.addListener((event, isOnline) => {
    console.log('网络状态变化:', event, isOnline ? '在线' : '离线')
    
    // 网络恢复时，可以触发一些全局操作
    if (event === 'reconnect') {
      // 例如：刷新用户状态、重新获取配置等
      const authStore = window.useAuthStore?.getState()
      if (authStore?.isAuthenticated) {
        // 刷新用户信息
        authStore.fetchUser?.().catch(console.error)
      }
    }
  })
}

// 生产环境不使用StrictMode，避免双重渲染
const rootElement = document.getElementById('root')
const root = ReactDOM.createRoot(rootElement)

if (process.env.NODE_ENV === 'development') {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
} else {
  root.render(<App />)
}

// 页面卸载时清理
window.addEventListener('beforeunload', () => {
  networkService.destroy()
})

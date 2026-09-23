import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { captureTaskContext } from './components/htmlEditor/TaskArtifactPanel'
import i18n from './utils/i18n' // 导入i18n配置
import { loader } from '@monaco-editor/react'
import 'monaco-editor/esm/nls.messages.zh-cn.js'

// Monaco 0.54 的 AMD 依赖并行加载；先初始化语言表，避免慢网络下菜单先固化为英文。
const chineseEditorMessages = globalThis._VSCODE_NLS_MESSAGES
const configureEditorLanguage = () => {
  const language = i18n.language?.startsWith('zh') ? 'zh-cn' : 'en'
  globalThis._VSCODE_NLS_MESSAGES = language === 'zh-cn' ? chineseEditorMessages : undefined
  globalThis._VSCODE_NLS_LANGUAGE = language
  loader.config({
    paths: { vs: '/monaco/vs' },
    'vs/nls': { availableLanguages: { '*': language } }
  })
}
configureEditorLanguage()
i18n.on('languageChanged', configureEditorLanguage)
import networkService from './services/networkService' // 导入网络监测服务
import './index.css'
import './styles/platform-chrome.css'
import './styles/responsive.css'

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

// 教学任务上下文是凭据：在应用发出任何请求、渲染任何页面之前，从地址栏片段取走并清掉，只留在内存里。
captureTaskContext()

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

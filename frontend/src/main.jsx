import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './utils/i18n' // 导入i18n配置
import './index.css'

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

// Development entry only: actual Chat UI; server fixture supplies synthetic data.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '../src/utils/i18n'
import Chat from '../src/pages/chat/Chat'
import ThemeProvider from '../src/components/ThemeProvider'
import useAuthStore from '../src/stores/authStore'
import '../src/index.css'
import '../src/styles/platform-chrome.css'
useAuthStore.setState({ user: { id: 101, username: '合成验收老师', role: 'user' } })
createRoot(document.getElementById('root')).render(<ThemeProvider><BrowserRouter>
  <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }} className="basic-layout">
    <div style={{ fontSize: 12, padding: '4px 12px', background: '#fff7e6' }}>合成数据验收 · 未调用真实模型 · 未存入 TE-DNA</div>
    <div style={{ flex: 1, minHeight: 0 }}><Chat /></div>
  </div>
</BrowserRouter></ThemeProvider>)

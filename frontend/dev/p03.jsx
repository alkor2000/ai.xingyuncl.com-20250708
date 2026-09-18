// Vite development entry only. Not registered in App.jsx or the production build inputs.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Card, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import '../src/utils/i18n'
import MessageContent from '../src/components/chat/MessageContent'
import ThemeProvider from '../src/components/ThemeProvider'
import '../src/index.css'
import '../src/styles/platform-chrome.css'
const message = {
  id: 'a0300000-0000-4000-8000-000000000001', role: 'assistant', status: 'completed',
  content: '# 水循环探究方案\n\n先观察，再记录两杯水的变化。\n\n比较结果，讨论影响蒸发的条件。🌧️\n\n参考链接：https://example.org/water-cycle（仅链接，未抓取正文）。\n',
  created_at: '2026-09-18T00:00:00Z'
}
function Demo() {
  const { t } = useTranslation()
  return <ThemeProvider><main className="basic-layout" style={{ maxWidth: 800, margin: '24px auto', padding: 16 }}>
    <Typography.Title level={3}>{t('chat.p03.title')}</Typography.Title>
    <Typography.Text type="secondary">{t('chat.p03.devOnly')}</Typography.Text>
    <Card style={{ marginTop: 24 }}><MessageContent message={message} /></Card>
  </main></ThemeProvider>
}
createRoot(document.getElementById('root')).render(<Demo />)

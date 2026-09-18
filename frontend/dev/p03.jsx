// Vite development entry only. Not registered in App.jsx or the production build inputs.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Alert, Card, ConfigProvider } from 'antd'
import { useTranslation } from 'react-i18next'
import '../src/utils/i18n'
import MessageContent from '../src/components/chat/MessageContent'
const message = {
  id: 'a0300000-0000-4000-8000-000000000001', role: 'assistant', status: 'completed',
  content: '# 水循环探究方案\n\n先观察，再记录两杯水的变化。\n\n比较结果，讨论影响蒸发的条件。🌧️\n\n参考链接：https://example.org/water-cycle（仅链接，未抓取正文）。\n',
  created_at: '2026-09-18T00:00:00Z'
}
function Demo() {
  const { t } = useTranslation()
  return <ConfigProvider><main style={{ maxWidth: 920, margin: '24px auto', padding: 16 }}>
    <h1>{t('chat.p03.title')}</h1>
    <Alert type="warning" showIcon message={t('chat.p03.devOnly')} description={t('chat.p03.demo')} />
    <Card style={{ marginTop: 24 }}><MessageContent message={message} /></Card>
    <Card style={{ marginTop: 12 }}><MessageContent message={{ ...message, id: 'a0300000-0000-4000-8000-000000000002', role: 'user', content: 'UNSELECTED_PRIVATE_PROMPT' }} /></Card>
  </main></ConfigProvider>
}
createRoot(document.getElementById('root')).render(<Demo />)

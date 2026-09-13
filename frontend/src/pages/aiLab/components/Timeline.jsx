/**
 * 过程时间线：按顺序列出本项目的过程事实（只记发生了什么，不做判断）
 */
import React, { useEffect, useState } from 'react'
import { Timeline as AntTimeline, Button, Typography, Empty } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useAiLabStore from '../../../stores/aiLabStore'

const { Text } = Typography

const summarize = (e) => {
  const p = e.payload || {}
  const parts = []
  if (p.version) parts.push(`v${p.version}`)
  if (p.split) parts.push(p.split + (p.shift_set ? `:${p.shift_set}` : ''))
  if (typeof p.accuracy === 'number') parts.push(`${(p.accuracy * 100).toFixed(0)}%`)
  if (typeof p.count === 'number') parts.push(`×${p.count}`)
  if (p.class_key) parts.push(p.class_key)
  if (p.text) parts.push(String(p.text).slice(0, 60))
  if (p.scope) parts.push(String(p.scope).slice(0, 60))
  if (Array.isArray(p.rows)) parts.push(`${p.rows.length} rows`)
  return parts.join(' · ')
}

const Timeline = () => {
  const { t, i18n } = useTranslation()
  const { events, fetchEvents } = useAiLabStore()
  const [loading, setLoading] = useState(false)

  const load = async () => { setLoading(true); try { await fetchEvents() } finally { setLoading(false) } }
  useEffect(() => { load() /* 只拉数据，不产生文案 */ }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <Button size="small" icon={<ReloadOutlined />} onClick={load} loading={loading} style={{ marginBottom: 12 }}>{t('common.refresh')}</Button>
      {!events.length && <Empty description={t('aiLab.timeline.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />}
      <AntTimeline
        items={events.map((e) => ({
          key: e.id,
          children: (
            <div>
              <Text strong>{t(`aiLab.event.${e.type.replace('.', '_')}`)}</Text>
              <Text type="secondary" style={{ marginLeft: 8 }}>{new Date(e.created_at || e.client_ts).toLocaleString(i18n.language)}</Text>
              <div className="ailab-muted">{summarize(e)}</div>
            </div>
          )
        }))}
      />
    </div>
  )
}

export default Timeline

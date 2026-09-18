import React, { useRef, useState } from 'react'
import { Alert, Button, Checkbox, Input, Modal, Radio, Space, Spin, Typography } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import api from '../../utils/api'
import { downloadBlob } from '../../utils/canvas/download'

const ROOT = '/artifact-exports/messages'
const preStyle = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 240, overflowY: 'auto', margin: 0, padding: 16, borderRadius: 8, fontFamily: 'inherit', lineHeight: 1.7, background: 'var(--user-message-bg, #f6f7f9)' }

// Export is private to the source account. No receiver or cross-platform identity is involved.
export default function ArtifactExport({ messageId }) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [error, setError] = useState(null)
  const [preview, setPreview] = useState(null)
  const [scope, setScope] = useState('all')
  const [range, setRange] = useState({ start: 0, end: 0 })
  const [files, setFiles] = useState([])
  const run = async fn => {
    if (lock.current) return
    lock.current = true
    setBusy(true); setError(null)
    try { await fn() } catch (e) {
      let data = e.response?.data
      if (data instanceof Blob) {
        try { data = JSON.parse(await data.text()) } catch { data = null }
      }
      setError(data?.error?.code || 'network_error')
    } finally { lock.current = false; setBusy(false) }
  }
  const load = () => run(async () => {
    setPreview(null); setFiles([]); setScope('all'); setRange({ start: 0, end: 0 })
    const { data } = await api.get(`${ROOT}/${messageId}`, { skipDebugLogging: true })
    setPreview(data)
  })
  const selected = preview && (scope === 'all' ? { start: 0, end: preview.text.length } : range)
  const selectedText = preview ? preview.text.slice(selected.start, selected.end) : ''
  const download = () => run(async () => {
    const response = await api.post(`${ROOT}/${messageId}/download`, {
      schema_version: 1, expected_version: preview.source.version, selection: selected,
      attachments: preview.attachments.filter(item => files.includes(item.source_id))
        .map(item => ({ source_id: item.source_id, expected_version: item.version }))
    }, { responseType: 'blob', skipDebugLogging: true })
    downloadBlob(response.data, `answer-${messageId.slice(0, 8)}.zip`)
    setOpen(false)
  })
  const prefix = 'chat.export.'
  const readyFiles = preview?.attachments.filter(item => item.status === 'ready') || []
  const needsReload = ['source_changed', 'source_unavailable', 'attachment_unavailable'].includes(error)
  return <>
    <Button aria-label={t(`${prefix}entry`)} size="small" type="text" icon={<DownloadOutlined aria-hidden="true" />} onClick={() => { setOpen(true); load() }}>{t(`${prefix}entry`)}</Button>
    <Modal open={open} title={t(`${prefix}entry`)} width={680} footer={null}
      onCancel={() => { if (!busy) setOpen(false) }} closable={!busy} maskClosable={false}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {error && <Alert type="error" showIcon message={t(`chat.export.error.${i18n.exists(`chat.export.error.${error}`) ? error : 'unknown'}`)} />}
        {busy && !preview && <Spin />}
        {preview && <>
          <Radio.Group value={scope} onChange={e => { setScope(e.target.value); setRange({ start: 0, end: 0 }) }} disabled={busy}>
            <Radio value="all">{t('chat.p03.whole')}</Radio><Radio value="range">{t('chat.p03.range')}</Radio>
          </Radio.Group>
          {scope === 'range' && <>
            <Typography.Text type="secondary">{t('chat.p03.selectHint')}</Typography.Text>
            <Input.TextArea aria-label={t('chat.p03.original')} value={preview.text} readOnly rows={5} disabled={busy}
              onSelect={e => setRange({ start: e.target.selectionStart, end: e.target.selectionEnd })} />
          </>}
          <pre data-testid="export-selection" style={preStyle}>{selectedText || t('chat.p03.emptySelection')}</pre>
          {readyFiles.length > 0 && <div>
            <Typography.Paragraph strong style={{ marginBottom: 8 }}>{t('chat.p03.attachments')}</Typography.Paragraph>
            <Space direction="vertical" style={{ width: '100%' }}>{readyFiles.map(item => <div key={item.source_id} style={{ overflowWrap: 'anywhere' }}>
              <Checkbox checked={files.includes(item.source_id)} disabled={busy || (!files.includes(item.source_id) && files.length >= 3)}
                onChange={e => setFiles(current => e.target.checked ? [...current, item.source_id] : current.filter(id => id !== item.source_id))}>
                {item.name || t('chat.p03.unnamedFile')}
              </Checkbox>
              {files.includes(item.source_id) && <details><summary style={{ cursor: 'pointer' }}>{t('chat.p03.previewFile', { name: item.name })}</summary><pre style={preStyle}>{item.text}</pre></details>}
            </div>)}</Space>
          </div>}
          <Typography.Text type="secondary">{t(`${prefix}packageHint`)}</Typography.Text>
          <Space wrap>
            <Button aria-label={t(`${prefix}download`)} type="primary" icon={<DownloadOutlined aria-hidden="true" />} loading={busy} disabled={busy || needsReload || !selectedText.trim()} onClick={download}>{t(`${prefix}download`)}</Button>
            {error && <Button disabled={busy} onClick={load}>{t('chat.p03.reload')}</Button>}
          </Space>
        </>}
        {!preview && !busy && <Button onClick={load}>{t('chat.p03.reload')}</Button>}
      </Space>
    </Modal>
  </>
}

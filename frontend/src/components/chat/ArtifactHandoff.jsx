import React, { useEffect, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Descriptions, Input, Modal, Radio, Select, Space, Spin, Steps, Tag, Typography } from 'antd'
import { BookOutlined, ReloadOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import api from '../../utils/api'

// "保存到备课资源库": one explicit selection -> preview of exactly what will be sent -> explicit save -> status.
// The entry exists only when the deployment's formal handoff runtime is enabled (capability), it never sends
// anything before the teacher confirms, and it recovers an operation from the server after a reload. The
// teacher's identity is the login session; nothing about the account or the target travels in the request body.
const ROOT = '/p03/handoffs'
const preStyle = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 240, overflowY: 'auto', margin: 0, padding: 16, borderRadius: 8, fontFamily: 'inherit', lineHeight: 1.7, background: 'var(--user-message-bg, #f6f7f9)' }
let capabilityPromise = null
// One capability lookup per page load; a failure means "not available" and is retried on the next page load only.
export function loadCapability(client = api) {
  if (!capabilityPromise) {
    capabilityPromise = client.get(`${ROOT}/capability`, { skipDebugLogging: true, skipErrorMessage: true })
      .then(({ data }) => (data?.available === true ? data : { available: false }))
      .catch(() => ({ available: false }))
  }
  return capabilityPromise
}
export function resetCapabilityCache() { capabilityPromise = null }
const settled = status => ['succeeded', 'recycled', 'deleted', 'cancelled', 'expired', 'rejected'].includes(status)
const terminal = status => ['deleted', 'cancelled', 'expired', 'rejected'].includes(status)
// Status tone for the status card; the copy itself comes from i18n.
const tone = status => ({ succeeded: 'success', recycled: 'warning', unknown: 'warning', deleted: 'default', cancelled: 'default', expired: 'default', rejected: 'error' }[status] || 'processing')
const formatTime = (ms, locale) => (ms ? new Date(ms).toLocaleString(locale) : '')

export default function ArtifactHandoff({ messageId, client = api }) {
  const { t, i18n } = useTranslation()
  const [capability, setCapability] = useState(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [error, setError] = useState(null)
  const [step, setStep] = useState(0) // 0 select, 1 preview, 2 status
  const [preview, setPreview] = useState(null)
  const [scope, setScope] = useState('all')
  const [range, setRange] = useState({ start: 0, end: 0 })
  const [files, setFiles] = useState([])
  const [purpose, setPurpose] = useState('reference')
  const [title, setTitle] = useState('')
  const [operation, setOperation] = useState(null)
  const [saving, setSaving] = useState(false)
  const freezeKey = useRef(null)
  useEffect(() => { let alive = true; loadCapability(client).then(c => { if (alive) setCapability(c) }); return () => { alive = false } }, [client])
  const run = async fn => {
    if (lock.current) return
    lock.current = true
    setBusy(true); setError(null)
    try { await fn() } catch (e) {
      const data = e.response?.data
      setError({ code: data?.error?.code || 'network_error', retryable: !!data?.error?.retryable, requestId: data?.request_id })
    } finally { lock.current = false; setBusy(false) }
  }
  // The modal shows the exact code and request id itself, so the client's generic toast stays off for these calls.
  const options = { skipDebugLogging: true, skipErrorMessage: true }
  const get = async path => (await client.get(`${ROOT}${path}`, options)).data
  const post = async (path, body, key) => (await client.post(`${ROOT}${path}`, body, { ...options, headers: key ? { 'Idempotency-Key': key } : {} })).data
  const load = () => run(async () => {
    setPreview(null); setFiles([]); setScope('all'); setRange({ start: 0, end: 0 }); setOperation(null); setStep(0); freezeKey.current = null
    // A reload recovers this account's existing saves for the message from the server; nothing is asked of any peer.
    const existing = (await get(`?message_id=${messageId}`)).operations || []
    const latest = existing.find(op => !terminal(op.status)) || existing[0]
    if (latest) { setOperation(latest); setStep(2); return }
    const data = await get(`/messages/${messageId}`)
    setPreview(data); setRange({ start: 0, end: data.text.length })
    setTitle(Array.from(data.text.replace(/\s+/g, ' ').trim()).slice(0, 40).join('') || t('chat.handoff.defaultTitle'))
  })
  const startFresh = () => run(async () => {
    setOperation(null); setStep(0); freezeKey.current = null
    const data = await get(`/messages/${messageId}`)
    setPreview(data); setRange({ start: 0, end: data.text.length }); setFiles([]); setScope('all')
    setTitle(Array.from(data.text.replace(/\s+/g, ' ').trim()).slice(0, 40).join('') || t('chat.handoff.defaultTitle'))
  })
  const selected = preview && (scope === 'all' ? { start: 0, end: preview.text.length } : range)
  const selectedText = preview ? preview.text.slice(selected.start, selected.end) : ''
  const chosenFiles = preview ? preview.attachments.filter(item => files.includes(item.source_id)) : []
  const request = () => ({ schema_version: 1, message_id: messageId, expected_version: preview.source.version, selection: selected,
    attachments: chosenFiles.map(item => ({ source_id: item.source_id, expected_version: item.version })), purpose, title: title.trim() })
  // Freeze + save happen only here, after the teacher has read the preview and pressed the explicit button.
  const save = () => run(async () => {
    setSaving(true)
    let frozen = null
    try {
      const body = request()
      const serialized = JSON.stringify(body)
      if (freezeKey.current?.serialized !== serialized) freezeKey.current = { serialized, key: crypto.randomUUID() }
      frozen = await post('', body, freezeKey.current.key)
      setOperation(frozen); setStep(2)
      setOperation(await post(`/${frozen.operation_id}/save`))
    } catch (e) {
      // A frozen operation stays recoverable on the server: show its real state next to the error instead of losing it.
      if (frozen) setOperation(await get(`/${frozen.operation_id}`).then(view => (view?.operation_id ? view : frozen)).catch(() => frozen))
      throw e
    } finally { setSaving(false) }
  })
  const retry = () => run(async () => { setSaving(true); try { setOperation(await post(`/${operation.operation_id}/save`)) } finally { setSaving(false) } })
  const refresh = () => run(async () => { setOperation(await post(`/${operation.operation_id}/refresh`)) })
  const cancel = () => run(async () => { setOperation(await post(`/${operation.operation_id}/cancel`)) })
  const readyFiles = preview?.attachments.filter(item => item.status === 'ready') || []
  const nowS = Math.floor(Date.now() / 1000)
  const pastR = operation?.recovery_until && nowS >= operation.recovery_until
  const canRetry = operation && !settled(operation.status) && !pastR && operation.status !== 'prepared'
  const errorKey = code => (i18n.exists(`chat.handoff.error.${code}`) ? `chat.handoff.error.${code}` : 'chat.handoff.error.unknown')
  const prefix = 'chat.handoff.'
  if (!capability?.available) return null
  return <>
    <Button aria-label={t(`${prefix}entry`)} size="small" type="text" icon={<BookOutlined aria-hidden="true" />} onClick={() => { setOpen(true); load() }}>{t(`${prefix}entry`)}</Button>
    <Modal open={open} title={t(`${prefix}title`)} width={720} footer={null} destroyOnClose
      onCancel={() => { if (!busy) setOpen(false) }} closable={!busy} maskClosable={false}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Steps size="small" current={step} responsive={false} items={[{ title: t(`${prefix}step.select`) }, { title: t(`${prefix}step.preview`) }, { title: t(`${prefix}step.status`) }]} />
        {error && <Alert type={error.retryable ? 'warning' : 'error'} showIcon message={t(errorKey(error.code))}
          description={error.requestId ? t(`${prefix}requestId`, { id: error.requestId }) : null} data-testid="handoff-error" />}
        {busy && !preview && !operation && <Spin />}
        {step === 0 && preview && <>
          <Radio.Group value={scope} onChange={e => { setScope(e.target.value); setRange({ start: 0, end: 0 }) }} disabled={busy}>
            <Radio value="all">{t('chat.p03.whole')}</Radio><Radio value="range">{t('chat.p03.range')}</Radio>
          </Radio.Group>
          {scope === 'range' && <>
            <Typography.Text type="secondary">{t('chat.p03.selectHint')}</Typography.Text>
            <Input.TextArea aria-label={t('chat.p03.original')} value={preview.text} readOnly rows={5} disabled={busy}
              onSelect={e => setRange({ start: e.target.selectionStart, end: e.target.selectionEnd })} />
          </>}
          <pre data-testid="handoff-selection" style={preStyle}>{selectedText || t('chat.p03.emptySelection')}</pre>
          {readyFiles.length > 0 && <div>
            <Typography.Paragraph strong style={{ marginBottom: 8 }}>{t('chat.p03.attachments')}</Typography.Paragraph>
            <Space direction="vertical" style={{ width: '100%' }}>{readyFiles.map(item => <div key={item.source_id} style={{ overflowWrap: 'anywhere' }}>
              <Checkbox checked={files.includes(item.source_id)} disabled={busy || (!files.includes(item.source_id) && files.length >= 3)}
                onChange={e => setFiles(current => e.target.checked ? [...current, item.source_id] : current.filter(id => id !== item.source_id))}>
                {item.name || t('chat.p03.unnamedFile')}
              </Checkbox>
            </div>)}</Space>
          </div>}
          <Space direction="vertical" style={{ width: '100%' }} size="small">
            <Typography.Text strong>{t(`${prefix}titleLabel`)}</Typography.Text>
            <Input aria-label={t(`${prefix}titleLabel`)} value={title} maxLength={120} showCount disabled={busy} onChange={e => setTitle(e.target.value)} />
            <Typography.Text strong>{t('chat.p03.purpose')}</Typography.Text>
            <Select aria-label={t('chat.p03.purpose')} value={purpose} disabled={busy} onChange={setPurpose} style={{ width: '100%', maxWidth: 320 }}
              options={(capability.purposes || ['reference', 'lesson_preparation', 'courseware']).map(value => ({ value, label: t(`chat.p03.purpose.${value}`) }))} />
          </Space>
          <Space wrap>
            <Button type="primary" disabled={busy || !selectedText.trim() || !title.trim()} onClick={() => setStep(1)}>{t(`${prefix}toPreview`)}</Button>
            {error && <Button disabled={busy} onClick={load}>{t('chat.p03.reload')}</Button>}
          </Space>
        </>}
        {step === 1 && preview && <>
          <Alert type="info" showIcon message={t(`${prefix}previewHint`)} />
          <Descriptions size="small" column={1} bordered items={[
            { key: 'title', label: t(`${prefix}titleLabel`), children: title.trim() },
            { key: 'purpose', label: t('chat.p03.purpose'), children: t(`chat.p03.purpose.${purpose}`) },
            { key: 'source', label: t(`${prefix}sourceLabel`), children: t('chat.p03.source', { id: messageId.slice(0, 8), version: preview.source.version.slice(7, 19) }) },
            { key: 'target', label: t(`${prefix}targetLabel`), children: t(`${prefix}targetValue`) },
            { key: 'attachments', label: t('chat.p03.attachments'), children: chosenFiles.length ? chosenFiles.map(f => f.name).join('、') : t(`${prefix}noneSelected`) }
          ]} />
          <pre data-testid="handoff-preview" style={preStyle}>{selectedText}</pre>
          <Typography.Text type="secondary">{t('chat.p03.boundary')}</Typography.Text>
          <Space wrap>
            <Button disabled={busy} onClick={() => setStep(0)}>{t(`${prefix}back`)}</Button>
            <Button type="primary" icon={<BookOutlined aria-hidden="true" />} loading={busy} disabled={busy} onClick={save} data-testid="handoff-confirm">{t(`${prefix}confirm`)}</Button>
          </Space>
        </>}
        {step === 2 && operation && <>
          <Space wrap align="center">
            <Tag color={tone(saving ? 'saving' : operation.status)} data-testid="handoff-status">{t(`${prefix}status.${saving ? 'saving' : operation.status}`, { defaultValue: operation.status })}</Tag>
            {(saving || busy) && <Spin size="small" />}
          </Space>
          <Descriptions size="small" column={1} bordered items={[
            { key: 'id', label: t(`${prefix}operation`), children: <Typography.Text code>{operation.operation_id}</Typography.Text> },
            ...(operation.resource_ref ? [{ key: 'ref', label: t(`${prefix}resource`), children: <Typography.Text code>{operation.resource_ref.slice(0, 8)}</Typography.Text> }] : []),
            ...(operation.status === 'recycled' && operation.recycle_until ? [{ key: 'rb', label: t(`${prefix}recycleUntil`), children: formatTime(operation.recycle_until * 1000, i18n.language) }] : []),
            ...(operation.last_synced_at ? [{ key: 'sync', label: t(`${prefix}lastSynced`), children: formatTime(operation.last_synced_at, i18n.language) }] : []),
            ...(operation.recovery_until ? [{ key: 'r', label: t(`${prefix}recoveryUntil`), children: formatTime(operation.recovery_until * 1000, i18n.language) }] : [])
          ]} />
          <Typography.Text type="secondary">{t(`${prefix}statusHint.${pastR ? 'pastR' : operation.status === 'recycled' ? 'recycled' : operation.status === 'succeeded' ? 'succeeded' : 'generic'}`)}</Typography.Text>
          <Space wrap>
            {canRetry && !saving && <Button type="primary" icon={<ReloadOutlined aria-hidden="true" />} disabled={busy} onClick={retry} data-testid="handoff-retry">{t(`${prefix}retry`)}</Button>}
            {!pastR && !saving && <Button disabled={busy} onClick={refresh} data-testid="handoff-refresh">{t(`${prefix}refresh`)}</Button>}
            {operation.status === 'ready' && !saving && <Button danger disabled={busy} onClick={cancel}>{t(`${prefix}cancel`)}</Button>}
            {!saving && <Button disabled={busy} onClick={startFresh}>{t('chat.p03.newSelection')}</Button>}
            <Button disabled={busy} onClick={() => setOpen(false)}>{t(`${prefix}close`)}</Button>
          </Space>
        </>}
      </Space>
    </Modal>
  </>
}

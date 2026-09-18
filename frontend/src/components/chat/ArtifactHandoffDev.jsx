import React, { useRef, useState } from 'react'
import { Alert, Button, Checkbox, Input, Modal, Radio, Select, Space, Spin, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import api from '../../utils/api'
import { downloadBlob } from '../../utils/canvas/download'

const ROOT = '/dev/p03'
const preStyle = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 240, overflowY: 'auto', padding: 12, background: 'var(--user-message-bg, #f6f7f9)' }

// Imported only by the opt-in Vite development branch in MessageContent.
export default function ArtifactHandoffDev({ messageId }) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [error, setError] = useState(null)
  const [preview, setPreview] = useState(null)
  const [scope, setScope] = useState('all')
  const [range, setRange] = useState({ start: 0, end: 0 })
  const [files, setFiles] = useState([])
  const [purpose, setPurpose] = useState('reference')
  const [snapshot, setSnapshot] = useState(null)
  const [status, setStatus] = useState(null)
  const [simulation, setSimulation] = useState('success')
  const [authorization, setAuthorization] = useState('valid')
  const grant = useRef(null)
  const freezeRequest = useRef(null)
  const deliverKey = useRef(null)
  const run = async fn => {
    if (lock.current) return
    lock.current = true
    setBusy(true); setError(null)
    try { await fn() } catch (e) {
      setError({ code: e.response?.data?.error?.code || 'network_error', requestId: e.response?.data?.request_id })
    } finally { lock.current = false; setBusy(false) }
  }
  const post = async (path, body, key) => (await api.post(`${ROOT}${path}`, { schema_version: 1, ...body },
    { headers: { 'Idempotency-Key': key }, skipDebugLogging: true })).data
  const get = async path => (await api.get(`${ROOT}${path}`, { skipDebugLogging: true })).data
  const load = () => run(async () => {
    setSnapshot(null); setStatus(null); setPreview(null); setFiles([]); setScope('all')
    grant.current = null; freezeRequest.current = null; deliverKey.current = null
    const data = await get(`/messages/${messageId}`)
    setPreview(data); setRange({ start: 0, end: data.text.length })
  })
  const selected = preview && (scope === 'all' ? { start: 0, end: preview.text.length } : range)
  const selectedText = preview ? preview.text.slice(selected.start, selected.end) : ''
  const freeze = () => run(async () => {
    const body = { message_id: messageId, expected_version: preview.source.version, selection: selected,
      attachments: preview.attachments.filter(item => files.includes(item.source_id)).map(item => ({ source_id: item.source_id, expected_version: item.version })), purpose }
    const serialized = JSON.stringify(body)
    // Keep the exact request/key when the response is lost; changing the selection is a new intent.
    if (freezeRequest.current?.serialized !== serialized) freezeRequest.current = { serialized, key: crypto.randomUUID() }
    const data = await post('/snapshots', body, freezeRequest.current.key)
    setSnapshot(data); setStatus({ state: 'prepared' }); grant.current = null; deliverKey.current = crypto.randomUUID()
  })
  const resume = () => run(async () => {
    const data = await get(`/snapshots/${preview.latest_snapshot_id}`)
    setSnapshot(data); setStatus(await get(`/snapshots/${data.id}/status`))
    deliverKey.current = crypto.randomUUID(); grant.current = null
  })
  const deliver = () => run(async () => {
    // Query/retry uses the same snapshot operation. No TE-DNA credentials are ever requested.
    if (!grant.current) grant.current = await post(`/snapshots/${snapshot.id}/authorize`, { simulation: authorization }, crypto.randomUUID())
    if (!deliverKey.current) deliverKey.current = crypto.randomUUID()
    try {
      const result = await post(`/snapshots/${snapshot.id}/deliver`, { grant_id: grant.current.grant_id, simulation }, deliverKey.current)
      setStatus(result)
    } catch (e) {
      if (e.response?.data?.error?.code === 'authorization_expired') grant.current = null
      try { setStatus(await get(`/snapshots/${snapshot.id}/status`)) } catch { /* Preserve the original failure. */ }
      throw e
    }
  })
  const download = format => run(async () => {
    const fresh = await get(`/snapshots/${snapshot.id}`) // Revalidate current source access, even for local downloads.
    const body = format === 'json' ? JSON.stringify({ manifest: fresh.manifest, payload: fresh.payload }, null, 2) : fresh.payload.text
    downloadBlob(new Blob([body], { type: format === 'json' ? 'application/json' : 'text/markdown;charset=utf-8' }), `practice-${fresh.id}.${format}`)
  })
  const prefix = 'chat.p03.'
  const renderFiles = items => items.map(item => <div key={item.source_id}>
    <Typography.Text>{item.name || item.source_id}</Typography.Text>
    <pre style={preStyle}>{item.text}</pre>
  </div>)
  return <>
    <Button size="small" type="text" onClick={() => { setOpen(true); load() }}>{t(`${prefix}entry`)}</Button>
    <Modal open={open} title={t(`${prefix}title`)} width={800} footer={null}
      onCancel={() => { if (!busy) setOpen(false) }} closable={!busy} maskClosable={false}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Alert type="warning" showIcon message={t(`${prefix}devOnly`)} description={t(`${prefix}boundary`)} />
        {error && <Alert type="error" showIcon message={t(`${prefix}failed`)}
          description={<>{t(`${prefix}error.${i18n.exists(`${prefix}error.${error.code}`) ? error.code : 'unknown'}`)} {error.requestId && <code>{error.requestId}</code>}</>} />}
        {busy && <Spin />}
        {!preview && !busy && <Button onClick={load}>{t(`${prefix}reload`)}</Button>}
        {preview && !snapshot && <>
          <Typography.Text style={{ overflowWrap: 'anywhere' }}>{t(`${prefix}source`, { id: preview.source.object_id, version: preview.source.version })}</Typography.Text>
          <Typography.Text>{t(`${prefix}selectHint`)}</Typography.Text>
          <Radio.Group value={scope} onChange={e => setScope(e.target.value)} disabled={busy}>
            <Radio value="all">{t(`${prefix}whole`)}</Radio><Radio value="range">{t(`${prefix}range`)}</Radio>
          </Radio.Group>
          <Input.TextArea aria-label={t(`${prefix}original`)} value={preview.text} readOnly rows={8}
            onSelect={e => { setRange({ start: e.target.selectionStart, end: e.target.selectionEnd }); if (e.target.selectionEnd > e.target.selectionStart) setScope('range') }} />
          <Typography.Text>{t(`${prefix}scope`, { start: selected.start, end: selected.end, count: selectedText.length })}</Typography.Text>
          <pre data-testid="handoff-selection" style={preStyle}>{selectedText}</pre>
          <Typography.Text>{t(`${prefix}attachments`)}</Typography.Text>
          {preview.attachments.length === 0 && <Typography.Text type="secondary">{t(`${prefix}noAttachments`)}</Typography.Text>}
          {preview.attachments.map(item => <Checkbox key={item.source_id} checked={files.includes(item.source_id)}
            disabled={busy || item.status !== 'ready' || (!files.includes(item.source_id) && files.length >= 3)}
            onChange={e => setFiles(current => e.target.checked ? [...current, item.source_id] : current.filter(id => id !== item.source_id))}>
            {item.name || item.source_id} — {t(`${prefix}file.${item.status}`)}
          </Checkbox>)}
          {preview.attachments_truncated && <Typography.Text>{t(`${prefix}truncated`)}</Typography.Text>}
          {renderFiles(preview.attachments.filter(item => files.includes(item.source_id)))}
          <label>{t(`${prefix}purpose`)} <Select aria-label={t(`${prefix}purpose`)} value={purpose} disabled={busy} onChange={setPurpose} style={{ minWidth: 200 }}
            options={['reference', 'lesson_preparation', 'courseware'].map(value => ({ value, label: t(`${prefix}purpose.${value}`) }))} /></label>
          <Space wrap>
            <Button type="primary" disabled={busy || !selectedText.trim()} onClick={freeze}>{t(`${prefix}freeze`)}</Button>
            <Button disabled={busy} onClick={load}>{t(`${prefix}reload`)}</Button>
            {preview.latest_snapshot_id && <Button disabled={busy} onClick={resume}>{t(`${prefix}resume`)}</Button>}
          </Space>
        </>}
        {snapshot && <>
          <Alert type={status?.state === 'mock_received' ? 'success' : 'info'} message={t(`${prefix}status.${status?.state || 'prepared'}`)} />
          <Typography.Text style={{ overflowWrap: 'anywhere' }}>{t(`${prefix}source`, { id: snapshot.manifest.source.object_id, version: snapshot.manifest.source.version })}</Typography.Text>
          <Typography.Text>{t(`${prefix}frozen`, { expires: new Date(snapshot.expires_at * 1000).toLocaleString(i18n.language) })}</Typography.Text>
          <Typography.Text>{t(`${prefix}purpose`)}: {t(`${prefix}purpose.${snapshot.manifest.purpose}`)}</Typography.Text>
          {snapshot.replayed && <Typography.Text type="secondary">{t(`${prefix}reused`)}</Typography.Text>}
          <pre style={preStyle}>{snapshot.payload.text}</pre>
          {renderFiles(snapshot.payload.attachments)}
          <Space wrap>
            <Button disabled={busy} onClick={() => download('md')}>{t(`${prefix}downloadText`)}</Button>
            <Button disabled={busy} onClick={() => download('json')}>{t(`${prefix}downloadManifest`)}</Button>
            <Button disabled={busy} onClick={load}>{t(`${prefix}newSelection`)}</Button>
          </Space>
          <label>{t(`${prefix}authorization`)} <Select aria-label={t(`${prefix}authorization`)} value={authorization} disabled={busy} style={{ minWidth: 200 }}
            onChange={value => { setAuthorization(value); grant.current = null }} options={['valid', 'expired', 'revoked'].map(value => ({ value, label: t(`${prefix}auth.${value}`) }))} /></label>
          <label>{t(`${prefix}receiver`)} <Select aria-label={t(`${prefix}receiver`)} value={simulation} disabled={busy} style={{ minWidth: 200 }}
            onChange={setSimulation} options={['success', 'reject', 'lose_response'].map(value => ({ value, label: t(`${prefix}simulation.${value}`) }))} /></label>
          <Space wrap>
            <Button disabled={busy} onClick={deliver}>{t(`${prefix}deliver`)}</Button>
            <Button disabled={busy} onClick={() => run(async () => setStatus(await get(`/snapshots/${snapshot.id}/status`)))}>{t(`${prefix}query`)}</Button>
          </Space>
        </>}
      </Space>
    </Modal>
  </>
}

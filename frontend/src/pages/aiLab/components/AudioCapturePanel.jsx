/**
 * 声音采集面板：麦克风录 1 秒短音（带电平表与倒计时）或上传 WAV/WebM 文件，带采集条件，
 * 一次提交到指定类别与集合。录音在浏览器里重采样成 44.1kHz WAV，点"上传"才发到服务器。
 */
import React, { useEffect, useRef, useState } from 'react'
import { Button, Select, Input, Space, Upload, Tag, Alert, message, Tooltip } from 'antd'
import { AudioOutlined, UploadOutlined, DeleteOutlined, CloudUploadOutlined, StopOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { createRecorder } from '../engine/audio/recorder'
import { decodeAudio, toClipBuffer, spectrogramFromClip, spectrogramToDataUrl } from '../engine/audio/spectrogram'
import { encodeWav } from '../engine/audio/wav'
import AudioThumb from './AudioThumb'

const CONDITION_FIELDS = ['speaker', 'place', 'noise', 'device']
const MAX_PENDING = 30

const AudioCapturePanel = ({ dataset, classes, split = 'train', shiftSetOptions = [], onUpload }) => {
  const { t } = useTranslation()
  const recorderRef = useRef(null)
  const [micOn, setMicOn] = useState(false)
  const [micError, setMicError] = useState(null)
  const [level, setLevel] = useState(0)
  const [recording, setRecording] = useState(false)
  const [classKey, setClassKey] = useState(classes[0]?.key)
  const [shiftSet, setShiftSet] = useState(shiftSetOptions[0]?.value || '')
  const [conditions, setConditions] = useState({})
  const [pending, setPending] = useState([]) // {blob, url, thumb, durationMs}
  const [uploading, setUploading] = useState(false)

  useEffect(() => { if (!classes.find((c) => c.key === classKey)) setClassKey(classes[0]?.key) }, [classes, classKey])
  useEffect(() => () => { if (recorderRef.current) recorderRef.current.close(); pending.forEach((p) => URL.revokeObjectURL(p.url)) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const addClip = async (blob, clip, durationMs) => {
    const thumb = spectrogramToDataUrl(await spectrogramFromClip(clip))
    setPending((prev) => (prev.length >= MAX_PENDING ? prev : [...prev, { blob, url: URL.createObjectURL(blob), thumb, durationMs }]))
  }

  const startMic = async () => {
    setMicError(null)
    try {
      recorderRef.current = await createRecorder({ onLevel: (v) => setLevel(Math.min(1, v * 6)) })
      setMicOn(true)
    } catch (err) {
      console.error('mic error:', err)
      setMicError(err?.name || 'error')
    }
  }
  const stopMic = () => { if (recorderRef.current) recorderRef.current.close(); recorderRef.current = null; setMicOn(false); setLevel(0) }
  const recordOnce = async () => {
    if (!recorderRef.current || recording) return
    setRecording(true)
    try {
      const { blob, clip, durationMs } = await recorderRef.current.record(1.05)
      await addClip(blob, clip, durationMs)
    } catch (err) {
      message.error(t('aiLab.audio.recordFailed'))
    } finally {
      setRecording(false)
    }
  }

  const beforeUpload = async (file) => {
    if (!/^audio\//.test(file.type) && !/\.(wav|webm|ogg|mp3|m4a)$/i.test(file.name)) { message.warning(t('aiLab.audio.audioOnly')); return Upload.LIST_IGNORE }
    try {
      const decoded = await decodeAudio(file)
      const clip = await toClipBuffer(decoded)
      await addClip(encodeWav(clip), clip, Math.round((clip.length / clip.sampleRate) * 1000))
    } catch (err) {
      message.error(t('aiLab.audio.decodeFailed'))
    }
    return Upload.LIST_IGNORE
  }

  const submit = async () => {
    if (!pending.length || !classKey) return
    if (split === 'shift' && !shiftSet) { message.warning(t('aiLab.capture.shiftSetRequired')); return }
    setUploading(true)
    try {
      const tags = {}
      CONDITION_FIELDS.forEach((f) => { if (conditions[f]) tags[f] = conditions[f] })
      const blobs = pending.map((p) => { const b = p.blob; b.name = `clip-${Date.now()}.wav`; return b })
      await onUpload(blobs, { class_key: classKey, split, shift_set: split === 'shift' ? shiftSet : undefined, condition_tags: tags, source: 'microphone', duration_ms: pending[0]?.durationMs })
      message.success(t('aiLab.audio.uploaded', { count: pending.length }))
      pending.forEach((p) => URL.revokeObjectURL(p.url))
      setPending([])
    } catch (err) {
      message.error(t('aiLab.capture.uploadFailed'))
    } finally {
      setUploading(false)
    }
  }

  const targetLabel = split === 'shift' ? `${t('aiLab.split.shift')}${shiftSet ? `·${shiftSet}` : ''}` : (classes.find((c) => c.key === classKey)?.label || '')

  return (
    <div className="ailab-capture ailab-audio-capture">
      <div>
        <div className="ailab-mic-wrap">
          <div className="ailab-level"><div className="ailab-level-fill" style={{ width: `${Math.round(level * 100)}%` }} /></div>
          {!micOn ? (
            <Space direction="vertical" align="center" style={{ width: '100%', padding: 12 }}>
              <Button type="primary" icon={<AudioOutlined />} onClick={startMic}>{t('aiLab.audio.startMic')}</Button>
              {micError && <Alert type="warning" showIcon message={t('aiLab.audio.micUnavailable')} />}
              <Upload accept="audio/*,.wav,.webm,.ogg,.mp3,.m4a" multiple showUploadList={false} beforeUpload={beforeUpload}>
                <Button icon={<UploadOutlined />}>{t('aiLab.audio.fromFiles')}</Button>
              </Upload>
            </Space>
          ) : (
            <Space wrap style={{ padding: 8 }}>
              <Button type="primary" danger={recording} icon={<AudioOutlined />} onClick={recordOnce} loading={recording}>{recording ? t('aiLab.audio.recording') : t('aiLab.audio.recordOne')}</Button>
              <Button icon={<StopOutlined />} onClick={stopMic}>{t('aiLab.audio.stopMic')}</Button>
              <Upload accept="audio/*,.wav,.webm,.ogg,.mp3,.m4a" multiple showUploadList={false} beforeUpload={beforeUpload}>
                <Button icon={<UploadOutlined />}>{t('aiLab.audio.fromFiles')}</Button>
              </Upload>
            </Space>
          )}
        </div>
        <div className="ailab-muted">{t('aiLab.audio.tip')}</div>
      </div>
      <div>
        <div className="ailab-field">
          <label>{t('aiLab.capture.targetClass')}</label>
          <Select value={classKey} onChange={setClassKey} style={{ width: '100%' }} options={classes.map((c) => ({ value: c.key, label: c.label }))} />
        </div>
        {split === 'shift' && (
          <div className="ailab-field">
            <label>{t('aiLab.capture.shiftSet')}</label>
            <Select mode="tags" maxCount={1} value={shiftSet ? [shiftSet] : []} onChange={(v) => setShiftSet(v[v.length - 1] || '')} options={shiftSetOptions} placeholder={t('aiLab.capture.shiftSetPlaceholder')} style={{ width: '100%' }} />
          </div>
        )}
        <div className="ailab-field">
          <label>{t('aiLab.capture.conditions')} <Tooltip title={t('aiLab.audio.conditionsTip')}><span className="ailab-help">?</span></Tooltip></label>
          <div className="ailab-conditions">
            {CONDITION_FIELDS.map((f) => <Input key={f} size="small" placeholder={t(`aiLab.audioCondition.${f}`)} value={conditions[f] || ''} maxLength={30} onChange={(e) => setConditions((c) => ({ ...c, [f]: e.target.value }))} />)}
          </div>
        </div>
        <div className="ailab-pending">
          <div className="ailab-pending-head">
            <span>{t('aiLab.audio.pending', { count: pending.length })}</span>
            {pending.length > 0 && <Button size="small" type="text" icon={<DeleteOutlined />} onClick={() => { pending.forEach((p) => URL.revokeObjectURL(p.url)); setPending([]) }}>{t('aiLab.capture.clearPending')}</Button>}
          </div>
          <div className="ailab-pending-grid">
            {pending.map((p, i) => (
              <div className="ailab-thumb" key={p.url}>
                <AudioThumb sample={{ id: `pending-${i}`, file_url: p.url, thumb_url: p.thumb }} />
                <button type="button" className="ailab-thumb-del" aria-label="remove" onClick={() => setPending((prev) => prev.filter((_, j) => j !== i))}><DeleteOutlined /></button>
              </div>
            ))}
          </div>
        </div>
        <Button type="primary" icon={<CloudUploadOutlined />} onClick={submit} loading={uploading} disabled={!pending.length || !classKey}>
          {t('aiLab.audio.uploadTo', { count: pending.length, target: targetLabel })}
        </Button>
        {dataset?.locked_at && split === 'train' && <div className="ailab-muted" style={{ marginTop: 6 }}>{t('aiLab.capture.afterLockHint')}</div>}
        <Tag style={{ marginTop: 8 }}>{t('aiLab.audio.format')}</Tag>
      </div>
    </div>
  )
}

export default AudioCapturePanel

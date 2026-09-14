/**
 * 样本采集面板：摄像头连拍 / 本地上传，带采集条件标签，一次提交到指定类别与集合
 *
 * split='train' 采集训练样本；split='shift' 采集换条件测试样本（需指定条件名）。
 * 图片只在浏览器内裁成正方形 JPEG，点击"上传"才发到服务器。
 */
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Button, Select, Input, Space, Upload, Tag, Alert, InputNumber, message, Tooltip } from 'antd'
import { CameraOutlined, UploadOutlined, DeleteOutlined, CloudUploadOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { captureFrame, canvasToBlob } from '../engine/imageUtils'

const BURST_INTERVAL_MS = 250
const MAX_PENDING = 40

const CONDITION_FIELDS = ['background', 'angle', 'light', 'device', 'collector']

const CapturePanel = ({ dataset, classes, split = 'train', shiftSetOptions = [], onUpload, disabled }) => {
  const { t } = useTranslation()
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState(null)
  const [classKey, setClassKey] = useState(classes[0]?.key)
  const [shiftSet, setShiftSet] = useState(shiftSetOptions[0]?.value || '')
  const [conditions, setConditions] = useState({})
  const [burst, setBurst] = useState(10)
  const [pending, setPending] = useState([]) // {blob, url}
  const [uploading, setUploading] = useState(false)
  const [capturing, setCapturing] = useState(false)

  useEffect(() => {
    if (!classes.find((c) => c.key === classKey)) setClassKey(classes[0]?.key)
  }, [classes, classKey])

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop())
      streamRef.current = null
    }
    setCameraOn(false)
  }, [])

  useEffect(() => () => {
    stopCamera()
    pending.forEach((p) => URL.revokeObjectURL(p.url))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startCamera = async () => {
    setCameraError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCameraOn(true)
    } catch (err) {
      console.error('camera error:', err)
      setCameraError(err?.name || 'error')
    }
  }

  const addBlob = (blob) => {
    setPending((prev) => {
      if (prev.length >= MAX_PENDING) return prev
      return [...prev, { blob, url: URL.createObjectURL(blob) }]
    })
  }

  const captureOnce = async () => {
    if (!videoRef.current) return
    const canvas = captureFrame(videoRef.current)
    addBlob(await canvasToBlob(canvas))
  }

  const captureBurst = async () => {
    if (!videoRef.current) return
    setCapturing(true)
    try {
      for (let i = 0; i < burst; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await captureOnce()
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, BURST_INTERVAL_MS))
      }
    } finally {
      setCapturing(false)
    }
  }

  const removePending = (idx) => {
    setPending((prev) => {
      URL.revokeObjectURL(prev[idx].url)
      return prev.filter((_, i) => i !== idx)
    })
  }

  const handleUpload = async () => {
    if (!pending.length || !classKey) return
    if (split === 'shift' && !shiftSet) {
      message.warning(t('aiLab.capture.shiftSetRequired'))
      return
    }
    setUploading(true)
    try {
      const tags = {}
      CONDITION_FIELDS.forEach((f) => { if (conditions[f]) tags[f] = conditions[f] })
      await onUpload(pending.map((p) => p.blob), {
        class_key: classKey,
        split,
        shift_set: split === 'shift' ? shiftSet : undefined,
        condition_tags: tags,
        source: cameraOn ? 'camera' : 'upload'
      })
      pending.forEach((p) => URL.revokeObjectURL(p.url))
      setPending([])
      message.success(t('aiLab.capture.uploaded', { count: pending.length }))
    } catch (err) {
      console.error('upload failed:', err)
      message.error(t('aiLab.capture.uploadFailed'))
    } finally {
      setUploading(false)
    }
  }

  const beforeUpload = (file) => {
    if (!file.type.startsWith('image/')) {
      message.warning(t('aiLab.capture.imageOnly'))
      return Upload.LIST_IGNORE
    }
    addBlob(file)
    return false
  }

  return (
    <div className="ailab-capture">
      <div className="ailab-capture-left">
        <div className="ailab-video-wrap">
          <video ref={videoRef} muted playsInline className="ailab-video" />
          {!cameraOn && (
            <div className="ailab-video-placeholder">
              <Button icon={<CameraOutlined />} onClick={startCamera} disabled={disabled}>
                {t('aiLab.capture.startCamera')}
              </Button>
              {cameraError && <Alert type="warning" showIcon style={{ marginTop: 8 }} message={t('aiLab.capture.cameraUnavailable')} />}
            </div>
          )}
        </div>
        <Space wrap style={{ marginTop: 8 }}>
          <Button type="primary" icon={<CameraOutlined />} onClick={captureBurst} disabled={!cameraOn || capturing || disabled} loading={capturing}>
            {t('aiLab.capture.burst', { count: burst })}
          </Button>
          <InputNumber min={1} max={30} value={burst} onChange={(v) => setBurst(v || 1)} size="small" style={{ width: 70 }} />
          <Button onClick={captureOnce} disabled={!cameraOn || disabled}>{t('aiLab.capture.single')}</Button>
          {cameraOn && <Button onClick={stopCamera}>{t('aiLab.capture.stopCamera')}</Button>}
          <Upload multiple accept="image/*" showUploadList={false} beforeUpload={beforeUpload} disabled={disabled}>
            <Button icon={<UploadOutlined />}>{t('aiLab.capture.fromFiles')}</Button>
          </Upload>
        </Space>
      </div>
      <div className="ailab-capture-right">
        <div className="ailab-field">
          <label>{t('aiLab.capture.targetClass')}</label>
          <Select value={classKey} onChange={setClassKey} style={{ width: '100%' }} options={classes.map((c) => ({ value: c.key, label: c.label }))} />
        </div>
        {split === 'shift' && (
          <div className="ailab-field">
            <label>{t('aiLab.capture.shiftSet')}</label>
            <Select
              mode="tags"
              maxCount={1}
              value={shiftSet ? [shiftSet] : []}
              onChange={(v) => setShiftSet((v[v.length - 1] || '').trim().slice(0, 50))}
              options={shiftSetOptions}
              placeholder={t('aiLab.capture.shiftSetPlaceholder')}
              style={{ width: '100%' }}
            />
          </div>
        )}
        <div className="ailab-field">
          <label>
            {t('aiLab.capture.conditions')}
            <Tooltip title={t('aiLab.capture.conditionsTip')}><span className="ailab-help">?</span></Tooltip>
          </label>
          <div className="ailab-conditions">
            {CONDITION_FIELDS.map((f) => (
              <Input
                key={f}
                size="small"
                addonBefore={t(`aiLab.condition.${f}`)}
                value={conditions[f] || ''}
                maxLength={50}
                onChange={(e) => setConditions((prev) => ({ ...prev, [f]: e.target.value }))}
              />
            ))}
          </div>
        </div>
        <div className="ailab-pending">
          <div className="ailab-pending-head">
            <span>{t('aiLab.capture.pending', { count: pending.length })}</span>
            {pending.length > 0 && <Button size="small" type="link" onClick={() => { pending.forEach((p) => URL.revokeObjectURL(p.url)); setPending([]) }}>{t('aiLab.capture.clearPending')}</Button>}
          </div>
          <div className="ailab-pending-grid">
            {pending.map((p, idx) => (
              <div className="ailab-thumb" key={p.url}>
                <img src={p.url} alt="" />
                <button type="button" className="ailab-thumb-del" onClick={() => removePending(idx)} aria-label="remove"><DeleteOutlined /></button>
              </div>
            ))}
          </div>
        </div>
        <Button type="primary" block icon={<CloudUploadOutlined />} onClick={handleUpload} loading={uploading} disabled={!pending.length || disabled}>
          {t('aiLab.capture.uploadTo', { count: pending.length, target: split === 'shift' ? t('aiLab.split.shift') : t('aiLab.split.train') })}
        </Button>
        {dataset?.locked_at && split === 'train' && (
          <Tag color="blue" style={{ marginTop: 8 }}>{t('aiLab.capture.afterLockHint')}</Tag>
        )}
      </div>
    </div>
  )
}

export default CapturePanel

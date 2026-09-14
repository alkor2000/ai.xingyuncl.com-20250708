/**
 * 错误样本画廊：列出测错的样本，点开可以计算"模型在看哪"的遮挡热图
 */
import React, { useState } from 'react'
import { Button, Modal, Space, Tag, Typography, Empty, Progress } from 'antd'
import { useTranslation } from 'react-i18next'
import HeatmapOverlay from './HeatmapOverlay'
import { occlusionMap } from '../engine/occlusion'
import { loadImageElement } from '../engine/imageUtils'
import { formatPercent } from '../engine/metrics'
import { imageModality } from '../engine/modalities'
import AudioThumb from './AudioThumb'

const { Text } = Typography

const ErrorGallery = ({ predictions, liveModel, labelOf, onView, modality = imageModality }) => {
  const { t } = useTranslation()
  const [active, setActive] = useState(null)
  const [heatmap, setHeatmap] = useState(null)
  const [computing, setComputing] = useState(false)
  const [progress, setProgress] = useState(0)
  const errors = (predictions || []).filter((p) => p.actual !== p.predicted)

  const open = (p) => {
    setActive(p)
    setHeatmap(null)
    if (onView) onView(p, false)
  }

  const computeHeatmap = async () => {
    if (!active || !liveModel) return
    setComputing(true)
    setProgress(0)
    try {
      const img = await loadImageElement(active.file_url)
      const map = await occlusionMap(liveModel, img, active.predicted, { onProgress: (d, tot) => setProgress(Math.round((d / tot) * 100)) })
      setHeatmap(map)
      if (onView) onView(active, true)
    } finally {
      setComputing(false)
    }
  }

  if (!errors.length) return <Empty description={t('aiLab.errors.none')} image={Empty.PRESENTED_IMAGE_SIMPLE} />

  return (
    <div className="ailab-errors">
      <div className="ailab-errors-head">{t('aiLab.errors.count', { count: errors.length })}</div>
      <div className="ailab-sample-grid">
        {errors.map((p) => (
          <div className="ailab-thumb ailab-thumb-error" key={p.id} onClick={() => open(p)} role="presentation">
            {modality.id === 'audio' ? <AudioThumb sample={p} /> : <img src={p.file_url} alt="" loading="lazy" />}
            <div className="ailab-thumb-caption">{labelOf(p.actual)} → {labelOf(p.predicted)}</div>
          </div>
        ))}
      </div>
      <Modal open={!!active} onCancel={() => setActive(null)} footer={null} width={560} title={t('aiLab.errors.detailTitle')}>
        {active && (
          <div className="ailab-error-detail">
            {modality.supportsHeatmap ? <HeatmapOverlay src={active.file_url} heatmap={heatmap} size={280} /> : <AudioThumb sample={active} size={280} withPlayer />}
            <div className="ailab-error-meta">
              <p><Text type="secondary">{t('aiLab.errors.actual')}</Text> <Tag color="green">{labelOf(active.actual)}</Tag></p>
              <p><Text type="secondary">{t('aiLab.errors.predicted')}</Text> <Tag color="red">{labelOf(active.predicted)}</Tag> <Text type="secondary">{formatPercent(active.confidence)}</Text></p>
              {modality.supportsHeatmap && (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Button type="primary" onClick={computeHeatmap} loading={computing} disabled={!liveModel}>{t('aiLab.errors.showHeatmap')}</Button>
                  {computing && <Progress percent={progress} size="small" />}
                  {heatmap && <Text type="secondary">{t('aiLab.errors.heatmapHint')}</Text>}
                </Space>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

export default ErrorGallery

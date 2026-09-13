/**
 * "给 AI 喂错数据"实验面板（L3）
 * mode='mislabel'：把一部分训练样本的标签故意改错（服务器记住原值），再训练一版对照；
 * mode='restore'：恢复正确标签。被改过的样本可以"揭晓"给学生看。
 */
import React, { useState } from 'react'
import { Button, Alert, Space, Tag, Collapse, Typography, message, Popconfirm } from 'antd'
import { BugOutlined, UndoOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useAiLabStore from '../../../stores/aiLabStore'

const { Text } = Typography

const MislabelPanel = ({ mode, dataset, samples, models, canEdit, ratio = 0.2, labelOf }) => {
  const { t } = useTranslation()
  const { mislabelDataset, restoreLabels, recordEvent } = useAiLabStore()
  const [busy, setBusy] = useState(false)
  const mislabeled = (samples || []).filter((s) => s.original_class_key && s.split === 'train')
  const hasCleanModel = models.some((m) => typeof m.metrics?.holdout?.accuracy === 'number')

  const doMislabel = async () => {
    setBusy(true)
    try {
      const result = await mislabelDataset(dataset.id, ratio)
      recordEvent('dataset.mislabel', { dataset_id: dataset.id, ratio, changed: result?.changed ?? 0, sample_ids: result?.sample_ids || [] })
      message.success(t('aiLab.mislabel.done', { count: result?.changed ?? 0 }))
    } catch (err) {
      message.error(t('aiLab.mislabel.failed'))
    } finally {
      setBusy(false)
    }
  }
  const doRestore = async () => {
    setBusy(true)
    try {
      const result = await restoreLabels(dataset.id)
      recordEvent('dataset.restore', { dataset_id: dataset.id, restored: result?.restored ?? 0 })
      message.success(t('aiLab.mislabel.restoreDone', { count: result?.restored ?? 0 }))
    } catch (err) {
      message.error(t('aiLab.mislabel.restoreFailed'))
    } finally {
      setBusy(false)
    }
  }

  const reveal = mislabeled.length > 0 && (
    <Collapse
      size="small"
      style={{ marginTop: 12 }}
      items={[{
        key: 'reveal',
        label: t('aiLab.mislabel.reveal', { count: mislabeled.length }),
        children: (
          <div className="ailab-sample-grid">
            {mislabeled.map((s) => (
              <div className="ailab-thumb ailab-thumb-mislabeled" key={s.id}>
                <img src={s.file_url} alt="" loading="lazy" />
                <div className="ailab-thumb-caption">{labelOf(s.original_class_key)} → {labelOf(s.class_key)}</div>
              </div>
            ))}
          </div>
        )
      }]}
    />
  )

  if (mode === 'restore') {
    return (
      <div>
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('aiLab.mislabel.restoreIntro')} />
        <Space wrap>
          {mislabeled.length ? <Tag color="red">{t('aiLab.mislabel.status', { count: mislabeled.length })}</Tag> : <Tag color="green">{t('aiLab.mislabel.clean')}</Tag>}
          {canEdit && (
            <Button icon={<UndoOutlined />} onClick={doRestore} loading={busy} disabled={!mislabeled.length}>{t('aiLab.mislabel.restoreButton')}</Button>
          )}
        </Space>
        {reveal}
      </div>
    )
  }

  return (
    <div>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('aiLab.mislabel.intro', { pct: Math.round(ratio * 100) })} />
      {!hasCleanModel && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={t('aiLab.mislabel.needModel')} />}
      <Space wrap>
        {mislabeled.length ? <Tag color="red">{t('aiLab.mislabel.status', { count: mislabeled.length })}</Tag> : <Tag color="green">{t('aiLab.mislabel.clean')}</Tag>}
        {canEdit && (
          <Popconfirm title={t('aiLab.mislabel.confirm')} onConfirm={doMislabel} okText={t('common.confirm')} cancelText={t('common.cancel')} disabled={!!mislabeled.length || !hasCleanModel}>
            <Button danger icon={<BugOutlined />} loading={busy} disabled={!!mislabeled.length || !hasCleanModel || !dataset?.locked_at}>
              {t('aiLab.mislabel.button', { pct: Math.round(ratio * 100) })}
            </Button>
          </Popconfirm>
        )}
      </Space>
      {mislabeled.length > 0 && <div className="ailab-gap-line" style={{ marginTop: 12 }}>{t('aiLab.mislabel.next')}</div>}
      {reveal}
      {mislabeled.length > 0 && <Text type="secondary" className="ailab-muted">{t('aiLab.mislabel.compareHint')}</Text>}
    </div>
  )
}

export default MislabelPanel

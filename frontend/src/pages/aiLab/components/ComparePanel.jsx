/**
 * 版本对照：每个模型版本在留出集与各换条件集上的准确率、泛化差距与改动说明
 */
import React, { useEffect, useMemo } from 'react'
import { Table, Tag, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import useAiLabStore from '../../../stores/aiLabStore'
import { formatPercent } from '../engine/metrics'

const { Text } = Typography

const ComparePanel = ({ models }) => {
  const { t } = useTranslation()
  const { recordEvent } = useAiLabStore()
  const shiftSets = useMemo(() => {
    const set = new Set()
    models.forEach((m) => Object.keys(m.metrics?.shift || {}).forEach((k) => set.add(k)))
    return Array.from(set)
  }, [models])

  useEffect(() => {
    if (models.length >= 2) recordEvent('model.compare', { versions: models.map((m) => m.version) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models.length])

  const columns = [
    { title: t('aiLab.compare.version'), dataIndex: 'version', render: (v) => t('aiLab.version', { version: v }) },
    { title: t('aiLab.compare.datasetVersion'), dataIndex: 'dataset_version' },
    { title: t('aiLab.compare.trainCount'), dataIndex: 'train_sample_count' },
    { title: t('aiLab.split.holdout'), render: (_, m) => formatPercent(m.metrics?.holdout?.accuracy) },
    ...shiftSets.map((s) => ({ title: `${t('aiLab.split.shift')} · ${s}`, render: (_, m) => formatPercent(m.metrics?.shift?.[s]?.accuracy) })),
    {
      title: t('aiLab.compare.gap'),
      render: (_, m) => {
        const g = m.metrics?.generalization_gap
        if (typeof g !== 'number') return '—'
        return <Tag color={g > 0.15 ? 'red' : g > 0.05 ? 'orange' : 'green'}>{formatPercent(g)}</Tag>
      }
    },
    { title: t('aiLab.compare.note'), dataIndex: 'note', render: (v) => v || <Text type="secondary">—</Text> }
  ]
  return (
    <Table
      size="small"
      rowKey="id"
      pagination={false}
      dataSource={models}
      columns={columns}
      scroll={{ x: true }}
      locale={{ emptyText: t('aiLab.compare.empty') }}
    />
  )
}

export default ComparePanel

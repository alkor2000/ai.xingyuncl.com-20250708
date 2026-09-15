/**
 * 版本对照：每个模型版本在留出集与各换条件集上的准确率、泛化差距与改动说明
 */
import React, { useEffect, useMemo } from 'react'
import { Table, Tag, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import useAiLabStore from '../../../stores/aiLabStore'
import { formatPercent, wilsonInterval } from '../engine/metrics'

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
    { title: t('aiLab.compare.engine'), dataIndex: 'engine', render: (v) => (v ? t(`aiLab.engine.${v}`) : '—') },
    { title: t('aiLab.compare.datasetVersion'), dataIndex: 'dataset_version' },
    { title: t('aiLab.compare.trainCount'), dataIndex: 'train_sample_count' },
    ...(models.some((m) => m.params?.per_class_limit) ? [{ title: t('aiLab.compare.perClass'), render: (_, m) => m.params?.per_class_limit || t('aiLab.preset.perClassAll') }] : []),
    ...(models.some((m) => typeof m.params?.mislabeled_count === 'number') ? [{ title: t('aiLab.compare.mislabeled'), render: (_, m) => (typeof m.params?.mislabeled_count === 'number' ? m.params.mislabeled_count : '—') }] : []),
    ...(models.some((m) => m.engine === 'table-tree') ? [{ title: t('aiLab.compare.depth'), render: (_, m) => (m.engine === 'table-tree' ? m.params?.depth ?? m.params?.max_depth : '—') }] : []),
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
  /* 留出集只有几十张时，两版分数差在 ±(区间半宽) 之内不能说谁更好；按最近一版的留出集大小算 */
  const latestHoldout = [...models].reverse().find((m) => typeof m.metrics?.holdout?.accuracy === 'number' && m.metrics.holdout.sample_count)?.metrics.holdout
  const ci = latestHoldout ? wilsonInterval(Math.round(latestHoldout.accuracy * latestHoldout.sample_count), latestHoldout.sample_count) : null
  return (
    <div>
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={models}
        columns={columns}
        scroll={{ x: true }}
        locale={{ emptyText: t('aiLab.compare.empty') }}
      />
      {models.length >= 2 && new Set(models.map((m) => m.dataset_version)).size > 1 && (
        <Text type="warning" className="ailab-muted" style={{ display: 'block', marginTop: 8 }}>{t('aiLab.compare.datasetDiffers')}</Text>
      )}
      {models.length >= 2 && (
        <Text type="secondary" className="ailab-muted" style={{ display: 'block', marginTop: 8 }}>
          {ci ? t('aiLab.compare.noise', { n: latestHoldout.sample_count, half: formatPercent((ci.high - ci.low) / 2) }) : ''} {t('aiLab.compare.reuseNote')}
        </Text>
      )}
    </div>
  )
}

export default ComparePanel

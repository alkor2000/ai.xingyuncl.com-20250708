/**
 * 分组准确率（公平性）：按某个采集条件标签（如"采集者"）把测试样本分组，各组分别算准确率与样本数
 * 差距明显的组就是模型对谁"不公平"；查看即记一条 fairness.view 事实。
 */
import React, { useEffect, useMemo } from 'react'
import { Table, Tag, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import useAiLabStore from '../../../stores/aiLabStore'
import { formatPercent } from '../engine/metrics'

const { Text } = Typography

export const subgroupStats = (predictions, tagKey) => {
  const groups = {}
  predictions.forEach((p) => {
    const g = (p.condition_tags && p.condition_tags[tagKey]) || null
    const key = g || '__none__'
    groups[key] = groups[key] || { group: g, total: 0, correct: 0 }
    groups[key].total += 1
    if (p.actual === p.predicted) groups[key].correct += 1
  })
  return Object.values(groups).map((g) => ({ ...g, accuracy: g.total ? g.correct / g.total : null })).sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0))
}

const SubgroupTable = ({ predictions, tagKey, model, split }) => {
  const { t } = useTranslation()
  const { recordEvent } = useAiLabStore()
  const rows = useMemo(() => subgroupStats(predictions || [], tagKey), [predictions, tagKey])
  const tagged = rows.filter((r) => r.group)
  const spread = tagged.length >= 2 ? tagged[tagged.length - 1].accuracy - tagged[0].accuracy : null

  useEffect(() => {
    if (tagged.length >= 2) recordEvent('fairness.view', { model_id: model?.id, version: model?.version, split, tag: tagKey, groups: tagged.map((g) => ({ group: g.group, total: g.total, accuracy: g.accuracy })), spread })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [predictions, tagKey])

  if (!tagged.length) return <Text type="secondary" className="ailab-muted">{t('aiLab.fairness.noTag', { tag: t(`aiLab.condition.${tagKey}`, { defaultValue: tagKey }) })}</Text>
  return (
    <div className="ailab-fairness">
      <div className="ailab-metrics-title">{t('aiLab.fairness.title', { tag: t(`aiLab.condition.${tagKey}`, { defaultValue: tagKey }) })}</div>
      <Table
        size="small"
        rowKey={(r) => r.group || 'none'}
        pagination={false}
        dataSource={rows}
        columns={[
          { title: t('aiLab.fairness.group'), render: (_, r) => r.group || <Text type="secondary">{t('aiLab.fairness.untagged')}</Text> },
          { title: t('aiLab.fairness.count'), dataIndex: 'total' },
          { title: t('aiLab.fairness.accuracy'), render: (_, r) => <Tag color={r.accuracy >= 0.8 ? 'green' : r.accuracy >= 0.6 ? 'orange' : 'red'}>{formatPercent(r.accuracy)}</Tag> }
        ]}
      />
      {spread !== null && <div className="ailab-gap-line">{t('aiLab.fairness.spread', { value: formatPercent(spread), best: tagged[tagged.length - 1].group, worst: tagged[0].group })}</div>}
      {tagged.some((g) => g.total < 10) && <Text type="warning" className="ailab-muted">{t('aiLab.fairness.smallGroups', { min: 10 })}</Text>}
    </div>
  )
}

export default SubgroupTable

/**
 * 单个测试集的结果视图：准确率、逐类召回条、混淆矩阵
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import ConfusionMatrix from './ConfusionMatrix'
import { formatPercent } from '../engine/metrics'

const MetricsView = ({ metrics, labelOf, title }) => {
  const { t } = useTranslation()
  if (!metrics) return null
  const perClass = metrics.per_class || {}
  return (
    <div className="ailab-metrics">
      <div className="ailab-metrics-head">
        <div>
          <div className="ailab-metrics-title">{title}</div>
          <div className="ailab-metrics-sub">{t('aiLab.metrics.sampleCount', { count: metrics.sample_count ?? '' })}</div>
        </div>
        <div className="ailab-big-number">{formatPercent(metrics.accuracy)}</div>
      </div>
      <div className="ailab-recall-bars">
        {Object.entries(perClass).map(([key, v]) => (
          <div className="ailab-recall-row" key={key}>
            <span className="ailab-recall-label">{labelOf(key)}</span>
            <div className="ailab-recall-track"><div className="ailab-recall-fill" style={{ width: `${(v.recall || 0) * 100}%` }} /></div>
            <span className="ailab-recall-value">{formatPercent(v.recall)} <small>({v.support})</small></span>
          </div>
        ))}
      </div>
      <ConfusionMatrix confusion={metrics.confusion} labelOf={labelOf} />
    </div>
  )
}

export default MetricsView

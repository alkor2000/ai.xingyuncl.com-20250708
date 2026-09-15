/**
 * 单个测试集的结果视图（"成绩单"）：
 *  - 圆环里的准确率 + "N 张里对了 M 张" + 一句评语（孩子先看到这个）
 *  - 初高中再给 95% 置信区间：测试集只有几十张时分数会抖，比较版本前先看区间
 *  - 逐类召回条、混淆矩阵（谁被认成了谁）
 */
import React from 'react'
import { Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'
import ConfusionMatrix from './ConfusionMatrix'
import { formatPercent, wilsonInterval } from '../engine/metrics'
import { useAiLabUi } from '../uiContext'

const RADIUS = 34
const CIRC = 2 * Math.PI * RADIUS

export const moodOf = (acc) => {
  if (typeof acc !== 'number') return 'none'
  if (acc >= 0.9) return 'great'
  if (acc >= 0.7) return 'good'
  if (acc >= 0.5) return 'soso'
  return 'low'
}
const MOOD_COLOR = { great: '#2c7a5a', good: '#12b886', soso: '#f59f00', low: '#fa5252', none: '#adb5bd' }
const MOOD_FACE = { great: '🎉', good: '😊', soso: '🤔', low: '😅', none: '' }

const MetricsView = ({ metrics, labelOf, title, unit }) => {
  const { t } = useTranslation()
  const { kid } = useAiLabUi()
  if (!metrics) return null
  const perClass = metrics.per_class || {}
  const total = metrics.sample_count ?? 0
  const correct = Math.round((metrics.accuracy || 0) * total)
  const mood = moodOf(metrics.accuracy)
  const ci = wilsonInterval(correct, total)
  const unitKey = unit || 'image'
  return (
    <div className={`ailab-metrics ailab-mood-${mood}`}>
      <div className="ailab-scorecard">
        <div className="ailab-score-ring" role="img" aria-label={formatPercent(metrics.accuracy)}>
          <svg viewBox="0 0 84 84" width="96" height="96">
            <circle cx="42" cy="42" r={RADIUS} fill="none" stroke="#eef1f4" strokeWidth="9" />
            <circle cx="42" cy="42" r={RADIUS} fill="none" stroke={MOOD_COLOR[mood]} strokeWidth="9" strokeLinecap="round"
              strokeDasharray={`${CIRC * (metrics.accuracy || 0)} ${CIRC}`} transform="rotate(-90 42 42)" />
          </svg>
          <div className="ailab-big-number">{formatPercent(metrics.accuracy)}</div>
        </div>
        <div className="ailab-score-text">
          <div className="ailab-metrics-title">{title}</div>
          <div className="ailab-score-count">{t(`aiLab.score.count_${unitKey}`, { correct, total })}</div>
          <div className="ailab-score-mood">{MOOD_FACE[mood]} {t(`aiLab.score.mood_${mood}`)}</div>
          {!kid && ci && (
            <Tooltip title={t('aiLab.score.ciTip')}>
              <div className="ailab-score-ci">{t('aiLab.score.ci', { low: formatPercent(ci.low), high: formatPercent(ci.high), n: total })}</div>
            </Tooltip>
          )}
        </div>
      </div>
      <div className="ailab-recall-bars">
        {Object.entries(perClass).map(([key, v]) => (
          <div className="ailab-recall-row" key={key}>
            <span className="ailab-recall-label">{labelOf(key)}</span>
            <div className="ailab-recall-track"><div className="ailab-recall-fill" style={{ width: `${(v.recall || 0) * 100}%` }} /></div>
            <span className="ailab-recall-value">{formatPercent(v.recall)} <small>({Math.round((v.recall || 0) * v.support)}/{v.support})</small></span>
          </div>
        ))}
      </div>
      <div className="ailab-cm-title">{t('aiLab.score.confusionTitle')}</div>
      <ConfusionMatrix confusion={metrics.confusion} labelOf={labelOf} />
    </div>
  )
}

export default MetricsView

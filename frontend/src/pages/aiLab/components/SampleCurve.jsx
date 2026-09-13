/**
 * 样本量–准确率曲线（L4"多少张够用"）：每个版本一个点，横轴每类训练张数，纵轴留出集准确率
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { formatPercent } from '../engine/metrics'

const W = 460
const H = 220
const PAD = { l: 44, r: 20, t: 26, b: 34 }

const SampleCurve = ({ models, limits = [] }) => {
  const { t } = useTranslation()
  const points = models
    .filter((m) => typeof m.metrics?.holdout?.accuracy === 'number')
    .map((m) => ({ version: m.version, x: m.params?.per_class_limit || Math.round(m.train_sample_count / Math.max(1, (m.class_keys || []).length)), y: m.metrics.holdout.accuracy }))
    .sort((a, b) => a.x - b.x)
  if (points.length < 1) return <div className="ailab-muted">{t('aiLab.curve.empty')}</div>
  const xMax = Math.max(...points.map((p) => p.x), ...limits.map(Number).filter(Number.isFinite), 1)
  const xTicks = Array.from(new Set([...limits.map(Number).filter(Number.isFinite), ...points.map((p) => p.x)])).sort((a, b) => a - b)
  const sx = (v) => PAD.l + (v / xMax) * (W - PAD.l - PAD.r)
  const sy = (v) => H - PAD.b - v * (H - PAD.t - PAD.b)
  return (
    <div className="ailab-curve">
      <svg viewBox={`0 0 ${W} ${H}`} role="img">
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={sy(v)} y2={sy(v)} stroke="#eef1f3" />
            <text x={PAD.l - 6} y={sy(v) + 4} textAnchor="end" fontSize="11" fill="#666">{Math.round(v * 100)}%</text>
          </g>
        ))}
        {xTicks.map((v) => (
          <g key={`x${v}`}>
            <line x1={sx(v)} x2={sx(v)} y1={PAD.t} y2={H - PAD.b} stroke="#eef1f3" />
            <text x={sx(v)} y={H - PAD.b + 16} textAnchor="middle" fontSize="11" fill="#666">{v}</text>
          </g>
        ))}
        <polyline fill="none" stroke="#1e4c8a" strokeWidth="2" points={points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')} />
        {points.map((p) => (
          <g key={p.version}>
            <circle cx={sx(p.x)} cy={sy(p.y)} r={5} fill="#1e4c8a" />
            <text x={sx(p.x)} y={sy(p.y) - 9} textAnchor="middle" fontSize="11" fill="#333">v{p.version} {formatPercent(p.y)}</text>
          </g>
        ))}
        <text x={(W + PAD.l - PAD.r) / 2} y={H - 4} textAnchor="middle" fontSize="12" fill="#333">{t('aiLab.curve.xLabel')}</text>
      </svg>
      <div className="ailab-muted">{t('aiLab.curve.hint')}</div>
    </div>
  )
}

export default SampleCurve

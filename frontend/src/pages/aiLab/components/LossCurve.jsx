/**
 * 训练曲线：每轮损失（左轴）与训练准确率（右轴），纯 SVG
 */
import React from 'react'
import { useTranslation } from 'react-i18next'

const W = 480
const H = 200
const PAD = { l: 44, r: 44, t: 12, b: 30 }

const LossCurve = ({ history }) => {
  const { t } = useTranslation()
  if (!history?.length) return null
  const maxLoss = Math.max(...history.map((h) => h.loss), 0.01)
  const n = history[history.length - 1].epoch
  const sx = (e) => PAD.l + ((e - 1) / Math.max(1, n - 1)) * (W - PAD.l - PAD.r)
  const syL = (v) => H - PAD.b - (v / maxLoss) * (H - PAD.t - PAD.b)
  const syA = (v) => H - PAD.b - v * (H - PAD.t - PAD.b)
  return (
    <div className="ailab-curve" style={{ marginTop: 12 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img">
        {[0, 0.5, 1].map((f) => <line key={f} x1={PAD.l} x2={W - PAD.r} y1={syA(f)} y2={syA(f)} stroke="#eef1f3" />)}
        <polyline fill="none" stroke="#b0540e" strokeWidth="2" points={history.map((h) => `${sx(h.epoch)},${syL(h.loss)}`).join(' ')} />
        {history.some((h) => typeof h.acc === 'number') && <polyline fill="none" stroke="#2c7a5a" strokeWidth="2" strokeDasharray="4 3" points={history.filter((h) => typeof h.acc === 'number').map((h) => `${sx(h.epoch)},${syA(h.acc)}`).join(' ')} />}
        <text x={PAD.l - 6} y={syL(maxLoss) + 4} textAnchor="end" fontSize="11" fill="#b0540e">{maxLoss.toFixed(2)}</text>
        <text x={PAD.l - 6} y={syL(0) + 4} textAnchor="end" fontSize="11" fill="#b0540e">0</text>
        <text x={W - PAD.r + 6} y={syA(1) + 4} fontSize="11" fill="#2c7a5a">100%</text>
        <text x={W - PAD.r + 6} y={syA(0) + 4} fontSize="11" fill="#2c7a5a">0%</text>
        <text x={(W + PAD.l - PAD.r) / 2} y={H - 6} textAnchor="middle" fontSize="12" fill="#333">{t('aiLab.mlp.epochAxis', { n })}</text>
      </svg>
      <div className="ailab-legend"><span><i style={{ background: '#b0540e' }} />{t('aiLab.mlp.loss')}</span><span><i style={{ background: '#2c7a5a' }} />{t('aiLab.mlp.trainAcc')}</span></div>
    </div>
  )
}

export default LossCurve

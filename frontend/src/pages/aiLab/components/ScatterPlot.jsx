/**
 * 两列数值的散点图（纯 SVG）：按类别着色，让学生先"看见"类别之间的边界再写规则
 */
import React, { useMemo } from 'react'
import { columnRange } from '../engine/tabular/stats'

export const CLASS_COLORS = ['#1e4c8a', '#b0540e', '#2c7a5a', '#7b3fa0', '#b8860b', '#c0392b', '#008b8b', '#555']

const W = 520
const H = 340
const PAD = { l: 52, r: 16, t: 12, b: 40 }

function ticks(range, n = 5) {
  const span = range.max - range.min
  const raw = span / n
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw
  const out = []
  for (let v = Math.ceil(range.min / step) * step; v <= range.max + 1e-9; v += step) out.push(Number(v.toFixed(6)))
  return out
}

const ScatterPlot = ({ rows, xKey, yKey, classKeys, labelOf, columnLabel, thresholds = [] }) => {
  const xr = useMemo(() => columnRange(rows, xKey), [rows, xKey])
  const yr = useMemo(() => columnRange(rows, yKey), [rows, yKey])
  if (!xr || !yr) return null
  const sx = (v) => PAD.l + ((v - xr.min) / (xr.max - xr.min)) * (W - PAD.l - PAD.r)
  const sy = (v) => H - PAD.b - ((v - yr.min) / (yr.max - yr.min)) * (H - PAD.t - PAD.b)
  const color = (label) => CLASS_COLORS[Math.max(0, classKeys.indexOf(label)) % CLASS_COLORS.length]
  return (
    <div className="ailab-scatter">
      <svg viewBox={`0 0 ${W} ${H}`} role="img">
        <rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} fill="#fafbfc" stroke="#e5e8eb" />
        {ticks(xr).map((v) => (
          <g key={`x${v}`}>
            <line x1={sx(v)} x2={sx(v)} y1={PAD.t} y2={H - PAD.b} stroke="#eef1f3" />
            <text x={sx(v)} y={H - PAD.b + 16} textAnchor="middle" fontSize="11" fill="#666">{v}</text>
          </g>
        ))}
        {ticks(yr).map((v) => (
          <g key={`y${v}`}>
            <line x1={PAD.l} x2={W - PAD.r} y1={sy(v)} y2={sy(v)} stroke="#eef1f3" />
            <text x={PAD.l - 6} y={sy(v) + 4} textAnchor="end" fontSize="11" fill="#666">{v}</text>
          </g>
        ))}
        {thresholds.filter((th) => th.col === xKey && Number.isFinite(Number(th.value))).map((th, i) => (
          <line key={`tx${i}`} x1={sx(Number(th.value))} x2={sx(Number(th.value))} y1={PAD.t} y2={H - PAD.b} stroke="#b0540e" strokeDasharray="4 3" />
        ))}
        {thresholds.filter((th) => th.col === yKey && Number.isFinite(Number(th.value))).map((th, i) => (
          <line key={`ty${i}`} x1={PAD.l} x2={W - PAD.r} y1={sy(Number(th.value))} y2={sy(Number(th.value))} stroke="#b0540e" strokeDasharray="4 3" />
        ))}
        {rows.map((r) => {
          const x = Number(r.payload?.[xKey]); const y = Number(r.payload?.[yKey])
          if (!Number.isFinite(x) || !Number.isFinite(y)) return null
          return <circle key={r.id} cx={sx(x)} cy={sy(y)} r={4} fill={color(r.label)} fillOpacity={0.75} stroke="#fff" strokeWidth={0.8} />
        })}
        <text x={(W + PAD.l - PAD.r) / 2} y={H - 6} textAnchor="middle" fontSize="12" fill="#333">{columnLabel(xKey)}</text>
        <text x={14} y={(H + PAD.t - PAD.b) / 2} textAnchor="middle" fontSize="12" fill="#333" transform={`rotate(-90 14 ${(H + PAD.t - PAD.b) / 2})`}>{columnLabel(yKey)}</text>
      </svg>
      <div className="ailab-legend">
        {classKeys.map((k) => <span key={k}><i style={{ background: color(k) }} />{labelOf(k)}</span>)}
      </div>
    </div>
  )
}

export default ScatterPlot

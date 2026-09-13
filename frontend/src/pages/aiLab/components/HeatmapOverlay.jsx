/**
 * 遮挡热图叠加层：在样本图上叠加 grid×grid 半透明格子，越红表示遮住它后模型越"不认识"
 */
import React from 'react'

const HeatmapOverlay = ({ src, heatmap, size = 224 }) => {
  if (!heatmap) return <img src={src} alt="" style={{ width: size, height: size, objectFit: 'cover' }} />
  const { grid, normalized } = heatmap
  const cells = []
  for (let i = 0; i < grid * grid; i += 1) {
    cells.push(<div key={i} style={{ background: `rgba(220,60,40,${(normalized[i] * 0.75).toFixed(3)})` }} />)
  }
  return (
    <div className="ailab-heatmap" style={{ width: size, height: size }}>
      <img src={src} alt="" />
      <div className="ailab-heatmap-grid" style={{ gridTemplateColumns: `repeat(${grid}, 1fr)` }}>{cells}</div>
    </div>
  )
}

export default HeatmapOverlay

/**
 * 一步完成时的小庆祝：十几片彩纸从卡片上方落下，1.6 秒后自行消失。
 * 纯 CSS 动画（见 AiLab.less .ailab-confetti）；系统开了"减少动态效果"时只闪一下不飘。
 */
import React, { useEffect, useState } from 'react'

const COLORS = ['#f28c28', '#12b886', '#7c5cff', '#e64980', '#4c6ef5', '#f59f00']
const PIECES = Array.from({ length: 18 }, (_, i) => ({ id: i, left: 8 + (i * 84) / 18 + (i % 3) * 2, delay: (i % 6) * 60, color: COLORS[i % COLORS.length], rot: (i * 47) % 360 }))

const Celebration = () => {
  const [gone, setGone] = useState(false)
  useEffect(() => { const timer = setTimeout(() => setGone(true), 1800); return () => clearTimeout(timer) }, [])
  if (gone) return null
  return (
    <div className="ailab-confetti" aria-hidden="true">
      {PIECES.map((p) => (
        <i key={p.id} style={{ left: `${p.left}%`, animationDelay: `${p.delay}ms`, background: p.color, transform: `rotate(${p.rot}deg)` }} />
      ))}
    </div>
  )
}

export default Celebration

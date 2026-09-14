/**
 * 幻灯片背景图：在浏览器里用 <canvas> 程序生成（渐变底 + 抽象图案），
 * 无版权问题、不依赖任何素材；预览（CSS background-image）与 .pptx 导出
 * （slide.background.data）用的是同一张 JPEG，所以所见即所得。
 *
 * 封面图案由主题的 art 字段决定：
 *   blobs 柔和光斑 | rings 细线圆环 | diagonal 斜色带 | dots 点阵+大圆 | waves 波浪线 |
 *   mesh 低多边形 | grid 蓝图网格 | glow 极光光带 | chalk 粉笔手绘框 | frame 双线描边框 | none 只有渐变底
 * 内容页装饰由 contentArt 决定（都很淡，只在角落/边缘，不影响正文可读）：
 *   corner 角落光斑 | grid 网格 | frame 细框 | chalk 粉笔框 | waves 角落波浪 | none
 * 随机数用主题 key 做种子，同一主题每次生成完全一致。
 *
 * jsdom / 旧浏览器没有 canvas 2D 时返回 null，调用方退回纯色或渐变。
 */

import { getSlideTheme, isDarkHex } from './slideThemes'

/** 导出用尺寸（16:9，与 pptx 10in×5.625in 同比例，160dpi 级别足够清晰） */
export const ART_WIDTH = 1600
export const ART_HEIGHT = 900
/** 用 JPEG 而不是 PNG：渐变+光斑的 PNG 有 1.8MB，JPEG 0.86 只有约 150KB，肉眼无差 */
const ART_JPEG_QUALITY = 0.86

const cache = new Map()

/** mulberry32：与 ai-lab 的留出集划分同款的小型确定性 PRNG */
const mulberry32 = (seed) => () => {
  seed = (seed + 0x6D2B79F5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const seedFromKey = (key) => {
  let h = 2166136261
  for (const ch of String(key)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return h >>> 0
}

const rgba = (hex, alpha) => {
  const n = parseInt(hex.slice(0, 6), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

const getContext = (width, height) => {
  if (typeof document === 'undefined') return null
  // jsdom 的 getContext 只会打一条 "Not implemented" 日志然后返回 null，测试里直接跳过免得刷屏
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '')) return null
  try {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx || typeof ctx.createLinearGradient !== 'function') return null
    return { canvas, ctx }
  } catch {
    return null
  }
}

const toJpeg = (canvas) => {
  try {
    return canvas.toDataURL('image/jpeg', ART_JPEG_QUALITY)
  } catch {
    return null
  }
}

// ============================================================================
// 封面图案
// ============================================================================

const drawBlobs = (ctx, theme, rand, w, h) => {
  const colors = [theme.coverFg, theme.accent2, theme.accent, theme.coverFg]
  for (let i = 0; i < 7; i += 1) {
    const r = (0.18 + rand() * 0.32) * w
    const x = rand() * w
    const y = rand() * h
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    const c = colors[i % colors.length]
    g.addColorStop(0, rgba(c, 0.22 + rand() * 0.16))
    g.addColorStop(1, rgba(c, 0))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
}

const drawRings = (ctx, theme, rand, w, h) => {
  ctx.lineWidth = 2
  for (let i = 0; i < 9; i += 1) {
    const x = w * (0.55 + rand() * 0.55)
    const y = h * (rand() * 1.1 - 0.1)
    const r = (0.12 + rand() * 0.42) * h
    ctx.strokeStyle = rgba(i % 3 === 0 ? theme.accent : theme.coverFg, 0.10 + rand() * 0.12)
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.lineWidth = 6
  ctx.strokeStyle = rgba(theme.accent, 0.35)
  ctx.beginPath()
  ctx.arc(w * 0.82, h * 0.55, h * 0.36, Math.PI * 1.1, Math.PI * 1.9)
  ctx.stroke()
}

const drawDiagonal = (ctx, theme, rand, w, h) => {
  ctx.save()
  ctx.translate(w * 0.62, 0)
  ctx.rotate(-0.42)
  for (let i = 0; i < 6; i += 1) {
    const bw = 60 + rand() * 140
    const x = i * 180 + rand() * 60
    ctx.fillStyle = rgba(i % 2 === 0 ? theme.coverFg : theme.accent, 0.06 + rand() * 0.08)
    ctx.fillRect(x, -h, bw, h * 3)
  }
  ctx.restore()
}

const drawDots = (ctx, theme, rand, w, h) => {
  ctx.fillStyle = rgba(theme.coverFg, 0.14)
  for (let y = 60; y < h; y += 44) {
    for (let x = w * 0.55; x < w; x += 44) {
      ctx.beginPath()
      ctx.arc(x, y, 3, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  for (let i = 0; i < 3; i += 1) {
    const r = (0.12 + rand() * 0.2) * h
    ctx.fillStyle = rgba(i === 1 ? theme.accent2 : theme.coverFg, 0.10 + rand() * 0.08)
    ctx.beginPath()
    ctx.arc(w * (0.7 + rand() * 0.3), h * (0.2 + rand() * 0.7), r, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** 底部一组正弦波浪，越靠下越实 */
const drawWaves = (ctx, theme, rand, w, h, { yBase = 0.62, alphaScale = 1, colorA = theme.coverFg, colorB = theme.accent2 } = {}) => {
  for (let i = 0; i < 6; i += 1) {
    const baseY = h * (yBase + i * 0.07)
    const amp = 24 + rand() * 40
    const freq = 0.004 + rand() * 0.004
    const phase = rand() * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(0, h)
    for (let x = 0; x <= w; x += 10) {
      ctx.lineTo(x, baseY + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 2.3 + phase) * amp * 0.4)
    }
    ctx.lineTo(w, h)
    ctx.closePath()
    ctx.fillStyle = rgba(i % 2 === 0 ? colorA : colorB, (0.05 + i * 0.03) * alphaScale)
    ctx.fill()
  }
}

/** 低多边形：右侧一片随机三角面 */
const drawMesh = (ctx, theme, rand, w, h) => {
  const cols = 7
  const rows = 5
  const x0 = w * 0.42
  const cw = (w - x0) / (cols - 1)
  const rh = h / (rows - 1)
  const pts = []
  for (let r = 0; r < rows; r += 1) {
    pts.push([])
    for (let c = 0; c < cols; c += 1) {
      const jx = c === 0 || c === cols - 1 ? 0 : (rand() - 0.5) * cw * 0.8
      const jy = r === 0 || r === rows - 1 ? 0 : (rand() - 0.5) * rh * 0.8
      pts[r].push([x0 + c * cw + jx, r * rh + jy])
    }
  }
  const palette = [theme.coverFg, theme.accent, theme.accent2, theme.coverBg2]
  for (let r = 0; r < rows - 1; r += 1) {
    for (let c = 0; c < cols - 1; c += 1) {
      const quad = [pts[r][c], pts[r][c + 1], pts[r + 1][c + 1], pts[r + 1][c]]
      const tris = rand() > 0.5 ? [[quad[0], quad[1], quad[2]], [quad[0], quad[2], quad[3]]] : [[quad[0], quad[1], quad[3]], [quad[1], quad[2], quad[3]]]
      for (const tri of tris) {
        const fade = (c / (cols - 1))
        ctx.beginPath()
        ctx.moveTo(tri[0][0], tri[0][1])
        ctx.lineTo(tri[1][0], tri[1][1])
        ctx.lineTo(tri[2][0], tri[2][1])
        ctx.closePath()
        ctx.fillStyle = rgba(palette[Math.floor(rand() * palette.length)], 0.03 + fade * 0.16 * rand())
        ctx.fill()
        ctx.strokeStyle = rgba(theme.coverFg, 0.05 + fade * 0.08)
        ctx.lineWidth = 1
        ctx.stroke()
      }
    }
  }
}

/** 蓝图网格：细网格 + 十字准星圆 */
const drawGrid = (ctx, theme, rand, w, h, { alpha = 0.12, step = 50 } = {}) => {
  ctx.lineWidth = 1
  ctx.strokeStyle = rgba(theme.coverFg, alpha * 0.55)
  for (let x = 0; x <= w; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke() }
  for (let y = 0; y <= h; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
  ctx.strokeStyle = rgba(theme.coverFg, alpha)
  for (let x = 0; x <= w; x += step * 5) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke() }
  for (let y = 0; y <= h; y += step * 5) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
  // 右侧准星圆
  const cx = w * 0.78
  const cy = h * 0.5
  ctx.strokeStyle = rgba(theme.accent, 0.55)
  ctx.lineWidth = 2
  ;[h * 0.12, h * 0.26, h * 0.4].forEach(r => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke() })
  ctx.beginPath(); ctx.moveTo(cx - h * 0.46, cy); ctx.lineTo(cx + h * 0.46, cy); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx, cy - h * 0.46); ctx.lineTo(cx, cy + h * 0.46); ctx.stroke()
  ctx.setLineDash([6, 8])
  ctx.strokeStyle = rgba(theme.accent2, 0.5)
  ctx.beginPath(); ctx.arc(cx, cy, h * 0.33, 0, Math.PI * 2); ctx.stroke()
  ctx.setLineDash([])
}

/** 极光：几条斜向的柔和光带 + 星点 */
/** 极光：几道两端都虚化的斜向光带（拉长的径向渐变）+ 星点 */
const drawGlow = (ctx, theme, rand, w, h) => {
  const colors = [theme.accent, theme.accent2, theme.accent, theme.coverFg]
  for (let i = 0; i < 5; i += 1) {
    ctx.save()
    ctx.translate(w * (0.25 + i * 0.16), h * (0.3 + rand() * 0.35))
    ctx.rotate(-0.5 + rand() * 0.2)
    ctx.scale(w * (0.28 + rand() * 0.2), 60 + rand() * 90)
    const c = colors[i % colors.length]
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
    g.addColorStop(0, rgba(c, 0.34))
    g.addColorStop(0.45, rgba(c, 0.16))
    g.addColorStop(1, rgba(c, 0))
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }
  ctx.fillStyle = rgba(theme.coverFg, 0.6)
  for (let i = 0; i < 70; i += 1) {
    const r = rand() * 1.6 + 0.4
    ctx.beginPath(); ctx.arc(rand() * w, rand() * h * 0.7, r, 0, Math.PI * 2); ctx.fill()
  }
}

/** 粉笔：颗粒噪点 + 手绘双框 + 几个涂鸦 */
const drawChalk = (ctx, theme, rand, w, h, { doodles = true, inset = 46 } = {}) => {
  ctx.fillStyle = rgba(theme.coverFg, 0.05)
  for (let i = 0; i < 2600; i += 1) {
    ctx.fillRect(rand() * w, rand() * h, 1.5, 1.5)
  }
  const wobbly = (x1, y1, x2, y2) => {
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    const steps = 14
    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps
      ctx.lineTo(x1 + (x2 - x1) * t + (rand() - 0.5) * 3, y1 + (y2 - y1) * t + (rand() - 0.5) * 3)
    }
    ctx.stroke()
  }
  ctx.lineCap = 'round'
  ;[[inset, 0.85, 3], [inset + 14, 0.55, 1.5]].forEach(([d, alpha, lw]) => {
    ctx.strokeStyle = rgba(theme.coverFg, alpha)
    ctx.lineWidth = lw
    wobbly(d, d, w - d, d); wobbly(w - d, d, w - d, h - d); wobbly(w - d, h - d, d, h - d); wobbly(d, h - d, d, d)
  })
  if (doodles) {
    ctx.strokeStyle = rgba(theme.accent, 0.7)
    ctx.lineWidth = 3
    const star = (cx, cy, r) => {
      ctx.beginPath()
      for (let i = 0; i < 10; i += 1) {
        const rr = i % 2 === 0 ? r : r * 0.45
        const a = -Math.PI / 2 + i * Math.PI / 5
        const px = cx + Math.cos(a) * rr + (rand() - 0.5) * 2
        const py = cy + Math.sin(a) * rr + (rand() - 0.5) * 2
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
      }
      ctx.closePath(); ctx.stroke()
    }
    star(w * 0.86, h * 0.2, 34)
    star(w * 0.12, h * 0.78, 22)
    ctx.strokeStyle = rgba(theme.accent2, 0.7)
    ctx.beginPath(); ctx.arc(w * 0.9, h * 0.7, 40, 0.2, Math.PI * 1.9); ctx.stroke()
    ctx.beginPath(); ctx.arc(w * 0.18, h * 0.22, 26, 0.6, Math.PI * 2.2); ctx.stroke()
  }
}

/** 黑金：双线描边框 + 四角小饰角 */
const drawFrame = (ctx, theme, rand, w, h, { inset = 40, alpha = 0.75 } = {}) => {
  ctx.lineWidth = 2
  ctx.strokeStyle = rgba(theme.accent, alpha)
  ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2)
  ctx.lineWidth = 1
  ctx.strokeStyle = rgba(theme.accent, alpha * 0.6)
  ctx.strokeRect(inset + 12, inset + 12, w - (inset + 12) * 2, h - (inset + 12) * 2)
  const corner = 34
  ctx.lineWidth = 3
  ctx.strokeStyle = rgba(theme.accent, alpha)
  ;[[inset, inset, 1, 1], [w - inset, inset, -1, 1], [inset, h - inset, 1, -1], [w - inset, h - inset, -1, -1]].forEach(([x, y, dx, dy]) => {
    ctx.beginPath(); ctx.moveTo(x, y + dy * corner); ctx.lineTo(x, y); ctx.lineTo(x + dx * corner, y); ctx.stroke()
  })
}

const MOTIFS = {
  blobs: drawBlobs, rings: drawRings, diagonal: drawDiagonal, dots: drawDots, waves: drawWaves,
  mesh: drawMesh, grid: drawGrid, glow: drawGlow, chalk: drawChalk, frame: drawFrame
}

// ============================================================================
// 内容页装饰（淡）
// ============================================================================

const drawCornerGlow = (ctx, theme, rand, w, h) => {
  const dark = isDarkHex(theme.bg)
  const spots = [[w * 1.02, h * -0.05, w * 0.42, theme.accent], [w * -0.08, h * 1.05, w * 0.32, theme.accent2]]
  for (const [x, y, r, c] of spots) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, rgba(c, dark ? 0.22 : 0.16))
    g.addColorStop(1, rgba(c, 0))
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
  }
}

const CONTENT_MOTIFS = {
  corner: drawCornerGlow,
  grid: (ctx, theme, rand, w, h) => {
    ctx.lineWidth = 1
    ctx.strokeStyle = rgba(theme.text, 0.07)
    for (let x = 0; x <= w; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke() }
    for (let y = 0; y <= h; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
  },
  frame: (ctx, theme, rand, w, h) => drawFrame(ctx, theme, rand, w, h, { inset: 26, alpha: 0.45 }),
  chalk: (ctx, theme, rand, w, h) => drawChalk(ctx, theme, rand, w, h, { doodles: false, inset: 22 }),
  waves: (ctx, theme, rand, w, h) => drawWaves(ctx, theme, rand, w, h, { yBase: 0.88, alphaScale: 0.7, colorA: theme.accent, colorB: theme.accent2 })
}

// ============================================================================
// 对外
// ============================================================================

/**
 * 生成主题封面背景图
 * @returns {string|null} JPEG data URL；环境不支持 canvas 时为 null
 */
export const renderCoverArt = (themeKey, { width = ART_WIDTH, height = ART_HEIGHT } = {}) => {
  const theme = getSlideTheme(themeKey)
  const cacheKey = `${theme.key}:cover:${width}x${height}`
  if (cache.has(cacheKey)) return cache.get(cacheKey)

  const env = getContext(width, height)
  if (!env) return null
  const { canvas, ctx } = env

  const base = ctx.createLinearGradient(0, 0, width, height)
  base.addColorStop(0, `#${theme.coverBg}`)
  base.addColorStop(1, `#${theme.cover === 'solid' ? theme.coverBg : theme.coverBg2}`)
  ctx.fillStyle = base
  ctx.fillRect(0, 0, width, height)

  const motif = MOTIFS[theme.art]
  if (motif) {
    ctx.save()
    motif(ctx, theme, mulberry32(seedFromKey(theme.key)), width, height)
    ctx.restore()
  }

  const dataUrl = toJpeg(canvas)
  cache.set(cacheKey, dataUrl)
  return dataUrl
}

/**
 * 生成主题内容页背景图（很淡的装饰；contentArt=none 时返回 null）
 * @returns {string|null}
 */
export const renderContentArt = (themeKey, { width = ART_WIDTH, height = ART_HEIGHT } = {}) => {
  const theme = getSlideTheme(themeKey)
  const motif = CONTENT_MOTIFS[theme.contentArt]
  if (!motif) return null
  const cacheKey = `${theme.key}:content:${width}x${height}`
  if (cache.has(cacheKey)) return cache.get(cacheKey)

  const env = getContext(width, height)
  if (!env) return null
  const { canvas, ctx } = env
  ctx.fillStyle = `#${theme.bg}`
  ctx.fillRect(0, 0, width, height)
  ctx.save()
  motif(ctx, theme, mulberry32(seedFromKey(theme.key + ':content')), width, height)
  ctx.restore()

  const dataUrl = toJpeg(canvas)
  cache.set(cacheKey, dataUrl)
  return dataUrl
}

/**
 * 内容页顶部色带（title-band 版式）用的渐变条，与预览里的 linear-gradient(120deg) 同色
 * @returns {string|null}
 */
export const renderBandArt = (themeKey, { width = ART_WIDTH, height = 254 } = {}) => {
  const theme = getSlideTheme(themeKey)
  const cacheKey = `${theme.key}:band:${width}x${height}`
  if (cache.has(cacheKey)) return cache.get(cacheKey)
  const env = getContext(width, height)
  if (!env) return null
  const { canvas, ctx } = env
  const g = ctx.createLinearGradient(0, 0, width, height * 2)
  g.addColorStop(0, `#${theme.coverBg}`)
  g.addColorStop(1, `#${theme.coverBg2}`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, width, height)
  const dataUrl = toJpeg(canvas)
  cache.set(cacheKey, dataUrl)
  return dataUrl
}

export default { renderCoverArt, renderContentArt, renderBandArt, ART_WIDTH, ART_HEIGHT }

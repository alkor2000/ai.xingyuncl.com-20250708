/**
 * 幻灯片封面背景图：在浏览器里用 <canvas> 程序生成（渐变底 + 抽象图案），
 * 无版权问题、不依赖任何素材；预览（CSS background-image）与 .pptx 导出
 * （slide.background.data）用的是同一张 JPEG，所以所见即所得。
 *
 * 图案由主题的 art 字段决定：
 *   blobs    柔和光斑（径向渐变圆）        rings   细线圆环/圆弧
 *   diagonal 斜向色带                       dots    点阵 + 大圆
 *   none     只有渐变底
 * 随机数用主题 key 做种子，同一主题每次生成完全一致。
 *
 * jsdom / 旧浏览器没有 canvas 2D 时返回 null，调用方退回纯色或渐变。
 */

import { getSlideTheme } from './slideThemes'

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

// ---- 图案 ----

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

const MOTIFS = { blobs: drawBlobs, rings: drawRings, diagonal: drawDiagonal, dots: drawDots }

// ---- 对外 ----

/**
 * 生成主题封面背景图
 * @param {string} themeKey
 * @param {Object} [options]
 * @param {number} [options.width=1600]
 * @param {number} [options.height=900]
 * @returns {string|null} JPEG data URL；环境不支持 canvas 时为 null
 */
export const renderCoverArt = (themeKey, { width = ART_WIDTH, height = ART_HEIGHT } = {}) => {
  const theme = getSlideTheme(themeKey)
  const cacheKey = `${theme.key}:${width}x${height}`
  if (cache.has(cacheKey)) return cache.get(cacheKey)

  const env = getContext(width, height)
  if (!env) return null
  const { canvas, ctx } = env

  // 底：纯色或对角渐变（split 封面只画色块部分，右侧留白由排版负责）
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

  let dataUrl = null
  try {
    dataUrl = canvas.toDataURL('image/jpeg', ART_JPEG_QUALITY)
  } catch {
    dataUrl = null
  }
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
  let dataUrl = null
  try { dataUrl = canvas.toDataURL('image/jpeg', ART_JPEG_QUALITY) } catch { dataUrl = null }
  cache.set(cacheKey, dataUrl)
  return dataUrl
}

export default { renderCoverArt, renderBandArt, ART_WIDTH, ART_HEIGHT }

/**
 * 浏览器内音频 → 频谱图，参数与 TF.js speech-commands（BROWSER_FFT 18w 模型）训练时完全一致：
 * 44.1kHz 单声道，AnalyserNode fftSize 2048、smoothing 0，每 1024 个采样取一帧 getFloatFrequencyData（dB），
 * 只保留前 232 个频点，连续 43 帧 ≈ 1 秒 → Float32Array(43×232)。
 *
 * 采集的录音与预置 WAV 都先解码、重采样到 44.1kHz，再用 OfflineAudioContext + suspend() 在同样的时刻取帧，
 * 保证训练/测试/预置三条路径得到同一种特征。
 */
export const SAMPLE_RATE = 44100
export const HOP = 1024
export const ANALYSER_FFT = 2048
export const NUM_FRAMES = 43
export const FRAME_SIZE = 232
export const CLIP_SAMPLES = NUM_FRAMES * HOP // 44032 ≈ 0.998 s
const DB_FLOOR = -160

let decodeContext = null
function getDecodeContext() {
  if (!decodeContext) {
    const Ctor = window.AudioContext || window.webkitAudioContext
    decodeContext = new Ctor()
  }
  return decodeContext
}

/** Blob/File/ArrayBuffer → AudioBuffer（任意采样率、声道数） */
export async function decodeAudio(source) {
  const buf = source instanceof ArrayBuffer ? source : await source.arrayBuffer()
  const ctx = getDecodeContext()
  return new Promise((resolve, reject) => {
    ctx.decodeAudioData(buf.slice(0), resolve, (e) => reject(e || new Error('decodeAudioData failed')))
  })
}

/** 任意 AudioBuffer → 44.1kHz 单声道、长度正好 CLIP_SAMPLES（短了补零，长了取前 1 秒） */
export async function toClipBuffer(audioBuffer, offsetSeconds = 0) {
  const ctx = new OfflineAudioContext(1, CLIP_SAMPLES, SAMPLE_RATE)
  const src = ctx.createBufferSource()
  src.buffer = audioBuffer
  src.connect(ctx.destination)
  src.start(0, Math.max(0, offsetSeconds))
  return ctx.startRendering()
}

/** 44.1kHz 单声道 AudioBuffer → 频谱图 Float32Array(NUM_FRAMES*FRAME_SIZE)，dB 值，-Infinity 已换成地板值 */
export async function spectrogramFromClip(clipBuffer) {
  const ctx = new OfflineAudioContext(1, CLIP_SAMPLES + ANALYSER_FFT, SAMPLE_RATE)
  const src = ctx.createBufferSource()
  src.buffer = clipBuffer
  const analyser = ctx.createAnalyser()
  analyser.fftSize = ANALYSER_FFT
  analyser.smoothingTimeConstant = 0
  src.connect(analyser)
  analyser.connect(ctx.destination)
  src.start(0)
  const out = new Float32Array(NUM_FRAMES * FRAME_SIZE)
  const freq = new Float32Array(analyser.frequencyBinCount)
  for (let k = 0; k < NUM_FRAMES; k += 1) {
    const t = ((k + 1) * HOP) / SAMPLE_RATE
    ctx.suspend(t).then(() => {
      analyser.getFloatFrequencyData(freq)
      for (let i = 0; i < FRAME_SIZE; i += 1) {
        const v = freq[i]
        out[k * FRAME_SIZE + i] = Number.isFinite(v) ? v : DB_FLOOR
      }
      ctx.resume()
    })
  }
  await ctx.startRendering()
  return out
}

/** 一步到位：Blob/File → 频谱图 */
export async function spectrogramFromBlob(blob) {
  const decoded = await decodeAudio(blob)
  const clip = await toClipBuffer(decoded)
  return spectrogramFromClip(clip)
}

/** z-score 归一化（与 speech-commands 的 normalize 一致），返回新数组 */
export function normalizeSpectrogram(spec) {
  let sum = 0
  for (let i = 0; i < spec.length; i += 1) sum += spec[i]
  const mean = sum / spec.length
  let varSum = 0
  for (let i = 0; i < spec.length; i += 1) { const d = spec[i] - mean; varSum += d * d }
  const std = Math.sqrt(varSum / spec.length) + 1e-7
  const out = new Float32Array(spec.length)
  for (let i = 0; i < spec.length; i += 1) out[i] = (spec[i] - mean) / std
  return out
}

/** 频谱图 → 小图（横轴时间、纵轴频率，低频在下），用于样本缩略图 */
export function spectrogramToDataUrl(spec, width = 172, height = 116) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const g = canvas.getContext('2d')
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < spec.length; i += 1) { if (spec[i] < min) min = spec[i]; if (spec[i] > max) max = spec[i] }
  const range = max - min || 1
  const img = g.createImageData(width, height)
  for (let y = 0; y < height; y += 1) {
    const bin = Math.floor((1 - y / height) * FRAME_SIZE)
    for (let x = 0; x < width; x += 1) {
      const frame = Math.floor((x / width) * NUM_FRAMES)
      const v = (spec[frame * FRAME_SIZE + Math.min(bin, FRAME_SIZE - 1)] - min) / range
      const o = (y * width + x) * 4
      // 深蓝 → 青 → 黄 的简单色带
      img.data[o] = Math.round(255 * Math.max(0, v * 2 - 1))
      img.data[o + 1] = Math.round(255 * Math.min(1, v * 1.6))
      img.data[o + 2] = Math.round(255 * (0.4 + 0.6 * (1 - v)) * (v < 0.5 ? 1 : 1 - (v - 0.5) * 2))
      img.data[o + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}

/** 简单能量（RMS，0–1）用于电平表 */
export function rms(float32) {
  let s = 0
  for (let i = 0; i < float32.length; i += 1) s += float32[i] * float32[i]
  return Math.sqrt(s / (float32.length || 1))
}

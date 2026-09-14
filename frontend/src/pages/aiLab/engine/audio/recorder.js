/**
 * 麦克风录音：打开音频流 → 持续采样 → 点"录"取接下来 ~1 秒的 PCM → 重采样到 44.1kHz → WAV Blob
 * 关掉自动增益/降噪/回声消除，尽量保留真实声音条件（实验要比较不同条件）。
 */
import { toClipBuffer, rms } from './spectrogram'
import { encodeWav } from './wav'

export async function createRecorder({ onLevel } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    video: false
  })
  const Ctor = window.AudioContext || window.webkitAudioContext
  const ctx = new Ctor()
  const source = ctx.createMediaStreamSource(stream)
  const processor = ctx.createScriptProcessor(2048, 1, 1)
  const silent = ctx.createGain()
  silent.gain.value = 0
  let capture = null // {chunks, needed, resolve}
  processor.onaudioprocess = (e) => {
    const data = e.inputBuffer.getChannelData(0)
    if (onLevel) onLevel(rms(data))
    if (capture) {
      capture.chunks.push(Float32Array.from(data))
      capture.got += data.length
      if (capture.got >= capture.needed) {
        const { chunks, resolve } = capture
        capture = null
        resolve(chunks)
      }
    }
  }
  source.connect(processor)
  processor.connect(silent)
  silent.connect(ctx.destination)
  if (ctx.state === 'suspended') await ctx.resume()

  return {
    sampleRate: ctx.sampleRate,
    /** 录 seconds 秒，返回 {blob(wav 44.1k), clip(AudioBuffer 44.1k), durationMs} */
    async record(seconds = 1.05) {
      const chunks = await new Promise((resolve) => { capture = { chunks: [], got: 0, needed: Math.ceil(seconds * ctx.sampleRate), resolve } })
      const total = chunks.reduce((a, c) => a + c.length, 0)
      const pcm = new Float32Array(total)
      let o = 0
      chunks.forEach((c) => { pcm.set(c, o); o += c.length })
      const raw = ctx.createBuffer(1, pcm.length, ctx.sampleRate)
      raw.copyToChannel(pcm, 0)
      const clip = await toClipBuffer(raw)
      return { blob: encodeWav(clip), clip, durationMs: Math.round((clip.length / clip.sampleRate) * 1000) }
    },
    close() {
      try { processor.disconnect(); source.disconnect(); silent.disconnect() } catch (e) { /* ignore */ }
      stream.getTracks().forEach((t) => t.stop())
      ctx.close().catch(() => {})
    }
  }
}

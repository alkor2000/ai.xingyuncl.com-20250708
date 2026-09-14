/**
 * WAV 编解码辅助：AudioBuffer（单声道）→ 16-bit PCM WAV Blob；录音与预置样本统一存 WAV
 */
export function encodeWav(audioBuffer) {
  const channel = audioBuffer.getChannelData(0)
  const sampleRate = audioBuffer.sampleRate
  const bytes = 44 + channel.length * 2
  const buffer = new ArrayBuffer(bytes)
  const view = new DataView(buffer)
  const writeStr = (offset, str) => { for (let i = 0; i < str.length; i += 1) view.setUint8(offset + i, str.charCodeAt(i)) }
  writeStr(0, 'RIFF'); view.setUint32(4, bytes - 8, true); writeStr(8, 'WAVE')
  writeStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  writeStr(36, 'data'); view.setUint32(40, channel.length * 2, true)
  let o = 44
  for (let i = 0; i < channel.length; i += 1) {
    const s = Math.max(-1, Math.min(1, channel[i]))
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    o += 2
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

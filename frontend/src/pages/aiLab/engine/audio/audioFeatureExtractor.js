/**
 * 声音特征提取器：自托管 TF.js speech-commands 18w 模型（浏览器 FFT 频谱图 → 20 类），
 * 截到倒数第二层 dense_1 得到 2000 维嵌入，L2 归一化后交给 kNN。与图像引擎同一套"预训练嵌入 + kNN"思路。
 */
import * as tf from '@tensorflow/tfjs'
import { NUM_FRAMES, FRAME_SIZE, normalizeSpectrogram } from './spectrogram'

export const AUDIO_EXTRACTOR_ID = 'speech_commands_18w'
const MODEL_URL = '/models/speech_commands_18w/model.json'
const EMBEDDING_LAYER = 'dense_1'

let extractorPromise = null

export function loadAudioExtractor(onProgress) {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const base = await tf.loadLayersModel(MODEL_URL, { onProgress: (f) => onProgress && onProgress(f) })
      const model = tf.model({ inputs: base.inputs, outputs: base.getLayer(EMBEDDING_LAYER).output })
      tf.tidy(() => model.predict(tf.zeros([1, NUM_FRAMES, FRAME_SIZE, 1])))
      return model
    })().catch((err) => { extractorPromise = null; throw err })
  }
  return extractorPromise
}

/** 频谱图（dB，未归一化）→ L2 归一化的嵌入向量 */
export async function embedSpectrogram(spec) {
  const model = await loadAudioExtractor()
  const normalized = normalizeSpectrogram(spec)
  return tf.tidy(() => {
    const x = tf.tensor4d(normalized, [1, NUM_FRAMES, FRAME_SIZE, 1])
    const y = model.predict(x)
    const norm = tf.norm(y, 'euclidean', 1, true)
    return tf.div(y, tf.add(norm, 1e-8)).dataSync()
  })
}

export async function embedSpectrograms(specs, onProgress) {
  const out = []
  for (let i = 0; i < specs.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    out.push(Float32Array.from(await embedSpectrogram(specs[i])))
    if (onProgress) onProgress(i + 1, specs.length)
  }
  return out
}

export function getAudioBackendName() {
  return tf.getBackend()
}

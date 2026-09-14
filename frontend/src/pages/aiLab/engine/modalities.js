/**
 * 模态适配：图像与声音共用"预训练嵌入 + kNN"的训练/测试面板，差别只在
 * 特征提取器怎么加载、样本怎么变成向量、缩略图怎么画。面板通过这个对象取用，不各写一套。
 */
import { loadExtractor, embedImages, FEATURE_EXTRACTOR_ID, getBackendName } from './featureExtractor'
import { loadImageElement } from './imageUtils'
import { loadAudioExtractor, embedSpectrograms, AUDIO_EXTRACTOR_ID, getAudioBackendName } from './audio/audioFeatureExtractor'
import { spectrogramFromBlob, spectrogramToDataUrl } from './audio/spectrogram'

/** 频谱图缓存：同一样本在训练/测试/缩略图里只解码一次 */
const specCache = new Map()
const thumbCache = new Map()

export async function spectrogramForSample(sample) {
  const key = sample.id ?? sample.file_url
  if (specCache.has(key)) return specCache.get(key)
  const res = await fetch(sample.file_url, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`audio fetch failed: ${res.status}`)
  const spec = await spectrogramFromBlob(await res.blob())
  specCache.set(key, spec)
  return spec
}

export async function thumbnailForSample(sample) {
  const key = sample.id ?? sample.file_url
  if (thumbCache.has(key)) return thumbCache.get(key)
  const url = spectrogramToDataUrl(await spectrogramForSample(sample))
  thumbCache.set(key, url)
  return url
}

export const imageModality = {
  id: 'image',
  engine: 'image-knn',
  featureExtractorId: FEATURE_EXTRACTOR_ID,
  supportsHeatmap: true,
  load: (onProgress) => loadExtractor(onProgress),
  backendName: getBackendName,
  async embedSamples(samples, onProgress) {
    const images = []
    for (let i = 0; i < samples.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      images.push(await loadImageElement(samples[i].file_url))
    }
    return embedImages(images, onProgress)
  }
}

export const audioModality = {
  id: 'audio',
  engine: 'audio-knn',
  featureExtractorId: AUDIO_EXTRACTOR_ID,
  supportsHeatmap: false,
  load: (onProgress) => loadAudioExtractor(onProgress),
  backendName: getAudioBackendName,
  async embedSamples(samples, onProgress) {
    const specs = []
    for (let i = 0; i < samples.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      specs.push(await spectrogramForSample(samples[i]))
      if (onProgress) onProgress(i * 0.5, samples.length)
    }
    return embedSpectrograms(specs, (done, total) => onProgress && onProgress(total / 2 + done / 2, total))
  }
}

export const modalityFor = (kind) => (kind === 'audio' ? audioModality : imageModality)

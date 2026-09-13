/**
 * 图像特征提取器（AI训练专区 E1 引擎底座）
 *
 * 用自托管的 MobileNet v1（alpha 0.5，224）Keras 层模型，截断到全局平均池化层，
 * 得到 512 维嵌入向量；训练与推理全部在浏览器内完成，不调用任何远程 API。
 *
 * 模型文件放在 frontend/public/models/mobilenet_v1_050_224/（约 5MB），
 * 由 nginx / vite 直接静态服务，学校内网无需访问外网模型仓库。
 */
import * as tf from '@tensorflow/tfjs'

export const FEATURE_EXTRACTOR_ID = 'mobilenet_v1_050_224'
export const INPUT_SIZE = 224
const MODEL_URL = '/models/mobilenet_v1_050_224/model.json'
const EMBED_LAYER = 'global_average_pooling2d_1'

let extractorPromise = null

/**
 * 加载并截断模型（只加载一次；失败后允许重试）
 * @param {(fraction:number)=>void} [onProgress] 下载进度 0..1
 */
export function loadExtractor(onProgress) {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      await tf.ready()
      const base = await tf.loadLayersModel(MODEL_URL, { onProgress })
      const output = base.getLayer(EMBED_LAYER).output
      const model = tf.model({ inputs: base.inputs, outputs: output })
      /* 预热一次，避免第一张图卡顿 */
      tf.tidy(() => model.predict(tf.zeros([1, INPUT_SIZE, INPUT_SIZE, 3])))
      return model
    })().catch((err) => {
      extractorPromise = null
      throw err
    })
  }
  return extractorPromise
}

export function isExtractorReady() {
  return extractorPromise !== null
}

/**
 * 把图像元素（img / canvas / video）转成 [1,224,224,3]、取值 [-1,1] 的张量
 */
function preprocess(source) {
  return tf.tidy(() => {
    const pixels = tf.browser.fromPixels(source)
    const resized = tf.image.resizeBilinear(pixels, [INPUT_SIZE, INPUT_SIZE], true)
    return resized.toFloat().div(127.5).sub(1).expandDims(0)
  })
}

/**
 * 计算单张图像的 L2 归一化嵌入向量
 * @returns {Promise<Float32Array>}
 */
export async function embedImage(source) {
  const model = await loadExtractor()
  const vec = tf.tidy(() => {
    const input = preprocess(source)
    const emb = model.predict(input)
    const norm = emb.div(emb.norm(2, 1, true).add(1e-8))
    return norm.dataSync()
  })
  return Float32Array.from(vec)
}

/**
 * 批量嵌入：逐张计算，回调进度；返回与输入同序的向量数组
 * @param {HTMLImageElement[]} images
 * @param {(done:number,total:number)=>void} [onProgress]
 */
export async function embedImages(images, onProgress) {
  const out = []
  for (let i = 0; i < images.length; i += 1) {
    out.push(await embedImage(images[i]))
    if (onProgress) onProgress(i + 1, images.length)
    /* 让出主线程，保持界面可响应 */
    if (i % 8 === 7) await new Promise((r) => setTimeout(r, 0))
  }
  return out
}

export function getBackendName() {
  return tf.getBackend()
}

/**
 * 画布产物导出的公共小工具：文件名清理、Blob 下载、图片取回
 *
 * 下载方式与 Chat.jsx 的 handleExportChat / HtmlCanvasPanel 的导出 HTML 一致：
 * Blob + URL.createObjectURL + 隐藏 <a download>，全站已有先例，不引入新依赖。
 */

/** Windows / Mac 文件系统共同禁止的文件名字符 */
const UNSAFE_FILENAME_CHARS_RE = /[\\/:*?"<>|]/g

/** 标题转文件名时的最大长度 */
const MAX_TITLE_FILENAME_LENGTH = 50

/**
 * 由标题生成安全的文件名主体（不含扩展名）
 * @param {string} title - 业务标题（可能为空）
 * @param {string} fallbackPrefix - 标题为空时的前缀，会追加时间戳
 * @param {string} [suffix=''] - 追加在主体后的后缀（如多块时的 _2）
 */
export const buildSafeBaseName = (title, fallbackPrefix, suffix = '') => {
  const safeTitle = String(title || '')
    .replace(UNSAFE_FILENAME_CHARS_RE, '')
    .replace(/\s+/g, '_')
    .slice(0, MAX_TITLE_FILENAME_LENGTH)

  if (safeTitle) return `${safeTitle}${suffix}`

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
  return `${fallbackPrefix}${suffix}-${timestamp}`
}

/**
 * 触发浏览器下载
 * @param {Blob} blob
 * @param {string} fileName - 含扩展名
 */
export const downloadBlob = (blob, fileName) => {
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}

/**
 * 取回图片并测量尺寸，供 pptx / docx 内嵌
 *
 * 失败（跨域、404、非图片）时返回 null，由调用方降级为文字占位，
 * 绝不能让一张坏图片把整份文件的导出拖垮。
 *
 * @param {string} url
 * @param {number} [timeoutMs=8000]
 * @returns {Promise<{ dataUrl: string, arrayBuffer: ArrayBuffer, mime: string, width: number, height: number } | null>}
 */
export const fetchImageForEmbedding = async (url, timeoutMs = 8000) => {
  if (!url || typeof url !== 'string') return null
  if (!/^(https?:\/\/|\/|data:image\/)/i.test(url)) return null

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null

  try {
    const response = await fetch(url, { signal: controller?.signal, mode: 'cors' })
    if (!response.ok) return null
    const blob = await response.blob()
    const mime = blob.type || ''
    if (!mime.startsWith('image/')) return null

    const arrayBuffer = await blob.arrayBuffer()
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
    const { width, height } = await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 })
      img.onerror = () => reject(new Error('image decode failed'))
      img.src = dataUrl
    })

    return { dataUrl, arrayBuffer, mime, width, height }
  } catch (error) {
    console.warn('fetchImageForEmbedding failed:', url, error?.message)
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

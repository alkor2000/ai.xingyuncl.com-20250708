/**
 * 图像工具：加载样本图、摄像头取帧（居中裁方）、Canvas 转 JPEG Blob
 */
export const CAPTURE_SIZE = 256

export function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`image load failed: ${src}`))
    img.src = src
  })
}

/**
 * 从 video 元素取一帧，居中裁成正方形并缩放到 size
 */
export function captureFrame(video, size = CAPTURE_SIZE) {
  const vw = video.videoWidth
  const vh = video.videoHeight
  const side = Math.min(vw, vh)
  const sx = (vw - side) / 2
  const sy = (vh - side) / 2
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.drawImage(video, sx, sy, side, side, 0, 0, size, size)
  return canvas
}

export function canvasToBlob(canvas, quality = 0.85) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/jpeg', quality)
  })
}

/**
 * 把任意图像源画到 size×size 的 canvas（居中裁方），用于遮挡热图
 */
export function drawSquare(source, size) {
  const sw = source.naturalWidth || source.videoWidth || source.width
  const sh = source.naturalHeight || source.videoHeight || source.height
  const side = Math.min(sw, sh)
  const sx = (sw - side) / 2
  const sy = (sh - side) / 2
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  canvas.getContext('2d').drawImage(source, sx, sy, side, side, 0, 0, size, size)
  return canvas
}

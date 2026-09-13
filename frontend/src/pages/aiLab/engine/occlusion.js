/**
 * 遮挡法显著性热图："模型在看哪里"
 *
 * 把图像切成 grid×grid 个格子，逐格用中灰遮住后重新预测，
 * 记录目标类别得分下降多少；下降越多，说明模型越依赖这一块。
 * 全部在浏览器内完成，grid=6 时需要 36 次嵌入计算，约 1 秒。
 */
import { embedImage } from './featureExtractor'
import { predictKnn } from './knn'
import { drawSquare } from './imageUtils'

export async function occlusionMap(model, source, targetLabel, options = {}) {
  const grid = options.grid || 6
  const size = options.size || 224
  const base = drawSquare(source, size)
  const baseVec = await embedImage(base)
  const baseScore = predictKnn(model, baseVec).scores[targetLabel] || 0
  const cell = size / grid
  const values = new Float32Array(grid * grid)
  for (let gy = 0; gy < grid; gy += 1) {
    for (let gx = 0; gx < grid; gx += 1) {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      ctx.drawImage(base, 0, 0)
      ctx.fillStyle = 'rgb(128,128,128)'
      ctx.fillRect(gx * cell, gy * cell, cell, cell)
      const vec = await embedImage(canvas)
      const score = predictKnn(model, vec).scores[targetLabel] || 0
      values[gy * grid + gx] = Math.max(0, baseScore - score)
      if (options.onProgress) options.onProgress(gy * grid + gx + 1, grid * grid)
    }
  }
  const max = Math.max(...values) || 1
  return { grid, values, normalized: Float32Array.from(values, (v) => v / max), baseScore }
}

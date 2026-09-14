/**
 * 消息气泡 → 画布 的打开请求
 *
 * 气泡里的产物卡片（MessageContent/ArtifactCard）和画布面板（Chat.jsx / HtmlCanvasPanel）
 * 隔着 MessageList / VirtualMessageList 两层，不想为一个按钮把回调一路穿下去，
 * 就用 window 上的自定义事件：
 *   - Chat.jsx 收到后把画布打开（canvasEnabled=true、canvasDismissed=false）
 *   - HtmlCanvasPanel 收到后切到对应产物；面板此刻可能还没挂载（画布被关着），
 *     所以请求同时暂存在模块变量里，面板挂载时再消费一次（3 秒内有效）
 */

export const CANVAS_OPEN_EVENT = 'ai-chat:canvas-open'

const PENDING_TTL = 3000
let pending = null

/**
 * @param {{ messageId: string|number, ordinal: number }} detail - 消息 id 与该消息内的产物序号
 */
export const requestOpenCanvas = (detail) => {
  pending = { ...detail, at: Date.now() }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CANVAS_OPEN_EVENT, { detail }))
  }
}

/** 取走暂存的请求（只在挂载时用；过期返回 null） */
export const takePendingOpenRequest = () => {
  if (!pending) return null
  const request = pending
  pending = null
  return Date.now() - request.at <= PENDING_TTL ? request : null
}

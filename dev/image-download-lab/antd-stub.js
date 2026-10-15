// 隔离浏览器实验用的 antd 替身：只记录提示，不渲染。message.* 的调用都推进 window.__messages。
const push = (level) => (content) => { (window.__messages = window.__messages || []).push({ level, content: String(content) }); };
export const message = { success: push('success'), error: push('error'), info: push('info'), warning: push('warning'), loading: push('loading') };
export default { message };

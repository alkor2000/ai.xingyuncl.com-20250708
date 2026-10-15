/**
 * 图像处理辅助函数
 */

import { message } from 'antd';
import { downloadBlob } from '../../../utils/canvas/download';

/**
 * 将文件转换为Base64
 * @param {File} file - 文件对象
 * @returns {Promise<string>} Base64字符串
 */
export const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      // 移除data:image/xxx;base64,前缀，只保留base64字符串
      const base64 = e.target.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

/**
 * 验证图片文件
 * @param {File} file - 文件对象
 * @returns {boolean} 是否有效
 */
export const validateImageFile = (file) => {
  // 检查文件类型
  const isImage = file.type.startsWith('image/');
  if (!isImage) {
    message.error('只能上传图片文件！');
    return false;
  }

  // 检查文件大小（限制5MB）
  const isLt5M = file.size / 1024 / 1024 < 5;
  if (!isLt5M) {
    message.error('图片大小不能超过5MB！');
    return false;
  }

  return true;
};

/* 按响应的 MIME 类型决定保存文件的扩展名；浏览器不校验 .jpg 里装的是不是 JPEG，但老师打开时会 */
const IMAGE_EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/svg+xml': 'svg', 'image/avif': 'avif' };

/** 取回超过这个时间就放弃，不让按钮一直转圈 */
const DOWNLOAD_FETCH_TIMEOUT_MS = 20000;

/**
 * 把调用方给的文件名换成与实际 MIME 一致的扩展名（ai_12.jpg + image/png → ai_12.png）
 * @param {string} filename
 * @param {string} mime
 */
export const withImageExtension = (filename, mime) => {
  const base = String(filename || 'image').replace(/\.[A-Za-z0-9]{1,5}$/, '');
  const ext = IMAGE_EXTENSIONS[String(mime || '').split(';')[0].trim().toLowerCase()] || 'jpg';
  return `${base}.${ext}`;
};

/**
 * 把存储的图片地址解析成本页可用的绝对地址。
 * 页面是 https 而地址是同一主机的 http 时升到 https：浏览器把 http 当成另一个源，既不让下载也不让取回。
 * @param {string} url
 * @returns {URL|null} 不是 http(s)/blob/data/相对路径时返回 null
 */
export const resolveImageDownloadUrl = (url) => {
  if (typeof url !== 'string' || !url.trim()) return null;
  const raw = url.trim();
  if (!/^(https?:\/\/|blob:|data:image\/|\/)/i.test(raw)) return null;
  let parsed;
  try {
    parsed = new URL(raw, window.location.href);
  } catch (e) {
    return null;
  }
  if (parsed.protocol === 'http:' && window.location.protocol === 'https:' && parsed.host === window.location.host) {
    parsed.protocol = 'https:';
  }
  return parsed;
};

/**
 * 下载图片。不再只是造一个 <a download> 点一下：
 *   - 跨源地址（对象存储、模型方 CDN）上 download 属性被浏览器忽略，点击变成整页跳转或没有反应；
 *   - 404/403/返回 HTML 时旧做法会得到一个"取消的下载"或一个装着网页的假 .jpg，而页面上什么提示都没有。
 * 现在先 fetch 取回字节：成功就以 Blob 触发真正的下载并按 MIME 修正扩展名；同源出错报出状态码；
 * 跨源且对方不允许跨域读取时，退到新标签页打开原图（不替换当前页面，老师可右键另存），并说明原因。
 * 不改 CORS、不经服务器代理、不重复下载；返回结果交由调用方提示，本函数自己不弹消息。
 * @param {string} url - 图片URL
 * @param {string} filename - 文件名（扩展名会按实际类型修正）
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ status: 'downloaded'|'opened'|'missing-url'|'failed'|'blocked', fileName?: string, httpStatus?: number, detail?: 'network'|'timeout'|'body'|'not-image'|'unknown-type'|string, url?: string }>}
 */
export const downloadImage = async (url, filename, options = {}) => {
  const target = resolveImageDownloadUrl(url);
  if (!target) return { status: 'missing-url' };
  const href = target.href;
  const sameOrigin = target.protocol === 'blob:' || target.protocol === 'data:' || target.origin === window.location.origin;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), options.timeoutMs || DOWNLOAD_FETCH_TIMEOUT_MS) : null;
  let response;
  try {
    response = await fetch(href, {
      method: 'GET',
      mode: sameOrigin ? 'same-origin' : 'cors',
      credentials: sameOrigin ? 'same-origin' : 'omit',
      cache: 'no-store',
      signal: controller ? controller.signal : undefined
    });
  } catch (error) {
    if (timer) clearTimeout(timer);
    const timedOut = error && error.name === 'AbortError';
    if (!sameOrigin && !timedOut) {
      // 对方不允许跨域读取（或网络不通）：在新标签页打开，当前页面不动。
      // 不能传 noopener：按规范带 noopener 的 window.open 一律返回 null，就分不清"打开了"和"被拦截了"；
      // 改为打开后手动切断 opener，效果相同且能知道是否真的开了。
      const win = window.open(href, '_blank');
      if (!win) return { status: 'blocked', url: href };
      try { win.opener = null; } catch (e) { /* 跨源窗口不让写也无妨 */ }
      return { status: 'opened', url: href };
    }
    return { status: 'failed', detail: timedOut ? 'timeout' : 'network', url: href };
  }
  // 响应头到了不等于拿到了图片：正文还在同一个超时里，读完（或读失败）才算结束
  if (!response.ok) {
    if (timer) clearTimeout(timer);
    return { status: 'failed', httpStatus: response.status, detail: String(response.status), url: href };
  }
  const mime = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!mime) {
    // 没有 Content-Type 就无法确认这是图片：明确失败，不嗅探、不把未知内容存成 .jpg
    if (timer) clearTimeout(timer);
    return { status: 'failed', detail: 'unknown-type', url: href };
  }
  if (!mime.startsWith('image/')) {
    // 典型情况：图片文件已不在，SPA 兜底返回了 index.html —— 不能把网页存成 .jpg
    if (timer) clearTimeout(timer);
    return { status: 'failed', detail: 'not-image', url: href };
  }
  let blob;
  try {
    blob = await response.blob();
  } catch (error) {
    // 正文挂起到超时（AbortError）或中途断开：同样是失败，调用方要能提示并释放按钮
    const timedOut = (error && error.name === 'AbortError') || (controller && controller.signal.aborted);
    return { status: 'failed', detail: timedOut ? 'timeout' : 'body', url: href };
  } finally {
    if (timer) clearTimeout(timer);
  }
  const fileName = withImageExtension(filename || 'image.jpg', mime);
  downloadBlob(blob, fileName);
  return { status: 'downloaded', fileName, url: href };
};

/**
 * 复制文本到剪贴板
 * @param {string} text - 要复制的文本
 */
export const copyToClipboard = (text) => {
  navigator.clipboard.writeText(text);
  message.success('已复制到剪贴板');
};

/**
 * 判断是否为Midjourney模型
 * @param {Object} model - 模型对象
 * @returns {boolean}
 */
export const isMidjourneyModel = (model) => {
  return model && model.provider === 'midjourney' && model.generation_type === 'async';
};

/**
 * 判断是否为Seedream系列模型（火山引擎doubao-seedream）
 *
 * 判定逻辑需与后端 backend/src/services/imageService.js 的
 * ImageService.isSeedreamModel 保持完全一致：provider为volcano且
 * model_id以doubao-seedream开头。用于前端在展示图片尺寸时区分该
 * 模型的真实生成像素值（后端会重新映射，与通用预设值不同）。
 * @param {Object} model - 模型对象
 * @returns {boolean}
 */
export const isSeedreamModel = (model) => {
  return Boolean(
    model &&
    model.provider === 'volcano' &&
    model.model_id &&
    model.model_id.startsWith('doubao-seedream')
  );
};

/**
 * 计算生成价格
 * @param {Object} model - 模型对象
 * @param {number} quantity - 数量
 * @returns {number} 总价格
 */
export const calculatePrice = (model, quantity = 1) => {
  if (!model) return 0;
  
  if (isMidjourneyModel(model)) {
    // Midjourney按4张计算（一个网格）
    const gridSize = model.api_config?.grid_size || 4;
    return (model.price_per_image || 0) * gridSize;
  } else {
    // 普通模型按数量计算
    return (model.price_per_image || 0) * quantity;
  }
};

/**
 * 获取图片显示URL
 * @param {Object} item - 图片对象
 * @returns {string} URL
 */
export const getImageUrl = (item) => {
  return item.local_path || item.thumbnail_path || item.image_url || '';
};

/**
 * 判断任务是否完成
 * @param {Object} item - 任务对象
 * @returns {boolean}
 */
export const isTaskCompleted = (item) => {
  return item.status === 'success' || item.status === 'failed' || 
         item.task_status === 'SUCCESS' || item.task_status === 'FAILURE';
};

/**
 * 判断任务是否失败
 * @param {Object} item - 任务对象
 * @returns {boolean}
 */
export const isTaskFailed = (item) => {
  return item.status === 'failed' || item.task_status === 'FAILURE';
};

/**
 * 判断任务是否处理中
 * @param {Object} item - 任务对象
 * @param {Object} processingTasks - 处理中的任务映射
 * @returns {boolean}
 */
export const isTaskProcessing = (item, processingTasks = {}) => {
  const completed = isTaskCompleted(item);
  return !completed && (
    (item.task_status === 'SUBMITTED' || item.task_status === 'IN_PROGRESS') || 
    (item.task_id && processingTasks[item.task_id])
  );
};

/**
 * 格式化文件名
 * @param {Object} item - 图片对象
 * @param {number} index - 索引
 * @returns {string} 文件名
 */
export const formatFileName = (item, index = 0) => {
  return item.title || item.prompt || `image_${item.id || index}.jpg`;
};

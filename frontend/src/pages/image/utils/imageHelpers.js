/**
 * 图像处理辅助函数
 */

import { message } from 'antd';

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

/**
 * 下载图片
 * @param {string} url - 图片URL
 * @param {string} filename - 文件名
 */
export const downloadImage = (url, filename) => {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'image.jpg';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
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

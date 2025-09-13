/**
 * 图像生成模块常量定义
 */

// 预设尺寸配置
export const PRESET_SIZES = {
  default: [
    { label: '正方形 1:1', value: '1024x1024', ratio: '1:1' },
    { label: '竖屏 3:4', value: '864x1152', ratio: '3:4' },
    { label: '横屏 4:3', value: '1152x864', ratio: '4:3' },
    { label: '宽屏 16:9', value: '1280x720', ratio: '16:9' },
    { label: '竖屏 9:16', value: '720x1280', ratio: '9:16' },
    { label: '竖屏 2:3', value: '832x1248', ratio: '2:3' },
    { label: '横屏 3:2', value: '1248x832', ratio: '3:2' },
    { label: '超宽 21:9', value: '1512x648', ratio: '21:9' }
  ]
};

// 生成数量选项
export const QUANTITY_OPTIONS = [
  { label: '1张', value: 1 },
  { label: '2张', value: 2 },
  { label: '3张', value: 3 },
  { label: '4张', value: 4 }
];

// Midjourney参数示例
export const MIDJOURNEY_EXAMPLES = [
  { param: '--ar 16:9', desc: '宽屏比例' },
  { param: '--ar 9:16', desc: '竖屏比例' },
  { param: '--ar 3:2', desc: '横屏3:2' },
  { param: '--v 6', desc: '使用V6版本' },
  { param: '--s 750', desc: '风格化程度' },
  { param: '--q 2', desc: '高质量' },
  { param: '--no text', desc: '排除文字' },
  { param: '--iw 2', desc: '增强参考图权重' }
];

// 分页配置
export const PAGINATION_CONFIG = {
  defaultPageSize: 20,
  pageSizeOptions: ['20', '40', '60', '100']
};

// 文件上传限制
export const UPLOAD_CONFIG = {
  maxFileSize: 5, // MB
  maxReferenceImages: 5,
  acceptedTypes: 'image/*'
};

// 默认参数
export const DEFAULT_PARAMS = {
  selectedSize: '1024x1024',
  seed: -1,
  guidanceScale: 2.5,
  watermark: true,
  quantity: 1
};

// 视图模式
export const VIEW_MODES = {
  GRID: 'grid',
  LIST: 'list'
};

// Tab键值
export const TAB_KEYS = {
  ALL: 'all',
  FAVORITES: 'favorites',
  PUBLIC: 'public'
};

// Midjourney操作类型
export const MJ_ACTIONS = {
  UPSCALE: 'UPSCALE',
  VARIATION: 'VARIATION',
  REROLL: 'REROLL',
  IMAGINE: 'IMAGINE'
};

// 操作标签映射
export const ACTION_LABELS = {
  UPSCALE: (index) => `放大第${index}张`,
  VARIATION: (index) => `变体第${index}张`,
  REROLL: '重新生成'
};

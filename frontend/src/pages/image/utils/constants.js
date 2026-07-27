/**
 * 图像生成模块常量定义
 *
 * i18n 说明:
 *   - 含中文的"可见"标签不再写死在常量里，改为在组件内用 t() 渲染
 *   - QUANTITY_OPTIONS 改为纯数值数组，label 由 ParameterSettings 组件用 t('image.imageCount') 生成
 *   - ACTION_LABELS 改为返回 { type, index } 结构，文案由 index.jsx 用 t() 拼接
 *   - PRESET_SIZES.label / MIDJOURNEY_EXAMPLES.desc 为界面不展示的死数据，保留中文不影响显示
 */

// 预设尺寸配置（注：界面按钮显示 ratio 字段，label 当前未在 UI 渲染）
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

// 生成数量选项（纯数值，label 由组件用 t('image.imageCount', { count }) 渲染）
export const QUANTITY_OPTIONS = [1, 2, 3, 4];

// Midjourney参数示例（desc 当前未在 UI 渲染，保留）
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

/**
 * 操作标签映射（i18n 改造版）
 *   - 不再返回写死的中文字符串
 *   - 返回 { type, index } 结构，由调用方（index.jsx）用 t() 生成最终文案
 *   - type 对应 image.json 中的 key 后缀：
 *       upscaleIndex   -> 放大第N张 / Upscale #N
 *       variationIndex -> 变体第N张 / Variation #N
 *       reroll         -> 重新生成 / Reroll（无 index）
 */
export const ACTION_LABELS = {
  UPSCALE: (index) => ({ type: 'upscaleIndex', index }),
  VARIATION: (index) => ({ type: 'variationIndex', index }),
  REROLL: { type: 'reroll' }
};

/**
 * 图像生成模块常量定义
 *
 * ── i18n 设计原则 ──
 * 常量文件在模块加载时求值一次，无法调用 t()，因此本文件【不存放任何会
 * 展示到界面的文案】。所有可见文字一律由消费组件在渲染期用 t() 生成，
 * 这样才能跟随语言切换实时刷新。
 *
 * ── 本次清理（删除两处死字段，零行为变更）──
 * 1) PRESET_SIZES 删除 label 字段
 *    ParameterSettings 渲染尺寸按钮时只用 size.ratio（如 "16:9"），
 *    label（"正方形 1:1" 等）从未被读取，属纯死数据。
 *    比例字符串本身是国际通用写法，无需翻译，故删除 label 后无任何键需新增。
 *
 * 2) MIDJOURNEY_EXAMPLES 删除 desc 字段
 *    PromptInput 原写法为 t(`image.param.${param}`, example.desc)，
 *    其中第二参数是 i18next 的 defaultValue。而语言包 zh/en 两侧的
 *    image.param.* 键【已全部存在】，defaultValue 永远不会被取用，
 *    desc 同样是死数据。
 *    保留它反而有害：一旦将来新增参数而漏配语言包键，desc 会让缺失在中文
 *    环境完全隐形（切英文才暴露）。删除后缺键会直接显示键名，问题立刻可见。
 *
 * ── 已知功能缺口（非国际化问题，未处理）──
 * 语言包中另有 image.param['--niji']（动漫风格）与 image.param['--style raw']
 * （原始风格）两个键，但下方 MIDJOURNEY_EXAMPLES 未收录这两个参数，
 * 用户在"参数助手"里点不到。属功能项遗漏，需产品确认后再补。
 */

/**
 * 预设尺寸配置
 * ratio 为界面按钮显示文本（国际通用比例写法，不翻译）；
 * value 为提交给后端的实际像素尺寸。
 */
export const PRESET_SIZES = {
  default: [
    { value: '1024x1024', ratio: '1:1' },
    { value: '864x1152', ratio: '3:4' },
    { value: '1152x864', ratio: '4:3' },
    { value: '1280x720', ratio: '16:9' },
    { value: '720x1280', ratio: '9:16' },
    { value: '832x1248', ratio: '2:3' },
    { value: '1248x832', ratio: '3:2' },
    { value: '1512x648', ratio: '21:9' }
  ]
};

/**
 * 生成数量选项
 * 纯数值数组；label 由 ParameterSettings 用 t('image.imageCount', { count }) 渲染
 */
export const QUANTITY_OPTIONS = [1, 2, 3, 4];

/**
 * Midjourney 参数示例
 * param 为 Midjourney 官方参数写法（技术标识，不翻译）；
 * 中文说明由 PromptInput 按 image.param.{param} 键从语言包取用。
 * 新增参数时必须同步在 zh-CN/image.json 与 en-US/image.json 添加对应键，
 * 否则界面会显示键名。
 */
export const MIDJOURNEY_EXAMPLES = [
  { param: '--ar 16:9' },
  { param: '--ar 9:16' },
  { param: '--ar 3:2' },
  { param: '--v 6' },
  { param: '--s 750' },
  { param: '--q 2' },
  { param: '--no text' },
  { param: '--iw 2' }
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

// Midjourney操作类型（枚举值，与后端 action_type 对应，不翻译）
export const MJ_ACTIONS = {
  UPSCALE: 'UPSCALE',
  VARIATION: 'VARIATION',
  REROLL: 'REROLL',
  IMAGINE: 'IMAGINE'
};

/**
 * 操作标签映射
 *   - 不返回写死的文案，只返回 { type, index } 结构
 *   - 由调用方（index.jsx 的 buildActionLabel）用 t() 生成最终文案
 *   - type 对应 image.json 中的键后缀：
 *       upscaleIndex   -> 放大第N张 / Upscale #N
 *       variationIndex -> 变体第N张 / Variation #N
 *       reroll         -> 重新生成 / Reroll（无 index）
 */
export const ACTION_LABELS = {
  UPSCALE: (index) => ({ type: 'upscaleIndex', index }),
  VARIATION: (index) => ({ type: 'variationIndex', index }),
  REROLL: { type: 'reroll' }
};

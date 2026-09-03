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
 *
 * ── 本次修复（2处Bug，零其他行为变更）──
 * 1) 新增 SEEDREAM_ACTUAL_SIZES 映射表
 *    背景：图片尺寸按钮下方展示的像素值（如"1024x1024"）取自本文件
 *    PRESET_SIZES.default 的 value 字段，该字段是给所有provider通用的
 *    预设像素值。但后端 backend/src/services/imageService.js 针对
 *    Seedream模型（provider==='volcano'且model_id以doubao-seedream开头）
 *    会调用 convertSizeForSeedream() 按官方2K档位映射表重新计算精确
 *    像素值（如1:1比例实际传给API的是"2048x2048"而非"1024x1024"），
 *    实际生成的图片也是该映射后的尺寸，导致前端展示值与真实生成结果
 *    不符。本映射表与后端 SEEDREAM_RATIO_SIZE_MAP['2K'] 完全一致，
 *    供 ParameterSettings.jsx 在选中Seedream模型时按比例反查展示真实
 *    像素值。若后端未来切换4K档位或调整映射表数值，此处需同步更新。
 *
 * 2) DEFAULT_PARAMS.watermark 默认值由 true 改为 false
 *    产品需求：图像生成模块的"添加水印"开关默认关闭，用户可自行开启。
 */

/**
 * 预设尺寸配置
 * ratio 为界面按钮显示文本（国际通用比例写法，不翻译）；
 * value 为提交给后端的实际像素尺寸（非Seedream模型下与真实生成尺寸一致；
 * Seedream模型下后端会重新映射，界面展示需改用SEEDREAM_ACTUAL_SIZES）。
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
 * Seedream模型（火山引擎doubao-seedream系列）实际生成像素尺寸映射表
 *
 * 与后端 backend/src/services/imageService.js 的
 * SEEDREAM_RATIO_SIZE_MAP['2K'] 保持完全一致，键为比例字符串（如"1:1"），
 * 值为该比例下Seedream API实际使用、且已通过官方文档验证同时满足
 * 总像素范围[3686400,16777216]与宽高比范围[1/16,16]约束的精确像素值。
 *
 * 仅供界面展示用，不参与实际请求参数的构建（实际参数仍传selectedSize，
 * 由后端自行按此逻辑转换），故本表与后端表任一方修改都需同步另一方，
 * 否则会重新出现"界面展示值与实际生成结果不符"的问题。
 */
export const SEEDREAM_ACTUAL_SIZES = {
  '1:1': '2048x2048',
  '4:3': '2304x1728',
  '3:4': '1728x2304',
  '16:9': '2848x1600',
  '9:16': '1600x2848',
  '3:2': '2496x1664',
  '2:3': '1664x2496',
  '21:9': '3136x1344'
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
  // 添加水印默认关闭，用户可在高级选项中手动开启
  watermark: false,
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

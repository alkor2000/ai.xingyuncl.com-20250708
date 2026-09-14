/**
 * AI训练专区任务模板（代码常量，不进表）
 *
 * 每个模板描述一节"真实数据 → 真实训练 → 三集制测试"的实验课：
 * - kind                   数据类型：image 图片 | table 表格 | audio 音频 | text 文本
 * - engine                 训练引擎：image-knn | image-dense | table-tree | table-rules | table-mlp |
 *                          audio-knn | text-nb | verify（P7/L5 资讯核验，不训练模型）
 * - default_classes        创建项目时自动建的数据集类别（空数组表示由学生自定或由预置包导入）
 * - min_train_per_class    建议每类至少采集的训练样本数
 * - holdout_ratio          lock 时默认的留出比例
 * - suggested_shift_sets   建议的"换条件"测试集
 * - steps                  学习步骤顺序（前端按此渲染流程）
 * - abilities              对应的核心素养标签
 * - presets                推荐的预置数据包 key（见 backend/presets/ai-lab/<key>/manifest.json）
 * - config                 任务自由配置（如 mislabel_ratio、per_class_limits、max_depth_options）
 *
 * 另导出过程事件类型白名单 AI_LAB_EVENT_TYPES（POST /projects/:id/events 校验）、
 * 训练引擎白名单 AI_LAB_ENGINES（POST /projects/:id/models 校验）、数据集类型 AI_LAB_DATASET_KINDS，
 * 以及 engineKind(engine)：引擎对应的数据集类型（audio-* → audio、text-* → text、table-* → table、其余 image）。
 *
 * 模板顺序：L1,L2,L3,L4,L5,L6,M1,M2,M3,M4,M5,P1,P2,P3,P6,P7,free
 */

const IMAGE_SHIFT_SETS = [
  { key: 'bg', label: '换背景' },
  { key: 'angle', label: '换角度' },
  { key: 'light', label: '换光线' }
];

const AI_LAB_TASKS = [
  {
    key: 'L1',
    version: '1',
    title: '它能分清我的两样东西吗',
    kind: 'image',
    grade_band: 'L',
    engine: 'image-knn',
    hours: 2,
    default_classes: [
      { key: 'thing_a', label: '物品A' },
      { key: 'thing_b', label: '物品B' }
    ],
    min_train_per_class: 10,
    holdout_ratio: 0.2,
    suggested_shift_sets: IMAGE_SHIFT_SETS,
    steps: ['predict', 'collect', 'lock', 'train', 'test_holdout', 'test_shift', 'model_card'],
    abilities: ['intent', 'critical', 'externalize'],
    presets: ['shapes', 'fruits-mini'],
    config: {}
  },
  {
    key: 'L2',
    version: '1',
    title: '声音也能被认出来吗',
    kind: 'audio',
    grade_band: 'L',
    engine: 'audio-knn',
    hours: 1,
    default_classes: [
      { key: 'clap', label: '拍手' },
      { key: 'knock', label: '敲桌' },
      { key: 'whistle', label: '口哨' }
    ],
    min_train_per_class: 10,
    holdout_ratio: 0.2,
    suggested_shift_sets: [
      { key: 'speaker', label: '换同学发声' },
      { key: 'noise', label: '叠加教室噪声' }
    ],
    steps: ['predict', 'collect', 'lock', 'train', 'test_holdout', 'test_shift', 'errors', 'model_card'],
    abilities: ['intent', 'critical', 'iterate'],
    presets: ['sounds-synth'],
    config: {}
  },
  {
    key: 'L3',
    version: '1',
    title: '给 AI 喂错数据会怎样',
    kind: 'image',
    grade_band: 'L',
    engine: 'image-knn',
    hours: 1,
    default_classes: [],
    min_train_per_class: 10,
    holdout_ratio: 0.2,
    suggested_shift_sets: IMAGE_SHIFT_SETS,
    steps: ['predict', 'import_preset', 'lock', 'train', 'test_holdout', 'mislabel', 'train', 'test_holdout', 'errors', 'restore', 'iterate', 'model_card'],
    abilities: ['critical', 'pattern', 'externalize'],
    presets: ['fruits-mini', 'shapes'],
    config: { mislabel_ratio: 0.2 }
  },
  {
    key: 'L4',
    version: '1',
    title: '多少张够用',
    kind: 'image',
    grade_band: 'L',
    engine: 'image-knn',
    hours: 1,
    default_classes: [],
    min_train_per_class: 3,
    holdout_ratio: 0.2,
    suggested_shift_sets: IMAGE_SHIFT_SETS,
    steps: ['predict', 'import_preset', 'lock', 'train', 'test_holdout', 'iterate', 'model_card'],
    abilities: ['pattern', 'iterate', 'metacognition'],
    presets: ['shapes', 'fruits-mini'],
    config: { per_class_limits: [3, 10, 30] }
  },
  {
    key: 'L5',
    version: '1',
    title: 'AI 讲的动物故事哪里不对',
    kind: 'text',
    grade_band: 'L',
    engine: 'verify',
    hours: 1,
    default_classes: [],
    min_train_per_class: 0,
    holdout_ratio: null,
    suggested_shift_sets: [],
    steps: ['material', 'claims', 'verdicts', 'reflection'],
    abilities: ['critical', 'multi'],
    presets: [],
    config: { material_set: 'animal', projected_default: true }
  },
  {
    key: 'L6',
    version: '1',
    title: '规则是我定的',
    kind: 'table',
    grade_band: 'L',
    engine: 'table-rules',
    hours: 1,
    default_classes: [],
    min_train_per_class: 10,
    holdout_ratio: 0.2,
    suggested_shift_sets: [],
    steps: ['predict', 'import_preset', 'lock', 'rules', 'train', 'test_holdout', 'compare', 'model_card'],
    abilities: ['problem', 'externalize', 'pattern'],
    presets: ['animal-cards', 'garbage-cards'],
    config: { max_depth_options: [1, 2, 3] }
  },
  {
    key: 'M1',
    version: '1',
    title: '校园侦探：一次完整的训练',
    kind: 'image',
    grade_band: 'M',
    engine: 'image-knn',
    hours: 2,
    default_classes: [
      { key: 'item_1', label: '物品1' },
      { key: 'item_2', label: '物品2' },
      { key: 'item_3', label: '物品3' },
      { key: 'item_4', label: '物品4' },
      { key: 'item_5', label: '物品5' },
      { key: 'item_6', label: '物品6' }
    ],
    min_train_per_class: 30,
    holdout_ratio: 0.2,
    suggested_shift_sets: IMAGE_SHIFT_SETS,
    steps: ['predict', 'data_card', 'collect', 'lock', 'train', 'test_holdout', 'test_shift', 'errors', 'iterate', 'model_card'],
    abilities: ['problem', 'intent', 'iterate'],
    presets: [],
    config: {}
  },
  {
    key: 'M2',
    version: '1',
    title: '让分类器更公平',
    kind: 'image',
    grade_band: 'M',
    engine: 'image-knn',
    hours: 2,
    default_classes: [
      { key: 'class_a', label: '物品A' },
      { key: 'class_b', label: '物品B' },
      { key: 'class_c', label: '物品C' },
      { key: 'class_d', label: '物品D' }
    ],
    min_train_per_class: 20,
    holdout_ratio: 0.2,
    suggested_shift_sets: [{ key: 'collector', label: '换采集者' }],
    steps: ['predict', 'collect', 'lock', 'train', 'test_holdout', 'fairness', 'collect', 'train', 'test_holdout', 'iterate', 'model_card'],
    abilities: ['multi', 'critical', 'problem'],
    presets: [],
    config: { subgroup_tag: 'collector' }
  },
  {
    key: 'M3',
    version: '1',
    title: '决策树 vs 神经网络',
    kind: 'table',
    grade_band: 'M',
    engine: 'table-tree',
    hours: 2,
    default_classes: [],
    min_train_per_class: 10,
    holdout_ratio: 0.2,
    suggested_shift_sets: [],
    steps: ['predict', 'import_preset', 'lock', 'train', 'train_mlp', 'test_holdout', 'test_shift', 'compare', 'model_card'],
    abilities: ['pattern', 'externalize', 'multi'],
    presets: ['penguins', 'iris', 'campus-items'],
    config: { max_depth_options: [1, 2, 3, 4, 6], mlp: { hidden: 16, epochs: 80 } }
  },
  {
    key: 'M4',
    version: '1',
    title: '听懂关键词：从声音到指令',
    kind: 'audio',
    grade_band: 'M',
    engine: 'audio-knn',
    hours: 2,
    default_classes: [
      { key: 'kai', label: '开' },
      { key: 'guan', label: '关' },
      { key: 'shang', label: '上' },
      { key: 'xia', label: '下' },
      { key: 'zuo', label: '左' },
      { key: 'you', label: '右' },
      { key: 'ting', label: '停' },
      { key: 'zou', label: '走' },
      { key: 'kuai', label: '快' },
      { key: 'man', label: '慢' }
    ],
    min_train_per_class: 10,
    holdout_ratio: 0.2,
    suggested_shift_sets: [
      { key: 'speaker', label: '换说话人' },
      { key: 'device', label: '换设备' }
    ],
    steps: ['predict', 'collect', 'lock', 'train', 'test_holdout', 'test_shift', 'errors', 'iterate', 'model_card'],
    abilities: ['intent', 'iterate', 'resilience'],
    presets: [],
    config: {}
  },
  {
    key: 'M5',
    version: '1',
    title: '情绪翻译器：文本也能分类',
    kind: 'text',
    grade_band: 'M',
    engine: 'text-nb',
    hours: 2,
    default_classes: [
      { key: 'positive', label: '积极' },
      { key: 'negative', label: '消极' },
      { key: 'neutral', label: '中性' }
    ],
    min_train_per_class: 30,
    holdout_ratio: 0.2,
    suggested_shift_sets: [{ key: 'topic', label: '另一话题' }],
    steps: ['predict', 'import_preset', 'annotate', 'agreement', 'lock', 'train', 'test_holdout', 'test_shift', 'errors', 'iterate', 'model_card'],
    abilities: ['intent', 'critical', 'multi'],
    presets: ['campus-messages'],
    config: {}
  },
  {
    key: 'P1',
    version: '1',
    title: '模型认的是物体还是背景',
    kind: 'image',
    grade_band: 'P',
    engine: 'image-knn',
    hours: 2,
    default_classes: [
      { key: 'class_a', label: '物品A' },
      { key: 'class_b', label: '物品B' },
      { key: 'class_c', label: '物品C' },
      { key: 'class_d', label: '物品D' }
    ],
    min_train_per_class: 15,
    holdout_ratio: 0.2,
    suggested_shift_sets: IMAGE_SHIFT_SETS,
    steps: ['predict', 'collect', 'lock', 'train', 'test_holdout', 'test_shift', 'errors', 'iterate', 'model_card'],
    abilities: ['intent', 'critical'],
    presets: ['fruits-mini', 'shapes'],
    config: {}
  },
  {
    key: 'P2',
    version: '1',
    title: '换一个环境还能识别吗',
    kind: 'image',
    grade_band: 'P',
    engine: 'image-knn',
    hours: 2,
    default_classes: [
      { key: 'class_a', label: '物品A' },
      { key: 'class_b', label: '物品B' },
      { key: 'class_c', label: '物品C' },
      { key: 'class_d', label: '物品D' }
    ],
    min_train_per_class: 15,
    holdout_ratio: 0.2,
    suggested_shift_sets: IMAGE_SHIFT_SETS,
    steps: ['predict', 'collect', 'condition_design', 'lock', 'train', 'test_holdout', 'test_shift', 'errors', 'iterate', 'model_card'],
    abilities: ['critical', 'iterate'],
    presets: ['fruits-mini', 'shapes'],
    config: {}
  },
  {
    key: 'P3',
    version: '1',
    title: '人工规则 vs 数据规则',
    kind: 'table',
    grade_band: 'P',
    engine: 'table-tree',
    hours: 2,
    default_classes: [],
    min_train_per_class: 10,
    holdout_ratio: 0.2,
    suggested_shift_sets: [],
    steps: ['predict', 'import_preset', 'lock', 'rules', 'train', 'test_holdout', 'test_shift', 'compare', 'model_card'],
    abilities: ['problem', 'pattern', 'externalize'],
    presets: ['campus-items', 'penguins', 'iris'],
    config: { max_depth_options: [1, 2, 3, 4, 6] }
  },
  {
    key: 'P6',
    version: '1',
    title: '校园声音地图',
    kind: 'audio',
    grade_band: 'P',
    engine: 'audio-knn',
    hours: 2,
    default_classes: [
      { key: 'bell', label: '铃声' },
      { key: 'footsteps', label: '脚步' },
      { key: 'door', label: '开关门' },
      { key: 'chatter', label: '说话声' },
      { key: 'wind', label: '风声' }
    ],
    min_train_per_class: 15,
    holdout_ratio: 0.2,
    suggested_shift_sets: [
      { key: 'place', label: '换地点' },
      { key: 'noise', label: '加噪声' }
    ],
    steps: ['predict', 'data_card', 'collect', 'lock', 'train', 'test_holdout', 'test_shift', 'errors', 'iterate', 'model_card'],
    abilities: ['intent', 'iterate', 'resilience'],
    presets: ['sounds-synth'],
    config: {}
  },
  {
    key: 'P7',
    version: '1',
    title: 'AI 给出的校园资讯可信吗',
    kind: 'text',
    grade_band: 'P',
    engine: 'verify',
    hours: 2,
    default_classes: [],
    min_train_per_class: 0,
    holdout_ratio: null,
    suggested_shift_sets: [],
    steps: ['material', 'claims', 'verdicts', 'revise', 'reflection'],
    abilities: ['intent', 'critical', 'iterate'],
    presets: [],
    config: { material_set: 'campus' }
  },
  {
    key: 'free',
    version: '1',
    title: '自由实验',
    kind: 'image',
    grade_band: 'all',
    engine: 'image-knn',
    hours: 1,
    default_classes: [],
    min_train_per_class: 10,
    holdout_ratio: 0.2,
    suggested_shift_sets: IMAGE_SHIFT_SETS,
    steps: ['collect', 'lock', 'train', 'test_holdout', 'test_shift', 'errors', 'iterate', 'model_card'],
    abilities: ['intent', 'critical', 'iterate'],
    presets: ['fruits-mini', 'shapes'],
    /* free 的数据集 kind 允许由首次导入的预置包决定（空数据集导入时以包的 kind 覆盖） */
    config: { kind_by_first_import: true }
  }
];

/** 过程事件类型白名单（未知 type 返回 400） */
const AI_LAB_EVENT_TYPES = [
  /* v1 */
  'task.open',
  'predict.write',
  'dataset.add',
  'dataset.remove',
  'dataset.relabel',
  'split.lock',
  'train.run',
  'test.run',
  'error.view',
  'condition.design',
  'help.request',
  'model.compare',
  'reflection.write',
  'model_card.write',
  /* v2 */
  'preset.import',
  'dataset.mislabel',
  'dataset.restore',
  'rules.write',
  'data_card.write',
  'claim.write',
  'claim.verify',
  'claim.revise',
  /* v3 */
  'annotation.write',
  'agreement.compute',
  'fairness.view',
  'audio.play'
];

/** 训练引擎白名单（POST /projects/:id/models） */
const AI_LAB_ENGINES = ['image-knn', 'image-dense', 'table-tree', 'table-rules', 'table-mlp', 'audio-knn', 'text-nb'];

/** 数据集类型（与 ai_lab_datasets.kind 枚举一致） */
const AI_LAB_DATASET_KINDS = ['image', 'table', 'audio', 'text'];

/** 各类数据集默认引擎与默认特征提取器 */
const DEFAULT_ENGINE_BY_KIND = {
  image: 'image-knn',
  table: 'table-tree',
  audio: 'audio-knn',
  text: 'text-nb'
};
const DEFAULT_FEATURE_EXTRACTOR_BY_KIND = {
  image: 'mobilenet_v1_050_224',
  table: 'none',
  audio: 'speech_commands_18w',
  text: 'char-ngram'
};

/**
 * 按 key 取任务模板
 * @param {string} key
 * @returns {Object|null}
 */
function findTask(key) {
  return AI_LAB_TASKS.find(task => task.key === key) || null;
}

/**
 * 引擎对应的数据集类型：audio-* → audio，text-* → text，table-* → table，其余 → image
 */
function engineKind(engine) {
  if (typeof engine !== 'string') return 'image';
  if (engine.startsWith('audio-')) return 'audio';
  if (engine.startsWith('text-')) return 'text';
  if (engine.startsWith('table-')) return 'table';
  return 'image';
}

/** 数据集类型对应的默认引擎（未知类型按 image） */
function defaultEngineForKind(kind) {
  return DEFAULT_ENGINE_BY_KIND[kind] || DEFAULT_ENGINE_BY_KIND.image;
}

/** 数据集类型对应的默认特征提取器（未知类型按 image） */
function defaultFeatureExtractorForKind(kind) {
  return DEFAULT_FEATURE_EXTRACTOR_BY_KIND[kind] || DEFAULT_FEATURE_EXTRACTOR_BY_KIND.image;
}

module.exports = AI_LAB_TASKS;
module.exports.AI_LAB_TASKS = AI_LAB_TASKS;
module.exports.AI_LAB_EVENT_TYPES = AI_LAB_EVENT_TYPES;
module.exports.AI_LAB_ENGINES = AI_LAB_ENGINES;
module.exports.AI_LAB_DATASET_KINDS = AI_LAB_DATASET_KINDS;
module.exports.findTask = findTask;
module.exports.engineKind = engineKind;
module.exports.defaultEngineForKind = defaultEngineForKind;
module.exports.defaultFeatureExtractorForKind = defaultFeatureExtractorForKind;

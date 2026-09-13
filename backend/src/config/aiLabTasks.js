/**
 * AI训练专区任务模板（代码常量，不进表）
 *
 * 每个模板描述一节"真实数据 → 真实训练 → 三集制测试"的实验课：
 * - kind                   数据类型：image 图片 | table 表格 | text 文本（P7 资讯核验，不训练模型）
 * - engine                 训练引擎：image-knn | image-dense | table-tree | table-rules | verify（仅 text 任务）
 * - default_classes        创建项目时自动建的数据集类别（空数组表示由学生自定或由预置包导入）
 * - min_train_per_class    建议每类至少采集的训练样本数
 * - holdout_ratio          lock 时默认的留出比例
 * - suggested_shift_sets   建议的"换条件"测试集
 * - steps                  学习步骤顺序（前端按此渲染流程）
 * - abilities              对应的核心素养标签
 * - presets                推荐的预置数据包 key（见 backend/presets/ai-lab/<key>/manifest.json）
 * - config                 任务自由配置（如 mislabel_ratio、per_class_limits、max_depth_options）
 *
 * 另导出过程事件类型白名单 AI_LAB_EVENT_TYPES（POST /projects/:id/events 校验）
 * 与训练引擎白名单 AI_LAB_ENGINES（POST /projects/:id/models 校验）。
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
    config: {}
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
  'claim.revise'
];

/** 训练引擎白名单（POST /projects/:id/models） */
const AI_LAB_ENGINES = ['image-knn', 'image-dense', 'table-tree', 'table-rules'];

/** 数据集类型（与 ai_lab_datasets.kind 枚举一致；text 任务不建表格/图片数据） */
const AI_LAB_DATASET_KINDS = ['image', 'table'];

/**
 * 按 key 取任务模板
 * @param {string} key
 * @returns {Object|null}
 */
function findTask(key) {
  return AI_LAB_TASKS.find(task => task.key === key) || null;
}

/**
 * 引擎对应的数据集类型：table-* → table，其余 → image
 */
function engineKind(engine) {
  return typeof engine === 'string' && engine.startsWith('table-') ? 'table' : 'image';
}

module.exports = AI_LAB_TASKS;
module.exports.AI_LAB_TASKS = AI_LAB_TASKS;
module.exports.AI_LAB_EVENT_TYPES = AI_LAB_EVENT_TYPES;
module.exports.AI_LAB_ENGINES = AI_LAB_ENGINES;
module.exports.AI_LAB_DATASET_KINDS = AI_LAB_DATASET_KINDS;
module.exports.findTask = findTask;
module.exports.engineKind = engineKind;

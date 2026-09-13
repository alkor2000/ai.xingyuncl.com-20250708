/**
 * AI训练专区任务模板（代码常量，不进表）
 *
 * 每个模板描述一节"真实数据 → 真实训练 → 三集制测试"的实验课：
 * - default_classes        创建项目时自动建的数据集类别（free 为空，由学生自定）
 * - min_train_per_class    建议每类至少采集的训练样本数
 * - holdout_ratio          lock 时默认的留出比例
 * - suggested_shift_sets   建议的"换条件"测试集
 * - steps                  学习步骤顺序（前端按此渲染流程）
 * - abilities              对应的核心素养标签
 *
 * 另导出过程事件类型白名单 AI_LAB_EVENT_TYPES，供 POST /projects/:id/events 校验。
 */

const AI_LAB_TASKS = [
  {
    key: 'P1',
    version: '1',
    title: '模型认的是物体还是背景',
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
    suggested_shift_sets: [
      { key: 'bg', label: '换背景' },
      { key: 'angle', label: '换角度' },
      { key: 'light', label: '换光线' }
    ],
    steps: ['predict', 'collect', 'lock', 'train', 'test_holdout', 'test_shift', 'errors', 'iterate', 'model_card'],
    abilities: ['intent', 'critical']
  },
  {
    key: 'P2',
    version: '1',
    title: '换一个环境还能识别吗',
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
    suggested_shift_sets: [
      { key: 'bg', label: '换背景' },
      { key: 'angle', label: '换角度' },
      { key: 'light', label: '换光线' }
    ],
    steps: ['predict', 'collect', 'condition_design', 'lock', 'train', 'test_holdout', 'test_shift', 'errors', 'iterate', 'model_card'],
    abilities: ['critical', 'iterate']
  },
  {
    key: 'free',
    version: '1',
    title: '自由实验',
    grade_band: 'all',
    engine: 'image-knn',
    hours: 1,
    default_classes: [],
    min_train_per_class: 10,
    holdout_ratio: 0.2,
    suggested_shift_sets: [
      { key: 'bg', label: '换背景' },
      { key: 'angle', label: '换角度' },
      { key: 'light', label: '换光线' }
    ],
    steps: ['collect', 'lock', 'train', 'test_holdout', 'test_shift', 'errors', 'iterate', 'model_card'],
    abilities: ['intent', 'critical', 'iterate']
  }
];

/** 过程事件类型白名单（未知 type 返回 400） */
const AI_LAB_EVENT_TYPES = [
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
  'model_card.write'
];

/** 训练引擎白名单 */
const AI_LAB_ENGINES = ['image-knn', 'image-dense'];

/**
 * 按 key 取任务模板
 * @param {string} key
 * @returns {Object|null}
 */
function findTask(key) {
  return AI_LAB_TASKS.find(task => task.key === key) || null;
}

module.exports = AI_LAB_TASKS;
module.exports.AI_LAB_TASKS = AI_LAB_TASKS;
module.exports.AI_LAB_EVENT_TYPES = AI_LAB_EVENT_TYPES;
module.exports.AI_LAB_ENGINES = AI_LAB_ENGINES;
module.exports.findTask = findTask;

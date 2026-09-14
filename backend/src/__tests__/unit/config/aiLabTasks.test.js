/**
 * aiLabTasks - 任务模板 / 引擎 / 数据集类型配置单元测试
 *
 * 测试范围：
 * - engineKind：audio-* → audio、text-* → text、table-* → table、其余（含非字符串）→ image
 * - 引擎白名单含 v3 的 audio-knn / text-nb / table-mlp，且每个引擎的 kind 都在 AI_LAB_DATASET_KINDS 内
 * - 各 kind 的默认引擎与默认特征提取器
 * - 模板顺序 L1..free、17 个模板、每个模板的 engine（verify 除外）与 kind 一致、事件白名单含 v3 四种
 *
 * Mock策略：纯常量模块，无外部依赖
 */

const {
  AI_LAB_TASKS, AI_LAB_ENGINES, AI_LAB_DATASET_KINDS, AI_LAB_EVENT_TYPES,
  findTask, engineKind, defaultEngineForKind, defaultFeatureExtractorForKind
} = require('../../../config/aiLabTasks');

describe('aiLabTasks - engineKind', () => {
  test('四类引擎映射到四种数据集类型', () => {
    expect(engineKind('image-knn')).toBe('image');
    expect(engineKind('image-dense')).toBe('image');
    expect(engineKind('table-tree')).toBe('table');
    expect(engineKind('table-rules')).toBe('table');
    expect(engineKind('table-mlp')).toBe('table');
    expect(engineKind('audio-knn')).toBe('audio');
    expect(engineKind('text-nb')).toBe('text');
  });

  test('未知 / 非字符串引擎按 image', () => {
    expect(engineKind('verify')).toBe('image');
    expect(engineKind('')).toBe('image');
    expect(engineKind(null)).toBe('image');
    expect(engineKind(undefined)).toBe('image');
    expect(engineKind(42)).toBe('image');
  });

  test('白名单内每个引擎的 kind 都是合法数据集类型', () => {
    expect(AI_LAB_ENGINES).toEqual(expect.arrayContaining(['audio-knn', 'text-nb', 'table-mlp']));
    AI_LAB_ENGINES.forEach(engine => {
      expect(AI_LAB_DATASET_KINDS).toContain(engineKind(engine));
    });
    expect(AI_LAB_DATASET_KINDS).toEqual(['image', 'table', 'audio', 'text']);
  });
});

describe('aiLabTasks - 默认引擎与特征提取器', () => {
  test('按 kind 给默认值，未知 kind 回落到 image', () => {
    expect(defaultEngineForKind('image')).toBe('image-knn');
    expect(defaultEngineForKind('table')).toBe('table-tree');
    expect(defaultEngineForKind('audio')).toBe('audio-knn');
    expect(defaultEngineForKind('text')).toBe('text-nb');
    expect(defaultEngineForKind('video')).toBe('image-knn');
    expect(defaultFeatureExtractorForKind('image')).toBe('mobilenet_v1_050_224');
    expect(defaultFeatureExtractorForKind('table')).toBe('none');
    expect(defaultFeatureExtractorForKind('audio')).toBe('speech_commands_18w');
    expect(defaultFeatureExtractorForKind('text')).toBe('char-ngram');
  });

  test('默认引擎与其 kind 自洽且在白名单内', () => {
    AI_LAB_DATASET_KINDS.forEach(kind => {
      const engine = defaultEngineForKind(kind);
      expect(AI_LAB_ENGINES).toContain(engine);
      expect(engineKind(engine)).toBe(kind);
    });
  });
});

describe('aiLabTasks - 模板', () => {
  test('顺序与数量', () => {
    expect(AI_LAB_TASKS.map(task => task.key)).toEqual([
      'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'M1', 'M2', 'M3', 'M4', 'M5', 'P1', 'P2', 'P3', 'P6', 'P7', 'free'
    ]);
  });

  test('训练类模板的 engine 与 kind 一致；核验类模板 engine=verify 且 kind=text', () => {
    AI_LAB_TASKS.forEach(task => {
      expect(AI_LAB_DATASET_KINDS).toContain(task.kind);
      if (task.engine === 'verify') {
        expect(task.kind).toBe('text');
        expect(task.holdout_ratio).toBeNull();
      } else {
        expect(AI_LAB_ENGINES).toContain(task.engine);
        expect(engineKind(task.engine)).toBe(task.kind);
      }
      expect(Array.isArray(task.steps) && task.steps.length > 0).toBe(true);
      expect(Array.isArray(task.presets)).toBe(true);
      expect(task.config && typeof task.config === 'object').toBe(true);
    });
  });

  test('v3 新模板关键字段', () => {
    expect(findTask('L2')).toMatchObject({ kind: 'audio', engine: 'audio-knn', grade_band: 'L', hours: 1, min_train_per_class: 10, presets: ['sounds-synth'] });
    expect(findTask('L2').default_classes.map(c => c.key)).toEqual(['clap', 'knock', 'whistle']);
    expect(findTask('P6').default_classes).toHaveLength(5);
    expect(findTask('P6').suggested_shift_sets.map(s => s.key)).toEqual(['place', 'noise']);
    expect(findTask('M4').default_classes).toHaveLength(10);
    expect(findTask('M5')).toMatchObject({ kind: 'text', engine: 'text-nb', min_train_per_class: 30, presets: ['campus-messages'] });
    expect(findTask('M5').steps).toEqual(expect.arrayContaining(['annotate', 'agreement']));
    expect(findTask('M3').config).toEqual({ max_depth_options: [1, 2, 3, 4, 6], mlp: { hidden: 16, epochs: 80 } });
    expect(findTask('M3').steps).toContain('train_mlp');
    expect(findTask('L5')).toMatchObject({ kind: 'text', engine: 'verify', config: { material_set: 'animal', projected_default: true } });
    expect(findTask('L6')).toMatchObject({ kind: 'table', engine: 'table-rules', config: { max_depth_options: [1, 2, 3] }, presets: ['animal-cards', 'garbage-cards'] });
    expect(findTask('M2')).toMatchObject({ kind: 'image', engine: 'image-knn', min_train_per_class: 20, config: { subgroup_tag: 'collector' } });
    expect(findTask('M2').steps).toContain('fairness');
    expect(findTask('P7').config).toEqual({ material_set: 'campus' });
    expect(findTask('nope')).toBeNull();
  });

  test('事件白名单含 v3 四种且无重复', () => {
    expect(AI_LAB_EVENT_TYPES).toEqual(expect.arrayContaining(['annotation.write', 'agreement.compute', 'fairness.view', 'audio.play']));
    expect(new Set(AI_LAB_EVENT_TYPES).size).toBe(AI_LAB_EVENT_TYPES.length);
  });
});

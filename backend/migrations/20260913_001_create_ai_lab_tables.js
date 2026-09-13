/**
 * 数据库迁移：创建 AI训练专区（ai-lab）六张表并登记系统模块
 *
 * 用途：中小学"真实数据、真实训练、三集制测试"的 AI 实验区
 *
 * 表：
 * 1. ai_lab_projects     - 实验项目（所有者、任务模板、参与方式、summary 缓存）
 * 2. ai_lab_datasets     - 数据集（类别定义、版本号、留出比例/seed、样本计数）
 * 3. ai_lab_samples      - 图片样本（train/holdout/shift 三集，软删除按版本追溯）
 * 4. ai_lab_models       - 模型版本（同一项目内递增，artifact 落盘、metrics/model_card）
 * 5. ai_lab_evaluations  - 评测记录（holdout 或某个 shift 条件集的指标与错误样本）
 * 6. ai_lab_events       - 过程事件流（学习行为白名单事件）
 *
 * 另在 system_modules 插入 ai_lab 模块记录（sort_order = image_generation + 1，查不到则 60）
 *
 * 创建时间：2026-09-13
 * 幂等性：所有建表前 hasTable 判断，模块记录按 name 判断
 */

exports.up = async function(knex) {

  /* ================================================================
   * 1. ai_lab_projects 实验项目
   * ================================================================ */
  if (!(await knex.schema.hasTable('ai_lab_projects'))) {
    await knex.schema.createTable('ai_lab_projects', (table) => {
      table.bigIncrements('id').primary();
      table.bigInteger('user_id').unsigned().notNullable().comment('所有者用户ID');
      table.bigInteger('group_id').unsigned().nullable().comment('创建时从用户组快照');
      table.string('title', 200).notNullable().comment('项目标题');
      table.string('task_key', 20).notNullable().defaultTo('free').comment('任务模板：P1 | P2 | free');
      table.string('task_version', 20).notNullable().defaultTo('1').comment('任务模板版本');
      table.enum('participation_mode', ['individual', 'group', 'projected']).notNullable().defaultTo('individual').comment('参与方式');
      table.enum('status', ['active', 'archived']).notNullable().defaultTo('active').comment('项目状态');
      table.json('context').nullable().comment('{lesson_id, assignment_id, source}');
      table.json('summary').nullable().comment('缓存：{sample_count, model_count, best_holdout_accuracy, best_shift_accuracy, generalization_gap}');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));

      table.index(['user_id', 'status'], 'idx_ai_lab_projects_user_status');
      table.index(['group_id', 'status'], 'idx_ai_lab_projects_group_status');
    });
    console.log('ai_lab_projects 表创建成功');
  } else {
    console.log('ai_lab_projects 表已存在，跳过创建');
  }

  /* ================================================================
   * 2. ai_lab_datasets 数据集（不建外键约束，逻辑关联 project）
   * ================================================================ */
  if (!(await knex.schema.hasTable('ai_lab_datasets'))) {
    await knex.schema.createTable('ai_lab_datasets', (table) => {
      table.bigIncrements('id').primary();
      table.bigInteger('project_id').notNullable().comment('所属项目ID（逻辑关联）');
      table.bigInteger('user_id').unsigned().notNullable().comment('所有者用户ID');
      table.string('name', 200).notNullable().comment('数据集名称');
      table.json('classes').notNullable().comment('[{key, label}]，key 只允许 [a-z0-9_-]{1,32} 且唯一');
      table.integer('version').notNullable().defaultTo(0).comment('每次 lock 递增');
      table.decimal('holdout_ratio', 4, 2).nullable().comment('最近一次 lock 的留出比例');
      table.integer('seed').nullable().comment('最近一次 lock 的随机种子');
      table.timestamp('locked_at').nullable().comment('最近一次 lock 时间');
      table.integer('sample_count').notNullable().defaultTo(0).comment('未删除样本数（写时维护）');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));

      table.index(['project_id'], 'idx_ai_lab_datasets_project');
    });
    console.log('ai_lab_datasets 表创建成功');
  } else {
    console.log('ai_lab_datasets 表已存在，跳过创建');
  }

  /* ================================================================
   * 3. ai_lab_samples 图片样本
   *
   * 软删除：removed_version 记删除时的 dataset.version，查询按 IS NULL 过滤
   * ================================================================ */
  if (!(await knex.schema.hasTable('ai_lab_samples'))) {
    await knex.schema.createTable('ai_lab_samples', (table) => {
      table.bigIncrements('id').primary();
      table.bigInteger('dataset_id').notNullable().comment('所属数据集ID');
      table.bigInteger('user_id').unsigned().notNullable().comment('采集者用户ID');
      table.string('class_key', 32).notNullable().comment('类别 key');
      table.enum('split', ['train', 'holdout', 'shift']).notNullable().defaultTo('train').comment('所属集合');
      table.string('shift_set', 50).nullable().comment("split='shift' 时的条件名，如 bg-window");
      table.json('condition_tags').nullable().comment('自由键值条件标签，字符串值 ≤50 字');
      table.enum('source', ['camera', 'upload', 'preset', 'other_group']).notNullable().defaultTo('camera').comment('样本来源');
      table.string('file_path', 500).notNullable().comment('相对 storage/uploads 的路径 ai-lab/<user_id>/<dataset_id>/<file>.jpg');
      table.integer('width').nullable();
      table.integer('height').nullable();
      table.integer('file_size').nullable();
      table.integer('added_version').notNullable().defaultTo(0).comment('加入时的 dataset.version');
      table.integer('removed_version').nullable().comment('软删除时的 dataset.version，NULL 表示未删除');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

      table.index(['dataset_id', 'split', 'class_key'], 'idx_ai_lab_samples_ds_split_class');
      table.index(['dataset_id', 'removed_version'], 'idx_ai_lab_samples_ds_removed');
    });
    console.log('ai_lab_samples 表创建成功');
  } else {
    console.log('ai_lab_samples 表已存在，跳过创建');
  }

  /* ================================================================
   * 4. ai_lab_models 模型版本
   * ================================================================ */
  if (!(await knex.schema.hasTable('ai_lab_models'))) {
    await knex.schema.createTable('ai_lab_models', (table) => {
      table.bigIncrements('id').primary();
      table.bigInteger('project_id').notNullable().comment('所属项目ID');
      table.bigInteger('dataset_id').notNullable().comment('训练所用数据集ID');
      table.bigInteger('user_id').unsigned().notNullable().comment('训练者用户ID');
      table.integer('version').notNullable().comment('同一项目内从 1 递增，服务端分配');
      table.integer('dataset_version').notNullable().comment('训练时的 dataset.version');
      table.string('engine', 30).notNullable().comment('image-knn | image-dense');
      table.string('feature_extractor', 60).notNullable().defaultTo('mobilenet_v1_050_224').comment('特征提取器');
      table.json('params').nullable().comment('{k:5, metric:"cosine"} 等');
      table.json('class_keys').notNullable().comment('训练类别 key 列表');
      table.integer('train_sample_count').notNullable().defaultTo(0);
      table.string('artifact_path', 500).nullable().comment('相对 storage/uploads：ai-lab/<user_id>/<project_id>/models/v<version>.json');
      table.json('metrics').nullable().comment('{holdout:{...}, shift:{"<set>":{...}}, generalization_gap}');
      table.json('model_card').nullable().comment('{scope, not_scope, evidence, notes}');
      table.string('note', 500).nullable().comment('学生写的"这一版改了什么"');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));

      table.unique(['project_id', 'version'], 'uk_ai_lab_models_project_version');
    });
    console.log('ai_lab_models 表创建成功');
  } else {
    console.log('ai_lab_models 表已存在，跳过创建');
  }

  /* ================================================================
   * 5. ai_lab_evaluations 评测记录
   * ================================================================ */
  if (!(await knex.schema.hasTable('ai_lab_evaluations'))) {
    await knex.schema.createTable('ai_lab_evaluations', (table) => {
      table.bigIncrements('id').primary();
      table.bigInteger('model_id').notNullable().comment('模型ID');
      table.bigInteger('user_id').unsigned().notNullable().comment('评测者用户ID');
      table.enum('split', ['holdout', 'shift']).notNullable().comment('评测集合');
      table.string('shift_set', 50).nullable().comment("split='shift' 时的条件名");
      table.integer('sample_count').notNullable().comment('评测样本数');
      table.json('metrics').notNullable().comment('{accuracy, per_class, confusion}');
      table.json('errors').nullable().comment('[{sample_id, actual, predicted, confidence}] 最多 200 条');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

      table.index(['model_id'], 'idx_ai_lab_evaluations_model');
    });
    console.log('ai_lab_evaluations 表创建成功');
  } else {
    console.log('ai_lab_evaluations 表已存在，跳过创建');
  }

  /* ================================================================
   * 6. ai_lab_events 过程事件
   * ================================================================ */
  if (!(await knex.schema.hasTable('ai_lab_events'))) {
    await knex.schema.createTable('ai_lab_events', (table) => {
      table.bigIncrements('id').primary();
      table.bigInteger('project_id').notNullable().comment('项目ID');
      table.bigInteger('user_id').unsigned().notNullable().comment('用户ID');
      table.string('type', 40).notNullable().comment('事件类型（白名单见 config/aiLabTasks.js）');
      table.json('payload').nullable().comment('事件负载，≤ 8KB');
      table.datetime('client_ts').nullable().comment('客户端时间');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

      table.index(['project_id', 'id'], 'idx_ai_lab_events_project_id');
    });
    console.log('ai_lab_events 表创建成功');
  } else {
    console.log('ai_lab_events 表已存在，跳过创建');
  }

  /* ================================================================
   * 7. system_modules 登记 ai_lab 模块（按 name 幂等）
   * ================================================================ */
  const existing = await knex('system_modules').where('name', 'ai_lab').first();
  if (!existing) {
    const imageModule = await knex('system_modules').where('name', 'image_generation').first();
    const sortOrder = imageModule && Number.isInteger(imageModule.sort_order)
      ? imageModule.sort_order + 1
      : 60;

    await knex('system_modules').insert({
      name: 'ai_lab',
      display_name: 'AI训练专区-AI Lab',
      description: '真实数据、真实训练、三集制测试的中小学 AI 实验区',
      module_type: 'frontend',
      module_category: 'system',
      route_path: '/ai-lab',
      proxy_path: '/ai-lab',
      open_mode: 'iframe',
      menu_icon: 'ExperimentOutlined',
      auth_mode: 'jwt',
      is_active: 1,
      can_disable: 1,
      sort_order: sortOrder,
      allowed_groups: null,
      config: null
    });
    console.log(`system_modules ai_lab 模块记录插入成功（sort_order=${sortOrder}）`);
  } else {
    console.log('system_modules ai_lab 模块记录已存在，跳过插入');
  }

  console.log('===== AI训练专区数据库迁移全部完成 =====');
};

exports.down = async function(knex) {
  await knex('system_modules').where('name', 'ai_lab').del();
  await knex.schema.dropTableIfExists('ai_lab_events');
  await knex.schema.dropTableIfExists('ai_lab_evaluations');
  await knex.schema.dropTableIfExists('ai_lab_models');
  await knex.schema.dropTableIfExists('ai_lab_samples');
  await knex.schema.dropTableIfExists('ai_lab_datasets');
  await knex.schema.dropTableIfExists('ai_lab_projects');
};

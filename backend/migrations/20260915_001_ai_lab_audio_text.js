/**
 * 数据库迁移：AI训练专区第三批 —— 音频 / 文本数据集支持
 *
 * 变更：
 * 1. ai_lab_datasets.kind  ENUM('image','table') → ENUM('image','table','audio','text')，默认仍 'image'
 * 2. ai_lab_samples.duration_ms  INT NULL  音频样本时长（毫秒）
 *
 * down：删除 duration_ms；kind 不缩回（已有 audio/text 行会导致 ALTER 失败或数据被截断）
 *
 * 创建时间：2026-09-15
 * 幂等性：kind 先查 information_schema.COLUMNS 的 COLUMN_TYPE 是否已含 audio；duration_ms 用 hasColumn 判断
 */

const KIND_ENUM_SQL = "ENUM('image','table','audio','text') NOT NULL DEFAULT 'image' "
  + "COMMENT '数据集类型：image 图片 | table 表格 | audio 音频 | text 文本'";

exports.up = async function(knex) {

  /* ================================================================
   * 1. ai_lab_datasets.kind 枚举扩展
   * ================================================================ */
  const [kindRows] = await knex.raw(
    `SELECT COLUMN_TYPE AS column_type FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_lab_datasets' AND COLUMN_NAME = 'kind'`
  );
  if (!Array.isArray(kindRows) || kindRows.length === 0) {
    throw new Error('ai_lab_datasets.kind 列不存在，请先执行 20260914_001_ai_lab_tabular_presets');
  }
  const columnType = String(kindRows[0].column_type || '').toLowerCase();
  if (columnType.includes("'audio'") && columnType.includes("'text'")) {
    console.log('ai_lab_datasets.kind 已包含 audio/text，跳过');
  } else {
    await knex.raw(`ALTER TABLE ai_lab_datasets MODIFY COLUMN kind ${KIND_ENUM_SQL}`);
    console.log('ai_lab_datasets.kind 已扩展为 image/table/audio/text');
  }

  /* ================================================================
   * 2. ai_lab_samples.duration_ms
   * ================================================================ */
  if (!(await knex.schema.hasColumn('ai_lab_samples', 'duration_ms'))) {
    await knex.schema.alterTable('ai_lab_samples', (table) => {
      table.integer('duration_ms').nullable().after('file_size')
        .comment('音频样本时长（毫秒），非音频样本为 NULL');
    });
    console.log('ai_lab_samples.duration_ms 列添加成功');
  } else {
    console.log('ai_lab_samples.duration_ms 列已存在，跳过');
  }

  console.log('===== AI训练专区音频/文本迁移完成 =====');
};

exports.down = async function(knex) {
  if (await knex.schema.hasColumn('ai_lab_samples', 'duration_ms')) {
    await knex.schema.alterTable('ai_lab_samples', (table) => {
      table.dropColumn('duration_ms');
    });
    console.log('ai_lab_samples.duration_ms 列已删除');
  }
  /* kind 枚举不缩回：已有 audio/text 数据集会让 ALTER 失败或被截断 */
  console.log('ai_lab_datasets.kind 枚举保持不变（不缩回）');
};

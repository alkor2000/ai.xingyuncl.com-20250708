/**
 * 数据库迁移：AI训练专区第二批 —— 表格数据集与预置数据包支持
 *
 * 变更：
 * 1. ai_lab_datasets
 *    - kind    ENUM('image','table') NOT NULL DEFAULT 'image'   数据集类型
 *    - columns JSON NULL                                        表格特征列定义 [{key,label,type,unit?}]
 * 2. ai_lab_samples
 *    - file_path 改为允许 NULL（表格行样本没有文件）
 *    - payload            JSON NULL          表格行的特征值 {col_key: value}
 *    - original_class_key VARCHAR(32) NULL   被"混入错标"改过的样本记录原类别
 *    - origin_ref         VARCHAR(200) NULL  预置包来源 <pack_key>:<包内相对路径>
 *
 * down：去掉新列；file_path 不改回 NOT NULL，避免已有表格样本导致数据丢失
 *
 * 创建时间：2026-09-14
 * 幂等性：每列 hasColumn 判断；file_path 的可空性查 information_schema
 */

exports.up = async function(knex) {

  /* ================================================================
   * 1. ai_lab_datasets：kind / columns
   * ================================================================ */
  if (!(await knex.schema.hasColumn('ai_lab_datasets', 'kind'))) {
    await knex.schema.alterTable('ai_lab_datasets', (table) => {
      table.enum('kind', ['image', 'table']).notNullable().defaultTo('image').after('name')
        .comment('数据集类型：image 图片 | table 表格');
    });
    console.log('ai_lab_datasets.kind 列添加成功');
  } else {
    console.log('ai_lab_datasets.kind 列已存在，跳过');
  }

  if (!(await knex.schema.hasColumn('ai_lab_datasets', 'columns'))) {
    await knex.schema.alterTable('ai_lab_datasets', (table) => {
      table.json('columns').nullable().after('classes')
        .comment("表格特征列定义 [{key,label,type:'number'|'category',unit?}]");
    });
    console.log('ai_lab_datasets.columns 列添加成功');
  } else {
    console.log('ai_lab_datasets.columns 列已存在，跳过');
  }

  /* ================================================================
   * 2. ai_lab_samples：file_path 可空 / payload / original_class_key / origin_ref
   * ================================================================ */
  const [nullableRows] = await knex.raw(
    `SELECT IS_NULLABLE AS is_nullable FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_lab_samples' AND COLUMN_NAME = 'file_path'`
  );
  const filePathNullable = Array.isArray(nullableRows) && nullableRows.length > 0
    && String(nullableRows[0].is_nullable).toUpperCase() === 'YES';
  if (!filePathNullable) {
    await knex.schema.alterTable('ai_lab_samples', (table) => {
      table.string('file_path', 500).nullable()
        .comment('相对 storage/uploads 的路径 ai-lab/<user_id>/<dataset_id>/<file>.jpg；表格行样本为 NULL')
        .alter();
    });
    console.log('ai_lab_samples.file_path 已改为允许 NULL');
  } else {
    console.log('ai_lab_samples.file_path 已允许 NULL，跳过');
  }

  if (!(await knex.schema.hasColumn('ai_lab_samples', 'payload'))) {
    await knex.schema.alterTable('ai_lab_samples', (table) => {
      table.json('payload').nullable().after('file_size')
        .comment('表格行的特征值 {col_key: value}');
    });
    console.log('ai_lab_samples.payload 列添加成功');
  } else {
    console.log('ai_lab_samples.payload 列已存在，跳过');
  }

  if (!(await knex.schema.hasColumn('ai_lab_samples', 'original_class_key'))) {
    await knex.schema.alterTable('ai_lab_samples', (table) => {
      table.string('original_class_key', 32).nullable().after('class_key')
        .comment('被"混入错标"改过的样本记录原类别，NULL 表示标签未被改动');
    });
    console.log('ai_lab_samples.original_class_key 列添加成功');
  } else {
    console.log('ai_lab_samples.original_class_key 列已存在，跳过');
  }

  if (!(await knex.schema.hasColumn('ai_lab_samples', 'origin_ref'))) {
    await knex.schema.alterTable('ai_lab_samples', (table) => {
      table.string('origin_ref', 200).nullable().after('source')
        .comment('预置包来源 <pack_key>:<包内相对路径>');
    });
    console.log('ai_lab_samples.origin_ref 列添加成功');
  } else {
    console.log('ai_lab_samples.origin_ref 列已存在，跳过');
  }

  console.log('===== AI训练专区表格/预置包迁移完成 =====');
};

exports.down = async function(knex) {
  for (const column of ['origin_ref', 'original_class_key', 'payload']) {
    if (await knex.schema.hasColumn('ai_lab_samples', column)) {
      await knex.schema.alterTable('ai_lab_samples', (table) => {
        table.dropColumn(column);
      });
    }
  }
  for (const column of ['columns', 'kind']) {
    if (await knex.schema.hasColumn('ai_lab_datasets', column)) {
      await knex.schema.alterTable('ai_lab_datasets', (table) => {
        table.dropColumn(column);
      });
    }
  }
  /* file_path 保持可空，避免已有表格样本（file_path 为 NULL）导致回滚失败或数据丢失 */
};

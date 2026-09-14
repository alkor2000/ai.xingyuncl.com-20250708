/**
 * 数据库迁移：user_mindmaps.content_type（思维导图内容类型 markdown / mermaid / svg）
 *
 * 为什么有这个文件：ai.pkuailab.com 的 knex_migrations 里早已记录同名迁移（2026-09-01，列已存在），
 * 但文件没有进入仓库；knex 发现"已执行的迁移文件缺失"会拒绝运行后续迁移。
 * 本文件按已生效的列定义补齐，幂等：列存在则跳过（ai.xingyuncl.com 亦已有该列）。
 *
 * 影响：user_mindmaps 加一列（缺失时），行数据不动。
 * 可重复执行：是。down 不删列（避免丢内容类型信息）。
 */

exports.up = async function(knex) {
  if (await knex.schema.hasColumn('user_mindmaps', 'content_type')) {
    console.log('user_mindmaps.content_type 已存在，跳过');
    return;
  }
  await knex.schema.alterTable('user_mindmaps', (table) => {
    table.enum('content_type', ['markdown', 'mermaid', 'svg']).nullable().defaultTo('markdown').after('content')
      .comment('思维导图内容类型：markdown | mermaid | svg');
  });
  console.log('user_mindmaps.content_type 列添加成功');
};

exports.down = async function() {
  console.log('user_mindmaps.content_type 不回退（保留已有数据）');
};

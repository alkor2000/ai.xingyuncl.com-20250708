/**
 * 数据库迁移：公文模板（doc_templates）
 *
 * 用途：老师上传一份自己单位的 Word 样板，系统保留它的页面设置 / 页眉页脚 / 样式，
 * 老师给样板的段落贴角色（固定 / 标题 / 主送机关 / 正文 / 落款 / 日期…），之后
 * AI 写的公文或老师自己的草稿按角色套进去，生成同样版式的 .docx（"样例即模板"）。
 *
 * 表：doc_templates
 * - user_id / group_id      所有者与创建时的用户组快照（scope=group 时同组可用）
 * - name / description      模板名与说明
 * - file_path / file_size   样板 .docx 落盘相对路径（storage/uploads/doc-templates/<uuid>.docx，文件名不可猜）
 * - original_filename       上传时的文件名
 * - block_count             样板正文顶层块（段落 / 表格）数量，角色按块序号对应
 * - roles                   JSON [{index, role}]  角色见 services/docTemplate/DocTemplateService.js ROLES
 * - summary                 JSON 解析摘要：页面尺寸/边距、页眉页脚文字、各角色的字体字号（只用于展示）
 * - scope                   private | group
 * - use_count / last_used_at 使用统计
 *
 * 创建时间：2026-09-16
 * 幂等性：hasTable 判断
 */
exports.up = async function(knex) {
  if (await knex.schema.hasTable('doc_templates')) {
    console.log('doc_templates 表已存在，跳过创建');
    return;
  }
  await knex.schema.createTable('doc_templates', (table) => {
    table.bigIncrements('id').primary();
    table.string('uuid', 36).notNullable().unique().comment('对外标识');
    table.bigInteger('user_id').unsigned().notNullable().comment('所有者用户ID');
    table.bigInteger('group_id').unsigned().nullable().comment('创建时从用户组快照');
    table.string('name', 100).notNullable().comment('模板名');
    table.string('description', 500).nullable().comment('说明');
    table.string('file_path', 255).notNullable().comment('样板 .docx 相对 uploads 目录的路径');
    table.integer('file_size').unsigned().notNullable().defaultTo(0).comment('字节数');
    table.string('original_filename', 255).nullable().comment('上传时的文件名');
    table.integer('block_count').unsigned().notNullable().defaultTo(0).comment('样板正文顶层块数');
    table.json('roles').nullable().comment('[{index, role}]');
    table.json('summary').nullable().comment('解析摘要：页面/页眉页脚/各角色字体');
    table.enum('scope', ['private', 'group']).notNullable().defaultTo('private').comment('可见范围');
    table.integer('use_count').unsigned().notNullable().defaultTo(0).comment('生成次数');
    table.timestamp('last_used_at').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    table.index(['user_id'], 'idx_doc_templates_user');
    table.index(['group_id', 'scope'], 'idx_doc_templates_group_scope');
  });
  console.log('doc_templates 表创建成功');
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('doc_templates');
};

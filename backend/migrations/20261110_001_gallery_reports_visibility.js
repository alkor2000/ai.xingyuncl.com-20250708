/** Add scoped gallery takedown/restoration reasons and video report parity.
 * Existing works are neither hidden, approved nor deleted by this migration.
 * DDL guards permit retry after partial MySQL DDL; reports/audit are retained on rollback.
 */
exports.up = async knex => {
  for (const table of ['image_safety', 'video_safety']) {
    if (!await knex.schema.hasColumn(table, 'gallery_reason')) await knex.schema.alterTable(table, t => t.string('gallery_reason', 500).nullable());
  }
  if (!await knex.schema.hasColumn('image_safety_reports', 'category')) await knex.schema.alterTable('image_safety_reports', t => t.string('category', 32).notNullable().defaultTo('other'));
  if (!await knex.schema.hasColumn('image_safety_reports', 'resolved_at')) await knex.schema.alterTable('image_safety_reports', t => t.timestamp('resolved_at').nullable());
  if (!await knex.schema.hasTable('video_safety_reports')) await knex.schema.createTable('video_safety_reports', t => {
    t.bigIncrements('id');
    t.bigInteger('generation_id').unsigned().notNullable();
    t.bigInteger('user_id').unsigned().notNullable();
    t.string('category', 32).notNullable();
    t.string('reason', 500).notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('resolved_at').nullable();
    t.unique(['generation_id', 'user_id']);
  });
};
exports.down = async () => { throw Error('Keep gallery reports and audit when rolling back application code.'); };

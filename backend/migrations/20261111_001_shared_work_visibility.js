/** Existing mindmaps may already have a legacy link: retain it, behind authentication.
 * New maps explicitly start as draft. No content, balance or existing URL is deleted.
 */
exports.up = async knex => {
  if (!await knex.schema.hasColumn('user_mindmaps', 'share_state')) await knex.schema.alterTable('user_mindmaps', t => {
    t.enum('share_state', ['draft', 'published', 'withdrawn']).notNullable().defaultTo('published');
    t.integer('share_revision').unsigned().notNullable().defaultTo(0);
  });
  if (!await knex.schema.hasTable('shared_work_reports')) await knex.schema.createTable('shared_work_reports', t => {
    t.bigIncrements('id'); t.enum('work_type', ['html', 'mindmap']).notNullable();
    t.bigInteger('work_id').unsigned().notNullable(); t.bigInteger('user_id').unsigned().notNullable();
    t.string('reason', 500).notNullable(); t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('resolved_at').nullable(); t.unique(['work_type', 'work_id', 'user_id']);
  });
  if (!await knex.schema.hasTable('shared_work_events')) await knex.schema.createTable('shared_work_events', t => {
    t.bigIncrements('id'); t.enum('work_type', ['html', 'mindmap']).notNullable();
    t.bigInteger('work_id').unsigned().notNullable(); t.bigInteger('actor_id').unsigned().notNullable();
    t.string('action', 32).notNullable(); t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['work_type', 'work_id']);
  });
};
exports.down = async knex => {
  // Only an unused installation can be undone. Never erase moderation history or revive links.
  for (const table of ['shared_work_events', 'shared_work_reports']) {
    if (await knex.schema.hasTable(table) && Number((await knex(table).count('* as n'))[0].n)) throw Error('Shared-work activity exists: retain schema and audit; do not downgrade to anonymous access.');
  }
  if (await knex.schema.hasColumn('user_mindmaps', 'share_state') && await knex('user_mindmaps').whereNot('share_state', 'published').first()) throw Error('Private/withdrawn maps exist: rollback would revive links.');
  await knex.schema.dropTableIfExists('shared_work_events');
  await knex.schema.dropTableIfExists('shared_work_reports');
  if (await knex.schema.hasColumn('user_mindmaps', 'share_state')) await knex.schema.alterTable('user_mindmaps', t => { t.dropColumn('share_state'); t.dropColumn('share_revision'); });
};

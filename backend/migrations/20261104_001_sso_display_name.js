/** Presentation only: existing identity and unique username keys are unchanged. */
exports.up = async function(knex) {
  if (!(await knex.schema.hasColumn('users', 'sso_display_name'))) {
    await knex.schema.alterTable('users', table => table.string('sso_display_name', 100).nullable());
  }
  if (!(await knex.schema.hasColumn('users', 'sso_display_name_locked'))) {
    await knex.schema.alterTable('users', table => table.boolean('sso_display_name_locked').notNullable().defaultTo(false));
  }
};
// Preserve names on rollback; old application code ignores these additive columns.
exports.down = async function() {};

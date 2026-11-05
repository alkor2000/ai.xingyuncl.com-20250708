/** Image safety is deny-by-default for existing and new images. Additive only;
 * no existing image is approved or deleted. Audit survives user deletion.
 * Knex records execution; down deliberately refuses to remove safety decisions. */
exports.up = async knex => {
  await knex.schema.createTable('image_safety_references', t => {
    t.string('id', 36).primary();
    t.bigInteger('user_id').unsigned().notNullable().index();
    t.string('sha256', 64).notNullable();
    t.string('file_key', 128).notNullable();
    t.timestamp('expires_at').notNullable();
  });
  await knex.schema.createTable('image_safety', t => {
    t.bigInteger('generation_id').unsigned().primary();
    t.string('state', 16).notNullable().defaultTo('pending');
    t.string('sha256', 64).nullable().index();
    t.string('file_key', 128).nullable();
    t.string('reason', 80).notNullable().defaultTo('awaiting_review');
    t.integer('revision').unsigned().notNullable().defaultTo(0);
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.index(['state', 'generation_id']);
  });
  await knex.schema.createTable('image_safety_events', t => {
    t.bigIncrements('id');
    t.bigInteger('generation_id').unsigned().nullable().index();
    t.bigInteger('actor_id').unsigned().nullable();
    t.string('action', 40).notNullable();
    t.string('state', 16).notNullable();
    t.string('reason', 500).notNullable();
    t.string('sha256', 64).nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('image_safety_restrictions', t => {
    t.bigInteger('user_id').unsigned().primary();
    t.boolean('restricted').notNullable().defaultTo(true);
    t.string('reason', 500).notNullable();
    t.bigInteger('actor_id').unsigned().notNullable();
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('image_safety_reports', t => {
    t.bigIncrements('id');
    t.bigInteger('generation_id').unsigned().notNullable();
    t.bigInteger('user_id').unsigned().notNullable();
    t.string('reason', 500).notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.unique(['generation_id', 'user_id']);
  });
};
exports.down = async () => { throw new Error('Image safety audit cannot be removed automatically; roll back application only.'); };

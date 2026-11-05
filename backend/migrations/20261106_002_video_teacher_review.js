/** Add deny-by-default video review and audit, withdraw all existing public
 * videos into pending. Knex executes once; never auto-approve or roll back safety. */
exports.up = async knex => {
  await knex.schema.createTable('video_safety', t => {
    t.bigInteger('generation_id').unsigned().primary();
    t.string('state', 16).notNullable().defaultTo('pending');
    t.string('gallery_state', 16).notNullable().defaultTo('private');
    t.string('sha256', 64).nullable().index();
    t.string('file_key', 128).nullable();
    t.bigInteger('file_size').unsigned().nullable();
    t.integer('revision').unsigned().notNullable().defaultTo(0);
    t.bigInteger('reviewer_id').unsigned().nullable();
    t.timestamp('requested_at').nullable();
    t.timestamp('reviewed_at').nullable();
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.index(['gallery_state', 'generation_id']);
  });
  await knex.schema.createTable('video_safety_events', t => {
    t.bigIncrements('id');
    t.bigInteger('generation_id').unsigned().notNullable().index();
    t.bigInteger('actor_id').unsigned().nullable();
    t.string('action', 40).notNullable(); t.string('state', 16).notNullable();
    t.string('reason', 500).notNullable(); t.string('sha256', 64).nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
  await knex.raw("INSERT INTO video_safety (generation_id,gallery_state,requested_at) SELECT id,'pending',NOW() FROM video_generations WHERE is_public=1");
  await knex('video_generations').where('is_public', 1).update({ is_public: 0 });
  await knex.schema.alterTable('video_generations', t => t.bigInteger('gallery_approved_by').unsigned().nullable());
  await knex.raw(`ALTER TABLE video_generations ADD CONSTRAINT video_gallery_requires_teacher
    CHECK (is_public=0 OR (user_id IS NOT NULL AND gallery_approved_by IS NOT NULL AND gallery_approved_by>0 AND gallery_approved_by<>user_id))`);
};
exports.down = async () => { throw Error('Video review and audit must be preserved on application rollback.'); };

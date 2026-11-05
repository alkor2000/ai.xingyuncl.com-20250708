/** Every public gallery entry needs a separate human decision. Existing public
 * images become pending, never grandfathered. Additive schema; withdrawal affects
 * all currently public rows. Knex runs once. Rollback must not restore exposure. */
exports.up = async knex => {
  await knex.schema.alterTable('image_safety', t => {
    t.string('gallery_state', 16).notNullable().defaultTo('private');
    t.bigInteger('gallery_reviewer_id').unsigned().nullable();
    t.timestamp('gallery_reviewed_at').nullable();
    t.timestamp('gallery_requested_at').nullable();
    t.index(['gallery_state', 'generation_id']);
  });
  await knex.raw(`INSERT INTO image_safety (generation_id,gallery_state,gallery_requested_at)
    SELECT id,'pending',NOW() FROM image_generations WHERE is_public=1
    ON DUPLICATE KEY UPDATE gallery_state='pending',gallery_requested_at=NOW(),revision=revision+1`);
  await knex('image_generations').where('is_public', 1).update({ is_public: 0 });
  // CHECK is enforced by MySQL 8 without granting trigger/SUPER privileges.
  // It also prevents the old application toggle from publishing during rollout.
  await knex.schema.alterTable('image_generations', t => {
    t.bigInteger('gallery_approved_by').unsigned().nullable();
  });
  await knex.raw(`ALTER TABLE image_generations ADD CONSTRAINT gallery_requires_teacher
    CHECK (is_public=0 OR (user_id IS NOT NULL AND gallery_approved_by IS NOT NULL AND gallery_approved_by>0 AND gallery_approved_by<>user_id))`);
};
exports.down = async () => { throw new Error('Teacher review cannot be rolled back into unreviewed publication.'); };

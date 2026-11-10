/** Store seven-category machine evidence separately from human decisions.
 * Additive only; existing works are not published, hidden or deleted. Retry-safe.
 * Application rollback requires migration 003 persistent publication freeze first.
 */
exports.up=async knex=>{
  if(!await knex.schema.hasTable('gallery_machine_reviews'))await knex.schema.createTable('gallery_machine_reviews',t=>{
    t.string('media',8).notNullable();t.bigInteger('generation_id').unsigned().notNullable();
    t.string('content_hash',64).notNullable();t.string('policy_version',32).notNullable();
    t.string('decision',16).notNullable();t.boolean('map_detected').notNullable().defaultTo(false);
    t.json('result').notNullable();t.json('map_review').nullable();t.timestamp('checked_at').defaultTo(knex.fn.now());
    t.primary(['media','generation_id']);t.index(['media','decision','generation_id']);
  });
};
exports.down=async()=>{throw Error('Retain machine review evidence on application rollback');};

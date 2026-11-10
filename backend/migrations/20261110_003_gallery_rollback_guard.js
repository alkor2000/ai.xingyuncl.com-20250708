/** MySQL >=8.0.16 only: enforced CHECKs in preceding migrations are required.
 * Freeze is durable across old application rollback. Never drop audit or guards.
 * Installing this migration does not activate a production freeze or hide works.
 */
exports.up=async knex=>{
  const [[version]]=await knex.raw('SELECT VERSION() AS version');
  const match=/^(\d+)\.(\d+)\.(\d+)/.exec(version.version);
  if(!match||/mariadb/i.test(version.version)||Number(match[1])<8||Number(match[1])===8&&Number(match[2])===0&&Number(match[3])<16)throw Error('Gallery requires MySQL >=8.0.16 with enforced CHECK constraints; MariaDB/5.7 not supported');
  if(!await knex.schema.hasTable('gallery_publication_control'))await knex.schema.createTable('gallery_publication_control',t=>{t.integer('id').primary();t.boolean('frozen').notNullable().defaultTo(false);t.string('reason',500).notNullable();t.timestamp('updated_at').defaultTo(knex.fn.now());});
  await knex.raw("INSERT IGNORE INTO gallery_publication_control (id,frozen,reason) VALUES (1,0,'Installed; not frozen')");
  if(!await knex.schema.hasTable('gallery_publication_control_events'))await knex.schema.createTable('gallery_publication_control_events',t=>{t.bigIncrements('id');t.boolean('frozen').notNullable();t.string('approval_reference',200).notNullable();t.string('reason',500).notNullable();t.timestamp('created_at').defaultTo(knex.fn.now());});
  if(!await knex.schema.hasTable('gallery_scan_actions'))await knex.schema.createTable('gallery_scan_actions',t=>{t.string('media',8).notNullable();t.bigInteger('generation_id').unsigned().notNullable();t.string('snapshot_hash',64).notNullable();t.json('evidence').notNullable();t.json('preimage').notNullable();t.string('approval_reference',200).notNullable();t.timestamp('created_at').defaultTo(knex.fn.now());t.primary(['media','generation_id','snapshot_hash']);});
  for(const media of ['image','video'])for(const kind of ['generations','safety'])for(const op of ['INSERT','UPDATE']){
    const name=`${media}_${kind}_freeze_${op.toLowerCase()}`;
    const [existing]=await knex.raw('SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=?',[name]);
    if(existing.length)continue;
    const condition=kind==='generations'?"NEW.is_public=1":`NEW.gallery_state IN ('pending','approved')${op==='UPDATE'?" AND NEW.gallery_state<>OLD.gallery_state":""}`;
    await knex.raw(`CREATE TRIGGER ${name} BEFORE ${op} ON ${media}_${kind} FOR EACH ROW BEGIN
      DECLARE freeze_flag INT DEFAULT 1;
      IF ${condition} THEN
        SELECT frozen INTO freeze_flag FROM gallery_publication_control WHERE id=1 FOR SHARE;
        IF freeze_flag<>0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='gallery_publication_frozen'; END IF;
      END IF;
    END`);
  }
};
exports.down=async()=>{throw Error('Rollback must preserve gallery freeze guards and audit');};

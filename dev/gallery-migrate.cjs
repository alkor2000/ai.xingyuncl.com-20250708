'use strict';
// Operator tool, invoked only within the native release lock. CLI flags are not approval.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {createRequire} = require('node:module');
const plan = require('./gallery-migration-plan.json');
const digest = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const ensure = (ok, reason) => { if (!ok) throw Error(reason); };
function save(dir, name, data) {
  const fd = fs.openSync(path.join(dir,name),'wx',0o600);
  try { fs.writeFileSync(fd,JSON.stringify(data,null,2)+'\n');fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const directory = fs.openSync(dir,'r');try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}
function files(app) {
  return plan.migrations.map(m=>{
    const file=path.join(app,'migrations',m.name),s=fs.lstatSync(file);
    ensure(s.isFile()&&!s.isSymbolicLink(),'migration_not_regular');
    ensure(digest(fs.readFileSync(file))===m.sha256,'unreviewed_migration_bytes');return m;
  });
}
async function supported(knex) {
  const [[row]]=await knex.raw('SELECT VERSION() AS version,@@version_comment AS comment');
  const v=/^(\d+)\.(\d+)\.(\d+)/.exec(row.version);
  ensure(v&&!/mariadb|percona|tidb|aurora|oceanbase/i.test(row.version+' '+row.comment)&&/mysql|ubuntu/i.test(row.comment)&&(Number(v[1])>8||Number(v[1])===8&&(Number(v[2])>0||Number(v[3])>=16)),'unsupported_mysql');
  return row;
}
async function pending(knex) {
  // Refuse missing ledger: even inspect must not initialize migrations tables.
  ensure(await knex.schema.hasTable('knex_migrations')&&await knex.schema.hasTable('knex_migrations_lock'),'missing_migration_ledger');
  const locks=await knex('knex_migrations_lock').select('is_locked');
  ensure(locks.length===1&&Number(locks[0].is_locked)===0,'migration_ledger_locked_or_incomplete');
  const [,list]=await knex.migrate.list();return list.map(x=>typeof x==='string'?x:x.file).sort();
}
async function publicRows(knex) {
  const result={};
  for(const media of ['image','video']) {
    const cols=['id','user_id','is_public','updated_at','status','prompt','negative_prompt',media+'_url','local_path','file_size'];
    const rows=await knex(media+'_generations').select(cols).where('is_public',1).orderBy('id').limit(101);
    ensure(rows.length<=100,'public_scope_exceeded');
    result[media]=rows.map(({id,is_public,updated_at,...content})=>({id:Number(id),is_public:Number(is_public),updated_at,content_sha256:digest(content)}));
  }
  return result;
}
function exactPublic(rows) {
  for(const media of ['image','video'])ensure(JSON.stringify(rows[media].map(r=>r.id))===JSON.stringify(plan.historical_public[media]),'historical_public_scope_changed');
}
async function inspect(knex,app) {
  const server=await supported(knex),source=files(app),names=await pending(knex),rows=await publicRows(knex);
  ensure(JSON.stringify(names)===JSON.stringify([...plan.profiles['gallery-pku']].sort()),'pending_migration_scope_changed');
  exactPublic(rows);
  for(const table of ['image_safety_references','image_safety','image_safety_events','image_safety_restrictions','image_safety_reports','video_safety','video_safety_events','video_safety_reports','gallery_machine_reviews','gallery_publication_control','gallery_publication_control_events','gallery_scan_actions'])ensure(!await knex.schema.hasTable(table),'partial_schema_requires_review');
  await verifySharedPreimage(knex);
  return {version:1,server,source,pending:names,public:rows};
}
async function verifyInstalled(knex, expectedFrozen = false) {
  await supported(knex);
  const [checks]=await knex.raw("SELECT TABLE_NAME,CONSTRAINT_NAME,ENFORCED FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME IN ('gallery_requires_teacher','video_gallery_requires_teacher')");
  ensure(checks.length===2&&checks.every(c=>c.ENFORCED==='YES')&&checks.some(c=>c.TABLE_NAME==='image_generations'&&c.CONSTRAINT_NAME==='gallery_requires_teacher')&&checks.some(c=>c.TABLE_NAME==='video_generations'&&c.CONSTRAINT_NAME==='video_gallery_requires_teacher'),'missing_enforced_checks');
  const [triggers]=await knex.raw("SELECT TRIGGER_NAME,ACTION_STATEMENT,EVENT_OBJECT_TABLE,EVENT_MANIPULATION,ACTION_TIMING FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME LIKE '%\\_freeze\\_%'");
  for(const media of ['image','video'])for(const kind of ['generations','safety'])for(const op of ['insert','update']) {
    const name=`${media}_${kind}_freeze_${op}`,t=triggers.find(x=>x.TRIGGER_NAME===name);
    const condition=kind==='generations'?"NEW.is_public=1":`NEW.gallery_state IN ('pending','approved')${op==='update'?" AND NEW.gallery_state<>OLD.gallery_state":""}`;
    const expected=`BEGIN DECLARE freeze_flag INT DEFAULT 1; IF ${condition} THEN SELECT frozen INTO freeze_flag FROM gallery_publication_control WHERE id=1 FOR SHARE; IF freeze_flag<>0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='gallery_publication_frozen'; END IF; END IF; END`;
    const normalize=s=>s.replace(/`/g,'').replace(/\s+/g,' ').trim().toLowerCase();
    ensure(t&&t.EVENT_OBJECT_TABLE===`${media}_${kind}`&&t.EVENT_MANIPULATION===op.toUpperCase()&&t.ACTION_TIMING==='BEFORE'&&normalize(t.ACTION_STATEMENT)===normalize(expected),'missing_or_changed_freeze_guard');
  }
  const control=await knex('gallery_publication_control').where('id',1).first();
  ensure(control&&[0,1].includes(Number(control.frozen))&&(expectedFrozen===null||Number(control.frozen)===Number(expectedFrozen)),'unexpected_publication_freeze');
  return {checks:2,guards:8,frozen:!!Number(control.frozen)};
}
// Only a pristine pending migration may enter this release path. Never repair partial DDL.
async function verifySharedPreimage(knex) {
  if (!plan.shared_work_migration) return;
  ensure((await knex('knex_migrations').where('name',plan.shared_work_migration)).length===0,'shared_migration_already_recorded');
  ensure(await knex.schema.hasTable('user_mindmaps'),'missing_mindmap_preimage');
  for (const table of ['shared_work_reports','shared_work_events']) ensure(!await knex.schema.hasTable(table),'partial_shared_schema_requires_review');
  for (const column of ['share_state','share_revision']) ensure(!await knex.schema.hasColumn('user_mindmaps',column),'partial_shared_schema_requires_review');
}
async function verifySharedTables(knex) {
  const common={id:['bigint unsigned','NO',null,'auto_increment'],work_type:["enum('html','mindmap')",'NO',null,''],work_id:['bigint unsigned','NO',null,'']};
  const timestamp=['timestamp','YES','CURRENT_TIMESTAMP','default_generated'];
  const expected={
    shared_work_reports:{columns:{...common,user_id:['bigint unsigned','NO',null,''],reason:['varchar(500)','NO',null,''],created_at:timestamp,resolved_at:['timestamp','YES',null,'']},indexes:['0:id','0:work_type,work_id,user_id'],constraints:['PRIMARY KEY','UNIQUE']},
    shared_work_events:{columns:{...common,actor_id:['bigint unsigned','NO',null,''],action:['varchar(32)','NO',null,''],created_at:timestamp},indexes:['0:id','1:work_type,work_id'],constraints:['PRIMARY KEY']}
  };
  for (const [table,spec] of Object.entries(expected)) {
    const [[info]]=await knex.raw('SELECT ENGINE,TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[table]);
    ensure(info&&info.ENGINE==='InnoDB'&&info.TABLE_TYPE==='BASE TABLE','invalid_shared_table');
    const [columns]=await knex.raw('SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[table]);
    ensure(columns.length===Object.keys(spec.columns).length,'invalid_shared_columns');
    for (const [name,want] of Object.entries(spec.columns)) {
      const column=columns.find(c=>c.COLUMN_NAME===name);
      // MySQL 8.0.16 includes integer display widths; newer 8.0 releases omit them.
      const type=column?.COLUMN_TYPE.toLowerCase().replace(/\b(bigint|int)\(\d+\)/g,'$1');
      const value=column?.COLUMN_DEFAULT==null?null:String(column.COLUMN_DEFAULT).toUpperCase().replace(/\(\)$/,'');
      ensure(column&&type===want[0]&&column.IS_NULLABLE===want[1]&&value===want[2]&&column.EXTRA.toLowerCase()===want[3]&&!column.GENERATION_EXPRESSION,'invalid_shared_column_'+name);
    }
    const [rows]=await knex.raw('SELECT INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,SUB_PART,INDEX_TYPE,IS_VISIBLE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX',[table]);
    const groups=new Map();
    for (const row of rows) {
      ensure(row.SUB_PART==null&&row.INDEX_TYPE==='BTREE'&&row.IS_VISIBLE==='YES','invalid_shared_index');
      if (!groups.has(row.INDEX_NAME)) groups.set(row.INDEX_NAME,[]);
      groups.get(row.INDEX_NAME).push(row);
    }
    const primary=groups.get('PRIMARY');
    ensure(primary&&primary.length===1&&primary[0].COLUMN_NAME==='id'&&Number(primary[0].NON_UNIQUE)===0,'invalid_shared_primary_key');
    const actual=[...groups.values()].map(group=>String(group[0].NON_UNIQUE)+':'+group.map(row=>row.COLUMN_NAME).join(',')).sort();
    ensure(JSON.stringify(actual)===JSON.stringify([...spec.indexes].sort()),'invalid_shared_indexes');
    const [constraints]=await knex.raw('SELECT CONSTRAINT_TYPE FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME=?',[table]);
    ensure(JSON.stringify(constraints.map(c=>c.CONSTRAINT_TYPE).sort())===JSON.stringify([...spec.constraints].sort()),'invalid_shared_constraints');
  }
}
async function verifySharedInstalled(knex) {
  if (!plan.shared_work_migration) return;
  await verifySharedTables(knex);
  const [columns]=await knex.raw("SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='user_mindmaps' AND COLUMN_NAME IN ('share_state','share_revision')");
  const state=columns.find(c=>c.COLUMN_NAME==='share_state'),revision=columns.find(c=>c.COLUMN_NAME==='share_revision');
  ensure(state&&state.COLUMN_TYPE==="enum('draft','published','withdrawn')"&&state.IS_NULLABLE==='NO'&&state.COLUMN_DEFAULT==='published','invalid_shared_state');
  ensure(revision&&revision.COLUMN_TYPE==='int unsigned'&&revision.IS_NULLABLE==='NO'&&String(revision.COLUMN_DEFAULT)==='0','invalid_shared_revision');
  ensure((await knex('knex_migrations').where('name',plan.shared_work_migration)).length===1,'missing_shared_ledger');
}
async function checkEnforcement(knex) {
  // A disposable TEMPORARY table, never a real work; same pooled connection throughout.
  const connection=await knex.client.acquireConnection();
  const query=(sql)=>knex.raw(sql).connection(connection);
  let created=false;
  try {
    await query('CREATE TEMPORARY TABLE gallery_release_check_probe (id INT CHECK (id>0))');created=true;
    let denied=false;
    try { await query('INSERT INTO gallery_release_check_probe VALUES (0)'); }
    catch(e) { if(e.code==='ER_CHECK_CONSTRAINT_VIOLATED'||e.errno===3819)denied=true;else throw e; }
    ensure(denied,'check_not_enforced');
  } finally { try {if(created)await query('DROP TEMPORARY TABLE gallery_release_check_probe');} finally {await knex.client.releaseConnection(connection);} }
}
async function apply(knex,app,dir,approval,expected,backup) {
  ensure(/^[A-Za-z0-9_.:-]{1,200}$/.test(approval),'missing_approval_reference');
  ensure(/^[a-f0-9]{64}$/.test(backup.sha256)&&backup.gzip_verified===true&&backup.writers_stopped===true,'missing_backup_or_quiescence_receipt');
  ensure(digest(await inspect(knex,app))===digest(expected),'snapshot_changed_before_migration');
  save(dir,'INTENT.json',{approval,plan_sha256:digest(plan),expected,backup});
  await checkEnforcement(knex);
  for(let i=0;i<plan.profiles['gallery-pku'].length;i++) {
    const name=plan.profiles['gallery-pku'][i];files(app);
    const remainingPublic=await publicRows(knex);
    const wanted={image:i>=2?[]:expected.public.image,video:i>=3?[]:expected.public.video};
    ensure(digest(remainingPublic)===digest(wanted),'public_content_changed_during_migration');
    ensure(JSON.stringify(await pending(knex))===JSON.stringify(plan.profiles['gallery-pku'].slice(i).sort()),'pending_migration_drift');
    save(dir,`STEP-${i}-STARTED.json`,{name});
    const [batch,log]=await knex.migrate.up({name});
    ensure(JSON.stringify(log)===JSON.stringify([name]),'unexpected_migration_execution');
    save(dir,`STEP-${i}-DONE.json`,{name,batch});
  }
  ensure((await pending(knex)).length===0,'migrations_still_pending');
  const verified=await verifyInstalled(knex);
  await verifySharedInstalled(knex);
  for(const media of ['image','video']) {
    const ids=plan.historical_public[media];
    const rows=await knex(media+'_generations').select('id','is_public').whereIn('id',ids).orderBy('id');
    const safety=await knex(media+'_safety').select('generation_id','gallery_state').whereIn('generation_id',ids).orderBy('generation_id');
    ensure(rows.length===ids.length&&rows.every(r=>Number(r.is_public)===0),'historical_visibility_not_withdrawn');
    ensure(safety.length===ids.length&&safety.every(r=>r.gallery_state==='pending'),'historical_pending_missing');
  }
  const remaining=await publicRows(knex);ensure(remaining.image.length===0&&remaining.video.length===0,'unexpected_public_work');
  save(dir,'COMPLETE.json',{approval,verified,migrations:plan.profiles['gallery-pku'],historical:plan.historical_public});
  return verified;
}
module.exports={inspect,apply,verifyInstalled,verifySharedPreimage,verifySharedInstalled,checkEnforcement,pending,files,save,digest,exactPublic,supported};
if(require.main===module) {
  (async()=>{
    const [action,app,dir,approval]=process.argv.slice(2);
    ensure(['inspect','apply'].includes(action),'invalid_action');
    const stat=fs.lstatSync(dir);ensure(stat.isDirectory()&&!stat.isSymbolicLink()&&(stat.mode&0o077)===0,'evidence_not_private');
    const req=createRequire(path.join(app,'package.json'));
    const config=req(path.join(app,'knexfile.js'))[process.env.NODE_ENV||'development'];
    const knex=req('knex')({...config,migrations:{...config.migrations,directory:path.join(app,'migrations')},pool:{min:0,max:2}});
    try {
      if(action==='inspect')save(dir,'PLAN.json',await inspect(knex,app));
      else {
        ensure(process.env.GALLERY_WRITERS_STOPPED==='1','writers_not_stopped');
        const expected=JSON.parse(fs.readFileSync(path.join(dir,'PLAN.json')));
        const backup=JSON.parse(fs.readFileSync(path.join(dir,'BACKUP.json')));
        await apply(knex,app,dir,approval,expected,backup);
      }
      console.log('GALLERY_MIGRATION_'+action.toUpperCase()+'_OK');
    }finally{await knex.destroy();}
  })().catch(()=>{console.error('GALLERY_MIGRATION_STOP: preserve evidence and lock; no retry, down, or public restore');process.exitCode=1;});
}

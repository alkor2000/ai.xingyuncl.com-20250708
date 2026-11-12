'use strict';
// Explicit local fixture only. Never imports production credentials or calls SSH.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process'),os=require('node:os'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),req=require('node:module').createRequire(root+'/backend/package.json');
const mysql=req('mysql2/promise'),knexFactory=req('knex');
const recovery=require('../gallery-recovery.cjs'),check=require('../gallery-migrate.cjs'),incident=require('../gallery-recovery-incident.json');
const cfg=JSON.parse(fs.readFileSync(process.argv[2])),output=process.argv[3];
assert.equal(cfg.host,'127.0.0.1');assert(cfg.port>10000);assert.equal(cfg.purpose,'gallery-recovery-isolated-test');
const conn={host:cfg.host,port:cfg.port,user:'root',password:cfg.password};let admin;const facts=[];let number=0;
const third='20261110_003_gallery_rollback_guard.js';
async function fresh(sql){const c=await mysql.createConnection(conn);try{return await c.query(sql);}finally{await c.end();}}
async function fixture(){
 const db='gallery_recovery_'+process.pid+'_'+(++number),user='app'+process.pid+'_'+number;await admin.query('CREATE DATABASE '+db+' CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');
 await admin.query("CREATE USER '"+user+"'@'%' IDENTIFIED BY ?",[cfg.password+'limited']);await admin.query('GRANT ALL ON '+db+".* TO '"+user+"'@'%'");
 const adminDB=knexFactory({client:'mysql2',connection:{...conn,database:db},pool:{min:0,max:2}});
 const connection={...conn,database:db,user,password:cfg.password+'limited'};
 const config={client:'mysql2',connection,pool:{min:0,max:2},migrations:{directory:root+'/backend/migrations'}};
 const k=knexFactory(config);
 for(const ddl of Object.values(incident.ddl))await adminDB.raw(ddl);
 await adminDB('gallery_publication_control').insert({id:1,frozen:0,reason:'Installed; not frozen'});
 for(const media of ['image','video'])await adminDB.raw(`CREATE TABLE ${media}_generations (id BIGINT PRIMARY KEY,user_id BIGINT,is_public TINYINT DEFAULT 0,gallery_approved_by BIGINT,CONSTRAINT ${media==='image'?'gallery_requires_teacher':'video_gallery_requires_teacher'} CHECK (is_public=0 OR (user_id IS NOT NULL AND gallery_approved_by IS NOT NULL AND gallery_approved_by>0 AND gallery_approved_by<>user_id)))`);
 await adminDB.raw('CREATE TABLE teaching_lessons (id INT PRIMARY KEY)');
 for(const name of incident.prior_trigger_names){const op=name.split('_').at(-1).toUpperCase();await adminDB.raw(`CREATE TRIGGER ${name} AFTER ${op} ON teaching_lessons FOR EACH ROW BEGIN SET @fixture_prior_trigger=1; END`);}
 await adminDB.schema.createTable('knex_migrations',t=>{t.increments('id');t.string('name');t.integer('batch');t.timestamp('migration_time');});
 await adminDB('knex_migrations').insert(incident.knex_ledger.map(x=>({...x,migration_time:new Date('2026-11-11T23:04:40Z')})));
 await adminDB.schema.createTable('knex_migrations_lock',t=>{t.increments('index');t.integer('is_locked');});await adminDB('knex_migrations_lock').insert({index:1,is_locked:0});
 await adminDB.schema.createTable('schema_migrations',t=>{t.string('version').primary();t.timestamp('executed_at');});
 await adminDB('schema_migrations').insert(incident.sql_ledger.map(version=>({version,executed_at:new Date('2026-11-01T00:00:00Z')})));
 const [[server]]=await adminDB.raw('SELECT VERSION() version,@@server_uuid uuid');const spec={...incident,database:db,mysql_version:server.version};
 return {k,adminDB,config,spec,uuid:server.uuid,close:async()=>{await k.destroy();await adminDB.destroy();await admin.query('DROP DATABASE '+db);await admin.query("DROP USER '"+user+"'@'%'");}};
}
async function scenario(name,fault){
 const x=await fixture(),receipts={},calls=[];let migrated=0,complete=0;
 const ops={
  inspect:async completed=>{const k=knexFactory(x.config);try{return await recovery.databaseSnapshot(k,x.spec,completed);}finally{await k.destroy();}},
  identity:async server=>{const [[r]]=await fresh('SELECT @@server_uuid uuid');assert.equal(r.uuid,server.uuid);},
  backup:async()=>{calls.push('backup');},recheck:async before=>assert.deepEqual(await recovery.databaseSnapshot(x.k,x.spec,false),before),
  write:async(n,data)=>{receipts[n]=data;},
  set:async n=>{calls.push('set-'+n);if(n===0&&fault==='restore-failed')throw Error('synthetic administrator outage');await fresh('SET GLOBAL log_bin_trust_function_creators='+n);if(n===1&&fault==='lost-set-ack')throw Error('synthetic lost response after SET committed');},
  confirm:async(n,uuid)=>{const [[r]]=await fresh('SELECT @@server_uuid uuid,@@global.log_bin_trust_function_creators trust');assert.equal(r.uuid,uuid);assert.equal(r.trust,n);},
  migrate:async()=>{migrated++;if(fault==='partial-ddl'){await x.k.raw("CREATE TRIGGER image_generations_freeze_insert BEFORE INSERT ON image_generations FOR EACH ROW BEGIN SET @partial_guard=1; END");throw Error('synthetic DDL error after one guard');}const [,names]=await x.k.migrate.up({name:third});assert.deepEqual(names,[third]);},
  guards:async()=>{const v=await check.verifyInstalled(x.k);await check.checkEnforcement(x.k);return v;},
  recheckFiles:async()=>{},complete:async()=>{complete++;}
 };
 try{
  if(fault==='schema-drift')await x.adminDB.raw('ALTER TABLE gallery_scan_actions MODIFY approval_reference VARCHAR(201) NOT NULL');
  if(fault==='ledger-drift')await x.k('knex_migrations').where('id',17).update({batch:42});
  if(fault==='public-drift')await x.k('image_generations').insert({id:99,user_id:1,is_public:1,gallery_approved_by:2});
  let error;try{await recovery.recover(ops);}catch(e){error=e;}
  const [[parameter]]=await fresh('SELECT @@global.log_bin_trust_function_creators trust');
  if(!fault){assert.ifError(error);assert.equal(complete,1);assert.equal(parameter.trust,0);assert.equal(migrated,1);assert(receipts['RECOVERY-COMPLETE.json']);
   await x.k('gallery_publication_control').where({id:1}).update({frozen:1});
   await assert.rejects(x.k('image_generations').insert({id:99,user_id:1,is_public:1,gallery_approved_by:2}),/gallery_publication_frozen/);
   await assert.rejects(x.k('image_safety').insert({generation_id:99,gallery_state:'pending'}),/gallery_publication_frozen/);
  }else{assert(error);assert.equal(complete,0);assert(!receipts['RECOVERY-COMPLETE.json']);assert.equal(parameter.trust,fault==='restore-failed'?1:0);}
  if(['schema-drift','ledger-drift','public-drift'].includes(fault)){assert.equal(migrated,0);assert(!calls.includes('set-1'));}
  if(fault==='partial-ddl'){assert.equal((await x.k('knex_migrations').where('name',third)).length,0);assert(receipts['PARAMETER-RESTORED.json']);}
  facts.push({name,passed:true,global_after:parameter.trust,migration_calls:migrated,complete,reason:error?.message});
 }finally{await fresh('SET GLOBAL log_bin_trust_function_creators=0');await x.close();}
}

async function nativeScenario(){
 const x=await fixture(),base=fs.mkdtempSync(path.join(os.tmpdir(),'gallery-native-recovery-')),repo=path.join(base,'repo'),bin=path.join(base,'bin');
 fs.mkdirSync(repo);fs.mkdirSync(bin);const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
 const git=(...args)=>cp.execFileSync('git',['-C',repo,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const backupDir='/mnt/d/TeachingWorkspace/batch-output/gallery-recovery-tool-20261112/'+path.basename(base);fs.mkdirSync(backupDir,{recursive:true});
 const env={...process.env,PATH:bin+':'+process.env.PATH,NODE_ENV:'development',APP_DIR:repo,BACKUP_DIR:backupDir,BACKUP_RETENTION:'skip'};
 for(const key of ['DB','DB_HOST','DB_PORT','DB_USER','DB_NAME','DB_PASSWORD'])delete env[key];
 try{
  fs.mkdirSync(repo+'/backend/migrations',{recursive:true});fs.mkdirSync(repo+'/backend/scripts');fs.mkdirSync(repo+'/dev');
  for(const n of fs.readdirSync(root+'/backend/migrations'))if(!require('../gallery-migration-plan.json').profiles['gallery-review'].includes(n))fs.copyFileSync(root+'/backend/migrations/'+n,repo+'/backend/migrations/'+n);
  fs.copyFileSync(root+'/backend/knexfile.js',repo+'/backend/knexfile.js');fs.writeFileSync(repo+'/backend/package.json','{}');
  fs.copyFileSync(root+'/backend/scripts/db_backup.sh',repo+'/backend/scripts/db_backup.sh');
  fs.writeFileSync(repo+'/.gitignore','node_modules\n.env\n');
  for(const n of ['migration-stage.cjs','gallery-migrate.cjs','gallery-migration-plan.json'])fs.writeFileSync(repo+'/dev/'+n,cp.execFileSync('git',['-C',root,'show',incident.original_target+':dev/'+n]));
  git('init','-q');git('config','user.name','Local Recovery Test');git('config','user.email','test@invalid.local');git('add','.');git('commit','-qm','parent');const parent=git('rev-parse','HEAD');
  for(const n of require('../gallery-migration-plan.json').profiles['gallery-review'])fs.copyFileSync(root+'/backend/migrations/'+n,repo+'/backend/migrations/'+n);
  git('add','.');git('commit','-qm','old candidate');const oldTarget=git('rev-parse','HEAD');git('checkout','-q',parent);
  const oldDir=base+'/migration-'+oldTarget;fs.mkdirSync(oldDir,{mode:0o700});
  const old=require('../migration-stage.cjs').prepare(repo,oldTarget,oldDir,parent,'gallery-review');
  for(const n of ['migration-stage.cjs','gallery-migrate.cjs','gallery-migration-plan.json'])fs.copyFileSync(repo+'/dev/'+n,oldDir+'/'+n);
  for(const [n,data]of Object.entries({'RUNNING.json':{...old,attempt_token:'prior-test-attempt'},'NATIVE-RUNNING.json':{repo,target:oldTarget,attempt_token:'prior-test-attempt'},'TERMINAL.json':{repo,target:oldTarget,attempt_token:'prior-test-attempt',phase:third,exit:1},'FAILED.json':{target:oldTarget,status:'UNKNOWN_OR_FAILED_DO_NOT_RETRY',ddl_may_have_committed:true}}))fs.writeFileSync(oldDir+'/'+n,JSON.stringify(data,null,2)+'\n');
  fs.symlinkSync(root+'/backend/node_modules',repo+'/backend/node_modules');
  fs.writeFileSync(repo+'/backend/.env',`DB_HOST=127.0.0.1\nDB_PORT=${cfg.port}\nDB_USER=${x.config.connection.user}\nDB_PASSWORD=${x.config.connection.password}\nDB_NAME=${x.spec.database}\n`,{mode:0o600});
  const previousBackup=cp.execFileSync('bash',[repo+'/backend/scripts/db_backup.sh'],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  await new Promise(r=>setTimeout(r,1100));
  const spec={...x.spec,repo,parent,original_target:oldTarget,original_receipts:Object.fromEntries(Object.keys(incident.original_receipts).map(n=>[n,sha(fs.readFileSync(oldDir+'/'+n))])),original_backup:{path:previousBackup,sha256:sha(fs.readFileSync(previousBackup))}};
  git('reset','--hard',oldTarget);
  for(const n of recovery.stagedTools)fs.copyFileSync(root+'/dev/'+n,repo+'/dev/'+n);
  fs.writeFileSync(repo+'/dev/gallery-recovery-incident.json',JSON.stringify(spec,null,2)+'\n');git('add','.');git('commit','-qm','recovery tools');const target=git('rev-parse','HEAD');
  const dir=base+'/migration-'+target;fs.mkdirSync(dir,{mode:0o700});for(const n of recovery.stagedTools)fs.copyFileSync(repo+'/dev/'+n,dir+'/'+n);
  git('reset','--hard',parent);git('checkout',target,'--',...Object.keys(old.sources));
  fs.mkdirSync(base+'/.lock');fs.writeFileSync(base+'/.lock/owner','token=local-native-recovery\n');
  // Only the administrator transport and PM2 identity are fixtures. The recovery
  // CLI, real dump, real knex child, durable stages and deployment consumer are real.
  fs.writeFileSync(bin+'/mysql',`#!/usr/bin/env python3\nimport os,sys\na=[x for x in sys.argv[1:] if not x.startswith('--protocol=')]\nos.environ['MYSQL_PWD']=${JSON.stringify(cfg.password)}\nos.execv('/usr/bin/mysql',['mysql','--protocol=TCP','--host=127.0.0.1','--port=${cfg.port}']+a)\n`,{mode:0o700});
  fs.writeFileSync(bin+'/pm2',"#!/bin/sh\ncat <<'JSON'\n"+JSON.stringify(Object.entries(incident.pm2).map(([name,pid])=>({name,pid,pm2_env:{status:'online',restart_time:0}})))+"\nJSON\n",{mode:0o700});
  let run=cp.spawnSync(process.execPath,[dir+'/gallery-recovery.cjs',repo,target,dir,'local-native-recovery','isolated-test-approval'],{env,encoding:'utf8',timeout:90000});
  fs.writeFileSync(path.join(path.dirname(output),'native-cli.log'),run.stdout+run.stderr);assert.equal(run.status,0,run.stdout+run.stderr);
  const verify=()=>cp.spawnSync(process.execPath,[dir+'/migration-stage.cjs','verify-completed',repo,target,dir],{env,encoding:'utf8',timeout:30000});
  run=verify();assert.equal(run.status,0,run.stderr);
  const completed=JSON.parse(fs.readFileSync(dir+'/RECOVERY-COMPLETE.json'));assert.equal(completed.parameter_restored,0);assert(fs.existsSync(dir+'/COMPLETE'));
  for(const [n,digest]of Object.entries(spec.original_receipts))assert.equal(sha(fs.readFileSync(oldDir+'/'+n)),digest);
  assert(!fs.existsSync(oldDir+'/MIGRATED.json'));assert(!fs.existsSync(oldDir+'/COMPLETE'));
  await fresh('SET GLOBAL log_bin_trust_function_creators=1');assert.notEqual(verify().status,0);await fresh('SET GLOBAL log_bin_trust_function_creators=0');assert.equal(verify().status,0);
  const restored=fs.readFileSync(dir+'/PARAMETER-RESTORED.json');fs.unlinkSync(dir+'/PARAMETER-RESTORED.json');assert.notEqual(verify().status,0);fs.writeFileSync(dir+'/PARAMETER-RESTORED.json',restored);
  run=cp.spawnSync(process.execPath,[dir+'/gallery-recovery.cjs',repo,target,dir,'local-native-recovery','isolated-test-approval'],{env,encoding:'utf8',timeout:30000});assert.notEqual(run.status,0);assert.equal((await x.k('knex_migrations').where('name',third)).length,1);
  fs.writeFileSync(path.join(path.dirname(output),'native-stage-summary.json'),JSON.stringify({passed:true,original_receipts_unchanged:true,old_completion_absent:true,new_native_completion:true,native_deployment_consumer:true,global_drift_blocks_switch:true,missing_restore_blocks_switch:true,retry_denied:true,backup_real:true,limits:['synthetic MySQL data','administrator CLI redirected to dedicated local container','PM2 process identity simulated','SSH transport and actual rebuild not performed']},null,2)+'\n');
  facts.push({name:'full-native-cli-backup-knex-receipts-and-deployment-consumer',passed:true});
 }finally{await fresh('SET GLOBAL log_bin_trust_function_creators=0');await x.close();fs.rmSync(base,{recursive:true,force:true});}
}

(async()=>{
 for(let i=0;i<60;i++){try{admin=await mysql.createConnection(conn);break;}catch{if(i===59)throw Error('isolated mysql unavailable');await new Promise(r=>setTimeout(r,1000));}}
 const [[start]]=await fresh('SELECT @@log_bin log_bin,@@global.log_bin_trust_function_creators trust');assert.equal(start.log_bin,1);assert.equal(start.trust,0);
 // Reproduce the real production error with the DB-only account, no approval simulation.
 const x=await fixture();try{await assert.rejects(x.k.migrate.up({name:third}),e=>e.errno===1419);assert.equal((await x.k('knex_migrations').where('name',third)).length,0);facts.push({name:'original-003-binlog-1419',passed:true});}finally{await x.close();}
 await scenario('A-success-fresh-readback-and-old-writes-blocked');
 await nativeScenario();
 for(const f of ['schema-drift','ledger-drift','public-drift','partial-ddl','lost-set-ack','restore-failed'])await scenario(f,f);
 fs.writeFileSync(output,JSON.stringify({passed:true,tests:facts,limits:['isolated MySQL8.0.46 synthetic rows; production frozen DDL shapes','No production connection or parameter change','Backup operation stubbed here; native backup and stage tested separately']},null,2)+'\n');console.log(JSON.stringify(facts));
})().catch(e=>{fs.writeFileSync(output,JSON.stringify({passed:false,tests:facts,error:e.message},null,2)+'\n');console.error(e.message);process.exitCode=1;}).finally(async()=>{if(admin){await admin.query('SET GLOBAL log_bin_trust_function_creators=0');await admin.end();}});

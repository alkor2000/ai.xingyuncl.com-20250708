'use strict';
// Incident-specific continuation, never a generic FAILED override. No production CLI test switches.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const check=require('./gallery-migrate.cjs'),stage=require('./migration-stage.cjs');
const incident=require('./gallery-recovery-incident.json'),plan=require('./gallery-migration-plan.json');
const {digest,save}=check;
const third=plan.profiles['gallery-review'][2];
const ensure=(ok,why)=>{if(!ok)throw Error(why);};
const normalizedDDL=s=>s.replace(/ AUTO_INCREMENT=\d+/g,'').trim();
const git=(repo,...args)=>cp.execFileSync('git',['-C',repo,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
const toolPaths=['Makefile','dev/RELEASE.md','dev/deploy.sh','dev/prepare-migrations.sh','dev/migration-stage.cjs','dev/gallery-recovery.cjs','dev/gallery-recovery-incident.json','dev/recover-gallery.sh','dev/tests/gallery-recovery.test.cjs','dev/tests/gallery-recovery-mysql.cjs'];
const stagedTools=['migration-stage.cjs','gallery-migrate.cjs','gallery-migration-plan.json','gallery-recovery.cjs','gallery-recovery-incident.json'];
function regular(file){const s=fs.lstatSync(file);ensure(s.isFile()&&!s.isSymbolicLink(),'not_regular_file');return fs.readFileSync(file);}
function privateDir(dir){const s=fs.lstatSync(dir);ensure(s.isDirectory()&&!s.isSymbolicLink()&&fs.realpathSync(dir)===dir&&(s.mode&0o777)===0o700&&s.uid===process.getuid(),'not_private_owned_directory');}
function original(repo,target,dir,spec=incident){
 privateDir(dir);ensure(path.basename(dir)==='migration-'+target,'stage_identity_changed');
 ensure(repo===spec.repo&&target!==spec.original_target&&/^[a-f0-9]{40}$/.test(target),'recovery_target_invalid');
 git(repo,'merge-base','--is-ancestor',spec.original_target,target);
 const delta=git(repo,'diff','--name-only',spec.original_target,target).trim().split('\n');
 ensure(delta.length>0&&delta.every(p=>toolPaths.includes(p)),'non_tool_delta');
 for(const n of stagedTools)ensure(digest(regular(path.join(dir,n)))===digest(git(repo,'show',`${target}:dev/${n}`)),'recovery_tool_bytes_changed');
 const oldDir=path.join(path.dirname(dir),'migration-'+spec.original_target);privateDir(oldDir);
 ensure(!fs.existsSync(path.join(oldDir,'MIGRATED.json'))&&!fs.existsSync(path.join(oldDir,'COMPLETE')),'old_attempt_already_complete');
 for(const [n,sha]of Object.entries(spec.original_receipts))ensure(digest(regular(path.join(oldDir,n)))===sha,'old_failure_receipt_changed');
 for(const n of ['migration-stage.cjs','gallery-migrate.cjs','gallery-migration-plan.json'])ensure(digest(regular(path.join(oldDir,n)))===digest(git(repo,'show',`${spec.original_target}:dev/${n}`)),'old_stage_helper_changed');
 const old=JSON.parse(regular(path.join(oldDir,'PREPARED.json')));
 ensure(old.parent===spec.parent&&old.repo===repo&&old.target===spec.original_target&&old.profile==='gallery-review','old_prepared_identity_changed');
 stage.verifyFiles(repo,old);
 const record={...old,target,recovery:{original_target:spec.original_target,incident_sha256:digest(regular(path.join(dir,'gallery-recovery-incident.json')))}};
 stage.verifyFiles(repo,record);return record;
}
function lockOwned(dir,token){
 ensure(/^[A-Za-z0-9._-]{8,80}$/.test(token),'invalid_lock_token');
 const lock=path.join(path.dirname(dir),'.lock');
 ensure(fs.lstatSync(lock).isDirectory()&&!fs.lstatSync(lock).isSymbolicLink(),'lock_not_directory');
 ensure(regular(path.join(lock,'owner')).toString().split('\n').includes('token='+token),'lock_not_owned');
}
async function databaseSnapshot(knex,spec=incident,completed=false){
 await check.supported(knex);
 const [[server]]=await knex.raw('SELECT VERSION() version, DATABASE() db, @@server_uuid uuid, @@global.log_bin log_bin, @@global.log_bin_trust_function_creators trust');
 ensure(server.version===spec.mysql_version&&server.db===spec.database&&Number(server.log_bin)===1&&Number(server.trust)===0,'database_identity_or_parameter_changed');
 const names=await check.pending(knex);ensure(JSON.stringify(names)===JSON.stringify(completed?[]:[third]),'pending_not_exact_003');
 const ledger=await knex('knex_migrations').select('*').orderBy('id');
 const old=ledger.filter(x=>x.name!==third).map(({id,name,batch})=>({id,name,batch}));
 ensure(JSON.stringify(old)===JSON.stringify(spec.knex_ledger),'completed_ledger_changed');
 const newer=ledger.filter(x=>x.name===third);ensure(newer.length===(completed?1:0),'003_ledger_changed');
 if(completed)ensure(newer[0].batch===Math.max(...spec.knex_ledger.map(x=>x.batch))+1,'003_batch_changed');
 const sql=await knex('schema_migrations').select('*').orderBy('version');
 ensure(JSON.stringify(sql.map(x=>x.version).sort())===JSON.stringify(spec.sql_ledger),'sql_ledger_changed');
 const ddl={};
 for(const [table,wanted]of Object.entries(spec.ddl)){
  const [[row]]=await knex.raw('SHOW CREATE TABLE ??',[table]);const actual=row['Create Table'];
  ensure(normalizedDDL(actual)===normalizedDDL(wanted),'partial_ddl_changed:'+table);ddl[table]=normalizedDDL(actual);
 }
 for(const table of ['video_safety_reports','gallery_machine_reviews','gallery_publication_control_events','gallery_scan_actions']){
  const row=await knex(table).count('* as n').first();ensure(Number(row.n)===0,'new_table_not_empty:'+table);
 }
 const control=await knex('gallery_publication_control').select('id','frozen','reason').orderBy('id');
 ensure(control.length===1&&control[0].id===1&&Number(control[0].frozen)===0&&control[0].reason==='Installed; not frozen','control_changed');
 const [triggers]=await knex.raw('SELECT TRIGGER_NAME,EVENT_OBJECT_TABLE,EVENT_MANIPULATION,ACTION_TIMING,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() ORDER BY TRIGGER_NAME');
 const prior=triggers.filter(x=>!x.TRIGGER_NAME.includes('_freeze_'));
 ensure(JSON.stringify(prior.map(x=>x.TRIGGER_NAME))===JSON.stringify(spec.prior_trigger_names),'prior_triggers_changed');
 ensure(triggers.length===spec.prior_trigger_names.length+(completed?8:0),'partial_guards_changed');
 const [checks]=await knex.raw("SELECT TABLE_NAME,CONSTRAINT_NAME,ENFORCED FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME IN ('gallery_requires_teacher','video_gallery_requires_teacher') ORDER BY CONSTRAINT_NAME");
 ensure(checks.length===2&&checks.every(x=>x.ENFORCED==='YES'),'teacher_checks_missing');
 for(const media of ['image','video'])ensure(Number((await knex(media+'_generations').where('is_public',1).count('* as n').first()).n)===0,'public_scope_changed');
 return {server,ledger,sql,ddl,prior_triggers:prior,checks,control};
}
function preserveSnapshot(before,after){
 ensure(before.server.uuid===after.server.uuid,'server_changed');
 ensure(digest(before.ledger)===digest(after.ledger.filter(x=>x.name!==third)),'old_ledger_rewritten');
 for(const k of ['sql','ddl','prior_triggers','checks','control'])ensure(digest(before[k])===digest(after[k]),'preimage_changed:'+k);
}
// Sequence is injected only for isolated tests; the CLI binds real SQL, native lock,
// original failure bytes, administrator identity, and backup operations below.
async function recover(ops){
 let changed=false,complete=false;
 const before=await ops.inspect(false);await ops.identity(before.server);await ops.backup();
 await ops.recheck(before);
 await ops.write('PARAMETER-INTENT.json',{from:0,to:1,server_uuid:before.server.uuid});
 try {
  changed=true; // even a lost SET response must trigger restoration
  await ops.set(1);await ops.confirm(1,before.server.uuid);
  await ops.migrate();
 } finally {
  if(changed){await ops.set(0);await ops.confirm(0,before.server.uuid);await ops.write('PARAMETER-RESTORED.json',{value:0,server_uuid:before.server.uuid});}
 }
 // Separate connection, not a successful SET response, establishes restoration.
 const after=await ops.inspect(true);preserveSnapshot(before,after);
 const guards=await ops.guards();await ops.recheckFiles();
 await ops.write('RECOVERY-COMPLETE.json',{before,after,guards,parameter_restored:0});
 await ops.complete();complete=true;return complete;
}
function verifyCompletion(repo,target,dir,record,spec=incident){
 ensure(record.recovery,'missing_recovery_binding');
 const expected=original(repo,target,dir,spec);
 ensure(digest(record)===digest(expected),'recovery_prepared_changed');
 const done=JSON.parse(regular(path.join(dir,'RECOVERY-COMPLETE.json')));
 const restored=JSON.parse(regular(path.join(dir,'PARAMETER-RESTORED.json')));
 const term=JSON.parse(regular(path.join(dir,'TERMINAL.json')));
 ensure(done.parameter_restored===0&&restored.value===0&&done.before.server.uuid===restored.server_uuid&&Number(done.after.server.trust)===0,'restore_receipt_missing');
 ensure(term.exit===0&&term.phase==='recovery-003'&&term.target===target&&term.repo===repo,'recovery_terminal_missing');
 ensure(done.guards.guards===8&&done.guards.checks===2&&!done.guards.frozen,'recovery_guards_missing');
 preserveSnapshot(done.before,done.after);
 return done;
}
async function verifyRecoveredDatabase(repo,target,dir,record){
 const done=verifyCompletion(repo,target,dir,record);const knex=connect(repo);
 try {
  const current=await databaseSnapshot(knex,incident,true);
  ensure(current.server.uuid===done.after.server.uuid,'recovery_database_changed');
  preserveSnapshot(done.before,current);
  await check.verifyInstalled(knex);await check.checkEnforcement(knex);
 }finally{await knex.destroy();}
}
function connect(repo){
 const backend=path.join(repo,'backend');process.chdir(backend);
 const config=require(path.join(backend,'knexfile.js'))[process.env.NODE_ENV||'development'];
 ensure(config,'unknown_knex_environment');
 return require(path.join(backend,'node_modules/knex'))({...config,pool:{min:0,max:2},migrations:{...config.migrations,directory:path.join(backend,'migrations')}});
}
let interrupted=false,activeChild=null;
function command(cmd,args,options={}){
 return new Promise((resolve,reject)=>{
  const c=cp.spawn(cmd,args,{stdio:['ignore','pipe','pipe'],...options});activeChild=c;
  let stdout='',stderr='';c.stdout.on('data',b=>{stdout+=b;if(stdout.length>4*1024*1024)c.kill('SIGTERM');});c.stderr.on('data',b=>{stderr+=b;if(stderr.length>4*1024*1024)c.kill('SIGTERM');});
  let killer;const timer=setTimeout(()=>{c.kill('SIGTERM');killer=setTimeout(()=>c.kill('SIGKILL'),5000);},options.timeoutMs||120000);
  c.on('error',()=>{clearTimeout(timer);clearTimeout(killer);activeChild=null;reject(Error('child_start_failed'));});
  c.on('close',(code,signal)=>{clearTimeout(timer);clearTimeout(killer);activeChild=null;if(code!==0||signal)reject(Error('child_failed_or_unknown'));else resolve(stdout);});
 });
}
async function admin(sql){return (await command('mysql',['--protocol=SOCKET','--user=root','--batch','--skip-column-names','--connect-timeout=5','--execute='+sql],{timeoutMs:15000})).trim();}
function runtimeIdentity(){
 const apps=JSON.parse(cp.execFileSync('pm2',['jlist'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 for(const [name,pid]of Object.entries(incident.pm2)){
  const app=apps.find(x=>x.name===name);ensure(app&&app.pid===pid&&app.pm2_env.status==='online'&&app.pm2_env.restart_time===0,'running_parent_changed');
 }
}
function backupCheck(file,sha){
 const bytes=regular(file);ensure(digest(bytes)===sha,'backup_digest_changed');
 ensure(regular(file+'.sha256').toString().trim()===sha,'backup_sidecar_changed');
 cp.execFileSync('gzip',['-t',file],{stdio:'ignore'});
 return {path:file,sha256:sha,bytes:bytes.length,gzip_verified:true};
}
async function run(repo,target,dir,token,approval){
 ensure(/^[A-Za-z0-9_.:-]{1,200}$/.test(approval||''),'missing_approval_reference');
 lockOwned(dir,token);const record=original(repo,target,dir);runtimeIdentity();
 ensure(!fs.existsSync(path.join(dir,'RUNNING.json'))&&!fs.existsSync(path.join(dir,'FAILED.json')),'recovery_already_attempted');
 backupCheck(incident.original_backup.path,incident.original_backup.sha256);
 save(dir,'INTENT.json',{...record,approval,original_backup:incident.original_backup});
 save(dir,'PREPARED.json',record);save(dir,'RUNNING.json',{...record,attempt_token:token,approval});
 for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.on(signal,()=>{interrupted=true;if(activeChild)activeChild.kill('SIGTERM');});
 const files=async()=>{ensure(!interrupted,'interrupted');lockOwned(dir,token);ensure(digest(original(repo,target,dir))===digest(record),'recovery_binding_changed');runtimeIdentity();};
 const inspect=async completed=>{await files();const k=connect(repo);try{return await databaseSnapshot(k,incident,completed);}finally{await k.destroy();}};
 try{
  await recover({
   inspect,
   identity:async server=>{ensure(await admin('SELECT @@server_uuid')===server.uuid,'admin_wrong_instance');ensure(await admin('SELECT @@global.log_bin_trust_function_creators')==='0','admin_parameter_changed');},
   backup:async()=>{await files();const name=(await command('bash',[path.join(repo,'backend/scripts/db_backup.sh')],{env:{...process.env,APP_DIR:repo,BACKUP_RETENTION:'skip'}})).trim();ensure(path.dirname(name)===path.dirname(incident.original_backup.path)&&path.basename(name).startsWith(incident.database+'-')&&/\d{8}_\d{6}\.sql\.gz$/.test(name)&&name!==incident.original_backup.path,'backup_path_invalid');save(dir,'BACKUP.json',backupCheck(name,digest(regular(name))));},
   recheck:async before=>{ensure(digest(await inspect(false))===digest(before),'database_changed_before_set');},
   write:async(n,value)=>save(dir,n,value),
   set:async value=>{if(value===1)await files();await admin('SET GLOBAL log_bin_trust_function_creators='+value);},
   confirm:async(value,uuid)=>{
    ensure(await admin('SELECT @@server_uuid')===uuid,'restore_wrong_instance');
    ensure(await admin('SELECT @@global.log_bin_trust_function_creators')===String(value),'parameter_not_confirmed');
    const k=connect(repo);try{const [[r]]=await k.raw('SELECT @@server_uuid uuid,@@global.log_bin_trust_function_creators trust');ensure(r.uuid===uuid&&Number(r.trust)===value,'independent_parameter_readback_failed');}finally{await k.destroy();}
   },
   migrate:async()=>{await files();save(dir,'003-STARTED.json',{name:third,approval});await command(process.execPath,[path.join(repo,'backend/node_modules/knex/bin/cli.js'),'migrate:up',third],{cwd:path.join(repo,'backend')});save(dir,'003-DONE.json',{name:third});},
   guards:async()=>{const k=connect(repo);try{const v=await check.verifyInstalled(k);await check.checkEnforcement(k);return v;}finally{await k.destroy();}},
   recheckFiles:files,
   complete:async()=>{await files();save(dir,'TERMINAL.json',{repo,target,attempt_token:token,phase:'recovery-003',exit:0});save(dir,'MIGRATED.json',record);fs.mkdirSync(path.join(dir,'COMPLETE'),{mode:0o700});const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  });
 }catch(e){save(dir,'FAILED.json',{target,status:'RECOVERY_FAILED_OR_UNKNOWN_NO_RETRY',parameter_restoration_verified:fs.existsSync(path.join(dir,'PARAMETER-RESTORED.json'))});throw e;}
}
module.exports={recover,databaseSnapshot,preserveSnapshot,original,verifyCompletion,verifyRecoveredDatabase,normalizedDDL,toolPaths,stagedTools,lockOwned,run};
if(require.main===module){const [repo,target,dir,token,approval]=process.argv.slice(2);run(repo,target,dir,token,approval).then(()=>console.log('GALLERY_RECOVERY_COMPLETE')).catch(e=>{console.error('GALLERY_RECOVERY_STOP: '+e.message+'; preserve lock/evidence; no retry or application switch');process.exitCode=1;});}

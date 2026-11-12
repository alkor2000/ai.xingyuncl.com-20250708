'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const recovery=require('../gallery-recovery.cjs'),stage=require('../migration-stage.cjs'),plan=require('../gallery-migration-plan.json');
const {digest}=require('../gallery-migrate.cjs');
const third=plan.profiles['gallery-review'][2],root=path.resolve(__dirname,'../..');
function fixture(fail){
 const before={server:{uuid:'server-a'},ledger:[{id:1,name:'001',batch:1}],sql:[{version:'1'}],ddl:{t:'CREATE TABLE t'},prior_triggers:[],checks:[],control:[{id:1,frozen:0}]};
 const after={...structuredClone(before),ledger:[...structuredClone(before.ledger),{id:2,name:third,batch:2}]};
 const calls=[],receipts={};let global=0,ddl=0,done=0;
 async function event(name){calls.push(name);if(fail===name)throw Error(name);}
 const ops={inspect:async completed=>{await event(completed?'inspect-after':'inspect-before');return structuredClone(completed?after:before);},identity:async()=>event('identity'),backup:async()=>event('backup'),recheck:async()=>event('recheck'),write:async(n,v)=>{await event('write-'+n);receipts[n]=v;},set:async n=>{await event('set-'+n);global=n;},confirm:async n=>event('confirm-'+n),migrate:async()=>{ddl++;await event('migrate');},guards:async()=>{await event('guards');return {guards:8,checks:2,frozen:false};},recheckFiles:async()=>event('files'),complete:async()=>{await event('complete');done++;}};
 return {ops,calls,receipts,before,after,state:()=>({global,ddl,done})};
}
test('only 003 once; restoration precedes completion, preserving completed ledger',async()=>{
 const x=fixture();assert.equal(await recovery.recover(x.ops),true);assert.deepEqual(x.state(),{global:0,ddl:1,done:1});
 assert(x.calls.indexOf('confirm-0')<x.calls.indexOf('inspect-after'));assert(x.receipts['RECOVERY-COMPLETE.json']);
});
for(const failure of ['inspect-before','identity','backup','recheck','write-PARAMETER-INTENT.json'])test('precondition failure '+failure+' never changes GLOBAL or runs DDL',async()=>{
 const x=fixture(failure);await assert.rejects(recovery.recover(x.ops));assert.deepEqual(x.state(),{global:0,ddl:0,done:0});assert(!x.calls.includes('set-1'));
});
for(const failure of ['set-1','confirm-1','migrate'])test('error/unknown '+failure+' attempts restoration and cannot complete',async()=>{
 const x=fixture(failure);await assert.rejects(recovery.recover(x.ops));assert(x.calls.includes('set-0'));assert(x.calls.includes('confirm-0'));assert.equal(x.state().global,0);assert.equal(x.state().done,0);assert(!x.receipts['RECOVERY-COMPLETE.json']);
});
for(const failure of ['set-0','confirm-0','write-PARAMETER-RESTORED.json','inspect-after','guards','files'])test('post-DDL failure '+failure+' cannot publish completion',async()=>{
 const x=fixture(failure);await assert.rejects(recovery.recover(x.ops));assert.equal(x.state().done,0);assert(!x.receipts['RECOVERY-COMPLETE.json']);
});
for(const field of ['ledger','sql','ddl','prior_triggers','checks','control'])test('reject changed '+field+' after migration',async()=>{
 const x=fixture();if(field==='ledger')x.after.ledger[0].batch=4;else x.after[field]={changed:true};
 await assert.rejects(recovery.recover(x.ops),/preimage_changed|old_ledger_rewritten/);assert.equal(x.state().global,0);assert.equal(x.state().done,0);
});
test('reject switched MySQL instance',async()=>{const x=fixture();x.after.server.uuid='server-b';await assert.rejects(recovery.recover(x.ops),/server_changed/);assert.equal(x.state().done,0);});
test('schema normalization ignores only AUTO_INCREMENT counter',()=>{
 assert.equal(recovery.normalizedDDL('CREATE x AUTO_INCREMENT=12'),recovery.normalizedDDL('CREATE x AUTO_INCREMENT=99'));
 assert.notEqual(recovery.normalizedDDL('CREATE x int'),recovery.normalizedDDL('CREATE x bigint'));
});
function filesFixture(fn){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gallery-recovery-test-')),repo=path.join(tmp,'repo');fs.mkdirSync(repo);
 const git=(...args)=>cp.execFileSync('git',['-C',repo,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 try{
  git('init','-q');git('config','user.name','Isolated Test');git('config','user.email','test@invalid.local');
  fs.mkdirSync(path.join(repo,'backend/migrations'),{recursive:true});fs.mkdirSync(path.join(repo,'dev'));
  fs.writeFileSync(path.join(repo,'backend/migrations/.gitkeep'),'');
  for(const n of recovery.stagedTools)fs.copyFileSync(path.join(root,'dev',n),path.join(repo,'dev',n));
  git('add','.');git('commit','-qm','parent');const parent=git('rev-parse','HEAD');
  for(const n of plan.profiles['gallery-review'])fs.copyFileSync(path.join(root,'backend/migrations',n),path.join(repo,'backend/migrations',n));
  git('add','.');git('commit','-qm','old candidate');const oldTarget=git('rev-parse','HEAD');
  git('checkout','-q',parent);const oldDir=path.join(tmp,'migration-'+oldTarget);fs.mkdirSync(oldDir,{mode:0o700});
  const old=stage.prepare(repo,oldTarget,oldDir,parent,'gallery-review');
  fs.writeFileSync(path.join(oldDir,'FAILED.json'),JSON.stringify({status:'FAILED'}));
  for(const n of ['migration-stage.cjs','gallery-migrate.cjs','gallery-migration-plan.json'])fs.copyFileSync(path.join(root,'dev',n),path.join(oldDir,n));
  const spec={repo,parent,original_target:oldTarget,original_receipts:Object.fromEntries(['PREPARED.json','FAILED.json'].map(n=>[n,digest(fs.readFileSync(path.join(oldDir,n)))]))};
  // Build a tool-only successor, then return to exactly the original staged preimage.
  git('reset','--hard',oldTarget);fs.appendFileSync(path.join(repo,'dev/RELEASE.md'),'recovery');git('add','.');git('commit','-qm','recovery');const target=git('rev-parse','HEAD');
  git('reset','--hard',parent);git('checkout',target,'--',...Object.keys(old.sources));
  const dir=path.join(tmp,'migration-'+target);fs.mkdirSync(dir,{mode:0o700});
  for(const n of recovery.stagedTools)fs.copyFileSync(path.join(repo,'dev',n),path.join(dir,n));
  fn({repo,target,dir,oldDir,spec,git});
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
}
test('recovery binds original FAILED without deleting it, staged bytes and original parent',()=>filesFixture(x=>{
 const record=recovery.original(x.repo,x.target,x.dir,x.spec);assert.equal(record.parent,x.spec.parent);assert.equal(record.recovery.original_target,x.spec.original_target);assert(fs.existsSync(path.join(x.oldDir,'FAILED.json')));
}));
test('changed original failure rejected',()=>filesFixture(x=>{
 fs.appendFileSync(path.join(x.oldDir,'FAILED.json'),' ');assert.throws(()=>recovery.original(x.repo,x.target,x.dir,x.spec),/old_failure_receipt_changed/);
}));
test('changed staged verifier rejected before executing it',()=>filesFixture(x=>{
 fs.appendFileSync(path.join(x.dir,'gallery-recovery.cjs'),' ');assert.throws(()=>recovery.original(x.repo,x.target,x.dir,x.spec),/recovery_tool_bytes_changed/);
}));
test('partial old completion cannot be overridden',()=>filesFixture(x=>{
 fs.writeFileSync(path.join(x.oldDir,'MIGRATED.json'),'{}');assert.throws(()=>recovery.original(x.repo,x.target,x.dir,x.spec),/old_attempt_already_complete/);
}));
test('native lock owner mismatch rejects recovery',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gallery-lock-test-'));try{fs.mkdirSync(path.join(dir,'.lock'));fs.writeFileSync(path.join(dir,'.lock/owner'),'token=someone-else\n');assert.throws(()=>recovery.lockOwned(path.join(dir,'stage'),'our-token'),/lock_not_owned/);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
// Run real Bash EXIT trap with a mock ssh which records lock release attempts.
for(const [terminal,success,rc,released]of [[1,0,20,false],[0,0,1,false],[1,1,0,true],[1,1,1,false]])test(`native migration lock terminal=${terminal} success=${success} exit=${rc}`,()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gallery-trap-test-'));try{
  const src=fs.readFileSync(path.join(root,'dev/prepare-migrations.sh'),'utf8'),fn=src.slice(src.indexOf('release_lock() {'),src.indexOf('trap release_lock EXIT'));
  const sh=`LOCK_HELD=1; REMOTE_TERMINAL=${terminal}; CHECKS_SUCCEEDED=${success}; TOKEN=test-token; APP=/app; LOCK=/lock\nSSH=(mock_ssh)\nmock_ssh(){ echo released >> '${dir}/calls'; }\n${fn}\ntrap release_lock EXIT\nexit ${rc}\n`;
  const r=cp.spawnSync('bash',['-c',sh],{encoding:'utf8'});assert.equal(fs.existsSync(path.join(dir,'calls')),released);assert.equal(r.status,rc);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
for(const failure of ['none','restore','terminal','guards','ledger','missing-restored'])test('native completed consumer '+failure,()=>filesFixture(x=>{
 const record=recovery.original(x.repo,x.target,x.dir,x.spec),f=fixture();f.after.server.trust=0;
 const done={before:f.before,after:f.after,guards:{checks:2,guards:8,frozen:false},parameter_restored:0};
 const restored={value:0,server_uuid:'server-a'},term={exit:0,phase:'recovery-003',target:x.target,repo:x.repo};
 if(failure==='restore')restored.value=1;
 if(failure==='terminal')term.exit=1;
 if(failure==='guards')done.guards.guards=7;
 if(failure==='ledger')done.after.ledger[0].batch=999;
 fs.writeFileSync(path.join(x.dir,'RECOVERY-COMPLETE.json'),JSON.stringify(done));
 if(failure!=='missing-restored')fs.writeFileSync(path.join(x.dir,'PARAMETER-RESTORED.json'),JSON.stringify(restored));
 fs.writeFileSync(path.join(x.dir,'TERMINAL.json'),JSON.stringify(term));
 if(failure==='none')assert(recovery.verifyCompletion(x.repo,x.target,x.dir,record,x.spec));
 else assert.throws(()=>recovery.verifyCompletion(x.repo,x.target,x.dir,record,x.spec));
}));
for(const [verified,rc,released]of [[0,1,false],[0,0,false],[1,1,false],[1,0,true]])test(`recovery wrapper retains failed/unknown lock verified=${verified} exit=${rc}`,()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'recovery-exit-'));try{
  const src=fs.readFileSync(path.join(root,'dev/recover-gallery.sh'),'utf8'),fn=src.slice(src.indexOf('finish(){'),src.indexOf('trap finish EXIT'));
  const script=`HELD=1; VERIFIED=${verified}; TOKEN=test-token; APP=/app; LOCK=/lock\nSSH=(mock_ssh)\nmock_ssh(){ echo release >> '${dir}/release'; }\n${fn}\ntrap finish EXIT\nexit ${rc}`;
  const r=cp.spawnSync('bash',['-c',script],{encoding:'utf8'});assert.equal(fs.existsSync(path.join(dir,'release')),released);assert.equal(r.status,rc===0&&!verified?31:rc);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
for(const mode of ['ordinary','recovery','missing-helper','changed-helper','bad-json'])test('deployment helper pin '+mode,()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'recovery-deploy-pin-'));try{
  const source=fs.readFileSync(path.join(root,'dev/deploy.sh'),'utf8');
  const start=source.indexOf("<<'REMOTE'",source.indexOf('# A recovered stage'))+"<<'REMOTE'\n".length;
  const block=source.slice(start,source.indexOf('\nREMOTE',start));
  fs.writeFileSync(path.join(dir,'PREPARED.json'),mode==='bad-json'?'broken':JSON.stringify(mode==='ordinary'?{}:{recovery:{}}));
  const sums=[];for(const name of ['gallery-recovery.cjs','gallery-recovery-incident.json']){const data=fs.readFileSync(path.join(root,'dev',name));sums.push(digest(data));if(mode!=='missing-helper')fs.writeFileSync(path.join(dir,name),data);}
  if(mode==='changed-helper')fs.appendFileSync(path.join(dir,'gallery-recovery.cjs'),'\nchanged');
  const result=cp.spawnSync('bash',['-s','--',dir,...sums],{input:block,encoding:'utf8',env:{...process.env,HOME:dir}});
  assert.equal(result.status===0,['ordinary','recovery'].includes(mode),result.stderr);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

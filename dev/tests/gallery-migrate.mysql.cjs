'use strict';
// Explicit local-only test. Never touches ai_platform or other existing databases.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createRequire}=require('node:module');
const req=createRequire(path.resolve(__dirname,'../../backend/package.json'));
const mysql=req('mysql2/promise'),knexFactory=req('knex');
const tool=require('../gallery-migrate.cjs'),plan=require('../gallery-migration-plan.json');
const app=path.resolve(__dirname,'../../backend');
const password=process.env.DEV_MYSQL_ROOT_PASSWORD;
assert(password,'Local development test credential required');
const connection={host:'127.0.0.1',port:3307,user:'root',password};
let serial=0;
async function fixture(fn){
 const db=`gallery_release_test_${process.pid}_${Date.now()}_${serial++}`;
 const root=await mysql.createConnection(connection);await root.query('CREATE DATABASE '+db);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gallery-release-test-'));fs.chmodSync(dir,0o700);
 const knex=knexFactory({client:'mysql2',connection:{...connection,database:db},pool:{min:0,max:2},migrations:{directory:path.join(app,'migrations')}});
 try {
  for(const media of ['image','video']){
   await knex.schema.createTable(media+'_generations',t=>{
    t.bigInteger('id').primary();t.bigInteger('user_id');t.boolean('is_public').defaultTo(false);t.string('status').defaultTo('success');t.text('prompt');t.text('negative_prompt');t.string(media+'_url');t.string('local_path');t.bigInteger('file_size');t.timestamp('updated_at').defaultTo(knex.fn.now());
   });
   await knex(media+'_generations').insert(plan.historical_public[media].map(id=>({id,user_id:7,is_public:1,prompt:'synthetic',local_path:'/synthetic/'+id,status:'success'})));
  }
  await knex.schema.createTable('knex_migrations',t=>{t.increments('id');t.string('name');t.integer('batch');t.timestamp('migration_time');});
  await knex.schema.createTable('knex_migrations_lock',t=>{t.increments('index');t.integer('is_locked');});
  await knex('knex_migrations_lock').insert({is_locked:0});
  const old=fs.readdirSync(path.join(app,'migrations')).filter(n=>n.endsWith('.js')&&!plan.profiles['gallery-pku'].includes(n));
  await knex('knex_migrations').insert(old.map(name=>({name,batch:1,migration_time:knex.fn.now()})));
  await fn(knex,dir,db);
 }finally{await knex.destroy();await root.query('DROP DATABASE '+db);await root.end();fs.rmSync(dir,{recursive:true,force:true});}
}
const backup={sha256:'a'.repeat(64),gzip_verified:true,writers_stopped:true}; // synthetic backup receipt; not a backup restoration test

test('real MySQL: six exact migrations withdraw approved IDs, enforce CHECK and retain audit/guards',async()=>fixture(async(k,d)=>{
 const snapshot=await tool.inspect(k,app);const result=await tool.apply(k,app,d,'local-test-approval',snapshot,backup);
 assert.deepEqual(result,{checks:2,guards:8,frozen:false});assert(fs.existsSync(path.join(d,'COMPLETE.json')));
 assert.equal((await tool.pending(k)).length,0);
 await assert.rejects(k('image_generations').where('id',22493).update({is_public:1}),e=>e.errno===3819);
 // Confirm the actual installed guard survives old-code style publication attempts.
 await k('gallery_publication_control').where('id',1).update({frozen:1});
 await assert.rejects(k('image_safety').where('generation_id',22493).update({gallery_state:'approved'}),/gallery_publication_frozen/);
 assert.equal((await k('video_generations').where('id',11795).first()).is_public,0);
}));
test('scope guard refuses a seventh public item before DDL',async()=>fixture(async(k,d)=>{
 await k('image_generations').insert({id:999,user_id:7,is_public:1});
 await assert.rejects(tool.inspect(k,app),/historical_public_scope_changed/);
 assert.equal(await k.schema.hasTable('image_safety'),false);assert.equal(fs.readdirSync(d).length,0);
}));
test('changed prompt between snapshot and apply refuses all DDL',async()=>fixture(async(k,d)=>{
 const snapshot=await tool.inspect(k,app);await k('video_generations').where('id',11795).update({prompt:'changed synthetic'});
 await assert.rejects(tool.apply(k,app,d,'local-test',snapshot,backup),/snapshot_changed/);
 assert.equal(await k.schema.hasTable('image_safety'),false);
}));
test('existing partial schema is not accepted as retry-safe',async()=>fixture(async(k)=>{
 await k.schema.createTable('image_safety',t=>t.integer('generation_id'));
 await assert.rejects(tool.inspect(k,app),/partial_schema/);
}));
test('partial DDL failure retains intent, no completion or automatic public restore',async()=>fixture(async(k,d)=>{
 const snapshot=await tool.inspect(k,app),migrator=k.migrate,original=migrator.up.bind(migrator);let calls=0;
 const wrapped=new Proxy(k,{get:(target,key)=>key==='migrate'?migrator:Reflect.get(target,key)});
 migrator.up=async opt=>{const result=await original(opt);if(++calls===2)throw Error('injected disconnect after committed DDL');return result;};
 await assert.rejects(tool.apply(wrapped,app,d,'local-test',snapshot,backup),/injected disconnect/);
 assert(fs.existsSync(path.join(d,'INTENT.json')));assert(!fs.existsSync(path.join(d,'COMPLETE.json')));
 assert.equal((await k('image_generations').where('id',22493).first()).is_public,0);
 assert.equal((await k('video_generations').where('id',11795).first()).is_public,1);
 await assert.rejects(tool.apply(wrapped,app,d,'local-test',snapshot,backup));
 assert.equal(calls,2);
}));
test('new public work during migration stops before global visibility UPDATE',async()=>fixture(async(k,d)=>{
 const snapshot=await tool.inspect(k,app),migrator=k.migrate,original=migrator.up.bind(migrator);let calls=0;
 const wrapped=new Proxy(k,{get:(target,key)=>key==='migrate'?migrator:Reflect.get(target,key)});
 migrator.up=async opt=>{const result=await original(opt);if(++calls===1)await k('image_generations').insert({id:999,user_id:7,is_public:1});return result;};
 await assert.rejects(tool.apply(wrapped,app,d,'local-test',snapshot,backup),/public_content_changed/);
 assert.equal(calls,1);assert.equal((await k('image_generations').where('id',999).first()).is_public,1);
 assert(!fs.existsSync(path.join(d,'COMPLETE.json')));
}));
test('unrelated pending migration and source drift are rejected before DDL',async()=>fixture(async(k,d)=>{
 const temp=path.join(d,'app');fs.mkdirSync(temp);fs.cpSync(path.join(app,'migrations'),path.join(temp,'migrations'),{recursive:true});
 fs.appendFileSync(path.join(temp,'migrations',plan.migrations[0].name),'\n// unreviewed change');
 assert.throws(()=>tool.files(temp),/unreviewed_migration_bytes/);
 const first=await k('knex_migrations').first();await k('knex_migrations').where('id',first.id).delete();
 await assert.rejects(tool.inspect(k,app),/pending_migration_scope_changed/);
}));
test('backup/quiescence evidence missing fails without applying migrations',async()=>fixture(async(k,d)=>{
 const snapshot=await tool.inspect(k,app);
 await assert.rejects(tool.apply(k,app,d,'local-test',snapshot,{...backup,writers_stopped:false}),/missing_backup/);
 assert.equal(await k.schema.hasTable('image_safety'),false);
}));
test('actual local mysqldump gzip SHA and restore preserve six-item preimage',async()=>fixture(async(k,d,db)=>{
 const cp=require('node:child_process'),zlib=require('node:zlib'),crypto=require('node:crypto');
 assert.match(db,/^gallery_release_test_\d+_\d+_\d+$/);
 const dump=cp.execFileSync('docker',['exec','practice-mysql','sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --quick --routines --triggers --no-tablespaces "$1"','sh',db]);
 const packed=zlib.gzipSync(dump),sha=crypto.createHash('sha256').update(packed).digest('hex');
 assert.deepEqual(zlib.gunzipSync(packed),dump);assert.match(sha,/^[a-f0-9]{64}$/);
 const restore=db+'_restore',root=await mysql.createConnection(connection);
 try {
  await root.query('CREATE DATABASE '+restore);
  cp.execFileSync('docker',['exec','-i','practice-mysql','sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot "$1"','sh',restore],{input:zlib.gunzipSync(packed)});
  const copy=knexFactory({client:'mysql2',connection:{...connection,database:restore}});
  try {
   for(const media of ['image','video']){
    const rows=await copy(media+'_generations').where('is_public',1).select('id').orderBy('id');
    assert.deepEqual(rows.map(x=>Number(x.id)),plan.historical_public[media]);
   }
   assert.equal((await copy('knex_migrations').count('* as n'))[0].n,(await k('knex_migrations').count('* as n'))[0].n);
  } finally {await copy.destroy();}
 }finally{await root.query('DROP DATABASE IF EXISTS '+restore);await root.end();}
}));
test('PM2 native prepared flow executes only new three migrations and verifies all guards before completion',async()=>fixture(async(k,d,db)=>{
 const cp=require('node:child_process'),stage=require('../migration-stage.cjs');
 for(const name of plan.profiles['teacher-review'])await k.migrate.up({name});
 const repo=path.join(d,'repo'),backend=path.join(repo,'backend');fs.mkdirSync(path.join(backend,'scripts'),{recursive:true});
 fs.mkdirSync(path.join(backend,'migrations'));fs.writeFileSync(path.join(repo,'.gitignore'),'node_modules/\n');
 fs.writeFileSync(path.join(backend,'package.json'),'{}');
 fs.symlinkSync(path.join(app,'node_modules'),path.join(backend,'node_modules'));
 const cfg=`const path=require('node:path');const database=process.env.GALLERY_LOCAL_TEST_DB;if(!/^gallery_release_test_[0-9_]+$/.test(database||''))throw Error('test database required');module.exports={development:{client:'mysql2',connection:{host:'127.0.0.1',port:3307,user:'root',password:process.env.DEV_MYSQL_ROOT_PASSWORD,database},migrations:{directory:path.join(__dirname,'migrations')}}};`;
 fs.writeFileSync(path.join(backend,'knexfile.js'),cfg);
 // Backup execution is a fixture here; real dump/restore has its own test above.
 fs.writeFileSync(path.join(backend,'scripts/db_backup.sh'),'#!/bin/bash\n[ "$BACKUP_RETENTION" = skip ]\n');
 const git=(...args)=>cp.execFileSync('git',['-C',repo,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');git('config','user.email','test@invalid.local');git('config','user.name','Local test');
 const newNames=plan.profiles['gallery-review'];
 for(const name of fs.readdirSync(path.join(app,'migrations')).filter(n=>n.endsWith('.js')&&!newNames.includes(n)))fs.copyFileSync(path.join(app,'migrations',name),path.join(backend,'migrations',name));
 git('add','.');git('commit','-qm','synthetic parent');const parent=git('rev-parse','HEAD');
 for(const name of newNames)fs.copyFileSync(path.join(app,'migrations',name),path.join(backend,'migrations',name));
 git('add','.');git('commit','-qm','synthetic candidate');const target=git('rev-parse','HEAD');git('checkout','-q',parent);
 const evidence=path.join(d,'migration-'+target);fs.mkdirSync(evidence,{mode:0o700});
 const oldDB=process.env.GALLERY_LOCAL_TEST_DB,oldMode=process.env.NODE_ENV;
 process.env.GALLERY_LOCAL_TEST_DB=db;process.env.NODE_ENV='development';
 try {
  stage.prepare(repo,target,evidence,parent,'gallery-review');
  await stage.run('begin',repo,target,evidence,'local-attempt');
  await stage.run('native',repo,target,evidence,'local-attempt');
  await stage.run('complete',repo,target,evidence,'local-attempt');
  await stage.run('verify-completed',repo,target,evidence);
  assert(fs.existsSync(path.join(evidence,'COMPLETE')));
  assert.equal((await tool.pending(k)).length,0);
  assert.deepEqual(await tool.verifyInstalled(k),{checks:2,guards:8,frozen:false});
  assert.equal(git('rev-parse','HEAD'),parent,'native migrations must not switch application code');
 }finally{
  if(oldDB===undefined)delete process.env.GALLERY_LOCAL_TEST_DB;else process.env.GALLERY_LOCAL_TEST_DB=oldDB;
  if(oldMode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=oldMode;
 }
}));
test('same-name freeze trigger with weakened condition is rejected',async()=>fixture(async(k,d)=>{
 const snapshot=await tool.inspect(k,app);await tool.apply(k,app,d,'local-test',snapshot,backup);
 await k.raw('DROP TRIGGER image_safety_freeze_update');
 await k.raw("CREATE TRIGGER image_safety_freeze_update BEFORE UPDATE ON image_safety FOR EACH ROW BEGIN IF 0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='gallery_publication_frozen'; END IF; END");
 await assert.rejects(tool.verifyInstalled(k),/missing_or_changed_freeze_guard/);
}));

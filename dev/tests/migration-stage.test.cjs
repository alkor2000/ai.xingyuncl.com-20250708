'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const stage=require('../migration-stage.cjs'),plan=require('../gallery-migration-plan.json');
const root=path.resolve(__dirname,'../..');
function fixture(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gallery-stage-')),repo=path.join(dir,'repo');fs.mkdirSync(repo);
 const git=(...args)=>cp.execFileSync('git',['-C',repo,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 try {
  git('init','-q');git('config','user.email','test@invalid.local');git('config','user.name','Local test');
  fs.mkdirSync(path.join(repo,'backend/migrations'),{recursive:true});fs.writeFileSync(path.join(repo,'backend/migrations/.gitkeep'),'');
  git('add','.');git('commit','-qm','parent');const parent=git('rev-parse','HEAD');
  const names=plan.profiles['gallery-review'];for(const n of names)fs.copyFileSync(path.join(root,'backend/migrations',n),path.join(repo,'backend/migrations',n));
  git('add','.');git('commit','-qm','target');const target=git('rev-parse','HEAD');git('checkout','-q',parent);
  const evidence=path.join(dir,'migration-'+target);fs.mkdirSync(evidence,{mode:0o700});
  fn({repo,parent,target,evidence,git});
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('new profile stages only reviewed additions; parent remains unchanged',()=>fixture(x=>{
 const result=stage.prepare(x.repo,x.target,x.evidence,x.parent,'gallery-review');
 assert.equal(result.profile,'gallery-review');assert.equal(x.git('rev-parse','HEAD'),x.parent);
 assert.equal(Object.keys(result.sources).length,3);stage.verify(x.repo,x.target,x.evidence);
}));
test('legacy teacher plan cannot silently stage new gallery migrations',()=>fixture(x=>{
 assert.throws(()=>stage.prepare(x.repo,x.target,x.evidence,x.parent),/migration_delta_not_exact_profile/);
 assert.equal(x.git('status','--porcelain'),'');
}));
test('staged migration tamper refuses verification',()=>fixture(x=>{
 stage.prepare(x.repo,x.target,x.evidence,x.parent,'gallery-review');
 fs.appendFileSync(path.join(x.repo,'backend/migrations',plan.profiles['gallery-review'][0]),'\n// drift');
 assert.throws(()=>stage.verify(x.repo,x.target,x.evidence),/staged_tree_changed|migration_worktree_changed/);
}));
test('changed parent and unknown profile fail before staging',()=>fixture(x=>{
 assert.throws(()=>stage.prepare(x.repo,x.target,x.evidence,'a'.repeat(40),'gallery-review'),/preview_parent_changed/);
 assert.throws(()=>stage.prepare(x.repo,x.target,x.evidence,x.parent,'all'),/unknown_migration_profile/);
 assert.equal(x.git('status','--porcelain'),'');
}));
test('missing completed receipt cannot approve application switching',()=>fixture(x=>{
 stage.prepare(x.repo,x.target,x.evidence,x.parent,'gallery-review');
 assert.throws(()=>stage.verify(x.repo,x.target,x.evidence,true));
}));

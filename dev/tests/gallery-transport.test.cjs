'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {verifyTransport}=require('../gallery-transport.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fixture(fn){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'gallery-transport-')),target='d'.repeat(40),dir=base+'/migration-'+target,owner='token=isolated-transport-token\nsince=fixed\nhost=local\n';
 fs.mkdirSync(dir,{mode:0o700});fs.mkdirSync(base+'/.lock');fs.writeFileSync(base+'/.lock/owner',owner);fs.writeFileSync(dir+'/source.bundle','synthetic bundle');
 const spec={target,lock_token:'isolated-transport-token',lock_owner_sha256:sha(owner),files:{'source.bundle':sha('synthetic bundle')}};
 try{fn({base,dir,spec});}finally{fs.rmSync(base,{recursive:true,force:true});}
}
test('preserved transport bytes and owner are verified without changing the lock',()=>fixture(x=>{
 const before=fs.readFileSync(x.base+'/.lock/owner');assert.equal(verifyTransport(x.base,x.spec).lock_token,x.spec.lock_token);assert.deepEqual(fs.readFileSync(x.base+'/.lock/owner'),before);
 fs.rmSync(x.base+'/.lock',{recursive:true});assert.equal(verifyTransport(x.base,x.spec,false).target,x.spec.target);assert.throws(()=>verifyTransport(x.base,x.spec,true));
}));
for(const fault of ['owner','bytes','extra','symlink','mode'])test('transport continuation refuses '+fault,()=>fixture(x=>{
 if(fault==='owner')fs.appendFileSync(x.base+'/.lock/owner','changed');
 if(fault==='bytes')fs.appendFileSync(x.dir+'/source.bundle','changed');
 if(fault==='extra')fs.writeFileSync(x.dir+'/PARAMETER-INTENT.json','{}');
 if(fault==='symlink'){fs.renameSync(x.dir+'/source.bundle',x.base+'/other');fs.symlinkSync(x.base+'/other',x.dir+'/source.bundle');}
 if(fault==='mode')fs.chmodSync(x.dir,0o755);
 assert.throws(()=>verifyTransport(x.base,x.spec));
}));
test('real shell command-string parsing reproduces old multiline SSH argument failure',()=>{
 const hashes='a'.repeat(64)+'  one.cjs\n'+'b'.repeat(64)+'  two.cjs';
 const r=cp.spawnSync('bash',['-c',['bash','-s','--','stage',hashes].join(' ')],{input:'test "$#" = 2\n',encoding:'utf8'});
 assert.notEqual(r.status,0);assert.match(r.stderr,/command not found/);
});
for(const fault of ['none','changed-byte','truncated-base64','invalid-base64'])test('encoded manifest through shell command string: '+fault,()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'transport-checksum-'));
 try{
  const names=['one.cjs','two.cjs','three.json'];for(const n of names)fs.writeFileSync(dir+'/'+n,'test-'+n);
  const sums=names.map(n=>sha(fs.readFileSync(dir+'/'+n))+'  '+n).join('\n')+'\n';let encoded=Buffer.from(sums).toString('base64');
  if(fault==='changed-byte')fs.appendFileSync(dir+'/two.cjs','changed');
  if(fault==='truncated-base64')encoded=encoded.slice(0,-3);
  if(fault==='invalid-base64')encoded='*invalid*';
  const src=fs.readFileSync(path.join(__dirname,'../recover-gallery.sh'),'utf8');
  const check=src.slice(src.indexOf('[[ "$7" =~'),src.indexOf('\ngit -C "$APP" fetch'));
  const r=cp.spawnSync('bash',['-c',['bash','-s','--','unused',dir,'target','token','approval','bundle',encoded].join(' ')],{input:'set -euo pipefail\nSTAGE=$2\n'+check+'\necho RECOVERY_MAY_START\n',encoding:'utf8'});
  assert.equal(r.status===0,fault==='none',r.stderr);assert.equal(r.stdout.includes('RECOVERY_MAY_START'),fault==='none');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

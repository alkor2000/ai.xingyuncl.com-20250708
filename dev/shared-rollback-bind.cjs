'use strict';
// Identity checks only. An approval reference is required by the owning release flow, not granted here.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const plan=require('./gallery-migration-plan.json');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const ensure=(ok,message)=>{if(!ok)throw Error(message);};
const run=(exe,args)=>cp.execFileSync(exe,args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
function source(repo){
 const expected=plan.compatible_rollback;ensure(expected&&/^[a-f0-9]{40}$/.test(expected.candidate),'missing_compatible_target');
 ensure(run('git',['-C',repo,'rev-parse',expected.candidate+'^'])===expected.base,'fallback_parent_changed');
 for(const [name,digest] of Object.entries(expected.files))ensure(hash(cp.execFileSync('git',['-C',repo,'show',expected.candidate+':'+name]))===digest,'fallback_source_changed');
 return expected.candidate;
}
function image(repo,manifest){
 const candidate=source(repo),m=JSON.parse(fs.readFileSync(manifest));
 ensure(m.source_commit===candidate&&/^sha256:[a-f0-9]{64}$/.test(m.backend_image_id),'fallback_manifest_invalid');
 const actual=JSON.parse(run('docker',['image','inspect',m.backend_image_id]))[0];
 ensure(actual.Id===m.backend_image_id&&actual.Config.Labels?.['org.opencontainers.image.revision']===candidate,'fallback_image_identity_changed');
 const expected=Object.fromEntries(Object.entries(plan.compatible_rollback.files).map(([p,h])=>['/app/'+p.replace(/^backend\//,''),h]));
 const probe="const fs=require('fs'),c=require('crypto');let r={};for(const p of JSON.parse(process.argv[1]))r[p]=c.createHash('sha256').update(fs.readFileSync(p)).digest('hex');console.log(JSON.stringify(r))";
 const got=JSON.parse(run('docker',['run','--rm','--network','none','--entrypoint','node',m.backend_image_id,'-e',probe,JSON.stringify(Object.keys(expected))]));
 ensure(JSON.stringify(got)===JSON.stringify(expected),'fallback_image_gate_changed');
 return m.backend_image_id;
}
function writeOverride(repo,manifest,original,dest){
 const backend=image(repo,manifest),text=fs.readFileSync(original,'utf8');
 ensure((text.match(/image: ai-platform-backend:rollback-[0-9_]+/g)||[]).length===1,'original_backend_binding_invalid');
 ensure(text.includes('command: ["su-exec", "nodejs", "node", "src/server.js"]'),'uncontrolled_startup_migrations');
 fs.writeFileSync(dest,text.replace(/image: ai-platform-backend:rollback-[0-9_]+/,'image: '+backend),{flag:'wx',mode:0o600});
 return backend;
}
module.exports={source,image,writeOverride};
if(require.main===module){try{const [action,repo,...args]=process.argv.slice(2);ensure(['source','image','override'].includes(action),'unknown_action');const result=action==='source'?source(repo):action==='image'?image(repo,args[0]):writeOverride(repo,...args);console.log(result);}catch{console.error('SHARED_ROLLBACK_STOP: identity or fail-closed gate not verified');process.exitCode=2;}}

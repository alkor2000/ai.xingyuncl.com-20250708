'use strict';
// Read-only validation of one preserved pre-execution SSH failure, never an unlock.
function verifyTransport(base,spec,requireLock=true){
 const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
 const ensure=(ok,why)=>{if(!ok)throw Error(why);};
 const regular=p=>{const s=fs.lstatSync(p);ensure(s.isFile()&&!s.isSymbolicLink()&&s.uid===process.getuid(),'transport_not_owned_regular_file');return fs.readFileSync(p);};
 const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
 ensure(spec&&/^[a-f0-9]{40}$/.test(spec.target)&&/^[A-Za-z0-9._-]{8,80}$/.test(spec.lock_token),'transport_incident_missing');
 const dir=path.join(base,'migration-'+spec.target),s=fs.lstatSync(dir);
 ensure(s.isDirectory()&&!s.isSymbolicLink()&&fs.realpathSync(dir)===dir&&(s.mode&0o777)===0o700&&s.uid===process.getuid(),'transport_stage_not_private');
 ensure(JSON.stringify(fs.readdirSync(dir).sort())===JSON.stringify(Object.keys(spec.files).sort()),'transport_stage_entries_changed');
 for(const [name,hash]of Object.entries(spec.files)){
  ensure(/^[a-zA-Z0-9_.-]+$/.test(name)&&/^[a-f0-9]{64}$/.test(hash),'transport_manifest_invalid');
  ensure(sha(regular(path.join(dir,name)))===hash,'transport_stage_bytes_changed:'+name);
 }
 if(requireLock){
  const lock=path.join(base,'.lock'),ls=fs.lstatSync(lock);
  ensure(ls.isDirectory()&&!ls.isSymbolicLink()&&fs.realpathSync(lock)===lock&&ls.uid===process.getuid(),'transport_lock_invalid');
  const owner=regular(path.join(lock,'owner'));
  ensure(sha(owner)===spec.lock_owner_sha256&&owner.toString().split('\n').includes('token='+spec.lock_token),'transport_lock_owner_changed');
 }
 return {target:spec.target,lock_token:spec.lock_token,files:spec.files,lock_owner_sha256:spec.lock_owner_sha256};
}
module.exports={verifyTransport};

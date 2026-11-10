'use strict';
// No code switch here. Commit freeze, verify exact guards + control + latest audit,
// then issue a durable receipt which the rollback operator must freshly recheck.
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const {verifyInstalled,save}=require('./gallery-migrate.cjs');
const ensure=(ok,message)=>{if(!ok)throw Error(message);};
async function identity(knex){const [[row]]=await knex.raw('SELECT @@server_uuid AS server_uuid,DATABASE() AS database_name');return row;}
async function verifyFreeze(knex,receipt,approval){
 ensure(receipt.version===1&&receipt.approval===approval&&receipt.audit_id,'freeze_receipt_mismatch');
 ensure(JSON.stringify(await identity(knex))===JSON.stringify(receipt.database),'freeze_database_changed');
 await verifyInstalled(knex,true);
 const control=await knex('gallery_publication_control').where('id',1).first();
 const audit=await knex('gallery_publication_control_events').orderBy('id','desc').first();
 ensure(control&&Number(control.frozen)===1&&control.reason===receipt.reason,'freeze_control_readback_failed');
 ensure(audit&&String(audit.id)===String(receipt.audit_id)&&Number(audit.frozen)===1&&audit.approval_reference===approval&&audit.reason===receipt.reason,'freeze_audit_readback_failed');
 return {frozen:true,guards:8,audit_id:receipt.audit_id,approval};
}
async function freezeAndVerify(knex,approval){
 ensure(/^[A-Za-z0-9_.:-]{1,200}$/.test(approval),'approval_reference_required');
 await verifyInstalled(knex,null);
 const database=await identity(knex),reason='Application rollback: '+approval;
 const audit_id=await knex.transaction(async trx=>{
  const row=await trx('gallery_publication_control').where('id',1).forUpdate().first();
  ensure(row,'missing_freeze_control');
  await trx('gallery_publication_control').where('id',1).update({frozen:1,reason,updated_at:trx.fn.now()});
  const [id]=await trx('gallery_publication_control_events').insert({frozen:1,approval_reference:approval,reason});return id;
 });
 const receipt={version:1,database,approval,reason,audit_id};
 // This read happens AFTER transaction commit, not against an uncommitted promise.
 await verifyFreeze(knex,receipt,approval);return receipt;
}
module.exports={freezeAndVerify,verifyFreeze};
if(require.main===module){
 (async()=>{
  const [action,app,dir,approval]=process.argv.slice(2);
  ensure(['apply','verify'].includes(action)&&/^[A-Za-z0-9_.:-]{1,200}$/.test(approval),'invalid_arguments');
  const st=fs.lstatSync(dir);ensure(st.isDirectory()&&!st.isSymbolicLink()&&(st.mode&0o077)===0,'evidence_not_private');
  const req=createRequire(path.join(app,'package.json')),config=req(path.join(app,'knexfile.js'))[process.env.NODE_ENV||'development'];
  const knex=req('knex')({...config,pool:{min:0,max:2}});
  try{
   if(action==='apply'){
    save(dir,'FREEZE-INTENT.json',{approval,action:'freeze_before_application_rollback'});
    const receipt=await freezeAndVerify(knex,approval);save(dir,'FREEZE-VERIFIED.json',receipt);
   }else await verifyFreeze(knex,JSON.parse(fs.readFileSync(path.join(dir,'FREEZE-VERIFIED.json'))),approval);
   console.log('GALLERY_FREEZE_COMMITTED_AND_VERIFIED');
  }finally{await knex.destroy();}
 })().catch(()=>{console.error('FREEZE_GATE_STOP: no application rollback; retain lock and inspect committed state/audit; no blind retry');process.exitCode=1;});
}

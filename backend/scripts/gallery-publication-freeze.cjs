/* Deployment operator only. Run the reviewed --apply --approval-reference command
 * BEFORE rolling back application code. A CLI flag is not production approval.
 * This tool intentionally has no thaw action: re-enable only under a new reviewed
 * release after current policy/model evidence and all guards are verified. */
const db=require('../src/database/connection');
async function freeze(approvalReference,reason){
  if(typeof approvalReference!=='string'||!approvalReference.trim()||approvalReference.length>200||typeof reason!=='string'||!reason.trim()||reason.length>500)throw Error('Explicit approval reference and reason required');
  return db.transaction(async query=>{
    const {rows}=await query("SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME LIKE '%\\_freeze\\_%'");
    const names=new Set(rows.map(x=>x.TRIGGER_NAME));
    for(const media of ['image','video'])for(const kind of ['generations','safety'])for(const op of ['insert','update'])if(!names.has(`${media}_${kind}_freeze_${op}`))throw Error('Missing rollback freeze guard; do not roll back application');
    const {rows:control}=await query('SELECT frozen FROM gallery_publication_control WHERE id=1 FOR UPDATE');
    if(control.length!==1)throw Error('Missing freeze control');
    await query('UPDATE gallery_publication_control SET frozen=1,reason=?,updated_at=NOW() WHERE id=1',[reason]);
    await query('INSERT INTO gallery_publication_control_events (frozen,approval_reference,reason) VALUES (1,?,?)',[approvalReference,reason]);
    return {frozen:true,guards:8,approvalReference};
  });
}
module.exports={freeze};
if(require.main===module){
  const args=process.argv.slice(2),arg=k=>args.find(v=>v.startsWith(`--${k}=`))?.slice(k.length+3);
  if(!args.includes('--apply'))console.log('Dry run: freeze publication/submission/approval/restoration before rollback; retain all tables and triggers. No database connection.');
  else (async()=>{await db.initialize();const receipt=await freeze(arg('approval-reference'),arg('reason'));const {rows}=await db.query('SELECT frozen FROM gallery_publication_control WHERE id=1');if(Number(rows[0]?.frozen)!==1)throw Error('Freeze readback failed; do not rollback');console.log(JSON.stringify(receipt));})().catch(()=>{console.error('Freeze failed or uncertain: stop rollback and verify current state; do not retry blindly.');process.exitCode=1;}).finally(()=>db.close());
}

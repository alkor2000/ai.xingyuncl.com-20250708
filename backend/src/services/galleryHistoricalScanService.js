// Explicit operator write path; never invoked by the readonly scanner or HTTP list.
// The approved manifest binds the scan and fresh expected states. No auto-publication.
const db=require('../database/connection');
const {createHash}=require('node:crypto');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const columns=new Set(['id','status','is_public','prompt','negative_prompt','local_path','image_url','video_url','oss_video_url','updated_at','created_at']);
async function apply(manifest,approvalReference){
  const {snapshot,scan,expected}=manifest||{};
  if(typeof approvalReference!=='string'||!approvalReference.trim()||approvalReference.length>200||snapshot?.schemaVersion!==1||!Array.isArray(snapshot.works)||!snapshot.works.length||snapshot.works.length>100||scan?.snapshotSha256!==hash(snapshot)||!Array.isArray(scan.results)||!Array.isArray(expected)||expected.length!==snapshot.works.length||scan.results.length!==expected.length)throw Error('Invalid or unbound approved scan manifest');
  const seen=new Set();
  for(const work of snapshot.works){
    const key=`${work.media}:${work.id}`;
    if(!['image','video'].includes(work.media)||!Number.isSafeInteger(Number(work.id))||Number(work.id)<1||seen.has(key)||Number(work.is_public)!==1||!['id','status','prompt'].every(k=>Object.hasOwn(work,k))||Object.keys(work).some(k=>k!=='media'&&!columns.has(k)))throw Error('Invalid snapshot work');
    seen.add(key);
    const rows=scan.results.filter(x=>x.media===work.media&&String(x.id)===String(work.id)),states=expected.filter(x=>x.media===work.media&&String(x.id)===String(work.id));
    if(rows.length!==1||states.length!==1||rows[0].snapshotSha256!==hash(work)||!['allow','review','reject'].includes(rows[0].modelDecision)||!Number.isSafeInteger(states[0].revision)||![0,1].includes(states[0].isPublic)||!['private','pending','approved'].includes(states[0].galleryState))throw Error('Scan/expected binding mismatch');
  }
  // All listed works are checked before writes, in one transaction. Drift fails all.
  return db.transaction(async query=>{
    const locked=[];
    for(const work of [...snapshot.works].sort((a,b)=>a.media.localeCompare(b.media)||Number(a.id)-Number(b.id))){
      const media=work.media,id=work.id,keys=Object.keys(work).filter(k=>k!=='media');
      const {rows:w}=await query(`SELECT ${keys.join(',')} FROM ${media}_generations WHERE id=? FOR UPDATE`,[id]);
      const {rows:s}=await query(`SELECT * FROM ${media}_safety WHERE generation_id=? FOR UPDATE`,[id]);
      const before=expected.find(x=>x.media===media&&String(x.id)===String(id));
      const {rows:prior}=await query('SELECT snapshot_hash FROM gallery_scan_actions WHERE media=? AND generation_id=? AND snapshot_hash=?',[media,id,scan.snapshotSha256]);
      if(prior.length)throw Error('Scan already applied; inspect prior receipt without replay');
      if(!w[0]||!s[0]||Number(s[0].revision)!==before.revision||Number(w[0].is_public)!==before.isPublic||s[0].gallery_state!==before.galleryState||keys.some(k=>k!=='is_public'&&!same(w[0][k],work[k])))throw Error('Historical work changed; refresh manifest and approval before applying');
      locked.push({work,current:s[0],before,row:scan.results.find(x=>x.media===media&&String(x.id)===String(id))});
    }
    const receipts=[];
    for(const {work,current,before,row} of locked){
      const media=work.media,id=work.id,next=row.modelDecision==='reject'?'rejected':'pending';
      // Even a historical allow needs human review. Never store old scan results
      // as current reusable machine evidence: approval must use a fresh bound check.
      await query('INSERT INTO gallery_scan_actions (media,generation_id,snapshot_hash,evidence,preimage,approval_reference) VALUES (?,?,?,?,?,?)',[media,id,scan.snapshotSha256,JSON.stringify(row),JSON.stringify({expected:before,safety:current}),approvalReference]);
      await query(`UPDATE ${media}_generations SET is_public=0,gallery_approved_by=NULL WHERE id=?`,[id]);
      await query(`UPDATE ${media}_safety SET gallery_state=?,gallery_reason=?,revision=revision+1 WHERE generation_id=?`,[next,`Historical scan ${row.modelDecision}; complete current review required`,id]);
      // Invalidate any cached approval evidence, retaining it in the scan audit.
      const {rows:old}=await query('SELECT * FROM gallery_machine_reviews WHERE media=? AND generation_id=?',[media,id]);
      if(old[0])await query('UPDATE gallery_scan_actions SET preimage=? WHERE media=? AND generation_id=? AND snapshot_hash=?',[JSON.stringify({expected:before,safety:current,machine:old[0]}),media,id,scan.snapshotSha256]);
      await query("UPDATE gallery_machine_reviews SET policy_version='historical-scan-invalidated' WHERE media=? AND generation_id=?",[media,id]);
      const audit=media==='image'?require('./imageSafetyService').event:require('./videoSafetyService').event;
      await audit(query,id,null,'historical_scan_withdrawal',next,`snapshot:${scan.snapshotSha256}`,current.sha256||null);
      const {rows:after}=await query(`SELECT g.is_public,s.gallery_state,s.revision FROM ${media}_generations g JOIN ${media}_safety s ON s.generation_id=g.id WHERE g.id=?`,[id]);
      if(Number(after[0].is_public)!==0||after[0].gallery_state!==next||Number(after[0].revision)!==before.revision+1)throw Error('Scan write verification failed');
      receipts.push({media,id,isPublic:0,galleryState:next,revision:after[0].revision});
    }
    return {applied:receipts.length,results:receipts};
  });
}
module.exports={apply};

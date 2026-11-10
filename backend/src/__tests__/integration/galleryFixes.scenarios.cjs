module.exports=async({assert,knex,db,safety,review,teacher,sharp,machine,ImageGeneration,realAdapters})=>{
 const queue=require('../../services/galleryReviewQueueService');
 const original=machine.adapters,ok=async()=>({decision:'allow',mapDetected:false,scores:{sexual:0,violence:0,disgust:0,discrimination:0,political:0,minors:0,map:0}});
 const raw=await sharp({create:{width:128,height:128,channels:3,background:'#13ab43'}}).png().toBuffer();
 const fresh=async(id)=>{await knex('image_generations').insert({id,user_id:7,prompt:'normal garden'});await safety.capture(id,7,raw);await safety.publish(id,7);await review.decide(id,teacher,'approved','Complete fixture inspected',(await safety.get(id)).revision);};
 // Actual configured fields, including credential and endpoint changes, alter the
 // opaque config revision; no real provider request is sent.
 await knex.schema.createTable('ai_models',t=>{t.integer('id').primary();t.string('name');t.string('api_endpoint');t.string('api_key');t.boolean('image_upload_enabled');t.boolean('is_active');t.timestamp('updated_at').defaultTo(knex.fn.now());});
 await knex('ai_models').insert([45,48].map(id=>({id,name:'fixture',api_endpoint:'https://invalid.example/v1',api_key:'synthetic-only',image_upload_enabled:true,is_active:true})));
 let last=(await realAdapters()).modelRevision;
 for(const change of [{api_endpoint:'https://invalid-two.example/v1'},{api_key:'synthetic-revised'},{image_upload_enabled:false},{is_active:false},{name:'new-fixture'}]){
   await knex('ai_models').where({id:48}).update(change);const current=(await realAdapters()).modelRevision;assert.notEqual(current,last);last=current;
 }
 await fresh(701);
 // A thrown visual adapter must revoke gallery AND controlled media visibility.
 machine.adapters=async()=>({textModel:ok,visionModel:async()=>{throw Error('offline');},modelRevision:'failed-vision-config'});
 assert.equal((await queue.recheck('image',701,teacher)).decision,'review');
 assert.equal((await knex('image_generations').where({id:701}).first()).is_public,0);
 assert.equal((await safety.get(701)).gallery_state,'pending');
 assert.ok((await queue.list('image',teacher,{state:'pending'})).data.some(x=>Number(x.id)===701));
 assert.ok(!(await ImageGeneration.getPublicGallery()).data.some(x=>Number(x.id)===701));
 await assert.rejects(safety.asset(701,{id:8,role:'user'}),/不可访问/);
 assert.ok((await knex('image_safety_events').where({generation_id:701,action:'machine_withdrawal'})).length);
 machine.adapters=original;
 // Explicit uncertainty, malformed response and absent visual adapter all use
 // the same fail-closed transaction as exceptions (timeout is covered in library).
 for(const visionModel of [async()=>({...await ok(),decision:'review'}),async()=>({unexpected:true}),undefined]){
  await queue.recheck('image',701,teacher);await review.decide(701,teacher,'approved','before unavailable recheck',(await safety.get(701)).revision);
  machine.adapters=async()=>({textModel:ok,visionModel,modelRevision:'uncertain-fixture'});
  assert.equal((await queue.recheck('image',701,teacher)).decision,'review');
  assert.equal((await knex('image_generations').where({id:701}).first()).is_public,0);
  assert.equal((await safety.get(701)).gallery_state,'pending');
  machine.adapters=original;
 }
 await queue.recheck('image',701,teacher);
 let calls=0;
 machine.adapters=async()=>({textModel:async()=>{calls++;return ok();},visionModel:async()=>{calls++;return ok();},modelRevision:'new-config'});
 // A fresh UI revision cannot batch-approve evidence created with the old model.
 const batch=await queue.batch('image',teacher,{state:'approved',reason:'fixture',confirmed:true,items:[{id:701,revision:(await safety.get(701)).revision}]});
 assert.equal(batch.applied,0);assert.equal(calls,0);
 const changed=await machine.inspect('image',701);assert.equal(calls,2);
 machine.adapters=async()=>({textModel:ok,visionModel:ok,modelRevision:'changed-during-check'});
 await assert.rejects(db.transaction(async query=>{const {rows:w}=await query('SELECT id,status,prompt,negative_prompt FROM image_generations WHERE id=701');const {rows:s}=await query('SELECT * FROM image_safety WHERE generation_id=701');await machine.save(query,'image',w[0],s[0],changed);}),/配置或标准/);
 machine.adapters=original;await queue.recheck('image',701,teacher);
 const record=await knex('gallery_machine_reviews').where({media:'image',generation_id:701}).first(),result=typeof record.result==='string'?JSON.parse(record.result):record.result;
 await knex('gallery_machine_reviews').where({media:'image',generation_id:701}).update({result:JSON.stringify({...result,policySha256:'0'.repeat(64)})});
 await assert.rejects(review.decide(701,teacher,'approved','stale policy',(await safety.get(701)).revision),/重新运行/);
 await queue.recheck('image',701,teacher);await review.decide(701,teacher,'approved','new policy checked',(await safety.get(701)).revision);
 // Six synthetic historical works (two images, four videos), stored scan failures.
 await fresh(702);
 for(const id of [703,704,705,706]){await knex('video_generations').insert({id,user_id:7,prompt:'normal garden',is_public:1,gallery_approved_by:9});await knex('video_safety').insert({generation_id:id,state:'pass',gallery_state:'approved'});}
 const works=[];for(const id of [701,702,703,704,705,706]){const media=id<703?'image':'video';const w=await knex(`${media}_generations`).select('id','status','is_public','prompt','negative_prompt').where({id}).first();works.push({media,...w});}
 const snapshot={schemaVersion:1,works};
 const {scanSnapshot,applyApprovedScan}=await import('../../../scripts/gallery-review-scan.mjs');
 const scan=await scanSnapshot(snapshot,{reviewer:ok,loadMedia:async()=>{throw Error('media unavailable');}});
 const expected=[];for(const work of works){const s=await knex(`${work.media}_safety`).where({generation_id:work.id}).first();expected.push({media:work.media,id:work.id,revision:s.revision,isPublic:1,galleryState:'approved'});}
 const manifest={snapshot,scan,expected};
 // All-or-nothing drift handling; no early item is hidden on a later CAS failure.
 await knex('video_safety').where({generation_id:706}).increment('revision',1);
 await assert.rejects(applyApprovedScan(manifest,{approvalReference:'local-fixture-only'}),/changed/);
 assert.equal((await knex('image_generations').where({id:701}).first()).is_public,1);
 expected.at(-1).revision++;
 const receipt=await applyApprovedScan(manifest,{approvalReference:'local-fixture-only'});assert.equal(receipt.applied,6);
 for(const w of works){assert.equal((await knex(`${w.media}_generations`).where({id:w.id}).first()).is_public,0);assert.equal((await knex(`${w.media}_safety`).where({generation_id:w.id}).first()).gallery_state,'pending');}
 assert.equal((await knex('gallery_scan_actions')).length,6);
 await assert.rejects(applyApprovedScan(manifest,{approvalReference:'local-fixture-only'}),/already applied/);
 await assert.rejects(review.decide(701,teacher,'approved','old allow invalidated',(await safety.get(701)).revision),/重新运行/);
 // A service-level interruption before evidence persistence cannot retain public
 // access. This is stronger than merely catching a model adapter exception.
 machine.adapters=original;await queue.recheck('image',702,teacher);await review.decide(702,teacher,'approved','before interruption',(await safety.get(702)).revision);
 const inspect=machine.inspect;machine.inspect=async()=>{throw Error('interrupted check');};
 await assert.rejects(queue.recheck('image',702,teacher),/interrupted/);
 machine.inspect=inspect;
 assert.equal((await knex('image_generations').where({id:702}).first()).is_public,0);
 assert.equal((await safety.get(702)).gallery_state,'pending');
 await assert.rejects(review.decide(702,teacher,'approved','interrupted stale result',(await safety.get(702)).revision),/重新运行/);
 // Recheck before parent rollback test supplies valid private bytes for old parent.
 await queue.recheck('image',702,teacher);
 // Reject stays private and remains unapprovable.
 await knex('image_generations').where({id:701}).update({prompt:'吃屎'});await queue.recheck('image',701,teacher);assert.equal((await safety.get(701)).gallery_state,'rejected');
 await require('../../../scripts/gallery-publication-freeze.cjs').freeze('local-fixture-only','Rollback rehearsal');
 assert.equal((await knex('gallery_publication_control').first()).frozen,1);
 // Old applications do not know the flag. Their actual DB writes still fail.
 await assert.rejects(knex('image_safety').where({generation_id:701}).update({gallery_state:'pending'}),/gallery_publication_frozen/);
 for(const media of ['image','video']){
  const id=media==='image'?702:703;
  await assert.rejects(knex(`${media}_safety`).where({generation_id:id}).update({gallery_state:'approved'}),/gallery_publication_frozen/);
  await assert.rejects(knex(`${media}_generations`).where({id}).update({is_public:1,gallery_approved_by:9}),/gallery_publication_frozen/);
  await assert.rejects(knex(`${media}_generations`).insert({id:799,user_id:7,is_public:1,gallery_approved_by:9}),/gallery_publication_frozen/);
 }
 if(process.env.GALLERY_ROLLBACK_PARENT){
  const path=require('node:path');const parent=process.env.GALLERY_ROLLBACK_PARENT;
  const conn=require.resolve(path.join(parent,'backend/src/database/connection.js'));
  require.cache[conn]={id:conn,filename:conn,loaded:true,exports:db};
  const parentSafety=require(path.join(parent,'backend/src/services/imageSafetyService.js'));
  const parentReview=require(path.join(parent,'backend/src/services/galleryReviewService.js'));
  await assert.rejects(parentSafety.publish(701,7),/gallery_publication_frozen/);
  await assert.rejects(parentReview.decide(702,teacher,'approved','Parent rollback attempt',(await safety.get(702)).revision),/gallery_publication_frozen/);
  console.log('PASS actual ed1f67c parent resubmit/approve denied with persistent freeze');
 }
 assert.equal((await knex('gallery_machine_reviews').where({media:'image',generation_id:701}).first()).decision,'reject');
 assert.equal((await knex('image_generations').where({id:701}).first()).is_public,0);
 machine.adapters=original;
 console.log('PASS fixes: model failure withdrawal; config/secret/endpoint/active freshness; stale batch/policy/config-race denial; six-work atomic scan queue+audit; persistent rollback guards');
};

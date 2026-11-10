module.exports=async({assert,knex,db,safety,review,teacher,sharp,machine,ImageGeneration})=>{
  const queue=require('../../services/galleryReviewQueueService');
  const bytes=await sharp({create:{width:128,height:128,channels:3,background:'#ab34ef'}}).png().toBuffer();
  await knex('users').insert({id:17,username:'other class fixture',group_id:11,role:'user'});
  const works=[{id:601,prompt:'正常校园花园',user_id:7},{id:602,prompt:'吃屎',user_id:7},{id:603,prompt:'在反歧视教学中引用辱骂句并解释其伤害',user_id:7},{id:604,prompt:'中国地图教学插图',user_id:7},{id:605,prompt:'普通花园',user_id:17},{id:606,prompt:'安全教学图',user_id:7}];
  for(const work of works){await knex('image_generations').insert(work);await safety.capture(work.id,work.user_id,await sharp({create:{width:128,height:128,channels:3,background:{r:work.id%255,g:120,b:80}}}).png().toBuffer());await safety.publish(work.id,work.user_id);}
  assert.equal((await safety.get(602)).gallery_state,'rejected');
  assert.equal((await knex('image_generations').where({id:602}).first()).is_public,0);
  const rejected=await safety.project({id:602,local_path:null});assert.equal(rejected.machine_review.decision,'reject');assert.ok(rejected.gallery_reason);
  const a=await queue.list('image',teacher,{machine:'allow',state:'pending',group_id:10});assert.ok(a.data.some(x=>Number(x.id)===601));assert.ok(!a.data.some(x=>Number(x.id)===605));
  assert.equal((await queue.list('image',teacher,{group_id:11,state:'pending'})).total,0);
  assert.ok((await queue.list('image',{id:99,role:'super_admin'},{group_id:11,state:'pending'})).data.some(x=>Number(x.id)===605));
  assert.equal((await queue.groups(teacher)).length,1);
  assert.equal((await queue.list('image',teacher,{state:'pending',from:'2999-01-01'})).total,0);
  const row=async id=>({id,revision:(await safety.get(id)).revision});
  const send=async items=>queue.batch('image',teacher,{state:'approved',reason:'Reviewed selected works',confirmed:true,items});
  // Mixed group selection is rejected before any mutation, even when valid IDs come first.
  await assert.rejects(send([await row(601),await row(605)]),e=>e.statusCode===404);
  assert.equal((await safety.get(601)).gallery_state,'pending');
  // An old UI cannot batch-approve a map, uncertain case, or a machine rejection.
  const guarded=await send([await row(602),await row(603),await row(604)]);
  assert.equal(guarded.applied,0);assert.equal(guarded.failed,3);
  const outdated=await row(606);await safety.publish(606,7);
  const partial=await send([await row(601),outdated]);assert.equal(partial.applied,1);assert.equal(partial.failed,1);
  assert.ok((await ImageGeneration.getPublicGallery()).data.some(x=>Number(x.id)===601));
  assert.ok(!(await ImageGeneration.getPublicGallery()).data.some(x=>Number(x.id)===606));
  // A map can pass only through the individually reviewed action, still with valid bytes.
  await review.decide(604,teacher,'approved','Verified official map source and approval ID',(await safety.get(604)).revision,{mapReview:{source:'Synthetic official map test source',approval:'fixture-approval-1',usage:'Classroom fixture only'}});
  assert.equal((await safety.get(604)).gallery_state,'approved');
  await assert.rejects(queue.batch('image',teacher,{state:'rejected',reason:'x',confirmed:true,items:[await row(603),await row(603)]}),e=>e.statusCode===400);
  const rejectedBatch=await queue.batch('image',teacher,{state:'rejected',reason:'Needs a complete quotation',confirmed:true,items:[await row(603)]});assert.equal(rejectedBatch.applied,1);
  // Content mutation invalidates previously allowed evidence even with a fresh revision.
  await safety.publish(606,7);await knex('image_generations').where({id:606}).update({prompt:'changed after review'});
  await assert.rejects(review.decide(606,teacher,'approved','stale evidence',(await safety.get(606)).revision),e=>e.statusCode===409);
  const staleInspection=await machine.inspect('image',606,{force:true});
  await queue.recheck('image',606,teacher);
  await assert.rejects(db.transaction(async query=>{const {rows:w}=await query('SELECT id,status,prompt,negative_prompt FROM image_generations WHERE id=606 FOR UPDATE');const {rows:s}=await query('SELECT * FROM image_safety WHERE generation_id=606 FOR UPDATE');await machine.save(query,'image',w[0],s[0],staleInspection);}),e=>e.statusCode===409);
  await review.decide(606,teacher,'approved','checked current evidence',(await safety.get(606)).revision);
  console.log('PASS machine + batch: forced human gate, reject denial, U02 regression, group/date filters, scoped selection, map individual guard, mixed-scope all-denied, stale partial outcome, changed-content evidence rejection and recheck');
};

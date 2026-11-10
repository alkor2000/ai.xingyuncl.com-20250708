module.exports = async function scenarios(ctx) {
  const {assert,knex,safety,video,review,teacher,ImageGeneration,VideoGeneration,provider,sharp,videoStore,Readable,base,teacherHeaders} = ctx;
  const moderation = require('../../services/galleryModerationService');
  provider.image = async () => ({state:'pass',reason:'fixture'});
  for (const media of ['image','video']) {
    const service = media === 'image' ? safety : video;
    const reviewer = media === 'image' ? review : video;
    const model = media === 'image' ? ImageGeneration : VideoGeneration;
    const id = media === 'image' ? 301 : 401;
    await knex(`${media}_generations`).insert({id,user_id:7,prompt:'Moderation fixture'});
    if (media === 'image') {
      const bytes = await sharp({create:{width:200,height:200,channels:3,background:'#ef8912'}}).png().toBuffer();
      await service.capture(id,7,bytes);
    } else {
      const artifact = await videoStore.putStream(Readable.from(Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom00000000moderation fixture')])));
      await service.capture(id,7,artifact);
    }
    await service.publish(id,7);
    await reviewer.decide(id,teacher,'approved','Reviewed fixture',(await service.get(id)).revision);
    const url = base.replace('/image',`/${media}`);
    const post = async (route,body,headers=teacherHeaders) => fetch(`${url}/${route}`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});
    let revision = (await service.get(id)).revision;
    const down = {action:'down',reason:'Unsuitable for this gallery',revision};
    assert.equal((await post(`gallery-review/${id}/visibility`,down,{'x-test-user':'8','x-test-role':'user'})).status,403);
    assert.equal((await post(`gallery-review/${id}/visibility`,down,{...teacherHeaders,'x-test-group':'11'})).status,404);
    assert.equal((await post(`gallery-review/${id}/visibility`,down,{...teacherHeaders,'x-test-user':'7','x-test-role':'super_admin'})).status,403);
    assert.equal((await post(`gallery-review/${id}/visibility`,{...down,revision:revision-1})).status,409);
    assert.equal((await post(`gallery-review/${id}/visibility`,down)).status,200);
    assert.equal((await service.get(id)).gallery_state,'removed');
    assert.ok(!(await model.getPublicGallery()).data.some(x=>Number(x.id)===id));
    assert.equal((await fetch(`${url}/generation/${id}/asset`,{headers:{'x-test-user':'8',Range:'bytes=0-9'}})).status,404);
    const own = await fetch(`${url}/generation/${id}/asset`);
    assert.equal(own.status,200); assert.equal(own.headers.get('cache-control'),'private, no-store'); await own.arrayBuffer();
    assert.equal((await service.project({id,user_id:7,is_public:0,local_path:null})).gallery_reason,down.reason);
    await assert.rejects(service.publish(id,7),e=>e.statusCode===409);
    const restore = {action:'restore',reason:'Rechecked the complete work',revision:(await service.get(id)).revision,reviewed:true};
    await assert.rejects(moderation.visibility(media,id,teacher,{...restore,reviewed:false}),e=>e.statusCode===400);
    await knex('image_safety_restrictions').insert({user_id:7,restricted:true,reason:'test restriction',actor_id:9});
    await assert.rejects(moderation.visibility(media,id,teacher,restore),e=>e.statusCode===409);
    await knex('image_safety_restrictions').where({user_id:7}).delete();
    await knex(`${media}_generations`).where({id}).update({status:'failed'});
    await assert.rejects(moderation.visibility(media,id,teacher,restore),e=>e.statusCode===409);
    await knex(`${media}_generations`).where({id}).update({status:media==='image'?'success':'succeeded'});
    assert.equal((await post(`gallery-review/${id}/visibility`,restore)).status,200);
    assert.ok((await model.getPublicGallery()).data.some(x=>Number(x.id)===id));
    assert.equal((await service.project({id,local_path:null})).gallery_reason,null);
    const report = {category:'discrimination',reason:'Please review the context'};
    await assert.rejects(moderation.report(media,id,{id:7},report),e=>e.statusCode===404);
    await assert.rejects(moderation.report(media,id,{id:8},{...report,category:'unknown'}),e=>e.statusCode===400);
    const first = await moderation.report(media,id,{id:80},report);
    assert.equal(first.temporarily_hidden,false);
    assert.equal((await reviewer.list(teacher,'reported',1)).total,1);
    assert.equal((await service.get(id)).gallery_state,'approved');
    assert.equal((await moderation.report(media,id,{id:80},report)).duplicate,true);
    // Two simultaneous distinct reports serialize behind the generation row lock.
    const concurrent = await Promise.all([81,82].map(idUser=>moderation.report(media,id,{id:idUser},report)));
    assert.equal(concurrent.filter(x=>x.temporarily_hidden).length,1);
    assert.equal((await service.get(id)).gallery_state,'reported');
    assert.equal((await knex(`${media}_safety_reports`).where({generation_id:id})).length,3);
    assert.equal((await knex('image_safety_restrictions').where({user_id:7})).length,0);
    assert.ok(!(await model.getPublicGallery()).data.some(x=>Number(x.id)===id));
    await assert.rejects(service.publish(id,7),e=>e.statusCode===409);
    assert.equal((await reviewer.list(teacher,'reported',1)).total,1);
    assert.equal((await reviewer.list({...teacher,group_id:11},'reported',1)).total,0);
    const history = await moderation.history(media,id,teacher);
    assert.ok(history.events.some(x=>x.action==='gallery_takedown'&&Number(x.actor_id)===teacher.id&&x.created_at));
    assert.ok(history.events.some(x=>x.action==='gallery_restore'&&Number(x.actor_id)===teacher.id));
    assert.ok(history.events.filter(x=>x.action==='gallery_report').every(x=>x.actor_id===null));
    assert.ok(history.reports.every(x=>!Object.hasOwn(x,'user_id')));
    await moderation.visibility(media,id,teacher,{...restore,revision:(await service.get(id)).revision});
    assert.equal((await knex(`${media}_safety_reports`).where({generation_id:id}).whereNull('resolved_at')).length,0);
    assert.equal((await moderation.report(media,id,{id:80},report)).temporarily_hidden,false);
    assert.equal((await knex(`${media}_safety_reports`).where({generation_id:id})).length,3);
    // A second moderator cannot apply a decision based on the stale pre-restoration version.
    await assert.rejects(moderation.visibility(media,id,teacher,restore),e=>e.statusCode===409);
    console.log(`PASS ${media}: scoped down/restore, CAS, owner retention, asset/public withdrawal, distinct-report race, no identity leak, audit, restrictions, report resolution`);
  }
  const exportDb=await require('mysql2/promise').createConnection({host:'127.0.0.1',port:3307,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
  try {
    const snapshot=await require('../../../scripts/gallery-review-export.cjs').exportSnapshot(exportDb);
    assert.equal(snapshot.works.length,2);
    assert.ok(snapshot.works.every(x=>!('user_id' in x)&&!('username' in x)&&Number(x.is_public)===1));
    await assert.rejects(require('../../../scripts/gallery-review-export.cjs').exportSnapshot(exportDb,1),/limit/);
    console.log('PASS read-only consistent export, field allowlist, no partial batch');
  } finally { await exportDb.end(); }
  const before = process.env.GALLERY_REPORT_THRESHOLD;
  process.env.GALLERY_REPORT_THRESHOLD='1'; assert.throws(()=>moderation.threshold(),e=>e.statusCode===503);
  if (before === undefined) delete process.env.GALLERY_REPORT_THRESHOLD; else process.env.GALLERY_REPORT_THRESHOLD=before;
};

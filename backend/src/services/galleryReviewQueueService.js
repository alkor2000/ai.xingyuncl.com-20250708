const db=require('../database/connection');
const safety=require('./imageSafetyService');
const {idOf}=require('./galleryModerationService');
const mediaOf=media=>{if(!['image','video'].includes(media))throw safety.error('作品类型不正确',400);return media;};
const reviewer=media=>media==='image'?require('./galleryReviewService'):require('./videoSafetyService');
function filters(media,user,options={}) {
  const scope=require('./galleryReviewService').scope(user);
  const state=options.state||'pending';
  if(!['pending','approved','rejected','removed','reported'].includes(state))throw safety.error('审核状态不正确',400);
  const clauses=[scope.sql,'g.user_id<>?'];const params=[...scope.params,user.id];
  if(state==='reported')clauses.push(`(s.gallery_state='reported' OR (s.gallery_state='approved' AND EXISTS (SELECT 1 FROM ${media}_safety_reports r WHERE r.generation_id=g.id AND r.resolved_at IS NULL)))`);
  else {clauses.push('s.gallery_state=?');params.push(state);}
  if(options.machine&&options.machine!=='all'){
    if(options.machine==='unchecked')clauses.push('m.decision IS NULL');
    else if(options.machine==='map')clauses.push('m.map_detected=1');
    else if(['allow','review','reject'].includes(options.machine)){clauses.push('m.decision=?');params.push(options.machine);}
    else throw safety.error('机器结果筛选不正确',400);
  }
  if(options.group_id){clauses.push('u.group_id=?');params.push(idOf(options.group_id));}
  for(const key of ['from','to'])if(options[key]){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(options[key])||Number.isNaN(Date.parse(options[key])))throw safety.error('日期筛选不正确',400);
    clauses.push(key==='from'?'g.created_at>=?':'g.created_at<DATE_ADD(?, INTERVAL 1 DAY)');params.push(options[key]);
  }
  return {where:clauses.join(' AND '),params};
}
async function list(media,user,options={}) {
  mediaOf(media);const {where,params}=filters(media,user,options);
  const page=Math.max(1,Math.min(100000,Number.parseInt(options.page)||1));
  const from=`FROM ${media}_generations g JOIN users u ON u.id=g.user_id JOIN ${media}_safety s ON s.generation_id=g.id
    LEFT JOIN user_groups ug ON ug.id=u.group_id LEFT JOIN gallery_machine_reviews m ON m.media='${media}' AND m.generation_id=g.id WHERE ${where}`;
  const {rows:counts}=await db.query(`SELECT COUNT(*) total ${from}`,params);
  const {rows}=await db.simpleQuery(`SELECT g.id,g.user_id,u.username,u.group_id,ug.name group_name,g.prompt,g.negative_prompt,g.created_at,
    s.state moderation_status,s.gallery_state,s.revision,s.gallery_reason,s.file_key IS NOT NULL has_asset,m.decision machine_decision,m.map_detected,m.result machine_review,m.map_review,
    (SELECT COUNT(*) FROM ${media}_safety_reports r WHERE r.generation_id=g.id AND r.resolved_at IS NULL) reports ${from} ORDER BY g.id DESC LIMIT 30 OFFSET ?`,[...params,(page-1)*30]);
  for(const row of rows)if(typeof row.machine_review==='string')row.machine_review=JSON.parse(row.machine_review);
  return {data:rows,total:counts[0].total,page};
}
async function selection(media,user,options={}){
  const first=await list(media,user,{...options,page:1});
  if(first.total>100)throw safety.error('筛选结果超过100条，请缩小范围后全选',400);
  const items=[...first.data];
  for(let page=2;items.length<first.total;page++){
    const next=await list(media,user,{...options,page});
    if(next.total!==first.total||!next.data.length)throw safety.error('列表已变更，请刷新后全选',409);
    items.push(...next.data);
  }
  if(new Set(items.map(x=>String(x.id))).size!==items.length)throw safety.error('列表已变更，请刷新后全选',409);
  return {items};
}
async function groups(user){
  const s=require('./galleryReviewService').scope(user);
  const {rows}=await db.query(`SELECT DISTINCT ug.id,ug.name FROM users u JOIN user_groups ug ON ug.id=u.group_id WHERE ${s.sql} ORDER BY ug.id`,s.params);
  return rows;
}
async function recheck(media,id,user){
  mediaOf(media);id=idOf(id);await reviewer(media).authorize(id,user);
  const machine=require('./galleryMachineReviewService'),inspection=await machine.inspect(media,id,{force:true});
  return db.transaction(async query=>{
    await reviewer(media).authorize(id,user,query,true);
    const {rows:works}=await query(`SELECT id,status,prompt,negative_prompt FROM ${media}_generations WHERE id=?`,[id]);
    const {rows:states}=await query(`SELECT * FROM ${media}_safety WHERE generation_id=? FOR UPDATE`,[id]);
    if(!states[0])throw safety.error('请先导入作品',409);
    await machine.save(query,media,works[0],states[0],inspection);
    // A recheck can withdraw unsafe public content, never grant publication.
    if(inspection.result.decision==='reject'){
      await query(`UPDATE ${media}_generations SET is_public=0,gallery_approved_by=NULL WHERE id=?`,[id]);
      await query(`UPDATE ${media}_safety SET gallery_state='rejected',gallery_reason=?,revision=revision+1 WHERE generation_id=?`,[inspection.result.reasons.map(x=>x.text).join('；').slice(0,500),id]);
    }else await query(`UPDATE ${media}_safety SET revision=revision+1 WHERE generation_id=?`,[id]);
    return inspection.result;
  });
}
async function batch(media,user,body={}){
  mediaOf(media);require('./galleryReviewService').scope(user);
  if(!['approved','rejected'].includes(body.state)||body.confirmed!==true||!Array.isArray(body.items)||!body.items.length||body.items.length>100||typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>500)throw safety.error('请确认选择1–100条作品并填写统一理由',400);
  const ids=new Set();for(const item of body.items){const id=idOf(item.id);if(ids.has(id)||!Number.isSafeInteger(item.revision))throw safety.error('批量条目重复或版本无效',400);ids.add(id);await reviewer(media).authorize(id,user);}
  const results=[];
  for(const item of body.items){
    try{
      // The decision transaction repeats this guard while holding the work lock.
      await reviewer(media).decide(item.id,user,body.state,body.reason,item.revision,{batch:true});
      results.push({id:item.id,success:true});
    }catch(e){results.push({id:item.id,success:false,status:e.statusCode||500,message:e.statusCode?e.message:'处理失败，请刷新重试'});}
  }
  return {results,applied:results.filter(x=>x.success).length,failed:results.filter(x=>!x.success).length};
}
module.exports={list,selection,groups,recheck,batch,filters};

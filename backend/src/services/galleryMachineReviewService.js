const db=require('../database/connection');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {createHash}=require('node:crypto');
const {prepareMedia}=require('../../scripts/gallery-review-media.cjs');
const error=(message,code=409)=>Object.assign(new Error(message),{statusCode:code});
const libPath=()=>process.env.CONTENT_REVIEW_PACKAGE_PATH||path.resolve(__dirname,'../../../packages/content-review/index.js');
const library=()=>import(pathToFileURL(libPath()).href);
const validMedia=media=>{if(!['image','video'].includes(media))throw error('作品类型不正确',400);return media;};
const digest=(work,safety)=>createHash('sha256').update(JSON.stringify([String(work.id),work.status,work.prompt||'',work.negative_prompt||'',safety?.sha256||null,safety?.file_key||null])).digest('hex');
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const bound=(result,lib,options)=>result?.policySha256===lib.POLICY_SHA256&&result?.standardSha256===lib.STANDARD_SHA256&&result?.modelRevision===options.modelRevision;
async function adapters(query=db.query.bind(db), {lock=false}={}) {
  const ids=[process.env.CONTENT_REVIEW_TEXT_MODEL_ID||'45',process.env.CONTENT_REVIEW_VISION_MODEL_ID||'48'];
  if(ids.some(x=>!/^\d+$/.test(x)))throw error('审核模型配置无效');
  const {rows}=await query('SELECT id,name,api_endpoint,api_key,image_upload_enabled,updated_at,is_active FROM ai_models WHERE id IN (?,?)'+(lock?' LOCK IN SHARE MODE':''),ids);
  const {createOpenAIAdapter}=await import(pathToFileURL(path.join(path.dirname(libPath()),'openai-adapter.js')).href);
  const make=(id,visual)=>{
    const row=rows.find(x=>String(x.id)===id);
    if(!row||!row.is_active||visual&&!row.image_upload_enabled)return undefined;
    const endpoint=row.api_endpoint.endsWith('/chat/completions')?row.api_endpoint:row.api_endpoint.replace(/\/$/,'')+'/chat/completions';
    return createOpenAIAdapter({endpoint,apiKey:row.api_key,model:row.name});
  };
  return {textModel:make(ids[0],false),visionModel:make(ids[1],true),modelRevision:createHash('sha256').update(JSON.stringify({ids,revision:process.env.CONTENT_REVIEW_CONFIG_REVISION||'',models:ids.map(id=>rows.find(x=>String(x.id)===id)||null)})).digest('hex')};
}
function manual(result,code,text){
  if(result.decision==='reject')return result;
  return {...result,decision:'review',confidence:null,publication:{requiresHumanApproval:true,eligibleForHumanReview:true},reasons:[...result.reasons,{code,text}],checks:[...result.checks,{layer:'visual',decision:'review',categories:[],reason:code}]};
}
async function forOwner(media,id,userId) {
  validMedia(media);
  const {rows}=await db.query(`SELECT g.id,g.status,g.is_public,s.gallery_state,s.state FROM ${media}_generations g LEFT JOIN ${media}_safety s ON s.generation_id=g.id WHERE g.id=? AND g.user_id=?`,[id,userId]);
  const row=rows[0];if(!row)throw error('作品不存在',404);
  if(['removed','reported'].includes(row.gallery_state))throw error('作品已暂时下架，须由管理员复核后恢复');
  if(row.is_public||row.gallery_state==='pending')return null;
  if(row.status!==(media==='image'?'success':'succeeded')||row.state==='block')throw error('作品未通过安全审核，不能提交公开申请',403);
  return inspect(media,id);
}
async function inspect(media,id,{force=false}={}) {
  validMedia(media);
  const {rows}=await db.query(`SELECT id,user_id,status,is_public,prompt,negative_prompt FROM ${media}_generations WHERE id=?`,[id]);
  const work=rows[0];if(!work)throw error('作品不存在',404);
  const {rows:states}=await db.query(`SELECT * FROM ${media}_safety WHERE generation_id=?`,[id]);
  const safety=states[0]||{revision:0};const contentHash=digest(work,safety);
  const lib=await library();
  let options;try{options=await module.exports.adapters();}catch{options={modelRevision:'configured-model-unavailable'};}
  const {rows:cached}=await db.query('SELECT * FROM gallery_machine_reviews WHERE media=? AND generation_id=?',[media,id]);
  if(!force&&cached[0]?.content_hash===contentHash&&cached[0].policy_version===lib.POLICY.version&&bound(parse(cached[0].result),lib,options)&&options.modelRevision!=='configured-model-unavailable')return {contentHash,safetyRevision:safety.revision,result:parse(cached[0].result)};
  const reviewer=lib.createReviewer({...options,timeoutMs:60000});
  const text=[work.prompt,work.negative_prompt].filter(Boolean).join('\n');
  let material;
  try {
    if(!safety.file_key||!safety.sha256)throw Error('missing private media');
    const file=media==='image'?require('./imageSafetyService').assetPath(safety.file_key):require('./privateVideoStore').filePath(safety.file_key);
    if((await fs.stat(file)).size>(media==='video'?250:20)*1024*1024)throw Error('oversize');
    const bytes=await fs.readFile(file);
    if(createHash('sha256').update(bytes).digest('hex')!==safety.sha256)throw Error('changed private media');
    material=await prepareMedia(bytes,media,{ffmpegPath:process.env.CONTENT_REVIEW_FFMPEG||'ffmpeg',ffprobePath:process.env.CONTENT_REVIEW_FFPROBE||'ffprobe'});
  }catch{material=null;}
  let result=await reviewer({platform:'practice',kind:material?media:'text',text,images:material?.images||[],...(material?.video?{video:material.video}:{})});
  if(!material)result=manual(result,'media_incomplete','完整媒体未能检查，须人工复核 / Complete media could not be checked');
  if(media==='video')result=manual(result,'video_sampling','抽帧不覆盖音轨和全部画面，须人工完整观看 / Samples do not cover audio or all frames');
  return {contentHash,safetyRevision:safety.revision,result};
}
async function save(query,media,work,safety,inspection) {
  validMedia(media);
  if(Number(safety.revision)!==Number(inspection.safetyRevision)||digest(work,safety)!==inspection.contentHash)throw error('作品已变更，请重新检查');
  const result=inspection.result;
  const lib=await library();
  let options;try{options=await module.exports.adapters(query,{lock:true});}catch{options={modelRevision:'configured-model-unavailable'};}
  if(!bound(result,lib,options))throw error('审核配置或标准已变更，请重新检查');
  const audit=media==='image'?require('./imageSafetyService').event:require('./videoSafetyService').event;
  await audit(query,work.id,null,'machine_review',result.decision,`policy:${result.policyVersion};categories:${result.categories.join(',')}`,safety.sha256||null);
  await query(`INSERT INTO gallery_machine_reviews (media,generation_id,content_hash,policy_version,decision,map_detected,result) VALUES (?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE content_hash=VALUES(content_hash),policy_version=VALUES(policy_version),decision=VALUES(decision),map_detected=VALUES(map_detected),result=VALUES(result),map_review=NULL,checked_at=NOW()`,[media,work.id,inspection.contentHash,result.policyVersion,result.decision,result.mapDetected?1:0,JSON.stringify(result)]);
}
async function assertEligible(query,media,id,safety) {
  validMedia(media);
  const {rows:works}=await query(`SELECT id,status,prompt,negative_prompt FROM ${media}_generations WHERE id=?`,[id]);
  const {rows}=await query('SELECT * FROM gallery_machine_reviews WHERE media=? AND generation_id=?',[media,id]);
  const current=rows[0],lib=await library();
  let options;try{options=await module.exports.adapters(query,{lock:true});}catch{throw error('审核模型配置不可用，请恢复后重新检查');}
  if(!current||options.modelRevision==='configured-model-unavailable'||!bound(parse(current.result),lib,options)||current.content_hash!==digest(works[0],safety)||current.policy_version!==lib.POLICY.version)throw error('请先重新运行当前标准的机器检查，再进行人工审核');
  if(current.decision==='reject')throw error('机器已拒绝，不能批准公开');
  return parse(current.result);
}
async function recordMapReview(query,media,id,safety,result,options,actor) {
  if(!result.mapDetected)return;
  const data=options.mapReview;
  if(!data||[['source',300],['approval',120],['usage',200]].some(([key,max])=>typeof data[key]!=='string'||!data[key].trim()||data[key].length>max))throw error('地图须填写来源、审图号或版本、使用范围后才能批准',400);
  const record={source:data.source.trim(),approval:data.approval.trim(),usage:data.usage.trim(),reviewer:actor,reviewedAt:new Date().toISOString(),mediaSha256:safety.sha256};
  await query('UPDATE gallery_machine_reviews SET map_review=? WHERE media=? AND generation_id=?',[JSON.stringify(record),media,id]);
}
module.exports={adapters,forOwner,inspect,save,assertEligible,recordMapReview,digest,library};

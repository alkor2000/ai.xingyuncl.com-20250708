import {createHash} from 'node:crypto';
const hash = value => createHash('sha256').update(value).digest('hex');
// Local only: callers supply an explicitly approved public-media loader and the
// existing configured reviewer. No database, visibility or ACL write is possible.
export async function scanSnapshot(snapshot, {reviewer, loadMedia, onResult = async()=>{}}) {
  if (snapshot?.schemaVersion !== 1 || !Array.isArray(snapshot.works) || snapshot.works.length>1000 || typeof reviewer!=='function' || typeof loadMedia!=='function') throw Error('Invalid scan inputs');
  const seen=new Set(), results=[];
  for (const work of snapshot.works) {
    const identity=`${work.media}:${work.id}`;
    if (!['image','video'].includes(work.media) || !/^\d+$/.test(String(work.id)) || Number(work.id)<1 || !Number.isSafeInteger(Number(work.id)) || Number(work.is_public)!==1 || seen.has(identity)) throw Error('Snapshot identity/visibility mismatch');
    seen.add(identity);
    let review=null, failure=null, mediaHash=null;
    const snapshotSha256=hash(JSON.stringify(work));
    try {
      if(work.status!==(work.media==='image'?'success':'succeeded'))throw Error('unsuccessful_public_record');
      const material=await loadMedia(work);
      if(!/^[a-f0-9]{64}$/.test(material?.sha256||''))throw Error('missing_media_hash');
      mediaHash=material.sha256;
      review=await reviewer({platform:'practice',kind:work.media,text:[work.prompt,work.negative_prompt].filter(Boolean).join('\n'),images:material.images||[],...(work.media==='video'?{video:material.video}:{})});
      if (!['allow','review','reject'].includes(review?.decision)) throw Error('invalid_review_result');
    } catch {failure='media_or_review_incomplete';}
    // The live benchmark gate failed. No result, including a model allow, grants
    // publication. Sampled frames do not certify audio or unsampled video frames.
    const row={media:work.media,id:work.id,snapshotSha256,mediaSha256:mediaHash,modelDecision:review?.decision||'review',review,failure,
      recommendation:review?.decision==='reject'?'propose_hide':'human_review',
      automaticPublicationAllowed:false,videoCoverage:work.media==='video'?'sampled_visuals_only_audio_and_unsampled_frames_require_human_review':null};
    results.push(row);await onResult(row);
  }
  return {schemaVersion:1,readOnly:true,snapshotSha256:hash(JSON.stringify(snapshot)),count:results.length,proposedHide:results.filter(r=>r.recommendation==='propose_hide').length,humanReview:results.filter(r=>r.recommendation==='human_review').length,results};
}

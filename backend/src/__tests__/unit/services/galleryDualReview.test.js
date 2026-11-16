'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createEvidence, assess} = require('../../../services/galleryDualReview');
const H = c => c.repeat(64);
const current = {kind:'image', workId:'42', textSha256:H('a'), assetSha256:H('b'),
  policySha256:H('c'), standardSha256:H('d'), modelRevision:H('e'), providerRevision:H('f')};
const baidu = {text:{state:'pass',reason:'baidu_pass'},image:{state:'pass',reason:'baidu_pass'}};
const own = {decision:'allow',mapDetected:false,policySha256:current.policySha256,
  standardSha256:current.standardSha256,modelRevision:current.modelRevision,checks:[
  {layer:'text',decision:'allow',reason:'accepted'},
  {layer:'visual',decision:'allow',reason:'accepted'}]};
const make = overrides => createEvidence({current,baidu,own,checkedAt:'2026-11-16T07:00:00Z',...overrides});
test('complete allow permits human consideration, never substitutes for human approval',()=>{
 const r=assess(make(),current);assert.equal(r.decision,'allow');assert.equal(r.eligibleForHumanReview,true);
 assert.equal(r.reason,'human_approval_required');
});
test('a genuine complete model review permits single review but not batch approval',()=>{
 const r=assess(make({own:{...own,decision:'review',checks:[own.checks[0],{layer:'visual',decision:'review',reason:'model_review'}]}}),current);
 assert.equal(r.complete,true);assert.equal(r.eligibleForHumanReview,true);assert.equal(r.eligibleForBatchApproval,false);
});
test('visual timeout cannot become a completed human-review input',()=>{
 const r=assess(make({own:{...own,decision:'review',checks:[own.checks[0],{layer:'visual',decision:'review',reason:'provider_unavailable'}]}}),current);
 assert.equal(r.complete,false);assert.equal(r.eligibleForHumanReview,false);
});
test('Baidu missing configuration, malformed data and partial image preparation cannot pass',()=>{
 for(const result of [undefined,{state:'error',reason:'not_configured'},{state:'review',reason:'animated_image'},
  {state:'review',reason:'invalid_image'},{state:'pass',reason:'invalid_response'}]) {
  const r=assess(make({baidu:{...baidu,image:result}}),current);assert.equal(r.eligibleForHumanReview,false);
 }
});
test('either rejection dominates; skipped other models are not invented',()=>{
 for(const e of [make({baidu:{...baidu,image:{state:'block',reason:'baidu_block'}}}),
 make({own:{decision:'reject',checks:[{layer:'terms',decision:'reject',reason:'blocked_phrase'}]}})]){
  const r=assess(e,current);assert.equal(r.decision,'reject');assert.equal(r.eligibleForHumanReview,false);
 }
});
test('each source, policy and provider revision change invalidates evidence',()=>{
 for(const key of ['workId','textSha256','assetSha256','policySha256','standardSha256','modelRevision','providerRevision']) {
  const changed={...current,[key]:key==='workId'?'43':H('0')};
  assert.equal(assess(make(),changed).eligibleForHumanReview,false,key);
 }
});
test('map cannot enter batch even if provider decisions say allow',()=>{
 const r=assess(make({own:{...own,mapDetected:true}}),current);
 assert.equal(r.decision,'review');assert.equal(r.eligibleForHumanReview,true);assert.equal(r.eligibleForBatchApproval,false);
});
test('video frame sampling never stands in for full audio and video checks',()=>{
 const v={...current,kind:'video'};const r=assess(make({current:v}),v);
 assert.equal(r.complete,false);assert.equal(r.eligibleForHumanReview,false);
});
test('text needs no image, and missing results remain closed to approval',()=>{
 const t={...current,kind:'text',assetSha256:null};
 const r=assess(make({current:t,own:{...own,checks:[own.checks[0]]},baidu:{text:baidu.text}}),t);
 assert.equal(r.eligibleForHumanReview,true);assert.equal(assess(null,t).eligibleForHumanReview,false);
});
test('tampered binding and incomplete lane types cannot be approved',()=>{
 const e=make();e.binding.workId='43';assert.equal(assess(e,current).eligibleForHumanReview,false);
 const f=make();f.lanes.own.complete='true';assert.equal(assess(f,current).eligibleForHumanReview,false);
});

test('an older own-model revision cannot be relabelled as current evidence',()=>{
 for(const key of ['policySha256','standardSha256','modelRevision']){
  const r=assess(make({own:{...own,[key]:H('0')}}),current);assert.equal(r.eligibleForHumanReview,false,key);
 }
 const e=make();delete e.mapDetected;assert.equal(assess(e,current).eligibleForHumanReview,false);
});

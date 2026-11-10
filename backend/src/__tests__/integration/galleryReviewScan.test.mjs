import test from 'node:test';
import assert from 'node:assert/strict';
import {scanSnapshot} from '../../../scripts/gallery-review-scan.mjs';
const work=(id,media='image')=>({id,media,is_public:1,status:media==='image'?'success':'succeeded',prompt:'fixture'});
const loadMedia=async()=>({sha256:'a'.repeat(64),images:[]});
test('reject proposes hide; allow and video sample remain manual, never grant publication',async()=>{
 let index=0;const result=await scanSnapshot({schemaVersion:1,works:[work(1),work(2),work(3,'video')]},{loadMedia,reviewer:async()=>({decision:['reject','allow','allow'][index++]})});
 assert.equal(result.proposedHide,1);assert.equal(result.humanReview,2);assert.ok(result.results.every(x=>!x.automaticPublicationAllowed));assert.match(result.results[2].videoCoverage,/audio/);
});
test('download/model failures are explicit manual work, not safe content',async()=>{
 for (const options of [{loadMedia:async()=>{throw Error('private url with token')},reviewer:async()=>({decision:'allow'})},{loadMedia,reviewer:async()=>{throw Error('provider token')}}]){
  const result=await scanSnapshot({schemaVersion:1,works:[work(1)]},options);assert.equal(result.results[0].failure,'media_or_review_incomplete');assert.ok(!JSON.stringify(result).includes('token'));assert.equal(result.proposedHide,0);
 }
});
test('duplicates/private records cannot be accepted as a complete public snapshot',async()=>{
 for(const works of [[work(1),work(1)],[{...work(2),is_public:0}]])await assert.rejects(scanSnapshot({schemaVersion:1,works},{loadMedia,reviewer:async()=>({decision:'allow'})}),/mismatch/);
});

test('media loader enforces explicit hosts and decodes six actual local video frames',async()=>{
 const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);
 const {createMediaLoader}=require('../../../scripts/gallery-review-media.cjs');
 const {createReadStream}=await import('node:fs');const {fileURLToPath}=await import('node:url');
 const fixture=fileURLToPath(new URL('../../../../dev/gallery-moderation-preview/fixture.mp4',import.meta.url));
 const loader=createMediaLoader({siteOrigin:'https://approved.example',allowedHosts:['approved.example'],ffmpegPath:process.env.TEST_FFMPEG,ffprobePath:process.env.TEST_FFPROBE,openStream:async()=>createReadStream(fixture)});
 await assert.rejects(loader({...work(1),local_path:'https://unapproved.example/file'}),/Unapproved/);
 const material=await loader({...work(2,'video'),local_path:'/fixture.mp4'});
 assert.equal(material.video.frames.length,6);assert.equal(material.video.sha256,material.sha256);
 assert.ok(material.video.frames[0].timeSeconds<=material.video.durationSeconds*.05);
 assert.ok(material.video.frames[5].timeSeconds>=material.video.durationSeconds*.95);
 assert.ok(material.video.frames.every(f=>f.mime==='image/jpeg'&&Buffer.from(f.base64,'base64')[0]===255));
});

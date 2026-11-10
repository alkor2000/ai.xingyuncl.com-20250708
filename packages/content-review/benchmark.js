// Explicit opt-in only. Dry run inventories the corpus and never loads credentials or calls a provider.
import {readFileSync,writeFileSync} from 'node:fs';
import {createReviewer} from './index.js';import {createOpenAIAdapter} from './openai-adapter.js';
const corpus=JSON.parse(readFileSync(new URL('./test/prompts.json',import.meta.url),'utf8'));
const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6);
if(!out)throw Error('Provide --out=<private result path>');
const live=process.argv.includes('--live');
if(live&&process.env.CONTENT_REVIEW_BENCHMARK_APPROVED!=='yes')throw Error('Explicit model-call approval required');
let review;
if(live){const adapter=createOpenAIAdapter({endpoint:process.env.CONTENT_REVIEW_ENDPOINT,apiKey:process.env.CONTENT_REVIEW_API_KEY,model:process.env.CONTENT_REVIEW_MODEL});review=createReviewer({textModel:adapter,modelRevision:process.env.CONTENT_REVIEW_MODEL_REVISION});}
const rows=[];
for(const x of corpus){if(!live){rows.push({id:x.id,expected:x.expected,status:'not_run'});continue;}const r=await review({platform:'practice',kind:'text',text:x.text,images:[]});rows.push({id:x.id,expected:x.expected,actual:r.decision,categories:r.categories,reasons:r.reasons.map(y=>y.code),match:r.decision===x.expected,modelCalled:r.checks.some(y=>y.layer==='text'),policyVersion:r.policyVersion,modelRevision:r.modelRevision,contentSha256:r.contentSha256});}
const rejects=rows.filter(x=>x.expected==='reject'),normal=rows.filter(x=>x.expected==='allow');
const summary={live,total:rows.length,rejectTotal:rejects.length,normalTotal:normal.length,rejectBlocked:live?rejects.filter(x=>x.actual!=='allow').length:null,rejectExact:live?rejects.filter(x=>x.actual==='reject').length:null,normalAllowRate:live?normal.filter(x=>x.actual==='allow').length/normal.length:null,gatePassed:live?rejects.every(x=>x.actual!=='allow')&&normal.filter(x=>x.actual==='allow').length/normal.length>=.95&&rows.filter(x=>x.id.startsWith('M')).every(x=>x.actual==='review'):null};
writeFileSync(out,JSON.stringify({at:new Date().toISOString(),summary,rows},null,2)+'\n');console.log(JSON.stringify(summary));

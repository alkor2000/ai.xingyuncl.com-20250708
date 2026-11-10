import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCorpus,summarize} from '../benchmark.js';
import {CATEGORIES} from '../index.js';
const safe=()=>({decision:'allow',mapDetected:false,scores:Object.fromEntries(CATEGORIES.map(k=>[k,0]))});
test('dry run never calls the adapter and reports no invented metrics',async()=>{
 const r=await evaluateCorpus({adapter:()=>{throw Error('must not call');}});
 assert.equal(r.rows.length,48);assert.equal(r.summary.providerCalls,null);assert.equal(r.summary.gatePassed,null);
});
test('all cases including word-list hits reach model once; same response is reused by policy',async()=>{
 let calls=0;
 const r=await evaluateCorpus({live:true,includeSupplements:true,modelRevision:'fixture',adapter:async()=>{calls++;return safe();}});
 assert.equal(calls,50);assert.equal(r.summary.providerCalls,48);assert.equal(r.rows[0].modelDecision,'allow');
 assert.equal(r.rows[0].actual,'reject');assert.equal(r.rows[0].policyUsedModel,false);
 assert.equal(r.rows.find(x=>x.id==='M01').actual,'review');assert.equal(r.supplements.total,2);
});
test('provider failures are never counted as a readiness pass even though fail-closed blocks publication',async()=>{
 const r=await evaluateCorpus({live:true,modelRevision:'fixture',adapter:async()=>{throw Error('unavailable');}});
 assert.equal(r.summary.providerSuccess,0);assert.equal(r.summary.rejectBlockRate,1);assert.equal(r.summary.normalAllowRate,0);assert.equal(r.summary.gatePassed,false);
});
test('malformed model responses short-circuited by terms still invalidate benchmark health',()=>{
 const rows=[{id:'R01',expected:'reject',actual:'reject',providerCalled:true,providerSucceeded:true,schemaValid:false},
 {id:'A01',expected:'allow',actual:'allow',providerCalled:true,providerSucceeded:true,schemaValid:true}];
 const r=summarize(rows,true);assert.equal(r.rejectBlockRate,1);assert.equal(r.normalAllowRate,1);assert.equal(r.gatePassed,false);
});

test('meeting reject/normal thresholds cannot hide an unexpected allow in mandatory-review cases',()=>{
 const base={providerCalled:true,providerSucceeded:true,schemaValid:true};
 const r=summarize([{...base,id:'R01',expected:'reject',actual:'reject'},{...base,id:'A01',expected:'allow',actual:'allow'},{...base,id:'U02',expected:'review',actual:'allow'}],true);
 assert.equal(r.thresholdPassed,true);assert.equal(r.unexpectedReviewAllows,1);assert.equal(r.gatePassed,false);
});

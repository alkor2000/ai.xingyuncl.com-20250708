import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createHash} from 'node:crypto';
import {POLICY,POLICY_SHA256,STANDARD_SHA256,createReviewer} from '../index.js';
const hash=x=>createHash('sha256').update(x).digest('hex');
test('reference binds actual canonical policy and repository standard bytes',async()=>{
 const ref=JSON.parse(fs.readFileSync(new URL('../standard-reference.json',import.meta.url)));
 assert.equal(ref.version,POLICY.version);assert.equal(ref.policy_sha256,POLICY_SHA256);assert.equal(ref.sha256,STANDARD_SHA256);
 assert.equal(ref.policy_file_sha256,hash(fs.readFileSync(new URL('../policy.json',import.meta.url))));
 assert.equal(POLICY_SHA256,hash(JSON.stringify(POLICY)));
 const result=await createReviewer({modelRevision:'fixture'})({platform:'practice',kind:'text',text:'正常教学',images:[]});
 assert.equal(result.standardSha256,STANDARD_SHA256);assert.equal(result.policySha256,POLICY_SHA256);assert.equal(result.decision,'review');
});

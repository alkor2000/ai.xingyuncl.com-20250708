/* Exact approved manifest only. Default dry run has no DB connection. */
const fs=require('node:fs'),{createHash}=require('node:crypto');
const db=require('../src/database/connection');
async function run(){
 const args=process.argv.slice(2),arg=k=>args.find(v=>v.startsWith(`--${k}=`))?.slice(k.length+3);
 if(!arg('manifest')||!/^[a-f0-9]{64}$/.test(arg('sha256')||''))throw Error('Manifest and exact SHA-256 required');
 const bytes=fs.readFileSync(arg('manifest'));if(createHash('sha256').update(bytes).digest('hex')!==arg('sha256'))throw Error('Manifest digest mismatch');
 const manifest=JSON.parse(bytes);
 if(!args.includes('--apply')){console.log(JSON.stringify({dryRun:true,count:manifest.snapshot?.works?.length,action:'withdraw_and_enqueue_after_explicit_write_approval',databaseConnected:false}));return;}
 if(!arg('approval-reference'))throw Error('Explicit write approval reference required');
 await db.initialize();const {applyApprovedScan}=await import('./gallery-review-scan.mjs');
 console.log(JSON.stringify(await applyApprovedScan(manifest,{approvalReference:arg('approval-reference')})));
}
if(require.main===module)run().catch(()=>{console.error('Scan apply failed or uncertain; stop and inspect the exact manifest and audit before any retry.');process.exitCode=1;}).finally(()=>db.close());
module.exports={run};

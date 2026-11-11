'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),cp=require('node:child_process'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..'),plan=require('../gallery-migration-plan.json');
const express=require('../../backend/node_modules/express');
test('pinned compatible application closes old and new shared-work routes, all verbs, while other modules stay available',async()=>{
 const sha=require('../shared-rollback-bind.cjs').source(root);
 const read=p=>cp.execFileSync('git',['-C',root,'show',sha+':'+p],{encoding:'utf8'});
 const source=read('backend/src/app.js');
 assert(source.indexOf("app.use(require('./middleware/sharedWorkRollbackGate'))")<source.indexOf('app.use(helmet'));
 const context={module:{exports:{}}};vm.runInNewContext(read('backend/src/middleware/sharedWorkRollbackGate.js'),context);
 const app=express();app.use(context.module.exports);app.use((req,res)=>res.status(200).send('unrelated'));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 try{
  const origin='http://127.0.0.1:'+server.address().port;
  for(const route of ['/pages/1/old','/shared-pages/1/old','/api/mindmap/share/1/old','/API/MINDMAP/share/1/old','/api/html-editor/pages','/api/shared-works','/api//mindmap/share/1/old','/api/%6dindmap/share/1/old']){
   for(const method of ['GET','HEAD','POST','PUT','DELETE']){
    const r=await fetch(origin+route,{method});assert.equal(r.status,503,method+' '+route);assert.equal(r.headers.get('cache-control'),'private, no-store');await r.arrayBuffer();
   }
  }
  for(const route of ['/health','/api/auth/login','/api/image','/api/video','/api/users/profile']){const r=await fetch(origin+route);assert.equal(r.status,200);await r.arrayBuffer();}
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

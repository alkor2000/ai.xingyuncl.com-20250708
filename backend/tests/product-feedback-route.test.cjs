"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  http = require("node:http"),
  express = require("express");
const authPath = require.resolve("../src/middleware/authMiddleware");
// The source's existing JWT/database middleware is outside this isolated adapter test.
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
    authenticate(req, res, next) {
      req.user = { id: 123, role: req.headers["fixture-role"] || "user" };
      next();
    },
  },
};
const { mount } = require("../src/routes/productFeedback");
const bridge = require("../src/services/productFeedback/bridge");
function listen(server) {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve("http://127.0.0.1:" + server.address().port),
    ),
  );
}
test("feedback routes preserve source identity, scope and private errors", async (t) => {
  let calls = 0;
  const secret = "fixture-only-signing-secret-00000000",
    subjectSecret = "fixture-only-subject-secret-00000000";
  const hub = http.createServer((req, res) => {
    calls++;
    assert.equal(req.url, "/api/v1/integrations/product-feedback/admin");
    assert.equal(
      req.headers["x-pf-subject"],
      bridge.hmac(subjectSecret, "123"),
    );
    assert.equal(req.headers["x-pf-admin"], "1");
    assert.equal(req.headers.authorization, undefined);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ code: 0, data: { items: [] } }));
  });
  const origin = await listen(hub);
  t.after(() => {
    hub.closeAllConnections();
    hub.close();
  });
  Object.assign(process.env, {
    PRODUCT_FEEDBACK_HUB_URL: origin,
    PRODUCT_FEEDBACK_ALLOW_LOOPBACK: "true",
    NODE_ENV: "test",
    PRODUCT_FEEDBACK_CLIENT_ID: "ai-test",
    PRODUCT_FEEDBACK_CLIENT_SECRET: secret,
    PRODUCT_FEEDBACK_SUBJECT_SECRET: subjectSecret,
  });
  const app = express();
  mount(app);
  const server = http.createServer(app),
    source = await listen(server);
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  let response = await fetch(source + "/api/product-feedback");
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "no-store");
  let body = await response.json();
  assert.equal(body.schema_version, 1);
  assert.ok(body.request_id);
  for (const role of ["user", "admin", "super_admin"]) {
    response = await fetch(source + "/api/admin/product-feedback", {
      headers: {
        authorization: "Bearer private-source-token",
        "fixture-role": role,
        "x-pf-subject": "forged",
        "x-pf-admin": "1",
      },
    });
    assert.equal(response.status, role === "super_admin" ? 200 : 403);
    assert.equal(response.headers.get("cache-control"), "no-store");
    await response.text();
  }
  assert.equal(calls, 1);
  response = await fetch(source + "/api/product-feedback/../../users", {
    headers: { authorization: "Bearer private-source-token" },
  });
  assert.equal(response.status, 404);
});

test('multi image proxy accepts 8MiB and rejects over 26MiB before forwarding', async t => {
 let calls=0;
 const payload=Buffer.alloc(8*1024*1024,120);
 const hub=http.createServer(async (req,res)=>{
  calls++;
  const chunks=[];for await(const chunk of req) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks),payload);
  assert.equal(req.headers['x-pf-admin'],'0');assert.equal(req.headers.authorization,undefined);
  res.setHeader('content-type','application/json');res.end(JSON.stringify({code:0,data:{id:'fixture'}}));
 });
 const origin=await listen(hub);
 Object.assign(process.env,{PRODUCT_FEEDBACK_HUB_URL:origin,PRODUCT_FEEDBACK_ALLOW_LOOPBACK:'true',NODE_ENV:'test',PRODUCT_FEEDBACK_CLIENT_ID:'ai-test',PRODUCT_FEEDBACK_CLIENT_SECRET:'fixture-only-signing-secret-00000000',PRODUCT_FEEDBACK_SUBJECT_SECRET:'fixture-only-subject-secret-00000000'});
 const app=express();mount(app);const server=http.createServer(app),source=await listen(server);
 t.after(()=>{for(const s of [hub,server]){s.closeAllConnections();s.close();}});
 for(const size of [8,27]){
  const res=await fetch(source+'/api/product-feedback',{method:'POST',headers:{authorization:'Bearer source-only-fixture','content-type':'multipart/form-data; boundary=fixture','idempotency-key':'00000000-0000-4000-8000-000000000001'},body:size===8?payload:Buffer.alloc(size*1024*1024)});
  assert.equal(res.status,size===8?200:413);await res.text();
 }
 assert.equal(calls,1);
});

const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const {
  configuration,
  forward,
  allowedPath,
  hmac,
  digest,
} = require("../src/services/productFeedback/bridge");
const secret = "test-service-secret-0000000000000000000",
  subjectSecret = "test-subject-secret-0000000000000000000";
test("configuration requires dedicated keys and HTTPS except explicit local test", () => {
  assert.throws(() => configuration({}));
  assert.throws(() =>
    configuration({
      PRODUCT_FEEDBACK_HUB_URL: "http://example.com",
      PRODUCT_FEEDBACK_CLIENT_ID: "ai",
      PRODUCT_FEEDBACK_CLIENT_SECRET: secret,
      PRODUCT_FEEDBACK_SUBJECT_SECRET: subjectSecret,
    }),
  );
  assert.throws(() =>
    configuration({
      PRODUCT_FEEDBACK_HUB_URL: "https://example.com/steal",
      PRODUCT_FEEDBACK_CLIENT_ID: "ai",
      PRODUCT_FEEDBACK_CLIENT_SECRET: secret,
      PRODUCT_FEEDBACK_SUBJECT_SECRET: subjectSecret,
    }),
  );
  assert.equal(
    configuration({
      PRODUCT_FEEDBACK_HUB_URL: "https://example.com",
      PRODUCT_FEEDBACK_CLIENT_ID: "ai",
      PRODUCT_FEEDBACK_CLIENT_SECRET: secret,
      PRODUCT_FEEDBACK_SUBJECT_SECRET: subjectSecret,
    }).origin,
    "https://example.com",
  );
});
test("path whitelist rejects arbitrary proxy destinations and management on personal scope", () => {
  const id = crypto.randomUUID();
  assert.equal(allowedPath("POST", "/../../admin/users", false), false);
  assert.equal(allowedPath("POST", `/${id}/actions`, false), false);
  assert.equal(allowedPath("POST", `/${id}/acceptance`, true), false);
  assert.equal(allowedPath("GET", `/${id}/evidence/${id}`, false), true);
});
test("signed retry uses opaque subject, identical body/key and fresh nonce; redirects rejected", async (t) => {
  let attempts = 0;
  const nonces = new Set(),
    key = crypto.randomUUID(),
    body = Buffer.from('{"body":"test"}');
  let redirect = false;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const received = Buffer.concat(chunks);
    if (redirect) {
      res.writeHead(302, { location: "http://127.0.0.1:1" });
      res.end();
      return;
    }
    attempts++;
    assert.deepEqual(received, body);
    assert.equal(req.headers["idempotency-key"], key);
    assert.equal(req.headers["x-pf-subject"], hmac(subjectSecret, "123"));
    assert.notEqual(req.headers["x-pf-subject"], "123");
    assert.ok(!nonces.has(req.headers["x-pf-nonce"]));
    nonces.add(req.headers["x-pf-nonce"]);
    const canonical = [
      "1",
      "ai",
      req.headers["x-pf-subject"],
      "0",
      req.headers["x-pf-time"],
      req.headers["x-pf-nonce"],
      "POST",
      req.url,
      "application/json",
      key,
      digest(received),
    ].join("\n");
    assert.equal(req.headers["x-pf-signature"], hmac(secret, canonical));
    res.writeHead(attempts < 3 ? 503 : 200, {
      "content-type": "application/json",
    });
    res.end('{"code":0}');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const config = {
    origin: `http://127.0.0.1:${server.address().port}`,
    client: "ai",
    secret,
    subjectSecret,
  };
  const input = {
    config,
    userID: "123",
    admin: false,
    method: "POST",
    suffix: "",
    contentType: "application/json",
    body,
    key,
  };
  assert.equal((await forward(input)).status, 200);
  assert.equal(attempts, 3);
  redirect = true;
  await assert.rejects(forward(input), /redirect rejected/);
});

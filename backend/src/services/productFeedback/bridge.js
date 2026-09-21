"use strict";
const crypto = require("node:crypto");
const http = require("node:http");
const https = require("node:https");
const ID =
  "[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}";
const uuid = new RegExp(`^${ID}$`);
const digest = (data) => crypto.createHash("sha256").update(data).digest("hex");
const hmac = (secret, data) =>
  crypto.createHmac("sha256", secret).update(data).digest("hex");
function configuration(env = process.env) {
  const url = new URL(env.PRODUCT_FEEDBACK_HUB_URL || "invalid:");
  const loopback =
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
    env.NODE_ENV !== "production" &&
    env.PRODUCT_FEEDBACK_ALLOW_LOOPBACK === "true";
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/"].includes(url.pathname)
  )
    throw new Error("feedback configuration unavailable");
  const client = env.PRODUCT_FEEDBACK_CLIENT_ID || "",
    secret = env.PRODUCT_FEEDBACK_CLIENT_SECRET || "",
    subjectSecret = env.PRODUCT_FEEDBACK_SUBJECT_SECRET || "";
  if (
    !/^[a-zA-Z0-9_-]{1,80}$/.test(client) ||
    secret.length < 32 ||
    subjectSecret.length < 32
  )
    throw new Error("feedback configuration unavailable");
  return { origin: url.origin, client, secret, subjectSecret };
}
function allowedPath(method, suffix, admin) {
  if (method === "GET")
    return (
      suffix === "" ||
      suffix === "/notifications" ||
      (admin && suffix === "/stats") ||
      new RegExp(`^/${ID}(/evidence/${ID})?$`).test(suffix)
    );
  if (method === "POST")
    return (
      (!admin && suffix === "") ||
      new RegExp(`^/${ID}/${admin ? "actions" : "(reply|acceptance)"}$`).test(
        suffix,
      ) ||
      new RegExp(`^/notifications/${ID}/read$`).test(suffix)
    );
  return false;
}
function once(url, headers, body, signal) {
  return new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).request(
      url,
      {
        method: headers.method,
        headers: headers.values,
        signal,
        timeout: 25000,
      },
      (res) => {
        let size = 0;
        const chunks = [];
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > 7 * 1024 * 1024) {
            res.destroy(new Error("oversized feedback response"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("feedback timeout")));
    req.on("error", reject);
    req.end(body);
  });
}
async function forward({
  config,
  userID,
  admin,
  method,
  suffix,
  query = "",
  contentType = "",
  body = Buffer.alloc(0),
  key = "",
  signal,
}) {
  if (
    !allowedPath(method, suffix, admin) ||
    (method === "POST" && query) ||
    (method === "POST" && !uuid.test(key))
  )
    throw Object.assign(new Error("invalid request"), { status: 400 });
  const params = new URLSearchParams(query);
  for (const field of params.keys())
    if (
      !["status", "priority", "limit", "offset"].includes(field) ||
      params.getAll(field).length !== 1
    )
      throw Object.assign(new Error("invalid query"), { status: 400 });
  const path = `/api/v1/integrations/product-feedback/${admin ? "admin" : "mine"}${suffix}${query ? "?" + params.toString() : ""}`;
  const subject = hmac(config.subjectSecret, String(userID));
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    const timestamp = String(Math.floor(Date.now() / 1000)),
      nonce = crypto.randomUUID();
    const signing = [
      "1",
      config.client,
      subject,
      admin ? "1" : "0",
      timestamp,
      nonce,
      method,
      path,
      contentType,
      key,
      digest(body),
    ].join("\n");
    const headers = {
      "X-PF-Version": "1",
      "X-PF-Client": config.client,
      "X-PF-Subject": subject,
      "X-PF-Admin": admin ? "1" : "0",
      "X-PF-Time": timestamp,
      "X-PF-Nonce": nonce,
      "X-PF-Signature": hmac(config.secret, signing),
    };
    if (contentType) headers["Content-Type"] = contentType;
    if (key) headers["Idempotency-Key"] = key;
    try {
      last = await once(
        new URL(path, config.origin),
        { method, values: headers },
        body,
        signal,
      );
      if (last.status < 500) {
        if (last.status >= 300 && last.status < 400)
          throw Object.assign(new Error("redirect rejected"), {
            noRetry: true,
          });
        return last;
      }
    } catch (error) {
      if (signal?.aborted || error.noRetry) throw error;
    }
    if (attempt < 2)
      await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt));
  }
  if (last && last.status >= 500) return last;
  throw new Error("feedback unavailable");
}
module.exports = { configuration, forward, allowedPath, hmac, digest };

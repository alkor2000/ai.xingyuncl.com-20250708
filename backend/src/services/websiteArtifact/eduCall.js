'use strict';

// One signed, bounded call to edu, shared by every integration this platform makes outward.
//
// It exists so the two callers — the reviewer-eligibility provider and the student's 交作业 relay —
// cannot drift apart on the parts that are security properties rather than features: the canonical
// string that is signed, the absolute time budget, the byte cap, and the refusal to follow a redirect.
// The construction is edu's own (internal/integrations/e09website/signing.go): the inner digest covers
// the method, the path, the sorted query and the body, and the outer digest binds it to the secret,
// the timestamp and a single-use nonce.
const { createHash, randomBytes } = require('node:crypto');
const https = require('node:https');
const http = require('node:http');

function signCall({ secret, method, path, query = '', body = '', timestamp, nonce }) {
  const canonical = [method, path, query, createHash('sha256').update(body).digest('hex')].join('\n');
  const inner = createHash('sha256').update(canonical).digest('hex');
  return createHash('sha256').update(`${secret}\n${timestamp}\n${nonce}\n${inner}`).digest('hex');
}

// `timeoutMs` is an ABSOLUTE budget, not only a gap between bytes. A socket timeout fires when nothing
// arrives; a peer that drips one byte at a time — each sooner than the timeout, all of them under the
// size cap — would otherwise hold a student's page open for as long as it liked. (Measured before this
// was added: 6.2 seconds against a 400ms configuration.) The deadline covers connect to end, and every
// way out of here clears the timer and destroys the request.
//
// It never throws and never resolves to a partial body: a caller gets either a complete answer or
// `{ status: null, text: null }`, which every caller must read as "no answer", never as a pass.
function postToEdu(config, payload, { request, now }) {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(now() / 1000);
  // Cryptographic randomness, not Math.random: this nonce is what stops a replay at edu's verifier.
  const nonce = randomBytes(16).toString('hex');
  const headers = {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'x-p09-client': config.clientKey, 'x-p09-key-id': config.keyId,
    'x-p09-timestamp': String(timestamp), 'x-p09-nonce': nonce,
    'x-p09-signature': signCall({
      secret: config.secret, method: 'POST', path: config.endpoint.pathname,
      query: config.endpoint.search.replace(/^\?/, ''), body, timestamp, nonce })
  };
  if (typeof request === 'function') return request({ config, body, headers });   // tests only
  const transport = config.endpoint.protocol === 'https:' ? https : http;
  return new Promise(resolve => {
    let settled = false;
    let pending = null;
    const deadline = setTimeout(() => finish({ status: null, text: null }), config.timeoutMs);
    function finish(value) {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      try { if (pending) pending.destroy(); } catch { /* already gone */ }
      resolve(value);
    }
    const req = transport.request(config.endpoint, {
      method: 'POST', headers, timeout: config.timeoutMs,
      ...(config.ca ? { ca: config.ca } : {}), rejectUnauthorized: true,
      // SNI carries a host name, never an address literal: sending an IP there is not valid TLS and
      // some servers drop the connection for it.
      ...(/^[\d.]+$/.test(config.endpoint.hostname) || config.endpoint.hostname.includes(':')
        ? {} : { servername: config.endpoint.hostname })
    }, response => {
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > config.maxBytes) { response.destroy(); finish({ status: null, text: null }); return; }
        chunks.push(chunk);
      });
      response.on('end', () => finish({ status: response.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      response.on('error', () => finish({ status: null, text: null }));
    });
    pending = req;
    req.on('timeout', () => finish({ status: null, text: null }));      // no byte for timeout_ms
    req.on('error', () => finish({ status: null, text: null }));
    req.end(body);
  });
}

module.exports = { signCall, postToEdu };

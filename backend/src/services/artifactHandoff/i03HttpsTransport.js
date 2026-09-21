'use strict';

// Preparatory transport only: no route registration, wire-version promotion,
// teacher authorization or feature enablement. The draft client stays separate.
const https = require('node:https');
const tls = require('node:tls');
const { HandoffError, fail } = require('./source');
const { validUUID } = require('./selection');

const TRUST = Object.freeze({
  identityOrigin: 'https://id.pkuailab.com',
  sourceOrigin: 'https://ai.pkuailab.com',
  targetOrigin: 'https://workflow.pkuailab.com',
  sourceInstance: 'pku-ai-platform-prod',
  targetInstance: 'pku-tedna-prod',
  clientId: 'ai-platform-client'
});
const ROUTES = Object.freeze({
  issue: ['identity', '/backchannel/teacher-artifact-handoffs/v1/issue'],
  revoke: ['identity', '/backchannel/teacher-artifact-handoffs/v1/revoke'],
  prepare: ['target', '/api/v1/integrations/teacher-artifacts/prepare'],
  commit: ['target', '/api/v1/integrations/teacher-artifacts/commit'],
  status: ['target', '/api/v1/integrations/teacher-artifacts/status'],
  cancel: ['target', '/api/v1/integrations/teacher-artifacts/cancel']
});

class I03HttpsTransport {
  #authorization;
  #timeoutMs;
  constructor(config) {
    const keys = [...Object.keys(TRUST), 'getAuthorization', 'timeoutMs'];
    if (!config || Object.keys(config).some(key => !keys.includes(key)) ||
        Object.entries(TRUST).some(([key, value]) => config[key] !== value) ||
        typeof config.getAuthorization !== 'function' ||
        !Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 10 || config.timeoutMs > 30000) {
      fail('invalid_handoff_configuration');
    }
    // All values must be supplied by a future trusted deployment loader. No
    // fallback from Host, callback URL, IdP response or another site's client.
    this.#authorization = config.getAuthorization;
    this.#timeoutMs = config.timeoutMs;
  }

  async post(action, payload, idempotencyKey) {
    if (typeof action !== 'string' || !Object.hasOwn(ROUTES, action) || !validUUID(idempotencyKey) ||
        !payload || typeof payload !== 'object' || Array.isArray(payload)) fail('invalid_request');
    let data;
    try {
      data = Buffer.from(JSON.stringify(payload));
      const encoded = JSON.parse(data.toString());
      if (!encoded || typeof encoded !== 'object' || Array.isArray(encoded)) fail('invalid_request');
    } catch { fail('invalid_request'); }
    if (data.length > (action === 'prepare' ? 524288 : 16384)) fail('payload_too_large', 413);
    const [peer, path] = ROUTES[action];
    const unavailable = peer === 'identity' ? 'identity_unavailable' : 'target_unavailable';
    const hostname = new URL(TRUST[`${peer}Origin`]).hostname;
    const headers = { 'Content-Type': 'application/json', 'Content-Length': data.length,
      'Idempotency-Key': idempotencyKey, 'Cache-Control': 'no-store' };
    if (peer === 'identity') {
      // Synchronous access to already-loaded backend credentials; never call an
      // unbounded remote credential resolver or include credentials in errors.
      try {
        const value = this.#authorization();
        if (typeof value !== 'string' || !/^Basic [A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error();
        const encoded = value.slice(6), decoded = Buffer.from(encoded, 'base64');
        const text = decoded.toString('utf8'), prefix = `${TRUST.clientId}:`;
        if (decoded.toString('base64') !== encoded || !text.startsWith(prefix) ||
            !/^[\x21-\x7e]{32,512}$/.test(text.slice(prefix.length))) throw new Error();
        headers.Authorization = value;
      } catch { fail('invalid_handoff_configuration'); }
    }
    return new Promise((resolve, reject) => {
      let request, timer;
      const rejectSafe = code => {
        clearTimeout(timer);
        reject(new HandoffError(code, code === 'receipt_invalid' ? 502 : 503, true));
      };
      try {
        request = https.request({ protocol: 'https:', hostname, port: 443, servername: hostname,
          path, method: 'POST', headers, agent: false, rejectUnauthorized: true,
          checkServerIdentity: tls.checkServerIdentity, minVersion: 'TLSv1.2', maxHeaderSize: 16384 }, response => {
          if (response.statusCode < 200 || response.statusCode >= 600 ||
              (response.statusCode >= 300 && response.statusCode < 400) ||
              response.headers['content-type']?.split(';')[0] !== 'application/json' ||
              response.headers['cache-control'] !== 'no-store' ||
              (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')) {
            rejectSafe('receipt_invalid'); response.destroy(); request.destroy(); return;
          }
          const chunks = []; let length = 0;
          response.on('data', chunk => {
            length += chunk.length;
            if (length > 16384) {
              rejectSafe('receipt_invalid'); response.destroy(); request.destroy();
            } else chunks.push(chunk);
          });
          response.on('aborted', () => rejectSafe(unavailable));
          response.on('error', () => rejectSafe(unavailable));
          response.on('end', () => {
            clearTimeout(timer);
            const retryAfter = Number(response.headers['retry-after']);
            // Untrusted bytes go only to the future version-specific decoder;
            // transport success is never an import/receipt-success assertion.
            resolve({ statusCode: response.statusCode, body: Buffer.concat(chunks),
              ...([429, 503].includes(response.statusCode) && Number.isSafeInteger(retryAfter) && retryAfter > 0
                ? { retryAfter: Math.min(retryAfter, 86400) } : {}) });
          });
        });
        timer = setTimeout(() => { rejectSafe(unavailable); request.destroy(); }, this.#timeoutMs);
        request.on('error', () => rejectSafe(unavailable));
        request.on('close', () => clearTimeout(timer));
        request.end(data);
      } catch { request?.destroy(); rejectSafe(unavailable); }
    });
  }
}

module.exports = { I03HttpsTransport, TRUST };

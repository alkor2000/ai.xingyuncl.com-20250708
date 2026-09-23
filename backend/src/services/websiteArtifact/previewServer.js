'use strict';

// The isolated preview origin. Student HTML/JS runs here and nowhere else: a separate Express app on a
// separate listener (separate hostname/port in a deployment), with none of the application's
// middleware, no CORS, no API routes and no access to the platform session.
//
// How a viewer gets in: the API hands out a one-time handoff, which travels in the URL *fragment* and
// therefore never reaches any server log or Referer header. A tiny bootstrap page on this origin reads
// the fragment, exchanges it over POST for an HttpOnly cookie scoped to that one session path, and the
// browser that performed the exchange is the only one the session will answer. Every following request
// re-checks the session, the link, the owner's account, the issuer and the reviewer's eligibility.
const express = require('express');
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { P09Error, message } = require('./errors');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COOKIE = 'p09_preview';
const BASE = '/p09/preview';

// Sandbox without allow-same-origin: the document gets an opaque origin, so the student's script cannot
// read this origin's cookies or storage, and cannot reach the platform session (different origin, no
// credentials). frame-ancestors names exactly who may embed it.
//
// The source list names the isolated origin instead of 'self': in a sandboxed document 'self' is the
// opaque origin and matches nothing, which would block the work's own frozen images and stylesheet. The
// named origin serves only this session's bytes, so naming it grants nothing else.
function securityHeaders(res, frameAncestors, origin) {
  const own = origin || "'self'";
  res.set({
    'Content-Security-Policy': [
      'sandbox allow-scripts allow-forms allow-popups allow-modals',
      `default-src ${own} data: blob:`,
      `img-src ${own} data: blob: https:`,
      `style-src ${own} 'unsafe-inline'`,
      `script-src ${own} 'unsafe-inline' 'unsafe-eval'`,
      `frame-ancestors ${frameAncestors}`
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()'
  });
}
const fail = (res, status, code) => res.status(status).type('text/plain; charset=utf-8').send(message(code));
// What the session is bound to. Not an identity — a stable property of the browser that redeemed the
// handoff, so a cookie copied into another browser stops working. Stated as such in the delivery doc.
const clientBinding = req => `${req.headers['user-agent'] || ''}\n${req.headers['accept-language'] || ''}`;

// The bootstrap page: our own page, never student bytes, so it is not sandboxed — it needs same-origin
// fetch to exchange the fragment for the cookie. The handoff is read from location.hash and replaced.
function bootstrapPage(nonce) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>评阅</title>
<style nonce="${nonce}">body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;
font:16px/1.6 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#555;background:#fafafa}</style>
</head><body><p id="s">正在打开作品…</p><script nonce="${nonce}">
(function(){var h=location.hash||'';var m=/(?:^#|&)h=([A-Za-z0-9_-]{43})(?:&|$)/.exec(h);
history.replaceState(null,'',location.pathname);
if(!m){document.getElementById('s').textContent='评阅入口无效或已过期';return;}
fetch('${BASE}/exchange',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
body:JSON.stringify({handoff:m[1]})}).then(function(r){return r.json().then(function(b){return {ok:r.ok,body:b};});})
.then(function(r){if(r.ok&&r.body&&r.body.location){location.replace(r.body.location);}
else{document.getElementById('s').textContent=(r.body&&r.body.message)||'评阅入口无效或已过期';}})
.catch(function(){document.getElementById('s').textContent='暂不可用，请稍后重试';});})();
</script></body></html>`;
}

function createPreviewApp({ runtime, frameAncestors = "'none'", secureCookie = true }) {
  if (!runtime?.preview || !runtime.service) throw new P09Error('preview_unavailable', 503);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Host gate: this app only ever answers on the configured isolated origin's hostname, so it can never
  // be reached through the application's own origin even if both were put behind one proxy.
  app.use((req, res, next) => {
    const host = String(req.headers.host || '').split(':')[0].toLowerCase();
    if (host !== runtime.preview.hostname.toLowerCase()) return fail(res, 404, 'preview_origin_required');
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    next();
  });

  // The URL that carries the handoff: it carries it in the fragment, so this request's line in any
  // access log is just "/p09/preview/open".
  app.get(`${BASE}/open`, (req, res) => {
    const nonce = randomBytes(16).toString('base64');
    res.set({
      'Content-Security-Policy': ["default-src 'none'", `script-src 'nonce-${nonce}'`, `style-src 'nonce-${nonce}'`,
        "connect-src 'self'", "form-action 'none'", "base-uri 'none'", `frame-ancestors ${frameAncestors}`].join('; '),
      'X-Content-Type-Options': 'nosniff'
    });
    return res.type('text/html; charset=utf-8').send(bootstrapPage(nonce));
  });

  // One-time exchange, bound to this browser. The handoff never becomes a cookie value and is useless
  // after this request; the cookie it mints is refused in any other browser.
  app.post(`${BASE}/exchange`, express.json({ limit: '2kb', strict: true }), async (req, res) => {
    try {
      const origin = req.headers.origin;
      if (origin && origin !== runtime.preview.origin) return res.status(403).json({ message: message('audience_mismatch') });
      const handoff = req.body && typeof req.body.handoff === 'string' ? req.body.handoff : null;
      const opened = await runtime.service.consumeHandoff(handoff, { client: clientBinding(req) });
      // Embedded in edu's page the cookie must be SameSite=None, which browsers only accept together
      // with Secure — so a plain-http laboratory origin uses Lax (enough for a top-level navigation).
      res.cookie(COOKIE, `${opened.session_id}.${opened.secret}`, {
        httpOnly: true, secure: secureCookie, sameSite: secureCookie ? 'none' : 'lax',
        path: `${BASE}/${opened.session_id}`, expires: new Date(opened.expires_at)
      });
      return res.json({ location: `${BASE}/${opened.session_id}/index.html`, expires_at: opened.expires_at });
    } catch (error) {
      const known = error instanceof P09Error;
      return res.status(known ? error.status : 500).json({ message: message(known ? error.code : 'internal_error') });
    }
  });

  app.get(`${BASE}/:sessionId/*`, async (req, res) => {
    try {
      const { sessionId } = req.params;
      if (!UUID.test(sessionId)) return fail(res, 404, 'review_session_invalid');
      const raw = parseCookie(req.headers.cookie, COOKIE);
      if (!raw) return fail(res, 401, 'review_session_invalid');
      const [id, secret] = raw.split('.');
      if (id !== sessionId || !secret) return fail(res, 401, 'audience_mismatch');
      const path = normalise(req.params[0]);
      const file = await runtime.service.resolvePreview({ sessionId, secret, path, client: clientBinding(req) });
      securityHeaders(res, frameAncestors, runtime.preview.origin);
      res.type(file.media_type);
      return res.send(file.body);
    } catch (error) {
      const known = error instanceof P09Error;
      return fail(res, known ? error.status : 500, known ? error.code : 'internal_error');
    }
  });

  app.use((req, res) => fail(res, 404, 'preview_unavailable'));
  return app;
}

// Only the revision's own paths are addressable (pages at the root, assets under assets/, the live
// preview's own uploads/); nothing resolves outside them.
function normalise(raw) {
  const path = String(raw || 'index.html').split('?')[0].replace(/\\/g, '/');
  if (path === '' || path === '/') return 'index.html';
  if (path.includes('..') || path.startsWith('/') || path.length > 255) throw new P09Error('preview_unavailable', 404);
  return path;
}
function parseCookie(header, name) {
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

// Separate listener: in a deployment it is the isolated hostname; in the laboratory it is another port.
// With `tls` it terminates TLS itself; otherwise it serves plain HTTP behind the deployment's proxy.
function startPreviewServer({ runtime, port, host = '127.0.0.1', frameAncestors, secureCookie, tls = null }) {
  const app = createPreviewApp({ runtime, frameAncestors, secureCookie: secureCookie ?? !!tls });
  const server = tls ? require('node:https').createServer(tls, app) : http.createServer(app);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port ?? runtime.preview.port, host, () => resolve({
      server, port: server.address().port,
      async close() { await new Promise(done => server.close(done)); }
    }));
  });
}
module.exports = { createPreviewApp, startPreviewServer, clientBinding, COOKIE, BASE };

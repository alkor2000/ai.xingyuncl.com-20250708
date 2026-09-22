'use strict';

// The isolated preview origin. Student HTML/JS runs here and nowhere else: a separate Express app on a
// separate listener (separate hostname/port in a deployment), with none of the application's
// middleware, no CORS, no API routes and no access to the platform session.
//
// How a viewer gets in: the API hands out a one-time handoff, this origin exchanges it for an
// HttpOnly + Secure + SameSite=None cookie scoped to that one session path, and then re-checks the
// source-side conditions on every single request. A forwarded URL is inert (the handoff is consumed),
// and a forwarded cookie value is bound to a session that expires in minutes and dies with the link.
const express = require('express');
const http = require('node:http');
const { P09Error, message } = require('./errors');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COOKIE = 'p09_preview';
const BASE = '/p09/preview';

// Sandbox without allow-same-origin: the document gets an opaque origin, so the student's script cannot
// read this origin's cookies or storage, and cannot reach the platform session (different origin, no
// credentials). frame-ancestors names exactly who may embed it.
function securityHeaders(res, frameAncestors) {
  res.set({
    'Content-Security-Policy': [
      "sandbox allow-scripts allow-forms allow-popups allow-modals",
      "default-src 'self' data: blob:",
      "img-src 'self' data: blob: https:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
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

  // One-time exchange. The handoff never becomes a cookie value and is useless after this request.
  app.get(`${BASE}/open`, async (req, res) => {
    try {
      const handoff = req.query.h;
      const opened = await runtime.service.consumeHandoff(typeof handoff === 'string' ? handoff : null);
      // Embedded in edu's page the cookie must be SameSite=None, which browsers only accept together
      // with Secure — so a plain-http laboratory origin uses Lax (enough for a top-level navigation).
      res.cookie(COOKIE, `${opened.session_id}.${opened.secret}`, {
        httpOnly: true, secure: secureCookie, sameSite: secureCookie ? 'none' : 'lax',
        path: `${BASE}/${opened.session_id}`, expires: new Date(opened.expires_at)
      });
      // Replace the URL that carried the handoff; the browser keeps only the cookie.
      return res.redirect(302, `${BASE}/${opened.session_id}/index.html`);
    } catch (error) {
      const known = error instanceof P09Error;
      return fail(res, known ? error.status : 500, known ? error.code : 'internal_error');
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
      const file = await runtime.service.resolvePreview({ sessionId, secret, path });
      securityHeaders(res, frameAncestors);
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

// Only the bundle's own flat paths are addressable; nothing resolves outside the revision.
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
function startPreviewServer({ runtime, port, host = '127.0.0.1', frameAncestors, secureCookie }) {
  const app = createPreviewApp({ runtime, frameAncestors, secureCookie });
  const server = http.createServer(app);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port ?? runtime.preview.port, host, () => resolve({
      server, port: server.address().port,
      async close() { await new Promise(done => server.close(done)); }
    }));
  });
}
module.exports = { createPreviewApp, startPreviewServer, COOKIE, BASE };

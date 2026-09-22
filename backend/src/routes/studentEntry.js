'use strict';

// C05 student entry: edu's server exchanges a signed assertion for a one-time handoff, and the
// student's browser spends that handoff for an ordinary practice session. While the entry is switched
// off both endpoints answer a fixed refusal without touching Redis, a credential or the database.
//
// The legacy /api/auth/sso endpoint is untouched: this is a sibling path, not a replacement.
const express = require('express');
const { randomUUID } = require('node:crypto');
const rateLimit = require('express-rate-limit');
const { C05Error, message } = require('../services/studentEntry/errors');
const { loadRuntime } = require('../services/studentEntry/runtime');
const { authenticate } = require('../middleware/authMiddleware');

const SCHEMA_VERSION = 1;
const TICKET = /^[A-Za-z0-9_-]{43}$/;

// Nothing this router answers may be stored by a cache or a proxy, and nothing may leak a referrer.
function envelope(req, res, next) {
  req.c05RequestId = randomUUID();
  res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache', 'Referrer-Policy': 'no-referrer',
    'X-Request-ID': req.c05RequestId });
  next();
}
const refuse = (res, error, requestId) => {
  const known = error instanceof C05Error;
  const code = known ? error.code : 'internal_error';
  if (known && error.retryable) res.set('Retry-After', '2');
  return res.status(known ? error.status : 500)
    .json({ error: { code, message: message(code), retryable: !!(known && error.retryable) }, request_id: requestId });
};

function createStudentEntryRouter({ deps = {}, env = process.env } = {}) {
  const router = express.Router();
  // `envelope` is attached per route rather than with router.use: this router is mounted at
  // /api/auth/sso so that the two sub-paths reach it before the legacy router's authenticate, and a
  // router-level middleware would also run for the legacy POST /api/auth/sso that falls through here.
  // Per-route means the historic endpoint's response is byte-for-byte what it was.

  // edu → practice. The raw bytes are what the signature covers, so the body is not parsed first.
  router.post('/exchange', envelope,
    rateLimit({ windowMs: 60_000, max: 120, keyGenerator: req => String(req.headers['x-edu-nonce'] || req.ip).slice(0, 64),
      handler: (req, res) => refuse(res, new C05Error('rate_limited', 429, true), req.c05RequestId) }),
    express.raw({ type: '*/*', limit: '16kb' }),
    async (req, res) => {
      try {
        const runtime = await loadRuntime({ env, deps });
        if (!runtime.enabled) throw new C05Error(runtime.reason || 'student_entry_disabled', 503);
        const result = await runtime.service.exchange({ rawBody: req.body, headers: req.headers, req });
        return res.json({ ...result, request_id: req.c05RequestId });
      } catch (error) { return refuse(res, error, req.c05RequestId); }
    });

  // browser → practice. The handoff is spent here; the response is an ordinary login payload.
  router.post('/consume', envelope,
    rateLimit({ windowMs: 60_000, max: 60, handler: (req, res) => refuse(res, new C05Error('rate_limited', 429, true), req.c05RequestId) }),
    express.json({ limit: '2kb', strict: true }),
    async (req, res) => {
      try {
        const runtime = await loadRuntime({ env, deps });
        if (!runtime.enabled) throw new C05Error(runtime.reason || 'student_entry_disabled', 503);
        const ticket = req.body && typeof req.body.handoff === 'string' ? req.body.handoff : null;
        if (!ticket || !TICKET.test(ticket)) throw new C05Error('handoff_invalid', 401);
        // The service spends the ticket, re-checks the current state and mints the token inside one
        // transaction, so nothing here can hand back a session for an identity read at another moment.
        const { user, tokens, entry, context } = await runtime.service.consume(ticket);

        // The rest of an ordinary login, from the same two places AuthController uses.
        const SiteConfigService = deps.SiteConfigService || require('../services/auth/SiteConfigService');
        const permissions = await user.getPermissions();
        const siteConfig = await SiteConfigService.getUserSiteConfig(user);
        await user.updateLastLogin();

        // Contract §5 leaves "no long-lived refresh" or "refresh 24h" open; this candidate implements
        // the first half only (a deployment asking for the second is refused by name in config.js), so
        // the browser never receives a refresh token from this entry.
        const session = { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
        return res.json({
          schema_version: SCHEMA_VERSION,
          user: user.toJSON(), permissions, siteConfig, ...session,
          landing: { entry },
          // The lesson/assignment the student came from, for the page to OFFER a link. It is not a task
          // grant: associating a work still needs its own signed context and its own confirmation.
          context: context || null,
          request_id: req.c05RequestId
        });
      } catch (error) { return refuse(res, error, req.c05RequestId); }
    });

  // What this session is allowed to remember: the lesson the student came from, and the school and
  // group the session was issued for. Read by the session itself — the jti comes from the verified
  // token and the account from the verified user, so another account's token finds nothing.
  //
  // It is a cue, not a grant. Associating a work with that lesson still needs P09's own signed task
  // context and the student's own confirmation; nothing here authorizes anything.
  router.get('/context', envelope, authenticate, async (req, res) => {
    try {
      const runtime = await loadRuntime({ env, deps });
      if (!runtime.enabled) throw new C05Error(runtime.reason || 'student_entry_disabled', 503);
      const jti = req.tokenPayload && req.tokenPayload.jti;
      if (!jti || !req.user) throw new C05Error('context_unavailable', 404);
      const row = await runtime.readContext({ jti, userId: req.user.id });
      if (!row) throw new C05Error('context_unavailable', 404);
      return res.json({
        schema_version: SCHEMA_VERSION,
        context: { lesson_id: row.lesson_ref ?? null, assignment_id: row.assignment_ref ?? null },
        scope: { school_ref: row.school_ref, group_id: Number(row.group_id),
          platform_key: row.platform_key, instance_key: row.instance_key ?? null },
        issued_at: row.issued_at, expires_at: row.expires_at,
        // Said in the payload as well as in the code: this is where the student came from, not a claim
        // about any work, and not a submission.
        is_task_association: false,
        request_id: req.c05RequestId
      });
    } catch (error) { return refuse(res, error, req.c05RequestId); }
  });

  // What the login page may show about this entry, without revealing any configuration.
  router.get('/capability', envelope, async (req, res) => {
    try {
      const runtime = await loadRuntime({ env, deps });
      if (!runtime.enabled) return res.json({ schema_version: SCHEMA_VERSION, available: false, request_id: req.c05RequestId });
      // Only what the login page needs to decide whether to draw the button and where it goes. No
      // school map, no policy, no secret — and nothing at all while the entry is switched off.
      return res.json({ schema_version: SCHEMA_VERSION, available: true,
        launch_url: runtime.settings.launchUrl || null, request_id: req.c05RequestId });
    } catch (error) { return refuse(res, error, req.c05RequestId); }
  });

  return router;
}
module.exports = { createStudentEntryRouter };

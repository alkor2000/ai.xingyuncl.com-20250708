'use strict';

// Two HTTP surfaces for P09, both speaking only to the default-off runtime in app.locals.p09Website:
//   * /api/p09/website-artifacts  – the logged-in student's own associations, revisions and previews.
//   * /api/integrations/edu/website-artifacts – edu's server-side reads and actions, authenticated by a
//     static service credential and, for anything touching one student, a signed task grant.
// While the runtime is disabled every call answers website_artifacts_disabled without touching a pool,
// a credential or a peer. Identity never comes from the request body.
const express = require('express');
const { randomUUID, createHash } = require('node:crypto');
const rateLimit = require('express-rate-limit');
const { P09Error, message } = require('../services/websiteArtifact/errors');
const { verifyClient } = require('../services/websiteArtifact/runtime');

const SCHEMA_VERSION = 1;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF = /^[A-Za-z0-9._:-]{1,128}$/;
const GRANT_HEADER = 'x-p09-task-context';

function runtimeOf(req) {
  const runtime = req.app.locals.p09Website;
  if (!runtime || runtime.enabled !== true || !runtime.service) throw new P09Error('website_artifacts_disabled', 503);
  return runtime;
}
function requireKey(req) {
  const key = req.get('Idempotency-Key');
  if (typeof key !== 'string' || !UUID.test(key)) throw new P09Error('invalid_idempotency_key');
  return key;
}
function body(req, allowed) {
  const value = req.body;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new P09Error('invalid_request');
  if (value.schema_version !== SCHEMA_VERSION) throw new P09Error('unsupported_schema');
  if (Object.keys(value).some(key => key !== 'schema_version' && !allowed.includes(key))) throw new P09Error('invalid_request');
  return value;
}
const positive = value => /^[1-9][0-9]{0,18}$/.test(String(value));

// Shared response/error discipline (contracts/00 §3): success carries schema_version + request_id, the
// error envelope carries neither the input nor a schema_version.
function envelope(router) {
  router.use((req, res, next) => {
    req.p09RequestId = randomUUID();
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Request-ID': req.p09RequestId });
    const json = res.json.bind(res);
    res.json = payload => {
      if (res.statusCode >= 400 && !payload?.error?.code) {
        const code = res.statusCode === 401 ? 'unauthenticated' : 'forbidden';
        return json({ error: { code, message: message(code), retryable: false }, request_id: req.p09RequestId });
      }
      return json(payload?.error ? { ...payload, request_id: req.p09RequestId }
        : { schema_version: SCHEMA_VERSION, ...payload, request_id: req.p09RequestId });
    };
    if (req.method === 'POST' && req.headers['content-length'] !== '0' && req.headers['content-length'] !== undefined && !req.is('application/json')) {
      return next(new P09Error('invalid_request', 415));
    }
    next();
  });
}
function errors(router) {
  router.use((req, res, next) => next(new P09Error('invalid_request', 404)));
  router.use((error, req, res, next) => {
    const known = error instanceof P09Error;
    const parser = ['entity.parse.failed', 'entity.too.large', 'charset.unsupported'].includes(error.type);
    const code = known ? error.code : parser ? 'invalid_request' : 'internal_error';
    if (known && error.retryable) res.set('Retry-After', String(error.retryAfter || 2));
    res.status(known ? error.status : parser ? error.status || 400 : 500)
      .json({ error: { code, message: message(code), retryable: !!(known && error.retryable) } });
  });
}
const run = fn => async (req, res, next) => { try { res.json(await fn(req)); } catch (error) { next(error); } };

// ---------------------------------------------------------------------------------------------
// Student surface
// ---------------------------------------------------------------------------------------------
function createStudentRouter({ authenticate }) {
  const router = express.Router();
  envelope(router);
  router.use(rateLimit({ windowMs: 60_000, max: 60, handler: (req, res, next) => next(new P09Error('rate_limited', 429, true)) }));
  router.use(authenticate);
  router.use((req, res, next) => (req.user?.id ? next() : next(new P09Error('unauthenticated', 401))));
  router.use(express.json({ limit: '16kb', strict: true }));

  // The UI asks this first: a deployment with the runtime off renders no P09 entry at all.
  router.get('/capability', run(req => {
    const runtime = req.app.locals.p09Website;
    if (!runtime || runtime.enabled !== true) return { available: false, reason: 'disabled' };
    return { available: true, source_instance: runtime.sourceInstance,
      task_context_configured: runtime.readiness.task_context_configured,
      preview_configured: !!runtime.preview,
      limits: { max_pages: 50, max_bundle_bytes: 8 * 1024 * 1024 } };
  }));

  router.get('/links', run(async req => ({ links: await runtimeOf(req).service.ownerLinks(req.user.id) })));

  // Associate one of my own projects with the task the grant names. The grant travels in a header, is
  // verified before anything is read, and is single use.
  router.post('/links', run(async req => {
    const runtime = runtimeOf(req);
    requireKey(req);
    const input = body(req, ['project_id', 'entry_page_id']);
    if (!positive(input.project_id) || !positive(input.entry_page_id)) throw new P09Error('invalid_request');
    const grant = runtime.grants.verify(req.get(GRANT_HEADER), 'website_artifact_link');
    const result = await runtime.service.link({ ownerUserId: req.user.id, grant,
      projectId: Number(input.project_id), entryPageId: Number(input.entry_page_id) });
    return { link: result.link, replayed: result.replayed };
  }));

  router.post('/links/:id/unlink', run(async req => {
    const runtime = runtimeOf(req);
    if (!UUID.test(req.params.id)) throw new P09Error('link_unavailable', 404);
    const result = await runtime.service.unlink({ ownerUserId: req.user.id, linkId: req.params.id });
    return { link: result.link, replayed: result.replayed };
  }));

  // Freeze a fixed review version of my current work. Idempotent per Idempotency-Key: a double click
  // returns the same revision instead of creating a second one.
  router.post('/links/:id/revisions', run(async req => {
    const runtime = runtimeOf(req);
    if (!UUID.test(req.params.id)) throw new P09Error('link_unavailable', 404);
    const key = requireKey(req);
    const result = await runtime.service.freezeRevision({ ownerUserId: req.user.id, linkId: req.params.id, requestKey: key });
    return { revision: result.revision, replayed: result.replayed };
  }));

  // My own private preview of my own work, on the isolated origin (never on the app origin).
  router.post('/links/:id/preview-sessions', run(async req => {
    const runtime = runtimeOf(req);
    if (!UUID.test(req.params.id)) throw new P09Error('link_unavailable', 404);
    const input = req.body && Object.keys(req.body).length ? body(req, ['revision_ref']) : { revision_ref: null };
    if (input.revision_ref !== undefined && input.revision_ref !== null && !UUID.test(input.revision_ref)) throw new P09Error('invalid_request');
    const session = await runtime.service.openReviewSession({ ownerUserId: req.user.id, linkId: req.params.id,
      revisionRef: input.revision_ref ?? null });
    return { session: openUrl(runtime, session) };
  }));

  errors(router);
  return router;
}

// The handoff is one-time and the URL it sits in is inert after use; the preview origin exchanges it
// for an HttpOnly cookie on its own origin.
function openUrl(runtime, session) {
  return { session_id: session.session_id, expires_at: session.expires_at, target: session.target,
    artifact_ref: session.artifact_ref,
    open_url: runtime.preview ? `${runtime.preview.origin}/p09/preview/open?h=${encodeURIComponent(session.handoff)}` : null };
}

// ---------------------------------------------------------------------------------------------
// edu server-side surface (system credential + task grant)
// ---------------------------------------------------------------------------------------------
function createIntegrationRouter() {
  const router = express.Router();
  envelope(router);
  router.use(rateLimit({ windowMs: 60_000, max: 240, handler: (req, res, next) => next(new P09Error('rate_limited', 429, true)) }));
  router.use(express.json({ limit: '16kb', strict: true }));

  // Canonical request bound by the signature: method, path, sorted query, and the body digest.
  const canonical = req => {
    const query = Object.entries(req.query).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v}`).sort().join('&');
    const payload = req.method === 'GET' ? '' : JSON.stringify(req.body ?? {});
    return `${req.method}\n${req.baseUrl}${req.path}\n${query}\n${createHash('sha256').update(payload).digest('hex')}`;
  };
  const client = (req, action, schoolRef) => {
    const runtime = runtimeOf(req);
    verifyClient({ clients: runtime.clients, clientKey: req.get('x-p09-client'), keyId: req.get('x-p09-key-id'),
      timestamp: req.get('x-p09-timestamp'), nonce: req.get('x-p09-nonce'), signature: req.get('x-p09-signature'),
      canonical: canonical(req), action, schoolRef, now: () => Date.now() });
    return runtime;
  };
  const scopeOf = (runtime, req) => {
    const schoolRef = req.query.school_ref;
    if (typeof schoolRef !== 'string' || !REF.test(schoolRef)) throw new P09Error('invalid_request');
    return { sourceInstance: runtime.sourceInstance, schoolRef };
  };

  // Full current state for one school: what edu needs on first load, for back-filled old projects and
  // to recover a missed pull. `complete` + `watermark` hand off to the incremental read without a gap.
  router.get('/state', run(async req => {
    const runtime = client(req, 'artifacts:read', req.query.school_ref);
    const scope = scopeOf(runtime, req);
    const allowed = ['school_ref', 'assignment_ref', 'student_uuid'];
    if (Object.keys(req.query).some(key => !allowed.includes(key))) throw new P09Error('invalid_request');
    const assignmentRefs = req.query.assignment_ref ? String(req.query.assignment_ref).split(',').slice(0, 50) : null;
    const studentUuids = req.query.student_uuid ? String(req.query.student_uuid).split(',').slice(0, 200) : null;
    if (assignmentRefs && assignmentRefs.some(ref => !REF.test(ref))) throw new P09Error('invalid_request');
    const state = await runtime.service.state(scope, { assignmentRefs, studentUuids });
    return { source_instance: runtime.sourceInstance, ...state };
  }));

  router.get('/events', run(async req => {
    const runtime = client(req, 'artifacts:read', req.query.school_ref);
    const scope = scopeOf(runtime, req);
    const allowed = ['school_ref', 'cursor', 'limit'];
    if (Object.keys(req.query).some(key => !allowed.includes(key))) throw new P09Error('invalid_request');
    const limit = req.query.limit === undefined ? 200 : Number(req.query.limit);
    const result = await runtime.service.events(scope, { cursor: req.query.cursor ?? null, limit });
    return { source_instance: runtime.sourceInstance, ...result };
  }));

  // edu's submit transaction: freeze the student's chosen work into a fixed, verifiable revision.
  router.post('/revisions', run(async req => {
    const runtime = client(req, 'artifacts:freeze');
    const key = requireKey(req);
    const input = body(req, ['artifact_ref']);
    if (!UUID.test(String(input.artifact_ref))) throw new P09Error('invalid_request');
    const grant = runtime.grants.verify(req.get(GRANT_HEADER), 'website_artifact_revision');
    const link = await runtime.store.read(tx => tx.linkByArtifact(runtime.sourceInstance, input.artifact_ref));
    if (!link) throw new P09Error('link_unavailable', 404);
    // The grant must name this student and this assignment; a signed grant for another task or student
    // cannot freeze someone else's work.
    if (link.student_uuid !== grant.subjectUuid || link.assignment_ref !== grant.assignmentRef ||
        link.school_ref !== grant.schoolRef) throw new P09Error('link_unavailable', 404);
    const result = await runtime.service.freezeRevision({ ownerUserId: link.owner_user_id, linkId: link.id, requestKey: key });
    return { revision: result.revision, replayed: result.replayed };
  }));

  // A short-lived, single-audience review session. No permanent, forwardable private link is ever issued.
  router.post('/review-sessions', run(async req => {
    const runtime = client(req, 'artifacts:review');
    const input = req.body && Object.keys(req.body).length ? body(req, []) : {};
    void input;
    const grant = runtime.grants.verify(req.get(GRANT_HEADER), 'website_artifact_review');
    const session = await runtime.service.openReviewSession({ grant });
    return { session: openUrl(runtime, session) };
  }));

  errors(router);
  return router;
}

function mount(app) {
  const { authenticate } = require('../middleware/authMiddleware');
  app.use('/api/p09/website-artifacts', createStudentRouter({ authenticate }));
  app.use('/api/integrations/edu/website-artifacts', createIntegrationRouter());
}
module.exports = { mount, createStudentRouter, createIntegrationRouter, GRANT_HEADER, SCHEMA_VERSION };

'use strict';

// The two HTTP surfaces and the isolated preview origin, driven over real sockets. The runtime is the
// real assembly wired to the in-memory ledger fake, so the checks here are the contract surface:
// default-off refusal, envelope shape, where identity may come from, and what a forwarded link gets.
const express = require('express');
const http = require('node:http');
const { randomUUID, createHash } = require('node:crypto');
const { createStudentRouter, createIntegrationRouter, GRANT_HEADER } = require('../../../routes/websiteArtifacts');
const { createPreviewApp } = require('../../../services/websiteArtifact/previewServer');
const { TaskGrantVerifier, parseIssuers, signGrant } = require('../../../services/websiteArtifact/taskGrant');
const { createService } = require('../../helpers/p09Fixture');

const SECRET = 'lab-issuer-secret-'.repeat(3);
const CLIENT_SECRET = 'edu-client-secret-'.repeat(3);
const CONTENT = '<h1>校园节水</h1><p>先观察，再记录两杯水的变化。</p><p>每天同一时间量水位。</p>';
const INSTANCE = 'practice-lab';

function request(port, { method = 'GET', path = '/', headers = {}, body = null, host } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port, method, path,
      headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        ...(host ? { Host: host } : {}), ...headers } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* preview origin answers text/html */ }
        resolve({ status: res.statusCode, headers: res.headers, json, text });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const listen = app => new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
const close = server => new Promise(resolve => server.close(resolve));

function makeGrant({ purpose = 'website_artifact_link', uuid = 'edu-uuid-0001', assignment = 'assign-1', school = '123',
  artifactRef = null, revisionRef = null, reviewer = null, secret = SECRET } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return signGrant({ secret, schema_version: 1, issuer: 'edu', key_id: 'k1', grant_id: randomUUID(), audience: INSTANCE,
    purpose, school_ref: school, assignment_ref: assignment, lesson_ref: null,
    ...(reviewer ? { reviewer: { ref: reviewer }, artifact_ref: artifactRef, revision_ref: revisionRef }
      : { subject: { uuid, cohort: 'student' } }),
    issued_at: now, expires_at: now + 200 });
}
// edu signs its server-side reads the same way C05 signs exchange: timestamp, nonce and a request digest.
function signClient({ method, path, query = '', body = null }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomUUID().replace(/-/g, '');
  const canonical = `${method}\n${path}\n${query}\n${createHash('sha256').update(body === null ? '' : JSON.stringify(body)).digest('hex')}`;
  const signature = createHash('sha256').update(`${CLIENT_SECRET}\n${timestamp}\n${nonce}\n${createHash('sha256').update(canonical).digest('hex')}`).digest('hex');
  return { 'x-p09-client': 'edu', 'x-p09-key-id': 'k1', 'x-p09-timestamp': String(timestamp),
    'x-p09-nonce': nonce, 'x-p09-signature': signature };
}

function buildApp(runtime, user = { id: 101 }) {
  const app = express();
  app.locals.p09Website = runtime;
  app.use('/api/p09/website-artifacts', createStudentRouter({ authenticate: (req, res, next) => { req.user = user; next(); } }));
  app.use('/api/integrations/edu/website-artifacts', createIntegrationRouter());
  return app;
}
function buildRuntime({ previewEnabled = true, issuers = true } = {}) {
  const context = createService({ previewEnabled });
  context.fixture.addPage({ id: 7, title: '首页', slug: 'home', html: CONTENT });
  const parsed = issuers ? parseIssuers(JSON.stringify([{ issuer: 'edu', key_id: 'k1', secret: SECRET,
    purposes: ['website_artifact_link', 'website_artifact_revision', 'website_artifact_review'] }])) : [];
  return {
    context,
    runtime: {
      enabled: true, switch: 'enabled', sourceInstance: INSTANCE, service: context.service, store: context.store,
      grants: new TaskGrantVerifier({ issuers: parsed, audience: INSTANCE }),
      preview: previewEnabled ? { origin: 'http://preview.localhost:4599', hostname: 'preview.localhost', port: 4599 } : null,
      clients: [{ clientKey: 'edu', keyId: 'k1', secret: CLIENT_SECRET,
        actions: ['artifacts:read', 'artifacts:review', 'artifacts:freeze'], schoolRefs: ['123'] }],
      readiness: { task_context_configured: parsed.length > 0, eligibility_provider: 'absent' }
    }
  };
}

describe('P09 HTTP surfaces', () => {
  let server;
  afterEach(async () => { if (server) await close(server); server = null; });

  test('a disabled deployment renders nothing and answers website_artifacts_disabled everywhere', async () => {
    const app = buildApp({ enabled: false, switch: 'disabled' });
    server = await listen(app);
    const capability = await request(server.address().port, { path: '/api/p09/website-artifacts/capability' });
    expect(capability.status).toBe(200);
    expect(capability.json).toMatchObject({ schema_version: 1, available: false, reason: 'disabled' });
    for (const call of [
      { method: 'GET', path: '/api/p09/website-artifacts/links' },
      { method: 'POST', path: '/api/p09/website-artifacts/links', headers: { 'Idempotency-Key': randomUUID(), [GRANT_HEADER]: makeGrant() }, body: { schema_version: 1, project_id: 3, entry_page_id: 7 } },
      { method: 'GET', path: '/api/integrations/edu/website-artifacts/state?school_ref=123' }
    ]) {
      const response = await request(server.address().port, call);
      expect(response.status).toBe(503);
      expect(response.json.error.code).toBe('website_artifacts_disabled');
      expect(response.json.schema_version).toBeUndefined();     // errors never carry schema_version
      expect(response.json.request_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(response.headers['cache-control']).toBe('no-store');
    }
  });

  test('without a configured issuer the endpoints exist and refuse every grant-bearing call', async () => {
    const { runtime } = buildRuntime({ issuers: false });
    server = await listen(buildApp(runtime));
    const capability = await request(server.address().port, { path: '/api/p09/website-artifacts/capability' });
    expect(capability.json).toMatchObject({ available: true, task_context_configured: false });
    const refused = await request(server.address().port, { method: 'POST', path: '/api/p09/website-artifacts/links',
      headers: { 'Idempotency-Key': randomUUID(), [GRANT_HEADER]: makeGrant() },
      body: { schema_version: 1, project_id: 3, entry_page_id: 7 } });
    expect(refused.status).toBe(503);
    expect(refused.json.error.code).toBe('task_context_unavailable');
  });

  test('association needs a signed grant: a body-supplied assignment or a missing/foreign grant is refused', async () => {
    const { runtime } = buildRuntime();
    server = await listen(buildApp(runtime));
    const port = server.address().port;
    const base = { method: 'POST', path: '/api/p09/website-artifacts/links', body: { schema_version: 1, project_id: 3, entry_page_id: 7 } };
    const missing = await request(port, { ...base, headers: { 'Idempotency-Key': randomUUID() } });
    expect(missing.json.error.code).toBe('task_context_required');
    const forged = await request(port, { ...base, headers: { 'Idempotency-Key': randomUUID(), [GRANT_HEADER]: makeGrant({ secret: 'z'.repeat(40) }) } });
    expect(forged.json.error.code).toBe('task_context_invalid');
    // An assignment id in the request body is not a way in: unknown fields are refused outright.
    const smuggled = await request(port, { method: 'POST', path: '/api/p09/website-artifacts/links',
      headers: { 'Idempotency-Key': randomUUID(), [GRANT_HEADER]: makeGrant() },
      body: { schema_version: 1, project_id: 3, entry_page_id: 7, assignment_ref: 'assign-99', student_uuid: 'edu-uuid-9999' } });
    expect(smuggled.json.error.code).toBe('invalid_request');
    const noKey = await request(port, { ...base, headers: { [GRANT_HEADER]: makeGrant() } });
    expect(noKey.json.error.code).toBe('invalid_idempotency_key');

    const created = await request(port, { ...base, headers: { 'Idempotency-Key': randomUUID(), [GRANT_HEADER]: makeGrant() } });
    expect(created.status).toBe(200);
    // The seeded project was written before P09 watched it: the surface says 未知 with its reason, and
    // never a guessed 未开始 or a claimed 制作中.
    expect(created.json).toMatchObject({ schema_version: 1, link: { assignment_ref: 'assign-1', work_state: 'unknown',
      has_effective_save: null, save_evidence: 'legacy_unknown', save_evidence_reason: 'history_before_observation' } });
  });

  test('edu reads need a service credential and stay inside the school scope', async () => {
    const { runtime } = buildRuntime();
    server = await listen(buildApp(runtime));
    const port = server.address().port;
    await request(port, { method: 'POST', path: '/api/p09/website-artifacts/links',
      headers: { 'Idempotency-Key': randomUUID(), [GRANT_HEADER]: makeGrant() },
      body: { schema_version: 1, project_id: 3, entry_page_id: 7 } });

    const unsigned = await request(port, { path: '/api/integrations/edu/website-artifacts/state?school_ref=123' });
    expect(unsigned.status).toBe(401);
    const path = '/api/integrations/edu/website-artifacts/state';
    const signed = await request(port, { path: `${path}?school_ref=123`,
      headers: signClient({ method: 'GET', path, query: 'school_ref=123' }) });
    expect(signed.status).toBe(200);
    expect(signed.json.items).toHaveLength(1);
    expect(signed.json.items[0].student_uuid).toBe('edu-uuid-0001');
    expect(signed.json).toMatchObject({ complete: true, source_instance: INSTANCE });
    expect(JSON.stringify(signed.json)).not.toContain('校园节水</h1>');

    // Another school is outside this client's scope even with a valid signature.
    const other = await request(port, { path: `${path}?school_ref=456`,
      headers: signClient({ method: 'GET', path, query: 'school_ref=456' }) });
    expect(other.status).toBe(404);
    expect(other.json.error.code).toBe('school_not_provisioned');
    // A signature over another path does not authorise this one.
    const swapped = await request(port, { path: `${path}?school_ref=123`,
      headers: signClient({ method: 'GET', path: '/api/integrations/edu/website-artifacts/events', query: 'school_ref=123' }) });
    expect(swapped.status).toBe(401);
  });

  test('the isolated preview origin exchanges a fragment handoff for a browser-bound cookie', async () => {
    const { runtime, context } = buildRuntime();
    server = await listen(buildApp(runtime));
    const port = server.address().port;
    const linked = await request(port, { method: 'POST', path: '/api/p09/website-artifacts/links',
      headers: { 'Idempotency-Key': randomUUID(), [GRANT_HEADER]: makeGrant() },
      body: { schema_version: 1, project_id: 3, entry_page_id: 7 } });
    const links = await context.service.ownerLinks(101);
    const opened = await request(port, { method: 'POST', path: `/api/p09/website-artifacts/links/${links[0].link_id}/preview-sessions` });
    expect(opened.status).toBe(200);
    // The handoff travels in the fragment: it never reaches a server log or a Referer header.
    expect(opened.json.session.open_url).toContain('http://preview.localhost:4599/p09/preview/open#h=');
    expect(opened.json.session.open_url).not.toContain('?');
    expect(linked.json.link.artifact_ref).toBe(opened.json.session.artifact_ref);

    const preview = await listen(createPreviewApp({ runtime, frameAncestors: "'none'", secureCookie: false }));
    try {
      const previewPort = preview.address().port;
      const handoff = opened.json.session.open_url.split('#h=')[1];
      const teacher = { 'User-Agent': 'TeacherBrowser/1.0', 'Accept-Language': 'zh-CN' };
      const thief = { 'User-Agent': 'OtherBrowser/9.9', 'Accept-Language': 'en-US' };
      // Served only on the isolated hostname: the same path on any other Host is a 404.
      const wrongHost = await request(previewPort, { path: '/p09/preview/open', host: 'ai.example.com' });
      expect(wrongHost.status).toBe(404);

      // The bootstrap page carries no token and runs under its own strict policy (not the sandbox one).
      const bootstrap = await request(previewPort, { path: '/p09/preview/open', host: 'preview.localhost', headers: teacher });
      expect(bootstrap.status).toBe(200);
      expect(bootstrap.text).not.toContain(handoff);
      expect(bootstrap.headers['content-security-policy']).toContain("default-src 'none'");

      const exchange = await request(previewPort, { method: 'POST', path: '/p09/preview/exchange', host: 'preview.localhost',
        headers: teacher, body: { handoff } });
      expect(exchange.status).toBe(200);
      const cookie = String(exchange.headers['set-cookie'][0]);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');  // http laboratory origin; https deployments send None+Secure
      const page = await request(previewPort, { path: exchange.json.location, host: 'preview.localhost',
        headers: { ...teacher, Cookie: cookie.split(';')[0] } });
      expect(page.status).toBe(200);
      expect(page.text).toContain('校园节水');
      expect(page.headers['content-security-policy']).toContain('sandbox allow-scripts');
      expect(page.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(page.headers['x-content-type-options']).toBe('nosniff');

      // The cookie is bound to the browser that redeemed the handoff…
      const stolenCookie = await request(previewPort, { path: exchange.json.location, host: 'preview.localhost',
        headers: { ...thief, Cookie: cookie.split(';')[0] } });
      expect(stolenCookie.status).toBe(403);
      // …the handoff itself is single use, and a cookie-less request gets nothing.
      const replay = await request(previewPort, { method: 'POST', path: '/p09/preview/exchange', host: 'preview.localhost',
        headers: thief, body: { handoff } });
      expect(replay.status).toBe(401);
      const noCookie = await request(previewPort, { path: exchange.json.location, host: 'preview.localhost', headers: teacher });
      expect(noCookie.status).toBe(401);
      // Path traversal out of the bundle is refused.
      const escape = await request(previewPort, { path: `/p09/preview/${exchange.json.location.split('/')[3]}/../../etc/passwd`,
        host: 'preview.localhost', headers: { ...teacher, Cookie: cookie.split(';')[0] } });
      expect([400, 401, 404]).toContain(escape.status);
    } finally { await close(preview); }
  });
});

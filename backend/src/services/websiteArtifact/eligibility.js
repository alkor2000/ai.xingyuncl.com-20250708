'use strict';

// Who may open a private review, asked again on every access.
//
// A signed task grant proves that edu authorised *one* opening. It does not prove that the same teacher
// still teaches the task three minutes later, so P09 never treats a consumed ticket as continuing
// eligibility: every rendered byte asks this provider again. practice has no teacher roster of its own —
// so with no provider configured the interface exists and refuses (`eligibility_unavailable`), exactly
// like the task-context issuers. The static provider below is a laboratory stand-in for edu's future
// endpoint and is accepted only in development/test.
const { createHash, randomBytes } = require('node:crypto');
const https = require('node:https');
const http = require('node:http');
const fs = require('node:fs');
const { fail } = require('./errors');

const REF = /^[A-Za-z0-9._:-]{1,128}$/;
// The reasons edu's provider can answer with, read from its own source at d2f54c9e
// (internal/services/e09_eligibility.go), plus the four this repository's laboratory stand-in uses.
// Anything outside this list is reported as a plain refusal rather than echoed back.
const REASONS = Object.freeze(new Set([
  'request_incomplete', 'purpose_unsupported', 'instance_mismatch', 'reviewer_unknown',
  'assignment_unknown', 'school_mismatch', 'assignment_closed', 'school_unmapped',
  'student_not_in_roster', 'link_revoked', 'not_eligible',
  'reviewer_not_in_school', 'reviewer_revoked', 'reviewer_not_on_assignment', 'student_not_in_class'
]));
const UNAVAILABLE = Object.freeze({ eligible: false, reason: 'eligibility_unavailable' });
const reviewerHash = (issuer, ref) => createHash('sha256').update(`${issuer}\n${ref}`).digest('hex');

function absentProvider() {
  return Object.freeze({
    mode: 'absent', cacheMs: 0,
    async check() { return { eligible: false, reason: 'eligibility_unavailable' }; }
  });
}

// spec: { mode: 'static', cache_ms?: number, rules: [{ issuer, reviewer_ref, school_ref,
//         assignment_refs: [...], student_uuids?: [...], revoked?: bool }] }
function createEligibilityProvider(spec, { env = process.env, request = null, now = Date.now } = {}) {
  if (spec === undefined || spec === null) return absentProvider();
  // `http` is the only mode a deployment may assemble: it asks edu itself. `static` stays a laboratory
  // stand-in and is still refused outside development/test.
  if (spec && spec.mode === 'http') return createHttpProvider(spec, { env, request, now });
  if (!['development', 'test'].includes(env.NODE_ENV)) fail('invalid_request');
  if (typeof spec !== 'object' || Array.isArray(spec) || spec.mode !== 'static' ||
      Object.keys(spec).some(key => !['mode', 'cache_ms', 'rules'].includes(key)) ||
      !Array.isArray(spec.rules) || spec.rules.length > 64) fail('invalid_request');
  const rules = spec.rules.map(rule => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule) ||
        Object.keys(rule).some(key => !['issuer', 'reviewer_ref', 'school_ref', 'assignment_refs', 'student_uuids', 'revoked'].includes(key)) ||
        typeof rule.issuer !== 'string' || typeof rule.reviewer_ref !== 'string' || !REF.test(rule.reviewer_ref) ||
        typeof rule.school_ref !== 'string' || !REF.test(rule.school_ref) ||
        !Array.isArray(rule.assignment_refs) || rule.assignment_refs.some(ref => !REF.test(String(ref)))) fail('invalid_request');
    return Object.freeze({
      audienceRef: reviewerHash(rule.issuer, rule.reviewer_ref), schoolRef: rule.school_ref,
      assignmentRefs: Object.freeze([...rule.assignment_refs].map(String)),
      studentUuids: Array.isArray(rule.student_uuids) ? Object.freeze(rule.student_uuids.map(String)) : null,
      revoked: rule.revoked === true
    });
  });
  const cacheMs = Number.isInteger(spec.cache_ms) && spec.cache_ms >= 0 && spec.cache_ms <= 60_000 ? spec.cache_ms : 0;
  return Object.freeze({
    mode: 'experimental_static', cacheMs,
    // Reasons are vocabulary, not free text: edu's real provider answers with the same shape.
    async check({ audienceRef, schoolRef, assignmentRef, studentUuid }) {
      const rule = rules.find(item => item.audienceRef === audienceRef && item.schoolRef === schoolRef);
      if (!rule) return { eligible: false, reason: 'reviewer_not_in_school' };
      if (rule.revoked) return { eligible: false, reason: 'reviewer_revoked' };
      if (!rule.assignmentRefs.includes(String(assignmentRef))) return { eligible: false, reason: 'reviewer_not_on_assignment' };
      if (rule.studentUuids && !rule.studentUuids.includes(String(studentUuid))) return { eligible: false, reason: 'student_not_in_class' };
      return { eligible: true };
    }
  });
}

// ---------------------------------------------------------------------------------------------
// mode: 'http' — ask edu, once per access.
//
// The shapes below are not taken from a description: they were read from edu's own fixed source at
// commit d2f54c9e (internal/handlers/e09_eligibility.go, internal/services/e09_eligibility.go,
// internal/integrations/e09website/{verify.go,signing.go}). Where that source and the adaptation note
// disagree, the source wins and the difference is written down in the delivery document:
//   * edu's request struct has NO `audience_ref`. It decodes with DisallowUnknownFields, so a body
//     carrying one is a 400. What it wants is `reviewer_ref`, and `teaches()` parses that as edu's
//     numeric user id.
//   * a refusal is NOT `{eligible:false}` with 200. It is 403 with
//     {"error":{"code":"not_eligible","message":<reason>,"retryable":false},"decided_at":…}.
//   * a success is 200 with {schema_version, eligible, reason?, decided_at, expires_at}.
//
// Everything that is not a clean, well-formed answer is `eligibility_unavailable`: a timeout, a TLS
// failure, a redirect, an oversized body, a 401 about our own credential, a 5xx, anything. This
// provider never falls back to the static stand-in and never reuses the last successful answer.
const SIGNED_HEADERS = Object.freeze(['x-p09-client', 'x-p09-key-id', 'x-p09-timestamp', 'x-p09-nonce',
  'x-p09-signature']);

// The construction edu's Verifier checks (signing.go): sha256 over method, path, the query sorted by
// name, and the body digest, then sha256 over secret, timestamp, nonce and that inner digest.
function signEligibility({ secret, method, path, query = '', body = '', timestamp, nonce }) {
  const canonical = [method, path, query, createHash('sha256').update(body).digest('hex')].join('\n');
  const inner = createHash('sha256').update(canonical).digest('hex');
  return createHash('sha256').update(`${secret}\n${timestamp}\n${nonce}\n${inner}`).digest('hex');
}

function httpSpec(spec, env) {
  const allowed = ['mode', 'endpoint', 'client_key', 'key_id', 'secret', 'source_instance', 'purpose',
    'timeout_ms', 'max_bytes', 'ca_file', 'cache_ms', 'reviewer_ref', 'reviewer_refs'];
  if (typeof spec !== 'object' || Array.isArray(spec) ||
      Object.keys(spec).some(key => !allowed.includes(key))) fail('invalid_request');
  let endpoint;
  try { endpoint = new URL(spec.endpoint); } catch { fail('invalid_request'); }
  // A teacher's or a student's request can never influence where this goes: the endpoint is one fixed
  // value from the deployment's own configuration, and it must be https with nothing else attached.
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash) {
    fail('invalid_request');
  }
  if (typeof spec.client_key !== 'string' || !/^[a-z0-9_-]{2,32}$/.test(spec.client_key) ||
      typeof spec.key_id !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(spec.key_id) ||
      typeof spec.secret !== 'string' || spec.secret.length < 32) fail('invalid_request');
  // A named mapping holds edu's own teacher references inside this deployment's configuration. The
  // workspace rule is that this platform does not keep another platform's local teacher ids, so the
  // mapping exists for a laboratory fixture and nowhere else: a production configuration that asks for
  // it — or that carries plaintext references at all — is refused by name rather than by a sentence in
  // a document. The formal candidate path is `audience_hash`, and the reference form is edu's to fix.
  const laboratory = ['development', 'test'].includes(env && env.NODE_ENV);
  if (!laboratory && (spec.reviewer_ref === 'mapping' || spec.reviewer_refs !== undefined)) {
    fail('invalid_request');
  }
  const reviewerRefMode = spec.reviewer_ref === 'mapping' ? 'mapping' : 'audience_hash';
  const mapping = new Map();
  if (spec.reviewer_refs !== undefined) {
    if (typeof spec.reviewer_refs !== 'object' || Array.isArray(spec.reviewer_refs)) fail('invalid_request');
    for (const [hash, ref] of Object.entries(spec.reviewer_refs)) {
      if (!/^[0-9a-f]{64}$/.test(hash) || typeof ref !== 'string' || !REF.test(ref)) fail('invalid_request');
      mapping.set(hash, ref);
    }
  }
  if (reviewerRefMode === 'mapping' && mapping.size === 0) fail('invalid_request');
  let ca = null;
  if (spec.ca_file !== undefined) {
    if (typeof spec.ca_file !== 'string' || spec.ca_file === '') fail('invalid_request');
    try { ca = fs.readFileSync(spec.ca_file); } catch { fail('invalid_request'); }
  }
  return Object.freeze({
    endpoint,
    clientKey: spec.client_key, keyId: spec.key_id, secret: spec.secret,
    sourceInstance: typeof spec.source_instance === 'string' ? spec.source_instance : null,
    purpose: typeof spec.purpose === 'string' ? spec.purpose : 'website_artifact_review',
    timeoutMs: Number.isInteger(spec.timeout_ms) && spec.timeout_ms >= 200 && spec.timeout_ms <= 10_000
      ? spec.timeout_ms : 2000,
    maxBytes: Number.isInteger(spec.max_bytes) && spec.max_bytes >= 256 && spec.max_bytes <= 65_536
      ? spec.max_bytes : 8192,
    cacheMs: Number.isInteger(spec.cache_ms) && spec.cache_ms >= 0 && spec.cache_ms <= 60_000 ? spec.cache_ms : 0,
    reviewerRefMode, reviewerRefs: mapping, ca
  });
}

// One request, bounded in time and in bytes, with no redirect ever followed: a 3xx is an answer this
// provider does not understand, and the signature is never replayed to a location someone else chose.
//
// `timeout_ms` is an ABSOLUTE budget, not only a gap between bytes. A socket timeout fires when nothing
// arrives; a provider that drips one byte at a time — each sooner than the timeout, all of them under
// the size cap — would otherwise hold a student's page open for as long as it liked. (Measured before
// this was added: 6.2 seconds against a 400ms configuration.) The deadline covers connect to end, and
// every way out of here clears the timer and destroys the request.
function askEdu(config, payload, { request, now }) {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(now() / 1000);
  // Cryptographic randomness, not Math.random: this nonce is what stops a replay at edu's verifier.
  const nonce = randomBytes(16).toString('hex');
  const headers = {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'x-p09-client': config.clientKey, 'x-p09-key-id': config.keyId,
    'x-p09-timestamp': String(timestamp), 'x-p09-nonce': nonce,
    'x-p09-signature': signEligibility({
      secret: config.secret, method: 'POST', path: config.endpoint.pathname,
      query: config.endpoint.search.replace(/^\?/, ''), body, timestamp, nonce })
  };
  if (typeof request === 'function') return request({ config, body, headers });   // tests only
  const transport = config.endpoint.protocol === 'https:' ? https : http;
  return new Promise(resolve => {
    let settled = false;
    let request = null;
    const deadline = setTimeout(() => finish({ status: null, text: null }), config.timeoutMs);
    function finish(value) {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      try { if (request) request.destroy(); } catch { /* already gone */ }
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
    request = req;
    req.on('timeout', () => finish({ status: null, text: null }));      // no byte for timeout_ms
    req.on('error', () => finish({ status: null, text: null }));
    req.end(body);
  });
}

// Nothing here is turned into a pass by coercion: `eligible` must be exactly true, and the string
// "true" or an empty body or an error page is a refusal, not an answer.
function readAnswer({ status, text }) {
  if (status === null || typeof text !== 'string') return UNAVAILABLE;
  let payload = null;
  try { payload = JSON.parse(text); } catch { return UNAVAILABLE; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return UNAVAILABLE;
  if (status === 200) {
    if (payload.schema_version !== 1) return UNAVAILABLE;
    if (payload.eligible === true) return { eligible: true };
    if (payload.eligible === false) {
      return { eligible: false, reason: REASONS.has(payload.reason) ? payload.reason : 'not_eligible' };
    }
    return UNAVAILABLE;                                  // not a boolean: not an answer
  }
  if (status === 403) {
    const error = payload.error;
    if (!error || typeof error !== 'object') return UNAVAILABLE;
    const named = REASONS.has(error.message) ? error.message : (REASONS.has(error.code) ? error.code : 'not_eligible');
    return { eligible: false, reason: named };
  }
  // 400 (our request shape), 401 (our credential), 5xx, anything else: this deployment could not get
  // an answer. It is NOT "the teacher may not look" and must never be shown as one.
  return UNAVAILABLE;
}

function createHttpProvider(spec, { env, request, now }) {
  const config = httpSpec(spec, env);
  return Object.freeze({
    mode: 'http', cacheMs: config.cacheMs, endpointHost: config.endpoint.host,
    reviewerRefMode: config.reviewerRefMode,
    async check({ audienceRef, schoolRef, assignmentRef, studentUuid }) {
      // What edu's handler needs is its own reviewer reference. This repository keeps only
      // sha256(issuer + "\n" + reviewer_ref) — the plaintext is discarded by taskGrant.js on purpose
      // and is not in the session — so a deployment either sends the hash (and edu decides what to do
      // with it) or names the mapping explicitly. An unmapped reviewer is refused here, without a call.
      let reviewerRef = audienceRef;
      if (config.reviewerRefMode === 'mapping') {
        reviewerRef = config.reviewerRefs.get(String(audienceRef)) || null;
        if (!reviewerRef) return { eligible: false, reason: 'reviewer_unknown' };
      }
      const payload = { schema_version: 1, school_ref: String(schoolRef), assignment_ref: String(assignmentRef),
        reviewer_ref: String(reviewerRef), student_uuid: String(studentUuid), purpose: config.purpose };
      if (config.sourceInstance) payload.source_instance = config.sourceInstance;
      try {
        return readAnswer(await askEdu(config, payload, { request, now }));
      } catch {
        return UNAVAILABLE;                              // a throw is an outage, never a pass
      }
    }
  });
}

module.exports = { createEligibilityProvider, absentProvider, reviewerHash, REASONS, signEligibility };

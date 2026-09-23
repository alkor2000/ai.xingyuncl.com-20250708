'use strict';

// Task context for P09. The assignment/lesson scope and the student subject NEVER come from the browser
// or the request body: they come from a detached-signature grant minted by a configured issuer (edu).
// With no issuer configured every grant-bearing endpoint refuses (task_context_unavailable) — that is the
// deployed default, and the synthetic laboratory issuer is accepted only in development/test.
//
// Token: "p09g.<base64url(payload bytes)>.<base64url(HMAC-SHA256 over those exact bytes)>". The signature
// covers the bytes that are parsed, so no canonicalisation step can disagree with what was verified.
const { createHmac, timingSafeEqual, createHash } = require('node:crypto');
const { fail } = require('./errors');

const PREFIX = 'p09g';
const MAX_TOKEN_BYTES = 4096;
const PURPOSES = Object.freeze({
  // Student associates one of their own projects with a teaching task (single use, consumed on commit).
  website_artifact_link: { ttl: 900, subject: 'student' },
  // edu freezes a fixed review revision on the student's explicit submit (single use).
  website_artifact_revision: { ttl: 300, subject: 'student' },
  // An approved teacher opens the private preview or a fixed revision (single use, short lived).
  website_artifact_review: { ttl: 300, subject: 'reviewer' }
});
const FIELDS = Object.freeze(['schema_version', 'issuer', 'key_id', 'grant_id', 'audience', 'purpose', 'school_ref',
  'assignment_ref', 'lesson_ref', 'subject', 'reviewer', 'artifact_ref', 'revision_ref', 'issued_at', 'expires_at']);
const REQUIRED = Object.freeze(['schema_version', 'issuer', 'key_id', 'grant_id', 'audience', 'purpose', 'school_ref',
  'assignment_ref', 'issued_at', 'expires_at']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF = /^[A-Za-z0-9._:-]{1,128}$/;
const text = (value, re) => typeof value === 'string' && re.test(value);

// Issuer registry. Secrets arrive from deployment configuration only; they never appear in errors or logs.
function parseIssuers(raw) {
  if (raw === undefined || raw === '') return [];
  let list;
  try { list = JSON.parse(raw); } catch { fail('task_context_unavailable', 503); }
  if (!Array.isArray(list) || list.length === 0 || list.length > 8) fail('task_context_unavailable', 503);
  return list.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        Object.keys(item).some(k => !['issuer', 'key_id', 'secret', 'purposes'].includes(k)) ||
        !text(item.issuer, /^[a-z0-9_-]{2,32}$/) || !text(item.key_id, /^[A-Za-z0-9_-]{1,32}$/) ||
        typeof item.secret !== 'string' || item.secret.length < 32 || item.secret.length > 512 ||
        !Array.isArray(item.purposes) || item.purposes.length === 0 ||
        item.purposes.some(p => !Object.hasOwn(PURPOSES, p))) fail('task_context_unavailable', 503);
    return Object.freeze({ issuer: item.issuer, keyId: item.key_id, secret: item.secret, purposes: Object.freeze([...item.purposes]) });
  });
}

class TaskGrantVerifier {
  #issuers;
  constructor({ issuers, audience, now = Date.now, skewSeconds = 300 }) {
    if (!Array.isArray(issuers) || !text(audience, /^[a-z0-9-]{2,64}$/) || typeof now !== 'function' ||
        !Number.isInteger(skewSeconds) || skewSeconds < 30 || skewSeconds > 600) fail('invalid_request');
    this.#issuers = issuers;
    Object.assign(this, { audience, now, skewSeconds, configured: issuers.length > 0 });
  }
  // Returns the verified grant. Every refusal is fail-closed with a fixed code and no input echo.
  verify(token, expectedPurpose) {
    if (!this.configured) fail('task_context_unavailable', 503);
    if (!Object.hasOwn(PURPOSES, expectedPurpose)) fail('invalid_request');
    if (typeof token !== 'string' || token.length === 0) fail('task_context_required', 401);
    if (Buffer.byteLength(token) > MAX_TOKEN_BYTES) fail('task_context_invalid', 401);
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== PREFIX) fail('task_context_invalid', 401);
    let payloadBytes, signature;
    try {
      payloadBytes = Buffer.from(parts[1], 'base64url');
      signature = Buffer.from(parts[2], 'base64url');
      if (payloadBytes.toString('base64url') !== parts[1] || signature.toString('base64url') !== parts[2]) throw new Error();
    } catch { fail('task_context_invalid', 401); }
    if (signature.length !== 32 || payloadBytes.length === 0) fail('task_context_invalid', 401);
    let payload;
    try { payload = JSON.parse(payloadBytes.toString('utf8')); } catch { fail('task_context_invalid', 401); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('task_context_invalid', 401);
    if (Object.keys(payload).some(k => !FIELDS.includes(k))) fail('task_context_invalid', 401); // unknown fields rejected
    if (REQUIRED.some(k => payload[k] === undefined || payload[k] === null)) fail('task_context_invalid', 401);
    if (payload.schema_version !== 1) fail('task_context_invalid', 401);
    if (!text(payload.issuer, /^[a-z0-9_-]{2,32}$/) || !text(payload.key_id, /^[A-Za-z0-9_-]{1,32}$/) ||
        !text(payload.grant_id, UUID) || !text(payload.audience, /^[a-z0-9-]{2,64}$/) ||
        !text(payload.school_ref, REF) || !text(payload.assignment_ref, REF) ||
        (payload.lesson_ref !== undefined && payload.lesson_ref !== null && !text(payload.lesson_ref, REF)) ||
        !Number.isSafeInteger(payload.issued_at) || !Number.isSafeInteger(payload.expires_at)) fail('task_context_invalid', 401);
    if (payload.purpose !== expectedPurpose) fail('task_context_invalid', 401);
    const issuer = this.#issuers.find(i => i.issuer === payload.issuer && i.keyId === payload.key_id);
    if (!issuer || !issuer.purposes.includes(payload.purpose)) fail('task_context_invalid', 401);
    const expected = createHmac('sha256', issuer.secret).update(payloadBytes).digest();
    if (expected.length !== signature.length || !timingSafeEqual(expected, signature)) fail('task_context_invalid', 401);
    // Instance binding before anything else is trusted: a grant for the other practice instance is refused
    // even when correctly signed, so two instances can never accept each other's task context.
    if (payload.audience !== this.audience) fail('task_context_instance_mismatch', 403);
    const nowS = Math.floor(this.now() / 1000);
    const spec = PURPOSES[payload.purpose];
    if (Math.abs(nowS - payload.issued_at) > this.skewSeconds) fail('task_context_expired', 401);
    if (payload.expires_at <= payload.issued_at || payload.expires_at > payload.issued_at + spec.ttl) fail('task_context_invalid', 401);
    if (nowS >= payload.expires_at) fail('task_context_expired', 401);
    if (spec.subject === 'student') {
      const subject = payload.subject;
      if (!subject || typeof subject !== 'object' || Array.isArray(subject) ||
          Object.keys(subject).some(k => !['uuid', 'cohort'].includes(k)) ||
          !text(subject.uuid, /^[A-Za-z0-9._:-]{8,100}$/) || subject.cohort !== 'student') fail('task_context_invalid', 401);
      if (payload.reviewer !== undefined && payload.reviewer !== null) fail('task_context_invalid', 401);
    } else {
      const reviewer = payload.reviewer;
      if (!reviewer || typeof reviewer !== 'object' || Array.isArray(reviewer) ||
          Object.keys(reviewer).some(k => !['ref'].includes(k)) || !text(reviewer.ref, REF)) fail('task_context_invalid', 401);
      // A review grant always names exactly one artifact; revision_ref null means "current private preview".
      if (!text(payload.artifact_ref, UUID)) fail('task_context_invalid', 401);
      if (payload.revision_ref !== undefined && payload.revision_ref !== null && !text(payload.revision_ref, UUID)) fail('task_context_invalid', 401);
      if (payload.subject !== undefined && payload.subject !== null) fail('task_context_invalid', 401);
    }
    return Object.freeze({
      grantId: payload.grant_id, issuer: payload.issuer, keyId: payload.key_id, purpose: payload.purpose,
      schoolRef: payload.school_ref, assignmentRef: payload.assignment_ref, lessonRef: payload.lesson_ref ?? null,
      subjectUuid: spec.subject === 'student' ? payload.subject.uuid : null,
      reviewerRef: spec.subject === 'reviewer' ? createHash('sha256').update(`${payload.issuer}\n${payload.reviewer.ref}`).digest('hex') : null,
      artifactRef: payload.artifact_ref ?? null, revisionRef: payload.revision_ref ?? null,
      issuedAt: payload.issued_at, expiresAt: payload.expires_at
    });
  }
}
// Laboratory/contract-test issuer: produces exactly the bytes the verifier accepts. Never used by the
// runtime itself — the harness and the contract tests sign with it to stand in for a real edu issuer.
function signGrant({ secret, ...payload }) {
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  return `${PREFIX}.${bytes.toString('base64url')}.${createHmac('sha256', secret).update(bytes).digest('base64url')}`;
}
module.exports = { TaskGrantVerifier, parseIssuers, signGrant, PURPOSES, PREFIX };

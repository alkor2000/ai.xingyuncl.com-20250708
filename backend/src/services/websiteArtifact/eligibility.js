'use strict';

// Who may open a private review, asked again on every access.
//
// A signed task grant proves that edu authorised *one* opening. It does not prove that the same teacher
// still teaches the task three minutes later, so P09 never treats a consumed ticket as continuing
// eligibility: every rendered byte asks this provider again. practice has no teacher roster of its own —
// so with no provider configured the interface exists and refuses (`eligibility_unavailable`), exactly
// like the task-context issuers. The static provider below is a laboratory stand-in for edu's future
// endpoint and is accepted only in development/test.
const { createHash } = require('node:crypto');
const { fail } = require('./errors');

const REF = /^[A-Za-z0-9._:-]{1,128}$/;
const reviewerHash = (issuer, ref) => createHash('sha256').update(`${issuer}\n${ref}`).digest('hex');

function absentProvider() {
  return Object.freeze({
    mode: 'absent', cacheMs: 0,
    async check() { return { eligible: false, reason: 'eligibility_unavailable' }; }
  });
}

// spec: { mode: 'static', cache_ms?: number, rules: [{ issuer, reviewer_ref, school_ref,
//         assignment_refs: [...], student_uuids?: [...], revoked?: bool }] }
function createEligibilityProvider(spec, { env = process.env } = {}) {
  if (spec === undefined || spec === null) return absentProvider();
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
module.exports = { createEligibilityProvider, absentProvider, reviewerHash };

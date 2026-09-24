'use strict';

// Relaying one press of the student's own 交作业 button to edu.
//
// The button moves; the decision does not. edu decides the deadline, whether the assignment is closed,
// how many submissions are allowed, whether there is an effective save, which revision gets fixed and
// what the submission row says — by the same code its own button uses
// (edu 134d1d8, internal/services/homework_website_inbound.go: SubmitFromProvider). This module only
// carries the press across and reports the answer, so three rules decide everything here:
//
//   * only `submitted: true` with a complete fixed-version answer may ever be shown as 已交;
//   * a refusal must arrive synchronously and be shown as the refusal it is — accepting now and sorting
//     it out later would put a tick in front of a student edu never heard of;
//   * an unknown — timeout, a lost response, a body we cannot read, a 200 that does not validate — is
//     neither, and it is NOT a failure either. edu may already have stored the submission before the
//     answer went missing, so this side reports "cannot tell yet, check on edu" and never claims the
//     work was not handed in, nor that the student's allowance was left unspent.
//
// The caller's identity is a service credential: it says WHICH SYSTEM is calling and nothing about who
// is logged in there. Who the student is comes from the ledger row of their own active link, never from
// the browser, and the endpoint comes from this deployment's own configuration, never from a request.
const fs = require('node:fs');
const { fail } = require('./errors');
const { postToEdu } = require('./eduCall');

const REF = /^[A-Za-z0-9._:-]{1,128}$/;
// edu's named refusals for this route (SUBMIT-WHERE-THEY-WORK.md §3, fixed export 134d1d8). Anything
// outside this list is reported as a plain refusal rather than echoed back as a code we understand.
const REFUSALS = Object.freeze(new Set([
  'invalid_request', 'credential_refused', 'instance_mismatch', 'not_targeted', 'assignment_unknown',
  'assignment_closed', 'deadline_passed', 'submission_limit', 'link_absent', 'artifact_mismatch',
  'no_effective_save', 'not_found'
]));
// The three edu documents as "edu cannot answer this time"; they are retryable by its own table.
const UNAVAILABLE_CODES = Object.freeze(new Set(['source_unavailable', 'revision_unavailable', 'credentials_unavailable']));
// `resolved:false` is the important bit: edu never gave us a usable answer, so its state is unknown
// to us. Everything else carries edu's own verdict and may be shown as one.
const unknown = code => Object.freeze({ submitted: false, resolved: false, code, retryable: true, message: null });

function submitSpec(spec, env) {
  const allowed = ['endpoint', 'client_key', 'key_id', 'secret', 'source_instance', 'timeout_ms', 'max_bytes', 'ca_file'];
  if (!spec || typeof spec !== 'object' || Array.isArray(spec) ||
      Object.keys(spec).some(key => !allowed.includes(key))) fail('invalid_request');
  let endpoint;
  try { endpoint = new URL(spec.endpoint); } catch { fail('invalid_request'); }
  // One fixed value from the deployment's own configuration. A student's browser can never influence
  // where a signed request goes, and the channel is TLS with nothing else attached.
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash) {
    const loopback = ['development', 'test'].includes(env && env.NODE_ENV) &&
      endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname);
    if (!loopback) fail('invalid_request');
  }
  if (typeof spec.client_key !== 'string' || !/^[a-z0-9_-]{2,32}$/.test(spec.client_key) ||
      typeof spec.key_id !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(spec.key_id) ||
      typeof spec.secret !== 'string' || spec.secret.length < 32) fail('invalid_request');
  let ca = null;
  if (spec.ca_file !== undefined) {
    if (typeof spec.ca_file !== 'string' || spec.ca_file === '') fail('invalid_request');
    try { ca = fs.readFileSync(spec.ca_file); } catch { fail('invalid_request'); }
  }
  return Object.freeze({
    endpoint,
    clientKey: spec.client_key, keyId: spec.key_id, secret: spec.secret,
    sourceInstance: typeof spec.source_instance === 'string' ? spec.source_instance : null,
    // A submit also fixes a revision on edu's side, so the budget is larger than an eligibility check —
    // but it is still absolute, and still small enough that a student is never left watching a spinner.
    timeoutMs: Number.isInteger(spec.timeout_ms) && spec.timeout_ms >= 500 && spec.timeout_ms <= 20_000
      ? spec.timeout_ms : 8000,
    maxBytes: Number.isInteger(spec.max_bytes) && spec.max_bytes >= 256 && spec.max_bytes <= 65_536
      ? spec.max_bytes : 8192,
    ca
  });
}

// Nothing here becomes a submission by coercion: `submitted` must be exactly true AND the fixed-version
// fields must all be present and well formed, because that answer is what the student is shown.
function readAnswer({ status, text }) {
  if (status === null || typeof text !== 'string') return unknown('submit_unavailable');
  let payload = null;
  try { payload = JSON.parse(text); } catch { return unknown('submit_unavailable'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return unknown('submit_unavailable');
  if (status === 200) {
    const ok = payload.schema_version === 1 && payload.submitted === true &&
      typeof payload.revision_ref === 'string' && REF.test(payload.revision_ref) &&
      Number.isInteger(payload.revision_no) && payload.revision_no >= 1 &&
      Number.isInteger(payload.submitted_at) && payload.submitted_at > 0;
    // A 200 that does not validate is the one shape that could put a false tick on the page, so it is
    // reported as an unknown rather than trusted or silently downgraded to a refusal.
    return ok
      ? Object.freeze({ submitted: true, revisionRef: payload.revision_ref,
        revisionNo: payload.revision_no, submittedAt: payload.submitted_at })
      : unknown('submit_answer_invalid');
  }
  const error = payload.error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) return unknown('submit_unavailable');
  const code = typeof error.code === 'string' ? error.code : '';
  const message = typeof error.message === 'string' && error.message.length <= 200 ? error.message : null;
  if (UNAVAILABLE_CODES.has(code)) {
    // edu's own three: it is telling us it could not do the work this time, so this is an answer.
    // `error.retryable` is a real boolean on edu's wire (fixed 07aa2b0, handlers/e09_eligibility.go
    // websiteRelayFailure), so its value wins; absent, these three are retryable by their own meaning.
    return Object.freeze({ submitted: false, resolved: true, code,
      retryable: typeof error.retryable === 'boolean' ? error.retryable : true, message });
  }
  // Any other server error is not an answer about the submission: a 5xx can happen after the row was
  // written, so we may not report it as "not handed in".
  if (status >= 500) return unknown('submit_unavailable');
  if (REFUSALS.has(code)) {
    // edu's own table: every named refusal on this route is final unless edu itself says otherwise.
    // `retryable` is honoured when it is present and a boolean, so a future edu that marks one of them
    // retryable is not overridden here. Note what it does NOT mean: retryable says this call may be
    // repeated, never that nothing was written on the other side.
    return Object.freeze({ submitted: false, resolved: true, code, message,
      retryable: typeof error.retryable === 'boolean' ? error.retryable : false });
  }
  return Object.freeze({ submitted: false, resolved: true, code: 'submit_refused', message,
    retryable: typeof error.retryable === 'boolean' ? error.retryable : false });
}

function createSubmitRelay(spec, { env = process.env, request = null, now = Date.now } = {}) {
  const config = submitSpec(spec, env);
  return Object.freeze({
    endpointHost: config.endpoint.host, timeoutMs: config.timeoutMs,
    async relay({ sourceInstance, schoolRef, assignmentRef, studentUuid, artifactRef }) {
      const payload = {
        schema_version: 1,
        source_instance: String(config.sourceInstance || sourceInstance),
        school_ref: String(schoolRef), assignment_ref: String(assignmentRef),
        student_uuid: String(studentUuid), artifact_ref: String(artifactRef)
      };
      try {
        return readAnswer(await postToEdu(config, payload, { request, now }));
      } catch {
        return unknown('submit_unavailable');            // a throw tells us nothing about edu's state
      }
    }
  });
}

module.exports = { createSubmitRelay, submitSpec, readAnswer, REFUSALS, UNAVAILABLE_CODES };

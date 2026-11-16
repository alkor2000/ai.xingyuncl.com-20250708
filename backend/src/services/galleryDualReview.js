'use strict';
// Server-built evidence for the two independent reviewers. Neither a human
// approval nor a provider's "review" result can fill a missing machine check.
const {createHash} = require('node:crypto');
const sha = value => createHash('sha256').update(value).digest('hex');
const isSha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const decisions = new Set(['allow', 'review', 'reject']);
const failureReasons = new Set(['provider_unavailable', 'invalid_model_response',
  'invalid_input', 'media_incomplete', 'video_sampling']);

function binding(input) {
  if (!input || !['text', 'image', 'video'].includes(input.kind) ||
      typeof input.workId !== 'string' || !input.workId.trim() ||
      !['textSha256', 'policySha256', 'standardSha256', 'modelRevision', 'providerRevision']
        .every(key => isSha(input[key])) ||
      (input.kind === 'text' ? input.assetSha256 !== null : !isSha(input.assetSha256))) {
    throw new Error('Invalid dual-review binding');
  }
  // Fixed field order; credentials never enter this object, only their revision.
  const fields = ['kind', 'workId', 'textSha256', 'assetSha256', 'policySha256',
    'standardSha256', 'modelRevision', 'providerRevision'];
  const value = Object.fromEntries(fields.map(key => [key, input[key]]));
  return {...value, sha256: sha(JSON.stringify(value))};
}

function baiduLane(results, kind) {
  const required = kind === 'text' ? ['text'] : kind === 'image' ? ['text', 'image'] : [];
  const checks = required.map(key => results?.[key]);
  const decision = checks.some(x => x?.state === 'block') ? 'reject' :
    checks.length && checks.every(x => x?.state === 'pass') ? 'allow' : 'review';
  const complete = required.length > 0 && checks.every(x => x &&
    ['pass', 'block', 'review'].includes(x.state) &&
    x.reason === `baidu_${x.state}`);
  // animated_image / invalid_image / image_too_large are preparation failures,
  // not complete provider reviews, even though the legacy provider says review.
  return {decision, complete};
}

function ownLane(result, kind, hasText = true, expected) {
  const checks = Array.isArray(result?.checks) ? result.checks : [];
  const required = [...(hasText ? ['text'] : []), ...(kind === 'image' ? ['visual'] : [])];
  const complete = expected && ['policySha256', 'standardSha256', 'modelRevision']
    .every(key => result?.[key] === expected[key]) && typeof result?.mapDetected === 'boolean' &&
    ['text', 'image'].includes(kind) && required.length > 0 &&
    decisions.has(result?.decision) && checks.length > 0 &&
    checks.every(x => x && decisions.has(x.decision) &&
      typeof x.reason === 'string' && !failureReasons.has(x.reason)) &&
    required.every(layer => checks.some(x => x.layer === layer &&
      ['accepted', 'model_review', 'model_reject'].includes(x.reason)));
  // A terms-only rejection may short-circuit the models: retain rejection,
  // but do not invent completed model evidence for the skipped layers.
  return {decision: decisions.has(result?.decision) ? result.decision : 'review', complete};
}

function createEvidence({current, baidu, own, hasText = true, checkedAt}) {
  const bound = binding(current);
  if (typeof checkedAt !== 'string' || !Number.isFinite(Date.parse(checkedAt))) {
    throw new Error('Dual-review check time is required');
  }
  const lanes = {baidu: baiduLane(baidu, current.kind), own: ownLane(own, current.kind, hasText, bound)};
  return {schemaVersion: 1, binding: bound, lanes, checkedAt,
    mapDetected: own?.mapDetected === true};
}

function assess(evidence, current) {
  const expected = binding(current);
  let stored;
  try { stored = binding(evidence?.binding); } catch { stored = null; }
  const lanes = evidence?.lanes;
  const fresh = evidence?.schemaVersion === 1 && typeof evidence.mapDetected === 'boolean' &&
    stored?.sha256 === expected.sha256 &&
    evidence.binding.sha256 === stored.sha256 &&
    typeof evidence.checkedAt === 'string' && Number.isFinite(Date.parse(evidence.checkedAt)) &&
    ['baidu', 'own'].every(key => decisions.has(lanes?.[key]?.decision) &&
      typeof lanes[key].complete === 'boolean');
  if (!fresh) return {decision: 'review', complete: false, eligibleForHumanReview: false,
    eligibleForBatchApproval: false, reason: 'missing_or_stale_dual_review'};
  const rejected = Object.values(lanes).some(x => x.decision === 'reject');
  const complete = current.kind !== 'video' && lanes.baidu.complete && lanes.own.complete;
  const decision = rejected ? 'reject' : complete && lanes.baidu.decision === 'allow' &&
    lanes.own.decision === 'allow' && !evidence.mapDetected ? 'allow' : 'review';
  return {decision, complete, eligibleForHumanReview: complete && !rejected,
    eligibleForBatchApproval: complete && decision === 'allow' && evidence.mapDetected === false,
    reason: rejected ? 'machine_rejected' : !complete ? 'machine_checks_incomplete' : 'human_approval_required'};
}

module.exports = {binding, baiduLane, ownLane, createEvidence, assess};

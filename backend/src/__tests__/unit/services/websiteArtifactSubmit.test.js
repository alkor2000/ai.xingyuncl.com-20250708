'use strict';

// 交作业 from the editor: the student presses it where they are working, and edu decides what it means.
//
// Every test here guards one of the two ways this can go wrong in front of a student — showing a tick
// edu never wrote, or losing a refusal edu did write. The transport is a recorded stub answering the
// exact shapes edu's own route documents (fixed export 134d1d8, dev/e09-website/SUBMIT-WHERE-THEY-WORK.md
// §3). It stands in for the WIRE, never for edu's decision: nothing here says the real two-sided chain
// has been verified.
const { randomUUID } = require('node:crypto');
const { createService } = require('../../helpers/p09Fixture');
const { createSubmitRelay } = require('../../../services/websiteArtifact/submitRelay');
const { signGrant, TaskGrantVerifier, parseIssuers } = require('../../../services/websiteArtifact/taskGrant');

const GRANT_SECRET = 'lab-issuer-secret-'.repeat(3);
const CALL_SECRET = 's'.repeat(40);
const ENDPOINT = 'https://edu.example/api/integrations/practice/e09/submit';
const CONTENT = '<h1>校园节水</h1><p>先观察，再记录两杯水的变化。</p>';
const ANSWER = { schema_version: 1, submitted: true, revision_ref: 'e9a1b2c3', revision_no: 2, submitted_at: 1790234708549 };
const said = (status, payload) => ({ status, text: JSON.stringify(payload) });

function grantFor({ uuid = 'edu-uuid-0001', assignment = 'assign-1', school = '123' } = {}) {
  const issuers = parseIssuers(JSON.stringify([{ issuer: 'edu', key_id: 'k1', secret: GRANT_SECRET,
    purposes: ['website_artifact_link', 'website_artifact_revision', 'website_artifact_review'] }]));
  const verifier = new TaskGrantVerifier({ issuers, audience: 'practice-lab' });
  const now = Math.floor(Date.now() / 1000);
  const token = signGrant({ secret: GRANT_SECRET, schema_version: 1, issuer: 'edu', key_id: 'k1',
    grant_id: randomUUID(), audience: 'practice-lab', purpose: 'website_artifact_link', school_ref: school,
    assignment_ref: assignment, lesson_ref: null, subject: { uuid, cohort: 'student' },
    issued_at: now, expires_at: now + 200 });
  return verifier.verify(token, 'website_artifact_link');
}

// A relay whose transport is recorded, so a test can see every call and its exact payload.
function stubRelay(reply = () => said(200, ANSWER)) {
  const calls = [];
  const relay = createSubmitRelay({ endpoint: ENDPOINT, client_key: 'practice', key_id: 'k1', secret: CALL_SECRET },
    { env: { NODE_ENV: 'test' },
      request: async ({ body, headers }) => { calls.push({ body: JSON.parse(body), headers }); return reply(calls.length); } });
  return { relay, calls };
}

// One student, one linked work, one real save after linking — the state a student is in when they press.
async function readyToSubmit({ reply, relay: given, saveAfterLink = true } = {}) {
  const stub = given || stubRelay(reply);
  const context = createService({ submitRelay: stub.relay });
  context.fixture.addPage({ id: 7, title: '首页', slug: 'home', html: '<p>开始创建您的页面</p>', saved: false });
  const { link } = await context.service.link({ ownerUserId: 101, grant: grantFor(), projectId: 3, entryPageId: 7 });
  if (saveAfterLink) {
    context.fixture.edit(7, CONTENT, '2026-09-22T06:30:00Z');
    await context.service.noteSourceChange({ ownerUserId: 101, projectId: 3, contentSave: true });
  }
  return { ...context, link, linkId: context.store.data.events[0].link_id, calls: stub.calls };
}

describe('P09 交作业 relay', () => {
  test('a press is carried with the facts from the ledger row, and edu answers with the fixed version', async () => {
    const { service, linkId, link, calls } = await readyToSubmit();
    const result = await service.submitLink({ ownerUserId: 101, linkId });
    expect(result).toMatchObject({ submitted: true, revision_ref: 'e9a1b2c3', revision_no: 2,
      submitted_at: 1790234708549, artifact_ref: link.artifact_ref, assignment_ref: 'assign-1' });
    // Who and what came from the row this platform already verified, not from any caller input.
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ schema_version: 1, source_instance: 'practice-lab', school_ref: '123',
      assignment_ref: 'assign-1', student_uuid: 'edu-uuid-0001', artifact_ref: link.artifact_ref });
    // The service credential says which system is calling; it is not anyone's login.
    expect(calls[0].headers['x-p09-client']).toBe('practice');
    expect(calls[0].headers['x-p09-signature']).toMatch(/^[0-9a-f]{64}$/);
    expect(String(calls[0].headers['x-p09-nonce'])).toHaveLength(32);
  });

  test('someone else cannot submit my work, and nothing leaves the process', async () => {
    const { service, linkId, calls } = await readyToSubmit();
    await expect(service.submitLink({ ownerUserId: 999, linkId })).rejects.toMatchObject({ code: 'link_unavailable', status: 404 });
    // The same answer a link that does not exist gets: a reply may not reveal another student's work.
    await expect(service.submitLink({ ownerUserId: 999, linkId: randomUUID() })).rejects.toMatchObject({ code: 'link_unavailable' });
    expect(calls).toHaveLength(0);
  });

  test('an unlinked work and a missing course-session number are refused before any call', async () => {
    const context = await readyToSubmit();
    await context.service.unlink({ ownerUserId: 101, linkId: context.linkId });
    await expect(context.service.submitLink({ ownerUserId: 101, linkId: context.linkId }))
      .rejects.toMatchObject({ code: 'link_unavailable', status: 409 });

    const blank = await readyToSubmit();
    [...blank.store.data.links.values()][0].assignment_ref = '   ';
    await expect(blank.service.submitLink({ ownerUserId: 101, linkId: blank.linkId }))
      .rejects.toMatchObject({ code: 'assignment_ref_missing', status: 409 });
    expect(blank.calls).toHaveLength(0);
  });

  test('with no relay configured the button refuses by name and calls nobody', async () => {
    const context = createService({ submitRelay: null });
    context.fixture.addPage({ id: 7, title: '首页', slug: 'home', html: '<p>x</p>', saved: false });
    await context.service.link({ ownerUserId: 101, grant: grantFor(), projectId: 3, entryPageId: 7 });
    const linkId = context.store.data.events[0].link_id;
    await expect(context.service.submitLink({ ownerUserId: 101, linkId }))
      .rejects.toMatchObject({ code: 'submit_unconfigured', status: 503 });
  });

  test('a double press is one submission, not two', async () => {
    let resolve;
    const gate = new Promise(r => { resolve = r; });
    const { service, linkId, calls } = await readyToSubmit({ reply: async () => { await gate; return said(200, ANSWER); } });
    const both = Promise.all([service.submitLink({ ownerUserId: 101, linkId }), service.submitLink({ ownerUserId: 101, linkId })]);
    resolve();
    const [first, second] = await both;
    expect(calls).toHaveLength(1);
    expect(first).toEqual(second);
  });

  test('a named refusal reaches the student as that refusal, with edu’s own sentence', async () => {
    const { service, linkId } = await readyToSubmit({
      reply: () => said(409, { error: { code: 'submission_limit', message: '提交次数已用完' } }) });
    const result = await service.submitLink({ ownerUserId: 101, linkId });
    expect(result).toMatchObject({ submitted: false, outcome: 'refused', code: 'submission_limit',
      message: '提交次数已用完', retryable: false });
  });

  test('a deadline refusal is final, an edu outage is retryable, and both are answers', async () => {
    const late = await readyToSubmit({ reply: () => said(409, { error: { code: 'deadline_passed', message: '已过截止时间' } }) });
    await expect(late.service.submitLink({ ownerUserId: 101, linkId: late.linkId }))
      .resolves.toMatchObject({ submitted: false, outcome: 'refused', code: 'deadline_passed', retryable: false });
    const down = await readyToSubmit({ reply: () => said(503, { error: { code: 'source_unavailable', message: '稍后再试' } }) });
    await expect(down.service.submitLink({ ownerUserId: 101, linkId: down.linkId }))
      .resolves.toMatchObject({ submitted: false, outcome: 'refused', code: 'source_unavailable', retryable: true });
  });

  test('a lost answer is an unknown, not a refusal: edu may already hold the submission', async () => {
    // The receiver stored the submission and then the answer went missing. Nothing this side sees can
    // tell that apart from a request that never arrived, so the only honest outcome is `unknown`.
    const { service, linkId } = await readyToSubmit({ reply: () => ({ status: null, text: null }) });
    const result = await service.submitLink({ ownerUserId: 101, linkId });
    expect(result).toMatchObject({ submitted: false, outcome: 'unknown', code: 'submit_unavailable', retryable: true });
    expect(result.outcome).not.toBe('refused');
  });

  test('edu’s own retryable flag is what decides retryability, on its real wire shape', async () => {
    // fixed 07aa2b0 handlers/e09_eligibility.go: error.code / error.message / error.retryable:boolean.
    const held = await readyToSubmit({
      reply: () => said(503, { error: { code: 'source_unavailable', message: '稍后再试', retryable: false } }) });
    await expect(held.service.submitLink({ ownerUserId: 101, linkId: held.linkId }))
      .resolves.toMatchObject({ submitted: false, outcome: 'refused', code: 'source_unavailable', retryable: false });
    const open = await readyToSubmit({
      reply: () => said(409, { error: { code: 'assignment_closed', message: '已结束', retryable: true } }) });
    await expect(open.service.submitLink({ ownerUserId: 101, linkId: open.linkId }))
      .resolves.toMatchObject({ submitted: false, outcome: 'refused', code: 'assignment_closed', retryable: true });
  });

  test('a 5xx without one of edu’s own codes is unknown, because it can follow the write', async () => {
    const { service, linkId } = await readyToSubmit({ reply: () => said(500, { error: { code: 'boom' } }) });
    await expect(service.submitLink({ ownerUserId: 101, linkId }))
      .resolves.toMatchObject({ submitted: false, outcome: 'unknown', code: 'submit_unavailable' });
  });

  test('a 200 that only looks successful is not accepted as handed in', async () => {
    for (const payload of [
      { schema_version: 1, submitted: true },                                   // no fixed version
      { schema_version: 1, submitted: 'true', revision_ref: 'r', revision_no: 1, submitted_at: 1 },
      { schema_version: 2, submitted: true, revision_ref: 'r', revision_no: 1, submitted_at: 1 },
      { schema_version: 1, submitted: true, revision_ref: 'r', revision_no: 0, submitted_at: 1 }
    ]) {
      const { service, linkId } = await readyToSubmit({ reply: () => said(200, payload) });
      await expect(service.submitLink({ ownerUserId: 101, linkId }))
        .resolves.toMatchObject({ submitted: false, outcome: 'unknown', code: 'submit_answer_invalid', retryable: true });
    }
    // An HTML error page from a proxy is the same kind of non-answer.
    const proxied = await readyToSubmit({ reply: () => ({ status: 502, text: '<html>bad gateway</html>' }) });
    await expect(proxied.service.submitLink({ ownerUserId: 101, linkId: proxied.linkId }))
      .resolves.toMatchObject({ submitted: false, outcome: 'unknown', retryable: true });
  });

  test('relaying writes nothing to this platform’s ledger: the submission fact is edu’s', async () => {
    const { service, linkId, store } = await readyToSubmit();
    const before = store.data.events.length;
    await service.submitLink({ ownerUserId: 101, linkId });
    expect(store.data.events).toHaveLength(before);
    expect([...store.data.links.values()][0].state).toBe('active');
  });

  test('the endpoint is the deployment’s own, and an http one is refused outside a laboratory', () => {
    expect(() => createSubmitRelay({ endpoint: 'http://edu.example/x', client_key: 'practice', key_id: 'k1', secret: CALL_SECRET },
      { env: { NODE_ENV: 'production' } })).toThrow();
    expect(() => createSubmitRelay({ endpoint: ENDPOINT, client_key: 'practice', key_id: 'k1', secret: 'short' },
      { env: { NODE_ENV: 'production' } })).toThrow();
    const relay = createSubmitRelay({ endpoint: ENDPOINT, client_key: 'practice', key_id: 'k1', secret: CALL_SECRET },
      { env: { NODE_ENV: 'production' } });
    expect(relay.endpointHost).toBe('edu.example');
    expect(relay.timeoutMs).toBe(8000);                 // absolute budget, not an idle gap
  });
});

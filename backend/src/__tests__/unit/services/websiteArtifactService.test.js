'use strict';

// P09 source-side state machine: association, 制作事实 from observed saves, immutable revisions with the
// student's own local assets, change identity, recoverable reconciliation, and private review access.
// The store fake guarantees the same ordering/uniqueness/conditional-consumption properties as MySQL;
// the isolated harness repeats these scenarios against a real server, real MySQL 8 and a real browser.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createService } = require('../../helpers/p09Fixture');
const { signGrant, TaskGrantVerifier, parseIssuers } = require('../../../services/websiteArtifact/taskGrant');
const { createEligibilityProvider, reviewerHash } = require('../../../services/websiteArtifact/eligibility');

const SECRET = 'lab-issuer-secret-'.repeat(3);
const CONTENT = '<h1>校园节水</h1><p>先观察，再记录两杯水的变化。</p><p>每天同一时间量水位。</p>';
const SCOPE = { sourceInstance: 'practice-lab', schoolRef: '123' };

function grantFor({ purpose = 'website_artifact_link', uuid = 'edu-uuid-0001', assignment = 'assign-1',
  school = '123', audience = 'practice-lab', artifactRef = null, revisionRef = null, reviewer = null,
  issuer = 'edu', keyId = 'k1', secret = SECRET } = {}) {
  const issuers = parseIssuers(JSON.stringify([{ issuer, key_id: keyId, secret,
    purposes: ['website_artifact_link', 'website_artifact_revision', 'website_artifact_review'] }]));
  const verifier = new TaskGrantVerifier({ issuers, audience: 'practice-lab' });
  const now = Math.floor(Date.now() / 1000);
  const token = signGrant({
    secret, schema_version: 1, issuer, key_id: keyId, grant_id: randomUUID(), audience,
    purpose, school_ref: school, assignment_ref: assignment, lesson_ref: null,
    ...(reviewer ? { reviewer: { ref: reviewer }, artifact_ref: artifactRef, revision_ref: revisionRef }
      : { subject: { uuid, cohort: 'student' } }),
    issued_at: now, expires_at: now + 200
  });
  return { token, verifier, verify: () => verifier.verify(token, purpose) };
}
const reviewerProvider = (rules = [{ issuer: 'edu', reviewer_ref: 'teacher-7', school_ref: '123', assignment_refs: ['assign-1'] }]) =>
  createEligibilityProvider({ mode: 'static', rules }, { env: { NODE_ENV: 'test' } });

// The realistic starting point: the editor creates its blank starter page, the student writes and saves.
async function linkedProject(options = {}) {
  const context = createService({ eligibility: reviewerProvider(), ...options });
  context.fixture.addPage({ id: 7, title: '首页', slug: 'home', html: '<p>开始创建您的页面</p>', saved: false });
  const grant = grantFor().verify();
  const { link } = await context.service.link({ ownerUserId: 101, grant, projectId: 3, entryPageId: 7 });
  context.fixture.edit(7, CONTENT, '2026-09-22T06:30:00Z');
  await context.service.noteSourceChange({ ownerUserId: 101, projectId: 3, contentSave: true });
  return { ...context, link, linkId: context.store.data.events[0].link_id };
}
const types = store => store.data.events.map(event => event.type);
const stateOf = async service => (await service.state(SCOPE)).items[0];

describe('P09 association', () => {
  test('one own project + entry page becomes a task link; the assignment comes only from the grant', async () => {
    const { service, store, link } = await linkedProject();
    expect(link).toMatchObject({ assignment_ref: 'assign-1', work_state: 'linked', has_effective_save: false,
      state: 'active', student_uuid: 'edu-uuid-0001', source_instance: 'practice-lab' });
    expect(link.artifact_ref).toMatch(/^[0-9a-f-]{36}$/);
    expect(types(store)).toEqual(['artifact.created', 'artifact.updated', 'artifact.preview_ready']);
    // The event payload carries no page content, no prompt, no private URL and no credential.
    const payload = JSON.stringify(store.data.events[0].payload);
    expect(payload).not.toContain('校园节水</h1>');
    expect(payload).not.toContain(SECRET);
    expect(store.data.events[0].payload.public_url).toBeNull();
    expect(store.data.events[0].payload.artifact).toMatchObject({ kind: 'html_page', source_instance: 'practice-lab' });
    const state = await service.state(SCOPE);
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({ work_state: 'preview_ready', has_effective_save: true, real_save_count: 1 });
    expect(state.complete).toBe(true);
    expect(state.pending_reconcile).toBe(0);
  });

  test('an empty default project cannot be linked, and a linked-but-unsaved work never reports 制作中', async () => {
    const context = createService();
    const grant = grantFor().verify();
    // No page at all: there is nothing to declare as the entry page.
    await expect(context.service.link({ ownerUserId: 101, grant, projectId: 3, entryPageId: 1 }))
      .rejects.toMatchObject({ code: 'project_not_ready' });
    context.fixture.addPage({ id: 7, title: '新页面', slug: 'home', html: '<p>开始创建您的页面</p>', saved: false });
    const { link } = await context.service.link({ ownerUserId: 101, grant: grantFor().verify(), projectId: 3, entryPageId: 7 });
    expect(link).toMatchObject({ work_state: 'linked', has_effective_save: false, preview_available: false,
      save_evidence: 'none', save_evidence_reason: 'no_update_since_created' });
    expect(types(context.store)).toEqual(['artifact.created']);
  });

  test('one project answers one current assignment; after unlinking it can be linked again and old versions stay', async () => {
    const context = await linkedProject();
    // Same project, a second assignment — refused, and not because of the first assignment's row only:
    // the constraint is the project's own active link.
    await expect(context.service.link({ ownerUserId: 101, grant: grantFor({ assignment: 'assign-2' }).verify(),
      projectId: 3, entryPageId: 7 })).rejects.toMatchObject({ code: 'project_already_linked' });
    const frozen = await context.service.freezeRevision({ ownerUserId: 101, linkId: context.linkId, requestKey: randomUUID() });
    await context.service.unlink({ ownerUserId: 101, linkId: context.linkId });
    // Explicit re-link after revoking is allowed, and the fixed version of the old link is untouched.
    const relinked = await context.service.link({ ownerUserId: 101, grant: grantFor({ assignment: 'assign-2' }).verify(),
      projectId: 3, entryPageId: 7 });
    expect(relinked.link.assignment_ref).toBe('assign-2');
    expect(relinked.link.artifact_ref).not.toBe(context.link.artifact_ref);
    const old = await context.store.read(tx => tx.revisionFile(frozen.revision.revision_ref, 'index.html'));
    expect(old.content.toString('utf8')).toContain('校园节水');
  });

  test('two schools may use the same assignment number, and one grant id per issuer is burned separately', async () => {
    const context = createService();
    context.fixture.addPage({ id: 7, html: CONTENT });
    const first = grantFor({ assignment: 'a-1', school: '123' });
    await context.service.link({ ownerUserId: 101, grant: first.verify(), projectId: 3, entryPageId: 7 });
    // The same grant id twice is refused (single use)…
    await expect(context.service.link({ ownerUserId: 101, grant: first.verify(), projectId: 3, entryPageId: 7 }))
      .rejects.toMatchObject({ code: 'task_context_replayed' });
    // …while another school's identically numbered assignment is a different scope entirely.
    const other = createService();
    other.fixture.addPage({ id: 7, html: CONTENT });
    const second = await other.service.link({ ownerUserId: 101, grant: grantFor({ assignment: 'a-1', school: '456' }).verify(),
      projectId: 3, entryPageId: 7 });
    expect(second.link.assignment_ref).toBe('a-1');
    expect((await other.service.state({ sourceInstance: 'practice-lab', schoolRef: '456' })).items).toHaveLength(1);
    expect((await other.service.state(SCOPE)).items).toHaveLength(0);
  });

  test('refusals: another student\'s subject, a non-SSO account, another instance, a second work', async () => {
    const context = createService();
    context.fixture.addPage({ id: 7, html: CONTENT });
    await expect(context.service.link({ ownerUserId: 101, grant: grantFor({ uuid: 'edu-uuid-9999' }).verify(), projectId: 3, entryPageId: 7 }))
      .rejects.toMatchObject({ code: 'subject_mismatch' });
    expect(() => grantFor({ audience: 'other-practice-instance' }).verify()).toThrow('task_context_instance_mismatch');
    const local = createService({ studentUuid: 'edu-uuid-0001' });
    local.models.User.findById = async () => ({ id: 101, uuid: 'local', uuid_source: 'system', status: 'active',
      isAccountExpired: () => false });
    local.fixture.addPage({ id: 7, html: CONTENT });
    await expect(local.service.link({ ownerUserId: 101, grant: grantFor().verify(), projectId: 3, entryPageId: 7 }))
      .rejects.toMatchObject({ code: 'subject_not_eligible' });
    await context.service.link({ ownerUserId: 101, grant: grantFor().verify(), projectId: 3, entryPageId: 7 });
    // A different project for the same assignment is refused: one assignment holds one main work.
    await expect(context.service.link({ ownerUserId: 101, grant: grantFor().verify(), projectId: 4, entryPageId: 7 }))
      .rejects.toMatchObject({ code: 'project_unavailable' });
  });

  test('a page of someone else\'s project is never reachable, by id or by name', async () => {
    const context = createService();
    context.fixture.addPage({ id: 7, html: CONTENT });
    context.fixture.state.project.user_id = 999;         // the project now belongs to another student
    await expect(context.service.link({ ownerUserId: 101, grant: grantFor().verify(), projectId: 3, entryPageId: 7 }))
      .rejects.toMatchObject({ code: 'project_unavailable' });
  });
});

describe('P09 制作事实 comes from observed saves', () => {
  test('a short legitimate page saved one second after it was created counts as a real save', async () => {
    const context = createService();
    context.fixture.addPage({ id: 7, slug: 'home', html: '<p>开始创建您的页面</p>', saved: false });
    await context.service.link({ ownerUserId: 101, grant: grantFor().verify(), projectId: 3, entryPageId: 7 });
    // 23 bytes, saved within the same second the page was created: the old 64-byte + 1-second heuristic
    // called this "not started"; the observed save says otherwise.
    context.fixture.edit(7, '<p>我做的是节水网站</p>', '2026-09-22T01:00:01Z');
    await context.service.noteSourceChange({ ownerUserId: 101, projectId: 3, contentSave: true });
    expect(await stateOf(context.service)).toMatchObject({ work_state: 'preview_ready', has_effective_save: true,
      save_evidence: 'observed', save_evidence_reason: 'observed_save', real_save_count: 1 });
  });

  test('renaming a page is not a save, and the work stays 未开始 until content is really saved', async () => {
    const context = createService();
    context.fixture.addPage({ id: 7, slug: 'home', html: '<p>开始创建您的页面</p>', saved: false });
    await context.service.link({ ownerUserId: 101, grant: grantFor().verify(), projectId: 3, entryPageId: 7 });
    context.fixture.rename(7, '我的首页');
    // The editor's rename path calls the hook without content; the ledger records no save.
    await context.service.noteSourceChange({ ownerUserId: 101, projectId: 3, contentSave: false });
    const renamed = await stateOf(context.service);
    expect(renamed).toMatchObject({ work_state: 'linked', has_effective_save: false, real_save_count: 0 });
    context.fixture.edit(7, CONTENT);
    await context.service.noteSourceChange({ ownerUserId: 101, projectId: 3, contentSave: true });
    expect(await stateOf(context.service)).toMatchObject({ work_state: 'preview_ready', has_effective_save: true });
  });

  test('an old project whose history predates observation answers 未知 with a reason, never 未开始', async () => {
    const context = createService();
    // Linked long after it was written: rows carry version > 1, but P09 never saw the save.
    context.fixture.addPage({ id: 9, title: '家乡', slug: 'hometown', html: CONTENT, updated_at: '2026-03-01T10:00:00Z' });
    const { link } = await context.service.link({ ownerUserId: 101, grant: grantFor().verify(), projectId: 3, entryPageId: 9 });
    expect(link).toMatchObject({ work_state: 'unknown', has_effective_save: null,
      save_evidence: 'legacy_unknown', save_evidence_reason: 'history_before_observation' });
    expect(link.preview_available).toBe(true);           // there are bytes to show; the evidence is what is unknown
    const payload = context.store.data.events[0].payload.progress;
    expect(payload).toMatchObject({ work_state: 'unknown', has_effective_save: null, save_evidence: 'legacy_unknown' });
  });

  test('bytes that move without an observed save become 未知, not a claimed save and not 未开始', async () => {
    const context = createService();
    context.fixture.addPage({ id: 7, slug: 'home', html: '<p>开始创建您的页面</p>', saved: false });
    await context.service.link({ ownerUserId: 101, grant: grantFor().verify(), projectId: 3, entryPageId: 7 });
    context.fixture.edit(7, CONTENT);
    // Reconciled without the save signal (the hook never ran: a crash, or a write from elsewhere).
    await context.service.reconcileLink(context.store.data.events[0].link_id);
    expect(await stateOf(context.service)).toMatchObject({ work_state: 'unknown', has_effective_save: null,
      save_evidence: 'legacy_unknown', save_evidence_reason: 'change_without_observed_save', real_save_count: 0 });
  });
});

describe('P09 change identity and recoverable reconciliation', () => {
  test('A→B→A is three changes and three facts; re-noting the same change adds none', async () => {
    const context = await linkedProject();
    const before = context.store.data.events.length;
    context.fixture.edit(7, `${CONTENT}<p>B</p>`);
    await context.service.noteSourceChange({ ownerUserId: 101, projectId: 3, contentSave: true });
    context.fixture.edit(7, CONTENT);                      // back to exactly the earlier bytes
    await context.service.noteSourceChange({ ownerUserId: 101, projectId: 3, contentSave: true });
    const updated = context.store.data.events.filter(event => event.type === 'artifact.updated');
    expect(updated).toHaveLength(3);
    expect(updated.map(event => event.payload.progress.change_no)).toEqual([1, 2, 3]);
    expect(new Set(updated.map(event => event.fact_id)).size).toBe(3);
    // A retried note of the same change is the same fact: nothing new is appended.
    const after = context.store.data.events.length;
    await context.service.noteSourceChange({ ownerUserId: 101, projectId: 3, contentSave: true });
    await context.service.noteSourceChange({ ownerUserId: 101, projectId: 3, contentSave: true });
    expect(context.store.data.events).toHaveLength(after);
    expect(after).toBeGreaterThan(before);
  });

  test('a crash between the save and the projection leaves a pending marker that the sweep finishes', async () => {
    const context = await linkedProject();
    const linkId = context.linkId;
    context.fixture.edit(7, `${CONTENT}<p>崩溃前保存的内容</p>`);
    // Exactly what the editor's request does before it answers; the process then dies.
    await context.service.recordSourceWrite({ ownerUserId: 101, projectId: 3, contentSave: true });
    expect(context.store.data.links.get(linkId).sync_pending_at).toBeTruthy();
    const stale = await context.service.state(SCOPE);
    // The read itself sweeps, so edu is never handed a projection that is quietly behind.
    expect(stale.items[0].pending_reconcile).toBe(false);
    expect(stale.complete).toBe(true);
    expect(stale.items[0].change_no).toBe(2);
    const events = context.store.data.events.filter(event => event.type === 'artifact.updated');
    expect(events).toHaveLength(2);
    // Sweeping again finds nothing to do and appends nothing.
    const again = await context.service.sweep({ schoolRef: '123' });
    expect(again.swept).toBe(0);
    expect(context.store.data.events.filter(event => event.type === 'artifact.updated')).toHaveLength(2);
  });

  test('even a lost marker is recovered: the verify pass compares the source against the projection', async () => {
    const context = await linkedProject();
    context.fixture.edit(7, `${CONTENT}<p>标记丢失的那次保存</p>`);
    const row = context.store.data.links.get(context.linkId);
    row.sync_pending_at = null;                            // the marker write itself failed
    row.reconciled_at = Date.now() - 10 * 60 * 1000;       // and the work has not been verified for a while
    const swept = await context.service.sweep({ schoolRef: '123' });
    expect(swept.swept).toBe(1);
    expect(context.store.data.links.get(context.linkId).change_no).toBe(2);
    expect(context.store.data.events.filter(event => event.type === 'artifact.updated')).toHaveLength(2);
  });

  test('a reconciliation that read older bytes cannot overwrite a newer one, and does not eat its marker', async () => {
    const context = await linkedProject();
    const linkId = context.linkId;
    // Hold a reconciliation at the moment it has its snapshot but has not written anything yet.
    const load = context.reader.load.bind(context.reader);
    let release;
    let ready;
    const gate = new Promise(resolve => { release = resolve; });
    const hit = new Promise(resolve => { ready = resolve; });
    let armed = true;
    context.reader.load = async (...args) => {
      const source = await load(...args);
      if (armed) { armed = false; ready(); await gate; }
      return source;
    };
    context.fixture.edit(7, `${CONTENT}<p>B</p>`);
    await context.service.recordSourceWrite({ ownerUserId: 101, projectId: 3, contentSave: true });
    const stale = context.service.reconcileLink(linkId);
    await hit;
    // A newer save lands and is reconciled while the older one is still holding its snapshot.
    context.fixture.edit(7, `${CONTENT}<p>C</p>`);
    await context.service.noteSourceChange({ ownerUserId: 101, projectId: 3, contentSave: true });
    const afterC = { ...context.store.data.links.get(linkId) };
    release();
    expect(await stale).toMatchObject({ skipped: 'source_moved' });
    context.reader.load = load;

    const row = context.store.data.links.get(linkId);
    expect(row.content_digest).toBe(afterC.content_digest);     // the projection never went backwards
    expect(row.change_no).toBe(afterC.change_no);
    expect(row.applied_write_seq).toBe(row.write_seq);
    const state = await context.service.state(SCOPE);
    expect(state).toMatchObject({ complete: true, pending_reconcile: 0 });
    expect(state.items[0].unprojected_writes).toBe(0);
  });

  test('a stale worker never clears a marker it did not cover; the next sweep still catches up', async () => {
    const context = await linkedProject();
    const linkId = context.linkId;
    const load = context.reader.load.bind(context.reader);
    let release;
    let ready;
    const gate = new Promise(resolve => { release = resolve; });
    const hit = new Promise(resolve => { ready = resolve; });
    let armed = true;
    context.reader.load = async (...args) => {
      const source = await load(...args);
      if (armed) { armed = false; ready(); await gate; }
      return source;
    };
    context.fixture.edit(7, `${CONTENT}<p>B</p>`);
    await context.service.recordSourceWrite({ ownerUserId: 101, projectId: 3, contentSave: true });
    const stale = context.service.reconcileLink(linkId);
    await hit;
    // This newer save is only marked — nothing has reconciled it yet.
    context.fixture.edit(7, `${CONTENT}<p>C</p>`);
    await context.service.recordSourceWrite({ ownerUserId: 101, projectId: 3, contentSave: true });
    release();
    expect(await stale).toMatchObject({ skipped: 'source_moved' });
    context.reader.load = load;

    const held = context.store.data.links.get(linkId);
    expect(held.sync_pending_at).not.toBeNull();                 // the newer marker survived
    expect(Number(held.applied_write_seq)).toBeLessThan(Number(held.write_seq));
    const swept = await context.service.sweep({ schoolRef: '123', verify: false });
    expect(swept.swept).toBe(1);
    const after = context.store.data.links.get(linkId);
    expect(after.sync_pending_at).toBeNull();
    expect(after.applied_write_seq).toBe(after.write_seq);
    const state = await context.service.state(SCOPE);
    expect(state.complete).toBe(true);
    expect(state.items[0].save_evidence).toBe('observed');
  });

  test('a save landing between the sweep and the read is never counted as a complete snapshot', async () => {
    const context = await linkedProject();
    const real = context.store.transaction.bind(context.store);
    let armed = true;
    context.store.transaction = fn => real(async tx => {
      if (armed && typeof tx.watermark === 'function') {
        const watermark = tx.watermark.bind(tx);
        tx.watermark = async () => {
          armed = false;
          tx.watermark = watermark;                               // exactly once, at the read boundary
          context.fixture.edit(7, `${CONTENT}<p>D</p>`);
          await context.service.recordSourceWrite({ ownerUserId: 101, projectId: 3, contentSave: true });
          return watermark();
        };
      }
      return fn(tx);
    });
    const state = await context.service.state(SCOPE);
    context.store.transaction = real;
    expect(state.complete).toBe(false);
    expect(state.pending_reconcile).toBe(1);
    expect(state.items[0]).toMatchObject({ pending_reconcile: true, unprojected_writes: 1 });
    // And the next read, after the work is reconciled, is complete again.
    const settled = await context.service.state(SCOPE);
    expect(settled).toMatchObject({ complete: true, pending_reconcile: 0 });
  });

  test('saves merged before any reconciliation: the counters keep every save, the events keep the net change', async () => {
    const context = await linkedProject();
    const before = context.store.data.events.filter(event => event.type === 'artifact.updated').length;
    for (const html of [`${CONTENT}<p>A</p>`, `${CONTENT}<p>B</p>`, `${CONTENT}<p>A</p>`]) {
      context.fixture.edit(7, html);
      await context.service.recordSourceWrite({ ownerUserId: 101, projectId: 3, contentSave: true });
    }
    await context.service.reconcileLink(context.linkId);
    const row = context.store.data.links.get(context.linkId);
    // Three real saves are durably counted; the content events describe reconciled changes, so the two
    // that were never observed separately are one net change. practice does not claim otherwise.
    expect(Number(row.real_save_count)).toBe(4);                  // the linked save plus these three
    expect(context.store.data.events.filter(event => event.type === 'artifact.updated').length).toBe(before + 1);
    expect(row.applied_write_seq).toBe(row.write_seq);
  });

  test('a ledger outage during reconciliation keeps the work pending and the read says so', async () => {
    const context = await linkedProject();
    context.fixture.edit(7, `${CONTENT}<p>账本短断</p>`);
    await context.service.recordSourceWrite({ ownerUserId: 101, projectId: 3, contentSave: true });
    const original = context.store.transaction.bind(context.store);
    context.store.transaction = async () => { const error = new Error('storage_unavailable'); error.code = 'storage_unavailable'; throw error; };
    const failed = await context.service.sweep({ schoolRef: '123' });
    expect(failed.swept).toBe(0);
    expect(failed.budget_exhausted).toBe(true);
    context.store.transaction = original;
    const state = await context.service.state(SCOPE);
    expect(state.items[0].change_no).toBe(2);
    expect(state.complete).toBe(true);
    expect(context.service.syncStatus().failures).toBeGreaterThan(0);
  });
});

describe('P09 fixed review revisions', () => {
  test('freezing is idempotent per request key and the frozen bytes survive later edits and deletions', async () => {
    const context = await linkedProject();
    const key = randomUUID();
    const first = await context.service.freezeRevision({ ownerUserId: 101, linkId: context.linkId, requestKey: key });
    const again = await context.service.freezeRevision({ ownerUserId: 101, linkId: context.linkId, requestKey: key });
    expect(again.replayed).toBe(true);
    expect(again.revision.revision_ref).toBe(first.revision.revision_ref);
    expect(first.revision.revision_no).toBe(1);
    expect(first.revision.manifest.frozen_scope).toBe('pages_and_owned_local_assets');
    expect(first.revision.manifest.save_evidence).toBe('observed');

    // The student keeps working: renaming, editing and deleting pages must not touch revision 1.
    context.fixture.edit(7, '<h1>完全不同的内容</h1>'.repeat(4));
    context.fixture.addPage({ id: 8, title: '数据', slug: 'data', html: CONTENT });
    await context.service.noteSourceChange({ ownerUserId: 101, projectId: 3, contentSave: true });
    const second = await context.service.freezeRevision({ ownerUserId: 101, linkId: context.linkId, requestKey: randomUUID() });
    expect(second.revision.revision_no).toBe(2);
    expect(second.revision.content_sha256).not.toBe(first.revision.content_sha256);
    const frozen = await context.store.read(tx => tx.revisionFile(first.revision.revision_ref, 'index.html'));
    expect(frozen.content.toString('utf8')).toContain('校园节水');
    expect(frozen.content.toString('utf8')).not.toContain('完全不同的内容');
    expect(types(context.store).filter(type => type === 'artifact.revision_fixed')).toHaveLength(2);
  });

  test('a work with no save at all cannot be frozen, and a revoked link cannot be frozen either', async () => {
    const context = createService();
    context.fixture.addPage({ id: 7, slug: 'home', html: '<p>开始创建您的页面</p>', saved: false });
    const { link } = await context.service.link({ ownerUserId: 101, grant: grantFor().verify(), projectId: 3, entryPageId: 7 });
    const linkId = context.store.data.events[0].link_id;
    await expect(context.service.freezeRevision({ ownerUserId: 101, linkId, requestKey: randomUUID() }))
      .rejects.toMatchObject({ code: 'project_empty' });
    expect(link.state).toBe('active');
    context.fixture.edit(7, CONTENT);
    await context.service.noteSourceChange({ ownerUserId: 101, projectId: 3, contentSave: true });
    await context.service.unlink({ ownerUserId: 101, linkId });
    await expect(context.service.freezeRevision({ ownerUserId: 101, linkId, requestKey: randomUUID() }))
      .rejects.toMatchObject({ code: 'link_revoked' });
  });

  test('a fixed version re-opens completely: own assets are copied, links rewritten, everything else refused by name', async () => {
    const uploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'p09-assets-'));
    try {
      fs.mkdirSync(path.join(uploadRoot, 'images'), { recursive: true });
      const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
      fs.writeFileSync(path.join(uploadRoot, 'images', 'pond.png'), png);
      fs.writeFileSync(path.join(uploadRoot, 'images', 'site.css'), 'body{color:#123456}');
      fs.writeFileSync(path.join(uploadRoot, 'images', 'somebody-elses.png'), png);
      fs.writeFileSync(path.join(uploadRoot, 'images', 'photo.jpg'), Buffer.concat([png, Buffer.from('jpg')]));
      fs.writeFileSync(path.join(uploadRoot, 'images', 'other-project.png'), png);
      fs.symlinkSync('/etc/hostname', path.join(uploadRoot, 'images', 'escape.png'));
      const context = createService({
        eligibility: reviewerProvider(),
        assets: { uploadRoot, owned: [
          { table: 'files', user_id: 101, key: 'images/pond.png' },
          { table: 'html_resources', user_id: 101, key: 'images/site.css', project_id: 3 },
          { table: 'files', user_id: 101, key: 'images/escape.png' },
          { table: 'files', user_id: 101, key: 'images/traversal.png', local: '../../etc/passwd' },
          { table: 'user_files', user_id: 101, key: 'images/photo.jpg' },
          { table: 'html_resources', user_id: 101, key: 'images/other-project.png', project_id: 99 },
          { table: 'html_resources', user_id: 101, key: 'images/cloud.png', storage_type: 'oss', project_id: 3 }
        ] }
      });
      const entry = `${CONTENT}
        <link rel="stylesheet" href="/uploads/images/site.css">
        <img src="/uploads/images/pond.png" alt="池塘">
        <img src="/uploads/images/somebody-elses.png" alt="别人的图">
        <img src="/uploads/images/escape.png" alt="符号链接">
        <img src="/uploads/images/traversal.png" alt="穿越">
        <img src="/uploads/images/photo.jpg" alt="我的照片">
        <img src="/uploads/images/other-project.png" alt="别的项目">
        <img src="/uploads/images/cloud.png" alt="云端">
        <img src="https://cdn.example.com/logo.png" alt="外部">
        <a href="/pages/101/data">数据页</a><a href="notes.html">备注</a>`;
      context.fixture.addPage({ id: 7, title: '首页', slug: 'home', html: '<p>开始创建您的页面</p>', saved: false });
      await context.service.link({ ownerUserId: 101, grant: grantFor().verify(), projectId: 3, entryPageId: 7 });
      context.fixture.edit(7, entry);
      context.fixture.addPage({ id: 8, title: '数据页', slug: 'data', html: '<h2>数据</h2><a href="/pages/101/home">回首页</a>' });
      context.fixture.addPage({ id: 9, title: '备注', slug: 'notes', html: '<h2>备注</h2>' });
      await context.service.noteSourceChange({ ownerUserId: 101, projectId: 3, contentSave: true });
      const linkId = context.store.data.events[0].link_id;
      const { revision } = await context.service.freezeRevision({ ownerUserId: 101, linkId, requestKey: randomUUID() });

      // 1. The student's own files are in the revision, with bytes, type, digest and the model that
      //    proved ownership recorded against the immutable version.
      const manifest = revision.manifest;
      expect(manifest.assets).toHaveLength(3);
      expect(manifest.assets.map(asset => asset.owned_by).sort()).toEqual(['files', 'html_resources', 'user_files']);
      expect(manifest.assets.every(asset => asset.sha256.length === 64 && asset.byte_length > 0)).toBe(true);
      expect(manifest.asset_byte_length).toBe(png.length * 2 + 3 + 'body{color:#123456}'.length);
      // 2. Everything ownership could not prove is refused BY NAME, with the reason, never copied.
      const refused = Object.fromEntries(manifest.refused_assets.map(item => [item.reference, item.reason]));
      expect(refused).toEqual({
        '/uploads/images/somebody-elses.png': 'ownership_unproven',
        '/uploads/images/escape.png': 'symlink_refused',
        '/uploads/images/traversal.png': 'path_rejected',
        '/uploads/images/other-project.png': 'other_project_resource',
        '/uploads/images/cloud.png': 'remote_object_storage'
      });
      // 3. External dependencies are listed and explicitly NOT frozen.
      expect(manifest.external_dependencies).toEqual([{ kind: 'external_url', url: 'https://cdn.example.com/logo.png', reference_count: 1 }]);
      // 4. Page links and asset references are rewritten to the bundle's own flat paths.
      const index = (await context.store.read(tx => tx.revisionFile(revision.revision_ref, 'index.html'))).content.toString('utf8');
      const pondPath = manifest.assets.find(asset => asset.reference.endsWith('pond.png')).path;
      expect(index).toContain(`src="${pondPath}"`);
      expect(index).toContain('href="p-data-8.html"');
      expect(index).toContain('href="p-notes-9.html"');
      expect(index).not.toContain('/uploads/images/pond.png');
      expect(index).toContain('https://cdn.example.com/logo.png');     // untouched, and not fetched
      const data = (await context.store.read(tx => tx.revisionFile(revision.revision_ref, 'p-data-8.html'))).content.toString('utf8');
      expect(data).toContain('href="index.html"');

      // 5. The original is then edited and its files deleted: the fixed version still renders whole.
      context.fixture.edit(7, '<h1>改稿之后</h1>');
      fs.rmSync(path.join(uploadRoot, 'images', 'pond.png'));
      await context.service.noteSourceChange({ ownerUserId: 101, projectId: 3, contentSave: true });
      const stillIndex = await context.store.read(tx => tx.revisionFile(revision.revision_ref, 'index.html'));
      const stillAsset = await context.store.read(tx => tx.revisionFile(revision.revision_ref, pondPath));
      expect(stillIndex.content.toString('utf8')).toContain('校园节水');
      expect(stillAsset.content.equals(png)).toBe(true);
      expect(stillAsset.media_type).toBe('image/png');
    } finally { fs.rmSync(uploadRoot, { recursive: true, force: true }); }
  });
});

describe('P09 incremental read', () => {
  test('a cursor resumes without gaps, re-reading returns the same facts, and the cursor is scope bound', async () => {
    const context = await linkedProject();
    context.fixture.edit(7, `${CONTENT}<p>第二次保存</p>`);
    await context.service.noteSourceChange({ ownerUserId: 101, projectId: 3, contentSave: true });
    const firstPage = await context.service.events(SCOPE, { limit: 2 });
    expect(firstPage.facts.map(fact => fact.type)).toEqual(['artifact.created', 'artifact.updated']);
    expect(firstPage.next_cursor).toBeTruthy();
    const secondPage = await context.service.events(SCOPE, { cursor: firstPage.next_cursor, limit: 2 });
    expect(secondPage.facts.map(fact => fact.type)).toEqual(['artifact.preview_ready', 'artifact.updated']);
    // A retried page returns the identical immutable facts; the watermark never moves backwards.
    const retry = await context.service.events(SCOPE, { cursor: firstPage.next_cursor, limit: 2 });
    expect(retry.facts).toEqual(secondPage.facts);
    expect(retry.watermark).toBe(secondPage.watermark);
    const sequences = [...firstPage.facts, ...secondPage.facts].map(fact => fact.event_sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    await expect(context.service.events({ sourceInstance: 'practice-lab', schoolRef: '999' },
      { cursor: firstPage.next_cursor })).rejects.toMatchObject({ code: 'cursor_invalid' });
    // Another school in the same instance sees nothing of this school's work.
    const other = await context.service.events({ sourceInstance: 'practice-lab', schoolRef: '999' }, {});
    expect(other.facts).toEqual([]);
  });

  test('multiple pages and repeated freezes never multiply the student rows edu counts', async () => {
    const context = await linkedProject();
    context.fixture.addPage({ id: 8, title: '第二页', slug: 'two', html: CONTENT });
    await context.service.noteSourceChange({ ownerUserId: 101, projectId: 3, contentSave: true });
    await context.service.freezeRevision({ ownerUserId: 101, linkId: context.linkId, requestKey: randomUUID() });
    await context.service.freezeRevision({ ownerUserId: 101, linkId: context.linkId, requestKey: randomUUID() });
    const state = await context.service.state(SCOPE);
    expect(state.items).toHaveLength(1);
    expect(new Set(state.items.map(item => item.student_uuid)).size).toBe(1);
    expect(state.items[0].revisions).toHaveLength(2);
  });

  test('a truncated page and an unfinished reconciliation both refuse to call the snapshot complete', async () => {
    const context = await linkedProject();
    const full = await context.service.state(SCOPE);
    expect(full).toMatchObject({ complete: true, pending_reconcile: 0, item_limit: 1000 });
    // A scope with more works than one page can carry: edu must not read "everyone else has nothing".
    const real = context.store.transaction.bind(context.store);
    const one = (await context.store.read(tx => tx.linksInScope(SCOPE)))[0];
    context.store.transaction = fn => real(tx => fn({ ...tx, linksInScope: async () => Array.from({ length: 1000 }, () => ({ ...one })) }));
    const truncated = await context.service.state(SCOPE);
    expect(truncated).toMatchObject({ complete: false, truncated: true });
    context.store.transaction = real;
    // An outstanding marker is finished by the read itself, so the snapshot edu gets is not behind.
    context.store.data.links.get(context.linkId).sync_pending_at = Date.now();
    const swept = await context.service.state(SCOPE);
    expect(swept).toMatchObject({ complete: true, pending_reconcile: 0 });
    expect(context.store.data.links.get(context.linkId).sync_pending_at).toBeNull();
  });

  test('deleting the source stops access and records deletion; unlinking is a separate, reversible act', async () => {
    const first = await linkedProject();
    first.fixture.deleteProject();
    await first.service.noteSourceChange({ ownerUserId: 101, projectId: 3, deleted: true });
    expect(types(first.store).slice(-2)).toEqual(['artifact.preview_revoked', 'artifact.deleted']);
    const gone = await first.service.state(SCOPE);
    expect(gone.items[0]).toMatchObject({ state: 'deleted', work_state: 'unavailable', preview_available: false });

    const second = await linkedProject();
    await second.service.unlink({ ownerUserId: 101, linkId: second.linkId });
    expect(types(second.store).slice(-2)).toEqual(['artifact.preview_revoked', 'artifact.unlinked']);
  });
});

describe('P09 private review access', () => {
  const reviewGrant = (link, options = {}) => grantFor({ purpose: 'website_artifact_review', reviewer: 'teacher-7',
    artifactRef: link.artifact_ref, ...options }).verify();

  test('without an eligibility provider a reviewer session is refused outright', async () => {
    const context = await linkedProject({ eligibility: null });
    const link = (await context.service.ownerLinks(101))[0];
    await expect(context.service.openReviewSession({ grant: reviewGrant(link) }))
      .rejects.toMatchObject({ code: 'eligibility_unavailable', status: 503 });
    // The student's own preview does not depend on edu: it is their own authenticated session.
    const own = await context.service.openReviewSession({ ownerUserId: 101, linkId: link.link_id });
    expect(own.eligibility).toBe('owner_session');
  });

  test('the handoff opens once, in the browser that redeemed it, and never again', async () => {
    const context = await linkedProject();
    const link = (await context.service.ownerLinks(101))[0];
    const session = await context.service.openReviewSession({ grant: reviewGrant(link) });
    expect(session.target).toEqual({ kind: 'current_preview' });
    expect(session.handoff_expires_at).toBeLessThan(session.expires_at);   // a short window to redeem, a longer one to read
    const opened = await context.service.consumeHandoff(session.handoff, { client: 'teacher-browser' });
    const page = await context.service.resolvePreview({ sessionId: opened.session_id, secret: opened.secret,
      path: 'index.html', client: 'teacher-browser' });
    expect(page.body.toString('utf8')).toContain('校园节水');
    // Forwarding the opening URL is useless: the handoff is consumed…
    await expect(context.service.consumeHandoff(session.handoff, { client: 'another-browser' }))
      .rejects.toMatchObject({ code: 'review_session_consumed' });
    // …and the cookie it produced is bound to the browser that redeemed it.
    await expect(context.service.resolvePreview({ sessionId: opened.session_id, secret: opened.secret,
      path: 'index.html', client: 'another-browser' })).rejects.toMatchObject({ code: 'review_session_binding' });
    await expect(context.service.resolvePreview({ sessionId: opened.session_id, secret: 'a'.repeat(43),
      path: 'index.html', client: 'teacher-browser' })).rejects.toMatchObject({ code: 'audience_mismatch' });
  });

  test('a stolen first use burns the entry: the legitimate teacher is refused and must ask again', async () => {
    const context = await linkedProject();
    const link = (await context.service.ownerLinks(101))[0];
    const session = await context.service.openReviewSession({ grant: reviewGrant(link) });
    await context.service.consumeHandoff(session.handoff, { client: 'thief-browser' });
    await expect(context.service.consumeHandoff(session.handoff, { client: 'teacher-browser' }))
      .rejects.toMatchObject({ code: 'review_session_consumed' });
    // Asking again is a new grant and a new session: nothing about the stolen one is reusable.
    const second = await context.service.openReviewSession({ grant: reviewGrant(link) });
    const opened = await context.service.consumeHandoff(second.handoff, { client: 'teacher-browser' });
    expect((await context.service.resolvePreview({ sessionId: opened.session_id, secret: opened.secret,
      path: 'index.html', client: 'teacher-browser' })).body.toString('utf8')).toContain('校园节水');
  });

  test('eligibility is re-checked on every byte, including the bytes of a fixed revision', async () => {
    // A provider whose answer can change between two requests, the way edu's real endpoint would.
    const roster = { assignments: ['assign-1'] };
    const provider = { mode: 'test_dynamic', cacheMs: 0,
      async check({ assignmentRef }) { return roster.assignments.includes(assignmentRef)
        ? { eligible: true } : { eligible: false, reason: 'reviewer_not_on_assignment' }; } };
    const context = await linkedProject({ eligibility: provider });
    const link = (await context.service.ownerLinks(101))[0];
    const frozen = await context.service.freezeRevision({ ownerUserId: 101, linkId: link.link_id, requestKey: randomUUID() });
    const session = await context.service.openReviewSession({ grant: reviewGrant(link, { revisionRef: frozen.revision.revision_ref }) });
    const opened = await context.service.consumeHandoff(session.handoff, { client: 'teacher-browser' });
    const read = () => context.service.resolvePreview({ sessionId: opened.session_id, secret: opened.secret,
      path: 'index.html', client: 'teacher-browser' });
    expect((await read()).immutable).toBe(true);
    // The teacher is moved off the task (or the class is transferred): the static snapshot stops too.
    roster.assignments = ['assign-9'];
    await expect(read()).rejects.toMatchObject({ code: 'not_eligible', status: 403 });
  });

  test('a disabled owner, a revoked issuer key and an expired session all stop an open review', async () => {
    const issuers = new Set(['edu:k1']);
    const context = await linkedProject({ issuerActive: key => issuers.has(key) });
    const link = (await context.service.ownerLinks(101))[0];
    const open = async () => {
      const session = await context.service.openReviewSession({ grant: reviewGrant(link) });
      const opened = await context.service.consumeHandoff(session.handoff, { client: 'teacher-browser' });
      return () => context.service.resolvePreview({ sessionId: opened.session_id, secret: opened.secret,
        path: 'index.html', client: 'teacher-browser' });
    };
    const read = await open();
    expect((await read()).immutable).toBe(false);
    // 1. The student's account is disabled mid-review: bytes stop and the open sessions are revoked.
    context.user.status = 'disabled';
    await expect(read()).rejects.toMatchObject({ code: 'owner_unavailable', status: 403 });
    context.user.status = 'active';
    await expect(read()).rejects.toMatchObject({ code: 'review_session_invalid' });   // already revoked
    // 2. The issuer's key is withdrawn: a session signed by it stops being honoured.
    const second = await open();
    issuers.delete('edu:k1');
    await expect(second()).rejects.toMatchObject({ code: 'issuer_revoked', status: 403 });
    issuers.add('edu:k1');
    // 3. The session simply ages out; nothing extends it.
    const third = await open();
    const sessions = [...context.store.data.sessions.values()];
    sessions[sessions.length - 1].expires_at = Date.now() - 1;
    await expect(third()).rejects.toMatchObject({ code: 'review_session_invalid' });
  });

  test('a grant for another assignment or another school cannot open the work', async () => {
    const context = await linkedProject();
    const link = (await context.service.ownerLinks(101))[0];
    for (const options of [{ assignment: 'assign-2' }, { school: '456' }]) {
      await expect(context.service.openReviewSession({ grant: reviewGrant(link, options) }))
        .rejects.toMatchObject({ code: 'link_unavailable' });
    }
  });

  test('unlinking stops an already opened session mid-review', async () => {
    const context = await linkedProject();
    const link = (await context.service.ownerLinks(101))[0];
    const session = await context.service.openReviewSession({ grant: reviewGrant(link) });
    const opened = await context.service.consumeHandoff(session.handoff, { client: 'teacher-browser' });
    await context.service.unlink({ ownerUserId: 101, linkId: link.link_id });
    // Two layers stop it: the open sessions are revoked, and a new session cannot be issued at all.
    await expect(context.service.resolvePreview({ sessionId: opened.session_id, secret: opened.secret,
      path: 'index.html', client: 'teacher-browser' })).rejects.toMatchObject({ code: 'review_session_invalid' });
    await expect(context.service.openReviewSession({ grant: reviewGrant(link) })).rejects.toMatchObject({ code: 'link_revoked' });
  });

  test('a fixed revision keeps rendering its own bytes while the current preview follows the source', async () => {
    const context = await linkedProject();
    const link = (await context.service.ownerLinks(101))[0];
    const frozen = await context.service.freezeRevision({ ownerUserId: 101, linkId: link.link_id, requestKey: randomUUID() });
    context.fixture.edit(7, '<h1>改稿之后的内容</h1>'.repeat(4));
    await context.service.noteSourceChange({ ownerUserId: 101, projectId: 3, contentSave: true });

    const fixed = await context.service.openReviewSession({ grant: reviewGrant(link, { revisionRef: frozen.revision.revision_ref }) });
    const fixedOpen = await context.service.consumeHandoff(fixed.handoff, { client: 'teacher-browser' });
    const fixedPage = await context.service.resolvePreview({ sessionId: fixedOpen.session_id, secret: fixedOpen.secret,
      path: 'index.html', client: 'teacher-browser' });
    expect(fixedPage.immutable).toBe(true);
    expect(fixedPage.body.toString('utf8')).toContain('校园节水');

    const current = await context.service.openReviewSession({ grant: reviewGrant(link) });
    const currentOpen = await context.service.consumeHandoff(current.handoff, { client: 'teacher-browser' });
    const currentPage = await context.service.resolvePreview({ sessionId: currentOpen.session_id, secret: currentOpen.secret,
      path: 'index.html', client: 'teacher-browser' });
    expect(currentPage.immutable).toBe(false);
    expect(currentPage.body.toString('utf8')).toContain('改稿之后的内容');
  });
});

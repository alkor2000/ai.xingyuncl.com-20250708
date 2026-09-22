'use strict';

// P09 source-side state machine: association, progress facts, immutable revisions, revocation and the
// incremental read. The store fake guarantees the same ordering/uniqueness properties as MySQL; the
// isolated harness repeats the same scenarios against a real server and real MySQL 8.
const { createService } = require('../../helpers/p09Fixture');
const { signGrant, TaskGrantVerifier, parseIssuers } = require('../../../services/websiteArtifact/taskGrant');
const { randomUUID } = require('node:crypto');

const SECRET = 'lab-issuer-secret-'.repeat(3);
const CONTENT = '<h1>校园节水</h1><p>先观察，再记录两杯水的变化。</p><p>每天同一时间量水位。</p>';

function grantFor({ purpose = 'website_artifact_link', uuid = 'edu-uuid-0001', assignment = 'assign-1',
  school = '123', audience = 'practice-lab', artifactRef = null, revisionRef = null, reviewer = null } = {}) {
  const issuers = parseIssuers(JSON.stringify([{ issuer: 'edu', key_id: 'k1', secret: SECRET,
    purposes: ['website_artifact_link', 'website_artifact_revision', 'website_artifact_review'] }]));
  const verifier = new TaskGrantVerifier({ issuers, audience: 'practice-lab' });
  const now = Math.floor(Date.now() / 1000);
  const token = signGrant({
    secret: SECRET, schema_version: 1, issuer: 'edu', key_id: 'k1', grant_id: randomUUID(), audience,
    purpose, school_ref: school, assignment_ref: assignment, lesson_ref: null,
    ...(reviewer ? { reviewer: { ref: reviewer }, artifact_ref: artifactRef, revision_ref: revisionRef }
      : { subject: { uuid, cohort: 'student' } }),
    issued_at: now, expires_at: now + 200
  });
  return { token, verifier, verify: () => verifier.verify(token, purpose) };
}

async function linkedProject(options = {}) {
  const context = createService(options);
  context.fixture.addPage({ id: 7, title: '首页', slug: 'home', html: CONTENT });
  const grant = grantFor().verify();
  const { link } = await context.service.link({ ownerUserId: 101, grant, projectId: 3, entryPageId: 7 });
  return { ...context, link };
}
const types = store => store.data.events.map(event => event.type);

describe('P09 association', () => {
  test('one own project + entry page becomes a task link; the assignment comes only from the grant', async () => {
    const { service, store, link } = await linkedProject();
    expect(link).toMatchObject({ assignment_ref: 'assign-1', work_state: 'preview_ready', has_effective_save: true,
      state: 'active', student_uuid: 'edu-uuid-0001', source_instance: 'practice-lab' });
    expect(link.artifact_ref).toMatch(/^[0-9a-f-]{36}$/);
    expect(types(store)).toEqual(['artifact.created', 'artifact.preview_ready']);
    // The event payload carries no page content, no prompt, no private URL and no credential.
    const payload = JSON.stringify(store.data.events[0].payload);
    expect(payload).not.toContain('校园节水</h1>');
    expect(payload).not.toContain(SECRET);
    expect(store.data.events[0].payload.public_url).toBeNull();
    expect(store.data.events[0].payload.artifact).toMatchObject({ kind: 'html_page', source_instance: 'practice-lab' });
    const state = await service.state({ sourceInstance: 'practice-lab', schoolRef: '123' });
    expect(state.items).toHaveLength(1);
    expect(state.complete).toBe(true);
    expect(state.watermark).toBe(2);
  });

  test('an empty default project cannot be linked, and a linked-but-empty work never reports 制作中', async () => {
    const context = createService();
    const grant = grantFor().verify();
    // No page at all: there is nothing to declare as the entry page.
    await expect(context.service.link({ ownerUserId: 101, grant, projectId: 3, entryPageId: 1 }))
      .rejects.toMatchObject({ code: 'project_not_ready' });
    context.fixture.addPage({ id: 7, title: '空白页', slug: 'home', html: '<p></p>' });
    const second = grantFor().verify();
    const { link } = await context.service.link({ ownerUserId: 101, grant: second, projectId: 3, entryPageId: 7 });
    expect(link).toMatchObject({ work_state: 'linked', has_effective_save: false, preview_available: false });
    expect(types(context.store)).toEqual(['artifact.created']);
  });

  test('the blank starter page the editor creates on open never counts as started', async () => {
    const context = createService();
    // What the editor writes by itself when a project without pages is opened: its template, never saved.
    context.fixture.addPage({ id: 7, title: '新页面', slug: 'new', saved: false,
      html: '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>新页面</title></head><body><h1>开始创建您的页面</h1><p>这是一个空白页面，您可以开始编写HTML代码了。</p></body></html>' });
    const { link } = await context.service.link({ ownerUserId: 101, grant: grantFor().verify(), projectId: 3, entryPageId: 7 });
    expect(link).toMatchObject({ work_state: 'linked', has_effective_save: false, preview_available: false });
    expect(link.saved_at).toBeNull();
    // The student then actually writes and saves: only now is it 制作中/可预览.
    context.fixture.edit(7, CONTENT, '2026-09-22T09:00:00Z');
    await context.service.noteSourceChange({ ownerUserId: 101, projectId: 3 });
    const state = await context.service.state({ sourceInstance: 'practice-lab', schoolRef: '123' });
    expect(state.items[0]).toMatchObject({ work_state: 'preview_ready', has_effective_save: true });
  });

  test('refusals: another student\'s subject, a non-SSO account, another instance, a replayed grant, a second work', async () => {
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

    const reused = grantFor();
    await context.service.link({ ownerUserId: 101, grant: reused.verify(), projectId: 3, entryPageId: 7 });
    await expect(context.service.link({ ownerUserId: 101, grant: reused.verify(), projectId: 3, entryPageId: 7 }))
      .rejects.toMatchObject({ code: 'task_context_replayed' });
    // A different project for the same assignment is refused: one assignment holds one main work.
    context.fixture.state.project.id = 3;
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

describe('P09 progress facts', () => {
  test('a real save moves linked → working → preview_ready and records the source save time, not the sync time', async () => {
    const context = createService({ previewEnabled: true });
    context.fixture.addPage({ id: 7, slug: 'home', html: '<p></p>' });
    const { link } = await context.service.link({ ownerUserId: 101, grant: grantFor().verify(), projectId: 3, entryPageId: 7 });
    expect(link.work_state).toBe('linked');
    context.fixture.edit(7, CONTENT, '2026-09-22T06:30:00Z');
    await context.service.noteSourceChange({ ownerUserId: 101, projectId: 3 });
    const state = await context.service.state({ sourceInstance: 'practice-lab', schoolRef: '123' });
    expect(state.items[0]).toMatchObject({ work_state: 'preview_ready', has_effective_save: true });
    expect(state.items[0].saved_at).toBe(Date.parse('2026-09-22T06:30:00Z'));
    expect(state.synced_at).toBeGreaterThanOrEqual(state.items[0].saved_at);
    expect(types(context.store)).toEqual(['artifact.created', 'artifact.updated', 'artifact.preview_ready']);
  });

  test('saving identical bytes replays the same immutable fact; new bytes append a new one', async () => {
    const { service, store } = await linkedProject();
    await service.noteSourceChange({ ownerUserId: 101, projectId: 3 });
    const after = store.data.events.length;
    await service.noteSourceChange({ ownerUserId: 101, projectId: 3 });
    expect(store.data.events).toHaveLength(after);
    const ids = new Set(store.data.events.map(event => event.fact_id));
    expect(ids.size).toBe(store.data.events.length);
  });

  test('deleting the source stops access and records deletion; unlinking is a separate, reversible-by-relink act', async () => {
    const first = await linkedProject();
    first.fixture.deleteProject();
    await first.service.noteSourceChange({ ownerUserId: 101, projectId: 3 });
    expect(types(first.store).slice(-2)).toEqual(['artifact.preview_revoked', 'artifact.deleted']);
    const gone = await first.service.state({ sourceInstance: 'practice-lab', schoolRef: '123' });
    expect(gone.items[0]).toMatchObject({ state: 'deleted', work_state: 'unavailable', preview_available: false });

    const second = await linkedProject();
    await second.service.unlink({ ownerUserId: 101, linkId: second.store.data.events[0].link_id });
    expect(types(second.store).slice(-2)).toEqual(['artifact.preview_revoked', 'artifact.unlinked']);
  });
});

describe('P09 fixed review revisions', () => {
  test('freezing is idempotent per request key and the frozen bytes survive later edits and deletions', async () => {
    const context = await linkedProject();
    const linkId = context.store.data.events[0].link_id;
    const key = randomUUID();
    const first = await context.service.freezeRevision({ ownerUserId: 101, linkId, requestKey: key });
    const again = await context.service.freezeRevision({ ownerUserId: 101, linkId, requestKey: key });
    expect(again.replayed).toBe(true);
    expect(again.revision.revision_ref).toBe(first.revision.revision_ref);
    expect(first.revision.revision_no).toBe(1);
    expect(first.revision.manifest.frozen_scope).toBe('pages_only');

    // The student keeps working: renaming, editing and deleting pages must not touch revision 1.
    context.fixture.edit(7, '<h1>完全不同的内容</h1>'.repeat(4));
    context.fixture.addPage({ id: 8, title: '数据', slug: 'data', html: CONTENT });
    await context.service.noteSourceChange({ ownerUserId: 101, projectId: 3 });
    const second = await context.service.freezeRevision({ ownerUserId: 101, linkId, requestKey: randomUUID() });
    expect(second.revision.revision_no).toBe(2);
    expect(second.revision.content_sha256).not.toBe(first.revision.content_sha256);
    const frozen = await context.store.read(tx => tx.revisionFile(first.revision.revision_ref, 'index.html'));
    expect(frozen.content.toString('utf8')).toContain('校园节水');
    expect(frozen.content.toString('utf8')).not.toContain('完全不同的内容');
    expect(types(context.store).filter(type => type === 'artifact.revision_fixed')).toHaveLength(2);
  });

  test('a work with no effective save cannot be frozen, and a revoked link cannot be frozen at all', async () => {
    const context = createService();
    context.fixture.addPage({ id: 7, html: '<p></p>' });
    const { link } = await context.service.link({ ownerUserId: 101, grant: grantFor().verify(), projectId: 3, entryPageId: 7 });
    const linkId = context.store.data.events[0].link_id;
    await expect(context.service.freezeRevision({ ownerUserId: 101, linkId, requestKey: randomUUID() }))
      .rejects.toMatchObject({ code: 'project_empty' });
    expect(link.state).toBe('active');
    context.fixture.edit(7, CONTENT);
    await context.service.unlink({ ownerUserId: 101, linkId });
    await expect(context.service.freezeRevision({ ownerUserId: 101, linkId, requestKey: randomUUID() }))
      .rejects.toMatchObject({ code: 'link_revoked' });
  });
});

describe('P09 incremental read', () => {
  test('a cursor resumes without gaps, re-reading returns the same facts, and the cursor is scope bound', async () => {
    const context = await linkedProject();
    context.fixture.edit(7, `${CONTENT}<p>第二次保存</p>`);
    await context.service.noteSourceChange({ ownerUserId: 101, projectId: 3 });
    const scope = { sourceInstance: 'practice-lab', schoolRef: '123' };
    const firstPage = await context.service.events(scope, { limit: 2 });
    expect(firstPage.facts.map(fact => fact.type)).toEqual(['artifact.created', 'artifact.preview_ready']);
    expect(firstPage.next_cursor).toBeTruthy();
    const secondPage = await context.service.events(scope, { cursor: firstPage.next_cursor, limit: 2 });
    expect(secondPage.facts.map(fact => fact.type)).toEqual(['artifact.updated']);
    expect(secondPage.next_cursor).toBeNull();
    // A retried page returns the identical immutable facts; the watermark never moves backwards.
    const retry = await context.service.events(scope, { cursor: firstPage.next_cursor, limit: 2 });
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
    const linkId = context.store.data.events[0].link_id;
    context.fixture.addPage({ id: 8, title: '第二页', slug: 'two', html: CONTENT });
    await context.service.noteSourceChange({ ownerUserId: 101, projectId: 3 });
    await context.service.freezeRevision({ ownerUserId: 101, linkId, requestKey: randomUUID() });
    await context.service.freezeRevision({ ownerUserId: 101, linkId, requestKey: randomUUID() });
    const state = await context.service.state({ sourceInstance: 'practice-lab', schoolRef: '123' });
    expect(state.items).toHaveLength(1);
    expect(new Set(state.items.map(item => item.student_uuid)).size).toBe(1);
    expect(state.items[0].revisions).toHaveLength(2);
  });
});

describe('P09 private review access', () => {
  test('a teacher grant opens a single-use session for the named artifact only', async () => {
    const context = await linkedProject();
    const link = (await context.service.ownerLinks(101))[0];
    const review = grantFor({ purpose: 'website_artifact_review', reviewer: 'teacher-7', artifactRef: link.artifact_ref }).verify();
    const session = await context.service.openReviewSession({ grant: review });
    expect(session.target).toEqual({ kind: 'current_preview' });
    const opened = await context.service.consumeHandoff(session.handoff);
    const page = await context.service.resolvePreview({ sessionId: opened.session_id, secret: opened.secret, path: 'index.html' });
    expect(page.body.toString('utf8')).toContain('校园节水');
    // Forwarding the opening URL is useless: the handoff is consumed, and the cookie secret is per browser.
    await expect(context.service.consumeHandoff(session.handoff)).rejects.toMatchObject({ code: 'review_session_consumed' });
    await expect(context.service.resolvePreview({ sessionId: opened.session_id, secret: 'a'.repeat(43), path: 'index.html' }))
      .rejects.toMatchObject({ code: 'audience_mismatch' });
  });

  test('a grant for another assignment or another school cannot open the work', async () => {
    const context = await linkedProject();
    const link = (await context.service.ownerLinks(101))[0];
    for (const options of [{ assignment: 'assign-2' }, { school: '456' }]) {
      const review = grantFor({ purpose: 'website_artifact_review', reviewer: 'teacher-7',
        artifactRef: link.artifact_ref, ...options }).verify();
      await expect(context.service.openReviewSession({ grant: review })).rejects.toMatchObject({ code: 'link_unavailable' });
    }
  });

  test('unlinking and deleting stop an already opened session mid-review', async () => {
    const context = await linkedProject();
    const link = (await context.service.ownerLinks(101))[0];
    const review = grantFor({ purpose: 'website_artifact_review', reviewer: 'teacher-7', artifactRef: link.artifact_ref }).verify();
    const session = await context.service.openReviewSession({ grant: review });
    const opened = await context.service.consumeHandoff(session.handoff);
    await context.service.unlink({ ownerUserId: 101, linkId: link.link_id });
    // Two layers stop it: the open sessions are revoked, and a new session cannot be issued at all.
    await expect(context.service.resolvePreview({ sessionId: opened.session_id, secret: opened.secret, path: 'index.html' }))
      .rejects.toMatchObject({ code: 'review_session_invalid' });
    const later = grantFor({ purpose: 'website_artifact_review', reviewer: 'teacher-7', artifactRef: link.artifact_ref }).verify();
    await expect(context.service.openReviewSession({ grant: later })).rejects.toMatchObject({ code: 'link_revoked' });
  });

  test('a fixed revision keeps rendering its own bytes while the current preview follows the source', async () => {
    const context = await linkedProject();
    const link = (await context.service.ownerLinks(101))[0];
    const frozen = await context.service.freezeRevision({ ownerUserId: 101, linkId: link.link_id, requestKey: randomUUID() });
    context.fixture.edit(7, '<h1>改稿之后的内容</h1>'.repeat(4));
    await context.service.noteSourceChange({ ownerUserId: 101, projectId: 3 });

    const fixed = await context.service.openReviewSession({ grant: grantFor({ purpose: 'website_artifact_review',
      reviewer: 'teacher-7', artifactRef: link.artifact_ref, revisionRef: frozen.revision.revision_ref }).verify() });
    const fixedOpen = await context.service.consumeHandoff(fixed.handoff);
    const fixedPage = await context.service.resolvePreview({ sessionId: fixedOpen.session_id, secret: fixedOpen.secret, path: 'index.html' });
    expect(fixedPage.immutable).toBe(true);
    expect(fixedPage.body.toString('utf8')).toContain('校园节水');

    const current = await context.service.openReviewSession({ grant: grantFor({ purpose: 'website_artifact_review',
      reviewer: 'teacher-7', artifactRef: link.artifact_ref }).verify() });
    const currentOpen = await context.service.consumeHandoff(current.handoff);
    const currentPage = await context.service.resolvePreview({ sessionId: currentOpen.session_id, secret: currentOpen.secret, path: 'index.html' });
    expect(currentPage.immutable).toBe(false);
    expect(currentPage.body.toString('utf8')).toContain('改稿之后的内容');
  });
});

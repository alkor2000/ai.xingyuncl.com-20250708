'use strict';

// P09 source-side orchestration: task association, immutable review revisions, append-only source
// events and short-lived private review sessions.
//
// Invariants the whole package rests on:
//   * Identity and task scope come from the verified grant plus the authenticated session — never from
//     the request body, and never resolved by display name, group name or numeric user id.
//   * practice never records "submitted": it records saves, previews and fixed revisions. Submission is
//     an edu transaction over a revision reference.
//   * Events are immutable and ordered by commit; a projection only ever moves forward.
const { randomUUID, createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const { fail } = require('./errors');

const sha256 = value => createHash('sha256').update(value).digest('hex');
const short = value => sha256(value).slice(0, 16);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_TYPES = Object.freeze(['artifact.created', 'artifact.updated', 'artifact.preview_ready',
  'artifact.preview_revoked', 'artifact.unlinked', 'artifact.revision_fixed', 'artifact.deleted']);
const MAX_EVENT_LIMIT = 500;
const REVIEW_SESSION_MS = 10 * 60 * 1000;

// work_state vocabulary (C06 supplement candidate + one documented addition):
//   linked        – associated, no effective save yet (edu still shows 未开始; an empty default project
//                   can never move past this, which is the "空默认项目不算开始" rule)
//   working       – an effective save exists, no openable preview yet
//   preview_ready – an approved teacher can open the current private preview
//   unavailable   – source deleted, unlinked or preview revoked
const workState = link => {
  if (link.state !== 'active') return 'unavailable';
  if (link.preview_available) return 'preview_ready';
  return link.has_effective_save ? 'working' : 'linked';
};

function createWebsiteArtifactService({ store, reader, models, sourceInstance, previewEnabled = false,
  now = Date.now, reviewSessionMs = REVIEW_SESSION_MS }) {
  if (!store || !reader || !models?.User || typeof sourceInstance !== 'string' || typeof now !== 'function') fail('invalid_request');

  // ---- subjects -------------------------------------------------------------------------------
  // The student subject is the SSO shadow account whose uuid the grant names. Matching happens on the
  // uuid only; a name, a class tag or a numeric id never identifies a student here.
  async function student(ownerUserId, grant) {
    const user = await models.User.findById(Number(ownerUserId));
    if (!user || user.deleted_at || user.status !== 'active') fail('forbidden', 403);
    if (typeof user.isAccountExpired === 'function' && user.isAccountExpired()) fail('forbidden', 403);
    if (user.uuid_source !== 'sso' || typeof user.uuid !== 'string' || user.uuid.length < 8) fail('subject_not_eligible', 403);
    if (grant && user.uuid !== grant.subjectUuid) fail('subject_mismatch', 403);
    return user;
  }

  async function refsFor(tx, projectId, pageIds) {
    const project = await tx.ref('project', sourceInstance, projectId);
    const pages = new Map();
    for (const id of pageIds) pages.set(String(id), await tx.ref('page', sourceInstance, id));
    return { project, page: id => pages.get(String(id)) || null };
  }

  // ---- events ---------------------------------------------------------------------------------
  function payloadFor(link, facts, extra = {}) {
    return {
      artifact: { kind: 'html_page', source_instance: link.source_instance, project_ref: link.project_ref,
        artifact_ref: link.artifact_ref, entry_ref: link.entry_ref, title: extra.title ?? link.title ?? null },
      context: { assignment_ref: link.assignment_ref, lesson_ref: link.lesson_ref ?? null },
      progress: {
        work_state: extra.work_state ?? workState(link),
        has_effective_save: !!(facts ? facts.has_effective_save : link.has_effective_save),
        preview_available: extra.preview_available ?? !!link.preview_available,
        page_count: facts ? facts.page_count : null,
        effective_page_count: facts ? facts.effective_page_count : null,
        saved_at: facts ? facts.saved_at : (link.saved_at ?? null)
      },
      public_url: extra.public_url ?? null,
      ...(extra.revision ? { revision: extra.revision } : {}),
      ...(extra.reason ? { reason: extra.reason } : {})
    };
  }
  async function record(tx, link, type, discriminator, payload, occurredAt) {
    if (!EVENT_TYPES.includes(type)) fail('internal_error', 500);
    return tx.appendEvent({
      fact_id: `p09.${type.split('.')[1]}.${short(`${link.id}\u0000${discriminator}`)}`,
      type, link_id: link.id, source_instance: link.source_instance, student_uuid: link.student_uuid,
      school_ref: link.school_ref, occurred_at: occurredAt ?? now(), payload
    });
  }

  // ---- association ----------------------------------------------------------------------------
  // The student picks one of their own projects and an entry page; the assignment comes from the grant.
  async function link({ ownerUserId, grant, projectId, entryPageId }) {
    const user = await student(ownerUserId, grant);
    const source = await reader.load(user.id, projectId);
    if (source.pages.length === 0) fail('project_not_ready', 409);
    if (!source.pages.some(page => String(page.id) === String(entryPageId))) fail('entry_page_invalid', 409);
    const facts = reader.facts(source);
    return store.transaction(async tx => {
      // Single use: the grant is burned in the same transaction that creates the association, so a
      // refused attempt leaves it usable and a replayed one can never create a second link.
      try { await tx.rememberIdempotent('grant', sha256(grant.grantId), sha256(grant.purpose), { consumed: true }); }
      catch (error) { if (error.duplicate) fail('task_context_replayed', 409); throw error; }
      const existing = await tx.activeLinkForAssignment(sourceInstance, grant.assignmentRef, user.id);
      if (existing && existing.state === 'active') {
        if (String(existing.project_id) === String(projectId)) return { link: view(existing), replayed: true };
        fail('link_exists', 409);
      }
      const refs = await refsFor(tx, projectId, source.pages.map(page => page.id));
      const nowMs = now();
      const row = {
        id: randomUUID(), source_instance: sourceInstance, artifact_ref: randomUUID(), project_ref: refs.project,
        entry_ref: refs.page(entryPageId), owner_user_id: user.id, student_uuid: user.uuid, project_id: Number(projectId),
        entry_page_id: Number(entryPageId), assignment_ref: grant.assignmentRef, lesson_ref: grant.lessonRef,
        school_ref: grant.schoolRef, issuer_key: `${grant.issuer}:${grant.keyId}`, grant_id: grant.grantId,
        state: 'active', work_state: 'linked', has_effective_save: facts.has_effective_save ? 1 : 0,
        preview_available: facts.has_effective_save && previewEnabled ? 1 : 0, saved_at: facts.saved_at,
        created_at: nowMs, updated_at: nowMs
      };
      row.work_state = workState(row);
      try { await tx.insertLink(row); }
      catch (error) {
        // One assignment holds one work per student, and one project belongs to one assignment.
        if (!error.duplicate) throw error;
        const raced = await tx.activeLinkForAssignment(sourceInstance, grant.assignmentRef, user.id);
        fail(raced && String(raced.project_id) !== String(projectId) ? 'link_exists' : 'project_already_linked', 409);
      }
      const titled = { ...row, title: source.project.name };
      await record(tx, titled, 'artifact.created', `created:${facts.content_digest}`,
        payloadFor(titled, facts, { title: source.project.name }));
      if (row.preview_available) {
        await record(tx, titled, 'artifact.preview_ready', `preview:${facts.content_digest}`,
          payloadFor(titled, facts, { title: source.project.name, preview_available: true, work_state: 'preview_ready' }));
      }
      return { link: view(titled), replayed: false };
    });
  }

  // Student withdraws the association. Existing fixed revisions stay (they are the evidence edu already
  // holds); new private access stops immediately.
  async function unlink({ ownerUserId, linkId, reason = 'unlinked' }) {
    const user = await student(ownerUserId, null);
    return store.transaction(async tx => {
      const row = await tx.linkById(linkId, { forUpdate: true });
      if (!row || String(row.owner_user_id) !== String(user.id)) fail('link_unavailable', 404);
      if (row.state !== 'active') return { link: view(row), replayed: true };
      const at = now();
      await tx.updateLink(row.id, { state: 'revoked', work_state: 'unavailable', preview_available: 0, revoked_at: at, revoked_reason: reason });
      await tx.revokeSessions(row.id);
      const revoked = { ...row, state: 'revoked', preview_available: 0 };
      if (row.preview_available) {
        await record(tx, revoked, 'artifact.preview_revoked', `revoked:${at}`,
          payloadFor(revoked, null, { work_state: 'unavailable', preview_available: false, reason }), at);
      }
      await record(tx, revoked, 'artifact.unlinked', `unlinked:${at}`,
        payloadFor(revoked, null, { work_state: 'unavailable', preview_available: false, reason }), at);
      return { link: view(revoked), replayed: false };
    });
  }

  // ---- source change notes --------------------------------------------------------------------
  // Called by the editor's own save/create/delete paths after a successful write. Only linked projects
  // produce events, and only a real content change (or a state transition) appends one.
  async function noteSourceChange({ ownerUserId, projectId, deleted = false }) {
    const links = await store.read(tx => tx.linksForProject(sourceInstance, projectId));
    const results = [];
    for (const row of links) {
      if (String(row.owner_user_id) !== String(ownerUserId)) continue;
      results.push(await applyChange(row, deleted));
    }
    return results;
  }
  async function applyChange(row, deleted) {
    let facts = null;
    let gone = deleted;
    if (!gone) {
      try {
        const source = await reader.load(row.owner_user_id, row.project_id);
        facts = reader.facts(source);
        row.title = source.project.name;
        if (!source.pages.some(page => String(page.id) === String(row.entry_page_id))) gone = 'entry_removed';
      } catch (error) {
        if (error.code === 'project_unavailable') gone = true; else throw error;
      }
    }
    return store.transaction(async tx => {
      const current = await tx.linkById(row.id, { forUpdate: true });
      if (!current || current.state !== 'active') return null;
      const at = now();
      if (gone) {
        await tx.updateLink(current.id, { state: 'deleted', work_state: 'unavailable', preview_available: 0, revoked_at: at,
          revoked_reason: gone === 'entry_removed' ? 'entry_removed' : 'source_deleted' });
        await tx.revokeSessions(current.id);
        const dead = { ...current, state: 'deleted', preview_available: 0 };
        if (current.preview_available) {
          await record(tx, dead, 'artifact.preview_revoked', `revoked:${at}`,
            payloadFor(dead, null, { work_state: 'unavailable', preview_available: false, reason: 'source_deleted' }), at);
        }
        return record(tx, dead, 'artifact.deleted', `deleted:${at}`,
          payloadFor(dead, null, { work_state: 'unavailable', preview_available: false, reason: dead.revoked_reason }), at);
      }
      const previewAvailable = facts.has_effective_save && previewEnabled;
      const patch = {
        has_effective_save: facts.has_effective_save ? 1 : 0, preview_available: previewAvailable ? 1 : 0,
        saved_at: facts.saved_at, work_state: workState({ ...current, ...{ has_effective_save: facts.has_effective_save, preview_available: previewAvailable } })
      };
      await tx.updateLink(current.id, patch);
      const next = { ...current, ...patch, title: row.title };
      // The content digest discriminates the fact: saving identical bytes again replays the same
      // immutable event (same fact_id, same sequence), a real change appends a new one.
      const appended = [await record(tx, next, 'artifact.updated', `updated:${facts.content_digest}`,
        payloadFor(next, facts, { title: row.title }), facts.saved_at || at)];
      if (previewAvailable && !current.preview_available) {
        appended.push(await record(tx, next, 'artifact.preview_ready', `preview:${facts.content_digest}`,
          payloadFor(next, facts, { title: row.title, preview_available: true, work_state: 'preview_ready' }), facts.saved_at || at));
      }
      if (!previewAvailable && current.preview_available) {
        appended.push(await record(tx, next, 'artifact.preview_revoked', `revoked:${at}`,
          payloadFor(next, facts, { title: row.title, preview_available: false, reason: 'preview_unavailable' }), at));
      }
      return appended;
    });
  }

  // ---- fixed review revisions ------------------------------------------------------------------
  // Freezing is explicit and idempotent: the same request key returns the same revision, so a double
  // click or a retried edu submit can never create two versions or silently advance to newer content.
  async function freezeRevision({ ownerUserId, linkId, requestKey }) {
    if (typeof requestKey !== 'string' || !UUID.test(requestKey)) fail('invalid_idempotency_key');
    const existingLink = await store.read(tx => tx.linkById(linkId));
    if (!existingLink) fail('link_unavailable', 404);
    if (String(existingLink.owner_user_id) !== String(ownerUserId)) fail('link_unavailable', 404);
    if (existingLink.state !== 'active') fail(existingLink.state === 'deleted' ? 'source_deleted' : 'link_revoked', 409);
    const replay = await store.read(tx => tx.revisionByRequest(linkId, sha256(requestKey)));
    if (replay) return { revision: revisionView(existingLink, replay), replayed: true };
    const source = await reader.load(existingLink.owner_user_id, existingLink.project_id);
    if (!source.pages.some(page => String(page.id) === String(existingLink.entry_page_id))) fail('entry_page_invalid', 409);
    const facts = reader.facts(source);
    if (!facts.has_effective_save) fail('project_empty', 409);
    return store.transaction(async tx => {
      const row = await tx.linkById(linkId, { forUpdate: true });
      if (!row || row.state !== 'active') fail('link_unavailable', 404);
      const again = await tx.revisionByRequest(linkId, sha256(requestKey));
      if (again) return { revision: revisionView(row, again), replayed: true };
      const refs = await refsFor(tx, row.project_id, source.pages.map(page => page.id));
      const bundle = reader.bundle(source, row.entry_page_id, refs);
      const previous = await tx.revisions(linkId);
      const revision = {
        id: randomUUID(), link_id: linkId, revision_no: previous.length + 1, content_sha256: bundle.content_sha256,
        byte_length: bundle.byte_length, manifest: bundle.manifest, request_key: sha256(requestKey), created_at: now()
      };
      try { await tx.insertRevision(revision, bundle.files); }
      catch (error) {
        if (!error.duplicate) throw error;
        const raced = await tx.revisionByRequest(linkId, sha256(requestKey));
        if (raced) return { revision: revisionView(row, raced), replayed: true };
        throw error;
      }
      const titled = { ...row, title: source.project.name };
      await record(tx, titled, 'artifact.revision_fixed', `revision:${revision.id}`,
        payloadFor(titled, facts, { title: source.project.name, revision: {
          revision_ref: revision.id, revision_no: revision.revision_no, content_sha256: revision.content_sha256,
          byte_length: revision.byte_length, page_count: bundle.manifest.pages.length,
          frozen_scope: bundle.manifest.frozen_scope,
          external_dependency_count: bundle.manifest.external_dependencies.length } }));
      return { revision: revisionView(titled, revision), replayed: false };
    });
  }

  // ---- projections and reads -------------------------------------------------------------------
  const view = row => ({
    artifact_ref: row.artifact_ref, project_ref: row.project_ref, entry_ref: row.entry_ref,
    source_instance: row.source_instance, assignment_ref: row.assignment_ref, lesson_ref: row.lesson_ref ?? null,
    student_uuid: row.student_uuid, title: row.title ?? null, state: row.state, work_state: workState(row),
    has_effective_save: !!row.has_effective_save, preview_available: !!row.preview_available,
    saved_at: row.saved_at ? Number(row.saved_at) : null, linked_at: Number(row.created_at),
    revoked_at: row.revoked_at ? Number(row.revoked_at) : null, revoked_reason: row.revoked_reason ?? null
  });
  const revisionView = (row, revision) => ({
    artifact_ref: row.artifact_ref, revision_ref: revision.id, revision_no: revision.revision_no,
    content_sha256: revision.content_sha256, byte_length: Number(revision.byte_length),
    created_at: Number(revision.created_at),
    manifest: typeof revision.manifest === 'string' ? JSON.parse(revision.manifest) : revision.manifest
  });

  // Current state for a school scope. `complete` plus the watermark is what lets edu hand off from a
  // full read to incremental events without a gap — and a partial read never yields "not started".
  async function state(scope, { assignmentRefs = null, studentUuids = null } = {}) {
    return store.read(async tx => {
      const watermark = await tx.watermark();
      const links = await tx.linksInScope(scope, { assignmentRefs, studentUuids });
      const items = [];
      for (const row of links) {
        const revisions = await tx.revisions(row.id);
        items.push({
          ...view(row),
          revisions: revisions.map(revision => ({ revision_ref: revision.id, revision_no: revision.revision_no,
            content_sha256: revision.content_sha256, byte_length: Number(revision.byte_length), created_at: Number(revision.created_at) }))
        });
      }
      return { items, complete: items.length < 1000, watermark, synced_at: now() };
    });
  }

  const encodeCursor = (scope, seq) => Buffer.from(JSON.stringify({ v: 1, s: seq,
    g: short(`${scope.sourceInstance}\u0000${scope.schoolRef}`) }), 'utf8').toString('base64url');
  function decodeCursor(scope, cursor) {
    if (cursor === undefined || cursor === null || cursor === '') return 0;
    if (typeof cursor !== 'string' || cursor.length > 512) fail('cursor_invalid');
    let parsed;
    try { parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { fail('cursor_invalid'); }
    if (!parsed || parsed.v !== 1 || !Number.isSafeInteger(parsed.s) || parsed.s < 0 ||
        parsed.g !== short(`${scope.sourceInstance}\u0000${scope.schoolRef}`)) fail('cursor_invalid');
    return parsed.s;
  }
  // Incremental read. Re-reading from an older cursor returns the same immutable events again; the
  // watermark only advances with committed events, so a retried page can never skip one.
  async function events(scope, { cursor = null, limit = 200 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_EVENT_LIMIT) fail('range_too_large');
    const after = decodeCursor(scope, cursor);
    return store.read(async tx => {
      const watermark = await tx.watermark();
      const rows = await tx.events(scope, after, limit);
      const facts = rows.map(row => ({
        fact_id: row.fact_id, type: row.type, event_sequence: Number(row.event_seq),
        student_uuid: row.student_uuid, occurred_at: Number(row.occurred_at), recorded_at: Number(row.recorded_at),
        ...(typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload)
      }));
      const last = rows.length ? Number(rows[rows.length - 1].event_seq) : after;
      return { facts, next_cursor: rows.length === limit ? encodeCursor(scope, last) : null,
        cursor: encodeCursor(scope, last), watermark, synced_at: now() };
    });
  }

  async function ownerLinks(ownerUserId) {
    return store.read(async tx => {
      const rows = await tx.linksForOwner(ownerUserId);
      const items = [];
      for (const row of rows) {
        const revisions = await tx.revisions(row.id);
        items.push({ ...view(row), link_id: row.id, project_id: Number(row.project_id), entry_page_id: Number(row.entry_page_id),
          revisions: revisions.map(r => ({ revision_ref: r.id, revision_no: r.revision_no, created_at: Number(r.created_at) })) });
      }
      return items;
    });
  }

  // ---- private review sessions ------------------------------------------------------------------
  // A session is short lived, bound to one audience and one target, and opened through a single-use
  // handoff. Nothing here mints a forwardable link: after the handoff is consumed the URL is inert.
  async function openReviewSession({ grant = null, ownerUserId = null, linkId = null, revisionRef = null }) {
    if (!previewEnabled) fail('preview_unavailable', 503);
    return store.transaction(async tx => {
      let row;
      let audience;
      if (grant) {
        try { await tx.rememberIdempotent('grant', sha256(grant.grantId), sha256(grant.purpose), { consumed: true }); }
        catch (error) { if (error.duplicate) fail('task_context_replayed', 409); throw error; }
        row = await tx.linkByArtifact(sourceInstance, grant.artifactRef);
        if (!row) fail('link_unavailable', 404);
        // The grant's assignment must be the association's assignment: a teacher of another task, class
        // or school cannot open this work even with a validly signed grant.
        if (row.assignment_ref !== grant.assignmentRef || row.school_ref !== grant.schoolRef) fail('link_unavailable', 404);
        audience = `reviewer:${grant.reviewerRef.slice(0, 48)}`;
        revisionRef = grant.revisionRef ?? revisionRef;
      } else {
        row = await tx.linkById(linkId);
        if (!row || String(row.owner_user_id) !== String(ownerUserId)) fail('link_unavailable', 404);
        audience = `owner:${row.owner_user_id}`;
      }
      if (row.state !== 'active') fail(row.state === 'deleted' ? 'source_deleted' : 'link_revoked', 409);
      let revision = null;
      if (revisionRef) {
        revision = await tx.revisionById(revisionRef);
        if (!revision || revision.link_id !== row.id) fail('revision_unavailable', 404);
      } else if (!row.preview_available) fail('preview_unavailable', 409);
      const handoff = randomBytes(32).toString('base64url');
      const session = await tx.insertSession({
        id: randomUUID(), link_id: row.id, revision_id: revision ? revision.id : null, audience,
        grant_id: grant ? grant.grantId : `owner:${randomUUID()}`, handoff_sha256: sha256(handoff),
        issued_at: now(), expires_at: now() + reviewSessionMs
      });
      return { session_id: session.id, handoff, expires_at: session.expires_at,
        target: revision ? { kind: 'revision', revision_ref: revision.id, revision_no: revision.revision_no }
          : { kind: 'current_preview' }, artifact_ref: row.artifact_ref };
    });
  }

  // Consumes the one-time handoff and returns the browser secret for this session. A second use of the
  // same handoff (forwarded link, replayed URL) fails: the row no longer carries the hash.
  async function consumeHandoff(handoff) {
    if (typeof handoff !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(handoff)) fail('review_session_invalid', 401);
    const hash = sha256(handoff);
    return store.transaction(async tx => {
      const session = await tx.sessionByHandoff(hash, { forUpdate: true });
      if (!session) fail('review_session_consumed', 401);
      if (session.revoked_at || Number(session.expires_at) <= now()) fail('review_session_invalid', 401);
      const secret = randomBytes(32).toString('base64url');
      await tx.consumeSession(session.id, sha256(secret));
      return { session_id: session.id, secret, expires_at: Number(session.expires_at) };
    });
  }

  // Every rendered byte re-checks the source-side conditions; nothing is trusted from the first check.
  async function resolvePreview({ sessionId, secret, path }) {
    if (typeof sessionId !== 'string' || !UUID.test(sessionId)) fail('review_session_invalid', 401);
    if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secret)) fail('review_session_invalid', 401);
    const session = await store.read(tx => tx.sessionById(sessionId));
    if (!session || !session.secret_sha256) fail('review_session_invalid', 401);
    const given = Buffer.from(sha256(secret));
    const held = Buffer.from(session.secret_sha256);
    if (given.length !== held.length || !timingSafeEqual(given, held)) fail('audience_mismatch', 403);
    if (session.revoked_at || Number(session.expires_at) <= now()) fail('review_session_invalid', 401);
    const row = await store.read(tx => tx.linkById(session.link_id));
    if (!row) fail('link_unavailable', 404);
    if (row.state !== 'active') fail(row.state === 'deleted' ? 'source_deleted' : 'link_revoked', 410);
    if (session.revision_id) {
      const file = await store.read(tx => tx.revisionFile(session.revision_id, path || 'index.html'));
      if (!file) fail('preview_unavailable', 404);
      return { media_type: file.media_type, body: file.content, immutable: true };
    }
    // Current private preview: rendered from the live source each time, so a revoked or emptied project
    // stops being viewable immediately.
    if (!row.preview_available) fail('preview_unavailable', 409);
    const source = await reader.load(row.owner_user_id, row.project_id);
    const pages = source.pages;
    const requested = !path || path === 'index.html'
      ? pages.find(page => String(page.id) === String(row.entry_page_id))
      : pages.find(page => `pages/${String(page.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'page'}-${page.id}.html` === path);
    if (!requested) fail('preview_unavailable', 404);
    return { media_type: 'text/html; charset=utf-8', body: reader.render(requested), immutable: false };
  }

  return { link, unlink, freezeRevision, noteSourceChange, state, events, ownerLinks, openReviewSession,
    consumeHandoff, resolvePreview, view, workState, EVENT_TYPES, encodeCursor };
}
module.exports = { createWebsiteArtifactService, EVENT_TYPES, workState };

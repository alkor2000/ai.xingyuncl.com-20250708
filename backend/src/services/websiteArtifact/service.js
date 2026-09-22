'use strict';

// P09 source-side orchestration: task association, immutable review revisions, append-only source
// events and short-lived private review sessions.
//
// Invariants the whole package rests on:
//   * Identity and task scope come from the verified grant plus the authenticated session — never from
//     the request body, and never resolved by display name, group name or numeric user id.
//   * practice never records "submitted": it records saves, previews and fixed revisions. Submission is
//     an edu transaction over a revision reference.
//   * Events are immutable and ordered by commit; a projection only ever moves forward. A change is
//     identified by a monotonic change number, not by its content, so returning to earlier bytes is a
//     new change while a retried note of the same change stays one fact.
//   * "The student made something" is only ever said from an observed save. Where the evidence does not
//     reach, the answer is 未知 with a reason — never a guessed 未开始.
const { randomUUID, createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const { fail } = require('./errors');

const sha256 = value => createHash('sha256').update(value).digest('hex');
const short = value => sha256(value).slice(0, 16);
const NUL = String.fromCharCode(0);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_TYPES = Object.freeze(['artifact.created', 'artifact.updated', 'artifact.preview_ready',
  'artifact.preview_revoked', 'artifact.unlinked', 'artifact.revision_fixed', 'artifact.deleted']);
const MAX_EVENT_LIMIT = 500;
const LINK_PAGE_LIMIT = 1000;
const REVIEW_SESSION_MS = 10 * 60 * 1000;   // how long a consumed review session may render bytes
const HANDOFF_MS = 60 * 1000;               // how long the one-time handoff may be exchanged
// Reconciliation budget (candidate; measured in the isolated laboratory, not a classroom policy).
const SWEEP = Object.freeze({ limit: 25, budgetMs: 400, verifyAfterMs: 5 * 60 * 1000, verifyBatch: 5 });

// work_state vocabulary (C06 supplement candidate + two documented project-local additions):
//   linked        – associated, provably nothing saved yet (an empty default project stays here, which
//                   is the 空默认项目不算开始 rule)
//   working       – an observed student save exists, no openable preview yet
//   preview_ready – an approved reviewer can open the current private preview
//   unknown       – the work predates observation, or bytes moved without an observed save: practice
//                   does not know whether a student saved, and says so instead of guessing
//   unavailable   – source deleted, unlinked or preview revoked
const workState = link => {
  if (link.state !== 'active') return 'unavailable';
  if (link.save_evidence === 'legacy_unknown') return 'unknown';
  if (link.save_evidence !== 'observed') return 'linked';
  return link.preview_available ? 'preview_ready' : 'working';
};
// Tri-state on purpose: true / false / null(unknown). edu must not read "no" where practice means "?".
const hasEffectiveSave = link => (link.save_evidence === 'observed' ? true
  : link.save_evidence === 'legacy_unknown' ? null : false);

function createWebsiteArtifactService({ store, reader, models, sourceInstance, previewEnabled = false,
  now = Date.now, reviewSessionMs = REVIEW_SESSION_MS, handoffMs = HANDOFF_MS, assets = null,
  eligibility = null, issuerActive = null, logger = null, verifyAfterMs = SWEEP.verifyAfterMs }) {
  if (!store || !reader || !models?.User || typeof sourceInstance !== 'string' || typeof now !== 'function') fail('invalid_request');
  // Candidate load measurement: what one deployment actually spent reconciling, reported by syncStatus()
  // so a polling period can be chosen from numbers instead of being invented here.
  const metrics = { sweeps: 0, reconciled: 0, events: 0, failures: 0, last_duration_ms: 0, max_duration_ms: 0 };
  const eligibilityCache = new Map();

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
  // The owner of the work must still be a usable account for any byte to be rendered — a disabled or
  // deleted student's work stops being viewable, and the sessions already open die with it.
  async function ownerUsable(link) {
    const user = await models.User.findById(Number(link.owner_user_id));
    const ok = !!user && !user.deleted_at && user.status === 'active' &&
      !(typeof user.isAccountExpired === 'function' && user.isAccountExpired());
    if (ok) return user;
    await store.read(tx => tx.revokeSessionsForOwner(link.owner_user_id, now(), 'owner_unavailable')).catch(() => {});
    fail('owner_unavailable', 403);
  }

  async function refsFor(tx, projectId, pageIds) {
    const project = await tx.ref('project', sourceInstance, projectId);
    const pages = new Map();
    for (const id of pageIds) pages.set(String(id), await tx.ref('page', sourceInstance, id));
    return { project, page: id => pages.get(String(id)) || null };
  }
  // One grant is one use, scoped by its issuer: two issuers (or two schools) can never collide on an id.
  const grantScope = grant => sha256(`${grant.issuer}:${grant.keyId}${NUL}${grant.grantId}`);
  async function burnGrant(tx, grant) {
    try { await tx.rememberIdempotent('grant', grantScope(grant), sha256(grant.purpose), { consumed: true }); }
    catch (error) { if (error.duplicate) fail('task_context_replayed', 409); throw error; }
  }

  // ---- events ---------------------------------------------------------------------------------
  function payloadFor(link, facts, extra = {}) {
    return {
      artifact: { kind: 'html_page', source_instance: link.source_instance, project_ref: link.project_ref,
        artifact_ref: link.artifact_ref, entry_ref: link.entry_ref, title: extra.title ?? link.title ?? null },
      context: { assignment_ref: link.assignment_ref, lesson_ref: link.lesson_ref ?? null },
      progress: {
        work_state: extra.work_state ?? workState(link),
        // Evidence, its reason and the observed counters travel together: a consumer can always tell
        // "no save" from "we cannot know", and can show when the last real save happened.
        save_evidence: link.save_evidence ?? 'none',
        save_evidence_reason: link.save_reason ?? null,
        has_effective_save: hasEffectiveSave(link),
        real_save_count: Number(link.real_save_count || 0),
        last_real_save_at: link.last_real_save_at ? Number(link.last_real_save_at) : null,
        change_no: Number(link.change_no || 0),
        preview_available: extra.preview_available ?? !!link.preview_available,
        page_count: facts ? facts.page_count : (link.page_count ?? null),
        non_empty_page_count: facts ? facts.non_empty_page_count : null,
        saved_at: link.last_real_save_at ? Number(link.last_real_save_at) : null,
        source_touched_at: facts ? facts.source_touched_at : (link.saved_at ?? null)
      },
      public_url: extra.public_url ?? null,
      ...(extra.revision ? { revision: extra.revision } : {}),
      ...(extra.reason ? { reason: extra.reason } : {})
    };
  }
  async function record(tx, link, type, discriminator, payload, occurredAt) {
    if (!EVENT_TYPES.includes(type)) fail('internal_error', 500);
    const event = await tx.appendEvent({
      fact_id: `p09.${type.split('.')[1]}.${short(`${link.id}${NUL}${discriminator}`)}`,
      type, link_id: link.id, source_instance: link.source_instance, student_uuid: link.student_uuid,
      school_ref: link.school_ref, occurred_at: occurredAt ?? now(), payload
    });
    metrics.events += 1;
    return event;
  }

  // ---- save evidence ---------------------------------------------------------------------------
  // Which of the three answers the ledger may give about "did a student actually save this work".
  // `observed` is the only one that claims a save, and it is only ever written by the editor's own
  // authenticated save path (recordSourceWrite below).
  function initialEvidence(facts) {
    // A project whose rows have never been updated since they were created cannot contain a save: the
    // editor writes its starter page once and never touches it again until the student saves.
    if (!facts.source_ever_updated) return { save_evidence: 'none', save_reason: 'no_update_since_created' };
    // Something updated a row before P09 was watching. That could be a save, a rename or a publish
    // toggle — practice cannot tell them apart afterwards, so it reports 未知 with the reason.
    return { save_evidence: 'legacy_unknown', save_reason: 'history_before_observation' };
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
      await burnGrant(tx, grant);
      const existing = await tx.activeLinkForAssignment(sourceInstance, grant.assignmentRef, user.id);
      if (existing && existing.state === 'active') {
        if (String(existing.project_id) === String(projectId)) return { link: view(existing), replayed: true };
        fail('link_exists', 409);
      }
      // One project answers one current assignment. The check is against the project's own active link,
      // whatever assignment that link belongs to — the unique key enforces the same rule under a race.
      const held = await tx.activeLinkForProject(sourceInstance, projectId);
      if (held) fail('project_already_linked', 409);
      const refs = await refsFor(tx, projectId, source.pages.map(page => page.id));
      const nowMs = now();
      const evidence = initialEvidence(facts);
      const row = {
        id: randomUUID(), source_instance: sourceInstance, artifact_ref: randomUUID(), project_ref: refs.project,
        entry_ref: refs.page(entryPageId), owner_user_id: user.id, student_uuid: user.uuid, project_id: Number(projectId),
        entry_page_id: Number(entryPageId), assignment_ref: grant.assignmentRef, lesson_ref: grant.lessonRef,
        school_ref: grant.schoolRef, issuer_key: `${grant.issuer}:${grant.keyId}`, grant_id: grant.grantId,
        state: 'active', work_state: 'linked', has_effective_save: 0, preview_available: 0,
        saved_at: facts.source_touched_at, created_at: nowMs, updated_at: nowMs,
        content_digest: facts.content_digest, change_no: 0, ...evidence,
        real_save_count: 0, page_count: facts.page_count, last_real_save_at: null, reconciled_at: nowMs
      };
      // Something to show is not the same as something saved: an unknown-history work can be previewed,
      // a provably untouched one cannot.
      row.preview_available = previewEnabled && row.save_evidence !== 'none' ? 1 : 0;
      row.has_effective_save = row.save_evidence === 'observed' ? 1 : 0;
      row.work_state = workState(row);
      try { await tx.insertLink(row); }
      catch (error) {
        if (!error.duplicate) throw error;
        const raced = await tx.activeLinkForAssignment(sourceInstance, grant.assignmentRef, user.id);
        fail(raced && String(raced.project_id) !== String(projectId) ? 'link_exists' : 'project_already_linked', 409);
      }
      const titled = { ...row, title: source.project.name };
      await record(tx, titled, 'artifact.created', `created:${facts.content_digest}`,
        payloadFor(titled, facts, { title: source.project.name }));
      if (row.preview_available) {
        await record(tx, titled, 'artifact.preview_ready', `preview:0:${facts.content_digest}`,
          payloadFor(titled, facts, { title: source.project.name, preview_available: true, work_state: workState(titled) }));
      }
      return { link: view(titled), replayed: false };
    });
  }

  // Student withdraws the association. Existing fixed revisions stay (they are the evidence edu already
  // holds); new private access stops immediately, and the project becomes linkable again.
  async function unlink({ ownerUserId, linkId, reason = 'unlinked' }) {
    const user = await student(ownerUserId, null);
    return store.transaction(async tx => {
      const row = await tx.linkById(linkId, { forUpdate: true });
      if (!row || String(row.owner_user_id) !== String(user.id)) fail('link_unavailable', 404);
      if (row.state !== 'active') return { link: view(row), replayed: true };
      const at = now();
      await tx.updateLink(row.id, { state: 'revoked', work_state: 'unavailable', preview_available: 0,
        sync_pending_at: null, revoked_at: at, revoked_reason: reason });
      await tx.revokeSessions(row.id, 'link_revoked');
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

  // ---- source writes, durable marking and reconciliation ----------------------------------------
  // Phase 1, awaited by the editor's own request: record the durable facts (this work changed; a
  // student really saved) before answering the save. A crash or a ledger outage right after this leaves
  // a pending marker, and the sweep below finishes the job — the projection is never silently stale.
  async function recordSourceWrite({ ownerUserId, projectId, deleted = false, contentSave = false }) {
    const at = now();
    return store.transaction(async tx => {
      const links = await tx.linksForProject(sourceInstance, projectId);
      const mine = links.filter(row => String(row.owner_user_id) === String(ownerUserId));
      for (const row of mine) {
        await tx.markLinkPending(row.id, at);
        if (contentSave && !deleted) await tx.recordRealSave(row.id, at);
      }
      return { marked: mine.length, link_ids: mine.map(row => row.id), deleted: !!deleted };
    });
  }
  // Phase 2: bring the projection up to date. Safe to call again, from anywhere, at any time.
  async function noteSourceChange({ ownerUserId, projectId, deleted = false, contentSave = false }) {
    const marked = await recordSourceWrite({ ownerUserId, projectId, deleted, contentSave });
    const results = [];
    for (const id of marked.link_ids) results.push(await reconcileLink(id, { deleted }));
    return results;
  }

  async function reconcileLink(linkId, { deleted = false } = {}) {
    const row = await store.read(tx => tx.linkById(linkId));
    if (!row || row.state !== 'active') return null;
    let facts = null;
    let gone = deleted;
    let title = row.title ?? null;
    if (!gone) {
      try {
        const source = await reader.load(row.owner_user_id, row.project_id);
        facts = reader.facts(source);
        title = source.project.name;
        if (!source.pages.some(page => String(page.id) === String(row.entry_page_id))) gone = 'entry_removed';
      } catch (error) {
        if (error.code === 'project_unavailable') gone = true; else throw error;
      }
    }
    const at = now();
    try {
      const result = await store.transaction(async tx => {
        const current = await tx.linkById(row.id, { forUpdate: true });
        if (!current || current.state !== 'active') return null;
        if (gone) {
          const reasonCode = gone === 'entry_removed' ? 'entry_removed' : 'source_deleted';
          await tx.updateLink(current.id, { state: 'deleted', work_state: 'unavailable', preview_available: 0,
            sync_pending_at: null, reconciled_at: at, reconcile_error: null, revoked_at: at, revoked_reason: reasonCode });
          await tx.revokeSessions(current.id, 'source_deleted');
          const dead = { ...current, state: 'deleted', preview_available: 0, title, revoked_reason: reasonCode };
          if (current.preview_available) {
            await record(tx, dead, 'artifact.preview_revoked', `revoked:${at}`,
              payloadFor(dead, null, { title, work_state: 'unavailable', preview_available: false, reason: 'source_deleted' }), at);
          }
          await record(tx, dead, 'artifact.deleted', `deleted:${at}`,
            payloadFor(dead, null, { title, work_state: 'unavailable', preview_available: false, reason: reasonCode }), at);
          return { state: 'deleted' };
        }
        // Change identity is a number, not a digest: A→B→A is three changes, and re-noting the same
        // change (a retry, a second hook call, a sweep after a crash) is still the one fact.
        const contentChanged = facts.content_digest !== current.content_digest;
        const pagesAdded = Number(facts.page_count) > Number(current.page_count || 0);
        const changeNo = contentChanged ? Number(current.change_no || 0) + 1 : Number(current.change_no || 0);
        // The pending marker is itself the proof that this change arrived through the editor's own
        // authenticated write path — a rename or a page deletion moves the digest without being a save,
        // and it is explained.
        const observedWrite = current.sync_pending_at != null;
        let evidence = current.save_evidence;
        let reason = current.save_reason;
        // Bytes moved inside an existing page with nothing observed at all: something wrote outside the
        // watched path. That is never read as "a student saved", but it is also not "nothing happened" —
        // it becomes 未知 with its own reason.
        if (contentChanged && evidence === 'none' && !pagesAdded && !observedWrite) {
          evidence = 'legacy_unknown';
          reason = 'change_without_observed_save';
        }
        const previewAvailable = previewEnabled && evidence !== 'none';
        const patch = {
          content_digest: facts.content_digest, change_no: changeNo, page_count: facts.page_count,
          save_evidence: evidence, save_reason: reason,
          has_effective_save: evidence === 'observed' ? 1 : 0, preview_available: previewAvailable ? 1 : 0,
          saved_at: facts.source_touched_at, sync_pending_at: null, sync_attempts: 0,
          reconciled_at: at, reconcile_error: null
        };
        patch.work_state = workState({ ...current, ...patch });
        await tx.updateLink(current.id, patch);
        const next = { ...current, ...patch, title };
        const evidenceChanged = evidence !== current.save_evidence;
        const previewChanged = previewAvailable !== !!current.preview_available;
        const appended = [];
        if (contentChanged || evidenceChanged || title !== current.title) {
          appended.push(await record(tx, next, 'artifact.updated', `updated:${changeNo}:${facts.content_digest}`,
            payloadFor(next, facts, { title }), facts.source_touched_at || at));
        }
        if (previewChanged && previewAvailable) {
          appended.push(await record(tx, next, 'artifact.preview_ready', `preview:${changeNo}:${facts.content_digest}`,
            payloadFor(next, facts, { title, preview_available: true, work_state: patch.work_state }), facts.source_touched_at || at));
        }
        if (previewChanged && !previewAvailable) {
          appended.push(await record(tx, next, 'artifact.preview_revoked', `revoked:${at}`,
            payloadFor(next, facts, { title, preview_available: false, reason: 'preview_unavailable' }), at));
        }
        return appended;
      });
      metrics.reconciled += 1;
      return result;
    } catch (error) {
      // A failed reconciliation keeps the pending marker: the work is retried, never dropped.
      metrics.failures += 1;
      await store.read(tx => tx.clearPending(row.id, now(), { error: error.code || 'failed' })).catch(() => {});
      if (logger) { try { logger.warn('P09 reconcile failed', { code: error.code || 'unknown' }); } catch { /* never fatal */ } }
      throw error;
    }
  }

  // Bounded catch-up. Pending work first (a marker someone left behind), then the oldest unverified
  // works — that second pass is what recovers a change whose marker was itself lost in a crash.
  async function sweep({ schoolRef = null, limit = SWEEP.limit, budgetMs = SWEEP.budgetMs, verify = true } = {}) {
    const started = Date.now();
    let swept = 0;
    let exhausted = false;
    let work = [];
    try { work = [...await store.read(tx => tx.pendingLinks({ sourceInstance, schoolRef, limit }))]; }
    catch { return { swept: 0, remaining: null, budget_exhausted: true, duration_ms: 0 }; }
    if (verify && work.length < limit) {
      const stale = await store.read(tx => tx.staleLinks({ sourceInstance, schoolRef,
        olderThan: now() - verifyAfterMs, limit: Math.min(SWEEP.verifyBatch, limit - work.length) })).catch(() => []);
      work.push(...stale);
    }
    for (const row of work) {
      if (Date.now() - started > budgetMs) { exhausted = true; break; }
      try { await reconcileLink(row.id); swept += 1; } catch { exhausted = true; }
    }
    const duration = Date.now() - started;
    metrics.sweeps += 1;
    metrics.last_duration_ms = duration;
    metrics.max_duration_ms = Math.max(metrics.max_duration_ms, duration);
    const remaining = await store.read(tx => tx.pendingCount({ sourceInstance, schoolRef: schoolRef ?? null }))
      .catch(() => null);
    return { swept, remaining, budget_exhausted: exhausted, duration_ms: duration };
  }
  const syncStatus = () => ({ ...metrics, sweep_limit: SWEEP.limit, sweep_budget_ms: SWEEP.budgetMs,
    verify_after_ms: verifyAfterMs });

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
    // A work nothing has ever been saved into is not a version; an unknown history still is (the bytes
    // exist, and the manifest records what the evidence was at the moment of freezing).
    if (existingLink.save_evidence === 'none' && !facts.source_ever_updated) fail('project_empty', 409);
    return store.transaction(async tx => {
      const row = await tx.linkById(linkId, { forUpdate: true });
      if (!row || row.state !== 'active') fail('link_unavailable', 404);
      const again = await tx.revisionByRequest(linkId, sha256(requestKey));
      if (again) return { revision: revisionView(row, again), replayed: true };
      const refs = await refsFor(tx, row.project_id, source.pages.map(page => page.id));
      const bundle = await reader.bundle(source, row.entry_page_id, refs, { ownerUserId: row.owner_user_id });
      const previous = await tx.revisions(linkId);
      const manifest = { ...bundle.manifest, save_evidence: row.save_evidence,
        save_evidence_reason: row.save_reason ?? null, real_save_count: Number(row.real_save_count || 0),
        change_no: Number(row.change_no || 0) };
      const revision = {
        id: randomUUID(), link_id: linkId, revision_no: previous.length + 1, content_sha256: bundle.content_sha256,
        byte_length: bundle.byte_length, manifest, request_key: sha256(requestKey), created_at: now()
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
          byte_length: revision.byte_length, page_count: manifest.pages.length,
          asset_count: manifest.assets.length, refused_asset_count: manifest.refused_assets.length,
          frozen_scope: manifest.frozen_scope,
          external_dependency_count: manifest.external_dependencies.length } }));
      return { revision: revisionView(titled, revision), replayed: false };
    });
  }

  // ---- projections and reads -------------------------------------------------------------------
  const view = row => ({
    artifact_ref: row.artifact_ref, project_ref: row.project_ref, entry_ref: row.entry_ref,
    source_instance: row.source_instance, assignment_ref: row.assignment_ref, lesson_ref: row.lesson_ref ?? null,
    student_uuid: row.student_uuid, title: row.title ?? null, state: row.state, work_state: workState(row),
    save_evidence: row.save_evidence ?? 'none', save_evidence_reason: row.save_reason ?? null,
    has_effective_save: hasEffectiveSave(row), real_save_count: Number(row.real_save_count || 0),
    last_real_save_at: row.last_real_save_at ? Number(row.last_real_save_at) : null,
    change_no: Number(row.change_no || 0), preview_available: !!row.preview_available,
    saved_at: row.last_real_save_at ? Number(row.last_real_save_at) : null,
    source_touched_at: row.saved_at ? Number(row.saved_at) : null,
    synced_at: row.reconciled_at ? Number(row.reconciled_at) : null,
    pending_reconcile: !!row.sync_pending_at,
    linked_at: Number(row.created_at),
    revoked_at: row.revoked_at ? Number(row.revoked_at) : null, revoked_reason: row.revoked_reason ?? null
  });
  const revisionView = (row, revision) => ({
    artifact_ref: row.artifact_ref, revision_ref: revision.id, revision_no: revision.revision_no,
    content_sha256: revision.content_sha256, byte_length: Number(revision.byte_length),
    created_at: Number(revision.created_at),
    manifest: typeof revision.manifest === 'string' ? JSON.parse(revision.manifest) : revision.manifest
  });

  // Current state for a school scope. `complete` plus the watermark is what lets edu hand off from a
  // full read to incremental events without a gap — and it is only ever true when the page was not cut
  // short AND nothing is still waiting to be reconciled, so a stale projection is never sold as whole.
  async function state(scope, { assignmentRefs = null, studentUuids = null } = {}) {
    const sync = await sweep({ schoolRef: scope.schoolRef });
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
      const pending = sync.remaining ?? items.filter(item => item.pending_reconcile).length;
      return { items, complete: items.length < LINK_PAGE_LIMIT && pending === 0 && !sync.budget_exhausted,
        pending_reconcile: pending, item_limit: LINK_PAGE_LIMIT, watermark, synced_at: now() };
    });
  }

  const encodeCursor = (scope, seq) => Buffer.from(JSON.stringify({ v: 1, s: seq,
    g: short(`${scope.sourceInstance}${NUL}${scope.schoolRef}`) }), 'utf8').toString('base64url');
  function decodeCursor(scope, cursor) {
    if (cursor === undefined || cursor === null || cursor === '') return 0;
    if (typeof cursor !== 'string' || cursor.length > 512) fail('cursor_invalid');
    let parsed;
    try { parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { fail('cursor_invalid'); }
    if (!parsed || parsed.v !== 1 || !Number.isSafeInteger(parsed.s) || parsed.s < 0 ||
        parsed.g !== short(`${scope.sourceInstance}${NUL}${scope.schoolRef}`)) fail('cursor_invalid');
    return parsed.s;
  }
  // Incremental read. Re-reading from an older cursor returns the same immutable events again; the
  // watermark only advances with committed events, so a retried page can never skip one.
  async function events(scope, { cursor = null, limit = 200 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_EVENT_LIMIT) fail('range_too_large');
    const after = decodeCursor(scope, cursor);
    const sync = await sweep({ schoolRef: scope.schoolRef });
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
        cursor: encodeCursor(scope, last), watermark, pending_reconcile: sync.remaining ?? null, synced_at: now() };
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
  // Eligibility is asked again on every access. A grant authorises ONE opening; it is not a lease, and a
  // consumed ticket never stands in for "this teacher still teaches this class".
  async function requireEligible(link, session) {
    if (session.audience_kind !== 'reviewer') return { eligible: true, reason: 'owner_session' };
    if (!eligibility) fail('eligibility_unavailable', 503);
    const cached = eligibilityCache.get(session.id);
    if (cached && cached.until > now()) {
      if (!cached.eligible) fail('not_eligible', 403);
      return cached;
    }
    const verdict = await eligibility.check({
      audienceKind: session.audience_kind, audienceRef: String(session.audience).replace(/^reviewer:/, ''),
      schoolRef: link.school_ref, assignmentRef: link.assignment_ref, studentUuid: link.student_uuid,
      artifactRef: link.artifact_ref
    });
    const entry = { eligible: !!verdict?.eligible, reason: verdict?.reason ?? null, until: now() + (eligibility.cacheMs || 0) };
    if (eligibility.cacheMs) eligibilityCache.set(session.id, entry);
    if (!entry.eligible) {
      const unavailable = entry.reason === 'eligibility_unavailable';
      fail(unavailable ? 'eligibility_unavailable' : 'not_eligible', unavailable ? 503 : 403);
    }
    return entry;
  }
  function requireIssuer(session) {
    if (session.audience_kind !== 'reviewer') return;
    if (typeof issuerActive === 'function' && !issuerActive(session.issuer_key)) fail('issuer_revoked', 403);
  }

  // A session is short lived, bound to one audience and one target, and opened through a single-use
  // handoff that is bound to the browser which redeems it. Nothing here mints a forwardable link.
  async function openReviewSession({ grant = null, ownerUserId = null, linkId = null, revisionRef = null }) {
    if (!previewEnabled) fail('preview_unavailable', 503);
    // Refuse before anything is minted when this deployment cannot re-check a reviewer's eligibility.
    if (grant && !eligibility) fail('eligibility_unavailable', 503);
    return store.transaction(async tx => {
      let row;
      let audience;
      let audienceKind;
      let issuerKey;
      if (grant) {
        await burnGrant(tx, grant);
        row = await tx.linkByArtifact(sourceInstance, grant.artifactRef);
        if (!row) fail('link_unavailable', 404);
        // The grant's assignment must be the association's assignment: a teacher of another task, class
        // or school cannot open this work even with a validly signed grant.
        if (row.assignment_ref !== grant.assignmentRef || row.school_ref !== grant.schoolRef) fail('link_unavailable', 404);
        audienceKind = 'reviewer';
        audience = `reviewer:${grant.reviewerRef}`;
        issuerKey = `${grant.issuer}:${grant.keyId}`;
        revisionRef = grant.revisionRef ?? revisionRef;
      } else {
        row = await tx.linkById(linkId);
        if (!row || String(row.owner_user_id) !== String(ownerUserId)) fail('link_unavailable', 404);
        audienceKind = 'owner';
        audience = `owner:${row.owner_user_id}`;
        issuerKey = `owner:${sourceInstance}`.slice(0, 64);
      }
      if (row.state !== 'active') fail(row.state === 'deleted' ? 'source_deleted' : 'link_revoked', 409);
      await ownerUsable(row);
      let revision = null;
      if (revisionRef) {
        revision = await tx.revisionById(revisionRef);
        if (!revision || revision.link_id !== row.id) fail('revision_unavailable', 404);
      } else if (!row.preview_available) fail('preview_unavailable', 409);
      const at = now();
      const handoff = randomBytes(32).toString('base64url');
      const session = await tx.insertSession({
        id: randomUUID(), link_id: row.id, revision_id: revision ? revision.id : null, audience, audience_kind: audienceKind,
        grant_id: grant ? grant.grantId : randomUUID(), issuer_key: issuerKey, handoff_sha256: sha256(handoff),
        issued_at: at, handoff_expires_at: at + handoffMs, expires_at: at + reviewSessionMs
      });
      // The grant authorises this opening; the session's own life is independent of the grant's, capped
      // at reviewSessionMs, never extended, and re-checked against eligibility on every rendered byte.
      if (audienceKind === 'reviewer') await requireEligible(row, session);
      return { session_id: session.id, handoff, expires_at: session.expires_at,
        handoff_expires_at: session.handoff_expires_at,
        eligibility: audienceKind === 'reviewer' ? (eligibility.mode || 'configured') : 'owner_session',
        target: revision ? { kind: 'revision', revision_ref: revision.id, revision_no: revision.revision_no }
          : { kind: 'current_preview' }, artifact_ref: row.artifact_ref };
    });
  }

  // Consumes the one-time handoff and binds the session to the browser that redeemed it. A forwarded
  // URL is inert afterwards, and the cookie it produced is refused in any other browser.
  async function consumeHandoff(handoff, { client = null } = {}) {
    if (typeof handoff !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(handoff)) fail('review_session_invalid', 401);
    const hash = sha256(handoff);
    const clientHash = typeof client === 'string' && client.length ? sha256(client) : null;
    const session = await store.read(tx => tx.sessionByHandoff(hash));
    if (!session) fail('review_session_consumed', 401);
    if (session.revoked_at || Number(session.handoff_expires_at) <= now() || Number(session.expires_at) <= now()) {
      fail('review_session_invalid', 401);
    }
    const link = await store.read(tx => tx.linkById(session.link_id));
    if (!link) fail('link_unavailable', 404);
    if (link.state !== 'active') fail(link.state === 'deleted' ? 'source_deleted' : 'link_revoked', 410);
    await ownerUsable(link);
    requireIssuer(session);
    await requireEligible(link, session);
    const secret = randomBytes(32).toString('base64url');
    const consumed = await store.transaction(tx => tx.consumeSession(session.id, sha256(secret), clientHash));
    if (!consumed) fail('review_session_consumed', 401);
    return { session_id: session.id, secret, expires_at: Number(session.expires_at) };
  }

  // Every rendered byte re-checks everything: the browser binding, the session, the link, the owner's
  // account, the issuer and the reviewer's current eligibility. A fixed revision is bytes we already
  // hold, but it is not a bypass — a frozen page is refused the moment any of those stops holding.
  async function resolvePreview({ sessionId, secret, path, client = null }) {
    if (typeof sessionId !== 'string' || !UUID.test(sessionId)) fail('review_session_invalid', 401);
    if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secret)) fail('review_session_invalid', 401);
    const session = await store.read(tx => tx.sessionById(sessionId));
    if (!session || !session.secret_sha256) fail('review_session_invalid', 401);
    const given = Buffer.from(sha256(secret));
    const held = Buffer.from(session.secret_sha256);
    if (given.length !== held.length || !timingSafeEqual(given, held)) fail('audience_mismatch', 403);
    if (session.revoked_at || Number(session.expires_at) <= now()) fail('review_session_invalid', 401);
    if (session.client_sha256) {
      const fingerprint = typeof client === 'string' && client.length ? sha256(client) : null;
      if (fingerprint !== session.client_sha256) fail('review_session_binding', 403);
    }
    const row = await store.read(tx => tx.linkById(session.link_id));
    if (!row) fail('link_unavailable', 404);
    if (row.state !== 'active') fail(row.state === 'deleted' ? 'source_deleted' : 'link_revoked', 410);
    await ownerUsable(row);
    requireIssuer(session);
    await requireEligible(row, session);
    await store.read(tx => tx.touchSession(session.id, now())).catch(() => {});
    if (session.revision_id) {
      const file = await store.read(tx => tx.revisionFile(session.revision_id, path || 'index.html'));
      if (!file) fail('preview_unavailable', 404);
      return { media_type: file.media_type, body: file.content, immutable: true };
    }
    // Current private preview: rendered from the live source each time, so a revoked or emptied project
    // stops being viewable immediately.
    if (!row.preview_available) fail('preview_unavailable', 409);
    const source = await reader.load(row.owner_user_id, row.project_id);
    if (path && path.startsWith('uploads/')) {
      if (!assets) fail('asset_unavailable', 404);
      const reference = assets.classify(`/${path}`);
      if (reference.kind !== 'upload') fail('asset_unavailable', 404);
      const resolved = await assets.resolve({ ownerUserId: row.owner_user_id, projectId: row.project_id, reference });
      if (resolved.refused) fail('asset_unavailable', 404);
      return { media_type: resolved.media_type, body: resolved.content, immutable: false };
    }
    const requested = !path || path === 'index.html'
      ? source.pages.find(page => String(page.id) === String(row.entry_page_id))
      : source.pages.find(page => reader.pageFileFor(page.slug, page.id) === path);
    if (!requested) fail('preview_unavailable', 404);
    return { media_type: 'text/html; charset=utf-8',
      body: reader.renderForPreview(requested, { pages: source.pages, entryPageId: row.entry_page_id, ownerUserId: row.owner_user_id }),
      immutable: false };
  }

  return { link, unlink, freezeRevision, noteSourceChange, recordSourceWrite, reconcileLink, sweep, syncStatus,
    state, events, ownerLinks, openReviewSession, consumeHandoff, resolvePreview, view, workState,
    EVENT_TYPES, encodeCursor, SWEEP };
}
module.exports = { createWebsiteArtifactService, EVENT_TYPES, workState, hasEffectiveSave, REVIEW_SESSION_MS, HANDOFF_MS };

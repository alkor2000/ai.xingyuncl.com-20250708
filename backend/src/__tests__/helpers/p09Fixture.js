'use strict';

// In-memory stand-in for the P09 ledger. It implements exactly the transaction surface service.js uses,
// including the two properties the real store guarantees: commit-ordered sequence numbers and unique
// constraints that raise a `duplicate` error. Used by the unit tests; the isolated harness runs the same
// service against real MySQL 8.
const { randomUUID } = require('node:crypto');
const { createSourceReader } = require('../../services/websiteArtifact/snapshot');
const { createWebsiteArtifactService } = require('../../services/websiteArtifact/service');

function createMemoryStore({ now = Date.now } = {}) {
  const data = { refs: new Map(), links: new Map(), revisions: new Map(), files: new Map(), events: [],
    sessions: new Map(), idempotency: new Map(), seq: 0 };
  const duplicate = () => { const error = new Error('duplicate'); error.duplicate = true; return error; };
  const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

  const tx = {
    async ref(kind, instance, localId) {
      const key = `${kind}|${instance}|${localId}`;
      if (!data.refs.has(key)) data.refs.set(key, randomUUID());
      return data.refs.get(key);
    },
    async nextSeq() { data.seq += 1; return data.seq; },
    async appendEvent(event) {
      const existing = data.events.find(row => row.fact_id === event.fact_id);
      if (existing) return existing;                       // immutable fact: same id, same sequence
      const row = { ...event, event_seq: await tx.nextSeq(), recorded_at: now() };
      data.events.push(row);
      return row;
    },
    async events(scope, afterSeq, limit) {
      return data.events.filter(row => row.source_instance === scope.sourceInstance && row.school_ref === scope.schoolRef &&
        row.event_seq > afterSeq).sort((a, b) => a.event_seq - b.event_seq).slice(0, limit).map(clone);
    },
    async watermark() { return data.seq; },
    async linkById(id) { return clone(data.links.get(id)) || null; },
    async linkByArtifact(instance, artifactRef) {
      return clone([...data.links.values()].find(row => row.source_instance === instance && row.artifact_ref === artifactRef)) || null;
    },
    async activeLinkForAssignment(instance, assignmentRef, ownerUserId) {
      return clone([...data.links.values()].find(row => row.source_instance === instance &&
        row.assignment_ref === assignmentRef && String(row.owner_user_id) === String(ownerUserId))) || null;
    },
    async linksForProject(instance, projectId) {
      return [...data.links.values()].filter(row => row.source_instance === instance &&
        String(row.project_id) === String(projectId) && row.state === 'active').map(clone);
    },
    async linksForOwner(ownerUserId) {
      return [...data.links.values()].filter(row => String(row.owner_user_id) === String(ownerUserId)).map(clone);
    },
    async linksInScope(scope, { assignmentRefs = null, studentUuids = null } = {}) {
      return [...data.links.values()].filter(row => row.source_instance === scope.sourceInstance && row.school_ref === scope.schoolRef &&
        (!assignmentRefs || assignmentRefs.includes(row.assignment_ref)) &&
        (!studentUuids || studentUuids.includes(row.student_uuid))).map(clone);
    },
    async insertLink(row) {
      const clash = [...data.links.values()].some(existing => existing.source_instance === row.source_instance &&
        existing.assignment_ref === row.assignment_ref &&
        (String(existing.owner_user_id) === String(row.owner_user_id) || String(existing.project_id) === String(row.project_id)));
      if (clash) throw duplicate();
      data.links.set(row.id, { ...row });
      return row;
    },
    async updateLink(id, patch) { Object.assign(data.links.get(id), patch, { updated_at: now() }); },
    async revisions(linkId) {
      return [...data.revisions.values()].filter(row => row.link_id === linkId)
        .sort((a, b) => a.revision_no - b.revision_no).map(clone);
    },
    async revisionById(id) { return clone(data.revisions.get(id)) || null; },
    async revisionByRequest(linkId, requestKey) {
      return clone([...data.revisions.values()].find(row => row.link_id === linkId && row.request_key === requestKey)) || null;
    },
    async insertRevision(row, files) {
      if ([...data.revisions.values()].some(existing => existing.link_id === row.link_id &&
        (existing.request_key === row.request_key || existing.revision_no === row.revision_no))) throw duplicate();
      data.revisions.set(row.id, { ...row });
      for (const file of files) data.files.set(`${row.id}|${file.path}`, { ...file });
      return row;
    },
    async revisionFile(revisionId, path) { return data.files.get(`${revisionId}|${path}`) || null; },
    async insertSession(row) { data.sessions.set(row.id, { ...row }); return row; },
    async sessionByHandoff(hash) { return [...data.sessions.values()].find(row => row.handoff_sha256 === hash) || null; },
    async sessionById(id) { return data.sessions.get(id) || null; },
    async consumeSession(id, secretHash) {
      Object.assign(data.sessions.get(id), { consumed_at: now(), secret_sha256: secretHash, handoff_sha256: null });
    },
    async revokeSessions(linkId) {
      for (const row of data.sessions.values()) if (row.link_id === linkId && !row.revoked_at) row.revoked_at = now();
    },
    async idempotent(scope, keyHash) { return data.idempotency.get(`${scope}|${keyHash}`) || null; },
    async rememberIdempotent(scope, keyHash, requestHash, response) {
      const key = `${scope}|${keyHash}`;
      if (data.idempotency.has(key)) throw duplicate();
      data.idempotency.set(key, { scope, key_sha256: keyHash, request_sha256: requestHash, response, created_at: now() });
    }
  };
  return {
    data,
    async transaction(fn) {
      // The fake has no rollback; tests that rely on rollback semantics use the real MySQL harness. The
      // one path that matters here (grant burned only on commit) is asserted in the harness.
      return fn(tx);
    },
    async read(fn) { return fn(tx); }
  };
}

// A synthetic student project: pages are plain objects, the compiler is the real one.
function createSourceFixture({ ownerUserId = 101, projectId = 3, name = '校园节水网站' } = {}) {
  const HtmlPage = require('../../models/HtmlPage');
  const state = { project: { id: projectId, user_id: ownerUserId, name }, pages: [], deleted: false };
  const models = {
    HtmlProject: { findById: async id => (state.deleted || String(id) !== String(projectId) ? null : { ...state.project }) },
    HtmlPage: {
      compileContent: HtmlPage.compileContent.bind(HtmlPage),
      getUserPages: async (userId, pid) => ({ data: state.deleted ? [] : state.pages
        .filter(page => String(page.project_id) === String(pid) && String(page.user_id) === String(userId))
        .map(page => ({ ...page })) })
    }
  };
  return {
    state, models,
    // `saved: false` models the blank starter page the editor creates when a project is opened: it
    // exists, it has the platform template inside, and it was never saved by the student.
    addPage({ id, title = '首页', slug = 'home', html = '', updated_at = '2026-09-22T01:00:00Z', saved = true }) {
      const created = saved ? new Date(Date.parse(updated_at) - 60000).toISOString() : updated_at;
      state.pages.push({ id, project_id: projectId, user_id: ownerUserId, title, slug, html_content: html,
        css_content: '', js_content: '', updated_at, created_at: created, is_published: 0 });
      return state.pages[state.pages.length - 1];
    },
    edit(id, html, updated_at = '2026-09-22T05:00:00Z') {
      const page = state.pages.find(item => String(item.id) === String(id));
      Object.assign(page, { html_content: html, updated_at });
    },
    removePage(id) { state.pages = state.pages.filter(page => String(page.id) !== String(id)); },
    deleteProject() { state.deleted = true; }
  };
}

function createService({ ownerUserId = 101, studentUuid = 'edu-uuid-0001', sourceInstance = 'practice-lab',
  previewEnabled = true, now = Date.now } = {}) {
  const fixture = createSourceFixture({ ownerUserId });
  const store = createMemoryStore({ now });
  const user = { id: ownerUserId, uuid: studentUuid, uuid_source: 'sso', status: 'active', deleted_at: null,
    isAccountExpired: () => false };
  const models = { User: { findById: async id => (String(id) === String(ownerUserId) ? user : null) }, ...fixture.models };
  const reader = createSourceReader({ HtmlProject: models.HtmlProject, HtmlPage: models.HtmlPage, sourceInstance });
  const service = createWebsiteArtifactService({ store, reader, models, sourceInstance, previewEnabled, now });
  return { service, store, fixture, user, models, sourceInstance };
}

module.exports = { createMemoryStore, createSourceFixture, createService };

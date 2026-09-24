'use strict';

// In-memory stand-in for the P09 ledger. It implements exactly the transaction surface service.js uses,
// including the properties the real store guarantees: commit-ordered sequence numbers, unique
// constraints that raise a `duplicate` error, and a conditional single-use consumption. Used by the unit
// tests; the isolated harness runs the same service against real MySQL 8.
const { randomUUID } = require('node:crypto');
const { createSourceReader } = require('../../services/websiteArtifact/snapshot');
const { titleKey } = require('../../services/websiteArtifact/store');
const { createAssetResolver } = require('../../services/websiteArtifact/assets');
const { createWebsiteArtifactService } = require('../../services/websiteArtifact/service');

function createMemoryStore({ now = Date.now, projects = null } = {}) {
  const data = { refs: new Map(), links: new Map(), revisions: new Map(), files: new Map(), events: [],
    sessions: new Map(), idempotency: new Map(), seq: 0 };
  const duplicate = () => { const error = new Error('duplicate'); error.duplicate = true; return error; };
  const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  const active = row => row.state === 'active';
  const outstanding = row => row.sync_pending_at != null || Number(row.applied_write_seq || 0) < Number(row.write_seq || 0);

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
    // The real store reads the name on its own connection and keys it by owner+project; here the same
    // rule is applied to the fixture's project, including "the source is gone" answering with nothing.
    async sourceTitles(rows) {
      const out = new Map();
      if (!projects) return out;
      for (const row of rows || []) {
        const project = await projects(row.project_id);
        if (project && String(project.user_id) === String(row.owner_user_id) &&
            typeof project.name === 'string' && project.name.trim() !== '') {
          out.set(titleKey(project.user_id, project.id), project.name);
        }
      }
      return out;
    },
    async linkById(id) { return clone(data.links.get(id)) || null; },
    async linkByArtifact(instance, artifactRef) {
      return clone([...data.links.values()].find(row => row.source_instance === instance && row.artifact_ref === artifactRef)) || null;
    },
    async activeLinkForAssignment(instance, assignmentRef, ownerUserId) {
      const rows = [...data.links.values()].filter(row => row.source_instance === instance &&
        row.assignment_ref === assignmentRef && String(row.owner_user_id) === String(ownerUserId));
      return clone(rows.find(active) || rows.sort((a, b) => b.created_at - a.created_at)[0]) || null;
    },
    // One project answers one current assignment, whatever assignment that is.
    async activeLinkForProject(instance, projectId) {
      return clone([...data.links.values()].find(row => row.source_instance === instance &&
        String(row.project_id) === String(projectId) && active(row))) || null;
    },
    async linksForProject(instance, projectId) {
      return [...data.links.values()].filter(row => row.source_instance === instance &&
        String(row.project_id) === String(projectId) && active(row)).map(clone);
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
      const clash = [...data.links.values()].some(existing => active(existing) && existing.source_instance === row.source_instance &&
        ((existing.assignment_ref === row.assignment_ref && String(existing.owner_user_id) === String(row.owner_user_id)) ||
         String(existing.project_id) === String(row.project_id)));
      if (clash) throw duplicate();
      data.links.set(row.id, { ...row });
      return row;
    },
    async updateLink(id, patch) { Object.assign(data.links.get(id), patch, { updated_at: now() }); },
    // Durable markers for the reconciliation the editor's own request leaves behind.
    // One observed source write: the durable order a reconciliation compares against.
    async markLinkPending(id, at) {
      const row = data.links.get(id);
      if (!row || !active(row)) return;
      row.write_seq = Number(row.write_seq || 0) + 1;
      if (row.sync_pending_at == null) row.sync_pending_at = at;
    },
    async markPending(instance, projectId, at) {
      let marked = 0;
      for (const row of data.links.values()) {
        if (row.source_instance === instance && String(row.project_id) === String(projectId) && active(row)) {
          row.write_seq = Number(row.write_seq || 0) + 1;
          if (row.sync_pending_at == null) row.sync_pending_at = at;
          marked += 1;
        }
      }
      return marked;
    },
    async recordRealSave(id, at) {
      const row = data.links.get(id);
      if (!row || !active(row)) return;
      Object.assign(row, { real_save_count: Number(row.real_save_count || 0) + 1, last_real_save_at: at,
        save_evidence: 'observed', save_reason: 'observed_save', sync_pending_at: row.sync_pending_at ?? at });
    },
    async pendingLinks({ sourceInstance = null, schoolRef = null, limit = 50 } = {}) {
      return [...data.links.values()].filter(row => outstanding(row) && active(row) &&
        (!sourceInstance || row.source_instance === sourceInstance) && (!schoolRef || row.school_ref === schoolRef))
        .sort((a, b) => (a.sync_pending_at ?? 0) - (b.sync_pending_at ?? 0)).slice(0, limit).map(clone);
    },
    async staleLinks({ sourceInstance = null, schoolRef = null, olderThan, limit = 20 } = {}) {
      return [...data.links.values()].filter(row => active(row) && !outstanding(row) &&
        (row.reconciled_at == null || row.reconciled_at < olderThan) &&
        (!sourceInstance || row.source_instance === sourceInstance) && (!schoolRef || row.school_ref === schoolRef))
        .slice(0, limit).map(clone);
    },
    async clearPending(id, at, { error = null, attempts = null } = {}) {
      const row = data.links.get(id);
      if (!row) return;
      if (error) { Object.assign(row, { sync_attempts: Number(row.sync_attempts || 0) + 1, reconcile_error: String(error).slice(0, 32), reconciled_at: at }); return; }
      Object.assign(row, { sync_pending_at: null, sync_attempts: attempts ?? 0, reconcile_error: null, reconciled_at: at });
    },
    async pendingCount({ sourceInstance, schoolRef }) {
      return [...data.links.values()].filter(row => outstanding(row) && active(row) &&
        row.source_instance === sourceInstance && (!schoolRef || row.school_ref === schoolRef)).length;
    },
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
    async insertSession(row) { data.sessions.set(row.id, { ...row, access_count: 0 }); return row; },
    async sessionByHandoff(hash) { return [...data.sessions.values()].find(row => row.handoff_sha256 === hash) || null; },
    async sessionById(id) { return data.sessions.get(id) || null; },
    // Conditional, exactly like the real UPDATE: the first redeemer wins and the handoff stops existing.
    async consumeSession(id, secretHash, clientHash) {
      const row = data.sessions.get(id);
      if (!row || row.consumed_at || !row.handoff_sha256) return false;
      Object.assign(row, { consumed_at: now(), secret_sha256: secretHash, client_sha256: clientHash ?? null,
        consumed_client_sha256: clientHash ?? null, handoff_sha256: null });
      return true;
    },
    async touchSession(id, at) {
      const row = data.sessions.get(id);
      if (row) Object.assign(row, { last_access_at: at, access_count: Number(row.access_count || 0) + 1 });
    },
    async revokeSessions(linkId, reason = 'link_revoked') {
      for (const row of data.sessions.values()) if (row.link_id === linkId && !row.revoked_at) Object.assign(row, { revoked_at: now(), revoked_reason: reason });
    },
    async revokeSessionsForOwner(ownerUserId, at, reason) {
      for (const row of data.sessions.values()) {
        const link = data.links.get(row.link_id);
        if (link && String(link.owner_user_id) === String(ownerUserId) && !row.revoked_at) Object.assign(row, { revoked_at: at, revoked_reason: reason });
      }
    },
    async revokeSessionsForIssuer(issuerKey, at, reason) {
      for (const row of data.sessions.values()) if (row.issuer_key === issuerKey && !row.revoked_at) Object.assign(row, { revoked_at: at, revoked_reason: reason });
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
    // exists, it holds the platform template, and HtmlPage.update has never touched it (version 1).
    addPage({ id, title = '首页', slug = 'home', html = '', updated_at = '2026-09-22T01:00:00Z', saved = true, version = null }) {
      const created = saved ? new Date(Date.parse(updated_at) - 60000).toISOString() : updated_at;
      state.pages.push({ id, project_id: projectId, user_id: ownerUserId, title, slug, html_content: html,
        css_content: '', js_content: '', updated_at, created_at: created,
        version: version ?? (saved ? 2 : 1), is_published: 0 });
      return state.pages[state.pages.length - 1];
    },
    // A student save through the editor: the row is updated (version + 1) and the bytes change.
    edit(id, html, updated_at = '2026-09-22T05:00:00Z') {
      const page = state.pages.find(item => String(item.id) === String(id));
      Object.assign(page, { html_content: html, updated_at, version: Number(page.version || 1) + 1 });
    },
    // A rename: the row is updated, but no content is written.
    rename(id, title, updated_at = '2026-09-22T05:30:00Z') {
      const page = state.pages.find(item => String(item.id) === String(id));
      Object.assign(page, { title, updated_at, version: Number(page.version || 1) + 1 });
    },
    removePage(id) { state.pages = state.pages.filter(page => String(page.id) !== String(id)); },
    // The student renames the work itself. No content is written, so it is not a save.
    renameProject(name) { state.project = { ...state.project, name }; },
    deleteProject() { state.deleted = true; }
  };
}

// A real asset resolver over a temporary upload root, with a stubbed ownership lookup that answers the
// way the three real models would. The filesystem rules (containment, symlinks, size, type) are the
// module's own, so traversal and symlink refusals are exercised for real.
function createAssetFixture({ uploadRoot, owned = [] }) {
  const rows = owned.map(item => ({ table: item.table || 'files', user_id: item.user_id, key: item.key,
    local: item.local ?? item.key, storage_type: item.storage_type || 'local', project_id: item.project_id ?? null,
    status: item.status || 'ready', mime_type: item.mime_type || 'image/png' }));
  const query = async (sql, params) => {
    const table = /FROM\s+(\w+)/i.exec(sql)?.[1];
    const [userId, ...rest] = params;
    return rows.filter(row => row.table === table && String(row.user_id) === String(userId) &&
      rest.some(value => typeof value === 'string' &&
        (value === row.key || (value.startsWith('%') && row.key.endsWith(value.slice(1))))))
      .map(row => ({ id: 1, user_id: row.user_id, local_path: row.local, oss_key: row.local, storage_path: row.local,
        storage_type: row.storage_type, project_id: row.project_id, status: row.status, mime_type: row.mime_type, is_deleted: 0 }));
  };
  return createAssetResolver({ models: { query }, uploadRoot });
}

function createService({ ownerUserId = 101, studentUuid = 'edu-uuid-0001', sourceInstance = 'practice-lab',
  previewEnabled = true, now = Date.now, assets = null, eligibility = null, submitRelay = null,
  issuerActive = null } = {}) {
  const fixture = createSourceFixture({ ownerUserId });
  const store = createMemoryStore({ now, projects: id => fixture.models.HtmlProject.findById(id) });
  const user = { id: ownerUserId, uuid: studentUuid, uuid_source: 'sso', status: 'active', deleted_at: null,
    isAccountExpired: () => false };
  const models = { User: { findById: async id => (String(id) === String(ownerUserId) ? user : null) }, ...fixture.models };
  const resolver = assets ? createAssetFixture(assets) : null;
  const reader = createSourceReader({ HtmlProject: models.HtmlProject, HtmlPage: models.HtmlPage, sourceInstance, assets: resolver });
  const service = createWebsiteArtifactService({ store, reader, models, sourceInstance, previewEnabled, now,
    assets: resolver, eligibility, submitRelay, issuerActive });
  return { service, store, fixture, user, models, sourceInstance, resolver, reader };
}

module.exports = { createMemoryStore, createSourceFixture, createAssetFixture, createService };

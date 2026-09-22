// Barrier reproduction for the P09 reconciliation-ordering defects, against a REAL MySQL ledger.
//
// Real here: the ledger (mysql2 pool → WebsiteArtifactStore → the candidate schema applied by knex),
// the real service and the real snapshot reader. Synthetic here: the source project/pages (the same
// in-memory fixture the controller's probe used) and the user record — the race under test lives
// entirely in the ledger and the reconciliation order, not in the editor.
//
// Each barrier prints one JSON verdict. The script never decides "passed": it reports what happened and
// the wrapper compares it against what the dispatch requires.
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');
const mysql = require(path.join(ROOT, 'backend/node_modules/mysql2/promise'));
const { WebsiteArtifactStore } = require(path.join(ROOT, 'backend/src/services/websiteArtifact/store'));
const { createSourceReader } = require(path.join(ROOT, 'backend/src/services/websiteArtifact/snapshot'));
const { createWebsiteArtifactService } = require(path.join(ROOT, 'backend/src/services/websiteArtifact/service'));
const { createSourceFixture } = require(path.join(ROOT, 'backend/src/__tests__/helpers/p09Fixture'));
const { randomUUID } = require('node:crypto');

const SCOPE = { sourceInstance: 'practice-barrier', schoolRef: 'school-1' };
const read = () => new Promise(resolve => {
  let raw = '';
  process.stdin.on('data', chunk => { raw += chunk; }).on('end', () => resolve(JSON.parse(raw)));
});

// Each barrier gets its own project: one project answers one current assignment, so reusing project 3
// across barriers would (correctly) be refused by the ledger.
async function build(connection, { previewEnabled = false, projectId = 3 } = {}) {
  const pool = mysql.createPool({ ...connection, connectionLimit: 8, charset: 'utf8mb4', decimalNumbers: true });
  const store = new WebsiteArtifactStore({ pool });
  const fixture = createSourceFixture({ ownerUserId: 101, projectId });
  const user = { id: 101, uuid: 'edu-uuid-0001', uuid_source: 'sso', status: 'active', deleted_at: null, isAccountExpired: () => false };
  const models = { User: { findById: async id => (String(id) === '101' ? user : null) }, ...fixture.models };
  const reader = createSourceReader({ HtmlProject: models.HtmlProject, HtmlPage: models.HtmlPage, sourceInstance: SCOPE.sourceInstance });
  const service = createWebsiteArtifactService({ store, reader, models, sourceInstance: SCOPE.sourceInstance, previewEnabled });
  return { pool, store, fixture, reader, service, projectId };
}
const grantFor = assignment => ({ issuer: 'edu', keyId: 'k1', grantId: randomUUID(), purpose: 'website_artifact_link',
  subjectUuid: 'edu-uuid-0001', assignmentRef: assignment, schoolRef: SCOPE.schoolRef, lessonRef: null });

// A gate around the reader: the next source read stops after taking its snapshot and resumes on release.
function gateReader(context) {
  const original = context.reader.load.bind(context.reader);
  let armed = false;
  let ready;
  let release;
  const hit = new Promise(resolve => { ready = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  context.reader.load = async (...args) => {
    const snapshot = await original(...args);
    if (armed) { armed = false; ready(); await gate; }
    return snapshot;
  };
  return { arm: () => { armed = true; }, hit, release: () => release(), restore: () => { context.reader.load = original; } };
}
const linkRow = async (context, id) => context.store.read(tx => tx.linkById(id));
// What the projection would have to hold to be current with the source right now.
async function sourceDigest(context, row) {
  const snapshot = await context.reader.load(row.owner_user_id, row.project_id);
  return context.reader.facts(snapshot).content_digest;
}

// Barrier 1: a reconciliation that read B commits after a newer save C was already reconciled.
async function lateReconcile(connection) {
  const context = await build(connection, { projectId: 3 });
  try {
    context.fixture.addPage({ id: 7, html: '<p>initial</p>', saved: false });
    const { link } = await context.service.link({ ownerUserId: 101, grant: grantFor('assign-1'), projectId: context.projectId, entryPageId: 7 });
    const id = (await context.service.ownerLinks(101))[0].link_id;
    context.fixture.edit(7, '<p>A</p>');
    await context.service.noteSourceChange({ ownerUserId: 101, projectId: context.projectId, contentSave: true });

    const gate = gateReader(context);
    gate.arm();
    context.fixture.edit(7, '<p>B</p>');
    await context.service.recordSourceWrite({ ownerUserId: 101, projectId: context.projectId, contentSave: true });
    const slow = context.service.reconcileLink(id).catch(error => ({ error: error.code || String(error.message) }));
    await gate.hit;                                   // the stale reconciliation now holds a B snapshot
    context.fixture.edit(7, '<p>C</p>');
    await context.service.noteSourceChange({ ownerUserId: 101, projectId: context.projectId, contentSave: true });
    const afterC = await linkRow(context, id);
    gate.release();
    const slowResult = await slow;
    gate.restore();

    const afterStale = await linkRow(context, id);
    const live = await sourceDigest(context, afterStale);
    const state = await context.service.state(SCOPE);
    const item = state.items.find(entry => entry.artifact_ref === link.artifact_ref);
    return {
      barrier: 'late_reconcile_overwrites_newer',
      stale_result: slowResult && slowResult.skipped ? slowResult : (Array.isArray(slowResult) ? 'applied' : slowResult),
      projection_went_backwards: afterStale.content_digest !== afterC.content_digest,
      projection_matches_source: afterStale.content_digest === live,
      digest_after_c: afterC.content_digest.slice(0, 12), digest_after_stale: afterStale.content_digest.slice(0, 12),
      change_no_after_c: Number(afterC.change_no), change_no_after_stale: Number(afterStale.change_no),
      pending_after_stale: afterStale.sync_pending_at === null ? null : Number(afterStale.sync_pending_at),
      state_complete: state.complete, state_pending: state.pending_reconcile,
      item_pending: item ? item.pending_reconcile : null,
      source_now: context.fixture.state.pages[0].html_content
    };
  } finally { await context.pool.end().catch(() => {}); }
}

// Barrier 2: the stale worker must not clear a marker it never covered.
async function staleWorkerClearsMarker(connection) {
  const context = await build(connection, { projectId: 4 });
  try {
    context.fixture.addPage({ id: 7, html: '<p>initial</p>', saved: false });
    await context.service.link({ ownerUserId: 101, grant: grantFor('assign-2'), projectId: context.projectId, entryPageId: 7 });
    const id = (await context.service.ownerLinks(101))[0].link_id;
    context.fixture.edit(7, '<p>A</p>');
    await context.service.noteSourceChange({ ownerUserId: 101, projectId: context.projectId, contentSave: true });

    const gate = gateReader(context);
    gate.arm();
    context.fixture.edit(7, '<p>B</p>');
    await context.service.recordSourceWrite({ ownerUserId: 101, projectId: context.projectId, contentSave: true });
    const slow = context.service.reconcileLink(id).catch(error => ({ error: error.code || String(error.message) }));
    await gate.hit;
    // A newer save lands while the stale reconciliation is still holding its snapshot — its marker is
    // written but nothing has reconciled it yet.
    context.fixture.edit(7, '<p>C</p>');
    await context.service.recordSourceWrite({ ownerUserId: 101, projectId: context.projectId, contentSave: true });
    gate.release();
    await slow;
    gate.restore();

    const afterStale = await linkRow(context, id);
    const live = await sourceDigest(context, afterStale);
    const beforeSweep = { digest: afterStale.content_digest, matches_source: afterStale.content_digest === live,
      marker: afterStale.sync_pending_at === null ? null : Number(afterStale.sync_pending_at),
      unprojected_writes: Number(afterStale.write_seq || 0) - Number(afterStale.applied_write_seq || 0) };
    // An edu read at this moment must not answer "complete" while behind: it either catches the work
    // up first (its read-time sweep) or reports it outstanding. Both are recorded.
    const stateBefore = await context.service.state(SCOPE);
    const sweep = await context.service.sweep({ schoolRef: SCOPE.schoolRef, verify: false });
    const afterSweep = await linkRow(context, id);
    const state = await context.service.state(SCOPE);
    return {
      barrier: 'stale_worker_clears_newer_marker',
      before_sweep: beforeSweep,
      read_caught_up_before_answering: stateBefore.complete,
      read_reported_pending: stateBefore.pending_reconcile,
      swept: sweep.swept,
      projection_matches_source_after_sweep: afterSweep.content_digest === live,
      marker_after_sweep: afterSweep.sync_pending_at === null ? null : Number(afterSweep.sync_pending_at),
      state_complete: state.complete, state_pending: state.pending_reconcile,
      source_now: context.fixture.state.pages[0].html_content
    };
  } finally { await context.pool.end().catch(() => {}); }
}

// Barrier 3: a save lands between the read-time sweep and the read itself.
async function saveBetweenSweepAndRead(connection) {
  const context = await build(connection, { projectId: 5 });
  try {
    context.fixture.addPage({ id: 7, html: '<p>initial</p>', saved: false });
    await context.service.link({ ownerUserId: 101, grant: grantFor('assign-3'), projectId: context.projectId, entryPageId: 7 });
    const id = (await context.service.ownerLinks(101))[0].link_id;
    context.fixture.edit(7, '<p>A</p>');
    await context.service.noteSourceChange({ ownerUserId: 101, projectId: context.projectId, contentSave: true });

    // The barrier: the first watermark read inside state() is where the snapshot begins.
    const originalRead = context.store.read.bind(context.store);
    let armed = true;
    context.store.read = async fn => originalRead(async tx => {
      if (armed && typeof tx.watermark === 'function') {
        const watermark = tx.watermark.bind(tx);
        tx.watermark = async () => {
          armed = false;
          tx.watermark = watermark;                    // fire exactly once, even on a shared transaction
          context.fixture.edit(7, '<p>D</p>');
          await context.service.recordSourceWrite({ ownerUserId: 101, projectId: context.projectId, contentSave: true });
          return watermark();
        };
      }
      return fn(tx);
    });
    const originalTx = context.store.transaction.bind(context.store);
    context.store.transaction = async fn => originalTx(async tx => {
      if (armed && typeof tx.watermark === 'function') {
        const watermark = tx.watermark.bind(tx);
        tx.watermark = async () => {
          armed = false;
          tx.watermark = watermark;                    // fire exactly once, even on a shared transaction
          context.fixture.edit(7, '<p>D</p>');
          await context.service.recordSourceWrite({ ownerUserId: 101, projectId: context.projectId, contentSave: true });
          return watermark();
        };
      }
      return fn(tx);
    });
    const state = await context.service.state(SCOPE);
    context.store.read = originalRead;
    context.store.transaction = originalTx;
    const row = await linkRow(context, id);
    // Several barriers share this school scope, so the verdict must look at this work's own row.
    const mine = state.items.find(entry => entry.artifact_ref === row.artifact_ref);
    return {
      barrier: 'save_between_sweep_and_read',
      state_complete: state.complete, state_pending: state.pending_reconcile,
      item_pending: mine ? mine.pending_reconcile : null,
      item_unprojected_writes: mine ? mine.unprojected_writes : null,
      marker_in_ledger: row.sync_pending_at === null ? null : Number(row.sync_pending_at),
      unprojected_writes: Number(row.write_seq || 0) - Number(row.applied_write_seq || 0),
      settled_complete: (await context.service.state(SCOPE)).complete,
      watermark: state.watermark, source_now: context.fixture.state.pages[0].html_content
    };
  } finally { await context.pool.end().catch(() => {}); }
}

// Barrier 4: the honest limit of per-save history — A→B→A merged before any reconciliation.
async function mergedChangesBeforeReconcile(connection) {
  const context = await build(connection, { projectId: 6 });
  try {
    context.fixture.addPage({ id: 7, html: '<p>A</p>', saved: false });
    await context.service.link({ ownerUserId: 101, grant: grantFor('assign-4'), projectId: context.projectId, entryPageId: 7 });
    const id = (await context.service.ownerLinks(101))[0].link_id;
    for (const html of ['<p>A</p>', '<p>B</p>', '<p>A</p>']) {         // three real saves, no reconcile
      context.fixture.edit(7, html);
      await context.service.recordSourceWrite({ ownerUserId: 101, projectId: context.projectId, contentSave: true });
    }
    await context.service.reconcileLink(id);
    const row = await linkRow(context, id);
    const events = await context.service.events(SCOPE, { limit: 500 });
    const mine = events.facts.filter(fact => fact.artifact && fact.artifact.artifact_ref === row.artifact_ref);
    return {
      barrier: 'merged_changes_before_reconcile',
      real_save_count: Number(row.real_save_count), change_no: Number(row.change_no),
      write_seq: Number(row.write_seq), applied_write_seq: Number(row.applied_write_seq),
      updated_events: mine.filter(fact => fact.type === 'artifact.updated').length,
      note: 'per-save history is the durable save counters; content events are per reconciled change'
    };
  } finally { await context.pool.end().catch(() => {}); }
}

(async () => {
  const input = await read();
  const barriers = { late_reconcile: lateReconcile, stale_marker: staleWorkerClearsMarker,
    sweep_read: saveBetweenSweepAndRead, merged: mergedChangesBeforeReconcile };
  const out = [];
  for (const name of input.barriers || Object.keys(barriers)) {
    try { out.push(await barriers[name](input.connection)); }
    catch (error) { out.push({ barrier: name, failed: String(error && (error.code || error.message)).slice(0, 200) }); }
  }
  process.stdout.write(JSON.stringify(out, null, 2));
})().catch(error => { process.stderr.write(String(error && error.stack).slice(0, 2000)); process.exitCode = 1; });

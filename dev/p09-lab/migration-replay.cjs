// Helper for the 002 migration replay checks: runs the real migration function against a real MySQL
// database, and (for the last case) runs the real service sweep so the outstanding work a conservative
// migration leaves behind is shown to be cleared by business reconciliation rather than by the migration.
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');
const knexFactory = require(path.join(ROOT, 'backend/node_modules/knex'));
const mysql = require(path.join(ROOT, 'backend/node_modules/mysql2/promise'));
const MIGRATION = path.join(ROOT, 'backend/migrations-candidates/p09/20260922_002_p09_write_sequence.js');

const read = () => new Promise(resolve => {
  let raw = '';
  process.stdin.on('data', chunk => { raw += chunk; }).on('end', () => resolve(JSON.parse(raw)));
});
const connect = connection => knexFactory({ client: 'mysql2',
  connection: { ...connection, charset: 'utf8mb4' }, pool: { min: 0, max: 3 } });

// The migration's own up/down, called exactly as knex would call it.
async function migrate(connection, direction) {
  const knex = connect(connection);
  const migration = require(MIGRATION);
  try {
    await migration[direction](knex);
    return { ran: direction };
  } catch (error) {
    return { ran: direction, refused: String(error && (error.code || error.message)).slice(0, 200) };
  } finally { await knex.destroy(); }
}

// One real sweep by the real service, against this ledger and a synthetic source project.
async function sweep(connection, { sourceInstance, schoolRef, ownerUserId, projectId, entryPageId, html }) {
  const { WebsiteArtifactStore } = require(path.join(ROOT, 'backend/src/services/websiteArtifact/store'));
  const { createSourceReader } = require(path.join(ROOT, 'backend/src/services/websiteArtifact/snapshot'));
  const { createWebsiteArtifactService } = require(path.join(ROOT, 'backend/src/services/websiteArtifact/service'));
  const { createSourceFixture } = require(path.join(ROOT, 'backend/src/__tests__/helpers/p09Fixture'));
  const pool = mysql.createPool({ ...connection, connectionLimit: 4, charset: 'utf8mb4', decimalNumbers: true });
  const store = new WebsiteArtifactStore({ pool });
  const fixture = createSourceFixture({ ownerUserId, projectId });
  fixture.addPage({ id: entryPageId, html, saved: true });
  const user = { id: ownerUserId, uuid: 'edu-uuid-0001', uuid_source: 'sso', status: 'active', deleted_at: null, isAccountExpired: () => false };
  const models = { User: { findById: async () => user }, ...fixture.models };
  const reader = createSourceReader({ HtmlProject: models.HtmlProject, HtmlPage: models.HtmlPage, sourceInstance });
  const service = createWebsiteArtifactService({ store, reader, models, sourceInstance });
  try {
    const result = await service.sweep({ schoolRef, verify: false });
    const state = await service.state({ sourceInstance, schoolRef });
    return { sweep: result, complete: state.complete, pending_reconcile: state.pending_reconcile,
      items: state.items.map(item => ({ observed_writes: item.observed_writes, unprojected_writes: item.unprojected_writes,
        pending_reconcile: item.pending_reconcile, work_state: item.work_state })) };
  } finally { await pool.end().catch(() => {}); }
}

// Creates one real link through the real service, so the sweep case starts from a genuine row.
async function seedLink(connection, { sourceInstance, schoolRef, ownerUserId, projectId, entryPageId, html, assignmentRef }) {
  const { WebsiteArtifactStore } = require(path.join(ROOT, 'backend/src/services/websiteArtifact/store'));
  const { createSourceReader } = require(path.join(ROOT, 'backend/src/services/websiteArtifact/snapshot'));
  const { createWebsiteArtifactService } = require(path.join(ROOT, 'backend/src/services/websiteArtifact/service'));
  const { createSourceFixture } = require(path.join(ROOT, 'backend/src/__tests__/helpers/p09Fixture'));
  const { randomUUID } = require('node:crypto');
  const pool = mysql.createPool({ ...connection, connectionLimit: 4, charset: 'utf8mb4', decimalNumbers: true });
  const store = new WebsiteArtifactStore({ pool });
  const fixture = createSourceFixture({ ownerUserId, projectId });
  fixture.addPage({ id: entryPageId, html: '<p>start</p>', saved: false });
  const user = { id: ownerUserId, uuid: 'edu-uuid-0001', uuid_source: 'sso', status: 'active', deleted_at: null, isAccountExpired: () => false };
  const models = { User: { findById: async () => user }, ...fixture.models };
  const reader = createSourceReader({ HtmlProject: models.HtmlProject, HtmlPage: models.HtmlPage, sourceInstance });
  const service = createWebsiteArtifactService({ store, reader, models, sourceInstance });
  try {
    const grant = { issuer: 'edu', keyId: 'k1', grantId: randomUUID(), purpose: 'website_artifact_link',
      subjectUuid: 'edu-uuid-0001', assignmentRef, schoolRef, lessonRef: null };
    const { link } = await service.link({ ownerUserId, grant, projectId, entryPageId });
    fixture.edit(entryPageId, html);
    await service.noteSourceChange({ ownerUserId, projectId, contentSave: true });
    return { artifact_ref: link.artifact_ref };
  } finally { await pool.end().catch(() => {}); }
}

(async () => {
  const input = await read();
  const handlers = { up: () => migrate(input.connection, 'up'), down: () => migrate(input.connection, 'down'),
    sweep: () => sweep(input.connection, input.work), seed: () => seedLink(input.connection, input.work) };
  process.stdout.write(JSON.stringify(await handlers[input.op]()));
})().catch(error => { process.stderr.write(String(error && error.stack).slice(0, 2000)); process.exitCode = 1; });

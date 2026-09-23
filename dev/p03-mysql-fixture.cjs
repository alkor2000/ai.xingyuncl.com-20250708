// Synthetic source facts on an isolated MySQL 8 database only. Not a production migration, native
// teacher policy or application model replacement. The candidate DDL and the restricted-role grant
// statements come from the store module itself; only the lab facts table and the lab user are local.
const mysql = require('../backend/node_modules/mysql2/promise');
const fs = require('fs/promises');
const path = require('path');
const { fixture, ids } = require('../backend/src/__tests__/helpers/p03Fixture');
const { createSourceAdapter, fail } = require('../backend/src/services/artifactHandoff/source');
const { MySQLHandoffStore, SCHEMA, TABLES, restrictedRoleGrants } = require('../backend/src/services/artifactHandoff/mysqlStore');
const { I03DraftSource } = require('../backend/src/services/artifactHandoff/i03Source');
const OWNERS = ['p-teacher', 'p-other'];
const FACTS = `CREATE TABLE p03_lab_facts(owner VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, facts JSON NOT NULL) ENGINE=InnoDB`;
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
const connect = (config, user, password) => mysql.createPool({ host: config.host, port: config.port, user, password,
  database: config.database, connectionLimit: 12, charset: 'utf8mb4', connectTimeout: 5000 });
async function mysqlFixture(config, client, now, owner = 'p-teacher', options = {}) {
  if (config.host !== '127.0.0.1' || !/^p03_lab_[a-f0-9]{12}$/.test(config.database) || !/^p03_app_[a-f0-9]{12}$/.test(config.app_user) ||
      typeof config.app_password !== 'string' || config.app_password.length < 16 || !OWNERS.includes(owner)) fail('invalid_draft_configuration');
  // The lab pool stands for the business application (source-fact mutations, seeding, probes);
  // the app pool is the restricted P03 role the store itself runs under.
  const lab = connect(config, config.user, config.password);
  if (config.initialize) {
    for (const ddl of [...SCHEMA, FACTS]) await lab.query(ddl);
    await lab.query(`CREATE USER ?@'%' IDENTIFIED BY ?`, [config.app_user, config.app_password]);
    for (const grant of restrictedRoleGrants({ database: config.database, user: config.app_user, host: '%', sourceTables: ['p03_lab_facts'] })) await lab.query(grant);
    for (const who of OWNERS) {
      const seed = await fixture(path.join(config.directory, who), now);
      seed.conversations[ids.conversation].user_id = who;
      Object.values(seed.files).forEach(file => { file.user_id = who; });
      await lab.execute('INSERT INTO p03_lab_facts VALUES(?,?)', [who, JSON.stringify({ active: true, eligible: true, copy: true,
        messages: seed.messages, conversations: seed.conversations, files: seed.files })]);
    }
  }
  const pool = connect(config, config.app_user, config.app_password);
  const store = new MySQLHandoffStore({ pool, now });
  async function facts() {
    const [[row]] = await store.query('SELECT facts FROM p03_lab_facts WHERE owner=?', [owner]);
    if (!row) fail('subject_disabled', 403);
    return parse(row.facts);
  }
  const authority = {
    async checkSubject(who) {
      const f = await facts();
      if (String(who) !== owner || !f.active) fail('subject_disabled', 403);
      if (!f.eligible) fail('subject_not_eligible', 403);
    },
    async checkExport(who, id) {
      await authority.checkSubject(who);
      if (!(await facts()).copy || id !== ids.message) fail('source_permission_revoked', 403);
    },
    // Source checks and release share the owner's anchor row lock with every business-side mutation below.
    async withSourceLock(who, id, fn) {
      if (who !== owner || id !== ids.message) fail('source_unavailable', 404);
      return store.withOwnerLock(owner, fn);
    },
    async checkReconciler(actor) { if (actor !== 'ops-reconciler') fail('subject_not_eligible', 403); }
  };
  const source = createSourceAdapter({
    Message: { findById: async id => (await facts()).messages[id] },
    Conversation: { findById: async id => (await facts()).conversations[id] },
    File: { findById: async id => (await facts()).files[id] }, uploadRoot: path.join(config.directory, owner, 'uploads')
  });
  const service = new I03DraftSource({ source, store, authority, client, now, ...options,
    sourceInstance: 'practice-synthetic', targetInstance: 'tedna-synthetic', env: { NODE_ENV: 'test' } });
  // Business-side mutation (revocation, edit, deletion, deactivation) on the lab pool: it takes the same
  // anchor row lock the store uses, which is what a production mutation path must do to be ordered.
  async function mutate(kind, hold = 0, onLocked = () => {}) {
    const connection = await lab.getConnection();
    try {
      await connection.query('SET SESSION innodb_lock_wait_timeout = 10');
      await connection.beginTransaction();
      await connection.execute(`INSERT INTO ${TABLES.owners}(owner,created_at) VALUES(?,?) ON DUPLICATE KEY UPDATE owner=owner`, [owner, now()]);
      await connection.execute(`SELECT owner FROM ${TABLES.owners} WHERE owner=? FOR UPDATE`, [owner]);
      const [[row]] = await connection.execute('SELECT facts FROM p03_lab_facts WHERE owner=?', [owner]);
      const f = parse(row.facts);
      if (kind === 'revoke') f.copy = false;
      else if (kind === 'version') f.messages[ids.message].content += '\nmodified';
      else if (kind === 'attachment') await fs.unlink(f.files[ids.file].file_path);
      else if (kind === 'disable') f.active = false;
      else fail('invalid_request');
      await connection.execute('UPDATE p03_lab_facts SET facts=? WHERE owner=?', [JSON.stringify(f), owner]);
      onLocked();
      if (hold > 0) await new Promise(resolve => setTimeout(resolve, Math.min(hold, 1000)));
      await connection.commit();
    } catch (error) { try { await connection.rollback(); } catch { connection.destroy(); } throw error; }
    finally { connection.release(); }
  }
  async function selection() {
    const current = await source.load(owner, ids.message), file = await source.attachment(owner, ids.file);
    const start = current.text.indexOf('先观察'), end = start + '先观察，再记录两杯水的变化。'.length;
    return { schema_version: 1, message_id: ids.message, expected_version: current.version,
      selection: { start, end }, attachments: [{ source_id: ids.file, expected_version: file.version }], purpose: 'lesson_preparation' };
  }
  return { pool, lab, store, service, source, authority, owner, selection, mutate, facts };
}
module.exports = { mysqlFixture, OWNERS };

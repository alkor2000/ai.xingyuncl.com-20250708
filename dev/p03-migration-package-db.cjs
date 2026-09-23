// Worker for p03-migration-package-check.py. Only the owned disposable database named on stdin.
// Does not load app/server, dotenv, model adapters or another repository's code.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const backend = createRequire(path.join(root, 'backend/package.json'));
const mysql = backend('mysql2/promise'), knexFactory = backend('knex');
const pkg = require('../backend/scripts/p03-migration-package.cjs');
const runtime = require('../backend/src/services/artifactHandoff/formalRuntime');
const original = require(path.join(root, pkg.CANDIDATE));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const errorCode = code => error => error.code === code;
async function main() {
  const c = JSON.parse(fs.readFileSync(0, 'utf8'));
  assert.equal(c.host, '127.0.0.1');
  assert.match(c.database, /^p03_pkg_[0-9a-f]{12}$/);
  assert(Number.isInteger(c.port) && c.port > 0 && c.port <= 65535);
  const staging = pkg.assemble({ writeStaging: true });
  const stage = staging.staging_directory;
  const report = { status: 'failed', input_commit: pkg.INPUT_COMMIT, staging, steps: [], production: false, real_user_data: false };
  const step = (name, facts = {}) => report.steps.push({ name, passed: true, ...facts });
  const clients = [];
  const connect = database => ({ host: c.host, port: c.port, user: 'root', password: c.password, database, charset: 'utf8mb4' });
  const poolFor = (database, user = 'root', password = c.password) => {
    const p = mysql.createPool({ ...connect(database), user, password, connectionLimit: 4 }); clients.push(() => p.end()); return p;
  };
  const database = c.database, reference = database + '_original', partial = database + '_partial';
  const admin = poolFor();
  try {
    pkg.verifyStaging(stage);
    const assembled = require(path.join(stage, pkg.MIGRATION));
    const { SCHEMA, TABLES, MySQLHandoffStore, restrictedRoleGrants } = require(path.join(stage, pkg.STORE));
    const names = Object.values(TABLES);
    for (const db of [database, reference, partial]) await admin.query(`CREATE DATABASE \`${db}\` CHARACTER SET utf8mb4`);
    const pool = poolFor(database), ref = poolFor(reference), part = poolFor(partial);
    await pool.query('CREATE TABLE business_sentinel(id INT PRIMARY KEY, value VARCHAR(30))');
    await pool.query("INSERT INTO business_sentinel VALUES(1,'synthetic-only')");
    const knex = knexFactory({ client: 'mysql2', connection: connect(database), migrations: { directory: path.join(stage, 'backend/migrations') } });
    clients.push(() => knex.destroy());
    const tableNames = async p => (await p.query('SHOW TABLES'))[0].map(r => Object.values(r)[0]).sort();
    const schemas = async p => Promise.all(names.map(async name => (await p.query(`SHOW CREATE TABLE \`${name}\``))[0][0]['Create Table']));
    const rows = async () => {
      const result = {};
      for (const name of ['business_sentinel', ...names]) result[name] = (await pool.query(`SELECT * FROM \`${name}\` ORDER BY 1,2`))[0];
      return result;
    };
    const [, pending] = await knex.migrate.list();
    assert.deepEqual(pending.map(p => p.file), [path.basename(pkg.MIGRATION)]);
    const [, applied] = await knex.migrate.latest();
    assert.deepEqual(applied, [path.basename(pkg.MIGRATION)]);
    await original.up({ raw: sql => ref.query(sql) });
    const shape = await schemas(pool);
    assert.deepEqual(await schemas(ref), shape);
    assert.deepEqual(await tableNames(pool), [...names, 'business_sentinel', 'knex_migrations', 'knex_migrations_lock'].sort());
    step('knex_up_and_original_layout_equivalence', { applied, table_count: names.length, schema_sha256: sha(JSON.stringify(shape)) });

    const rolePassword = randomBytes(24).toString('base64url');
    // '%' is local to this disposable server, exposed only on a random loopback port. Never a production GRANT.
    for (const user of ['p03_pkg_role', 'p03_pkg_partial', 'p03_pkg_broad']) await admin.query(`CREATE USER '${user}'@'%' IDENTIFIED BY ?`, [rolePassword]);
    for (const sql of restrictedRoleGrants({ database, user: 'p03_pkg_role', host: '%' })) await admin.query(sql);
    for (const sql of restrictedRoleGrants({ database, user: 'p03_pkg_partial', host: '%' }).slice(0, -1)) await admin.query(sql);
    await admin.query(`GRANT ALL PRIVILEGES ON \`${database}\`.* TO 'p03_pkg_broad'@'%'`);
    const role = poolFor(database, 'p03_pkg_role', rolePassword);
    const ready = await runtime.probeLedger(role, database);
    assert.equal(ready.grant_count, 5);
    await assert.rejects(runtime.probeLedger(poolFor(database, 'p03_pkg_partial', rolePassword), database), errorCode('handoff_ledger_role_missing'));
    await assert.rejects(runtime.probeLedger(poolFor(database, 'p03_pkg_broad', rolePassword), database), errorCode('handoff_ledger_role_too_broad'));
    await assert.rejects(runtime.probeLedger(role, reference), errorCode('handoff_ledger_database_mismatch'));
    for (const sql of ['CREATE TABLE forbidden_probe(id INT)', `ALTER TABLE ${TABLES.owners} ADD COLUMN forbidden_probe INT`, `DROP TABLE ${TABLES.keys}`, 'SELECT * FROM business_sentinel', "GRANT ALL ON *.* TO 'p03_pkg_role'@'%'"]) {
      await assert.rejects(role.query(sql), error => /ACCESS_DENIED/.test(error.code));
    }
    step('restricted_role_and_rejection_gates', { mysql_version: ready.mysql_version, grant_count: ready.grant_count, denied_operations: 5 });

    let clock = 2000000000000;
    const store = new MySQLHandoffStore({ pool: role, now: () => clock });
    const owner = 'synthetic-teacher', id = randomUUID(), key = 'a'.repeat(64);
    const record = { id, owner, choice: 'b'.repeat(64), status: 'ready', expires_at: clock + 1000, recovery_until: clock + 10000, hold: false };
    await store.transaction(owner, state => {
      state.operations[id] = record;
      state.snapshots[id] = { id, expires_at: clock + 1000, text: 'synthetic selected text' };
      state.keys[key] = { operation_id: id, expires_at: clock + 10000 };
    }, { create: true });
    const before = await rows();
    assert.deepEqual((await knex.migrate.latest())[1], []);
    await assembled.up(knex); await original.up({ raw: sql => pool.query(sql) });
    assert.deepEqual(await rows(), before);
    assert.deepEqual(await schemas(pool), shape);
    step('repeat_up_preserves_existing_ledger_and_business_rows');
    const restarted = new MySQLHandoffStore({ pool: role, now: () => clock });
    assert.equal((await restarted.transaction(owner, s => s.operations[id])).id, id);
    await assert.rejects(restarted.transaction(owner, s => { s.operations[id].choice = 'c'.repeat(64); }), errorCode('binding_mismatch'));
    await assert.rejects(restarted.transaction(owner, s => { s.snapshots[id].text = 'changed'; }), errorCode('binding_mismatch'));
    assert.deepEqual(await rows(), before);
    clock += 2000;
    await restarted.cleanup();
    assert.equal((await role.query(`SELECT COUNT(*) n FROM ${TABLES.snapshots}`))[0][0].n, 0);
    assert.equal((await role.query(`SELECT COUNT(*) n FROM ${TABLES.operations}`))[0][0].n, 1);
    assert.equal((await role.query(`SELECT COUNT(*) n FROM ${TABLES.keys}`))[0][0].n, 1);
    await restarted.transaction(owner, s => { s.operations[id].hold = true; });
    clock += 10000;
    await restarted.cleanup();
    assert.equal((await role.query(`SELECT COUNT(*) n FROM ${TABLES.operations}`))[0][0].n, 1);
    assert.equal((await role.query(`SELECT COUNT(*) n FROM ${TABLES.keys}`))[0][0].n, 0);
    await restarted.transaction(owner, s => { s.operations[id].hold = false; });
    await restarted.cleanup();
    assert.equal((await role.query(`SELECT COUNT(*) n FROM ${TABLES.operations}`))[0][0].n, 0);
    step('immutable_snapshot_reopen_and_retention', { snapshot_expires: true, recovery_retains_operation: true, hold_retains_operation: true, release_allows_cleanup: true });

    await part.query(SCHEMA[0]);
    await assembled.up({ raw: sql => part.query(sql) });
    assert.deepEqual(await schemas(part), shape);
    step('partial_existing_schema_completed');
    await pool.query(`DROP TABLE ${TABLES.keys}`);
    await assert.rejects(runtime.probeLedger(role, database), errorCode('handoff_ledger_table_missing'));
    await assembled.up(knex);
    assert.equal((await runtime.probeLedger(role, database)).grant_count, 5);
    step('missing_table_refused_then_additive_up_recovers');

    const [, rolledBack] = await knex.migrate.rollback();
    assert.deepEqual(rolledBack, [path.basename(pkg.MIGRATION)]);
    assert.deepEqual(await tableNames(pool), ['business_sentinel', 'knex_migrations', 'knex_migrations_lock']);
    assert.deepEqual((await pool.query('SELECT * FROM business_sentinel'))[0], [{ id: 1, value: 'synthetic-only' }]);
    await knex.migrate.latest();
    assert.deepEqual(await schemas(pool), shape);
    step('down_removes_only_ledger_and_reup_restores_schema');

    let poolCalls = 0;
    const disabled = await runtime.createFormalHandoffRuntime({ env: {}, deps: { createPool: () => { poolCalls++; throw Error('unexpected_pool'); } } });
    assert.equal(disabled.enabled, false); assert.equal(poolCalls, 0);
    assert.throws(() => pkg.plan({ targetInstance: 'xingyun-ai-platform-prod' }), errorCode('p03_package_target_not_allowed'));
    assert.equal(fs.existsSync(path.join(root, pkg.MIGRATION)), false);
    step('default_off_no_pool_and_pku_only_package');
    report.status = 'passed';
  } finally {
    await Promise.all(clients.map(close => close().catch(() => {})));
    fs.rmSync(stage, { recursive: true, force: true });
    report.staging_removed = true;
    console.log(JSON.stringify(report));
  }
}
main().catch(error => { console.error(JSON.stringify({ code: error.code || 'p03_package_lab_failed' })); process.exitCode = 1; });

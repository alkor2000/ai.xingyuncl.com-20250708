// Private stdin-only process harness; credentials never enter argv, logs or evidence.
const readline = require('readline');
const { randomUUID, randomBytes } = require('crypto');
const { mysqlFixture } = require('./p03-mysql-fixture.cjs');
const { I03DraftClient } = require('../backend/src/services/artifactHandoff/i03Client');
const { HandoffError, fail, digest } = require('../backend/src/services/artifactHandoff/source');
const { TABLES } = require('../backend/src/services/artifactHandoff/mysqlStore');
let fixture, now, afterPrepare, cleanupStop, cleanupErrors = 0;
const DENIED = new Set(['ER_TABLEACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR', 'ER_SPECIFIC_ACCESS_DENIED_ERROR', 'ER_ACCESS_DENIED_ERROR', 'ER_COLUMNACCESS_DENIED_ERROR', 'ER_KILL_DENIED_ERROR', 'ER_PROCACCESS_DENIED_ERROR']);
async function run(r) {
  if (Number.isSafeInteger(r.now)) now = r.now;
  if (r.command === 'init') {
    if (fixture) fail('invalid_request');
    const auth = r.authorization;
    const client = new I03DraftClient({ identityOrigin: r.identityOrigin, targetOrigin: r.targetOrigin,
      getAuthorization: async () => auth, now: () => now, env: { NODE_ENV: 'test' } });
    const send = client.send.bind(client);
    client.send = async (...args) => {
      const result = await send(...args);
      if (args[2] === 'prepare' && afterPrepare) {
        const kind = afterPrepare; afterPrepare = null;
        await fixture.mutate(kind);
      }
      return result;
    };
    fixture = await mysqlFixture(r.mysql, client, () => now, r.owner || 'p-teacher');
    return { ready: true, owner: fixture.owner };
  }
  if (!fixture) fail('invalid_request');
  const { service, store, pool, lab, owner } = fixture;
  if (r.command === 'freeze') return service.freeze(owner,
    { ...await fixture.selection(), ...(r.purpose ? { purpose: r.purpose } : {}) }, r.key || randomUUID(), '水循环探究合成片段');
  if (['resume', 'status', 'get', 'cancel'].includes(r.command)) return service[r.command](owner, r.operation_id);
  if (r.command === 'mutate') {
    await fixture.mutate(r.kind, r.hold, () => {
      if (r.notify_lock) process.stdout.write(JSON.stringify({ ok: true, result: { locked: true } }) + '\n');
    });
    return { changed: true };
  }
  if (r.command === 'after_prepare') { afterPrepare = r.kind; return { configured: true }; }
  if (r.command === 'cleanup') return store.cleanup();
  if (r.command === 'start_cleanup') {
    if (cleanupStop) fail('invalid_request');
    cleanupStop = store.startCleanup({ intervalMs: 50, onError: () => { cleanupErrors++; } });
    return { started: true };
  }
  if (r.command === 'inventory') {
    const counts = {};
    for (const name of ['operations', 'snapshots', 'keys', 'owners']) {
      const [[row]] = await lab.execute(`SELECT COUNT(*) AS n FROM ${TABLES[name]}`);
      counts[name] = row.n;
    }
    const [[held]] = await lab.execute(`SELECT COUNT(*) AS n FROM ${TABLES.operations} WHERE hold=1`);
    return { ...counts, held: held.n, cleanup_errors: cleanupErrors };
  }
  if (r.command === 'state') return store.transaction(owner, state => state); // Synthetic bytes, consumed only by test driver.
  if (r.command === 'rollback') {
    const before = await store.transaction(owner, state => state);
    let rejected = false;
    try {
      await store.transaction(owner, state => {
        const id = randomUUID(), old = state.operations[r.operation_id];
        // Operation and snapshot SQL writes happen first, then the invalid FK
        // forces a real database rollback of both, not just a callback exception.
        state.operations[id] = { ...structuredClone(old), id, choice: randomBytes(32).toString('hex') };
        state.operations[id].binding.operation_id = id;
        state.snapshots[id] = structuredClone(state.snapshots[r.operation_id]);
        state.keys[randomBytes(32).toString('hex')] = { fingerprint: 'rollback-probe', operation_id: randomUUID(), expires_at: old.write_until };
      });
    } catch (error) { if (error.code !== 'storage_unavailable') throw error; rejected = true; }
    const after = await store.transaction(owner, state => state);
    if (!rejected || JSON.stringify(before) !== JSON.stringify(after)) fail('rollback_probe_failed');
    return service.get(owner, r.operation_id);
  }
  if (r.command === 'unique_probe') {
    const [[op]] = await lab.execute(`SELECT choice,expires_at,status,record FROM ${TABLES.operations} WHERE id=?`, [r.operation_id]);
    let rejected = false;
    try { await lab.execute(`INSERT INTO ${TABLES.operations}(id,owner,choice,expires_at,status,record) VALUES(?,?,?,?,?,?)`,
      [randomUUID(), owner, op.choice, op.expires_at, op.status, JSON.stringify(op.record)]); }
    catch (error) { rejected = error.code === 'ER_DUP_ENTRY'; }
    return { rejected };
  }
  if (r.command === 'immutable_probe') {
    // Fixed fields never change in place; the trusted deadline may be set once and never moved.
    const attempt = async fn => { try { await store.transaction(owner, fn); return 'accepted'; } catch (error) { return error.code; } };
    return {
      expires_at: await attempt(s => { s.operations[r.operation_id].expires_at += 1; }),
      binding: await attempt(s => { s.operations[r.operation_id].binding.landing = 'courseware'; }),
      choice: await attempt(s => { s.operations[r.operation_id].choice = randomBytes(32).toString('hex'); }),
      snapshot: await attempt(s => { s.snapshots[r.operation_id].packet = { manifest_b64: 'x', blobs: [] }; }),
      deadline_first: await attempt(s => { s.operations[r.operation_id].operation_expires_at = 2000086400; }),
      deadline_moved: await attempt(s => { s.operations[r.operation_id].operation_expires_at = 2000086401; }),
      deadline_cleared: await attempt(s => { s.operations[r.operation_id].operation_expires_at = null; })
    };
  }
  if (r.command === 'hold') {
    await store.transaction(owner, s => { s.operations[r.operation_id].hold = r.value === true; });
    const [[row]] = await lab.execute(`SELECT hold FROM ${TABLES.operations} WHERE id=?`, [r.operation_id]);
    return { hold: row.hold };
  }
  if (r.command === 'privilege_probe') {
    // The restricted role must not reach DDL, grants, business writes, server tables or other databases.
    const probes = {
      create_table: 'CREATE TABLE p03_probe(id INT)', drop_table: `DROP TABLE ${TABLES.keys}`, alter_table: `ALTER TABLE ${TABLES.operations} ADD COLUMN probe INT`,
      truncate: `TRUNCATE TABLE ${TABLES.snapshots}`, write_source_facts: `UPDATE p03_lab_facts SET facts=JSON_SET(facts,'$.copy',false) WHERE owner='${owner}'`,
      delete_source_facts: 'DELETE FROM p03_lab_facts', read_server_users: 'SELECT user FROM mysql.user LIMIT 1', grant_self: `GRANT ALL ON *.* TO CURRENT_USER()`,
      create_user: `CREATE USER 'p03_probe'@'%' IDENTIFIED BY 'x'`, other_database: 'CREATE DATABASE p03_probe_db'
    };
    // Killing another account's live session must be refused (a business connection stands in for it).
    const business = await lab.getConnection();
    try {
      const [[{ id }]] = await business.query('SELECT CONNECTION_ID() AS id');
      probes.kill_other_session = `KILL CONNECTION ${id}`;
    } finally { business.release(); }
    const results = {};
    for (const [name, sql] of Object.entries(probes)) {
      try { await pool.query(sql); results[name] = 'allowed'; }
      catch (error) { results[name] = DENIED.has(error.code) ? 'denied' : `other:${error.code}`; }
    }
    const [grants] = await pool.query('SHOW GRANTS FOR CURRENT_USER()');
    const text = grants.map(row => Object.values(row)[0]).join('\n');
    return { results, grant_count: grants.length, all_privileges: /ALL PRIVILEGES/i.test(text), global_grant: /ON \*\.\*/.test(text.replace(/GRANT USAGE ON \*\.\*/g, '')),
      tables: Object.values(TABLES).every(t => text.includes(`\`${t}\``)), facts_readonly: /GRANT SELECT ON `[^`]+`\.`p03_lab_facts`/.test(text) && !/UPDATE[^\n]*p03_lab_facts/.test(text) };
  }
  if (r.command === 'kill_lock') {
    const [[row]] = await lab.execute('SELECT IS_USED_LOCK(?) AS id', [digest(`p03-handoff:${r.operation_id}`)]);
    if (!Number.isSafeInteger(row.id)) fail('invalid_request');
    await lab.query(`KILL CONNECTION ${row.id}`);
    return { killed: true };
  }
  throw new HandoffError('invalid_request');
}
readline.createInterface({ input: process.stdin }).on('line', async line => {
  try { process.stdout.write(JSON.stringify({ ok: true, result: await run(JSON.parse(line)) }) + '\n'); }
  catch (error) { process.stdout.write(JSON.stringify({ ok: false, code: error instanceof HandoffError ? error.code : 'local_failure' }) + '\n'); }
});

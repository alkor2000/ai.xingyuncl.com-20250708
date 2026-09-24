// Default-off MySQL 8 durable candidate for the P03 source ledger. Unmounted: no default pool,
// application config, automatic DDL or production wiring. One store serves every owner; each
// transaction serializes on the owner's anchor row, so any source-permission mutation path that
// takes the same anchor (withOwnerLock) is ordered against release. The JSON record stays
// authoritative; status/hold/recovery_until columns are projections for inventory and cleanup.
const { AsyncLocalStorage } = require('async_hooks');
const { digest, fail, HandoffError } = require('./source');
const TABLES = Object.freeze({ owners: 'p03_handoff_owners', operations: 'p03_handoff_operations',
  snapshots: 'p03_handoff_snapshots', keys: 'p03_handoff_keys' });
const COLLECTIONS = ['operations', 'snapshots', 'keys'];
const ASCII = 'CHARACTER SET ascii COLLATE ascii_bin';
// Candidate DDL. Additive and idempotent; deliberately not in backend/migrations until the wire is
// frozen and release is authorized. Lab databases and reviewers read the same statements.
const SCHEMA = Object.freeze([
  `CREATE TABLE IF NOT EXISTS ${TABLES.owners}(owner VARCHAR(128) ${ASCII} NOT NULL, created_at BIGINT NOT NULL,
    PRIMARY KEY(owner)) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS ${TABLES.operations}(id CHAR(36) ${ASCII} NOT NULL, owner VARCHAR(128) ${ASCII} NOT NULL,
    choice CHAR(64) ${ASCII} NOT NULL, status VARCHAR(32) ${ASCII} NOT NULL, expires_at BIGINT NOT NULL,
    recovery_until BIGINT NULL, hold TINYINT NOT NULL DEFAULT 0, record JSON NOT NULL,
    PRIMARY KEY(id), UNIQUE KEY owner_id(owner,id), UNIQUE KEY one_choice(owner,choice), KEY prune(hold,expires_at,recovery_until),
    CONSTRAINT fk_p03_handoff_operations_owner FOREIGN KEY(owner) REFERENCES ${TABLES.owners}(owner)) ENGINE=InnoDB`,
  ...['snapshots', 'keys'].map(name => `CREATE TABLE IF NOT EXISTS ${TABLES[name]}(owner VARCHAR(128) ${ASCII} NOT NULL,
    id VARCHAR(64) ${ASCII} NOT NULL, operation_id CHAR(36) ${ASCII} NOT NULL, expires_at BIGINT NOT NULL, record JSON NOT NULL,
    PRIMARY KEY(owner,id), KEY prune(expires_at), CONSTRAINT fk_p03_handoff_${name}_operation FOREIGN KEY(owner,operation_id)
    REFERENCES ${TABLES.operations}(owner,id) ON DELETE CASCADE) ENGINE=InnoDB`)
]);
const identifier = (value, max) => typeof value === 'string' && value.length >= 1 && value.length <= max && /^[A-Za-z0-9_]+$/.test(value);
// Restricted application-role candidate: DML on the four ledger tables, SELECT on the named read-only
// source-fact tables, nothing else (no DDL, no business writes, no GRANT/administrative rights).
// CREATE USER and the password stay with the deployment operator; only privilege statements are produced.
// Production today runs with ALL PRIVILEGES; this is the recorded target, not an applied change.
function restrictedRoleGrants({ database, user, host = '127.0.0.1', sourceTables = [] }) {
  if (!identifier(database, 64) || !identifier(user, 32) || typeof host !== 'string' || !/^[A-Za-z0-9_.%-]{1,60}$/.test(host) ||
      !Array.isArray(sourceTables) || sourceTables.some(t => !identifier(t, 64) || Object.values(TABLES).includes(t))) fail('invalid_draft_configuration');
  const account = `'${user}'@'${host}'`;
  return [...Object.values(TABLES).map(t => `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${database}\`.\`${t}\` TO ${account}`),
    ...sourceTables.map(t => `GRANT SELECT ON \`${database}\`.\`${t}\` TO ${account}`)];
}
const decode = value => typeof value === 'string' ? JSON.parse(value) : value;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const validOwner = owner => typeof owner === 'string' && owner.length >= 1 && owner.length <= 128 && /^[\x21-\x7e]+$/.test(owner);
// Retention: freeze-based expiry, extended to the Identity recovery window once it is trusted; a
// hold row (unresolved first issue or open reconciliation) is never pruned automatically.
const retained = (record, now) => record.hold === true || Math.max(record.expires_at, record.recovery_until || 0) > now;
class MySQLHandoffStore {
  constructor({ pool, now = Date.now, cleanupBatch = 500 }) {
    if (!pool || typeof pool.getConnection !== 'function' || typeof pool.execute !== 'function' || typeof now !== 'function' ||
        !Number.isSafeInteger(cleanupBatch) || cleanupBatch < 1 || cleanupBatch > 10000) fail('invalid_draft_configuration');
    Object.assign(this, { pool, now, cleanupBatch });
    this.context = new AsyncLocalStorage();
    this.lease = new AsyncLocalStorage();
  }
  async assertLease() {
    const lock = this.lease.getStore();
    if (!lock) return;
    try {
      const [[r]] = await lock.connection.execute('SELECT IS_USED_LOCK(?) = CONNECTION_ID() AS held', [lock.name]);
      if (r.held !== 1) fail('operation_lock_lost', 503, true);
    } catch { fail('operation_lock_lost', 503, true); }
  }
  // Cross-process serialization of one operation on a dedicated connection; released on exit.
  async exclusive(id, fn) {
    const name = digest(`p03-handoff:${id}`);
    let connection, acquired = false;
    try {
      connection = await this.pool.getConnection();
      const [[r]] = await connection.execute('SELECT GET_LOCK(?, 2) AS held', [name]);
      if (r.held !== 1) fail('operation_busy', 503, true);
      acquired = true;
      return await this.lease.run({ connection, name }, fn);
    } catch (error) {
      if (error instanceof HandoffError) throw error;
      fail('storage_unavailable', 503, true);
    } finally {
      if (connection) {
        try { if (acquired) await connection.execute('SELECT RELEASE_LOCK(?)', [name]); }
        catch { connection.destroy(); }
        connection.release();
      }
    }
  }
  async query(sql, args = []) {
    const connection = this.context.getStore();
    return (connection || this.pool).execute(sql, args);
  }
  async withTransaction(fn) {
    await this.assertLease();
    if (this.context.getStore()) return fn();
    let connection;
    try {
      connection = await this.pool.getConnection();
      await connection.query('SET SESSION innodb_lock_wait_timeout = 3');
      await connection.beginTransaction();
      const result = await this.context.run(connection, fn);
      await this.assertLease();
      await connection.commit();
      return result;
    } catch (error) {
      try { await connection?.rollback(); } catch { connection?.destroy(); }
      if (error instanceof HandoffError) throw error;
      // Never replay a callback: it may have checked source facts or performed file I/O.
      fail('storage_unavailable', 503, true);
    } finally { connection?.release(); }
  }
  // The anchor row is created on demand and X-locked (ON DUPLICATE KEY takes an exclusive lock, so
  // concurrent first touches never deadlock on a shared-to-exclusive upgrade).
  async lockOwner(owner, create) {
    if (!validOwner(owner)) fail('invalid_request');
    if (create) await this.query(`INSERT INTO ${TABLES.owners}(owner,created_at) VALUES(?,?) ON DUPLICATE KEY UPDATE owner=owner`, [owner, this.now()]);
    const [[row]] = await this.query(`SELECT owner FROM ${TABLES.owners} WHERE owner=? FOR UPDATE`, [owner]);
    return !!row;
  }
  // Source-fact mutation paths (permission revocation, content change) call this so that the check
  // and release inside transaction() are strictly ordered against them.
  async withOwnerLock(owner, fn) {
    return this.withTransaction(async () => { await this.lockOwner(owner, true); return fn(); });
  }
  async pruneOwner(owner) {
    const now = this.now(), counts = {};
    for (const collection of ['snapshots', 'keys']) {
      const [r] = await this.query(`DELETE FROM ${TABLES[collection]} WHERE owner=? AND expires_at<=?`, [owner, now]);
      counts[collection] = r.affectedRows;
    }
    const [r] = await this.query(`DELETE FROM ${TABLES.operations} WHERE owner=? AND hold=0 AND expires_at<=? AND (recovery_until IS NULL OR recovery_until<=?)`, [owner, now, now]);
    counts.operations = r.affectedRows;
    return counts;
  }
  // Global, bounded, autocommit cleanup for a scheduler; hold rows need the reconciliation exit.
  async cleanup({ limit = this.cleanupBatch, maxRounds = 20 } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000 || !Number.isSafeInteger(maxRounds) || maxRounds < 1) fail('invalid_draft_configuration');
    const counts = { snapshots: 0, keys: 0, operations: 0, complete: true };
    const statements = {
      snapshots: [`DELETE FROM ${TABLES.snapshots} WHERE expires_at<=? LIMIT ${limit}`, now => [now]],
      keys: [`DELETE FROM ${TABLES.keys} WHERE expires_at<=? LIMIT ${limit}`, now => [now]],
      operations: [`DELETE FROM ${TABLES.operations} WHERE hold=0 AND expires_at<=? AND (recovery_until IS NULL OR recovery_until<=?) LIMIT ${limit}`, now => [now, now]]
    };
    try {
      for (const [collection, [sql, args]] of Object.entries(statements)) {
        let rounds = 0, deleted = limit;
        while (deleted === limit && rounds < maxRounds) {
          const [r] = await this.pool.execute(sql, args(this.now()));
          deleted = r.affectedRows; counts[collection] += deleted; rounds++;
        }
        if (deleted === limit) counts.complete = false;
      }
    } catch (error) {
      if (error instanceof HandoffError) throw error;
      fail('storage_unavailable', 503, true);
    }
    return counts;
  }
  startCleanup({ intervalMs = 60000, onError = () => {} } = {}) {
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 50) fail('invalid_draft_configuration');
    let pending = null, stopped = false;
    const timer = setInterval(() => {
      if (stopped || pending) return;
      pending = this.cleanup().catch(() => onError('storage_unavailable')).finally(() => { pending = null; });
    }, intervalMs);
    timer.unref();
    return async () => { stopped = true; clearInterval(timer); await pending; };
  }
  // Bounded owner-scoped state callback (the draft service API): rows of one owner are read under
  // the anchor lock, the callback mutates the state object, and the diff is written back with
  // immutable-field checks. `create` is only for freeze; reads of an unknown owner return empty state.
  async transaction(owner, fn, { create = false } = {}) {
    if (typeof fn !== 'function') fail('invalid_request');
    return this.withTransaction(async () => {
      const exists = await this.lockOwner(owner, create);
      const state = { operations: {}, snapshots: {}, keys: {} };
      if (exists) {
        await this.pruneOwner(owner);
        for (const collection of COLLECTIONS) {
          const [rows] = await this.query(`SELECT id,record FROM ${TABLES[collection]} WHERE owner=?`, [owner]);
          for (const row of rows) state[collection][row.id] = decode(row.record);
        }
      }
      const before = structuredClone(state);
      const result = await fn(state);
      const changed = COLLECTIONS.some(c => !same(before[c], state[c]));
      if (changed && !exists) fail('binding_mismatch', 409);
      for (const collection of COLLECTIONS) {
        for (const id of Object.keys(before[collection])) {
          if (!state[collection][id]) await this.query(`DELETE FROM ${TABLES[collection]} WHERE owner=? AND id=?`, [owner, id]);
        }
        for (const [id, value] of Object.entries(state[collection])) {
          if (same(value, before[collection][id])) continue;
          const record = JSON.stringify(value);
          if (collection === 'operations') {
            if (value.owner !== owner || value.id !== id || typeof value.status !== 'string' || !Number.isSafeInteger(value.expires_at)) fail('binding_mismatch', 409);
            const projection = [value.status, value.recovery_until ?? null, value.hold === true ? 1 : 0, record];
            const old = before.operations[id];
            if (old) {
              const fixed = ['choice', 'binding_sha256', 'binding', 'expires_at', 'write_until', 'content_sha256', 'source_id', 'protocol_version'];
              const once = ['operation_expires_at', 'recovery_until'];
              if (fixed.some(k => !same(old[k], value[k])) || once.some(k => old[k] != null && !same(old[k], value[k]))) fail('binding_mismatch', 409);
              await this.query(`UPDATE ${TABLES.operations} SET status=?,recovery_until=?,hold=?,record=? WHERE owner=? AND id=?`, [...projection, owner, id]);
            } else {
              await this.query(`INSERT INTO ${TABLES.operations}(id,owner,choice,expires_at,status,recovery_until,hold,record) VALUES(?,?,?,?,?,?,?,?)`,
                [id, owner, value.choice, value.expires_at, ...projection]);
            }
          } else if (before[collection][id]) {
            // Frozen packets and key fingerprints never change during an operation.
            fail('binding_mismatch', 409);
          } else {
            await this.query(`INSERT INTO ${TABLES[collection]}(owner,id,operation_id,expires_at,record) VALUES(?,?,?,?,?)`,
              [owner, id, collection === 'snapshots' ? id : value.operation_id, value.expires_at, record]);
          }
        }
      }
      return structuredClone(result);
    });
  }
}
module.exports = { MySQLHandoffStore, SCHEMA, TABLES, restrictedRoleGrants, retained };

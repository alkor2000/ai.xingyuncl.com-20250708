'use strict';

// The candidate migration for the write sequence, exercised against a knex stub that records every
// statement. The real behaviour is verified on real MySQL by dev/p09-lab/migration-replay.py; this
// guards the one rule that is easy to lose in an edit: a migration adds what is missing and never
// decides business state, so a replay must not touch the counters at all.
const path = require('node:path');
const MIGRATION = path.join(__dirname, '../../../../migrations-candidates/p09/20260922_002_p09_write_sequence.js');

// A knex stub with the two things the migration now depends on: a pinned transaction connection and a
// server that reports whether the exclusive lock is actually held.
function stubKnex({ columns, interrupted = 0, lock = 'granted', held = true, waitOut = null,
  sessionTimeout = 31536000 }) {
  const statements = [];
  let samples = 0;
  let transactions = 0;
  const raw = async (sql, bindings = []) => {
    const text = sql.replace(/\s+/g, ' ').trim();
    statements.push({ sql: text, bindings });
    // `waitOut` names the statement that runs out of patience, the way a busy ledger makes one. It is
    // checked before anything else answers, so it can stand in for the very first ledger read.
    if (waitOut && new RegExp(waitOut).test(text)) {
      const error = new Error('Lock wait timeout exceeded');
      error.code = 'ER_LOCK_WAIT_TIMEOUT';
      error.errno = 1205;
      throw error;
    }
    if (/information_schema/.test(sql)) return [columns.map(name => ({ c: name }))];
    if (/applied_write_seq > write_seq/.test(sql) && /COUNT/.test(sql)) return [[{ n: interrupted }]];
    if (/^SELECT DATABASE/.test(text)) return [[{ db: 'ledger' }]];
    if (/@@SESSION.lock_wait_timeout/.test(text)) return [[{ value: sessionTimeout }]];
    if (/^LOCK TABLES/.test(text)) {
      if (lock !== 'granted') { const error = new Error('denied'); error.code = 'ER_TABLEACCESS_DENIED_ERROR'; throw error; }
      return [{}];
    }
    if (/^SHOW OPEN TABLES/.test(text)) return [held ? [{ Table: 'p09_links', In_use: 1 }] : []];
    if (/MAX\(updated_at\)/.test(sql)) { samples += 1; return [[{ n: 1, newest: samples }]]; }
    if (/MAX\(value\)/.test(sql)) return [[{ value: 1 }]];
    return [{ affectedRows: 0 }];
  };
  const knex = { raw, transaction: async work => { transactions += 1; return work({ raw }); } };
  return { knex, statements, transactionCount: () => transactions };
}
const writes = statements => statements.filter(item => /^(ALTER|UPDATE)/.test(item.sql));
const locked = statements => statements.some(item => /^LOCK TABLES/.test(item.sql));

describe('P09 write-sequence migration candidate', () => {
  test('a ledger that already has both columns is left completely alone, however often it runs', async () => {
    const migration = require(MIGRATION);
    const { knex, statements } = stubKnex({ columns: ['write_seq', 'applied_write_seq'] });
    await migration.up(knex);
    await migration.up(knex);
    // No ALTER, and above all no "applied_write_seq = write_seq": an outstanding backlog (7/3) survives
    // being migrated again, because only reconciliation may close it.
    expect(writes(statements)).toEqual([]);
    expect(JSON.stringify(statements)).not.toContain('applied_write_seq = write_seq');
  });

  test('an older ledger gains both columns in one statement, so no half state can be observed', async () => {
    const migration = require(MIGRATION);
    const { knex, statements } = stubKnex({ columns: [] });
    await migration.up(knex);
    const applied = writes(statements);
    expect(applied).toHaveLength(1);
    expect(applied[0].sql).toMatch(/ALTER TABLE .*ADD COLUMN `write_seq`.*ADD COLUMN `applied_write_seq`/);
    expect(JSON.stringify(applied)).not.toContain('UPDATE');
  });

  test('an interrupted run that left write_seq behind starts the new column outstanding', async () => {
    const migration = require(MIGRATION);
    const { knex, statements } = stubKnex({ columns: ['write_seq'] });
    await migration.up(knex);
    const applied = writes(statements);
    expect(applied).toHaveLength(1);
    expect(applied[0].sql).toMatch(/ADD COLUMN `applied_write_seq`/);
    expect(JSON.stringify(applied)).not.toContain('applied_write_seq = write_seq');
  });

  test('an unverifiable applied_write_seq is discarded, but only after the work is marked', async () => {
    const migration = require(MIGRATION);
    const { knex, statements } = stubKnex({ columns: ['applied_write_seq'] });
    await migration.up(knex);
    const applied = writes(statements);
    expect(applied).toHaveLength(3);
    expect(applied[0].sql).toContain('ADD COLUMN `write_seq`');
    // Mark first, drop the claim second: a process that dies in between leaves the marker, never a
    // silent "0/0, nothing to do".
    expect(applied[1].sql).toContain('sync_pending_at = COALESCE(sync_pending_at, ?)');
    expect(applied[1].sql).not.toContain('sync_pending_at = NULL');       // markers are added, never cleared
    expect(applied[2].sql).toContain('SET applied_write_seq = 0');
  });

  test('an interrupted repair is finished by the next run, and only then', async () => {
    const migration = require(MIGRATION);
    const resumed = stubKnex({ columns: ['write_seq', 'applied_write_seq'], interrupted: 2 });
    await migration.up(resumed.knex);
    const applied = writes(resumed.statements);
    expect(applied).toHaveLength(2);
    expect(applied[0].sql).toContain('sync_pending_at = COALESCE(sync_pending_at, ?)');
    expect(applied[1].sql).toContain('SET applied_write_seq = 0 WHERE applied_write_seq > write_seq');
    // A plain outstanding backlog (7/3) is not an interrupted repair: nothing is written.
    const settled = stubKnex({ columns: ['write_seq', 'applied_write_seq'], interrupted: 0 });
    await migration.up(settled.knex);
    expect(writes(settled.statements)).toEqual([]);
  });

  test('a data decision without a lock the server confirms is refused by name, and writes nothing', async () => {
    const migration = require(MIGRATION);
    // The account may write the ledger but may not lock it: exclusivity cannot be proven.
    const denied = stubKnex({ columns: ['applied_write_seq'], lock: 'denied' });
    await expect(migration.up(denied.knex)).rejects.toMatchObject({ code: 'p09_exclusive_entry_unavailable' });
    expect(writes(denied.statements)).toEqual([]);      // not even the ALTER ran
    // The lock was requested but the server does not report it held: still not good enough.
    const unconfirmed = stubKnex({ columns: ['applied_write_seq'], held: false });
    await expect(migration.up(unconfirmed.knex)).rejects.toMatchObject({ code: 'p09_exclusive_entry_unverified' });
    expect(writes(unconfirmed.statements)).toEqual([]);
    // And the refusal message points at the fix rather than at a moment of quiet.
    await expect(migration.up(stubKnex({ columns: ['applied_write_seq'], lock: 'denied' }).knex))
      .rejects.toThrow(/Grant LOCK TABLES/);
  });

  test('every data decision happens inside the exclusive window; pure additive DDL does not need one', async () => {
    const migration = require(MIGRATION);
    const repair = stubKnex({ columns: ['write_seq', 'applied_write_seq'], interrupted: 1 });
    await migration.up(repair.knex);
    expect(locked(repair.statements)).toBe(true);
    const rollback = stubKnex({ columns: ['write_seq', 'applied_write_seq'] });
    await migration.down(rollback.knex);
    expect(locked(rollback.statements)).toBe(true);
    const additive = stubKnex({ columns: [] });
    await migration.up(additive.knex);
    expect(locked(additive.statements)).toBe(false);
  });

  test('the wait is bounded and the session is handed back as it was found', async () => {
    // MySQL's own default is a year: without a limit of its own, a release that cannot get the lock
    // does not refuse — it hangs. And a connection that carries a 15s limit back into the pool would
    // change somebody else's request, so the old value goes back before it is returned.
    const { knex, statements } = stubKnex({ columns: ['write_seq', 'applied_write_seq'], interrupted: 1,
      sessionTimeout: 4242 });
    await require(MIGRATION).up(knex);
    const settings = statements.filter(item => /^SET SESSION lock_wait_timeout/.test(item.sql));
    expect(settings.map(item => item.sql)).toEqual([
      'SET SESSION lock_wait_timeout = 15', 'SET SESSION lock_wait_timeout = 4242']);
  });

  test('a ledger that is busy is refused by name, and the refusal is not delayed by its own diagnosis', async () => {
    // The first ledger read waits on the same lock the migration would ask for, so this is where a busy
    // ledger actually stops it — before LOCK TABLES is even requested.
    const { knex, statements } = stubKnex({ columns: ['write_seq', 'applied_write_seq'], interrupted: 1,
      waitOut: '^SELECT COUNT' });
    await expect(require(MIGRATION).up(knex)).rejects.toMatchObject({ code: 'p09_exclusive_entry_unavailable' });
    expect(writes(statements)).toHaveLength(0);
    // Whatever is attached to that refusal may not read the tables that are busy: the old version's
    // ledger sample blocked on exactly those, and on a small pool it asked for a second connection.
    const afterFailure = statements.slice(statements.findIndex(item => /^SELECT COUNT/.test(item.sql)) + 1);
    expect(afterFailure.filter(item => /FROM `?p09_(links|event_sequence)`?/.test(item.sql))).toHaveLength(0);
    expect(afterFailure.some(item => /^SHOW OPEN TABLES/.test(item.sql))).toBe(true);
  });

  test('a lock that runs out of patience is the same refusal, and still writes nothing', async () => {
    const { knex, statements } = stubKnex({ columns: ['applied_write_seq'], waitOut: '^LOCK TABLES' });
    await expect(require(MIGRATION).up(knex)).rejects.toMatchObject({ code: 'p09_exclusive_entry_unavailable' });
    expect(writes(statements)).toHaveLength(0);
  });

  test('the whole migration runs on one pinned connection', async () => {
    // `knex.raw()` takes a connection from the pool per statement, so a second transaction is a second
    // connection — and on a small pool the second one is the one this migration is already holding.
    const { knex, transactionCount } = stubKnex({ columns: ['write_seq', 'applied_write_seq'], interrupted: 1 });
    await require(MIGRATION).up(knex);
    expect(transactionCount()).toBe(1);
    const down = stubKnex({ columns: ['write_seq', 'applied_write_seq'] });
    await require(MIGRATION).down(down.knex);
    expect(down.transactionCount()).toBe(1);
  });

  test('down writes the backlog down as a marker before it drops the evidence of it', async () => {
    const migration = require(MIGRATION);
    const both = stubKnex({ columns: ['write_seq', 'applied_write_seq'] });
    await migration.down(both.knex);
    const applied = writes(both.statements);
    expect(applied).toHaveLength(2);
    expect(applied[0].sql).toContain('WHERE state = \'active\' AND applied_write_seq < write_seq');
    expect(applied[1].sql).toMatch(/DROP COLUMN `write_seq`, DROP COLUMN `applied_write_seq`/);
    // A half state has no backlog to write down; it just drops what is there.
    const half = stubKnex({ columns: ['write_seq'] });
    await migration.down(half.knex);
    const halfApplied = writes(half.statements);
    expect(halfApplied).toHaveLength(1);
    expect(halfApplied[0].sql).toMatch(/DROP COLUMN `write_seq`/);
    expect(halfApplied[0].sql).not.toContain('applied_write_seq');
    const empty = stubKnex({ columns: [] });
    await migration.down(empty.knex);
    expect(writes(empty.statements)).toEqual([]);
  });
});

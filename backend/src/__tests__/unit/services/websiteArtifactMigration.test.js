'use strict';

// The candidate migration for the write sequence, exercised against a knex stub that records every
// statement. The real behaviour is verified on real MySQL by dev/p09-lab/migration-replay.py; this
// guards the one rule that is easy to lose in an edit: a migration adds what is missing and never
// decides business state, so a replay must not touch the counters at all.
const path = require('node:path');
const MIGRATION = path.join(__dirname, '../../../../migrations-candidates/p09/20260922_002_p09_write_sequence.js');

function stubKnex({ columns, interrupted = 0, moving = false }) {
  const statements = [];
  let samples = 0;
  const knex = {
    raw: async (sql, bindings = []) => {
      statements.push({ sql: sql.replace(/\s+/g, ' ').trim(), bindings });
      if (/information_schema/.test(sql)) return [columns.map(name => ({ c: name }))];
      if (/applied_write_seq > write_seq/.test(sql) && /COUNT/.test(sql)) return [[{ n: interrupted }]];
      if (/MAX\(updated_at\)/.test(sql)) { samples += 1; return [[{ n: 1, newest: moving ? samples : 1 }]]; }
      if (/MAX\(value\)/.test(sql)) return [[{ value: 1 }]];
      return [{ affectedRows: 0 }];
    }
  };
  return { knex, statements };
}
const writes = statements => statements.filter(item => /^(ALTER|UPDATE)/.test(item.sql));

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

  test('the repair refuses while the ledger is moving, and writes nothing', async () => {
    const migration = require(MIGRATION);
    const { knex, statements } = stubKnex({ columns: ['applied_write_seq'], moving: true });
    await expect(migration.up(knex)).rejects.toMatchObject({ code: 'p09_ledger_busy_during_half_state_repair' });
    expect(writes(statements)).toEqual([]);      // not even the ALTER ran
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

'use strict';

// The candidate migration for the write sequence, exercised against a knex stub that records every
// statement. The real behaviour is verified on real MySQL by dev/p09-lab/migration-replay.py; this
// guards the one rule that is easy to lose in an edit: a migration adds what is missing and never
// decides business state, so a replay must not touch the counters at all.
const path = require('node:path');
const MIGRATION = path.join(__dirname, '../../../../migrations-candidates/p09/20260922_002_p09_write_sequence.js');

function stubKnex({ columns }) {
  const statements = [];
  const knex = {
    raw: async (sql, bindings = []) => {
      statements.push({ sql: sql.replace(/\s+/g, ' ').trim(), bindings });
      if (/information_schema/.test(sql)) return [columns.map(name => ({ c: name }))];
      return [{ affectedRows: 0 }];
    }
  };
  return { knex, statements };
}
const writes = statements => statements.filter(item => !/information_schema/.test(item.sql));

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

  test('an unverifiable applied_write_seq is discarded and the work is marked for reconciliation', async () => {
    const migration = require(MIGRATION);
    const { knex, statements } = stubKnex({ columns: ['applied_write_seq'] });
    await migration.up(knex);
    const applied = writes(statements);
    expect(applied.map(item => item.sql.slice(0, 40))).toEqual([
      expect.stringContaining('ALTER TABLE'), expect.stringContaining('UPDATE'), expect.stringContaining('UPDATE')
    ]);
    expect(applied[1].sql).toContain('SET applied_write_seq = 0');        // the claim is dropped, not trusted
    expect(applied[2].sql).toContain('sync_pending_at = COALESCE(sync_pending_at, ?)');
    expect(applied[2].sql).not.toContain('sync_pending_at = NULL');       // markers are added, never cleared
  });

  test('down drops only what is there and never touches the rows', async () => {
    const migration = require(MIGRATION);
    const { knex, statements } = stubKnex({ columns: ['write_seq'] });
    await migration.down(knex);
    const applied = writes(statements);
    expect(applied).toHaveLength(1);
    expect(applied[0].sql).toMatch(/DROP COLUMN `write_seq`/);
    expect(applied[0].sql).not.toContain('applied_write_seq');
    const empty = stubKnex({ columns: [] });
    await migration.down(empty.knex);
    expect(writes(empty.statements)).toEqual([]);
  });
});

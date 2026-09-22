'use strict';

// Candidate migration 002: the durable per-write sequence a reconciliation compares against.
//
// 001 creates the tables from store.js SCHEMA, which already carries these two columns, so a fresh
// install needs nothing here. This file exists for a ledger created from the earlier candidate shape.
//
// The rule this migration lives by: **it adds what is missing and never decides business state.** The
// difference between `write_seq` and `applied_write_seq` is a work's outstanding reconciliation, and
// only the service's reconciliation may close it. An earlier version of this file ended with an
// unconditional `UPDATE applied_write_seq = write_seq`, so running it again on a live ledger (after a
// rollback, after a lost migration record, or by hand) silently turned 7/3 into 7/7 — it announced that
// four observed writes had been projected when they had not. That is fixed here, and the four cases
// below are exercised against a real MySQL ledger by dev/p09-lab/migration-replay.py.
//
// Running writes: with both columns missing they are added in ONE statement, so there is no window in
// which only one of them exists. P09 is default-off, so an upgrade normally has no runtime writes at
// all; if a deployment had it enabled, a P09 write during the DDL may be refused — the student's own
// save is unaffected, the hook swallows it, and the work stays outstanding for the sweep. This does not
// require, and does not authorize, stopping anything.
const { TABLES } = require('../../src/services/websiteArtifact/store');

const DDL = Object.freeze({ write_seq: 'BIGINT NOT NULL DEFAULT 0', applied_write_seq: 'BIGINT NOT NULL DEFAULT 0' });
const NAMES = Object.freeze(Object.keys(DDL));

async function present(knex) {
  const [rows] = await knex.raw(
    `SELECT column_name AS c FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name IN (?, ?)`,
    [TABLES.links, ...NAMES]);
  const found = new Set(rows.map(row => row.c));
  return Object.fromEntries(NAMES.map(name => [name, found.has(name)]));
}
const add = (knex, names) => knex.raw(`ALTER TABLE \`${TABLES.links}\` ${names
  .map(name => `ADD COLUMN \`${name}\` ${DDL[name]}`).join(', ')}`);

exports.up = async function up(knex) {
  const columns = await present(knex);

  // 1. Already migrated — including a replay of this very migration. Touch nothing: every counter here
  //    is live bookkeeping, and an outstanding backlog must survive being migrated again.
  if (columns.write_seq && columns.applied_write_seq) return;

  // 2. The ordinary upgrade. Both columns arrive together at 0/0: level, claiming nothing, and
  //    identical to how the ledger behaved before the sequence existed (outstanding == marker set).
  if (!columns.write_seq && !columns.applied_write_seq) {
    await add(knex, NAMES);
    return;
  }

  // 3. An interrupted run left `write_seq` behind. The new column starts at 0, so every work that has
  //    observed writes is outstanding until the service reconciles it — the conservative direction.
  if (columns.write_seq) {
    await add(knex, ['applied_write_seq']);
    return;
  }

  // 4. Only `applied_write_seq` survived. It claims work has been projected up to some number, but the
  //    sequence it counted against is gone, so the claim cannot be verified. It is discarded rather
  //    than trusted, and every active work is marked for reconciliation: the recovery is a normal
  //    sweep, which re-reads each work against its source and sets the counters honestly.
  await add(knex, ['write_seq']);
  await knex.raw(`UPDATE \`${TABLES.links}\` SET applied_write_seq = 0 WHERE applied_write_seq <> 0`);
  await knex.raw(`UPDATE \`${TABLES.links}\` SET sync_pending_at = COALESCE(sync_pending_at, ?) WHERE state = 'active'`,
    [Date.now()]);
};

// Dropping the columns loses the sequence, not the work: pending markers, revisions and events stay,
// and `up` afterwards lands on case 2. It is a rollback of the candidate, not a data migration.
exports.down = async function down(knex) {
  const columns = await present(knex);
  const drop = NAMES.filter(name => columns[name]);
  if (!drop.length) return;
  await knex.raw(`ALTER TABLE \`${TABLES.links}\` ${drop.map(name => `DROP COLUMN \`${name}\``).join(', ')}`);
};

exports.columns = NAMES;

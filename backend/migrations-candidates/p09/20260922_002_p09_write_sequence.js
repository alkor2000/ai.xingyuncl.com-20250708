'use strict';

// Candidate migration 002: the durable per-write sequence a reconciliation compares against.
//
// 001 creates the tables from store.js SCHEMA, which already carries these two columns, so a fresh
// install needs nothing here. This file exists for a ledger that was created from the earlier candidate
// shape: it adds the columns only when they are missing, and backfills `applied_write_seq` to the
// current `write_seq` so existing rows are not suddenly reported as outstanding. It stays OUTSIDE
// backend/migrations with 001 — promotion is a separate, authorized act.
const { TABLES } = require('../../src/services/websiteArtifact/store');

const COLUMNS = Object.freeze([
  { name: 'write_seq', ddl: 'BIGINT NOT NULL DEFAULT 0' },
  { name: 'applied_write_seq', ddl: 'BIGINT NOT NULL DEFAULT 0' }
]);
async function present(knex, column) {
  const [rows] = await knex.raw(
    'SELECT column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
    [TABLES.links, column]);
  return rows.length > 0;
}

exports.up = async function up(knex) {
  for (const column of COLUMNS) {
    if (await present(knex, column.name)) continue;
    await knex.raw(`ALTER TABLE \`${TABLES.links}\` ADD COLUMN \`${column.name}\` ${column.ddl}`);
  }
  // An existing projection is as current as the ledger knew how to make it: start the two counters
  // level so the upgrade itself never marks every work outstanding.
  await knex.raw(`UPDATE \`${TABLES.links}\` SET applied_write_seq = write_seq WHERE applied_write_seq <> write_seq`);
};

exports.down = async function down(knex) {
  for (const column of COLUMNS) {
    if (!(await present(knex, column.name))) continue;
    await knex.raw(`ALTER TABLE \`${TABLES.links}\` DROP COLUMN \`${column.name}\``);
  }
};

exports.columns = COLUMNS.map(column => column.name);

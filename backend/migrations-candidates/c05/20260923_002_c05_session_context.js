'use strict';

// Candidate migration for the C05 session context table. It lives OUTSIDE backend/migrations on
// purpose: knex only scans that directory, so moving this file is the same act as creating the table
// on the next release. Promotion needs its own authorization.
//
// `up` replays backend/src/services/studentEntry/sessionContext.js SCHEMA verbatim (one source of
// truth for the DDL bytes); `down` drops the table. It creates nothing else and changes no existing
// row, so a deployment that applies it and leaves the entry switched off behaves exactly as before.
//
// The entry refuses to run without this table: a session that cannot remember which lesson the student
// came from is not the thing contract §4 describes, and finding that out after a student has spent a
// one-time ticket would be the worst moment to find out.
const { SCHEMA, TABLE } = require('../../src/services/studentEntry/sessionContext');

exports.up = async function up(knex) {
  for (const statement of SCHEMA) await knex.raw(statement);
};

// Down drops the sessions that were recorded. Retention for this table has not been decided (nothing
// deletes rows on its own), so a rollback is the one place where that history is lost — the refusal
// below makes that a deliberate act rather than a side effect of rolling back a release.
exports.down = async function down(knex) {
  const result = await knex.raw(`SELECT COUNT(*) AS live FROM \`${TABLE}\` WHERE expires_at > NOW()`);
  const rows = Array.isArray(result) ? result[0] : (result.rows || result);
  const live = Number(rows[0].live ?? rows[0].LIVE);
  if (live > 0) {
    throw new Error(`c05_sessions_in_use: ${live} live session(s) would lose their context`);
  }
  await knex.raw(`DROP TABLE IF EXISTS \`${TABLE}\``);
};

exports.table = TABLE;

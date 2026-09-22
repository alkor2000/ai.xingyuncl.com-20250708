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

// knex's mysql2 client resolves raw() to [rows, fields]; every read here goes through this one place.
const read = async (runner, sql, bindings = []) => {
  const result = await runner.raw(sql, bindings);
  return Array.isArray(result) ? result[0] : (result.rows || result);
};

exports.up = async function up(knex) {
  for (const statement of SCHEMA) await knex.raw(statement);
};

// `down` drops the table, and with it every row it holds. Those rows are the record of which student
// came in from which school and which lesson, and how long that has been kept is a decision nobody has
// made yet — so this rollback refuses while ANY row exists, expired and revoked ones included.
//
// An expired token is not permission to delete history. The first version of this file only counted
// live sessions, which meant that waiting out the access token turned "roll back the release" into
// "delete the record", silently. Switching the feature off is the env switch; rolling back the
// application keeps the table. Destroying the history is a separate, named decision, and there is
// deliberately no flag here that skips this check and no automatic cleanup anywhere in the module.
//
// The emptiness check and the DROP have to be one window, or a session created between them would be
// dropped without ever being counted. The window is `LOCK TABLES … WRITE` on a pinned connection, and
// the migration verifies with the server that it actually holds it before deciding anything; if the
// lock cannot be taken or cannot be confirmed, it REFUSES BY NAME. "The table looked quiet" is not
// used as evidence of anything. Measured, not assumed: dev/c05-lab/tx-pool.py holds the lock from a
// second connection and shows this migration refusing, and shows a writer blocked for the whole window.
const refuse = (code, message) => { const error = new Error(`${code}: ${message}`); error.code = code; throw error; };

// How long to wait for the exclusive window before giving up. MySQL's own default for `lock_wait_timeout`
// is a year, so without this a migration that cannot get the lock does not refuse — it hangs, and a
// release that hangs is worse than one that stops and says why. (Measured: with another session holding
// `LOCK TABLES … WRITE`, this migration waited indefinitely until the harness's own timeout killed it.)
const LOCK_WAIT_SECONDS = 15;

async function withExclusiveTable(knex, work) {
  return knex.transaction(async trx => {
    const database = (await read(trx, 'SELECT DATABASE() AS db'))[0].db;
    try {
      await trx.raw(`SET SESSION lock_wait_timeout = ${LOCK_WAIT_SECONDS}`);
      await trx.raw(`LOCK TABLES \`${TABLE}\` WRITE`);
    } catch (error) {
      refuse('c05_sessions_exclusive_entry_unavailable',
        'rolling this back destroys the session history, so it must hold an exclusive lock on ' +
        `\`${TABLE}\` before it counts anything, and the server refused to grant it ` +
        `(${error.code || error.message}). Either another session is using the table — stop the ` +
        `application first — or the account that runs migrations needs LOCK TABLES. It waited ` +
        `${LOCK_WAIT_SECONDS}s rather than hanging. Nothing has been changed by this run.`);
    }
    try {
      const held = await read(trx, `SHOW OPEN TABLES FROM \`${database}\` WHERE In_use > 0`);
      if (!held.some(row => row.Table === TABLE)) {
        refuse('c05_sessions_exclusive_entry_unverified',
          'the lock was requested but the server does not report it as held, so exclusivity cannot be ' +
          'confirmed and nothing has been changed by this run.');
      }
      return await work(trx);
    } finally { await trx.raw('UNLOCK TABLES').catch(() => {}); }
  });
}

exports.down = async function down(knex) {
  const present = await read(knex,
    `SELECT COUNT(*) AS n FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = ?`, [TABLE]);
  if (Number(present[0].n) === 0) return;               // already rolled back; nothing to decide

  await withExclusiveTable(knex, async trx => {
    const counted = await read(trx, `SELECT COUNT(*) AS n FROM \`${TABLE}\``);
    const rows = Number(counted[0].n);
    if (rows > 0) {
      refuse('c05_sessions_not_empty',
        `${rows} row(s) record which student came in from which school and lesson, and how long that ` +
        'is kept has not been decided. Rolling back would delete them. Switch the entry off with ' +
        'C05_STUDENT_ENTRY_ENABLED instead — the table can stay — or remove the rows under their own ' +
        'authorization first. Nothing has been changed by this run.');
    }
    // Still inside the window the server confirmed: no other session can have written since the count.
    await trx.raw(`DROP TABLE IF EXISTS \`${TABLE}\``);
  });
};

exports.table = TABLE;

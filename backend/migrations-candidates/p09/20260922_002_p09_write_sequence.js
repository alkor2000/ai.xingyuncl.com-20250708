'use strict';

// Candidate migration 002: the durable per-write sequence a reconciliation compares against.
//
// 001 creates the tables from store.js SCHEMA, which already carries these two columns, so a fresh
// install needs nothing here. This file exists for a ledger created from the earlier candidate shape.
//
// Two rules it lives by:
//   * It adds what is missing and never decides business state. The difference between `write_seq` and
//     `applied_write_seq` is a work's outstanding reconciliation, and only the service's reconciliation
//     may close it — so a replay on a live ledger must leave 7/3 as 7/3.
//   * Every committed step must leave an outstanding signal behind. The repair of a half state marks the
//     work BEFORE it drops an unverifiable claim, so a process that dies between the two statements
//     leaves a marker (and an applied count ahead of the sequence), never a silent "0/0, nothing to do".
//     `up` starts by looking for exactly that signature and finishes the job.
// Both rules were written after their counter-examples: an unconditional realignment turned 7/3 into
// 7/7, and a three-statement repair that died after clearing the claim left 0/0 with no marker while the
// next run returned immediately. dev/p09-lab/migration-replay.py reproduces both on real MySQL.
//
// Premises, stated separately because they differ:
//   * P09 switched off (the deployed default): nothing writes the ledger. That is the ordinary case —
//     but a switch is a per-process setting, so this migration never treats "it should be off" as proof
//     that every writer is stopped.
//   * P09 switched on: the ordinary branches are a no-op or one additive DDL, and a P09 write refused
//     during that DDL costs nothing (the student's save is unaffected, the hook swallows it and the work
//     stays outstanding for the sweep).
//   * Anything that DECIDES data — the half-state repair and `down` — runs inside an exclusive window
//     the server itself can confirm: the migration pins one connection, takes `LOCK TABLES … WRITE` on
//     the ledger tables, and checks that the server reports the lock held before it writes anything.
//     Every other session is blocked for the whole window, whatever role it uses. If the lock cannot be
//     taken or cannot be verified, the migration REFUSES BY NAME and says what to fix; it never falls
//     back to "the ledger looked quiet for a moment".
//   * Waiting is bounded and the refusal cannot be held up by its own diagnosis. Both halves were
//     measured on real MySQL (dev/p09-lab/lock-wait.py) with another connection holding the ledger:
//     the earlier version never answered at all. `LOCK TABLES` does not fail when the tables are busy —
//     it waits, and MySQL's default `lock_wait_timeout` is a year; the first ledger read in `up` waits
//     the same way, before the lock is even requested (observed: "Waiting for table metadata lock").
//     And the diagnosis that was supposed to describe the refusal read the ledger itself, from a second
//     pooled connection, so it blocked on exactly the tables that were busy — and on a pool of one it
//     would have been waiting for the connection this migration is holding. So: the whole migration now
//     runs on ONE pinned connection with a short session `lock_wait_timeout` (restored before the
//     connection goes back to the pool), a wait that runs out is the named refusal, and the only
//     observation attached to a refusal is server metadata (`SHOW OPEN TABLES`), which cannot block on
//     table data and is skipped entirely if it errors.
//   Measured, not assumed: dev/p09-lab/migration-replay.py holds the lock, proves a second connection's
//   write is blocked across both the DDL and the updates, and lands only after the window closes.
const { TABLES } = require('../../src/services/websiteArtifact/store');

const DDL = Object.freeze({ write_seq: 'BIGINT NOT NULL DEFAULT 0', applied_write_seq: 'BIGINT NOT NULL DEFAULT 0' });
const NAMES = Object.freeze(Object.keys(DDL));
// Long enough for a migration to win a lock against ordinary short writes, short enough that a release
// which cannot get it stops and says why instead of hanging. MySQL's own default is 31536000 seconds.
const LOCK_WAIT_SECONDS = 15;
const CONTENDED = new Set(['ER_LOCK_WAIT_TIMEOUT', 'ER_LOCK_DEADLOCK']);
const contended = error => Boolean(error && (CONTENDED.has(error.code) || [1205, 1213].includes(error.errno)));

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

// An applied count ahead of the sequence it is counted against cannot happen in normal operation: the
// service only ever stores a number it sampled from that same sequence. It is the fingerprint of a
// repair that was interrupted, and it is what makes the repair resumable.
async function interruptedRepairs(knex) {
  const [rows] = await knex.raw(
    `SELECT COUNT(*) AS n FROM \`${TABLES.links}\` WHERE applied_write_seq > write_seq`);
  return Number(rows[0].n);
}

// The only thing attached to a refusal: server metadata about who has the ledger open. It reads the
// table cache, not the tables, so it cannot block on the very lock that caused the refusal — the reason
// the previous version's ledger sample had to go. It authorizes nothing, and if it fails at all the
// refusal is reported without it rather than waiting.
async function heldBy(runner) {
  try {
    const [[current]] = await runner.raw('SELECT DATABASE() AS db');
    const [open] = await runner.raw(`SHOW OPEN TABLES FROM \`${current.db}\` WHERE In_use > 0`);
    const busy = open.map(row => row.Table).filter(name => Object.values(TABLES).includes(name));
    return busy.length ? `the server reports these ledger tables in use: ${busy.join(', ')}`
      : 'the server reports no ledger table in use right now (it may have been released since)';
  } catch (error) {
    return 'the server could not be asked which tables are in use';
  }
}

const refuse = (code, message) => { const error = new Error(`${code}: ${message}`); error.code = code; throw error; };

// The exclusive window every data decision runs inside. The server itself confirms the lock: without
// that confirmation the migration writes nothing at all.
// One pinned connection for the whole migration, with a bounded wait on it.
//
// Everything this file does — the pre-checks, the lock, the repair, the DDL — happens on this one
// connection. That is not tidiness: `knex.raw()` takes a connection from the pool per statement, so a
// second one is a second connection, and on a small pool the second one is the one this migration is
// already holding. The session's `lock_wait_timeout` is restored before the connection goes back to the
// pool, because a connection that carries a 15-second limit into someone else's request is a change
// nobody asked for. `LOCK TABLES` and `ALTER TABLE` commit implicitly, so this transaction is a pinned
// connection rather than an atomic unit — which is exactly what it is used as.
async function withPinnedConnection(knex, work) {
  return knex.transaction(async trx => {
    let previous = null;
    try {
      const [[current]] = await trx.raw('SELECT @@SESSION.lock_wait_timeout AS value');
      previous = Number(current.value);
      await trx.raw(`SET SESSION lock_wait_timeout = ${LOCK_WAIT_SECONDS}`);
    } catch (error) {
      previous = null;                       // could not set it: the wait stays whatever the server says
    }
    try {
      return await work(trx);
    } catch (error) {
      // A wait that ran out means the ledger is busy — the same answer as a lock that could not be
      // taken, and the same refusal, rather than a driver error escaping as if something broke.
      if (contended(error)) {
        refuse('p09_exclusive_entry_unavailable',
          'the P09 ledger is in use by another session, so this migration stopped after waiting ' +
          `${LOCK_WAIT_SECONDS}s rather than holding a release open. Stop the writers (the runtime ` +
          `switch is per process) and run it again — ${await heldBy(trx)}. Nothing has been changed ` +
          'by this run.');
      }
      throw error;
    } finally {
      if (previous !== null) await trx.raw(`SET SESSION lock_wait_timeout = ${previous}`).catch(() => {});
    }
  });
}

// The exclusive window itself, on the connection already pinned above.
async function withExclusiveLedger(runner, work) {
  try {
    await runner.raw(`LOCK TABLES \`${TABLES.links}\` WRITE, \`${TABLES.sequence}\` WRITE`);
  } catch (error) {
    if (contended(error)) throw error;       // a bounded wait that ran out: answered by withPinnedConnection
    refuse('p09_exclusive_entry_unavailable',
      'this migration must hold an exclusive lock on the P09 ledger before it may decide anything, and ' +
      `the server refused to grant it (${error.code || error.message}). Grant LOCK TABLES on ` +
      `\`${TABLES.links}\` and \`${TABLES.sequence}\` to the account that runs migrations, then run it ` +
      `again — ${await heldBy(runner)}. Nothing has been changed by this run.`);
  }
  try {
    const [[current]] = await runner.raw('SELECT DATABASE() AS db');
    const [held] = await runner.raw(`SHOW OPEN TABLES FROM \`${current.db}\` WHERE In_use > 0`);
    if (!held.some(row => row.Table === TABLES.links)) {
      refuse('p09_exclusive_entry_unverified',
        'the lock was requested but the server does not report it as held, so exclusivity cannot be ' +
        'confirmed and nothing has been changed by this run.');
    }
    return await work(runner);
  } finally { await runner.raw('UNLOCK TABLES').catch(() => {}); }
}

// The repair itself, in the only order that survives an interruption: mark first, then drop the claim.
// Both statements are idempotent, so re-running finishes whatever is left.
async function repair(knex) {
  await knex.raw(
    `UPDATE \`${TABLES.links}\` SET sync_pending_at = COALESCE(sync_pending_at, ?) WHERE state = 'active'`,
    [Date.now()]);
  await knex.raw(`UPDATE \`${TABLES.links}\` SET applied_write_seq = 0 WHERE applied_write_seq > write_seq`);
}

exports.up = async function up(knex) {
  return withPinnedConnection(knex, async runner => {
    const columns = await present(runner);

    // 1. Already migrated — including a replay of this very migration. The only reason to write anything
    //    is an interrupted repair; a plain outstanding backlog (7/3) is left exactly as it is.
    if (columns.write_seq && columns.applied_write_seq) {
      if (await interruptedRepairs(runner) === 0) return;
      await withExclusiveLedger(runner, async locked => {
        if (await interruptedRepairs(locked) === 0) return;  // someone finished it while we took the lock
        await repair(locked);
      });
      return;
    }

    // 2. The ordinary upgrade. Both columns arrive together at 0/0: level, claiming nothing, and
    //    identical to how the ledger behaved before the sequence existed (outstanding == marker set).
    if (!columns.write_seq && !columns.applied_write_seq) {
      await add(runner, NAMES);
      return;
    }

    // 3. An interrupted run left `write_seq` behind. The new column starts at 0, so every work that has
    //    observed writes is outstanding until the service reconciles it — the conservative direction.
    if (columns.write_seq) {
      await add(runner, ['applied_write_seq']);
      return;
    }

    // 4. Only `applied_write_seq` survived. It claims work has been projected up to some number, but the
    //    sequence it counted against is gone, so the claim cannot be verified. Every active work is
    //    marked for reconciliation first, and only then is the claim discarded — an interruption in
    //    between leaves the marker, and the next run finishes through case 1.
    await withExclusiveLedger(runner, async locked => {
      const inside = await present(locked);                 // re-read under the lock
      if (!inside.write_seq) await add(locked, ['write_seq']);
      await repair(locked);
    });
  });
};

// Dropping the columns removes the only evidence that a work still owes reconciliation, so the backlog
// is written down as a pending marker first. Level works are left alone, and re-running changes nothing.
exports.down = async function down(knex) {
  return withPinnedConnection(knex, async runner => {
    const columns = await present(runner);
    if (!NAMES.some(name => columns[name])) return;
    await withExclusiveLedger(runner, async locked => {
      const inside = await present(locked);
      const drop = NAMES.filter(name => inside[name]);
      if (!drop.length) return;
      if (inside.write_seq && inside.applied_write_seq) {
        await locked.raw(
          `UPDATE \`${TABLES.links}\` SET sync_pending_at = COALESCE(sync_pending_at, ?)
           WHERE state = 'active' AND applied_write_seq < write_seq`, [Date.now()]);
      }
      await locked.raw(
        `ALTER TABLE \`${TABLES.links}\` ${drop.map(name => `DROP COLUMN \`${name}\``).join(', ')}`);
    });
  });
};

exports.columns = NAMES;

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
//     back to "the ledger looked quiet for a moment". A short activity observation still exists, but
//     only to describe the refusal — it authorizes nothing.
//   Measured, not assumed: dev/p09-lab/migration-replay.py holds the lock, proves a second connection's
//   write is blocked across both the DDL and the updates, and lands only after the window closes.
const { TABLES } = require('../../src/services/websiteArtifact/store');

const DDL = Object.freeze({ write_seq: 'BIGINT NOT NULL DEFAULT 0', applied_write_seq: 'BIGINT NOT NULL DEFAULT 0' });
const NAMES = Object.freeze(Object.keys(DDL));
const ACTIVITY_SAMPLE_MS = 600;

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

// Activity detection, NOT a guarantee: two samples of the ledger's moving parts, used only to describe
// a refusal. Writes can begin the moment the second sample is taken, which is exactly why nothing is
// authorized by it. Bounded: two reads, one short wait, no retry loop.
async function observeActivity(knex) {
  const sample = async () => {
    const [[links]] = await knex.raw(
      `SELECT COUNT(*) AS n, COALESCE(MAX(updated_at), 0) AS newest FROM \`${TABLES.links}\``);
    const [[sequence]] = await knex.raw(
      `SELECT COALESCE(MAX(value), 0) AS value FROM \`${TABLES.sequence}\``);
    return `${links.n}/${links.newest}/${sequence.value}`;
  };
  const before = await sample();
  await new Promise(resolve => setTimeout(resolve, ACTIVITY_SAMPLE_MS));
  return (await sample()) === before ? 'no activity observed in a 600ms window (not a guarantee)'
    : 'the ledger changed while this migration was starting';
}

const refuse = (code, message) => { const error = new Error(`${code}: ${message}`); error.code = code; throw error; };

// The exclusive window every data decision runs inside. The server itself confirms the lock: without
// that confirmation the migration writes nothing at all.
async function withExclusiveLedger(knex, work) {
  return knex.transaction(async trx => {
    const [[current]] = await trx.raw('SELECT DATABASE() AS db');
    try {
      await trx.raw(`LOCK TABLES \`${TABLES.links}\` WRITE, \`${TABLES.sequence}\` WRITE`);
    } catch (error) {
      const hint = await observeActivity(knex).catch(() => 'activity could not be observed');
      refuse('p09_exclusive_entry_unavailable',
        'this migration must hold an exclusive lock on the P09 ledger before it may decide anything, and ' +
        `the server refused to grant it (${error.code || error.message}). Grant LOCK TABLES on ` +
        `\`${TABLES.links}\` and \`${TABLES.sequence}\` to the account that runs migrations, then run it ` +
        `again. Nothing has been changed by this run. Activity detection, for context only: ${hint}.`);
    }
    try {
      const [held] = await trx.raw(`SHOW OPEN TABLES FROM \`${current.db}\` WHERE In_use > 0`);
      if (!held.some(row => row.Table === TABLES.links)) {
        refuse('p09_exclusive_entry_unverified',
          'the lock was requested but the server does not report it as held, so exclusivity cannot be ' +
          'confirmed and nothing has been changed by this run.');
      }
      return await work(trx);
    } finally { await trx.raw('UNLOCK TABLES').catch(() => {}); }
  });
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
  const columns = await present(knex);

  // 1. Already migrated — including a replay of this very migration. The only reason to write anything
  //    is an interrupted repair; a plain outstanding backlog (7/3) is left exactly as it is.
  if (columns.write_seq && columns.applied_write_seq) {
    if (await interruptedRepairs(knex) === 0) return;
    await withExclusiveLedger(knex, async trx => {
      if (await interruptedRepairs(trx) === 0) return;      // someone finished it while we took the lock
      await repair(trx);
    });
    return;
  }

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
  //    sequence it counted against is gone, so the claim cannot be verified. Every active work is marked
  //    for reconciliation first, and only then is the claim discarded — an interruption in between
  //    leaves the marker, and the next run finishes through case 1.
  await withExclusiveLedger(knex, async trx => {
    const inside = await present(trx);                      // re-read under the lock
    if (!inside.write_seq) await add(trx, ['write_seq']);
    await repair(trx);
  });
};

// Dropping the columns removes the only evidence that a work still owes reconciliation, so the backlog
// is written down as a pending marker first. Level works are left alone, and re-running changes nothing.
exports.down = async function down(knex) {
  const columns = await present(knex);
  if (!NAMES.some(name => columns[name])) return;
  await withExclusiveLedger(knex, async trx => {
    const inside = await present(trx);
    const drop = NAMES.filter(name => inside[name]);
    if (!drop.length) return;
    if (inside.write_seq && inside.applied_write_seq) {
      await trx.raw(
        `UPDATE \`${TABLES.links}\` SET sync_pending_at = COALESCE(sync_pending_at, ?)
         WHERE state = 'active' AND applied_write_seq < write_seq`, [Date.now()]);
    }
    await trx.raw(`ALTER TABLE \`${TABLES.links}\` ${drop.map(name => `DROP COLUMN \`${name}\``).join(', ')}`);
  });
};

exports.columns = NAMES;

'use strict';

// Candidate migration for the C05 student entry's school mapping. It lives OUTSIDE backend/migrations
// on purpose: knex only scans that directory, so moving this file is the same act as changing the
// production schema on the next release. Promotion needs its own authorization.
//
// What it adds, and only this: the two columns contract C05 §3.6 names on an EXISTING table —
//   user_groups.edu_school_id  the opaque school_ref edu asserts (never an edu internal id beyond it)
//   user_groups.cohort         which population the group holds; 'student' is the one C05 maps to
// plus the unique index that makes "one active student group per school" a database fact rather than
// a convention. No row is created, no existing row is changed, and nothing outside user_groups is
// touched, so a deployment that applies it and leaves the entry switched off behaves exactly as before.
//
// Until this is promoted the provider runs with `school_source: 'config'`, where the same mapping is a
// preconfigured object in sso_config; the runtime refuses rather than falling back if a deployment asks
// for 'database' without these columns.
const COLUMNS = Object.freeze(['edu_school_id', 'cohort']);
const INDEX = 'uk_user_groups_edu_school_cohort';

// knex's mysql2 client resolves raw() to [rows, fields]; every read here goes through this one place.
const read = async (knex, sql, bindings = []) => {
  const result = await knex.raw(sql, bindings);
  return Array.isArray(result) ? result[0] : (result.rows || result);
};

async function columnNames(knex) {
  const rows = await read(knex,
    `SELECT column_name AS name FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'user_groups'`);
  return new Set(rows.map(row => String(row.name ?? row.COLUMN_NAME ?? row.column_name).toLowerCase()));
}
async function indexPresent(knex) {
  const rows = await read(knex,
    `SELECT COUNT(*) AS present FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'user_groups' AND index_name = ?`, [INDEX]);
  return Number(rows[0].present ?? rows[0].PRESENT) > 0;
}

// Both halves are re-runnable: an interrupted run leaves either the column or no column, and the next
// run looks at information_schema rather than assuming what the previous one reached.
exports.up = async function up(knex) {
  const present = await columnNames(knex);
  if (!present.has('edu_school_id')) {
    await knex.raw(
      "ALTER TABLE `user_groups` ADD COLUMN `edu_school_id` VARCHAR(64) NULL DEFAULT NULL COMMENT 'C05: edu 侧学校标识(school_ref)，仅用于映射查找'");
  }
  if (!present.has('cohort')) {
    await knex.raw(
      "ALTER TABLE `user_groups` ADD COLUMN `cohort` VARCHAR(16) NULL DEFAULT NULL COMMENT 'C05: 组面向的人群，student 表示学生组'");
  }
  // MySQL lets several rows share NULL in a unique index, so every group that is not an edu student
  // group stays outside this constraint entirely.
  if (!(await indexPresent(knex))) {
    await knex.raw(`ALTER TABLE \`user_groups\` ADD UNIQUE KEY \`${INDEX}\` (\`edu_school_id\`, \`cohort\`)`);
  }
};

// Down drops only what up added, index first. A deployment that has already mapped schools in these
// columns loses that mapping, so `down` refuses while any row still carries one rather than silently
// deleting the only record of which group belongs to which school.
exports.down = async function down(knex) {
  const present = await columnNames(knex);
  if (present.has('edu_school_id')) {
    const rows = await read(knex,
      'SELECT COUNT(*) AS mapped FROM `user_groups` WHERE `edu_school_id` IS NOT NULL');
    const mapped = Number(rows[0].mapped ?? rows[0].MAPPED);
    if (mapped > 0) {
      throw new Error(`c05_school_mapping_in_use: ${mapped} user_groups row(s) still carry edu_school_id`);
    }
  }
  if (await indexPresent(knex)) await knex.raw(`ALTER TABLE \`user_groups\` DROP INDEX \`${INDEX}\``);
  for (const column of COLUMNS) {
    if (present.has(column)) await knex.raw(`ALTER TABLE \`user_groups\` DROP COLUMN \`${column}\``);
  }
};

exports.columns = COLUMNS;
exports.index = INDEX;

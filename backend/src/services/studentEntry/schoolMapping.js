'use strict';

// edu's `school_ref` → this platform's student group. Two sources, both of them explicit:
//   * 'database' is the contract's own shape — user_groups(edu_school_id = ref, cohort = 'student',
//     is_active = 1) — and needs the candidate migration in migrations-candidates/c05;
//   * 'config' is the preconfigured map this default-off candidate runs with when no DDL has been
//     applied.
// Nothing here ever falls back to matching a group by name, by tag or by "the only student-looking
// group": an unmapped school is `school_not_provisioned`, full stop.
const { fail } = require('./errors');

async function columnsPresent(query) {
  const { rows } = await query(
    `SELECT COUNT(*) AS present FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'user_groups'
        AND column_name IN ('edu_school_id', 'cohort')`, []);
  return Number(rows[0] && (rows[0].present ?? rows[0].PRESENT)) === 2;
}

async function resolveSchoolGroup(query, settings, schoolRef) {
  if (settings.schoolSource === 'database') {
    // A deployment that says 'database' but has not applied the candidate migration is misconfigured;
    // it must not quietly fall back to the config map.
    if (!(await columnsPresent(query))) fail('config_invalid', 503);
    const { rows } = await query(
      `SELECT id FROM user_groups
        WHERE edu_school_id = ? AND cohort = 'student' AND is_active = 1 LIMIT 2`, [schoolRef]);
    if (rows.length !== 1) fail('school_not_provisioned', 409);
    return Number(rows[0].id);
  }
  const groupId = settings.schools[schoolRef];
  if (!Number.isInteger(groupId)) fail('school_not_provisioned', 409);
  return groupId;
}
module.exports = { resolveSchoolGroup, columnsPresent };

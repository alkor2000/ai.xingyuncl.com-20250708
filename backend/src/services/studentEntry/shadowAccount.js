'use strict';

// The student's shadow account on the practice platform, created or refreshed inside ONE transaction.
//
// What this module will not do, and why:
//   * It never creates an account engine of its own — the columns, the group pool and the tags are the
//     platform's existing ones (users / user_groups / user_tags / user_tag_relations), written in the
//     order and with the semantics the C05 contract §4 describes.
//   * It never takes over an account that is not an SSO student (a teacher, an admin, or a local
//     account that happens to carry the same uuid): that is `subject_not_student`, not a login.
//   * It never invents an issuance amount. D-13 has not been decided, so with no explicit policy a
//     FIRST login is refused by name (`issuance_policy_missing`) instead of guessing a number of
//     credits. Returning students need no such value and are unaffected.
//   * Credits only ever move between a student and the pool of the group that student is in: a grant
//     charges the mapped group's own pool under `FOR UPDATE`, a move gives the unspent remainder back
//     to the pool it came from, and an exhausted pool grants zero (contract §4) rather than borrowing.
//   * Row locks are taken in a fixed order — the user row, then the group rows by ascending id — so two
//     concurrent logins cannot deadlock each other.
const { randomBytes } = require('node:crypto');
const { fail } = require('./errors');

const UUID_SAFE = /^[A-Za-z0-9._:-]{8,100}$/;
const CONTROL = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + String.fromCharCode(127) + ']', 'g');
const nameOf = uuid => `s_${uuid.replace(/-/g, '').slice(0, 16)}`;
const suffix = () => randomBytes(2).toString('hex').slice(0, 2);
const clip = (value, max) => String(value ?? '').replace(CONTROL, '').slice(0, max);
const first = rows => (Array.isArray(rows) ? rows[0] : undefined);

// Tags are overwritten from the newest payload, with the platform's own semantics (UserTagService
// .updateUserTags): every relation is replaced and `users.tag_count` follows. 年级/班级 come from edu
// and nothing else is inferred — no tag is ever derived from a display name.
async function writeTags(query, { userId, groupId, tags, operatorId = null }) {
  const wanted = [];
  for (const [prefix, value] of tags) {
    const text = clip(value, 40);
    if (!text) continue;
    const name = `${prefix}:${text}`;
    const { rows: found } = await query(
      'SELECT id FROM user_tags WHERE group_id = ? AND name = ? LIMIT 1', [groupId, name]);
    let tagId = first(found)?.id;
    if (!tagId) {
      const { rows: created } = await query(
        'INSERT INTO user_tags(group_id, name, created_by) VALUES(?,?,?)', [groupId, name, operatorId]);
      tagId = created.insertId;
    }
    if (!wanted.includes(tagId)) wanted.push(tagId);
  }
  await query('DELETE FROM user_tag_relations WHERE user_id = ?', [userId]);
  for (const tagId of wanted) {
    await query('INSERT INTO user_tag_relations(user_id, tag_id, assigned_by) VALUES(?,?,?)',
      [userId, tagId, operatorId]);
  }
  await query('UPDATE users SET tag_count = ? WHERE id = ?', [wanted.length, userId]);
  return wanted.length;
}

// Lock the groups this login touches, ascending by id, and hand back a map. A target group that does
// not exist or is switched off is `school_not_provisioned`: a mapping that points nowhere is not a
// reason to put a student somewhere else.
async function lockGroups(query, ids) {
  const unique = [...new Set(ids.filter(id => Number.isInteger(id) && id > 0))].sort((a, b) => a - b);
  const groups = new Map();
  for (const id of unique) {
    const { rows } = await query(
      `SELECT id, is_active, credits_pool, credits_pool_used, user_limit, expire_date
         FROM user_groups WHERE id = ? FOR UPDATE`, [id]);
    const group = first(rows);
    if (group) groups.set(Number(group.id), group);
  }
  return groups;
}

// How much this first login may grant. Pure: the caller charges the pool only once the account exists.
function planIssue(group, issuance) {
  if (!issuance) fail('issuance_policy_missing', 503);
  if (issuance.mode === 'none') return { granted: 0, fromPool: false, expireDays: null };
  const remaining = Math.max(0, Number(group.credits_pool || 0) - Number(group.credits_pool_used || 0));
  return {
    granted: Math.min(Math.max(0, Number(issuance.amount || 0)), remaining),
    fromPool: true,
    expireDays: Number.isInteger(issuance.expire_days) ? issuance.expire_days : 365
  };
}
const chargePool = (query, groupId, granted) => (granted > 0
  ? query('UPDATE user_groups SET credits_pool_used = credits_pool_used + ? WHERE id = ?', [granted, groupId])
  : Promise.resolve());

// Give back what the student never spent, to the pool it came from, and never below zero.
async function recycleToPool(query, groupId, amount) {
  if (!(amount > 0)) return 0;
  await query(
    'UPDATE user_groups SET credits_pool_used = GREATEST(0, credits_pool_used - ?) WHERE id = ?',
    [amount, groupId]);
  return amount;
}

// Contract §4 leaves `user_limit` on a mapped student group as "does not apply, or is raised by one".
// `ignore` (the default) lets the login through without touching a number an administrator set;
// `auto_expand` raises the limit instead. Neither turns a full group into a refusal, because a student
// who is already enrolled in edu cannot be told to come back when a seat frees up.
async function applySeatPolicy(query, group, policy) {
  const limit = Number(group.user_limit || 0);
  if (!(limit > 0)) return { seat_policy: 'no_limit' };
  const { rows } = await query(
    'SELECT COUNT(*) AS members FROM users WHERE group_id = ? AND deleted_at IS NULL', [group.id]);
  const members = Number(first(rows)?.members || 0);
  if (members < limit) return { seat_policy: 'within_limit' };
  if (policy === 'auto_expand') {
    await query('UPDATE user_groups SET user_limit = user_limit + 1 WHERE id = ?', [group.id]);
    return { seat_policy: 'expanded' };
  }
  return { seat_policy: 'ignored' };
}

const expiryDate = days => {
  if (!Number.isInteger(days) || days <= 0) return null;
  const at = new Date();
  at.setDate(at.getDate() + days);
  return at;
};

async function upsertStudent(query, {
  uuid, profile, org, groupId, issuance, groupChange, userLimit = 'ignore', passwordHash,
  operatorId = null
}) {
  if (typeof uuid !== 'string' || !UUID_SAFE.test(uuid)) fail('invalid_request');
  if (typeof passwordHash !== 'string' || passwordHash.length < 20) fail('internal_error', 500);

  // The user row first, then the groups: one fixed order for every caller.
  const { rows: existingRows } = await query(
    `SELECT id, uuid, uuid_source, role, status, group_id, username, credits_quota, used_credits
       FROM users WHERE uuid = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`, [uuid]);
  const existing = first(existingRows);
  const currentGroupId = existing ? Number(existing.group_id) : null;
  const groups = await lockGroups(query, [groupId, currentGroupId]);
  const group = groups.get(groupId);
  if (!group || Number(group.is_active) !== 1) fail('school_not_provisioned', 409);

  const remark = `[姓名]${clip(profile?.display_name, 60)}`;
  const accountExpireAt = group.expire_date ? new Date(group.expire_date) : null;
  const tags = [['年级', org?.grade_name], ['班级', org?.class_name]];

  if (existing) {
    // An assertion about a student may never take over anything else.
    if (existing.role !== 'user' || existing.uuid_source !== 'sso') fail('subject_not_student', 403);
    if (existing.status !== 'active') fail('subject_disabled', 403);

    let moved = null;
    if (currentGroupId !== groupId) {
      // A school or class change means credits move between pools, so it happens here or not at all.
      if (groupChange !== 'move_and_recycle') fail('group_change_refused', 409);
      const previous = groups.get(currentGroupId);
      const remaining = Math.max(0,
        Number(existing.credits_quota || 0) - Number(existing.used_credits || 0));
      const recycled = previous ? await recycleToPool(query, previous.id, remaining) : 0;
      const seat = await applySeatPolicy(query, group, userLimit);
      await query(
        `UPDATE users SET group_id = ?, credits_quota = 0, used_credits = 0, credits_expire_at = NULL
          WHERE id = ?`, [groupId, existing.id]);
      // Tags belong to a group, so the ones from the old group go with it.
      await query('DELETE FROM user_tag_relations WHERE user_id = ?', [existing.id]);
      moved = { from_group_id: currentGroupId, to_group_id: groupId, recycled,
        recycled_to_pool: Boolean(previous), ...seat };
    }
    await query('UPDATE users SET remark = ?, expire_at = ?, last_login_at = NOW() WHERE id = ?',
      [remark, accountExpireAt, existing.id]);
    const tagged = await writeTags(query, { userId: existing.id, groupId, tags, operatorId });
    return { userId: existing.id, created: false, username: existing.username, granted: 0, moved, tags: tagged };
  }

  // A new shadow account. The pool is charged only after a row actually exists, so a username retry or
  // a lost race can never leave credits deducted for an account that was never created.
  const plan = planIssue(group, issuance);
  const seat = await applySeatPolicy(query, group, userLimit);
  const base = nameOf(uuid);
  let username = base;
  let userId = null;
  for (let attempt = 0; attempt < 4 && userId === null; attempt += 1) {
    if (attempt > 0) username = `${base.slice(0, 14)}${suffix()}`;
    try {
      const { rows } = await query(
        `INSERT INTO users(uuid, uuid_source, email, username, password_hash, phone, role, group_id,
           status, remark, token_quota, credits_quota, used_credits, credits_expire_at, expire_at,
           last_login_at, created_at, updated_at)
         VALUES(?, 'sso', ?, ?, ?, NULL, 'user', ?, 'active', ?, 10000, ?, 0, ?, ?, NOW(), NOW(), NOW())`,
        [uuid, `${uuid}@sso.local`, username, passwordHash, groupId, remark, plan.granted,
          plan.granted > 0 ? expiryDate(plan.expireDays) : null, accountExpireAt]);
      userId = rows.insertId;
    } catch (error) {
      if (!(error && (error.code === 'ER_DUP_ENTRY' || error.errno === 1062))) throw error;
      // Which unique key gave way decides what happens next: the same student logging in twice at once
      // joins the account that won, while a username collision is retried with a new suffix.
      const { rows: raced } = await query(
        `SELECT id, username, role, uuid_source, status FROM users
          WHERE uuid = ? AND deleted_at IS NULL LIMIT 1`, [uuid]);
      const winner = first(raced);
      if (winner) {
        if (winner.role !== 'user' || winner.uuid_source !== 'sso') fail('subject_not_student', 403);
        if (winner.status !== 'active') fail('subject_disabled', 403);
        const tagged = await writeTags(query, { userId: winner.id, groupId, tags, operatorId });
        return { userId: winner.id, created: false, raced: true, username: winner.username,
          granted: 0, moved: null, tags: tagged };
      }
    }
  }
  if (userId === null) fail('username_conflict', 409);
  await chargePool(query, groupId, plan.fromPool ? plan.granted : 0);
  const tagged = await writeTags(query, { userId, groupId, tags, operatorId });
  return { userId, created: true, username, granted: plan.granted, moved: null, tags: tagged, ...seat };
}
module.exports = { upsertStudent, writeTags, planIssue, applySeatPolicy, recycleToPool, nameOf };

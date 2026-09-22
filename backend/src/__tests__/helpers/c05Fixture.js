'use strict';

// In-memory stand-in for the four tables the C05 student entry writes: users, user_groups, user_tags
// and user_tag_relations. It answers the exact statements shadowAccount.js and schoolMapping.js issue,
// and it keeps the two properties those modules lean on — a unique `uuid`, a unique `username`, and a
// duplicate that arrives as ER_DUP_ENTRY. The isolated harness runs the same modules against real
// MySQL 8; this fixture is for the unit tests only.
const { randomUUID } = require('node:crypto');

function createMemoryDb({ groups = [], users = [], columns = { edu_school_id: false, cohort: false } } = {}) {
  const data = {
    groups: new Map(groups.map(row => [Number(row.id), {
      id: Number(row.id), is_active: 1, credits_pool: 0, credits_pool_used: 0, user_limit: 0,
      expire_date: null, edu_school_id: null, cohort: null, ...row
    }])),
    users: new Map(users.map((row, index) => [Number(row.id ?? index + 1), {
      id: Number(row.id ?? index + 1), uuid_source: 'sso', role: 'user', status: 'active',
      credits_quota: 0, used_credits: 0, deleted_at: null, tag_count: 0, ...row
    }])),
    tags: new Map(), relations: [], nextUser: 100, nextTag: 500, statements: []
  };
  const duplicate = key => {
    const error = new Error(`Duplicate entry for key '${key}'`);
    error.code = 'ER_DUP_ENTRY';
    error.errno = 1062;
    return error;
  };
  const live = () => [...data.users.values()].filter(row => row.deleted_at === null);

  async function query(sql, params = []) {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    data.statements.push(text);

    if (text.includes('information_schema.columns')) {
      const present = (columns.edu_school_id ? 1 : 0) + (columns.cohort ? 1 : 0);
      return { rows: [{ present }] };
    }
    if (text.startsWith('SELECT id FROM user_groups') && text.includes('edu_school_id')) {
      return { rows: [...data.groups.values()]
        .filter(row => row.edu_school_id === params[0] && row.cohort === 'student' && Number(row.is_active) === 1)
        .map(row => ({ id: row.id })) };
    }
    if (text.startsWith('SELECT id, is_active, credits_pool')) {
      const group = data.groups.get(Number(params[0]));
      return { rows: group ? [{ ...group }] : [] };
    }
    if (text.startsWith('SELECT id, uuid, uuid_source')) {
      return { rows: live().filter(row => row.uuid === params[0]).map(row => ({ ...row })) };
    }
    if (text.startsWith('SELECT id, username, role, uuid_source, status')) {
      return { rows: live().filter(row => row.uuid === params[0]).map(row => ({ ...row })) };
    }
    if (text.includes('COUNT(*) AS members')) {
      return { rows: [{ members: live().filter(row => Number(row.group_id) === Number(params[0])).length }] };
    }
    if (text.startsWith('SELECT id FROM user_tags')) {
      const found = [...data.tags.values()]
        .find(row => Number(row.group_id) === Number(params[0]) && row.name === params[1]);
      return { rows: found ? [{ id: found.id }] : [] };
    }
    if (text.startsWith('INSERT INTO user_tags')) {
      const id = (data.nextTag += 1);
      data.tags.set(id, { id, group_id: Number(params[0]), name: params[1], created_by: params[2] });
      return { rows: { insertId: id } };
    }
    if (text.startsWith('INSERT INTO user_tag_relations')) {
      data.relations.push({ user_id: Number(params[0]), tag_id: Number(params[1]) });
      return { rows: { insertId: data.relations.length } };
    }
    if (text.startsWith('DELETE FROM user_tag_relations')) {
      data.relations = data.relations.filter(row => row.user_id !== Number(params[0]));
      return { rows: { affectedRows: 1 } };
    }
    if (text.startsWith('INSERT INTO users')) {
      const [uuid, email, username, passwordHash, groupId, remark, creditsQuota, creditsExpireAt, expireAt] = params;
      if (live().some(row => row.uuid === uuid)) throw duplicate('users.uuid');
      if (live().some(row => row.username === username)) throw duplicate('users.username');
      const id = (data.nextUser += 1);
      data.users.set(id, { id, uuid, uuid_source: 'sso', email, username, password_hash: passwordHash,
        role: 'user', group_id: Number(groupId), status: 'active', remark, token_quota: 10000,
        credits_quota: Number(creditsQuota), used_credits: 0, credits_expire_at: creditsExpireAt,
        expire_at: expireAt, deleted_at: null, tag_count: 0 });
      return { rows: { insertId: id } };
    }
    if (text.startsWith('UPDATE user_groups SET credits_pool_used = credits_pool_used +')) {
      const group = data.groups.get(Number(params[1]));
      group.credits_pool_used = Number(group.credits_pool_used) + Number(params[0]);
      return { rows: { affectedRows: 1 } };
    }
    if (text.includes('GREATEST(0, credits_pool_used -')) {
      const group = data.groups.get(Number(params[1]));
      group.credits_pool_used = Math.max(0, Number(group.credits_pool_used) - Number(params[0]));
      return { rows: { affectedRows: 1 } };
    }
    if (text.startsWith('UPDATE user_groups SET user_limit')) {
      const group = data.groups.get(Number(params[0]));
      group.user_limit = Number(group.user_limit) + 1;
      return { rows: { affectedRows: 1 } };
    }
    if (text.startsWith('UPDATE users SET group_id')) {
      const user = data.users.get(Number(params[1]));
      Object.assign(user, { group_id: Number(params[0]), credits_quota: 0, used_credits: 0, credits_expire_at: null });
      return { rows: { affectedRows: 1 } };
    }
    if (text.startsWith('UPDATE users SET remark')) {
      const user = data.users.get(Number(params[2]));
      Object.assign(user, { remark: params[0], expire_at: params[1], last_login_at: new Date() });
      return { rows: { affectedRows: 1 } };
    }
    if (text.startsWith('UPDATE users SET tag_count')) {
      const user = data.users.get(Number(params[1]));
      user.tag_count = Number(params[0]);
      return { rows: { affectedRows: 1 } };
    }
    throw new Error(`c05Fixture: unhandled statement ${text}`);
  }

  return {
    data,
    query,
    // One transaction object per call, like dbConnection.transaction(callback).
    async transaction(callback) { return callback(query); },
    tagNamesOf(userId) {
      return data.relations.filter(row => row.user_id === Number(userId))
        .map(row => data.tags.get(row.tag_id)?.name).sort();
    }
  };
}

// Redis stand-in with the three operations the handoff store uses, plus a switch for "Redis is gone".
function createMemoryRedis({ now = Date.now } = {}) {
  const store = new Map();
  const state = { connected: true };
  const alive = key => {
    const row = store.get(key);
    if (!row) return null;
    if (row.expiresAt !== null && row.expiresAt <= now()) { store.delete(key); return null; }
    return row;
  };
  return {
    get isConnected() { return state.connected; },
    disconnect() { state.connected = false; },
    store,
    async setIfAbsent(key, value, seconds = null) {
      if (alive(key)) return false;
      store.set(key, { value, expiresAt: seconds ? now() + seconds * 1000 : null });
      return true;
    },
    async getDel(key) {
      const row = alive(key);
      if (!row) return null;
      store.delete(key);
      return row.value;
    },
    async incrWithExpiry(key, seconds) {
      const row = alive(key);
      const count = Number(row ? row.value : 0) + 1;
      store.set(key, { value: count, expiresAt: row ? row.expiresAt : now() + seconds * 1000 });
      return count;
    },
    expire(key) { const row = store.get(key); if (row) row.expiresAt = now() - 1; }
  };
}

// A synthetic edu issuer: it signs exactly the way the contract says, so a test that changes the bytes
// changes the signature, and a test that changes the signature is not accidentally still valid.
function createIssuer({ secret, platformKey = 'edu', now = Date.now }) {
  const { createHmac, createHash } = require('node:crypto');
  return function sign(payload, overrides = {}) {
    const body = Buffer.from(JSON.stringify({ schema_version: 1, platform_key: platformKey, ...payload }), 'utf8');
    const timestamp = overrides.timestamp ?? Math.floor(now() / 1000);
    const nonce = overrides.nonce ?? randomUUID().replace(/-/g, '');
    const signature = overrides.signature ?? createHmac('sha256', overrides.secret ?? secret)
      .update(`${timestamp}\n${nonce}\n${createHash('sha256').update(body).digest('hex')}`).digest('hex');
    return { rawBody: body, headers: { 'x-edu-timestamp': String(timestamp), 'x-edu-nonce': nonce,
      'x-edu-signature': signature } };
  };
}

module.exports = { createMemoryDb, createMemoryRedis, createIssuer };

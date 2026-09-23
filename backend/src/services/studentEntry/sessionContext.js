'use strict';

// What a C05 session is allowed to remember, and where it is kept.
//
// Contract §4 says the lesson/assignment the student came from travels with the session. Returning it
// once to the browser is not that: a refresh or a second tab would have nothing to read, and nothing on
// the server could say which school and which group that session was issued for. So one row is written
// when the handoff is spent, bound to the access token's jti and to the account, inside the same
// transaction that verified the student — either the session exists with its context, or it does not
// exist at all.
//
// What is deliberately NOT here:
//   * the token. Only its jti (which is already in the token the browser holds) and the digest of the
//     spent handoff are stored; neither can be turned back into a credential.
//   * a retention or cleanup policy. How long these rows are kept is a decision nobody has made, so
//     this module never deletes anything; `expires_at` records when the session stopped being valid.
//   * anything resembling an authorization. A row here says where the student came from. Associating a
//     work still needs its own signed task context and the student's own confirmation.
const { fail } = require('./errors');

const TABLE = 'c05_sessions';

// One source of truth for the DDL: the candidate migration replays these bytes.
const SCHEMA = Object.freeze([
  `CREATE TABLE IF NOT EXISTS \`${TABLE}\` (
     \`id\` BIGINT NOT NULL AUTO_INCREMENT,
     \`jti\` VARCHAR(128) NOT NULL COMMENT '该会话 access token 的 jti，不存 token 本身',
     \`user_id\` BIGINT NOT NULL,
     \`platform_key\` VARCHAR(32) NOT NULL,
     \`instance_key\` VARCHAR(64) NULL DEFAULT NULL,
     \`school_ref\` VARCHAR(64) NOT NULL COMMENT 'edu 侧学校标识，只用于映射与核对',
     \`group_id\` BIGINT NOT NULL,
     \`lesson_ref\` VARCHAR(64) NULL DEFAULT NULL,
     \`assignment_ref\` VARCHAR(64) NULL DEFAULT NULL,
     \`handoff_digest\` CHAR(64) NOT NULL COMMENT 'sha256(handoff)，只存摘要',
     \`issued_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     \`expires_at\` TIMESTAMP NOT NULL,
     \`revoked_at\` TIMESTAMP NULL DEFAULT NULL,
     PRIMARY KEY (\`id\`),
     UNIQUE KEY \`uk_c05_sessions_jti\` (\`jti\`),
     UNIQUE KEY \`uk_c05_sessions_handoff\` (\`handoff_digest\`),
     KEY \`ix_c05_sessions_user\` (\`user_id\`),
     KEY \`ix_c05_sessions_expires\` (\`expires_at\`)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='C05 学生入口会话上下文（候选）'`
]);

// The table only exists where the candidate migration has been applied. A deployment that switched the
// entry on without it is misconfigured, and says so before a student ever arrives — rather than letting
// the exchange succeed and the landing fail with a session that remembers nothing.
async function ready(query) {
  const { rows } = await query(
    `SELECT COUNT(*) AS present FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = ?`, [TABLE]);
  return Number(rows[0] && (rows[0].present ?? rows[0].PRESENT)) === 1;
}

// Written inside the consume transaction. The unique key on handoff_digest is a second, durable
// one-time guarantee: even if the Redis consume were somehow replayed, the row could not be written a
// second time.
async function record(query, session) {
  try {
    await query(
      `INSERT INTO \`${TABLE}\`(jti, user_id, platform_key, instance_key, school_ref, group_id,
         lesson_ref, assignment_ref, handoff_digest, issued_at, expires_at)
       VALUES(?,?,?,?,?,?,?,?,?,NOW(),?)`,
      [session.jti, session.userId, session.platformKey, session.instanceKey || null, session.schoolRef,
        session.groupId, session.lessonRef || null, session.assignmentRef || null, session.handoffDigest,
        new Date(session.expiresAt)]);
  } catch (error) {
    if (error && (error.code === 'ER_DUP_ENTRY' || error.errno === 1062)) fail('handoff_invalid', 401);
    if (error && (error.code === 'ER_NO_SUCH_TABLE' || error.errno === 1146)) fail('session_store_unavailable', 503, true);
    throw error;
  }
}

// Read by the session itself: the jti comes from the verified token and the account from the verified
// user, so a token that is not this session's, and an account that is not this session's account, find
// nothing — the query never answers "it exists, but not for you".
async function read(query, { jti, userId }) {
  const { rows } = await query(
    `SELECT platform_key, instance_key, school_ref, group_id, lesson_ref, assignment_ref,
            issued_at, expires_at
       FROM \`${TABLE}\`
      WHERE jti = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > NOW() LIMIT 1`,
    [jti, userId]);
  return rows[0] || null;
}

module.exports = { TABLE, SCHEMA, ready, record, read };

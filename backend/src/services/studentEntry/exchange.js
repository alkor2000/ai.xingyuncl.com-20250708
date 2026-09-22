'use strict';

// The C05 provider: edu's server calls `exchange`, the student's browser calls `consume`.
//
// The order of checks is the contract's, and it is fail-closed at every step: source address, platform,
// freshness, nonce, signature, subject, school, landing. Only after all of them does anything get
// written, and the browser never receives more than a one-time ticket.
const { createHash, createHmac, randomBytes } = require('node:crypto');
const bcrypt = require('bcryptjs');
const { fail } = require('./errors');
const { signatureMatches } = require('./handoff');
const { upsertStudent } = require('./shadowAccount');
const { resolveSchoolGroup } = require('./schoolMapping');
const { normaliseEntry } = require('./landings');
const sessionContext = require('./sessionContext');

const NONCE = /^[A-Za-z0-9_-]{16,128}$/;
const REF = /^[A-Za-z0-9._:-]{1,64}$/;
const FIELDS = Object.freeze(['schema_version', 'platform_key', 'subject', 'profile', 'org', 'landing', 'context',
  'issued_at', 'expires_at']);
const sha256 = value => createHash('sha256').update(value).digest('hex');

// The address the request really came from. A proxy header is only believed when the deployment has
// said how many proxies sit in front of this service; with none configured, the socket is the truth.
// Hops are counted the way Express counts `trust proxy: n` — the socket peer is hop 1 — so a header
// that an untrusted client sent along cannot move the source address by itself.
function sourceAddress(req, trustedProxyHops) {
  const socket = (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || '';
  const direct = String(socket).replace(/^::ffff:/, '');
  if (!trustedProxyHops) return direct;
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map(value => value.trim()).filter(Boolean);
  if (!forwarded.length) return direct;
  const index = forwarded.length - trustedProxyHops;
  return (index >= 0 ? forwarded[index] : forwarded[0]).replace(/^::ffff:/, '');
}

// The signature covers the bytes that are parsed, so no canonicalisation step can disagree with what
// was verified: HMAC(secret, timestamp + "\n" + nonce + "\n" + sha256(raw body)).
function expectedSignature(secret, timestamp, nonce, rawBody) {
  return createHmac('sha256', secret).update(`${timestamp}\n${nonce}\n${sha256(rawBody)}`).digest('hex');
}

function parsePayload(rawBody, settings, nowSeconds) {
  let payload;
  try { payload = JSON.parse(rawBody.toString('utf8')); } catch { fail('invalid_request'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('invalid_request');
  if (Object.keys(payload).some(key => !FIELDS.includes(key))) fail('invalid_request');
  if (payload.schema_version !== 1) fail('invalid_request');
  if (payload.platform_key !== settings.platformKey) fail('platform_disabled', 403);

  const subject = payload.subject;
  if (!subject || typeof subject !== 'object' || typeof subject.uuid !== 'string' || subject.uuid.length < 8) fail('invalid_request');
  if (subject.cohort !== 'student') fail('cohort_not_supported', 400);
  if (subject.status !== 'active') fail('subject_disabled', 403);

  const org = payload.org;
  if (!org || typeof org !== 'object' || typeof org.school_ref !== 'string' || !REF.test(org.school_ref)) fail('invalid_request');

  const asked = payload.landing && typeof payload.landing === 'object' ? payload.landing.entry : 'dashboard';
  const entry = normaliseEntry(asked, settings.landings);
  if (!entry) fail('entry_not_allowed', 400);

  if (!Number.isSafeInteger(payload.issued_at) || !Number.isSafeInteger(payload.expires_at)) fail('invalid_request');
  if (payload.expires_at <= payload.issued_at || payload.expires_at > payload.issued_at + 300) fail('invalid_request');
  if (nowSeconds >= payload.expires_at) fail('stale_timestamp', 401);

  const context = payload.context === undefined || payload.context === null ? null : payload.context;
  if (context !== null && (typeof context !== 'object' || Array.isArray(context) ||
      Object.keys(context).some(key => !['lesson_id', 'assignment_id'].includes(key)))) fail('invalid_request');
  const profile = payload.profile && typeof payload.profile === 'object' && !Array.isArray(payload.profile)
    ? payload.profile : {};
  return { payload, subject, org, entry, context, profile };
}

// A whole class logging in at once is the normal case for this entry, and two first logins for the same
// student legitimately contend for the same index gap, so InnoDB may pick one and roll it back. That is
// a retryable condition, not a failure: the transaction is keyed by uuid and re-running it is safe. If
// it still cannot get through, the refusal says `storage_unavailable` (retryable) rather than pretending
// something about the student was wrong.
const CONTENDED = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);
const contended = error => Boolean(error && (CONTENDED.has(error.code) || CONTENDED.has(error.original?.code)
  || [1213, 1205].includes(error.errno)));

async function withRetry(work, attempts = 3) {
  for (let attempt = 1; ; attempt += 1) {
    try { return await work(); } catch (error) {
      if (!contended(error) || attempt >= attempts) {
        if (contended(error)) fail('storage_unavailable', 503, true);
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 15 * attempt + Math.floor(Math.random() * 20)));
    }
  }
}

// '12h' / '45m' / '3600' → seconds. Only used to record when the session stops being valid; the token
// itself is signed by TokenService from the same string.
const TTL = /^(\d+)\s*([smhd])?$/;
function accessSeconds(value) {
  const match = TTL.exec(String(value || '').trim());
  if (!match) return 12 * 3600;
  const unit = { s: 1, m: 60, h: 3600, d: 86400 }[match[2] || 's'];
  return Number(match[1]) * unit;
}

function createStudentEntry({ settings, store, db, models, now = Date.now, logger = null, deps = {} }) {
  if (!settings || !settings.enabled || !store || !db) fail('student_entry_disabled', 503);
  if (!deps.TokenService) deps = { ...deps, TokenService: require('../auth/TokenService') };

  // edu → practice. Server to server, signed, IP-bounded, single use per nonce.
  async function exchange({ rawBody, headers, req }) {
    const timestamp = headers['x-edu-timestamp'];
    const nonce = headers['x-edu-nonce'];
    const signature = headers['x-edu-signature'];
    const nowSeconds = Math.floor(now() / 1000);

    const address = sourceAddress(req, settings.trustedProxyHops);
    if (settings.ipWhitelistEnabled && !settings.allowedIps.includes(address)) fail('ip_not_allowed', 403);
    if (typeof nonce !== 'string' || !NONCE.test(nonce)) fail('invalid_request');
    const seconds = Number(timestamp);
    if (!Number.isSafeInteger(seconds) || Math.abs(nowSeconds - seconds) > settings.signatureValidSeconds) {
      fail('stale_timestamp', 401);
    }
    if (!Buffer.isBuffer(rawBody) || rawBody.length === 0 || rawBody.length > 16 * 1024) fail('invalid_request');
    if (!signatureMatches(expectedSignature(settings.secret, seconds, nonce, rawBody), signature)) {
      fail('invalid_signature', 401);
    }
    // The nonce is burned only after the signature held, so a wrong guess cannot exhaust a real one.
    await store.rememberNonce(nonce, Math.max(600, settings.signatureValidSeconds * 2));

    const { subject, org, entry, context, profile } = parsePayload(rawBody, settings, nowSeconds);
    // Contract §3.7: the limit on this endpoint is per student, not per source address.
    await store.hitSubject(subject.uuid, settings.subjectRatePerMinute);

    // bcrypt is deliberately slow, so the hash for a possible new account is computed before the
    // transaction opens rather than while it holds the group row.
    const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 10);

    // One transaction: the school is mapped, the rows are locked, the account is created or refreshed,
    // the pool is charged or repaid and the tags are rewritten — or none of it happens.
    const account = await withRetry(() => db.transaction(async query => {
      const groupId = await resolveSchoolGroup(query, settings, org.school_ref);
      const result = await upsertStudent(query, {
        uuid: subject.uuid, profile, org, groupId, passwordHash,
        issuance: settings.issuance, groupChange: settings.groupChange, userLimit: settings.userLimit
      });
      return { ...result, groupId };
    }));

    // The ticket pins what this login is for. Sixty seconds later `consume` reads the current state and
    // requires it to still match: who the account is, which deployment and platform issued the ticket,
    // which school it was issued for and which group that school mapped to at the time.
    const issued = await store.issue({
      user_id: account.userId, uuid: subject.uuid, entry,
      platform_key: settings.platformKey, instance: settings.instanceKey || null,
      school_ref: org.school_ref, group_id: account.groupId,
      // The lesson/assignment the student came from travels with the session for P09 to *offer* a
      // link. It is not a task grant: associating a work still needs its own signed context.
      context: context ? { lesson_id: context.lesson_id ?? null, assignment_id: context.assignment_id ?? null } : null,
      issued_at: now()
    }, settings.handoffTtlSeconds);

    if (logger) {
      // Counters only: no uuid, no name, no ticket, no signature.
      try {
        logger.info('C05 exchange', { created: account.created, granted: account.granted,
          moved: Boolean(account.moved), entry });
      } catch { /* never fatal */ }
    }
    return { schema_version: 1, handoff: issued.ticket, expires_at: issued.expires_at,
      landing: { entry }, account: { created: account.created } };
  }

  // browser → practice. The ticket is spent here — atomically, once — and everything the ticket claimed
  // is checked again against the state as it is NOW, not as it was when edu asked.
  //
  // A ticket is not a decision that keeps. In the sixty seconds it lives, an administrator can promote
  // the account, switch it off, let it expire, close the school, point the school at a different group,
  // or another login can move the student; each of those must stop this ticket rather than be carried
  // past by it. The re-check, the token and the session row happen in ONE transaction from ONE read, so
  // nothing signs a token for an identity that was read at some other moment.
  async function consume(ticket) {
    const payload = await store.consume(ticket);
    if (!payload || !payload.user_id) fail('handoff_invalid', 401);
    // A ticket issued by a different deployment, or under a different platform key, is not this
    // deployment's to spend. (Checked before any read: it says nothing about the account.)
    if ((payload.platform_key || settings.platformKey) !== settings.platformKey) fail('session_scope_changed', 409);
    if ((payload.instance || null) !== (settings.instanceKey || null)) fail('session_scope_changed', 409);

    const verified = await withRetry(() => db.transaction(async query => {
      const { rows } = await query(
        `SELECT id, uuid, uuid_source, role, status, group_id, expire_at
           FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`, [Number(payload.user_id)]);
      const row = rows[0];
      // The account: still there, still this student, still a student.
      if (!row || row.uuid !== payload.uuid || row.uuid_source !== 'sso') fail('handoff_invalid', 401);
      if (row.role !== 'user') fail('subject_not_student', 403);
      if (row.status !== 'active') fail('subject_disabled', 403);
      if (row.expire_at && new Date(row.expire_at).getTime() <= now()) fail('subject_expired', 403);

      // The school: still provisioned, still the same group, and the student still in it.
      const groupId = await resolveSchoolGroup(query, settings, payload.school_ref);
      if (Number(groupId) !== Number(payload.group_id)) fail('session_scope_changed', 409);
      if (Number(row.group_id) !== Number(payload.group_id)) fail('session_scope_changed', 409);
      const { rows: groupRows } = await query(
        'SELECT id, is_active FROM user_groups WHERE id = ? LIMIT 1', [groupId]);
      if (!groupRows[0] || Number(groupRows[0].is_active) !== 1) fail('school_not_provisioned', 409);

      // Only now is there something to sign. The token is minted from the row just verified, and the
      // session that remembers where the student came from is written beside it: the commit makes both
      // real or neither. `issueRefresh: false` keeps this call free of any other database read.
      const user = await models.User.findById(row.id);
      if (!user || user.status !== 'active' || user.role !== 'user') fail('subject_disabled', 403);
      const tokens = await deps.TokenService.generateTokenPair(user, true,
        { accessExpiresIn: settings.accessTtl, issueRefresh: false });
      const expiresAt = now() + accessSeconds(settings.accessTtl) * 1000;
      await sessionContext.record(query, {
        jti: tokens.jti, userId: row.id, platformKey: settings.platformKey,
        instanceKey: settings.instanceKey || null, schoolRef: payload.school_ref, groupId,
        lessonRef: payload.context ? payload.context.lesson_id ?? null : null,
        assignmentRef: payload.context ? payload.context.assignment_id ?? null : null,
        handoffDigest: sha256(ticket), expiresAt
      });
      return { user, tokens, groupId, expiresAt };
    }));

    return { user: verified.user, tokens: verified.tokens, entry: payload.entry,
      context: payload.context ?? null, school_ref: payload.school_ref ?? null,
      group_id: verified.groupId, expires_at: verified.expiresAt };
  }

  return { exchange, consume, expectedSignature, sourceAddress };
}
module.exports = { createStudentEntry, expectedSignature, sourceAddress, parsePayload, withRetry, accessSeconds };

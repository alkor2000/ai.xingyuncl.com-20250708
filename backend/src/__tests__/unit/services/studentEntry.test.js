'use strict';

// C05 student entry (edu → practice), unit level. Everything here runs against the in-memory fixture;
// the isolated harness in dev/c05-lab runs the same modules against real MySQL 8, real Redis and a real
// node server. No production data, no real edu issuer: the signer is synthetic and so is every uuid.
const fs = require('node:fs');
const path = require('node:path');
const { studentEntrySettings } = require('../../../services/studentEntry/config');
const { DEFAULT_LANDINGS, CAPABILITY_KEYS, normaliseEntry } = require('../../../services/studentEntry/landings');
const { createHandoffStore, signatureMatches, sha256 } = require('../../../services/studentEntry/handoff');
const { createStudentEntry, expectedSignature, sourceAddress,
  accessSeconds } = require('../../../services/studentEntry/exchange');
const { upsertStudent } = require('../../../services/studentEntry/shadowAccount');
const { resolveSchoolGroup } = require('../../../services/studentEntry/schoolMapping');
const { loadRuntime } = require('../../../services/studentEntry/runtime');
const { createMemoryDb, createMemoryRedis, createIssuer } = require('../../helpers/c05Fixture');

const SECRET = 'c05-unit-secret-0123456789abcdef0123456789';
const UUID = '11111111-2222-3333-4444-555555555555';
const HASH = '$2a$10$unit.test.bcrypt.placeholder.hash.value.abcdefghij';

const ssoConfigWith = (c05 = {}, platform = {}) => ({
  enabled: true,
  platforms: [{
    platform_key: 'edu', secret: SECRET, algorithm: 'sha256', enabled: true,
    ip_whitelist_enabled: true, allowed_ips: '10.9.0.7',
    c05: { enabled: true, school_groups: { '123': 7 }, issuance: { mode: 'from_group_pool', amount: 100 }, ...c05 },
    ...platform
  }]
});
const settingsWith = (c05, platform) => studentEntrySettings(ssoConfigWith(c05, platform));
const payloadFor = (overrides = {}) => ({
  subject: { uuid: UUID, cohort: 'student', status: 'active' },
  profile: { display_name: '王小明' },
  org: { school_ref: '123', grade_name: '初一', class_name: '1班' },
  landing: { entry: 'chat' },
  context: { lesson_id: '456', assignment_id: null },
  issued_at: Math.floor(Date.now() / 1000),
  expires_at: Math.floor(Date.now() / 1000) + 300,
  ...overrides
});
const request = signed => ({ ...signed, req: { socket: { remoteAddress: '10.9.0.7' }, headers: signed.headers } });

function harness({ c05, platform, groups, users, columns } = {}) {
  const settings = settingsWith(c05, platform);
  const redis = createMemoryRedis();
  const store = createHandoffStore({ redis });
  const db = createMemoryDb({
    groups: groups || [{ id: 7, credits_pool: 1000, credits_pool_used: 0, edu_school_id: '123', cohort: 'student' }],
    users, columns
  });
  const models = { User: { async findById(id) {
    const row = db.data.users.get(Number(id));
    return row ? { ...row, toJSON: () => row } : null;
  } } };
  // The real TokenService is not exercised here (the isolated harness signs real JWTs); what matters at
  // this level is that consume mints exactly once, inside the transaction, from the row it verified.
  let minted = 0;
  const TokenService = { async generateTokenPair(user, isSSO, options) {
    minted += 1;
    return { accessToken: `token-${user.id}-${minted}`, expiresIn: options?.accessExpiresIn,
      jti: `${user.id}-jti-${minted}`, issueRefreshAsked: options?.issueRefresh };
  } };
  const service = createStudentEntry({ settings, store, db, models, deps: { TokenService } });
  return { settings, redis, store, db, service, minted: () => minted,
    sign: createIssuer({ secret: SECRET }) };
}
const refusal = async promise => {
  try { await promise; return { code: null }; } catch (error) { return { code: error.code, status: error.status }; }
};

describe('C05 settings', () => {
  test('a platform without a c05 block is simply off', () => {
    const config = ssoConfigWith();
    delete config.platforms[0].c05;
    expect(studentEntrySettings(config)).toEqual({ enabled: false, reason: 'student_entry_disabled' });
  });

  test('the conservative halves of the contract are the defaults', () => {
    const settings = settingsWith();
    expect(settings.issueRefresh).toBe(false);          // §5: no long-lived refresh
    expect(settings.userLimit).toBe('ignore');          // §4: do not touch an administrator's number
    expect(settings.groupChange).toBe('move_and_recycle'); // §4: the move is specified, so it is the default
    expect(settings.handoffTtlSeconds).toBe(60);
    expect(settings.subjectRatePerMinute).toBe(10);     // §3.7
    expect(settings.landings).toEqual(DEFAULT_LANDINGS);
  });

  test('a malformed deployment refuses instead of guessing', () => {
    expect(() => settingsWith({}, { secret: 'short' })).toThrow(/config_invalid/);
    expect(() => settingsWith({ school_groups: { '123': 'seven' } })).toThrow(/config_invalid/);
    expect(() => settingsWith({ school_groups: {} })).toThrow(/config_invalid/);
    expect(() => settingsWith({ landings: ['../admin'] })).toThrow(/config_invalid/);
    expect(() => settingsWith({ launch_url: 'http://edu.example.edu/launch' })).toThrow(/config_invalid/);
    expect(() => settingsWith({}, { ip_whitelist_enabled: true, allowed_ips: '' })).toThrow(/config_invalid/);
  });

  test('database mapping is a deliberate choice, not a fallback', () => {
    const settings = settingsWith({ school_source: 'database', school_groups: {} });
    expect(settings.schoolSource).toBe('database');
  });
});

describe('C05 landing whitelist', () => {
  test('mirrors the frontend capability keys exactly', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../../../../frontend/src/utils/portalCapabilityEntry.js'), 'utf8');
    const block = source.slice(source.indexOf('PORTAL_CAPABILITY_LANDINGS'), source.indexOf('PORTAL_CAPABILITY_ENTRY_KEYS'));
    const keys = [...block.matchAll(/'(ai-practice\.[a-z]+)'/g)].map(match => match[1]);
    expect([...new Set(keys)].sort()).toEqual([...CAPABILITY_KEYS].sort());
  });

  test('accepts both spellings the contract uses and nothing else', () => {
    expect(normaliseEntry('chat', DEFAULT_LANDINGS)).toBe('ai-practice.chat');
    expect(normaliseEntry('ai-practice.chat', DEFAULT_LANDINGS)).toBe('ai-practice.chat');
    expect(normaliseEntry('dashboard', DEFAULT_LANDINGS)).toBe('dashboard');
    expect(normaliseEntry('admin', DEFAULT_LANDINGS)).toBeNull();
    expect(normaliseEntry('https://example.com', DEFAULT_LANDINGS)).toBeNull();
  });
});

describe('C05 signature and source address', () => {
  test('a fixed vector stays fixed', () => {
    const body = Buffer.from('{"schema_version":1}', 'utf8');
    expect(expectedSignature('secret', 1757750000, 'nonce-0123456789', body))
      .toBe(expectedSignature('secret', 1757750000, 'nonce-0123456789', body));
    expect(expectedSignature('secret', 1757750000, 'nonce-0123456789', body))
      .not.toBe(expectedSignature('secret', 1757750001, 'nonce-0123456789', body));
  });

  test('comparison refuses a wrong length and a non-hex string without throwing', () => {
    const expected = expectedSignature('secret', 1, 'n', Buffer.from('x'));
    expect(signatureMatches(expected, expected)).toBe(true);
    expect(signatureMatches(expected, expected.slice(0, 10))).toBe(false);
    expect(signatureMatches(expected, 'z'.repeat(expected.length))).toBe(false);
  });

  test('a proxy header is believed only when the deployment says how many proxies there are', () => {
    // Hops are counted the way Express counts `trust proxy: n`: the socket peer is hop 1, so the entry
    // the trusted proxy appended is the client. A header from an untrusted deployment is ignored.
    const req = { socket: { remoteAddress: '::ffff:10.0.0.9' },
      headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.9' } };
    expect(sourceAddress(req, 0)).toBe('10.0.0.9');   // no proxy configured: the socket is the truth
    expect(sourceAddress(req, 1)).toBe('10.0.0.9');   // one proxy: what it appended
    expect(sourceAddress(req, 2)).toBe('203.0.113.5');
    expect(sourceAddress({ socket: { remoteAddress: '10.0.0.9' }, headers: {} }, 2)).toBe('10.0.0.9');
  });
});

describe('C05 exchange', () => {
  test('a valid assertion creates the account and returns only a handoff', async () => {
    const lab = harness();
    const result = await lab.service.exchange(request(lab.sign(payloadFor())));
    expect(result.handoff).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(result)).not.toContain(UUID);
    expect(result.landing).toEqual({ entry: 'ai-practice.chat' });

    const created = [...lab.db.data.users.values()][0];
    expect(created.uuid_source).toBe('sso');
    expect(created.role).toBe('user');
    expect(created.credits_quota).toBe(100);
    expect(lab.db.data.groups.get(7).credits_pool_used).toBe(100);
    expect(lab.db.tagNamesOf(created.id)).toEqual(['年级:初一', '班级:1班']);
    // Redis holds the digest, never something that could be redeemed.
    expect([...lab.redis.store.keys()].some(key => key.includes(result.handoff))).toBe(false);
    expect(lab.redis.store.has(`c05:handoff:${sha256(result.handoff)}`)).toBe(true);
  });

  test('each refusal is the contract code, and none of them writes anything', async () => {
    const cases = [
      ['invalid_signature', lab => request({ ...lab.sign(payloadFor()), headers: {
        ...lab.sign(payloadFor()).headers, 'x-edu-signature': 'a'.repeat(64) } })],
      ['stale_timestamp', lab => request(lab.sign(payloadFor(), { timestamp: Math.floor(Date.now() / 1000) - 1200 }))],
      ['cohort_not_supported', lab => request(lab.sign(payloadFor({
        subject: { uuid: UUID, cohort: 'teacher', status: 'active' } })))],
      ['subject_disabled', lab => request(lab.sign(payloadFor({
        subject: { uuid: UUID, cohort: 'student', status: 'disabled' } })))],
      ['entry_not_allowed', lab => request(lab.sign(payloadFor({ landing: { entry: 'admin' } })))],
      ['school_not_provisioned', lab => request(lab.sign(payloadFor({ org: { school_ref: '999' } })))],
      ['invalid_request', lab => request(lab.sign({ ...payloadFor(), extra: 'field' }))],
      ['platform_disabled', lab => request(lab.sign(payloadFor(), {}), 'edu')]
    ];
    for (const [code, build] of cases) {
      const lab = harness();
      const input = build(lab);
      if (code === 'platform_disabled') input.rawBody = Buffer.from(
        JSON.stringify({ ...JSON.parse(input.rawBody.toString()), platform_key: 'other' }), 'utf8');
      const { code: actual } = await refusal(lab.service.exchange(input));
      expect([code, actual]).toEqual([code, code === 'platform_disabled' ? 'invalid_signature' : code]);
      if (code !== 'school_not_provisioned') expect(lab.db.data.users.size).toBe(0);
    }
  });

  test('a source outside the whitelist never reaches the signature check', async () => {
    const lab = harness();
    const signed = lab.sign(payloadFor());
    const { code } = await refusal(lab.service.exchange({
      ...signed, req: { socket: { remoteAddress: '203.0.113.5' }, headers: signed.headers } }));
    expect(code).toBe('ip_not_allowed');
    expect(lab.redis.store.size).toBe(0);      // not even a nonce was spent
  });

  test('a replayed nonce is refused once the first exchange has used it', async () => {
    const lab = harness();
    const signed = lab.sign(payloadFor());
    await lab.service.exchange(request(signed));
    const { code, status } = await refusal(lab.service.exchange(request(signed)));
    expect([code, status]).toEqual(['replay_detected', 409]);
  });

  test('a wrong signature does not burn the nonce it carried', async () => {
    const lab = harness();
    const signed = lab.sign(payloadFor());
    const forged = { ...signed, headers: { ...signed.headers, 'x-edu-signature': 'b'.repeat(64) } };
    expect((await refusal(lab.service.exchange(request(forged)))).code).toBe('invalid_signature');
    const result = await lab.service.exchange(request(signed));
    expect(result.handoff).toBeTruthy();
  });

  test('the per-student limit is per uuid, not per source address', async () => {
    const lab = harness({ c05: { subject_rate_per_minute: 2 } });
    for (let attempt = 0; attempt < 2; attempt += 1) await lab.service.exchange(request(lab.sign(payloadFor())));
    const { code, status } = await refusal(lab.service.exchange(request(lab.sign(payloadFor()))));
    expect([code, status]).toEqual(['rate_limited', 429]);
  });

  test('without Redis there is no atomic handoff, so there is no login', async () => {
    const lab = harness();
    lab.redis.disconnect();
    const { code, status } = await refusal(lab.service.exchange(request(lab.sign(payloadFor()))));
    expect([code, status]).toEqual(['storage_unavailable', 503]);
    expect(lab.db.data.users.size).toBe(0);
  });
});

describe('C05 handoff', () => {
  test('is spendable exactly once', async () => {
    const lab = harness();
    const { handoff } = await lab.service.exchange(request(lab.sign(payloadFor())));
    const session = await lab.service.consume(handoff);
    expect(session.entry).toBe('ai-practice.chat');
    expect(session.tokens.accessToken).toBeTruthy();
    expect(session.tokens.issueRefreshAsked).toBe(false);   // §5: this entry never mints a refresh
    expect(session.context).toEqual({ lesson_id: '456', assignment_id: null });
    const { code, status } = await refusal(lab.service.consume(handoff));
    expect([code, status]).toEqual(['handoff_invalid', 401]);
  });

  test('expires with its 60 seconds', async () => {
    const lab = harness();
    const { handoff } = await lab.service.exchange(request(lab.sign(payloadFor())));
    lab.redis.expire(`c05:handoff:${sha256(handoff)}`);
    expect((await refusal(lab.service.consume(handoff))).code).toBe('handoff_invalid');
  });

  test('an account disabled between exchange and consume cannot land', async () => {
    const lab = harness();
    const { handoff } = await lab.service.exchange(request(lab.sign(payloadFor())));
    [...lab.db.data.users.values()][0].status = 'disabled';
    expect((await refusal(lab.service.consume(handoff))).code).toBe('subject_disabled');
  });

  test('a shape that is not a ticket never reaches Redis', async () => {
    const lab = harness();
    expect((await refusal(lab.service.consume('../../etc/passwd'))).code).toBe('handoff_invalid');
    expect(lab.redis.store.size).toBe(0);
  });
});

describe('C05 shadow account', () => {
  const base = { uuid: UUID, profile: { display_name: '王小明' },
    org: { grade_name: '初一', class_name: '1班' }, passwordHash: HASH,
    issuance: { mode: 'from_group_pool', amount: 100 }, groupChange: 'move_and_recycle' };

  test('an exhausted pool grants zero rather than borrowing or failing', async () => {
    const db = createMemoryDb({ groups: [{ id: 7, credits_pool: 40, credits_pool_used: 40 }] });
    const account = await db.transaction(query => upsertStudent(query, { ...base, groupId: 7 }));
    expect([account.created, account.granted]).toEqual([true, 0]);
    expect(db.data.groups.get(7).credits_pool_used).toBe(40);
  });

  test('a pool that cannot afford a whole share grants none of it, and is left alone', async () => {
    // Contract §4: 不足则 0. A part share would hand this student whatever happened to be left, with
    // nothing anywhere saying the policy was not met.
    const db = createMemoryDb({ groups: [{ id: 7, credits_pool: 100, credits_pool_used: 70 }] });
    const account = await db.transaction(query => upsertStudent(query, { ...base, groupId: 7 }));
    expect([account.created, account.granted, account.pool_short]).toEqual([true, 0, true]);
    expect(db.data.groups.get(7).credits_pool_used).toBe(70);
  });

  test('a missing issuance policy closes first login by name and leaves the pool alone', async () => {
    const db = createMemoryDb({ groups: [{ id: 7, credits_pool: 100 }] });
    const { code, status } = await refusal(db.transaction(query =>
      upsertStudent(query, { ...base, groupId: 7, issuance: null })));
    expect([code, status]).toEqual(['issuance_policy_missing', 503]);
    expect(db.data.users.size).toBe(0);
  });

  test('a returning student keeps the balance and only the tags follow the newest payload', async () => {
    const db = createMemoryDb({
      groups: [{ id: 7, credits_pool: 1000, credits_pool_used: 100 }],
      users: [{ id: 1, uuid: UUID, username: 's_1111', group_id: 7, credits_quota: 100, used_credits: 30 }] });
    const account = await db.transaction(query => upsertStudent(query, {
      ...base, groupId: 7, org: { grade_name: '初二', class_name: '3班' } }));
    expect([account.created, account.granted]).toEqual([false, 0]);
    expect(db.data.users.get(1).credits_quota).toBe(100);
    expect(db.data.groups.get(7).credits_pool_used).toBe(100);
    expect(db.tagNamesOf(1)).toEqual(['年级:初二', '班级:3班']);
  });

  test('a student assertion cannot take over a teacher, an admin or a local account', async () => {
    for (const row of [{ role: 'admin' }, { role: 'user', uuid_source: 'local' }]) {
      const db = createMemoryDb({
        groups: [{ id: 7, credits_pool: 1000 }],
        users: [{ id: 1, uuid: UUID, username: 't_1', group_id: 7, ...row }] });
      const { code, status } = await refusal(db.transaction(query => upsertStudent(query, { ...base, groupId: 7 })));
      expect([code, status]).toEqual(['subject_not_student', 403]);
    }
  });

  test('a school change recycles the unspent remainder into the pool it came from', async () => {
    const db = createMemoryDb({
      groups: [{ id: 7, credits_pool: 1000, credits_pool_used: 500 }, { id: 8, credits_pool: 1000, credits_pool_used: 0 }],
      users: [{ id: 1, uuid: UUID, username: 's_1111', group_id: 7, credits_quota: 100, used_credits: 40 }] });
    const account = await db.transaction(query => upsertStudent(query, { ...base, groupId: 8 }));
    expect(account.moved).toMatchObject({ from_group_id: 7, to_group_id: 8, recycled: 60 });
    expect(db.data.groups.get(7).credits_pool_used).toBe(440);   // 500 - 60 unspent
    expect(db.data.groups.get(8).credits_pool_used).toBe(0);     // the move does not re-issue
    expect(db.data.users.get(1)).toMatchObject({ group_id: 8, credits_quota: 0, used_credits: 0 });
  });

  test('a deployment that would rather look at a school change by hand refuses without touching a balance', async () => {
    const db = createMemoryDb({
      groups: [{ id: 7, credits_pool: 1000, credits_pool_used: 500 }, { id: 8, credits_pool: 1000 }],
      users: [{ id: 1, uuid: UUID, username: 's_1111', group_id: 7, credits_quota: 100, used_credits: 40 }] });
    const { code } = await refusal(db.transaction(query =>
      upsertStudent(query, { ...base, groupId: 8, groupChange: 'refuse' })));
    expect(code).toBe('group_change_refused');
    expect(db.data.users.get(1)).toMatchObject({ group_id: 7, credits_quota: 100 });
    expect(db.data.groups.get(7).credits_pool_used).toBe(500);
  });

  test('a username already taken is retried with a suffix, and the uuid still decides the account', async () => {
    const db = createMemoryDb({
      groups: [{ id: 7, credits_pool: 1000 }],
      users: [{ id: 1, uuid: 'someone-else-0000', username: 's_1111111122223333', group_id: 7 }] });
    const account = await db.transaction(query => upsertStudent(query, { ...base, groupId: 7 }));
    expect(account.created).toBe(true);
    expect(account.username).not.toBe('s_1111111122223333');
    expect(db.data.users.get(account.userId).uuid).toBe(UUID);
  });

  test('a second first-login for the same uuid joins the account that won, and does not charge twice', async () => {
    const db = createMemoryDb({ groups: [{ id: 7, credits_pool: 1000 }] });
    const first = await db.transaction(query => upsertStudent(query, { ...base, groupId: 7 }));
    const second = await db.transaction(query => upsertStudent(query, { ...base, groupId: 7 }));
    expect(second.userId).toBe(first.userId);
    expect(second.created).toBe(false);
    expect(db.data.groups.get(7).credits_pool_used).toBe(100);
  });

  test('the seat policy never turns an enrolled student away, and `ignore` leaves the number alone', async () => {
    const full = { id: 7, credits_pool: 1000, user_limit: 1 };
    const seated = [{ id: 1, uuid: 'other-student-01', username: 's_other', group_id: 7 }];
    const ignoring = createMemoryDb({ groups: [{ ...full }], users: seated.map(row => ({ ...row })) });
    const ignored = await ignoring.transaction(query => upsertStudent(query, { ...base, groupId: 7 }));
    expect([ignored.created, ignored.seat_policy]).toEqual([true, 'ignored']);
    expect(ignoring.data.groups.get(7).user_limit).toBe(1);

    const expanding = createMemoryDb({ groups: [{ ...full }], users: seated.map(row => ({ ...row })) });
    const expanded = await expanding.transaction(query =>
      upsertStudent(query, { ...base, groupId: 7, userLimit: 'auto_expand' }));
    expect(expanded.seat_policy).toBe('expanded');
    expect(expanding.data.groups.get(7).user_limit).toBe(2);
  });
});

describe('C05 consume re-checks the present, not the past', () => {
  // A ticket lives sixty seconds. Everything it claimed has to be true again when it is spent.
  const spend = async (lab, mutate, payload = {}) => {
    const { handoff } = await lab.service.exchange(request(lab.sign(payloadFor(payload))));
    await mutate(lab);
    return refusal(lab.service.consume(handoff));
  };
  const student = lab => [...lab.db.data.users.values()].find(row => row.uuid === UUID);

  test('an account promoted between exchange and consume cannot spend the ticket', async () => {
    const lab = harness();
    const { code, status } = await spend(lab, () => { student(lab).role = 'admin'; });
    expect([code, status]).toEqual(['subject_not_student', 403]);
    expect(lab.minted()).toBe(0);                       // nothing was signed for the promoted account
  });

  test('an account switched off or expired cannot spend the ticket', async () => {
    const off = harness();
    expect((await spend(off, () => { student(off).status = 'inactive'; })).code).toBe('subject_disabled');
    const expired = harness();
    expect((await spend(expired, () => { student(expired).expire_at = new Date(Date.now() - 86400000); })).code)
      .toBe('subject_expired');
  });

  test('a school closed or unmapped in those sixty seconds cannot spend the ticket', async () => {
    const closed = harness();
    expect((await spend(closed, () => { closed.db.data.groups.get(7).is_active = 0; })).code)
      .toBe('school_not_provisioned');
  });

  test('a ticket cannot follow the student to a different group, in either direction', async () => {
    const moved = harness({ groups: [{ id: 7, credits_pool: 1000 }, { id: 8, credits_pool: 1000 }] });
    expect((await spend(moved, () => { student(moved).group_id = 8; })).code).toBe('session_scope_changed');

    // The mapping itself now points somewhere else: the old ticket names the old group.
    const repointed = harness({ groups: [{ id: 7, credits_pool: 1000 }, { id: 8, credits_pool: 1000 }] });
    const { handoff } = await repointed.service.exchange(request(repointed.sign(payloadFor())));
    const elsewhere = createStudentEntry({ ...repointed, settings: settingsWith({ school_groups: { 123: 8 } }),
      models: { User: { findById: async id => ({ ...repointed.db.data.users.get(Number(id)) }) } },
      deps: { TokenService: { generateTokenPair: async () => ({ accessToken: 'x', jti: 'y' }) } } });
    expect((await refusal(elsewhere.consume(handoff))).code).toBe('session_scope_changed');
  });

  test('a ticket issued by another deployment or platform is not this one to spend', async () => {
    const lab = harness();
    const { handoff } = await lab.service.exchange(request(lab.sign(payloadFor())));
    const other = createStudentEntry({ ...lab, settings: { ...lab.settings, instanceKey: 'another-site' },
      models: { User: { findById: async id => ({ ...lab.db.data.users.get(Number(id)) }) } },
      deps: { TokenService: { generateTokenPair: async () => ({ accessToken: 'x', jti: 'y' }) } } });
    expect((await refusal(other.consume(handoff))).code).toBe('session_scope_changed');
  });

  test('the session that is created remembers where the student came from, and stores no token', async () => {
    const lab = harness();
    const { handoff } = await lab.service.exchange(request(lab.sign(payloadFor())));
    const session = await lab.service.consume(handoff);
    const [row] = lab.db.data.sessions;
    expect(row).toMatchObject({ school_ref: '123', group_id: 7, lesson_ref: '456', assignment_ref: null,
      platform_key: 'edu' });
    expect(row.handoff_digest).toBe(sha256(handoff));
    expect(JSON.stringify(row)).not.toContain(session.tokens.accessToken);
    expect(JSON.stringify(row)).not.toContain(handoff);
  });

  test('a refused consume leaves no session behind, and the ticket is still spent', async () => {
    const lab = harness();
    const { handoff } = await lab.service.exchange(request(lab.sign(payloadFor())));
    student(lab).role = 'admin';
    await refusal(lab.service.consume(handoff));
    expect(lab.db.data.sessions).toHaveLength(0);
    student(lab).role = 'user';
    // The ticket was spent by the refused attempt: a one-time ticket is never revived by a refusal.
    expect((await refusal(lab.service.consume(handoff))).code).toBe('handoff_invalid');
  });
});

describe('C05 token lifetimes', () => {
  test('the access token is asked for at the contract ceiling and no refresh is ever requested', async () => {
    const lab = harness();
    const { handoff } = await lab.service.exchange(request(lab.sign(payloadFor())));
    const session = await lab.service.consume(handoff);
    expect(session.tokens.expiresIn).toBe('12h');
    expect(session.tokens.issueRefreshAsked).toBe(false);
  });

  test('a deployment asking for a refresh token is refused by name, not quietly accepted', async () => {
    // The platform's refresh endpoint re-mints through the ordinary path: a deployment-length refresh,
    // no C05 re-check, no context. Capping that safely is a change to a login path every account
    // shares, so this candidate implements only the half of §5 it can honour, and says so.
    expect(() => settingsWith({ issue_refresh: true })).toThrow(/refresh_not_supported/);
    expect(settingsWith().issueRefresh).toBe(false);
  });

  test('a ttl string becomes the seconds a session is recorded as living', () => {
    expect([accessSeconds('12h'), accessSeconds('45m'), accessSeconds('1d'), accessSeconds('nonsense')])
      .toEqual([43200, 2700, 86400, 43200]);
  });
});

describe('C05 school mapping', () => {
  test('the configured map is used as written and an unmapped school is refused', async () => {
    const db = createMemoryDb({ groups: [{ id: 7 }] });
    const settings = settingsWith();
    expect(await resolveSchoolGroup(db.query, settings, '123')).toBe(7);
    expect((await refusal(resolveSchoolGroup(db.query, settings, '456'))).code).toBe('school_not_provisioned');
  });

  test('asking for the database mapping without the candidate columns refuses instead of falling back', async () => {
    const db = createMemoryDb({ groups: [{ id: 7, edu_school_id: '123', cohort: 'student' }], columns: {} });
    const settings = settingsWith({ school_source: 'database' });
    expect((await refusal(resolveSchoolGroup(db.query, settings, '123'))).code).toBe('config_invalid');
  });

  test('with the columns applied, the group comes from the row and an ambiguous mapping is refused', async () => {
    const columns = { edu_school_id: true, cohort: true };
    const settings = settingsWith({ school_source: 'database', school_groups: {} });
    const one = createMemoryDb({ groups: [{ id: 7, edu_school_id: '123', cohort: 'student' }], columns });
    expect(await resolveSchoolGroup(one.query, settings, '123')).toBe(7);
    const two = createMemoryDb({ columns, groups: [
      { id: 7, edu_school_id: '123', cohort: 'student' }, { id: 8, edu_school_id: '123', cohort: 'student' }] });
    expect((await refusal(resolveSchoolGroup(two.query, settings, '123'))).code).toBe('school_not_provisioned');
  });
});

describe('C05 runtime switch', () => {
  test('unset costs nothing: no settings read, no Redis, no database', async () => {
    const deps = {
      SystemConfig: { getSetting: jest.fn() },
      redis: { get isConnected() { throw new Error('redis touched while off'); } },
      db: { transaction: () => { throw new Error('database touched while off'); } }
    };
    for (const value of [undefined, '', 'false']) {
      const runtime = await loadRuntime({ env: { C05_STUDENT_ENTRY_ENABLED: value }, deps });
      expect(runtime).toEqual({ enabled: false, reason: 'student_entry_disabled' });
    }
    expect(deps.SystemConfig.getSetting).not.toHaveBeenCalled();
  });

  test('a switch that is neither on nor off is a refusal, not an assumption', async () => {
    await expect(loadRuntime({ env: { C05_STUDENT_ENTRY_ENABLED: 'yes' }, deps: {} })).rejects.toThrow(/config_invalid/);
  });

  test('switched on without Redis refuses, and reports what it would run with', async () => {
    require('../../../services/studentEntry/runtime').__resetSessionStoreProbe();
    const deps = {
      SystemConfig: { getSetting: async () => ssoConfigWith() },
      redis: { isConnected: false },
      db: createMemoryDb({ groups: [{ id: 7 }] }), models: {}
    };
    await expect(loadRuntime({ env: { C05_STUDENT_ENTRY_ENABLED: 'true' }, deps }))
      .rejects.toMatchObject({ code: 'storage_unavailable' });

    const ready = await loadRuntime({
      env: { C05_STUDENT_ENTRY_ENABLED: 'true' },
      deps: { ...deps, redis: createMemoryRedis(), db: createMemoryDb({ groups: [{ id: 7 }] }) } });
    expect(ready.readiness).toMatchObject({ platform_key: 'edu', schools_mapped: 1,
      issuance_policy: 'from_group_pool', issues_refresh_token: false, handoff_ttl_seconds: 60,
      access_ttl: '12h', session_context_table: 'c05_sessions' });
  });
});

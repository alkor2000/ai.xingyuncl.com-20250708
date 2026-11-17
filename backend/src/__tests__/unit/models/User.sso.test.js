// Real SSO validation and User creation; only the SQL boundary is in memory.
jest.mock('../../../database/connection', () => ({ query: jest.fn() }));
jest.mock('../../../models/SystemConfig', () => ({ getSetting: jest.fn() }));
jest.mock('../../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('bcryptjs', () => ({ hash: jest.fn(async () => 'test-password-hash') }));

const db = require('../../../database/connection');
const SystemConfig = require('../../../models/SystemConfig');
const User = require('../../../models/User');
const SSOService = require('../../../services/auth/SSOService');

let users;
let nextId;
let insertAttempts;
const secret = 'synthetic-sso-secret';
const context = { target_group_id: 7, default_credits: 100 };

async function login(identity, { legacy = false, name = '同名用户', platform = false, timestamp } = {}) {
  const params = {
    [legacy ? 'username' : 'uuid']: identity,
    name,
    timestamp: timestamp || Math.floor(Date.now() / 1000),
    ...(platform ? { platform_key: 'school' } : {})
  };
  params.signature = SSOService._computeSignature(identity, params.timestamp, secret, platform ? 'sha256' : 'md5');
  const route = await SSOService.validateSSORequest(params, '127.0.0.1');
  return SSOService.handleSSOUser({ uuid: params.uuid || params.username, name }, route);
}

beforeEach(() => {
  users = [];
  nextId = 1;
  insertAttempts = 0;
  SystemConfig.getSetting.mockResolvedValue({ enabled: true, shared_secret: secret, ...context,
    platforms: [{ platform_key: 'school', secret, algorithm: 'sha256', ...context }] });
  db.query.mockImplementation(async (sql, params) => {
    if (sql.includes('WHERE u.uuid = ?')) return { rows: users.filter(u => u.uuid === params[0] && !u.deleted_at).map(u => ({ ...u })) };
    if (sql.includes('WHERE u.id = ?')) return { rows: users.filter(u => u.id === params[0]).map(u => ({ ...u })) };
    if (sql.includes('SELECT expire_date')) return { rows: [] };
    if (sql.includes('INSERT INTO users')) {
      insertAttempts++;
      const [uuid, uuid_source, email, username, password_hash, phone, role, group_id, status, remark,
        token_quota, credits_quota, credits_expire_at, expire_at] = params;
      const duplicate = ['uuid', 'email', 'username'].find(key => users.some(u => u[key] === ({ uuid, email, username })[key]));
      if (duplicate) throw Object.assign(new Error(`Duplicate entry for key '${duplicate}'`), { code: 'ER_DUP_ENTRY' });
      const id = nextId++;
      users.push({ id, uuid, uuid_source, email, username, password_hash, phone, role, group_id, status,
        remark, token_quota, credits_quota, used_credits: 0, credits_expire_at, expire_at });
      return { rows: { insertId: id } };
    }
    if (sql.includes('last_login_at')) return { rows: { affectedRows: 1 } };
    throw new Error(`Unexpected SQL: ${sql}`);
  });
});

it.each([{}, { legacy: true }, { platform: true }])('repeat login reuses the first account: %j', async options => {
  const first = await login('student-123', options);
  users[0].credits_quota = 900;
  users[0].used_credits = 125;
  users[0].group_id = 42;
  const second = await login('student-123', { ...options, name: '改过的展示名', timestamp: Math.floor(Date.now() / 1000) + 1 });
  expect(second.id).toBe(first.id);
  expect(second).toMatchObject({ group_id: 42, credits_quota: 900, used_credits: 125 });
  expect(users).toHaveLength(1);
  expect(insertAttempts).toBe(1);
});

it('concurrent first logins both return the one account created', async () => {
  const results = await Promise.all(Array.from({ length: 5 }, () => login('student-123')));
  expect(new Set(results.map(u => u.id)).size).toBe(1);
  expect(users).toHaveLength(1);
  expect(insertAttempts).toBeGreaterThan(1);
  expect(users[0].credits_quota).toBe(100);
});

it('different signed identities with the same display name stay separate', async () => {
  const first = await login('identity-a');
  const second = await login('another-b');
  expect(second.id).not.toBe(first.id);
  expect(users).toHaveLength(2);
});

it('a username prefix collision cannot log in to the other identity', async () => {
  await login('same1234-first');
  await expect(login('same1234-other')).rejects.toThrow('SSO用户处理失败');
  expect(users).toHaveLength(1);
});

it.each(['inactive', 'expired'])('repeat login cannot bypass %s account restrictions', async state => {
  await login('student-123');
  if (state === 'inactive') users[0].status = 'inactive';
  else users[0].expire_at = new Date(Date.now() - 86400000);
  await expect(login('student-123')).rejects.toMatchObject({ statusCode: 403 });
  expect(users).toHaveLength(1);
});

it('an invalid signature does not query or create users', async () => {
  await expect(SSOService.validateSSORequest({ uuid: 'student-123', timestamp: Math.floor(Date.now() / 1000), signature: 'invalid' }, '127.0.0.1'))
    .rejects.toMatchObject({ statusCode: 403 });
  expect(db.query).not.toHaveBeenCalled();
});

it('database failures are not retried as new account creation', async () => {
  db.query.mockRejectedValueOnce(Object.assign(new Error('connection failed'), { code: 'ECONNREFUSED' }));
  await expect(User.createOrUpdateSSOUser({ uuid: 'student-123', group_id: 7, default_credits: 100 }))
    .rejects.toThrow('SSO用户处理失败');
  expect(insertAttempts).toBe(0);
});

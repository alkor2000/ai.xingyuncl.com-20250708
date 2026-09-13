'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const C = require('../src/services/auth/IdentityEnrollmentContract');
const S = require('../src/services/auth/IdentityEnrollmentState');
const client = require('../src/services/auth/IdentityEnrollmentClient');

// 所有凭据均为测试夹具；不加载.env，不连接数据库，不发出真实网络请求。
const NOW = Date.parse('2026-09-10T00:00:00Z');
const ISSUER = 'https://id.pkuailab.com';
const SECRET = 'a'.repeat(64);
const UUID = '11111111-1111-4111-8111-111111111111';
const INSTANCE = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'pku_enroll_v1_' + Buffer.alloc(32, 7).toString('base64url');
const clone = value => JSON.parse(JSON.stringify(value));
const issued = () => ({ request_id: UUID, token_id: INSTANCE, enrollment_token: TOKEN,
  issued_at: new Date(NOW).toISOString(), expires_at: new Date(NOW + 900000).toISOString() });
const binding = () => ({ product_code: 'ai-platform', deployment_instance_key: 'xingyun-ai-test',
  display_name: '星云AI接入测试', public_origin: 'https://ai.xingyuncl.com',
  identity_client_id: 'xingyun-ai-test-client', contract_version: 1, account_link_enabled: true,
  redirect_uris: [
    { purpose: 'login', redirect_uri: 'https://ai.xingyuncl.com/api/auth/identity/login/callback' },
    { purpose: 'bind', redirect_uri: 'https://ai.xingyuncl.com/api/auth/identity/callback' }
  ] });
function reply(request, kind = 'first') {
  const value = { enrollment_id: UUID, instance_id: INSTANCE, identity_issuer: request.identity_issuer,
    identity_client_id: request.binding.identity_client_id, deployment_instance_key: request.binding.deployment_instance_key,
    public_origin: request.binding.public_origin, contract_version: 1, enrolled_at: new Date(NOW).toISOString(),
    result: 'enrolled_disabled' };
  if (kind === 'first' || kind === 'replay') value.replayed = kind === 'replay';
  else Object.assign(value, { request_id: UUID, current_secret_kid: 'enroll-v1-' + 'b'.repeat(32),
    instance_status: 'disabled', client_status: 'disabled' });
  if (kind === 'first' || kind === 'recovery') value.client_secret = SECRET;
  return value;
}
function fixture(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-enrollment-test-'));
  fs.chmodSync(parent, 0o700);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'job');
  const request = C.createRequest(ISSUER, binding(), issued(), NOW);
  S.create(root, request);
  return { parent, root, request };
}
const failNetwork = async () => { throw new Error('SIMULATED_PRIVATE_NETWORK_MESSAGE'); };
const options = transport => ({ transport, now: () => NOW });
const rejectsCode = (promise, code) => assert.rejects(promise, { code });

for (const [label, raw] of [
  ['重复键', '{"a":1,"a":2}'], ['转义后的重复键', '{"a":1,"\\u0061":2}'],
  ['尾随正文', '{} false'], ['尾随逗号', '{"a":1,}'], ['孤立代理码点', '"\\ud800"'],
  ['无效UTF8', Buffer.from([0xc0, 0xaf])], ['超深嵌套', '['.repeat(14) + '0' + ']'.repeat(14)],
  ['超大正文', ' '.repeat(16385)], ['非有限数', '1e999'], ['前导零', '01']
]) test(`严格JSON拒绝：${label}`, () => assert.throws(() => C.decodeJSON(raw), { code: 'ENROLLMENT_JSON_INVALID' }));

test('合法Unicode、原型名称及数值按普通数据解析', () => {
  const value = C.decodeJSON('{"__proto__":{"ok":true},"name":"星云😀","n":-1.25e2}');
  assert.equal(Object.getPrototypeOf(value), null);
  assert.equal(value.__proto__.ok, true);
  assert.equal(value.name, '星云😀');
  assert.equal(value.n, -125);
});

test('部署绑定限制用途、来源、产品与客户端格式', () => {
  for (const mutate of [
    b => { b.redirect_uris[0].redirect_uri = 'https://ai.pkuailab.com/api/auth/identity/login/callback'; },
    b => { b.public_origin += ':443'; }, b => { b.account_link_enabled = false; },
    b => { b.product_code = 'other'; }, b => { b.identity_client_id = 'client:password'; },
    b => { b.extra = true; }, b => { b.redirect_uris.push(b.redirect_uris[0]); }
  ]) {
    const value = binding(); mutate(value);
    assert.throws(() => C.binding(value), { code: 'ENROLLMENT_CONTRACT_INVALID' });
  }
  assert.deepEqual(C.binding(binding()).redirect_uris.map(row => row.purpose), ['bind', 'login']);
  const invalid = issued(); invalid.enrollment_token += '=';
  assert.throws(() => C.createRequest(ISSUER, binding(), invalid, NOW));
});

test('准备操作仅创建私有请求；重复准备不能覆盖原现场', async t => {
  const { parent } = fixture(t);
  const root = path.join(parent, 'prepared');
  const result = await client.prepare(root, ISSUER, binding(), issued(), NOW);
  assert.equal(result.state, 'PREPARED_NOT_SENT');
  assert.equal(fs.statSync(root).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(root, 'request.json')).mode & 0o777, 0o600);
  const before = fs.readFileSync(path.join(root, 'request.json'));
  await assert.rejects(client.prepare(root, ISSUER, binding(), issued(), NOW), { code: 'EEXIST' });
  assert.deepEqual(fs.readFileSync(path.join(root, 'request.json')), before);
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
});

test('私有文件拒绝宽权限、硬链接与符号链接', t => {
  const { parent, root } = fixture(t);
  const file = path.join(root, 'request.json');
  fs.chmodSync(file, 0o644);
  assert.throws(() => S.load(root), { code: 'ENROLLMENT_FILE_NOT_PRIVATE' });
  fs.chmodSync(file, 0o600);
  const hard = path.join(parent, 'hard.json');
  fs.linkSync(file, hard);
  assert.throws(() => S.load(root), { code: 'ENROLLMENT_FILE_NOT_PRIVATE' });
  fs.unlinkSync(hard);
  const link = path.join(parent, 'linked'); fs.symlinkSync(root, link);
  assert.throws(() => S.load(link), { code: 'ENROLLMENT_DIRECTORY_UNSAFE' });
  fs.symlinkSync(file, path.join(parent, 'linked.json'));
  assert.throws(() => S.readPrivate(path.join(parent, 'linked.json')));
});

test('发送前已持久化请求和意图；凭据保存后再次执行不访问网络', async t => {
  const { root, request } = fixture(t);
  let calls = 0;
  const result = await client.consume(root, options(async actual => {
    calls++;
    assert.equal(S.digest(S.load(root)), S.digest(actual));
    assert.equal(S.attempts(root).length, 1);
    return { status: 201, body: JSON.stringify(reply(request)) };
  }));
  assert.equal(result.state, 'CREDENTIALS_SAVED_PENDING_VERIFY');
  assert.equal(JSON.stringify(result).includes(SECRET), false);
  assert.equal(S.read(root, 'credentials.json').response.client_secret, SECRET);
  assert.equal(fs.statSync(path.join(root, 'credentials.json')).mode & 0o777, 0o600);
  await client.consume(root, options(async () => { calls++; throw new Error('unexpected'); }));
  assert.equal(calls, 1);
});

test('响应丢失后只允许明确精确重试；回执不包含Secret且进入独立恢复', async t => {
  const { root } = fixture(t);
  let sent;
  await rejectsCode(client.consume(root, options(async request => {
    sent = JSON.stringify(request); return failNetwork();
  })), 'ENROLLMENT_TRANSPORT_UNCERTAIN');
  assert.equal((await client.status(root)).state, 'RESULT_UNCERTAIN');
  await rejectsCode(client.consume(root, options(failNetwork)), 'ENROLLMENT_EXPLICIT_RESUME_REQUIRED');
  const result = await client.consume(root, { resume: true, now: () => NOW + 1000, transport: async request => {
    assert.equal(JSON.stringify(request), sent);
    return { status: 200, body: JSON.stringify(reply(request, 'replay')) };
  } });
  assert.equal(result.state, 'SECRET_RECOVERY_REQUIRED');
  assert.equal(S.optional(root, 'credentials.json'), null);
  assert.equal(S.attempts(root).length, 2);
});

test('请求发送后篡改时间戳会阻止resume，不能刷新证明窗口', async t => {
  const { root } = fixture(t);
  await rejectsCode(client.consume(root, options(failNetwork)), 'ENROLLMENT_TRANSPORT_UNCERTAIN');
  const altered = S.load(root); altered.timestamp = String(Number(altered.timestamp) + 1);
  fs.writeFileSync(path.join(root, 'request.json'), JSON.stringify(altered));
  await rejectsCode(client.consume(root, { ...options(failNetwork), resume: true }), 'ENROLLMENT_REQUEST_CHANGED');
});

test('过期或超前证明不会发送；首次发送还检查Token有效期', async t => {
  const { root } = fixture(t);
  for (const now of [NOW + 301000, NOW - 31000]) {
    await rejectsCode(client.consume(root, { transport: failNetwork, now: () => now }),
      'ENROLLMENT_WINDOW_EXPIRED_RECOVERY_REQUIRED');
  }
  const altered = S.load(root); altered.token_expires_at = new Date(NOW).toISOString();
  fs.writeFileSync(path.join(root, 'request.json'), JSON.stringify(altered));
  await rejectsCode(client.consume(root, options(failNetwork)), 'ENROLLMENT_TOKEN_EXPIRED');
  assert.equal(S.attempts(root).length, 0);
});

test('错误响应合同不能落盘凭据，200回执夹带Secret同样拒绝', async t => {
  const { parent } = fixture(t);
  const cases = [r => { r.identity_issuer = 'https://other.example.com'; },
    r => { r.identity_client_id = 'other-client'; }, r => { r.extra = true; },
    r => { r.client_secret = 'invalid'; }, r => { r.replayed = true; }];
  for (let index = 0; index < cases.length; index++) {
    const root = path.join(parent, `invalid-${index}`);
    const request = C.createRequest(ISSUER, binding(), issued(), NOW); S.create(root, request);
    const body = reply(request); cases[index](body);
    await assert.rejects(client.consume(root, options(async () => ({ status: index === 4 ? 200 : 201,
      body: JSON.stringify(body) }))));
    assert.equal(S.optional(root, 'credentials.json'), null);
  }
});

test('服务端提交不确定分类保留；恶意错误正文不会被记录或回显', async t => {
  const { root } = fixture(t);
  await rejectsCode(client.consume(root, options(async () => ({ status: 503,
    body: JSON.stringify({ error: { code: 'enrollment_commit_unknown', message: SECRET } }) }))),
  'ENROLLMENT_SERVER_ENROLLMENT_COMMIT_UNKNOWN');
  const files = fs.readdirSync(root).filter(name => name.startsWith('failure-'));
  assert.equal(files.length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, files[0]))),
    { http_status: 503, code: 'enrollment_commit_unknown' });
  assert.equal((await client.status(root)).state, 'RESULT_UNCERTAIN');
});

test('管理回执恢复严格匹配对象、状态和换密KID，且不会覆盖已保存凭据', async t => {
  const { root, request } = fixture(t);
  await rejectsCode(client.consume(root, options(failNetwork)), 'ENROLLMENT_TRANSPORT_UNCERTAIN');
  await client.recordReceipt(root, reply(request, 'receipt'));
  const recovery = reply(request, 'recovery');
  await rejectsCode(client.importSecret(root, recovery), 'ENROLLMENT_RECOVERY_KID_UNCHANGED');
  recovery.current_secret_kid = 'enroll-v1-' + 'c'.repeat(32);
  const wrong = clone(recovery); wrong.instance_id = UUID;
  await rejectsCode(client.importSecret(root, wrong), 'ENROLLMENT_RECOVERY_MISMATCH');
  const active = clone(recovery); active.client_status = 'active';
  await assert.rejects(client.importSecret(root, active));
  const result = await client.importSecret(root, recovery);
  assert.equal(result.state, 'CREDENTIALS_SAVED_PENDING_VERIFY');
  await rejectsCode(client.importSecret(root, recovery), 'ENROLLMENT_CREDENTIALS_ALREADY_SAVED');
});

test('半写凭据文件和遗留锁都阻止继续请求，保留现场', async t => {
  const { root } = fixture(t);
  fs.writeFileSync(path.join(root, 'credentials.json'), '{', { mode: 0o600 });
  await rejectsCode(client.consume(root, options(failNetwork)), 'ENROLLMENT_JSON_INVALID');
  assert.equal(S.attempts(root).length, 0);
  fs.mkdirSync(path.join(root, '.lock'), { mode: 0o700 });
  await rejectsCode(client.consume(root, options(failNetwork)), 'ENROLLMENT_OPERATION_LOCKED');
  assert.equal(fs.existsSync(path.join(root, '.lock')), true);
});

test('并发执行只有持锁进程能够发出请求', async t => {
  const { root, request } = fixture(t);
  let release;
  const first = client.consume(root, options(() => new Promise(resolve => { release = resolve; })));
  await rejectsCode(client.consume(root, options(failNetwork)), 'ENROLLMENT_OPERATION_LOCKED');
  release({ status: 201, body: JSON.stringify(reply(request)) });
  await first;
  assert.equal(S.attempts(root).length, 1);
});

test('原生HTTPS使用固定合同且不跟随重定向；重复响应头和超大响应拒绝', async t => {
  const original = https.request;
  t.after(() => { https.request = original; });
  const request = C.createRequest(ISSUER, binding(), issued(), NOW);
  let mode = 'normal', calls = 0;
  https.request = (config, callback) => {
    calls++;
    assert.equal(config.hostname, 'id.pkuailab.com');
    assert.equal(config.path, '/platform/enroll');
    assert.equal(config.rejectUnauthorized, true);
    assert.equal(config.agent, false);
    assert.equal(config.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(config.headers['X-Enrollment-Timestamp'], request.timestamp);
    assert.equal(config.headers.Cookie, undefined);
    assert.equal(config.headers.Origin, undefined);
    const connection = new EventEmitter(); connection.destroy = () => {};
    connection.end = body => queueMicrotask(() => {
      assert.deepEqual(JSON.parse(body), request.binding);
      const response = new EventEmitter(); response.destroy = () => {};
      response.statusCode = mode === 'redirect' ? 302 : 201;
      response.complete = true;
      response.headers = { 'content-type': 'application/json' };
      response.rawHeaders = ['Content-Type', 'application/json'];
      if (mode === 'duplicate') response.rawHeaders.push('Content-Type', 'application/json');
      callback(response);
      response.emit('data', mode === 'oversize' ? Buffer.alloc(16385) : Buffer.from(JSON.stringify(reply(request))));
      response.emit('end');
    });
    return connection;
  };
  assert.equal((await client.exchange(request)).status, 201);
  mode = 'redirect'; assert.equal((await client.exchange(request)).status, 302);
  assert.equal(calls, 2);
  for (mode of ['duplicate', 'oversize']) await rejectsCode(client.exchange(request), 'ENROLLMENT_TRANSPORT_UNCERTAIN');
});

test('命令帮助不访问状态；非法凭据参数只给固定错误', () => {
  const cli = path.join(__dirname, 'identity-enroll.cjs');
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0); assert.match(help.stdout, /不更新时间戳/);
  const bad = spawnSync(process.execPath, [cli, 'send', '--token', TOKEN], { encoding: 'utf8' });
  assert.equal(bad.status, 1); assert.equal(bad.stdout, '');
  assert.match(bad.stderr, /ENROLLMENT_ARGUMENTS_INVALID/);
  assert.equal(bad.stderr.includes(TOKEN), false);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const runtime = require('../src/config/identityRuntimeConfig');
const deployment = require('../src/config/identityEnrollmentRuntimeConfig');
const C = require('../src/services/auth/IdentityEnrollmentContract');
const S = require('../src/services/auth/IdentityEnrollmentState');
const client = require('../src/services/auth/IdentityEnrollmentClient');
const { loadIdentityDeploymentConfig: load } = deployment;
const SECRET = 'a'.repeat(64);
const OLD_SECRET = 'legacy-test-secret-'.repeat(4);

// 私有目录只包含虚构凭据；使用真实消费者落盘格式，全程不加载.env或访问数据库/网络。
async function fixture(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-runtime-test-'));
  fs.chmodSync(parent, 0o700);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'enrollment');
  const origin = 'https://ai.xingyuncl.com';
  const now = Date.now();
  const request = C.createRequest('https://id.pkuailab.com', {
    product_code: 'ai-platform', deployment_instance_key: 'xingyun-ai-test', display_name: '运行配置测试',
    public_origin: origin, identity_client_id: 'xingyun-test-client', contract_version: 1, account_link_enabled: true,
    redirect_uris: [
      { purpose: 'login', redirect_uri: origin + '/api/auth/identity/login/callback' },
      { purpose: 'bind', redirect_uri: origin + '/api/auth/identity/callback' }
    ]
  }, {
    request_id: '11111111-1111-4111-8111-111111111111', token_id: '22222222-2222-4222-8222-222222222222',
    enrollment_token: 'pku_enroll_v1_' + Buffer.alloc(32, 7).toString('base64url'),
    issued_at: new Date(now).toISOString(), expires_at: new Date(now + 900000).toISOString()
  }, now);
  S.create(root, request);
  await client.consume(root, { now: () => now, transport: async () => ({ status: 201, body: JSON.stringify({
    enrollment_id: '33333333-3333-4333-8333-333333333333', instance_id: '44444444-4444-4444-8444-444444444444',
    identity_issuer: request.identity_issuer, identity_client_id: request.binding.identity_client_id,
    deployment_instance_key: request.binding.deployment_instance_key, public_origin: origin, contract_version: 1,
    enrolled_at: new Date(now).toISOString(), result: 'enrolled_disabled', replayed: false, client_secret: SECRET
  }) }) });
  const file = path.join(root, 'credentials.json');
  return { parent, root, file, env: { IDENTITY_ENABLED: 'true', IDENTITY_ISSUER: request.identity_issuer,
    IDENTITY_PUBLIC_ORIGIN: origin, IDENTITY_CLIENT_ID: request.binding.identity_client_id,
    IDENTITY_DEPLOYMENT_INSTANCE_KEY: request.binding.deployment_instance_key, IDENTITY_CREDENTIALS_FILE: file } };
}
function rejected(env) {
  const current = load(env);
  assert.equal(current.credentialError, true);
  assert.equal(current.clientSecret, '');
  assert.throws(() => runtime.validateIdentityRuntimeConfig(current));
  return current;
}

test('旧环境变量方式保持兼容，未配置文件不要求重新登记', () => {
  const env = { IDENTITY_ENABLED: 'true', IDENTITY_CLIENT_SECRET: OLD_SECRET };
  const current = load(env);
  assert.equal(current.clientId, 'ai-platform-client');
  assert.equal(current.deploymentInstanceKey, '');
  assert.equal(current.clientSecret, OLD_SECRET);
  assert.equal(current.credentialError, false);
  runtime.validateIdentityRuntimeConfig(current);
});

test('Identity关闭时完全不读取文件，不保留Secret且保持关闭状态', () => {
  const current = load({ IDENTITY_ENABLED: 'false', IDENTITY_CREDENTIALS_FILE: '/not-present/credentials.json',
    IDENTITY_CLIENT_SECRET: OLD_SECRET });
  assert.equal(current.enabled, false);
  assert.equal(current.clientSecret, '');
  assert.equal(current.credentialError, false);
});

test('实际消费者凭据可加载；配置冻结且不修改环境、不随文件变化热更新', async t => {
  const { env, file } = await fixture(t);
  const before = JSON.stringify(env);
  const current = load(env);
  assert.equal(current.clientSecret, SECRET);
  assert.equal(current.deploymentInstanceKey, 'xingyun-ai-test');
  assert.equal(current.credentialError, false);
  assert.equal(Object.isFrozen(current), true);
  assert.equal(JSON.stringify(env), before);
  fs.writeFileSync(file, '{');
  assert.equal(current.clientSecret, SECRET);
  rejected(env);
});

test('四个信任字段必须显式配置并与登记记录一致，禁止默认值补齐', async t => {
  const { env } = await fixture(t);
  for (const name of ['IDENTITY_ISSUER', 'IDENTITY_PUBLIC_ORIGIN', 'IDENTITY_CLIENT_ID',
    'IDENTITY_DEPLOYMENT_INSTANCE_KEY']) {
    const missing = { ...env }; delete missing[name]; rejected(missing);
    rejected({ ...env, [name]: name.includes('ISSUER') || name.includes('ORIGIN')
      ? 'https://other.example.com' : 'other-instance' });
  }
});

test('文件与环境Secret互斥；任何文件错误都不回退到旧Secret', async t => {
  const { env } = await fixture(t);
  rejected({ ...env, IDENTITY_CLIENT_SECRET: OLD_SECRET });
  rejected({ ...env, IDENTITY_CREDENTIALS_FILE: '/not-present/credentials.json', IDENTITY_CLIENT_SECRET: OLD_SECRET });
  assert.equal(load({ ...env, IDENTITY_CLIENT_SECRET: '' }).clientSecret, SECRET);
});

test('宽权限、符号链接、错误路径和仅有回执均不能作为凭据', async t => {
  const { env, file, parent } = await fixture(t);
  fs.chmodSync(file, 0o644); rejected(env); fs.chmodSync(file, 0o600);
  const link = path.join(parent, 'linked'); fs.symlinkSync(path.dirname(file), link);
  rejected({ ...env, IDENTITY_CREDENTIALS_FILE: path.join(link, 'credentials.json') });
  rejected({ ...env, IDENTITY_CREDENTIALS_FILE: 'credentials.json' });
  const saved = S.readPrivate(file); saved.kind = 'replay'; delete saved.response.client_secret;
  saved.response.replayed = true; fs.writeFileSync(file, JSON.stringify(saved));
  rejected(env);
});

test('请求摘要、凭据所属对象、回调及Backchannel边界全部校验', async t => {
  const { env, file } = await fixture(t);
  rejected({ ...env, IDENTITY_LOGIN_REDIRECT_URI: 'https://ai.pkuailab.com/api/auth/identity/login/callback' });
  rejected({ ...env, IDENTITY_BACKCHANNEL_URL: 'https://other.example.com/backchannel/platform-account-links' });
  const saved = S.readPrivate(file);
  const wrongObject = JSON.parse(JSON.stringify(saved)); wrongObject.response.identity_client_id = 'other-client';
  fs.writeFileSync(file, JSON.stringify(wrongObject)); rejected(env);
  saved.request_sha256 = '0'.repeat(64); fs.writeFileSync(file, JSON.stringify(saved)); rejected(env);
});

test('实际配置入口加载一次，文件模式不误报缺少环境Secret，本地业务配置保持可用', async t => {
  const { env } = await fixture(t);
  const sourcePath = path.resolve(__dirname, '../src/config/index.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  let calls = 0;
  const warnings = [];
  const output = { exports: {} };
  const controlledEnv = { ...env, NODE_ENV: 'production', DB_PASSWORD: 'test-db-password', DB_NAME: 'test-business',
    JWT_ACCESS_SECRET: OLD_SECRET, JWT_REFRESH_SECRET: OLD_SECRET, STORAGE_PATH: '/test-private-storage' };
  const dependencies = { path, fs, './identityEnrollmentRuntimeConfig': {
    loadIdentityDeploymentConfig(input) { calls++; return load(input); }
  } };
  vm.runInNewContext(source, { module: output, __dirname: path.dirname(sourcePath),
    process: { env: controlledEnv, cwd: () => '/test-project' },
    console: { error: message => warnings.push(String(message)), log() {} },
    require(name) { assert.ok(Object.hasOwn(dependencies, name)); return dependencies[name]; }
  }, { filename: sourcePath, timeout: 1000 });
  assert.equal(calls, 1);
  assert.equal(warnings.length, 0);
  assert.equal(output.exports.identity.clientSecret, SECRET);
  assert.equal(output.exports.database.database, 'test-business');
  assert.equal(output.exports.auth.jwt.accessSecret, OLD_SECRET);
  assert.equal(output.exports.storage.root, '/test-private-storage');
});

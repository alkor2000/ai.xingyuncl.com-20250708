/**
 * Identity 运行配置定向测试。
 * 使用 Node 内置测试器和受限模块加载，不加载应用入口、dotenv、MySQL 或 Redis。
 * HTTP 全部使用内存替身；JWT 使用现场生成的测试密钥，不读取任何生产凭据。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const runtimeModule = require('../src/config/identityRuntimeConfig');
const { loadIdentityRuntimeConfig, validateIdentityRuntimeConfig } = runtimeModule;
const TEST_SECRET = 'test-only-identity-secret-'.repeat(3);
const SUBJECT = '55a8827b-06af-47de-a3b0-743fd889711e';
const NONCE = 'N'.repeat(43);
const servicePath = path.resolve(__dirname, '../src/services/auth/IdentityOIDCService.js');
const serviceSource = fs.readFileSync(servicePath, 'utf8');

function deployment(overrides = {}) {
  return loadIdentityRuntimeConfig({
    IDENTITY_ENABLED: 'true',
    IDENTITY_CLIENT_SECRET: TEST_SECRET,
    ...overrides
  });
}

/** 白名单加载真实 OIDC 源码，未知依赖立即失败，防止测试意外进入应用或网络。 */
function serviceClass() {
  const result = { exports: {} };
  const dependencies = {
    axios: {
      get() { throw new Error('禁止真实HTTP请求'); },
      post() { throw new Error('禁止真实HTTP请求'); }
    },
    crypto,
    '../../config': { identity: deployment() },
    '../../config/identityRuntimeConfig': runtimeModule
  };
  vm.runInNewContext(serviceSource, {
    module: result,
    exports: result.exports,
    Buffer,
    URL,
    URLSearchParams,
    require(name) {
      if (!Object.hasOwn(dependencies, name)) throw new Error(`禁止加载依赖：${name}`);
      return dependencies[name];
    }
  }, { filename: servicePath, timeout: 1000 });
  return result.exports.IdentityOIDCService;
}
const IdentityOIDCService = serviceClass();
const hasCode = code => error => error?.code === code;

function authorization(service, purpose = 'login') {
  return new URL(service.buildAuthorizationURL({
    state: 'S'.repeat(43), nonce: NONCE, codeChallenge: 'C'.repeat(43), purpose
  }));
}

function signingFixture(current) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicJWK = publicKey.export({ format: 'jwk' });
  const kid = 'identity-runtime-test-key';
  const requests = [];
  const service = new IdentityOIDCService({
    identityConfig: current,
    httpClient: {
      async get(url, options) {
        assert.equal(url, current.issuer + '/.well-known/jwks.json');
        assert.equal(options.maxRedirects, 0);
        requests.push(url);
        return { data: { keys: [{ ...publicJWK, kid, use: 'sig', alg: 'EdDSA' }] } };
      }
    }
  });
  function token(overrides = {}, key = privateKey) {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: current.issuer, aud: current.clientId, sub: SUBJECT,
      iat: now, exp: now + 300, nonce: NONCE, ...overrides
    })).toString('base64url');
    const input = `${header}.${payload}`;
    return `${input}.${crypto.sign(null, Buffer.from(input), key).toString('base64url')}`;
  }
  return { service, token, requests };
}

test('旧部署默认合同保持兼容；未启用时不开放Identity', () => {
  const current = deployment();
  assert.equal(current.clientId, 'ai-platform-client');
  assert.equal(current.loginRedirectUri, 'https://ai.xingyuncl.com/api/auth/identity/login/callback');
  assert.equal(validateIdentityRuntimeConfig(current).issuer, 'https://id.pkuailab.com');
  assert.throws(() => validateIdentityRuntimeConfig(loadIdentityRuntimeConfig({})), hasCode('IDENTITY_DISABLED'));
});

test('只配置旧回调环境变量时，公开来源从登录回调兼容推导', () => {
  const current = deployment({
    IDENTITY_LOGIN_REDIRECT_URI: 'https://ai.pkuailab.com/api/auth/identity/login/callback',
    IDENTITY_BIND_REDIRECT_URI: 'https://ai.pkuailab.com/api/auth/identity/callback'
  });
  assert.equal(validateIdentityRuntimeConfig(current).publicOrigin, 'https://ai.pkuailab.com');
});

for (const origin of ['https://ai.xingyuncl.com', 'https://ai.pkuailab.com']) {
  test(`授权与两类回调使用当前部署配置：${origin}`, () => {
    const current = deployment({ IDENTITY_PUBLIC_ORIGIN: origin, IDENTITY_CLIENT_ID: 'instance-test-client' });
    const service = new IdentityOIDCService({ identityConfig: current });
    const login = authorization(service);
    assert.equal(login.searchParams.get('client_id'), 'instance-test-client');
    assert.equal(login.searchParams.get('redirect_uri'), origin + '/api/auth/identity/login/callback');
    assert.equal(login.searchParams.get('scope'), 'openid profile platform_link');
    assert.equal(login.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(login.searchParams.get('nonce'), NONCE);
    assert.equal(login.searchParams.has('client_secret'), false);
    assert.equal(authorization(service, 'bind').searchParams.get('redirect_uri'), origin + '/api/auth/identity/callback');
    assert.equal(authorization(service, 'unlink').searchParams.get('redirect_uri'), origin + '/api/auth/identity/callback');
  });
}

const invalidConfigurations = [
  ['非HTTPS公开来源', { publicOrigin: 'http://ai.xingyuncl.com' }],
  ['公开来源带凭据', { publicOrigin: 'https://user:password@ai.xingyuncl.com' }],
  ['公开来源带路径', { publicOrigin: 'https://ai.xingyuncl.com/path' }],
  ['公开来源带尾斜杠', { publicOrigin: 'https://ai.xingyuncl.com/' }],
  ['非法issuer', { issuer: 'https://id.pkuailab.com?token=secret' }],
  ['跨域登录回调', { loginRedirectUri: 'https://other.example/api/auth/identity/login/callback' }],
  ['回调夹带查询参数', { bindRedirectUri: 'https://ai.xingyuncl.com/api/auth/identity/callback?next=evil' }],
  ['两类回调混用', { bindRedirectUri: 'https://ai.xingyuncl.com/api/auth/identity/login/callback' }],
  ['跨域Backchannel', { backchannelUrl: 'https://other.example/backchannel/platform-account-links' }],
  ['空Client ID', { clientId: '' }],
  ['Basic用户名分隔符', { clientId: 'client:another' }],
  ['重复Scope', { scopes: ['openid', 'profile', 'profile'] }],
  ['协议认证方式变化', { tokenAuthMethod: 'none' }],
  ['无效HTTP超时', { httpTimeoutMs: NaN }],
  ['无效Flow时长', { flowTtlSeconds: 901 }],
  ['非布尔启用开关', { enabled: 'true' }]
];
for (const [name, override] of invalidConfigurations) {
  test(`非法配置在请求前拒绝：${name}`, () => {
    const service = new IdentityOIDCService({ identityConfig: { ...deployment(), ...override } });
    assert.throws(() => authorization(service), hasCode('IDENTITY_CONFIG_INVALID'));
  });
}

test('Secret错误不回显原始值，非法数字不会被parseInt截断接受', () => {
  const badSecret = 'private secret with spaces';
  assert.throws(() => validateIdentityRuntimeConfig({ ...deployment(), clientSecret: badSecret }), error => {
    assert.equal(error.code, 'IDENTITY_SECRET_INVALID');
    assert.equal(error.message.includes(badSecret), false);
    return true;
  });
  assert.throws(() => validateIdentityRuntimeConfig(deployment({ IDENTITY_HTTP_TIMEOUT_MS: '10000junk' })),
    hasCode('IDENTITY_CONFIG_INVALID'));
});

test('新实例ID Token通过真实验签；错误aud、iss、nonce、时效和签名全部拒绝', async () => {
  const current = deployment({
    IDENTITY_ISSUER: 'https://identity.example',
    IDENTITY_PUBLIC_ORIGIN: 'https://school.example',
    IDENTITY_CLIENT_ID: 'school-client'
  });
  const { service, token, requests } = signingFixture(current);
  assert.equal((await service.verifyIDToken(token(), NONCE)).aud, 'school-client');
  const now = Math.floor(Date.now() / 1000);
  for (const override of [
    { aud: 'ai-platform-client' }, { iss: 'https://other.example' },
    { nonce: 'X'.repeat(43) }, { iat: now - 400, exp: now - 100 },
    { iat: now + 100, exp: now + 200 }, { iat: now, exp: now + 301 }
  ]) {
    await assert.rejects(service.verifyIDToken(token(override), NONCE), hasCode('IDENTITY_ID_TOKEN_INVALID'));
  }
  const foreignKey = crypto.generateKeyPairSync('ed25519').privateKey;
  await assert.rejects(service.verifyIDToken(token({}, foreignKey), NONCE), hasCode('IDENTITY_ID_TOKEN_INVALID'));
  assert.equal(requests.length, 1);
});

test('实例配置固定且不改变传入对象，旧JWKS缓存不能随配置切换信任对象', () => {
  const input = { ...deployment(), scopes: ['openid', 'profile', 'platform_link'] };
  const service = new IdentityOIDCService({ identityConfig: input });
  input.clientId = 'other-client';
  input.scopes.push('unexpected');
  assert.equal(authorization(service).searchParams.get('client_id'), 'ai-platform-client');
  assert.equal(Object.isFrozen(service.identityConfig), true);
  assert.equal(Object.isFrozen(input.scopes), false);
});

test('Token交换和Backchannel使用当前客户端，Secret不进入URL或关联JSON', async () => {
  const current = deployment({ IDENTITY_PUBLIC_ORIGIN: 'https://school.example', IDENTITY_CLIENT_ID: 'school-client' });
  const requests = [];
  const service = new IdentityOIDCService({
    identityConfig: current,
    httpClient: {
      async post(url, body, options) {
        requests.push({ url, body, options });
        return { data: { access_token: 'A'.repeat(43), id_token: 'test-id-token', token_type: 'Bearer' } };
      }
    }
  });
  await service.exchangeAuthorizationCode({ code: 'C'.repeat(43), codeVerifier: 'V'.repeat(43), purpose: 'login' });
  const tokenBody = new URLSearchParams(requests[0].body);
  assert.equal(tokenBody.get('client_id'), 'school-client');
  assert.equal(tokenBody.get('client_secret'), TEST_SECRET);
  assert.equal(tokenBody.get('redirect_uri'), current.loginRedirectUri);
  await service.mutatePlatformLink({ operation: 'link', globalPersonId: SUBJECT, localAccountId: '128', traceId: 'test:128' });
  const link = requests[1];
  assert.equal(link.url, current.backchannelUrl);
  assert.equal(link.options.auth.username, 'school-client');
  assert.equal(link.options.auth.password, TEST_SECRET);
  assert.equal(JSON.stringify(link.body).includes(TEST_SECRET), false);
  assert.equal(Object.hasOwn(link.body, 'platform_client_id'), false);
  for (const request of requests) {
    assert.equal(request.url.includes(TEST_SECRET), false);
    assert.equal(request.options.maxRedirects, 0);
  }
});

test('UserInfo仍严格要求与已验签subject一致', async () => {
  const service = new IdentityOIDCService({
    identityConfig: deployment(),
    httpClient: { async get() { return { data: { sub: 'other-subject', platform_link: { linked: false } } }; } }
  });
  await assert.rejects(service.getUserInfo('A'.repeat(43), SUBJECT), hasCode('IDENTITY_USERINFO_INVALID'));
});

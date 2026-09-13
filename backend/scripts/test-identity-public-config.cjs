/**
 * Identity公开配置定向测试。
 * 加载真实控制器、校验模块和路由源码；其余业务依赖通过白名单替身隔离。
 * 不加载应用入口、dotenv、数据库、Redis，也不调用真实Identity服务。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const runtime = require('../src/config/identityRuntimeConfig');

const backend = path.resolve(__dirname, '..');
const secret = 'public-config-test-secret-'.repeat(3);

function loadIsolated(relative, dependencies) {
  const filename = path.join(backend, relative);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    exports: module.exports,
    require(name) {
      if (!Object.hasOwn(dependencies, name)) {
        throw new Error(`测试禁止加载未授权依赖：${name}`);
      }
      return dependencies[name];
    }
  }, { filename });
  return module.exports;
}

function configuration(domain = 'ai.xingyuncl.com', clientId = 'test-xingyun-client') {
  return runtime.loadIdentityRuntimeConfig({
    IDENTITY_ENABLED: 'true',
    IDENTITY_PUBLIC_ORIGIN: `https://${domain}`,
    IDENTITY_CLIENT_ID: clientId,
    IDENTITY_CLIENT_SECRET: secret
  });
}

function controllerFor(identity) {
  return loadIsolated('src/controllers/IdentityRuntimeConfigController.js', {
    '../config': { identity },
    '../config/identityRuntimeConfig': runtime
  });
}

function requestConfig(identity, request = {}) {
  const result = { statusCode: null, headers: {}, body: null };
  const response = {
    set(name, value) { result.headers[name.toLowerCase()] = value; return this; },
    status(value) { result.statusCode = value; return this; },
    json(value) { result.body = JSON.parse(JSON.stringify(value)); return this; }
  };
  controllerFor(identity).getPublicConfig(request, response);
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(result.headers.pragma, 'no-cache');
  assert.equal(result.headers['x-content-type-options'], 'nosniff');
  assert.equal(JSON.stringify(result).includes(secret), false);
  return result;
}

for (const [domain, clientId] of [
  ['ai.xingyuncl.com', 'test-xingyun-client'],
  ['ai.pkuailab.com', 'test-pku-client']
]) {
  test(`公开合同准确使用当前部署：${domain}`, () => {
    const result = requestConfig(configuration(domain, clientId));
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, {
      success: true,
      data: {
        enabled: true,
        issuer: 'https://id.pkuailab.com',
        publicOrigin: `https://${domain}`,
        clientId,
        authorizationEndpoint: 'https://id.pkuailab.com/oauth/authorize',
        loginRedirectUri: `https://${domain}/api/auth/identity/login/callback`,
        bindRedirectUri: `https://${domain}/api/auth/identity/callback`,
        scopes: ['openid', 'profile', 'platform_link'],
        responseType: 'code',
        responseMode: 'query',
        codeChallengeMethod: 'S256'
      }
    });
  });
}

test('未启用时只公开关闭状态，即使对象中含凭据也不泄露', () => {
  const result = requestConfig({ ...configuration(), enabled: false, enrollmentToken: secret });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { success: true, data: { enabled: false } });
});

for (const [name, changes] of [
  ['Secret缺失', { clientSecret: '' }],
  ['回调跨域', { bindRedirectUri: 'https://invalid.example/api/auth/identity/callback' }],
  ['来源夹带凭据', { issuer: `https://user:${secret}@invalid.example` }],
  ['启用开关类型错误', { enabled: 'true' }]
]) {
  test(`错误配置不给出部分合同且不回显配置值：${name}`, () => {
    const result = requestConfig({ ...configuration(), ...changes });
    assert.equal(result.statusCode, 503);
    assert.deepEqual(result.body, {
      success: false,
      code: 'IDENTITY_CONFIG_INVALID',
      message: '统一身份配置暂不可用，请使用原有登录方式。',
      data: null
    });
    assert.equal(JSON.stringify(result).includes('invalid.example'), false);
  });
}

test('请求参数及Host不参与信任配置，未来新增敏感字段也不自动公开', () => {
  const config = { ...configuration(), enrollmentToken: secret, databasePassword: secret };
  const hostileRequest = new Proxy({}, {
    get() { throw new Error('公开合同不应读取请求参数或请求头'); }
  });
  const result = requestConfig(config, hostileRequest);
  assert.equal(result.statusCode, 200);
  assert.equal(Object.hasOwn(result.body.data, 'enrollmentToken'), false);
  assert.equal(Object.hasOwn(result.body.data, 'databasePassword'), false);
  assert.equal(Object.hasOwn(result.body.data, 'clientSecret'), false);
});

test('新增公开路由不改变既有认证路由的处理器与JWT守卫位置', () => {
  const entries = [];
  const handlers = new Map();
  const handler = name => {
    if (!handlers.has(name)) handlers.set(name, () => {});
    return handlers.get(name);
  };
  const controller = prefix => new Proxy({}, { get: (_, key) => handler(`${prefix}.${key}`) });
  const authenticate = handler('authenticate');
  const publicController = controllerFor(configuration());
  const router = {};
  for (const method of ['get', 'post', 'put', 'use']) {
    router[method] = (...args) => { entries.push({ method, args }); return router; };
  }
  loadIsolated('src/routes/auth.js', {
    express: { Router: () => router },
    '../controllers/AuthControllerRefactored': controller('local'),
    '../controllers/IdentityAuthController': controller('identity'),
    '../controllers/IdentityRuntimeConfigController': publicController,
    '../middleware/authMiddleware': { authenticate }
  });
  const publicEntries = entries.filter(entry => entry.args[0] === '/identity/config');
  assert.equal(publicEntries.length, 1);
  assert.equal(publicEntries[0].method, 'get');
  assert.equal(publicEntries[0].args[1], publicController.getPublicConfig);
  assert.ok(entries.indexOf(publicEntries[0]) < entries.findIndex(entry => entry.method === 'use'));

  // 固定既有路由合同，确保公开配置没有挪动或绕开本地认证边界。
  const expected = [
    ['post', '/login', 'local.login'],
    ['post', '/register', 'local.register'],
    ['post', '/refresh', 'local.refreshToken'],
    ['post', '/sso', 'local.ssoLogin'],
    ['get', '/identity/login/start', 'identity.startLogin'],
    ['get', '/identity/login/callback', 'identity.loginCallback'],
    ['post', '/identity/login/consume', 'identity.consumeLogin'],
    ['get', '/identity/callback', 'identity.accountCallback'],
    ['post', '/send-email-code', 'local.sendEmailCode'],
    ['post', '/login-by-code', 'local.loginByEmailCode'],
    ['post', '/login-by-email-password', 'local.loginByEmailPassword'],
    ['post', '/verify-invitation-code', 'local.verifyInvitationCode'],
    ['post', '/check-email', 'local.checkEmail'],
    ['post', '/check-username', 'local.checkUsername'],
    ['use', null, 'authenticate'],
    ['get', '/me', 'local.getCurrentUser'],
    ['put', '/profile', 'local.updateProfile'],
    ['put', '/password', 'local.changePassword'],
    ['get', '/credit-history', 'local.getCreditHistory'],
    ['post', '/logout', 'local.logout'],
    ['post', '/identity/connect/start', 'identity.startConnect'],
    ['post', '/identity/unlink/start', 'identity.startUnlink']
  ];
  const existing = entries.filter(entry => entry !== publicEntries[0]);
  assert.equal(existing.length, expected.length);
  expected.forEach(([method, route, name], index) => {
    assert.equal(existing[index].method, method);
    assert.deepEqual(existing[index].args, route === null ? [authenticate] : [route, handler(name)]);
  });
});

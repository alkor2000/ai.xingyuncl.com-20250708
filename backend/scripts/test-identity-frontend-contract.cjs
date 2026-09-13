/**
 * 真实后端公开合同到前端授权校验的定向测试。
 * 使用虚构凭据和白名单依赖隔离，不加载真实配置、数据库、Redis或网络客户端。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const runtime = require('../src/config/identityRuntimeConfig')
const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'frontend/src/utils/identityRuntimeAuthorization.js'), 'utf8')
const frontend = import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))

function publicContract(origin = 'https://ai.xingyuncl.com', clientId = 'test-deployment-client') {
  const identity = runtime.loadIdentityRuntimeConfig({
    IDENTITY_ENABLED: 'true',
    IDENTITY_PUBLIC_ORIGIN: origin,
    IDENTITY_CLIENT_ID: clientId,
    IDENTITY_CLIENT_SECRET: 'frontend-contract-test-secret-'.repeat(3)
  })
  const module = { exports: {} }
  const dependencies = {
    '../config': { identity },
    '../config/identityRuntimeConfig': runtime
  }
  vm.runInNewContext(fs.readFileSync(
    path.join(root, 'backend/src/controllers/IdentityRuntimeConfigController.js'), 'utf8'
  ), {
    module,
    require(name) {
      if (!Object.hasOwn(dependencies, name)) throw new Error('禁止加载业务依赖')
      return dependencies[name]
    }
  })
  let body
  const res = {
    set() { return this },
    status(code) { assert.equal(code, 200); return this },
    json(value) { body = JSON.parse(JSON.stringify(value)); return this }
  }
  module.exports.getPublicConfig({}, res)
  return body.data
}

function authorizationURL(config) {
  const url = new URL(config.authorizationEndpoint)
  const parameters = {
    response_type: 'code', response_mode: 'query', client_id: config.clientId,
    redirect_uri: config.bindRedirectUri, scope: 'openid profile platform_link',
    state: 's'.repeat(43), nonce: 'n'.repeat(43), code_challenge: 'c'.repeat(43),
    code_challenge_method: 'S256'
  }
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value)
  return url
}

for (const origin of ['https://ai.xingyuncl.com', 'https://ai.pkuailab.com']) {
  test(`实际后端公开合同可被前端接受：${origin}`, async () => {
    const api = await frontend
    const config = publicContract(origin, origin.includes('xingyun') ? 'test-xingyun' : 'test-pku')
    const trusted = api.validateIdentityPublicConfig(config, origin)
    assert.ok(Object.isFrozen(trusted))
    assert.ok(Object.isFrozen(trusted.scopes))
    assert.equal(api.validateIdentityRuntimeAuthorizationURL(
      authorizationURL(config).href, trusted, origin
    ), authorizationURL(config).href)
  })
}

for (const [name, mutate] of [
  ['关闭状态', c => { c.enabled = false }],
  ['其他部署来源', c => { c.publicOrigin = 'https://other.example' }],
  ['非HTTPS来源', c => { c.issuer = 'http://id.pkuailab.com' }],
  ['空客户端ID', c => { c.clientId = '' }],
  ['授权入口夹带查询', c => { c.authorizationEndpoint += '?client_id=wrong' }],
  ['登录回调跨域', c => { c.loginRedirectUri = 'https://other.example/callback' }],
  ['绑定回调混用登录回调', c => { c.bindRedirectUri = c.loginRedirectUri }],
  ['Scope重复', c => { c.scopes = ['openid', 'openid', 'platform_link'] }],
  ['隐式授权', c => { c.responseType = 'token' }],
  ['PKCE降级', c => { c.codeChallengeMethod = 'plain' }]
]) {
  test(`拒绝非法公开配置：${name}`, async () => {
    const api = await frontend
    const config = publicContract()
    mutate(config)
    assert.throws(() => api.validateIdentityPublicConfig(config, 'https://ai.xingyuncl.com'))
  })
}

for (const [name, mutate] of [
  ['错误Identity来源', u => { u.hostname = 'other.example' }],
  ['错误授权路径', u => { u.pathname = '/other' }],
  ['URL用户信息', u => { u.username = 'user' }],
  ['URL片段', u => { u.hash = 'fragment' }],
  ['错误客户端', u => { u.searchParams.set('client_id', 'wrong-client') }],
  ['错误回调用途', u => { u.searchParams.set('redirect_uri', publicContract().loginRedirectUri) }],
  ['重复参数', u => { u.searchParams.append('client_id', 'wrong-client') }],
  ['夹带Secret', u => { u.searchParams.set('client_secret', 'must-not-return-this') }],
  ['夹带Verifier', u => { u.searchParams.set('code_verifier', 'must-not-return-this') }],
  ['缺失Nonce', u => { u.searchParams.delete('nonce') }],
  ['无效State', u => { u.searchParams.set('state', 'short') }],
  ['无效Challenge', u => { u.searchParams.set('code_challenge', 'short') }],
  ['Scope扩大', u => { u.searchParams.set('scope', 'openid profile platform_link admin') }],
  ['PKCE降级', u => { u.searchParams.set('code_challenge_method', 'plain') }]
]) {
  test(`拒绝非法授权地址：${name}`, async () => {
    const api = await frontend
    const config = publicContract()
    const url = authorizationURL(config)
    mutate(url)
    assert.throws(() => api.validateIdentityRuntimeAuthorizationURL(url.href, config, config.publicOrigin), error => {
      assert.equal(error.code, 'IDENTITY_CONFIG_INVALID')
      assert.equal(error.message.includes('must-not-return-this'), false)
      return true
    })
  })
}

for (const operation of ['link', 'unlink']) {
  test(`账号确认后读取配置，再申请对应Flow：${operation}`, async () => {
    const api = await frontend
    const config = publicContract('https://ai.pkuailab.com', 'test-pku-client')
    const calls = []
    const client = {
      async get(url) { calls.push(['get', url]); return { data: { success: true, data: config } } },
      async post(url, body) {
        calls.push(['post', url, body])
        return { data: { success: true, data: { authorizationUrl: authorizationURL(config).href } } }
      }
    }
    const safeURL = await api.startIdentityAccountAuthorization(client, operation, '/profile', config.publicOrigin)
    assert.equal(safeURL, authorizationURL(config).href)
    assert.deepEqual(calls, [
      ['get', '/auth/identity/config'],
      ['post', `/auth/identity/${operation === 'link' ? 'connect' : 'unlink'}/start`, {
        confirm_current_account: true, return_to: '/profile'
      }]
    ])
  })
}

test('配置关闭或请求失败时不申请Flow；后端拒绝或返回恶意地址时不返回跳转URL', async () => {
  const api = await frontend
  let postCalls = 0
  const client = {
    async get() { return { data: { success: true, data: { enabled: false } } } },
    async post() { postCalls++; throw new Error('不应申请Flow') }
  }
  await assert.rejects(api.startIdentityAccountAuthorization(client, 'link', '/profile', 'https://ai.xingyuncl.com'))
  client.get = async () => { throw new Error('模拟请求失败') }
  await assert.rejects(api.startIdentityAccountAuthorization(client, 'link', '/profile', 'https://ai.xingyuncl.com'))
  assert.equal(postCalls, 0)
  const config = publicContract()
  client.get = async () => ({ data: { success: true, data: config } })
  for (const response of [
    { success: false, data: null },
    { success: true, data: { authorizationUrl: 'https://other.example' } }
  ]) {
    client.post = async () => ({ data: response })
    await assert.rejects(api.startIdentityAccountAuthorization(client, 'link', '/profile', config.publicOrigin))
  }
})

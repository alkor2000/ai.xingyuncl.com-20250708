/**
 * 当前部署的Identity账号关联授权。
 *
 * 公开配置只由组件通过同源后端获取，不能从Query、localStorage或授权URL反推信任对象。
 * 本模块保持协议白名单校验，并把配置读取、Flow申请和授权URL核验放在同一操作中。
 * 不缓存部署配置，不接收或保存Client Secret，也不执行浏览器跳转。
 */
const REQUIRED_SCOPES = Object.freeze(['openid', 'profile', 'platform_link'])
const AUTHORIZATION_PARAMETERS = Object.freeze([
  'response_type', 'response_mode', 'client_id', 'redirect_uri', 'scope',
  'state', 'nonce', 'code_challenge', 'code_challenge_method'
])

function rejectContract() {
  // 错误不携带URL、配置内容或响应对象，避免日志泄露state及其他协议数据。
  const error = new Error('Identity authorization configuration invalid')
  error.code = 'IDENTITY_CONFIG_INVALID'
  throw error
}

function requireHTTPSOrigin(value) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    rejectContract()
  }
  if (typeof value !== 'string' || parsed.protocol !== 'https:' ||
      parsed.username || parsed.password || parsed.origin !== value) {
    rejectContract()
  }
}

function hasRequiredScopes(scopes) {
  return Array.isArray(scopes) && scopes.length === REQUIRED_SCOPES.length &&
    new Set(scopes).size === REQUIRED_SCOPES.length &&
    REQUIRED_SCOPES.every(scope => scopes.includes(scope))
}

/** 验证后端公开合同，同时确认回调确实属于当前浏览器访问的部署。 */
export function validateIdentityPublicConfig(value, currentOrigin) {
  if (!value || typeof value !== 'object' || value.enabled !== true) rejectContract()
  requireHTTPSOrigin(currentOrigin)
  requireHTTPSOrigin(value.issuer)
  requireHTTPSOrigin(value.publicOrigin)

  if (value.publicOrigin !== currentOrigin ||
      typeof value.clientId !== 'string' || value.clientId.length < 1 || value.clientId.length > 128 ||
      /[\x00-\x20\x7F:]/.test(value.clientId) ||
      value.authorizationEndpoint !== value.issuer + '/oauth/authorize' ||
      value.loginRedirectUri !== currentOrigin + '/api/auth/identity/login/callback' ||
      value.bindRedirectUri !== currentOrigin + '/api/auth/identity/callback' ||
      value.responseType !== 'code' || value.responseMode !== 'query' ||
      value.codeChallengeMethod !== 'S256' || !hasRequiredScopes(value.scopes)) {
    rejectContract()
  }

  // 只复制需要的公开字段，并固定本次操作的合同，避免异步流程中信任对象被改变。
  return Object.freeze({
    enabled: true,
    issuer: value.issuer,
    publicOrigin: value.publicOrigin,
    clientId: value.clientId,
    authorizationEndpoint: value.authorizationEndpoint,
    loginRedirectUri: value.loginRedirectUri,
    bindRedirectUri: value.bindRedirectUri,
    responseType: 'code',
    responseMode: 'query',
    codeChallengeMethod: 'S256',
    scopes: REQUIRED_SCOPES
  })
}

/**
 * 绑定和解绑共用固定账号关联回调；不能混用登录回调。
 * 配置允许随部署变化，参数种类、出现次数、Scope与PKCE要求保持固定。
 */
export function validateIdentityRuntimeAuthorizationURL(rawURL, configuration, currentOrigin) {
  const trusted = validateIdentityPublicConfig(configuration, currentOrigin)
  if (typeof rawURL !== 'string' || rawURL.length < 1 || rawURL.length > 4096 ||
      /[\x00-\x20\x7F]/.test(rawURL)) rejectContract()

  let parsed
  try {
    parsed = new URL(rawURL)
  } catch {
    rejectContract()
  }
  if (parsed.origin !== trusted.issuer || parsed.pathname !== '/oauth/authorize' ||
      parsed.username || parsed.password || parsed.hash) rejectContract()

  for (const key of parsed.searchParams.keys()) {
    if (!AUTHORIZATION_PARAMETERS.includes(key)) rejectContract()
  }
  for (const key of AUTHORIZATION_PARAMETERS) {
    if (parsed.searchParams.getAll(key).length !== 1) rejectContract()
  }
  if (parsed.searchParams.get('response_type') !== 'code' ||
      parsed.searchParams.get('response_mode') !== 'query' ||
      parsed.searchParams.get('client_id') !== trusted.clientId ||
      parsed.searchParams.get('redirect_uri') !== trusted.bindRedirectUri ||
      parsed.searchParams.get('code_challenge_method') !== 'S256' ||
      !hasRequiredScopes(parsed.searchParams.get('scope').trim().split(/\s+/))) {
    rejectContract()
  }
  for (const key of ['state', 'nonce', 'code_challenge']) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(parsed.searchParams.get(key))) rejectContract()
  }
  return parsed.toString()
}

/**
 * 仅在用户确认当前账号后调用；本地JWT仍由既有apiClient附加，后端继续执行身份校验。
 * 先校验配置再申请Flow；任何步骤失败都抛错，调用方不得跳转或回退到旧客户端配置。
 */
export async function startIdentityAccountAuthorization(apiClient, operation, returnTo, currentOrigin) {
  if (operation !== 'link' && operation !== 'unlink') rejectContract()
  const publicResponse = await apiClient.get('/auth/identity/config', { timeout: 10000 })
  if (publicResponse?.data?.success !== true) rejectContract()
  const trusted = validateIdentityPublicConfig(publicResponse.data.data, currentOrigin)
  const endpoint = operation === 'link' ? '/auth/identity/connect/start' : '/auth/identity/unlink/start'
  const response = await apiClient.post(endpoint, {
    confirm_current_account: true,
    return_to: returnTo
  })
  if (response?.data?.success !== true) rejectContract()
  return validateIdentityRuntimeAuthorizationURL(response.data.data?.authorizationUrl, trusted, currentOrigin)
}

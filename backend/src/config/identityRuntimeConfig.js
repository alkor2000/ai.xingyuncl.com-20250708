/**
 * Identity 部署运行配置。
 *
 * 配置只来自后端启动环境；浏览器参数、Host 请求头及 Token 内容不能决定信任对象。
 * 旧环境变量继续有效，已有部署无需重新 Enrollment 或轮换 Secret。
 * 本模块不连接数据库、不发网络请求，也不自动注册或启用部署实例。
 */
const LOGIN_CALLBACK_PATH = '/api/auth/identity/login/callback';
const BIND_CALLBACK_PATH = '/api/auth/identity/callback';
const BACKCHANNEL_PATH = '/backchannel/platform-account-links';
const LEGACY_PUBLIC_ORIGIN = 'https://ai.xingyuncl.com';
const REQUIRED_SCOPES = Object.freeze(['openid', 'profile', 'platform_link']);

function configurationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/** 只提取后端配置中的来源；无效输入留给启用检查处理，不阻断本地登录。 */
function configuredOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

/**
 * 在应用启动时读取一次环境变量。
 * 显式 public origin 优先；旧部署只配置登录回调时，从该回调推导公开来源。
 * 没有配置上述字段时保留历史默认值，避免本次升级自行迁移已有部署。
 */
function loadIdentityRuntimeConfig(env = process.env) {
  const issuer = env.IDENTITY_ISSUER || 'https://id.pkuailab.com';
  const publicOrigin = env.IDENTITY_PUBLIC_ORIGIN || (
    env.IDENTITY_LOGIN_REDIRECT_URI
      ? configuredOrigin(env.IDENTITY_LOGIN_REDIRECT_URI)
      : LEGACY_PUBLIC_ORIGIN
  );

  return Object.freeze({
    enabled: env.IDENTITY_ENABLED === 'true',
    issuer,
    publicOrigin,
    clientId: env.IDENTITY_CLIENT_ID || 'ai-platform-client',
    clientSecret: env.IDENTITY_CLIENT_SECRET || '',
    tokenAuthMethod: env.IDENTITY_TOKEN_AUTH_METHOD || 'client_secret_post',
    loginRedirectUri: env.IDENTITY_LOGIN_REDIRECT_URI || publicOrigin + LOGIN_CALLBACK_PATH,
    bindRedirectUri: env.IDENTITY_BIND_REDIRECT_URI || publicOrigin + BIND_CALLBACK_PATH,
    backchannelUrl: env.IDENTITY_BACKCHANNEL_URL || issuer + BACKCHANNEL_PATH,
    scopes: REQUIRED_SCOPES,
    flowTtlSeconds: Number(env.IDENTITY_FLOW_TTL_SECONDS || '600'),
    handoffTtlSeconds: Number(env.IDENTITY_HANDOFF_TTL_SECONDS || '90'),
    httpTimeoutMs: Number(env.IDENTITY_HTTP_TIMEOUT_MS || '10000'),
    jwksCacheSeconds: Number(env.IDENTITY_JWKS_CACHE_SECONDS || '300')
  });
}

/**
 * 要求规范的 HTTPS origin，拒绝用户信息、路径、查询、片段和隐式规范化。
 * 错误信息只包含字段名，不回显可能夹带凭据的原始配置值。
 */
function assertHTTPSOrigin(value, field) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw configurationError('IDENTITY_CONFIG_INVALID', `${field}必须是规范的HTTPS来源`);
  }

  if (typeof value !== 'string' || parsed.protocol !== 'https:' ||
      !parsed.hostname || parsed.username || parsed.password ||
      parsed.search || parsed.hash || parsed.origin !== value) {
    throw configurationError('IDENTITY_CONFIG_INVALID', `${field}必须是规范的HTTPS来源`);
  }
}

function assertIntegerRange(value, minimum, maximum, field) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw configurationError('IDENTITY_CONFIG_INVALID', `${field}超出允许范围`);
  }
}

/**
 * 发起 Identity 协议请求前验证完整合同。
 * 配置可随部署变化，但回调路径、协议、Scope 和 Secret 边界不随之放宽。
 * Backchannel 固定在同一 issuer 下，防止把 Client Secret 发送到另一台服务。
 */
function validateIdentityRuntimeConfig(current) {
  if (!current?.enabled) {
    throw configurationError('IDENTITY_DISABLED', '统一身份登录尚未启用');
  }
  if (current.enabled !== true) {
    throw configurationError('IDENTITY_CONFIG_INVALID', 'Identity启用开关格式无效');
  }

  const publicOrigin = current.publicOrigin === undefined
    ? configuredOrigin(current.loginRedirectUri)
    : current.publicOrigin;
  const backchannelUrl = current.backchannelUrl === undefined
    ? current.issuer + BACKCHANNEL_PATH
    : current.backchannelUrl;

  assertHTTPSOrigin(current.issuer, 'Identity issuer');
  assertHTTPSOrigin(publicOrigin, 'Identity public origin');

  if (typeof current.clientId !== 'string' || current.clientId.length < 1 ||
      current.clientId.length > 128 || /[\x00-\x20\x7F]/.test(current.clientId) ||
      current.clientId.includes(':')) {
    // Backchannel 使用 HTTP Basic；Client ID 中的冒号会破坏用户名/密码分隔语义。
    throw configurationError('IDENTITY_CONFIG_INVALID', 'Identity Client ID格式无效');
  }
  if (current.tokenAuthMethod !== 'client_secret_post' ||
      current.loginRedirectUri !== publicOrigin + LOGIN_CALLBACK_PATH ||
      current.bindRedirectUri !== publicOrigin + BIND_CALLBACK_PATH ||
      backchannelUrl !== current.issuer + BACKCHANNEL_PATH) {
    throw configurationError('IDENTITY_CONFIG_INVALID', 'Identity回调或Backchannel配置不符合部署合同');
  }

  if (!Array.isArray(current.scopes) || current.scopes.length !== REQUIRED_SCOPES.length ||
      new Set(current.scopes).size !== REQUIRED_SCOPES.length ||
      !REQUIRED_SCOPES.every(scope => current.scopes.includes(scope))) {
    throw configurationError('IDENTITY_CONFIG_INVALID', 'Identity scope配置不符合协议范围');
  }
  if (typeof current.clientSecret !== 'string' || current.clientSecret.length < 32 ||
      current.clientSecret.length > 512 || /[\x00-\x20\x7F]/.test(current.clientSecret)) {
    throw configurationError('IDENTITY_SECRET_INVALID', 'Identity Client Secret未正确配置');
  }

  assertIntegerRange(current.flowTtlSeconds, 60, 900, 'Identity Flow TTL');
  assertIntegerRange(current.handoffTtlSeconds, 30, 300, 'Identity Handoff TTL');
  assertIntegerRange(current.httpTimeoutMs, 1000, 30000, 'Identity HTTP超时');
  assertIntegerRange(current.jwksCacheSeconds, 30, 3600, 'Identity JWKS缓存时长');

  return Object.freeze({ ...current, publicOrigin, backchannelUrl, scopes: REQUIRED_SCOPES });
}

module.exports = {
  loadIdentityRuntimeConfig,
  validateIdentityRuntimeConfig,
  REQUIRED_SCOPES
};

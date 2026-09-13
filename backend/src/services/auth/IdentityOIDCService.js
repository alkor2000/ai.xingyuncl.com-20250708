/**
 * Identity OIDC / Backchannel Client。
 *
 * 职责：构造 PKCE 授权、后端 Code 交换、Ed25519 验签、读取平台关联及执行关联操作。
 * 部署身份来自后端运行配置；issuer、Client ID 和回调不再固定为某一个部署实例。
 * 本模块不创建本地用户，不调用历史 /auth/sso，不改变本地 JWT 或权限规则。
 * Access Token、ID Token、Client Secret 不得进入 URL 或普通日志。
 */
const axios = require('axios');
const crypto = require('crypto');
const config = require('../../config');
const {
  validateIdentityRuntimeConfig,
  REQUIRED_SCOPES
} = require('../../config/identityRuntimeConfig');

const MAX_ID_TOKEN_LIFETIME_SECONDS = 5 * 60;
const CLOCK_TOLERANCE_SECONDS = 30;

class IdentityOIDCService {
  constructor({ identityConfig = config.identity, httpClient = axios } = {}) {
    // 每个服务实例固定一份启动配置，避免运行中切换信任对象却继续复用旧 JWKS 缓存。
    // 克隆后冻结，不修改调用者传入的配置对象。
    this.identityConfig = Object.freeze({
      ...identityConfig,
      scopes: Array.isArray(identityConfig?.scopes)
        ? Object.freeze([...identityConfig.scopes])
        : identityConfig?.scopes
    });
    this.httpClient = httpClient;
    this.jwksCache = { expiresAt: 0, keysByKid: new Map() };
  }

  /** 未启用或合同非法时，在发送任何协议请求前停止。 */
  assertConfigured() {
    return validateIdentityRuntimeConfig(this.identityConfig);
  }

  /** login 与 bind/unlink 使用各自已登记的固定回调路径。 */
  _redirectUri(purpose) {
    if (purpose === 'login') return this.identityConfig.loginRedirectUri;
    if (purpose === 'bind' || purpose === 'unlink') return this.identityConfig.bindRedirectUri;
    throw IdentityOIDCService.createError('IDENTITY_PURPOSE_INVALID', 'Identity授权用途无效');
  }

  buildAuthorizationURL({ state, nonce, codeChallenge, purpose }) {
    this.assertConfigured();
    if (!IdentityOIDCService.isOpaqueToken(state) ||
        !IdentityOIDCService.isOpaqueToken(nonce) ||
        !IdentityOIDCService.isOpaqueToken(codeChallenge)) {
      throw IdentityOIDCService.createError('IDENTITY_AUTH_INPUT_INVALID', 'Identity授权参数格式无效');
    }

    const url = new URL('/oauth/authorize', this.identityConfig.issuer);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('response_mode', 'query');
    url.searchParams.set('client_id', this.identityConfig.clientId);
    url.searchParams.set('redirect_uri', this._redirectUri(purpose));
    url.searchParams.set('scope', REQUIRED_SCOPES.join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  /** 完成 Code 交换、ID Token 验签和 UserInfo 身份一致性核验。 */
  async completeAuthorization({ code, codeVerifier, nonce, purpose }) {
    this.assertConfigured();
    if (!IdentityOIDCService.isAuthorizationCode(code) ||
        !IdentityOIDCService.isOpaqueToken(codeVerifier) ||
        !IdentityOIDCService.isOpaqueToken(nonce)) {
      throw IdentityOIDCService.createError('IDENTITY_CALLBACK_INVALID', 'Identity callback参数无效');
    }

    const tokenResponse = await this.exchangeAuthorizationCode({ code, codeVerifier, purpose });
    const claims = await this.verifyIDToken(tokenResponse.idToken, nonce);
    const userInfo = await this.getUserInfo(tokenResponse.accessToken, claims.sub);
    return {
      subject: claims.sub,
      name: userInfo.name || '',
      platformLink: userInfo.platform_link
    };
  }

  /** Secret 仅放在后端 Token 请求正文，禁止跟随 HTTP 重定向。 */
  async exchangeAuthorizationCode({ code, codeVerifier, purpose }) {
    this.assertConfigured();
    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('code', code);
    body.set('redirect_uri', this._redirectUri(purpose));
    body.set('client_id', this.identityConfig.clientId);
    body.set('client_secret', this.identityConfig.clientSecret);
    body.set('code_verifier', codeVerifier);

    let response;
    try {
      response = await this.httpClient.post(
        new URL('/oauth/token', this.identityConfig.issuer).toString(),
        body.toString(),
        {
          timeout: this.identityConfig.httpTimeoutMs,
          maxRedirects: 0,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }
      );
    } catch (error) {
      // 不传播 Axios 原始错误对象，其中可能包含请求正文和 Client Secret。
      throw IdentityOIDCService.createError(
        'IDENTITY_TOKEN_EXCHANGE_FAILED',
        `Identity Token交换失败（HTTP ${error.response?.status || 'network'}）`
      );
    }

    const data = response?.data;
    if (!data || typeof data.access_token !== 'string' ||
        typeof data.id_token !== 'string' || data.token_type !== 'Bearer') {
      throw IdentityOIDCService.createError('IDENTITY_TOKEN_RESPONSE_INVALID', 'Identity Token响应格式无效');
    }
    return { accessToken: data.access_token, idToken: data.id_token };
  }

  /**
   * 严格验证 Ed25519 签名和 Claims。
   * 期望的 issuer/audience 来自本服务启动配置，绝不从待验证 Token 中反推。
   */
  async verifyIDToken(idToken, expectedNonce) {
    this.assertConfigured();
    if (typeof idToken !== 'string' || idToken.length < 64 || idToken.length > 16384 ||
        !IdentityOIDCService.isOpaqueToken(expectedNonce)) {
      throw IdentityOIDCService.createError('IDENTITY_ID_TOKEN_INVALID', 'Identity ID Token格式无效');
    }
    const parts = idToken.split('.');
    if (parts.length !== 3) {
      throw IdentityOIDCService.createError('IDENTITY_ID_TOKEN_INVALID', 'Identity ID Token结构无效');
    }

    const header = IdentityOIDCService.decodeJWTJSON(parts[0], 'header');
    const payload = IdentityOIDCService.decodeJWTJSON(parts[1], 'payload');
    if (header.alg !== 'EdDSA' || header.typ !== 'JWT' ||
        typeof header.kid !== 'string' || header.kid.length < 1 || header.kid.length > 128) {
      throw IdentityOIDCService.createError('IDENTITY_ID_TOKEN_INVALID', 'Identity ID Token Header不符合安全要求');
    }

    const jwk = await this.getSigningJWK(header.kid);
    let publicKey;
    try {
      publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    } catch {
      throw IdentityOIDCService.createError('IDENTITY_JWKS_INVALID', 'Identity JWKS公钥无法解析');
    }

    const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`, 'ascii');
    const signature = IdentityOIDCService.decodeBase64URL(parts[2]);
    if (!crypto.verify(null, signingInput, publicKey, signature)) {
      throw IdentityOIDCService.createError('IDENTITY_ID_TOKEN_INVALID', 'Identity ID Token签名无效');
    }
    IdentityOIDCService.validateIDTokenClaims(payload, expectedNonce, this.identityConfig);
    return payload;
  }

  /** 缓存只属于当前服务实例；缓存缺失、过期或 kid 未命中时重新获取 JWKS。 */
  async getSigningJWK(kid) {
    this.assertConfigured();
    if (this.jwksCache.expiresAt > Date.now() && this.jwksCache.keysByKid.has(kid)) {
      return this.jwksCache.keysByKid.get(kid);
    }
    await this.refreshJWKS();
    const jwk = this.jwksCache.keysByKid.get(kid);
    if (!jwk) {
      throw IdentityOIDCService.createError('IDENTITY_JWKS_KID_NOT_FOUND', 'Identity JWKS中不存在当前签名kid');
    }
    return jwk;
  }

  async refreshJWKS() {
    this.assertConfigured();
    let response;
    try {
      response = await this.httpClient.get(
        new URL('/.well-known/jwks.json', this.identityConfig.issuer).toString(),
        { timeout: this.identityConfig.httpTimeoutMs, maxRedirects: 0 }
      );
    } catch (error) {
      throw IdentityOIDCService.createError(
        'IDENTITY_JWKS_UNAVAILABLE',
        `Identity JWKS不可用（HTTP ${error.response?.status || 'network'}）`
      );
    }

    const keys = response?.data?.keys;
    if (!Array.isArray(keys) || keys.length < 1 || keys.length > 10) {
      throw IdentityOIDCService.createError('IDENTITY_JWKS_INVALID', 'Identity JWKS格式无效');
    }
    const keysByKid = new Map();
    for (const key of keys) {
      if (!key || key.kty !== 'OKP' || key.crv !== 'Ed25519' || key.alg !== 'EdDSA' ||
          key.use !== 'sig' || typeof key.kid !== 'string' ||
          typeof key.x !== 'string' || key.d !== undefined) {
        throw IdentityOIDCService.createError('IDENTITY_JWKS_INVALID', 'Identity JWKS包含不符合要求的公钥');
      }
      if (keysByKid.has(key.kid)) {
        throw IdentityOIDCService.createError('IDENTITY_JWKS_INVALID', 'Identity JWKS出现重复kid');
      }
      keysByKid.set(key.kid, {
        kty: key.kty, crv: key.crv, x: key.x, use: key.use, alg: key.alg, kid: key.kid
      });
    }
    this.jwksCache = {
      expiresAt: Date.now() + this.identityConfig.jwksCacheSeconds * 1000,
      keysByKid
    };
  }

  /** UserInfo 必须属于已通过验签的同一个 subject，本地账号仍解释为 users.id。 */
  async getUserInfo(accessToken, expectedSubject) {
    this.assertConfigured();
    if (typeof accessToken !== 'string' || accessToken.length < 32 || accessToken.length > 4096) {
      throw IdentityOIDCService.createError('IDENTITY_ACCESS_TOKEN_INVALID', 'Identity Access Token格式无效');
    }
    let response;
    try {
      response = await this.httpClient.get(
        new URL('/oauth/userinfo', this.identityConfig.issuer).toString(),
        {
          timeout: this.identityConfig.httpTimeoutMs,
          maxRedirects: 0,
          headers: { Authorization: `Bearer ${accessToken}` }
        }
      );
    } catch (error) {
      throw IdentityOIDCService.createError(
        'IDENTITY_USERINFO_FAILED',
        `Identity UserInfo读取失败（HTTP ${error.response?.status || 'network'}）`
      );
    }

    const userInfo = response?.data;
    if (!userInfo || userInfo.sub !== expectedSubject || !userInfo.platform_link ||
        typeof userInfo.platform_link.linked !== 'boolean') {
      throw IdentityOIDCService.createError('IDENTITY_USERINFO_INVALID', 'Identity UserInfo身份上下文不一致');
    }
    if (userInfo.platform_link.linked) {
      if (typeof userInfo.platform_link.local_account_id !== 'string' ||
          !/^[1-9][0-9]*$/.test(userInfo.platform_link.local_account_id)) {
        throw IdentityOIDCService.createError('IDENTITY_USERINFO_INVALID', 'Identity platform_link本地账号标识无效');
      }
    } else if (userInfo.platform_link.local_account_id !== undefined) {
      throw IdentityOIDCService.createError('IDENTITY_USERINFO_INVALID', 'Identity未关联状态不应返回local_account_id');
    }
    return userInfo;
  }

  /**
   * 关联操作保持既有时间戳、重放 nonce、幂等键和 trace 合同。
   * Client Secret 通过 HTTP Basic 发送，JSON 正文不包含客户端身份或 Secret。
   */
  async mutatePlatformLink({ operation, globalPersonId, localAccountId, traceId, idempotencyKey = null }) {
    const runtime = this.assertConfigured();
    if (operation !== 'link' && operation !== 'unlink') {
      throw IdentityOIDCService.createError('IDENTITY_LINK_OPERATION_INVALID', 'Identity平台关联操作无效');
    }
    if (!IdentityOIDCService.isCanonicalUUID(globalPersonId)) {
      throw IdentityOIDCService.createError('IDENTITY_SUBJECT_INVALID', 'Identity global_person_id格式无效');
    }
    const normalizedLocalAccountId = String(localAccountId ?? '');
    if (!/^[1-9][0-9]*$/.test(normalizedLocalAccountId)) {
      throw IdentityOIDCService.createError('IDENTITY_LOCAL_ACCOUNT_INVALID', 'Identity local_account_id格式无效');
    }
    if (typeof traceId !== 'string' || traceId.length < 1 || traceId.length > 128 ||
        !/^[A-Za-z0-9_.:-]+$/.test(traceId)) {
      throw IdentityOIDCService.createError('IDENTITY_TRACE_INVALID', 'Identity trace_id格式无效');
    }

    const payload = {
      request_time: new Date().toISOString(),
      replay_nonce: IdentityOIDCService.randomToken(32),
      idempotency_key: idempotencyKey || IdentityOIDCService.randomToken(32),
      schema_version: 1,
      operation,
      global_person_id: globalPersonId,
      local_account_id: normalizedLocalAccountId,
      trace_id: traceId
    };
    let response;
    try {
      response = await this.httpClient.post(runtime.backchannelUrl, payload, {
        timeout: runtime.httpTimeoutMs,
        maxRedirects: 0,
        auth: { username: runtime.clientId, password: runtime.clientSecret },
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      if (error.response?.status === 409) {
        throw IdentityOIDCService.createError('IDENTITY_LINK_CONFLICT', 'Identity平台账号关联发生冲突');
      }
      throw IdentityOIDCService.createError(
        'IDENTITY_BACKCHANNEL_FAILED',
        `Identity Backchannel调用失败（HTTP ${error.response?.status || 'network'}）`
      );
    }
    return response?.data || null;
  }

  /** 第三个参数由验签调用者传入已验证的服务端配置，支持不同部署实例的 audience。 */
  static validateIDTokenClaims(payload, expectedNonce, identityConfig = config.identity) {
    if (!payload || payload.iss !== identityConfig.issuer || payload.aud !== identityConfig.clientId ||
        !IdentityOIDCService.isCanonicalUUID(payload.sub) || payload.nonce !== expectedNonce ||
        !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) {
      throw IdentityOIDCService.createError('IDENTITY_ID_TOKEN_INVALID', 'Identity ID Token Claims不符合要求');
    }
    const now = Math.floor(Date.now() / 1000);
    if (payload.iat > now + CLOCK_TOLERANCE_SECONDS || payload.exp <= now - CLOCK_TOLERANCE_SECONDS ||
        payload.exp <= payload.iat || payload.exp - payload.iat > MAX_ID_TOKEN_LIFETIME_SECONDS) {
      throw IdentityOIDCService.createError('IDENTITY_ID_TOKEN_INVALID', 'Identity ID Token时间窗口无效');
    }
  }

  static decodeJWTJSON(encoded, label) {
    try {
      const parsed = JSON.parse(IdentityOIDCService.decodeBase64URL(encoded).toString('utf8'));
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('not-object');
      return parsed;
    } catch {
      throw IdentityOIDCService.createError('IDENTITY_ID_TOKEN_INVALID', `Identity ID Token ${label}无法解析`);
    }
  }

  static decodeBase64URL(value) {
    if (typeof value !== 'string' || value.length < 1 || !/^[A-Za-z0-9_-]+$/.test(value)) {
      throw IdentityOIDCService.createError('IDENTITY_ID_TOKEN_INVALID', 'Identity JWT base64url格式无效');
    }
    return Buffer.from(value, 'base64url');
  }

  static isAuthorizationCode(value) {
    return typeof value === 'string' && value.length >= 16 && value.length <= 512 &&
      /^[A-Za-z0-9._~-]+$/.test(value);
  }

  static isOpaqueToken(value) {
    return typeof value === 'string' && value.length === 43 && /^[A-Za-z0-9_-]{43}$/.test(value);
  }

  static isCanonicalUUID(value) {
    return typeof value === 'string' &&
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);
  }

  static randomToken(byteLength) {
    return crypto.randomBytes(byteLength).toString('base64url');
  }

  static sameStringSet(left, right) {
    if (left.length !== right.length) return false;
    const leftCopy = [...left].sort();
    const rightCopy = [...right].sort();
    return leftCopy.every((item, index) => item === rightCopy[index]);
  }

  static createError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }
}

const identityOIDCService = new IdentityOIDCService();
module.exports = identityOIDCService;
module.exports.IdentityOIDCService = IdentityOIDCService;

/**
 * PKU AI Lab Identity Center OIDC / Backchannel Client。
 *
 * 职责：
 * 1. 构造Authorization Code + PKCE授权地址
 * 2. 后端交换Authorization Code
 * 3. 拉取JWKS并使用Ed25519严格验证ID Token
 * 4. 调用UserInfo取得当前Client自己的platform_link事实
 * 5. 调用Platform Account Link Backchannel执行link/unlink
 *
 * 安全边界：
 * - 不调用本平台历史/auth/sso。
 * - 不自动创建本地用户。
 * - Identity Access Token、ID Token、Client Secret不得写入URL或普通日志。
 * - Client、Host、Redirect URI必须与已冻结生产合同完全一致。
 * - ID Token严格验证EdDSA、kid、iss、aud、exp、iat、nonce和sub。
 */

const axios = require('axios');
const crypto = require('crypto');
const config = require('../../config');

const FROZEN_ISSUER = 'https://id.pkuailab.com';
const FROZEN_CLIENT_ID = 'ai-platform-client';

const FROZEN_LOGIN_REDIRECT =
  'https://ai.xingyuncl.com/api/auth/identity/login/callback';

const FROZEN_BIND_REDIRECT =
  'https://ai.xingyuncl.com/api/auth/identity/callback';

const REQUIRED_SCOPES = [
  'openid',
  'profile',
  'platform_link'
];

const MAX_ID_TOKEN_LIFETIME_SECONDS = 5 * 60;
const CLOCK_TOLERANCE_SECONDS = 30;

class IdentityOIDCService {
  constructor({
    identityConfig = config.identity,
    httpClient = axios
  } = {}) {
    this.identityConfig = identityConfig;
    this.httpClient = httpClient;

    this.jwksCache = {
      expiresAt: 0,
      keysByKid: new Map()
    };
  }

  /**
   * 确认运行配置满足已经冻结的生产合同。
   */
  assertConfigured() {
    const current = this.identityConfig;

    if (!current?.enabled) {
      throw IdentityOIDCService.createError(
        'IDENTITY_DISABLED',
        '统一身份登录尚未启用'
      );
    }

    if (current.issuer !== FROZEN_ISSUER ||
        current.clientId !== FROZEN_CLIENT_ID ||
        current.loginRedirectUri !== FROZEN_LOGIN_REDIRECT ||
        current.bindRedirectUri !== FROZEN_BIND_REDIRECT ||
        current.tokenAuthMethod !== 'client_secret_post') {
      throw IdentityOIDCService.createError(
        'IDENTITY_CONFIG_INVALID',
        'Identity生产协议配置与已冻结合同不一致'
      );
    }

    if (!Array.isArray(current.scopes) ||
        !IdentityOIDCService.sameStringSet(
          current.scopes,
          REQUIRED_SCOPES
        )) {
      throw IdentityOIDCService.createError(
        'IDENTITY_CONFIG_INVALID',
        'Identity scope配置不符合冻结范围'
      );
    }

    if (typeof current.clientSecret !== 'string' ||
        current.clientSecret.length < 32 ||
        current.clientSecret.length > 512 ||
        /[\x00-\x20\x7F]/.test(current.clientSecret)) {
      throw IdentityOIDCService.createError(
        'IDENTITY_SECRET_INVALID',
        'Identity Client Secret未正确配置'
      );
    }

    if (!Number.isInteger(current.httpTimeoutMs) ||
        current.httpTimeoutMs < 1000 ||
        current.httpTimeoutMs > 30000) {
      throw IdentityOIDCService.createError(
        'IDENTITY_CONFIG_INVALID',
        'Identity HTTP超时配置无效'
      );
    }

    if (!Number.isInteger(current.jwksCacheSeconds) ||
        current.jwksCacheSeconds < 30 ||
        current.jwksCacheSeconds > 3600) {
      throw IdentityOIDCService.createError(
        'IDENTITY_CONFIG_INVALID',
        'Identity JWKS缓存配置无效'
      );
    }
  }

  /**
   * 构造Identity Authorization Endpoint URL。
   */
  buildAuthorizationURL({
    state,
    nonce,
    codeChallenge,
    purpose
  }) {
    this.assertConfigured();

    if (!IdentityOIDCService.isOpaqueToken(state) ||
        !IdentityOIDCService.isOpaqueToken(nonce) ||
        !IdentityOIDCService.isOpaqueToken(codeChallenge)) {
      throw IdentityOIDCService.createError(
        'IDENTITY_AUTH_INPUT_INVALID',
        'Identity授权参数格式无效'
      );
    }

    const redirectUri =
      purpose === 'login'
        ? this.identityConfig.loginRedirectUri
        : (
            purpose === 'bind' || purpose === 'unlink'
              ? this.identityConfig.bindRedirectUri
              : null
          );

    if (!redirectUri) {
      throw IdentityOIDCService.createError(
        'IDENTITY_PURPOSE_INVALID',
        'Identity授权用途无效'
      );
    }

    const url = new URL(
      '/oauth/authorize',
      this.identityConfig.issuer
    );

    url.searchParams.set('response_type', 'code');
    url.searchParams.set('response_mode', 'query');
    url.searchParams.set(
      'client_id',
      this.identityConfig.clientId
    );
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set(
      'scope',
      REQUIRED_SCOPES.join(' ')
    );
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set(
      'code_challenge',
      codeChallenge
    );
    url.searchParams.set(
      'code_challenge_method',
      'S256'
    );

    return url.toString();
  }

  /**
   * 完成Authorization Code交换 + ID Token验证 + UserInfo读取。
   */
  async completeAuthorization({
    code,
    codeVerifier,
    nonce,
    purpose
  }) {
    this.assertConfigured();

    if (!IdentityOIDCService.isAuthorizationCode(code) ||
        !IdentityOIDCService.isOpaqueToken(codeVerifier) ||
        !IdentityOIDCService.isOpaqueToken(nonce)) {
      throw IdentityOIDCService.createError(
        'IDENTITY_CALLBACK_INVALID',
        'Identity callback参数无效'
      );
    }

    const tokenResponse =
      await this.exchangeAuthorizationCode({
        code,
        codeVerifier,
        purpose
      });

    const idTokenClaims =
      await this.verifyIDToken(
        tokenResponse.idToken,
        nonce
      );

    const userInfo =
      await this.getUserInfo(
        tokenResponse.accessToken,
        idTokenClaims.sub
      );

    return {
      subject: idTokenClaims.sub,
      name: userInfo.name || '',
      platformLink: userInfo.platform_link
    };
  }

  /**
   * 后端Token Endpoint交换。
   */
  async exchangeAuthorizationCode({
    code,
    codeVerifier,
    purpose
  }) {
    this.assertConfigured();

    const redirectUri =
      purpose === 'login'
        ? this.identityConfig.loginRedirectUri
        : (
            purpose === 'bind' || purpose === 'unlink'
              ? this.identityConfig.bindRedirectUri
              : null
          );

    if (!redirectUri) {
      throw IdentityOIDCService.createError(
        'IDENTITY_PURPOSE_INVALID',
        'Identity授权用途无效'
      );
    }

    const body = new URLSearchParams();

    body.set('grant_type', 'authorization_code');
    body.set('code', code);
    body.set(
      'redirect_uri',
      redirectUri
    );
    body.set(
      'client_id',
      this.identityConfig.clientId
    );
    body.set(
      'client_secret',
      this.identityConfig.clientSecret
    );
    body.set(
      'code_verifier',
      codeVerifier
    );

    let response;

    try {
      response = await this.httpClient.post(
        new URL(
          '/oauth/token',
          this.identityConfig.issuer
        ).toString(),
        body.toString(),
        {
          timeout: this.identityConfig.httpTimeoutMs,
          maxRedirects: 0,
          headers: {
            'Content-Type':
              'application/x-www-form-urlencoded'
          }
        }
      );

    } catch (error) {
      throw IdentityOIDCService.createError(
        'IDENTITY_TOKEN_EXCHANGE_FAILED',
        `Identity Token交换失败（HTTP ${
          error.response?.status || 'network'
        }）`
      );
    }

    const data = response?.data;

    if (!data ||
        typeof data.access_token !== 'string' ||
        typeof data.id_token !== 'string' ||
        data.token_type !== 'Bearer') {
      throw IdentityOIDCService.createError(
        'IDENTITY_TOKEN_RESPONSE_INVALID',
        'Identity Token响应格式无效'
      );
    }

    return {
      accessToken: data.access_token,
      idToken: data.id_token
    };
  }

  /**
   * 严格验证Identity Ed25519 ID Token。
   */
  async verifyIDToken(
    idToken,
    expectedNonce
  ) {
    this.assertConfigured();

    if (typeof idToken !== 'string' ||
        idToken.length < 64 ||
        idToken.length > 16384 ||
        !IdentityOIDCService.isOpaqueToken(expectedNonce)) {
      throw IdentityOIDCService.createError(
        'IDENTITY_ID_TOKEN_INVALID',
        'Identity ID Token格式无效'
      );
    }

    const parts = idToken.split('.');

    if (parts.length !== 3) {
      throw IdentityOIDCService.createError(
        'IDENTITY_ID_TOKEN_INVALID',
        'Identity ID Token结构无效'
      );
    }

    const header =
      IdentityOIDCService.decodeJWTJSON(
        parts[0],
        'header'
      );

    const payload =
      IdentityOIDCService.decodeJWTJSON(
        parts[1],
        'payload'
      );

    if (header.alg !== 'EdDSA' ||
        header.typ !== 'JWT' ||
        typeof header.kid !== 'string' ||
        header.kid.length < 1 ||
        header.kid.length > 128) {
      throw IdentityOIDCService.createError(
        'IDENTITY_ID_TOKEN_INVALID',
        'Identity ID Token Header不符合安全要求'
      );
    }

    const jwk = await this.getSigningJWK(
      header.kid
    );

    let publicKey;

    try {
      publicKey = crypto.createPublicKey({
        key: jwk,
        format: 'jwk'
      });

    } catch {
      throw IdentityOIDCService.createError(
        'IDENTITY_JWKS_INVALID',
        'Identity JWKS公钥无法解析'
      );
    }

    const signingInput =
      Buffer.from(
        `${parts[0]}.${parts[1]}`,
        'ascii'
      );

    const signature =
      IdentityOIDCService.decodeBase64URL(
        parts[2]
      );

    const verified = crypto.verify(
      null,
      signingInput,
      publicKey,
      signature
    );

    if (!verified) {
      throw IdentityOIDCService.createError(
        'IDENTITY_ID_TOKEN_INVALID',
        'Identity ID Token签名无效'
      );
    }

    IdentityOIDCService.validateIDTokenClaims(
      payload,
      expectedNonce
    );

    return payload;
  }

  /**
   * 从JWKS读取指定kid的Ed25519公钥。
   */
  async getSigningJWK(kid) {
    const now = Date.now();

    if (this.jwksCache.expiresAt > now &&
        this.jwksCache.keysByKid.has(kid)) {
      return this.jwksCache.keysByKid.get(kid);
    }

    await this.refreshJWKS();

    const jwk =
      this.jwksCache.keysByKid.get(kid);

    if (!jwk) {
      throw IdentityOIDCService.createError(
        'IDENTITY_JWKS_KID_NOT_FOUND',
        'Identity JWKS中不存在当前签名kid'
      );
    }

    return jwk;
  }

  async refreshJWKS() {
    let response;

    try {
      response = await this.httpClient.get(
        new URL(
          '/.well-known/jwks.json',
          this.identityConfig.issuer
        ).toString(),
        {
          timeout: this.identityConfig.httpTimeoutMs,
          maxRedirects: 0
        }
      );

    } catch (error) {
      throw IdentityOIDCService.createError(
        'IDENTITY_JWKS_UNAVAILABLE',
        `Identity JWKS不可用（HTTP ${
          error.response?.status || 'network'
        }）`
      );
    }

    const keys = response?.data?.keys;

    if (!Array.isArray(keys) ||
        keys.length < 1 ||
        keys.length > 10) {
      throw IdentityOIDCService.createError(
        'IDENTITY_JWKS_INVALID',
        'Identity JWKS格式无效'
      );
    }

    const keysByKid = new Map();

    for (const key of keys) {
      if (!key ||
          key.kty !== 'OKP' ||
          key.crv !== 'Ed25519' ||
          key.alg !== 'EdDSA' ||
          key.use !== 'sig' ||
          typeof key.kid !== 'string' ||
          typeof key.x !== 'string' ||
          key.d !== undefined) {
        throw IdentityOIDCService.createError(
          'IDENTITY_JWKS_INVALID',
          'Identity JWKS包含不符合要求的公钥'
        );
      }

      if (keysByKid.has(key.kid)) {
        throw IdentityOIDCService.createError(
          'IDENTITY_JWKS_INVALID',
          'Identity JWKS出现重复kid'
        );
      }

      keysByKid.set(
        key.kid,
        {
          kty: key.kty,
          crv: key.crv,
          x: key.x,
          use: key.use,
          alg: key.alg,
          kid: key.kid
        }
      );
    }

    this.jwksCache = {
      expiresAt:
        Date.now() +
        this.identityConfig.jwksCacheSeconds * 1000,
      keysByKid
    };
  }

  /**
   * 调用UserInfo并强制sub与已经验签的ID Token一致。
   */
  async getUserInfo(
    accessToken,
    expectedSubject
  ) {
    if (typeof accessToken !== 'string' ||
        accessToken.length < 32 ||
        accessToken.length > 4096) {
      throw IdentityOIDCService.createError(
        'IDENTITY_ACCESS_TOKEN_INVALID',
        'Identity Access Token格式无效'
      );
    }

    let response;

    try {
      response = await this.httpClient.get(
        new URL(
          '/oauth/userinfo',
          this.identityConfig.issuer
        ).toString(),
        {
          timeout: this.identityConfig.httpTimeoutMs,
          maxRedirects: 0,
          headers: {
            Authorization:
              `Bearer ${accessToken}`
          }
        }
      );

    } catch (error) {
      throw IdentityOIDCService.createError(
        'IDENTITY_USERINFO_FAILED',
        `Identity UserInfo读取失败（HTTP ${
          error.response?.status || 'network'
        }）`
      );
    }

    const userInfo = response?.data;

    if (!userInfo ||
        userInfo.sub !== expectedSubject ||
        !userInfo.platform_link ||
        typeof userInfo.platform_link.linked !== 'boolean') {
      throw IdentityOIDCService.createError(
        'IDENTITY_USERINFO_INVALID',
        'Identity UserInfo身份上下文不一致'
      );
    }

    if (userInfo.platform_link.linked) {
      if (typeof userInfo.platform_link.local_account_id !== 'string' ||
          !/^[1-9][0-9]*$/.test(
            userInfo.platform_link.local_account_id
          )) {
        throw IdentityOIDCService.createError(
          'IDENTITY_USERINFO_INVALID',
          'Identity platform_link本地账号标识无效'
        );
      }
    } else if (
      userInfo.platform_link.local_account_id !== undefined
    ) {
      throw IdentityOIDCService.createError(
        'IDENTITY_USERINFO_INVALID',
        'Identity未关联状态不应返回local_account_id'
      );
    }

    return userInfo;
  }

  /**
   * 调用Identity Backchannel执行link/unlink。
   *
   * Client Secret通过HTTP Basic传输，不进入JSON Body。
   */
  async mutatePlatformLink({
    operation,
    globalPersonId,
    localAccountId,
    traceId,
    idempotencyKey = null
  }) {
    this.assertConfigured();

    if (operation !== 'link' &&
        operation !== 'unlink') {
      throw IdentityOIDCService.createError(
        'IDENTITY_LINK_OPERATION_INVALID',
        'Identity平台关联操作无效'
      );
    }

    if (!IdentityOIDCService.isCanonicalUUID(
      globalPersonId
    )) {
      throw IdentityOIDCService.createError(
        'IDENTITY_SUBJECT_INVALID',
        'Identity global_person_id格式无效'
      );
    }

    const normalizedLocalAccountId =
      String(localAccountId ?? '');

    if (!/^[1-9][0-9]*$/.test(
      normalizedLocalAccountId
    )) {
      throw IdentityOIDCService.createError(
        'IDENTITY_LOCAL_ACCOUNT_INVALID',
        'Identity local_account_id格式无效'
      );
    }

    if (typeof traceId !== 'string' ||
        traceId.length < 1 ||
        traceId.length > 128 ||
        !/^[A-Za-z0-9_.:-]+$/.test(traceId)) {
      throw IdentityOIDCService.createError(
        'IDENTITY_TRACE_INVALID',
        'Identity trace_id格式无效'
      );
    }

    const stableIdempotencyKey =
      idempotencyKey ||
      IdentityOIDCService.randomToken(32);

    const payload = {
      request_time: new Date().toISOString(),
      replay_nonce:
        IdentityOIDCService.randomToken(32),
      idempotency_key:
        stableIdempotencyKey,
      schema_version: 1,
      operation,
      global_person_id:
        globalPersonId,
      local_account_id:
        normalizedLocalAccountId,
      trace_id:
        traceId
    };

    let response;

    try {
      response = await this.httpClient.post(
        new URL(
          '/backchannel/platform-account-links',
          this.identityConfig.issuer
        ).toString(),
        payload,
        {
          timeout: this.identityConfig.httpTimeoutMs,
          maxRedirects: 0,

          auth: {
            username:
              this.identityConfig.clientId,
            password:
              this.identityConfig.clientSecret
          },

          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

    } catch (error) {
      if (error.response?.status === 409) {
        throw IdentityOIDCService.createError(
          'IDENTITY_LINK_CONFLICT',
          'Identity平台账号关联发生冲突'
        );
      }

      throw IdentityOIDCService.createError(
        'IDENTITY_BACKCHANNEL_FAILED',
        `Identity Backchannel调用失败（HTTP ${
          error.response?.status || 'network'
        }）`
      );
    }

    return response?.data || null;
  }

  static validateIDTokenClaims(
    payload,
    expectedNonce
  ) {
    if (!payload ||
        payload.iss !== FROZEN_ISSUER ||
        payload.aud !== FROZEN_CLIENT_ID ||
        !IdentityOIDCService.isCanonicalUUID(
          payload.sub
        ) ||
        payload.nonce !== expectedNonce ||
        !Number.isInteger(payload.iat) ||
        !Number.isInteger(payload.exp)) {
      throw IdentityOIDCService.createError(
        'IDENTITY_ID_TOKEN_INVALID',
        'Identity ID Token Claims不符合要求'
      );
    }

    const now =
      Math.floor(Date.now() / 1000);

    if (payload.iat >
          now + CLOCK_TOLERANCE_SECONDS ||
        payload.exp <=
          now - CLOCK_TOLERANCE_SECONDS ||
        payload.exp <= payload.iat ||
        payload.exp - payload.iat >
          MAX_ID_TOKEN_LIFETIME_SECONDS) {
      throw IdentityOIDCService.createError(
        'IDENTITY_ID_TOKEN_INVALID',
        'Identity ID Token时间窗口无效'
      );
    }
  }

  static decodeJWTJSON(
    encoded,
    label
  ) {
    try {
      const raw =
        IdentityOIDCService
          .decodeBase64URL(encoded)
          .toString('utf8');

      const parsed = JSON.parse(raw);

      if (!parsed ||
          Array.isArray(parsed) ||
          typeof parsed !== 'object') {
        throw new Error('not-object');
      }

      return parsed;

    } catch {
      throw IdentityOIDCService.createError(
        'IDENTITY_ID_TOKEN_INVALID',
        `Identity ID Token ${label}无法解析`
      );
    }
  }

  static decodeBase64URL(value) {
    if (typeof value !== 'string' ||
        value.length < 1 ||
        !/^[A-Za-z0-9_-]+$/.test(value)) {
      throw IdentityOIDCService.createError(
        'IDENTITY_ID_TOKEN_INVALID',
        'Identity JWT base64url格式无效'
      );
    }

    return Buffer.from(
      value,
      'base64url'
    );
  }

  static isAuthorizationCode(value) {
    return (
      typeof value === 'string' &&
      value.length >= 16 &&
      value.length <= 512 &&
      /^[A-Za-z0-9._~-]+$/.test(value)
    );
  }

  static isOpaqueToken(value) {
    return (
      typeof value === 'string' &&
      value.length === 43 &&
      /^[A-Za-z0-9_-]{43}$/.test(value)
    );
  }

  static isCanonicalUUID(value) {
    return (
      typeof value === 'string' &&
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
        .test(value)
    );
  }

  static randomToken(byteLength) {
    return crypto
      .randomBytes(byteLength)
      .toString('base64url');
  }

  static sameStringSet(left, right) {
    if (left.length !== right.length) {
      return false;
    }

    const leftCopy =
      [...left].sort();

    const rightCopy =
      [...right].sort();

    return leftCopy.every(
      (item, index) =>
        item === rightCopy[index]
    );
  }

  static createError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }
}

const identityOIDCService =
  new IdentityOIDCService();

module.exports = identityOIDCService;
module.exports.IdentityOIDCService =
  IdentityOIDCService;

/**
 * PKU AI Lab Identity Center浏览器Flow与一次性Handoff服务。
 *
 * 职责：
 * 1. 生成OAuth state、OIDC nonce、PKCE verifier/challenge
 * 2. 在Redis保存短时Flow
 * 3. 使用GETDEL原子消费Flow，防止callback重放
 * 4. 生成登录完成后的短时一次性Handoff
 * 5. 使用GETDEL原子消费Handoff，防止本地JWT重复签发
 *
 * 安全边界：
 * - Redis不可用时Identity流程直接fail-closed，不允许降级到内存或普通Cookie。
 * - Redis只保存短时协议上下文，不保存Identity Client Secret。
 * - state、nonce、verifier和handoff正文不得写入普通日志。
 * - return_to只允许本平台相对路径，禁止绝对URL与协议相对URL。
 */

const crypto = require('crypto');
const config = require('../../config');
const redisConnection = require('../../database/redis');

const FLOW_PURPOSE_LOGIN = 'login';
const FLOW_PURPOSE_BIND = 'bind';
const FLOW_PURPOSE_UNLINK = 'unlink';

const FLOW_KEY_PREFIX = 'identity:flow:';
const HANDOFF_KEY_PREFIX = 'identity:handoff:';

const MAX_RANDOM_KEY_ATTEMPTS = 3;
const MAX_RETURN_TO_BYTES = 2048;

class IdentityFlowService {
  constructor({
    redis = redisConnection,
    identityConfig = config.identity
  } = {}) {
    this.redis = redis;
    this.identityConfig = identityConfig;
  }

  /**
   * Identity流程必须显式启用且Redis可用。
   */
  assertAvailable() {
    if (!this.identityConfig?.enabled) {
      throw IdentityFlowService.createError(
        'IDENTITY_DISABLED',
        '统一身份登录尚未启用'
      );
    }

    if (!this.redis || !this.redis.isConnected) {
      throw IdentityFlowService.createError(
        'IDENTITY_REDIS_UNAVAILABLE',
        '统一身份登录暂时不可用'
      );
    }

    const flowTTL = this.identityConfig.flowTtlSeconds;
    const handoffTTL = this.identityConfig.handoffTtlSeconds;

    if (!Number.isInteger(flowTTL) ||
        flowTTL < 60 ||
        flowTTL > 900) {
      throw IdentityFlowService.createError(
        'IDENTITY_CONFIG_INVALID',
        'Identity Flow TTL配置无效'
      );
    }

    if (!Number.isInteger(handoffTTL) ||
        handoffTTL < 30 ||
        handoffTTL > 300) {
      throw IdentityFlowService.createError(
        'IDENTITY_CONFIG_INVALID',
        'Identity Handoff TTL配置无效'
      );
    }
  }

  /**
   * 创建一次OAuth/OIDC浏览器Flow。
   *
   * login不携带本地用户ID；
   * bind/unlink必须携带当前已经通过本地JWT认证的users.id。
   */
  async createFlow({
    purpose,
    localUserId = null,
    returnTo = '/dashboard'
  }) {
    this.assertAvailable();

    if (![FLOW_PURPOSE_LOGIN, FLOW_PURPOSE_BIND, FLOW_PURPOSE_UNLINK]
      .includes(purpose)) {
      throw IdentityFlowService.createError(
        'IDENTITY_PURPOSE_INVALID',
        'Identity Flow用途无效'
      );
    }

    const normalizedReturnTo =
      IdentityFlowService.normalizeReturnTo(returnTo);

    let normalizedLocalUserId = null;

    if (purpose === FLOW_PURPOSE_BIND ||
        purpose === FLOW_PURPOSE_UNLINK) {
      normalizedLocalUserId =
        IdentityFlowService.normalizeLocalUserId(localUserId);
    } else if (localUserId !== null &&
               localUserId !== undefined) {
      throw IdentityFlowService.createError(
        'IDENTITY_LOCAL_USER_UNEXPECTED',
        '登录用途不得预绑定本地用户'
      );
    }

    for (
      let attempt = 0;
      attempt < MAX_RANDOM_KEY_ATTEMPTS;
      attempt++
    ) {
      const state = IdentityFlowService.randomToken(32);
      const nonce = IdentityFlowService.randomToken(32);
      const codeVerifier = IdentityFlowService.randomToken(32);

      const codeChallenge =
        IdentityFlowService.createPKCEChallenge(codeVerifier);

      const flow = {
        version: 1,
        purpose,
        nonce,
        codeVerifier,
        localUserId: normalizedLocalUserId,
        returnTo: normalizedReturnTo,
        createdAt: new Date().toISOString()
      };

      const stored = await this.redis.setIfAbsent(
        IdentityFlowService.flowKey(state),
        flow,
        this.identityConfig.flowTtlSeconds
      );

      if (stored) {
        return {
          state,
          nonce,
          codeChallenge,
          codeChallengeMethod: 'S256',
          purpose,
          returnTo: normalizedReturnTo
        };
      }
    }

    throw IdentityFlowService.createError(
      'IDENTITY_RANDOM_COLLISION',
      '无法创建唯一Identity Flow'
    );
  }

  /**
   * 原子消费callback state。
   */
  async consumeFlow(state) {
    this.assertAvailable();

    if (!IdentityFlowService.isCanonicalRandomToken(state)) {
      throw IdentityFlowService.createError(
        'IDENTITY_STATE_INVALID',
        'Identity state无效'
      );
    }

    const flow = await this.redis.getDel(
      IdentityFlowService.flowKey(state)
    );

    if (!flow) {
      throw IdentityFlowService.createError(
        'IDENTITY_FLOW_EXPIRED',
        'Identity Flow不存在、已过期或已经使用'
      );
    }

    IdentityFlowService.validateStoredFlow(flow);

    return flow;
  }

  /**
   * 登录成功后生成短时一次性Handoff。
   *
   * Handoff只保存本地users.id和本地return_to，
   * 不保存Identity Access Token、ID Token或global_person_id。
   */
  async createHandoff({
    userId,
    returnTo = '/dashboard'
  }) {
    this.assertAvailable();

    const normalizedUserId =
      IdentityFlowService.normalizeLocalUserId(userId);

    const normalizedReturnTo =
      IdentityFlowService.normalizeReturnTo(returnTo);

    for (
      let attempt = 0;
      attempt < MAX_RANDOM_KEY_ATTEMPTS;
      attempt++
    ) {
      const ticket = IdentityFlowService.randomToken(32);

      const payload = {
        version: 1,
        userId: normalizedUserId,
        returnTo: normalizedReturnTo,
        createdAt: new Date().toISOString()
      };

      const stored = await this.redis.setIfAbsent(
        IdentityFlowService.handoffKey(ticket),
        payload,
        this.identityConfig.handoffTtlSeconds
      );

      if (stored) {
        return {
          ticket,
          returnTo: normalizedReturnTo
        };
      }
    }

    throw IdentityFlowService.createError(
      'IDENTITY_RANDOM_COLLISION',
      '无法创建唯一Identity Handoff'
    );
  }

  /**
   * 原子消费Handoff。
   */
  async consumeHandoff(ticket) {
    this.assertAvailable();

    if (!IdentityFlowService.isCanonicalRandomToken(ticket)) {
      throw IdentityFlowService.createError(
        'IDENTITY_HANDOFF_INVALID',
        'Identity Handoff无效'
      );
    }

    const payload = await this.redis.getDel(
      IdentityFlowService.handoffKey(ticket)
    );

    if (!payload) {
      throw IdentityFlowService.createError(
        'IDENTITY_HANDOFF_EXPIRED',
        'Identity Handoff不存在、已过期或已经使用'
      );
    }

    if (!payload ||
        payload.version !== 1) {
      throw IdentityFlowService.createError(
        'IDENTITY_HANDOFF_CORRUPT',
        'Identity Handoff内容异常'
      );
    }

    payload.userId =
      IdentityFlowService.normalizeLocalUserId(payload.userId);

    payload.returnTo =
      IdentityFlowService.normalizeReturnTo(payload.returnTo);

    return payload;
  }

  static validateStoredFlow(flow) {
    if (!flow ||
        flow.version !== 1 ||
        ![FLOW_PURPOSE_LOGIN, FLOW_PURPOSE_BIND, FLOW_PURPOSE_UNLINK]
          .includes(flow.purpose) ||
        !IdentityFlowService.isCanonicalRandomToken(flow.nonce) ||
        !IdentityFlowService.isCanonicalRandomToken(flow.codeVerifier)) {
      throw IdentityFlowService.createError(
        'IDENTITY_FLOW_CORRUPT',
        'Identity Flow内容异常'
      );
    }

    flow.returnTo =
      IdentityFlowService.normalizeReturnTo(flow.returnTo);

    if (flow.purpose === FLOW_PURPOSE_BIND ||
        flow.purpose === FLOW_PURPOSE_UNLINK) {
      flow.localUserId =
        IdentityFlowService.normalizeLocalUserId(flow.localUserId);
    } else if (
      flow.localUserId !== null &&
      flow.localUserId !== undefined
    ) {
      throw IdentityFlowService.createError(
        'IDENTITY_FLOW_CORRUPT',
        '登录Flow不应包含本地用户'
      );
    }
  }

  /**
   * return_to只允许本平台相对路径。
   */
  static normalizeReturnTo(value) {
    if (value === null ||
        value === undefined ||
        value === '') {
      return '/dashboard';
    }

    if (typeof value !== 'string') {
      throw IdentityFlowService.createError(
        'IDENTITY_RETURN_TO_INVALID',
        'return_to格式无效'
      );
    }

    const byteLength = Buffer.byteLength(value, 'utf8');

    if (byteLength < 1 ||
        byteLength > MAX_RETURN_TO_BYTES ||
        !value.startsWith('/') ||
        value.startsWith('//') ||
        value.includes('\\')) {
      throw IdentityFlowService.createError(
        'IDENTITY_RETURN_TO_INVALID',
        'return_to必须是本平台相对路径'
      );
    }

    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);

      if (code < 0x20 || code === 0x7F) {
        throw IdentityFlowService.createError(
          'IDENTITY_RETURN_TO_INVALID',
          'return_to包含控制字符'
        );
      }
    }

    return value;
  }

  /**
   * Identity local_account_id固定映射为String(users.id)。
   */
  static normalizeLocalUserId(value) {
    const normalized = String(value ?? '');

    if (!/^[1-9][0-9]*$/.test(normalized)) {
      throw IdentityFlowService.createError(
        'IDENTITY_LOCAL_USER_INVALID',
        '本地用户ID无效'
      );
    }

    const numericValue = Number(normalized);

    if (!Number.isSafeInteger(numericValue) ||
        numericValue <= 0) {
      throw IdentityFlowService.createError(
        'IDENTITY_LOCAL_USER_INVALID',
        '本地用户ID超出安全范围'
      );
    }

    return normalized;
  }

  static createPKCEChallenge(codeVerifier) {
    return crypto
      .createHash('sha256')
      .update(codeVerifier, 'ascii')
      .digest('base64url');
  }

  static randomToken(byteLength) {
    return crypto
      .randomBytes(byteLength)
      .toString('base64url');
  }

  static isCanonicalRandomToken(value) {
    return (
      typeof value === 'string' &&
      value.length === 43 &&
      /^[A-Za-z0-9_-]{43}$/.test(value)
    );
  }

  static flowKey(state) {
    return FLOW_KEY_PREFIX +
      IdentityFlowService.hashOpaqueValue(state);
  }

  static handoffKey(ticket) {
    return HANDOFF_KEY_PREFIX +
      IdentityFlowService.hashOpaqueValue(ticket);
  }

  static hashOpaqueValue(value) {
    return crypto
      .createHash('sha256')
      .update(value, 'ascii')
      .digest('hex');
  }

  static createError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }
}

const identityFlowService = new IdentityFlowService();

module.exports = identityFlowService;
module.exports.IdentityFlowService = IdentityFlowService;
module.exports.FLOW_PURPOSE_LOGIN = FLOW_PURPOSE_LOGIN;
module.exports.FLOW_PURPOSE_BIND = FLOW_PURPOSE_BIND;
module.exports.FLOW_PURPOSE_UNLINK = FLOW_PURPOSE_UNLINK;

/**
 * SSO单点登录服务（多平台版）
 *
 * ============================================================
 * 支持「多平台分别跳转到不同用户组」
 * ============================================================
 *
 * 配置结构（存于 system_settings 表 setting_key='sso_config' 的 JSON）：
 *   {
 *     enabled: true,
 *     // —— 全局默认配置（向后兼容老对接方，请求不带 platform_key 时使用）——
 *     shared_secret, target_group_id, default_credits,
 *     signature_valid_minutes, ip_whitelist_enabled, allowed_ips,
 *     // —— 多平台列表 ——
 *     platforms: [
 *       { platform_key, name, secret, target_group_id, default_credits,
 *         algorithm, enabled, ip_whitelist_enabled, allowed_ips }
 *     ]
 *   }
 *
 * 请求路由规则：
 *   1) 请求体带 platform_key  → 命中 platforms 中对应平台 → 用该平台 secret 验签 → 落该平台的组
 *   2) 请求体不带 platform_key → 回退全局 shared_secret 验签 → 落全局 target_group_id（老逻辑，完全兼容）
 *
 * IP 白名单语义：
 *   - 全局模式：受全局 ip_whitelist_enabled / allowed_ips 控制。
 *   - 平台模式：只受「该平台自己」的 ip_whitelist_enabled / allowed_ips 控制，平台关闭即不限制 IP，不回退全局。
 *
 * 安全机制（三层保护）：
 *   1. 时间戳防重放 - 请求在 signature_valid_minutes 分钟内有效
 *   2. 签名验证      - hash(uuid + timestamp + secret)，算法见各平台 algorithm 字段
 *   3. IP白名单（可选）- 按上述语义控制
 *
 * 签名与字段可信性说明：
 *   - 签名主体：优先 uuid，兼容历史 username（取 uuid || username）
 *   - 签名只覆盖 uuid + timestamp + secret。
 *   - 注意：name 字段【不在签名内】，属于不可信输入，仅用于展示/备注，
 *     不可作为任何鉴权或业务判断依据。调用方可任意篡改 name，
 *     故对其长度做截断处理（见控制器层），且不参与任何安全决策。
 *
 * 错误约定：
 *   本服务抛出的 Error 会附带 statusCode 属性，供控制器映射 HTTP 状态码：
 *     - 400：缺少必要参数
 *     - 403：签名失败 / IP 未授权 / 平台未知 / 平台禁用 / 账户被禁用/过期 等鉴权类
 *     - 500：服务端配置缺失（未配置密钥等，属服务端问题）
 *   未显式标记 statusCode 的错误由控制器按 500 处理。
 */

const crypto = require('crypto');
const User = require('../../models/User');
const SystemConfig = require('../../models/SystemConfig');
const logger = require('../../utils/logger');

/**
 * 构造带 HTTP 状态码标记的错误
 * @param {string} message - 错误信息
 * @param {number} statusCode - 期望的 HTTP 状态码
 * @returns {Error}
 */
function makeError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

class SSOService {
  /**
   * 计算签名：hash(subject + timestamp + secret)
   * @param {string} subject - 签名主体（uuid 或 username）
   * @param {string|number} timestamp - 时间戳
   * @param {string} secret - 密钥
   * @param {string} algorithm - 'md5'（默认）或 'sha256'
   * @returns {string} 十六进制签名
   */
  static _computeSignature(subject, timestamp, secret, algorithm = 'md5') {
    // 仅允许白名单内算法，非法值退回 md5，避免传入不受支持算法导致崩溃
    const algo = algorithm === 'sha256' ? 'sha256' : 'md5';
    return crypto
      .createHash(algo)
      .update(`${subject}${timestamp}${secret}`)
      .digest('hex');
  }

  /**
   * 校验 IP 白名单
   * @param {boolean} whitelistEnabled - 是否启用白名单
   * @param {string} allowedIps - 逗号分隔的允许 IP 列表
   * @param {string} clientIp - 客户端 IP
   * @param {Object} logContext - 日志上下文
   * @throws {Error} IP 不在白名单时抛出（statusCode=403）
   */
  static _checkIpWhitelist(whitelistEnabled, allowedIps, clientIp, logContext = {}) {
    if (!whitelistEnabled || !allowedIps) {
      return;
    }
    const ipList = allowedIps.split(',').map(ip => ip.trim()).filter(Boolean);
    if (ipList.length > 0 && !ipList.includes(clientIp)) {
      logger.warn('SSO登录失败：IP不在白名单', { ...logContext, clientIp, allowedIps });
      throw makeError('您的IP地址未授权访问SSO', 403);
    }
  }

  /**
   * 校验时间戳（防重放）
   * @param {string|number} timestamp - 请求时间戳（秒）
   * @param {number} validMinutes - 有效期（分钟）
   * @param {Object} logContext - 日志上下文
   * @throws {Error} 请求过期时抛出（statusCode=403）
   */
  static _checkTimestamp(timestamp, validMinutes, logContext = {}) {
    const requestTime = parseInt(timestamp);
    const currentTime = Math.floor(Date.now() / 1000);
    const validSeconds = (validMinutes || 5) * 60;

    if (isNaN(requestTime) || Math.abs(currentTime - requestTime) > validSeconds) {
      logger.warn('SSO登录失败：请求已过期', {
        ...logContext,
        requestTime,
        currentTime,
        diff: isNaN(requestTime) ? 'NaN' : Math.abs(currentTime - requestTime)
      });
      throw makeError('SSO请求已过期，请重新发起', 403);
    }
  }

  /**
   * 在平台列表中查找指定 platform_key 的平台配置
   * @param {Object} ssoConfig - SSO 配置对象
   * @param {string} platformKey - 平台标识
   * @returns {Object|null} 平台配置对象，未找到返回 null
   */
  static _findPlatform(ssoConfig, platformKey) {
    if (!Array.isArray(ssoConfig.platforms) || !platformKey) {
      return null;
    }
    return ssoConfig.platforms.find(p => p && p.platform_key === platformKey) || null;
  }

  /**
   * 验证SSO请求
   * @param {Object} params - { uuid, username, timestamp, signature, platform_key }
   * @param {string} clientIp - 客户端IP地址
   * @returns {Object} 路由上下文：{ target_group_id, default_credits, platform_key, platform_name }
   * @throws {Error} 验证失败时抛出（携带 statusCode）
   */
  static async validateSSORequest(params, clientIp) {
    const { uuid, username, timestamp, signature, platform_key } = params;

    // 签名主体：优先 uuid，兼容历史 username
    const subject = uuid || username;

    // 验证必填参数
    if (!subject || !timestamp || !signature) {
      throw makeError('缺少必要的SSO参数', 400);
    }

    // 获取SSO配置
    const ssoConfig = await SystemConfig.getSetting('sso_config');
    if (!ssoConfig || !ssoConfig.enabled) {
      throw makeError('SSO功能未启用', 403);
    }

    const validMinutes = ssoConfig.signature_valid_minutes || 5;

    // ============================================================
    // 路径一：多平台模式（请求携带 platform_key）
    // ============================================================
    if (platform_key) {
      const platform = SSOService._findPlatform(ssoConfig, platform_key);

      if (!platform) {
        logger.warn('SSO登录失败：未找到匹配的平台配置', { platform_key, subject, clientIp });
        throw makeError('未知的SSO平台标识', 403);
      }

      // 平台级启用开关（未显式设置 false 即视为启用）
      if (platform.enabled === false) {
        logger.warn('SSO登录失败：该平台已被禁用', { platform_key, subject });
        throw makeError('该SSO平台已被禁用', 403);
      }

      // 平台密钥校验（缺失属服务端配置问题）
      if (!platform.secret) {
        logger.error('SSO登录失败：平台未配置密钥', { platform_key });
        throw makeError('SSO平台配置错误', 500);
      }

      const logContext = { platform_key, subject };

      // IP 白名单：只看平台自己的开关，不回退全局
      SSOService._checkIpWhitelist(
        platform.ip_whitelist_enabled,
        platform.allowed_ips,
        clientIp,
        logContext
      );

      // 时间戳防重放
      SSOService._checkTimestamp(timestamp, validMinutes, logContext);

      // 签名验证（平台密钥 + 平台算法）
      const expectedSignature = SSOService._computeSignature(
        subject,
        timestamp,
        platform.secret,
        platform.algorithm
      );

      if (signature !== expectedSignature) {
        // 安全：日志不记录期望签名，防泄露导致签名被伪造
        logger.warn('SSO登录失败：平台签名验证失败', {
          platform_key,
          subject,
          clientIp,
          receivedSignature: signature
        });
        throw makeError('SSO签名验证失败', 403);
      }

      // 返回平台级路由上下文
      return {
        target_group_id: platform.target_group_id || ssoConfig.target_group_id || 1,
        default_credits:
          platform.default_credits !== undefined
            ? platform.default_credits
            : (ssoConfig.default_credits || 100),
        platform_key: platform.platform_key,
        platform_name: platform.name || platform.platform_key
      };
    }

    // ============================================================
    // 路径二：全局模式（不带 platform_key，老对接方完全兼容）
    // ============================================================
    const sharedSecret = ssoConfig.shared_secret;
    if (!sharedSecret) {
      logger.error('SSO登录失败：未配置全局共享密钥');
      throw makeError('SSO配置错误', 500);
    }

    const logContext = { subject, mode: 'global' };

    // IP 白名单（全局模式：受全局开关控制）
    SSOService._checkIpWhitelist(
      ssoConfig.ip_whitelist_enabled,
      ssoConfig.allowed_ips,
      clientIp,
      logContext
    );

    // 时间戳防重放
    SSOService._checkTimestamp(timestamp, validMinutes, logContext);

    // 签名验证（全局密钥，固定 MD5——保持与历史对接方一致）
    const expectedSignature = SSOService._computeSignature(
      subject,
      timestamp,
      sharedSecret,
      'md5'
    );

    if (signature !== expectedSignature) {
      logger.warn('SSO登录失败：签名验证失败', {
        subject,
        clientIp,
        receivedSignature: signature
      });
      throw makeError('SSO签名验证失败', 403);
    }

    // 返回全局路由上下文
    return {
      target_group_id: ssoConfig.target_group_id || 1,
      default_credits: ssoConfig.default_credits || 100,
      platform_key: null,
      platform_name: null
    };
  }

  /**
   * 处理SSO用户创建或更新
   *
   * 重要：已存在用户（按 uuid 匹配）不修改其组归属。
   *   首次从哪个平台进来落到哪个组，后续从其他平台进来仍保持原组，
   *   避免密钥泄露导致用户被反复搬组，也不覆盖管理员的手动调整。
   *
   * @param {Object} params - { uuid, name }（name 为不可信展示字段，已在控制器层截断）
   * @param {Object} ssoContext - validateSSORequest 返回的路由上下文
   * @returns {Object} 用户实例
   * @throws {Error} 用户状态异常或账号过期时抛出（statusCode=403）
   */
  static async handleSSOUser(params, ssoContext) {
    const { uuid, name } = params;

    // 查找或创建用户（仅新建时使用 target_group_id / default_credits）
    const user = await User.createOrUpdateSSOUser({
      uuid,
      name,
      group_id: ssoContext.target_group_id || 1,
      default_credits:
        ssoContext.default_credits !== undefined ? ssoContext.default_credits : 100,
      credits_expire_days: 365
    });

    // 检查用户状态
    if (user.status !== 'active') {
      logger.warn('SSO登录失败：用户状态异常', {
        uuid,
        userId: user.id,
        status: user.status,
        platform_key: ssoContext.platform_key
      });
      throw makeError('账户已被禁用', 403);
    }

    // 检查账号有效期
    if (user.isAccountExpired()) {
      const remainingDays = user.getAccountRemainingDays();
      logger.warn('SSO登录失败：账号已过期', {
        uuid,
        userId: user.id,
        expireAt: user.expire_at,
        expiredDays: Math.abs(remainingDays),
        platform_key: ssoContext.platform_key
      });

      let expireMessage = '账号已过期';
      if (remainingDays !== null) {
        expireMessage = `账号已过期${Math.abs(remainingDays)}天，请联系管理员续期`;
      }

      throw makeError(expireMessage, 403);
    }

    logger.info('SSO用户处理成功', {
      uuid,
      userId: user.id,
      groupId: user.group_id,
      platform_key: ssoContext.platform_key,
      platform_name: ssoContext.platform_name
    });

    return user;
  }
}

module.exports = SSOService;

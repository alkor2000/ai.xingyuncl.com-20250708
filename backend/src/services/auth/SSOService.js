/**
 * SSO单点登录服务（多平台版）
 *
 * ============================================================
 * 本次升级：支持「多平台分别跳转到不同用户组」
 * ============================================================
 *
 * 设计目标：
 *   不同外部平台（如平台A、平台B）各自携带独立的平台标识与独立密钥跳转过来，
 *   系统据此把用户落到各平台指定的用户组，互不干扰。
 *
 * 配置结构（存于 system_settings 表 setting_key='sso_config' 的 JSON 中）：
 *   {
 *     enabled: true,                       // SSO 总开关
 *     // —— 全局默认配置（向后兼容老对接方，请求不带 platform_key 时使用）——
 *     shared_secret: 'xxx',                // 全局共享密钥
 *     target_group_id: 1,                  // 全局默认目标组
 *     default_credits: 100,                // 全局默认积分
 *     signature_valid_minutes: 5,          // 签名有效期（分钟）
 *     ip_whitelist_enabled: false,         // 全局 IP 白名单开关
 *     allowed_ips: '1.2.3.4,5.6.7.8',      // 全局 IP 白名单
 *     // —— 多平台列表（新增，可选）——
 *     platforms: [
 *       {
 *         platform_key: 'school_a',        // 平台唯一标识（请求中携带，用于匹配）
 *         name: '学校A',                    // 平台名称（仅后台展示用）
 *         secret: 'yyy',                   // 该平台独立密钥（用于验签）
 *         target_group_id: 5,              // 该平台用户落入的目标组
 *         default_credits: 200,            // 该平台新建用户的默认积分
 *         algorithm: 'md5',                // 签名算法：'md5'（默认/兼容）或 'sha256'
 *         enabled: true,                   // 该平台启用开关
 *         ip_whitelist_enabled: false,     // 该平台独立 IP 白名单开关（可选）
 *         allowed_ips: ''                  // 该平台独立 IP 白名单（可选）
 *       }
 *     ]
 *   }
 *
 * 请求路由规则：
 *   1) 请求体带 platform_key  → 命中 platforms 中对应平台 → 用该平台 secret 验签 → 落该平台的组
 *   2) 请求体不带 platform_key → 回退全局 shared_secret 验签 → 落全局 target_group_id（老逻辑，完全兼容）
 *
 * 安全机制（三层保护，全局与平台均适用）：
 *   1. 时间戳防重放 - 请求在 signature_valid_minutes 分钟内有效
 *   2. 签名验证      - hash(uuid + timestamp + secret)，算法见各平台 algorithm 字段
 *   3. IP白名单（可选）- 限制来源 IP（平台可单独配置，未配置则回退全局）
 *
 * 签名算法说明：
 *   - 老对接方使用 MD5（保持兼容，不强制升级）
 *   - 新平台建议在平台配置中将 algorithm 设为 'sha256'
 *   - 签名字段：以 uuid 为主，兼容历史上传 username 的对接方（取 uuid || username 作为签名主体）
 */

const crypto = require('crypto');
const User = require('../../models/User');
const SystemConfig = require('../../models/SystemConfig');
const logger = require('../../utils/logger');

class SSOService {
  /**
   * 计算签名
   *
   * 统一签名规则：hash(subject + timestamp + secret)
   * - subject：签名主体，优先 uuid，兼容历史 username
   * - algorithm：'md5'（默认）或 'sha256'
   *
   * @param {string} subject - 签名主体（uuid 或 username）
   * @param {string|number} timestamp - 时间戳
   * @param {string} secret - 密钥
   * @param {string} algorithm - 签名算法，默认 md5
   * @returns {string} 十六进制签名字符串
   */
  static _computeSignature(subject, timestamp, secret, algorithm = 'md5') {
    // 仅允许白名单内的算法，非法值一律退回 md5，避免传入不受支持的算法名导致崩溃
    const algo = algorithm === 'sha256' ? 'sha256' : 'md5';
    return crypto
      .createHash(algo)
      .update(`${subject}${timestamp}${secret}`)
      .digest('hex');
  }

  /**
   * 校验 IP 白名单
   *
   * @param {boolean} whitelistEnabled - 是否启用白名单
   * @param {string} allowedIps - 逗号分隔的允许 IP 列表
   * @param {string} clientIp - 客户端 IP
   * @param {Object} logContext - 日志上下文（uuid、platform_key 等）
   * @throws {Error} IP 不在白名单时抛出
   */
  static _checkIpWhitelist(whitelistEnabled, allowedIps, clientIp, logContext = {}) {
    if (!whitelistEnabled || !allowedIps) {
      return;
    }
    const ipList = allowedIps.split(',').map(ip => ip.trim()).filter(Boolean);
    if (ipList.length > 0 && !ipList.includes(clientIp)) {
      logger.warn('SSO登录失败：IP不在白名单', { ...logContext, clientIp });
      throw new Error('您的IP地址未授权访问SSO');
    }
  }

  /**
   * 校验时间戳（防重放）
   *
   * @param {string|number} timestamp - 请求时间戳（秒）
   * @param {number} validMinutes - 有效期（分钟）
   * @param {Object} logContext - 日志上下文
   * @throws {Error} 请求过期时抛出
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
      throw new Error('SSO请求已过期，请重新发起');
    }
  }

  /**
   * 在平台列表中查找指定 platform_key 的平台配置
   *
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
   *
   * 根据是否携带 platform_key 走两条路径：
   *   - 多平台路径：按 platform_key 匹配平台配置，用平台密钥验签，返回平台级路由信息
   *   - 全局路径（兼容）：用全局共享密钥验签，返回全局路由信息
   *
   * @param {Object} params - { uuid, username, timestamp, signature, platform_key }
   * @param {string} clientIp - 客户端IP地址
   * @returns {Object} 解析后的 SSO 上下文：
   *                   { target_group_id, default_credits, platform_key, platform_name }
   * @throws {Error} 验证失败时抛出具体错误信息
   */
  static async validateSSORequest(params, clientIp) {
    const { uuid, username, timestamp, signature, platform_key } = params;

    // 签名主体：优先 uuid，兼容历史 username
    const subject = uuid || username;

    // 验证必填参数
    if (!subject || !timestamp || !signature) {
      throw new Error('缺少必要的SSO参数');
    }

    // 获取SSO配置
    const ssoConfig = await SystemConfig.getSetting('sso_config');
    if (!ssoConfig || !ssoConfig.enabled) {
      throw new Error('SSO功能未启用');
    }

    const validMinutes = ssoConfig.signature_valid_minutes || 5;

    // ============================================================
    // 路径一：多平台模式（请求携带 platform_key）
    // ============================================================
    if (platform_key) {
      const platform = SSOService._findPlatform(ssoConfig, platform_key);

      if (!platform) {
        logger.warn('SSO登录失败：未找到匹配的平台配置', { platform_key, subject, clientIp });
        throw new Error('未知的SSO平台标识');
      }

      // 平台级启用开关（未显式设置 false 即视为启用）
      if (platform.enabled === false) {
        logger.warn('SSO登录失败：该平台已被禁用', { platform_key, subject });
        throw new Error('该SSO平台已被禁用');
      }

      // 平台密钥校验
      if (!platform.secret) {
        logger.error('SSO登录失败：平台未配置密钥', { platform_key });
        throw new Error('SSO平台配置错误');
      }

      const logContext = { platform_key, subject };

      // IP 白名单：平台单独开启则用平台的，否则回退全局
      if (platform.ip_whitelist_enabled) {
        SSOService._checkIpWhitelist(true, platform.allowed_ips, clientIp, logContext);
      } else {
        SSOService._checkIpWhitelist(
          ssoConfig.ip_whitelist_enabled,
          ssoConfig.allowed_ips,
          clientIp,
          logContext
        );
      }

      // 时间戳防重放
      SSOService._checkTimestamp(timestamp, validMinutes, logContext);

      // 签名验证（使用平台密钥 + 平台算法）
      const expectedSignature = SSOService._computeSignature(
        subject,
        timestamp,
        platform.secret,
        platform.algorithm
      );

      if (signature !== expectedSignature) {
        // 安全：日志中不记录期望签名，防止日志泄露导致签名被伪造
        logger.warn('SSO登录失败：平台签名验证失败', {
          platform_key,
          subject,
          clientIp,
          receivedSignature: signature
        });
        throw new Error('SSO签名验证失败');
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
      throw new Error('SSO配置错误');
    }

    const logContext = { subject, mode: 'global' };

    // IP 白名单（全局）
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
      // 安全：日志中不记录期望签名
      logger.warn('SSO登录失败：签名验证失败', {
        subject,
        clientIp,
        receivedSignature: signature
      });
      throw new Error('SSO签名验证失败');
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
   *   即首次从哪个平台进来落到哪个组，后续从其他平台进来仍保持原组。
   *   这样可避免密钥泄露导致用户被反复搬组，也不会覆盖管理员的手动调整。
   *
   * @param {Object} params - { uuid, name }
   * @param {Object} ssoContext - validateSSORequest 返回的路由上下文
   *                              { target_group_id, default_credits, platform_key, platform_name }
   * @returns {Object} 用户实例
   * @throws {Error} 用户状态异常或账号过期时抛出错误
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
      throw new Error('账户已被禁用');
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

      throw new Error(expireMessage);
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

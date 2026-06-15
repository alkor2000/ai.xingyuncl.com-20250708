/**
 * SSO配置读写与校验服务
 *
 * ============================================================
 * 职责：把 sso_config 的「读取（含掩码）/ 校验 / 保存」逻辑集中在此，
 *       供 SystemStatsController 的 SSO 配置端点调用，避免控制器臃肿。
 * ============================================================
 *
 * 配置结构（存于 system_settings 表 setting_key='sso_config' 的 JSON）：
 *   {
 *     enabled, shared_secret, target_group_id, default_credits,
 *     signature_valid_minutes, ip_whitelist_enabled, allowed_ips,
 *     platforms: [
 *       { platform_key, name, secret, target_group_id, default_credits,
 *         algorithm, enabled, ip_whitelist_enabled, allowed_ips }
 *     ]
 *   }
 *
 * 掩码说明：
 *   - 读取配置返回前端时，全局 shared_secret 和每个平台的 secret 都做掩码（头4尾4，中间星号）
 *   - 保存时若前端回传的密钥仍是掩码（含 *），说明用户未修改，保留库中原值
 *   - 这样密钥永不明文下发到前端，也不会因为前端回填掩码而把真实密钥覆盖坏
 */

const SystemConfig = require('../../models/SystemConfig');
const logger = require('../../utils/logger');

// SSO 配置的存储键名
const SSO_CONFIG_KEY = 'sso_config';

// 默认配置（首次未配置时返回）
const DEFAULT_SSO_CONFIG = {
  enabled: false,
  shared_secret: '',
  target_group_id: 1,
  default_credits: 100,
  signature_valid_minutes: 5,
  ip_whitelist_enabled: false,
  allowed_ips: '',
  platforms: []
};

class SSOConfigService {
  /**
   * 判断字符串是否为掩码（包含星号）
   * @param {string} value
   * @returns {boolean}
   */
  static _isMasked(value) {
    return typeof value === 'string' && value.includes('*');
  }

  /**
   * 对密钥做掩码：头4尾4，中间用星号填充
   * 长度不足9位时全部星号，避免泄露过多信息
   * @param {string} secret
   * @returns {string}
   */
  static _maskSecret(secret) {
    if (!secret || typeof secret !== 'string') {
      return '';
    }
    if (secret.length > 8) {
      return (
        secret.substring(0, 4) +
        '*'.repeat(secret.length - 8) +
        secret.substring(secret.length - 4)
      );
    }
    return '*'.repeat(secret.length);
  }

  /**
   * 解析整数并校验范围
   * @param {*} value - 待解析值
   * @param {Object} opts - { min, max }
   * @returns {number|null} 解析成功返回整数，失败或越界返回 null
   */
  static _parseIntInRange(value, { min = -Infinity, max = Infinity } = {}) {
    const num = parseInt(value);
    if (isNaN(num) || num < min || num > max) {
      return null;
    }
    return num;
  }

  /**
   * 读取 SSO 配置（用于后台展示，密钥已掩码）
   *
   * @returns {Object} 掩码后的配置对象（含 platforms 数组，每个平台 secret 已掩码）
   */
  static async getConfigMasked() {
    const raw = await SystemConfig.getSetting(SSO_CONFIG_KEY);
    // 深拷贝默认配置兜底，避免污染常量
    const config = raw ? { ...DEFAULT_SSO_CONFIG, ...raw } : { ...DEFAULT_SSO_CONFIG };

    // 掩码全局密钥
    config.shared_secret = SSOConfigService._maskSecret(config.shared_secret);

    // 掩码每个平台的密钥
    if (Array.isArray(config.platforms)) {
      config.platforms = config.platforms.map(p => ({
        platform_key: p.platform_key || '',
        name: p.name || '',
        secret: SSOConfigService._maskSecret(p.secret),
        target_group_id: p.target_group_id,
        default_credits: p.default_credits,
        algorithm: p.algorithm === 'sha256' ? 'sha256' : 'md5',
        enabled: p.enabled !== false,
        ip_whitelist_enabled: p.ip_whitelist_enabled === true,
        allowed_ips: p.allowed_ips || ''
      }));
    } else {
      config.platforms = [];
    }

    return config;
  }

  /**
   * 校验并规整前端提交的平台列表
   *
   * 规则：
   *   - platform_key 必填、唯一、仅允许字母数字下划线连字符
   *   - secret 启用时必填；若为掩码则保留库中原值
   *   - target_group_id 为正整数
   *   - default_credits 为 >=0 整数
   *   - algorithm 仅 md5 / sha256
   *
   * @param {Array} platforms - 前端提交的平台数组
   * @param {Array} currentPlatforms - 库中现有平台数组（用于掩码密钥回填）
   * @returns {{ platforms: Array }} 规整后的平台数组
   * @throws {Error} 校验失败时抛出（携带中文提示）
   */
  static _validateAndNormalizePlatforms(platforms, currentPlatforms = []) {
    if (platforms === undefined || platforms === null) {
      return { platforms: [] };
    }
    if (!Array.isArray(platforms)) {
      throw new Error('平台列表格式无效');
    }

    // 库中现有平台：按 platform_key 建索引，便于回填掩码密钥
    const currentMap = {};
    if (Array.isArray(currentPlatforms)) {
      currentPlatforms.forEach(p => {
        if (p && p.platform_key) {
          currentMap[p.platform_key] = p;
        }
      });
    }

    const seenKeys = new Set();
    const keyPattern = /^[a-zA-Z0-9_-]{1,64}$/;

    const normalized = platforms.map((p, index) => {
      const rowNo = index + 1;

      // platform_key 校验
      const platformKey = (p.platform_key || '').trim();
      if (!platformKey) {
        throw new Error(`第${rowNo}个平台：平台标识(platform_key)不能为空`);
      }
      if (!keyPattern.test(platformKey)) {
        throw new Error(`第${rowNo}个平台：平台标识只能包含字母、数字、下划线和连字符，长度1-64`);
      }
      if (seenKeys.has(platformKey)) {
        throw new Error(`平台标识重复：${platformKey}`);
      }
      seenKeys.add(platformKey);

      // 启用开关（默认启用）
      const enabled = p.enabled !== false;

      // 密钥：掩码则回填库中原值，否则用新值
      let secret = p.secret || '';
      if (SSOConfigService._isMasked(secret)) {
        const existing = currentMap[platformKey];
        secret = existing ? existing.secret : '';
      }
      if (enabled && !secret) {
        throw new Error(`第${rowNo}个平台(${platformKey})：启用时必须设置密钥`);
      }

      // 目标组
      const targetGroupId = SSOConfigService._parseIntInRange(p.target_group_id, { min: 1 });
      if (targetGroupId === null) {
        throw new Error(`第${rowNo}个平台(${platformKey})：目标组ID无效`);
      }

      // 默认积分
      const defaultCredits = SSOConfigService._parseIntInRange(p.default_credits, { min: 0 });
      if (defaultCredits === null) {
        throw new Error(`第${rowNo}个平台(${platformKey})：默认积分必须是大于等于0的整数`);
      }

      // 算法
      const algorithm = p.algorithm === 'sha256' ? 'sha256' : 'md5';

      return {
        platform_key: platformKey,
        name: (p.name || '').trim() || platformKey,
        secret,
        target_group_id: targetGroupId,
        default_credits: defaultCredits,
        algorithm,
        enabled,
        ip_whitelist_enabled: p.ip_whitelist_enabled === true,
        allowed_ips: (p.allowed_ips || '').trim()
      };
    });

    return { platforms: normalized };
  }

  /**
   * 校验并保存 SSO 配置
   *
   * @param {Object} body - 前端提交的配置体
   * @param {number} operatorId - 操作者用户ID（写入审计字段）
   * @returns {Object} 保存后的配置（密钥已掩码，可直接返回前端）
   * @throws {Error} 校验失败时抛出（携带中文提示）
   */
  static async saveConfig(body, operatorId) {
    const {
      enabled,
      shared_secret,
      target_group_id,
      default_credits,
      signature_valid_minutes,
      ip_whitelist_enabled,
      allowed_ips,
      platforms
    } = body;

    // —— 基础校验 ——
    if (typeof enabled !== 'boolean') {
      throw new Error('enabled必须是布尔值');
    }

    const groupId = SSOConfigService._parseIntInRange(target_group_id, { min: 1 });
    if (groupId === null) {
      throw new Error('全局目标组ID无效');
    }

    const credits = SSOConfigService._parseIntInRange(default_credits, { min: 0 });
    if (credits === null) {
      throw new Error('全局默认积分必须是大于等于0的整数');
    }

    const validMinutes = SSOConfigService._parseIntInRange(signature_valid_minutes, { min: 1, max: 60 });
    if (validMinutes === null) {
      throw new Error('签名有效期必须在1-60分钟之间');
    }

    // 读取库中现有配置（用于密钥掩码回填）
    const currentConfig = (await SystemConfig.getSetting(SSO_CONFIG_KEY)) || {};

    // —— 全局密钥：掩码则保留原值 ——
    let finalSharedSecret = shared_secret || '';
    if (SSOConfigService._isMasked(finalSharedSecret)) {
      finalSharedSecret = currentConfig.shared_secret || '';
    }

    // —— 平台列表校验与规整 ——
    const { platforms: normalizedPlatforms } = SSOConfigService._validateAndNormalizePlatforms(
      platforms,
      currentConfig.platforms || []
    );

    // —— 启用 SSO 时的整体合法性：全局密钥与平台列表至少有一处可用 ——
    if (enabled) {
      const hasGlobalSecret = !!finalSharedSecret;
      const hasEnabledPlatform = normalizedPlatforms.some(p => p.enabled && p.secret);
      if (!hasGlobalSecret && !hasEnabledPlatform) {
        throw new Error('启用SSO时，必须设置全局共享密钥，或至少配置一个启用的平台');
      }
    }

    // —— 构建最终配置对象 ——
    const finalConfig = {
      enabled,
      shared_secret: finalSharedSecret,
      target_group_id: groupId,
      default_credits: credits,
      signature_valid_minutes: validMinutes,
      ip_whitelist_enabled: ip_whitelist_enabled === true,
      allowed_ips: allowed_ips || '',
      platforms: normalizedPlatforms,
      updated_at: new Date().toISOString(),
      updated_by: operatorId
    };

    // —— 持久化 ——
    await SystemConfig.updateSetting(SSO_CONFIG_KEY, finalConfig, 'json');

    logger.info('SSO配置已保存', {
      operatorId,
      enabled,
      globalTargetGroup: groupId,
      platformCount: normalizedPlatforms.length,
      platformKeys: normalizedPlatforms.map(p => p.platform_key)
    });

    // —— 返回掩码后的配置（不下发明文密钥）——
    finalConfig.shared_secret = SSOConfigService._maskSecret(finalConfig.shared_secret);
    finalConfig.platforms = finalConfig.platforms.map(p => ({
      ...p,
      secret: SSOConfigService._maskSecret(p.secret)
    }));

    return finalConfig;
  }
}

module.exports = SSOConfigService;

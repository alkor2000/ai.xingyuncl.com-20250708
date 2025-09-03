/**
 * SSO单点登录服务
 */

const crypto = require('crypto');
const User = require('../../models/User');
const SystemConfig = require('../../models/SystemConfig');
const logger = require('../../utils/logger');

class SSOService {
  /**
   * 验证SSO请求
   */
  static async validateSSORequest(params, clientIp) {
    const { uuid, timestamp, signature } = params;
    
    // 验证必填参数
    if (!uuid || !timestamp || !signature) {
      throw new Error('缺少必要的SSO参数');
    }
    
    // 获取SSO配置
    const ssoConfig = await SystemConfig.getSetting('sso_config');
    if (!ssoConfig || !ssoConfig.enabled) {
      throw new Error('SSO功能未启用');
    }
    
    // 检查IP白名单
    if (ssoConfig.ip_whitelist_enabled && ssoConfig.allowed_ips) {
      const allowedIps = ssoConfig.allowed_ips.split(',').map(ip => ip.trim());
      if (!allowedIps.includes(clientIp)) {
        logger.warn('SSO登录失败：IP不在白名单', { uuid, clientIp, allowedIps });
        throw new Error('您的IP地址未授权访问SSO');
      }
    }
    
    // 验证时间戳（防止重放攻击）
    const requestTime = parseInt(timestamp);
    const currentTime = Math.floor(Date.now() / 1000);
    const validMinutes = ssoConfig.signature_valid_minutes || 5;
    
    if (Math.abs(currentTime - requestTime) > validMinutes * 60) {
      logger.warn('SSO登录失败：请求已过期', { 
        uuid, 
        requestTime, 
        currentTime, 
        diff: Math.abs(currentTime - requestTime) 
      });
      throw new Error('SSO请求已过期，请重新发起');
    }
    
    // 验证签名
    const sharedSecret = ssoConfig.shared_secret;
    if (!sharedSecret) {
      logger.error('SSO登录失败：未配置共享密钥');
      throw new Error('SSO配置错误');
    }
    
    // 计算预期签名：MD5(uuid + timestamp + shared_secret)
    const expectedSignature = crypto
      .createHash('md5')
      .update(`${uuid}${timestamp}${sharedSecret}`)
      .digest('hex');
    
    if (signature !== expectedSignature) {
      logger.warn('SSO登录失败：签名验证失败', { 
        uuid, 
        clientIp,
        receivedSignature: signature,
        expectedSignature 
      });
      throw new Error('SSO签名验证失败');
    }
    
    return ssoConfig;
  }
  
  /**
   * 处理SSO用户创建或更新
   */
  static async handleSSOUser(params, ssoConfig) {
    const { uuid, name } = params;
    
    // 查找或创建用户
    const user = await User.createOrUpdateSSOUser({
      uuid,
      name,
      group_id: ssoConfig.target_group_id || 1,
      default_credits: ssoConfig.default_credits || 100,
      credits_expire_days: 365
    });
    
    // 检查用户状态
    if (user.status !== 'active') {
      logger.warn('SSO登录失败：用户状态异常', { 
        uuid, 
        userId: user.id, 
        status: user.status 
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
        expiredDays: Math.abs(remainingDays)
      });
      
      let expireMessage = '账号已过期';
      if (remainingDays !== null) {
        expireMessage = `账号已过期${Math.abs(remainingDays)}天，请联系管理员续期`;
      }
      
      throw new Error(expireMessage);
    }
    
    return user;
  }
}

module.exports = SSOService;

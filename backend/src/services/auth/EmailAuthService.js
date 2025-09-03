/**
 * 邮箱认证服务
 */

const EmailService = require('../emailService');
const redisConnection = require('../../database/redis');
const logger = require('../../utils/logger');

class EmailAuthService {
  /**
   * 发送验证码
   */
  static async sendVerificationCode(email, user) {
    // 检查用户状态
    if (user.status !== 'active') {
      logger.warn('发送验证码失败：用户状态异常', { email, status: user.status });
      throw new Error('账户已被禁用');
    }
    
    // 检查60秒内是否已发送
    const sentKey = `email_sent:${email}`;
    if (redisConnection.isConnected) {
      const hasSent = await redisConnection.exists(sentKey);
      if (hasSent) {
        throw new Error('请等待60秒后再试');
      }
    } else {
      logger.error('Redis未连接，无法存储验证码');
      throw new Error('服务暂时不可用，请稍后再试');
    }
    
    // 生成验证码
    const code = EmailService.generateVerificationCode();
    
    // 存储验证码到Redis（5分钟有效）
    const codeKey = `email_code:${email}`;
    await redisConnection.set(codeKey, code, 300); // 5分钟
    await redisConnection.set(sentKey, '1', 60); // 60秒标记
    
    // 发送邮件
    try {
      await EmailService.sendVerificationCode(email, code);
      logger.info('验证码发送成功', { email });
      return true;
    } catch (emailError) {
      logger.error('发送邮件失败:', emailError);
      // 清除已存储的验证码
      await redisConnection.del(codeKey);
      await redisConnection.del(sentKey);
      throw new Error('邮件发送失败，请检查邮件服务配置');
    }
  }
  
  /**
   * 验证邮箱验证码
   */
  static async verifyCode(email, code) {
    // 验证验证码格式
    if (!/^\d{6}$/.test(code)) {
      throw new Error('验证码格式不正确');
    }
    
    if (!redisConnection.isConnected) {
      logger.error('Redis未连接，无法验证验证码');
      throw new Error('服务暂时不可用，请稍后再试');
    }
    
    const codeKey = `email_code:${email}`;
    const storedCode = await redisConnection.get(codeKey);
    
    logger.info("验证码比较", { 
      email, 
      inputCode: code, 
      storedCode: storedCode,
      isEqual: String(storedCode) === String(code)
    });
    
    if (!storedCode) {
      logger.warn('验证码不存在或已过期', { email });
      throw new Error('验证码已过期，请重新获取');
    }
    
    if (String(storedCode) !== String(code)) {
      logger.warn('验证码错误', { email });
      throw new Error('验证码错误');
    }
    
    // 删除已使用的验证码
    await redisConnection.del(codeKey);
    
    return true;
  }
}

module.exports = EmailAuthService;

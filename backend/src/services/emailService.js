/**
 * 邮件服务
 * 处理邮件发送功能
 */

const nodemailer = require('nodemailer');
const SystemConfig = require('../models/SystemConfig');
const logger = require('../utils/logger');

class EmailService {
  /**
   * 获取邮件发送器
   */
  static async getTransporter() {
    try {
      // 从数据库获取邮件配置
      const settings = await SystemConfig.getFormattedSettings();
      const emailConfig = settings.email || {};

      if (!emailConfig.smtp_host || !emailConfig.smtp_user || !emailConfig.smtp_pass) {
        throw new Error('邮件服务未配置');
      }

      // 创建发送器
      const transporter = nodemailer.createTransport({
        host: emailConfig.smtp_host,
        port: parseInt(emailConfig.smtp_port) || 465,
        secure: emailConfig.smtp_port === '465' || emailConfig.smtp_port === 465,
        auth: {
          user: emailConfig.smtp_user,
          pass: emailConfig.smtp_pass
        }
      });

      // 验证配置
      await transporter.verify();
      
      return transporter;
    } catch (error) {
      logger.error('创建邮件发送器失败:', error);
      throw error;
    }
  }

  /**
   * 发送验证码邮件
   */
  static async sendVerificationCode(email, code) {
    try {
      const settings = await SystemConfig.getFormattedSettings();
      const emailConfig = settings.email || {};
      const siteName = settings.site?.name || 'AI Platform';
      const fromName = emailConfig.smtp_from || siteName;

      const transporter = await EmailService.getTransporter();

      const mailOptions = {
        from: `"${fromName}" <${emailConfig.smtp_user}>`,
        to: email,
        subject: `[${siteName}] 您的登录验证码`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">${siteName}</h2>
            <p>您好！</p>
            <p>您的登录验证码是：</p>
            <div style="background: #f0f2f5; padding: 20px; text-align: center; margin: 20px 0;">
              <span style="font-size: 32px; font-weight: bold; color: #1890ff; letter-spacing: 5px;">${code}</span>
            </div>
            <p>验证码5分钟内有效，请尽快使用。</p>
            <p style="color: #666; font-size: 14px;">如非本人操作，请忽略此邮件。</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            <p style="color: #999; font-size: 12px; text-align: center;">
              ${siteName} - ${new Date().getFullYear()}
            </p>
          </div>
        `
      };

      const result = await transporter.sendMail(mailOptions);
      
      logger.info('验证码邮件发送成功', {
        to: email,
        messageId: result.messageId
      });

      return true;
    } catch (error) {
      logger.error('发送验证码邮件失败:', error);
      throw error;
    }
  }

  /**
   * 发送测试邮件
   */
  static async sendTestEmail(email) {
    try {
      const settings = await SystemConfig.getFormattedSettings();
      const siteName = settings.site?.name || 'AI Platform';
      const emailConfig = settings.email || {};
      const fromName = emailConfig.smtp_from || siteName;

      const transporter = await EmailService.getTransporter();

      const mailOptions = {
        from: `"${fromName}" <${emailConfig.smtp_user}>`,
        to: email,
        subject: `[${siteName}] 邮件服务测试`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">${siteName}</h2>
            <p>邮件服务测试成功！</p>
            <p>如果您收到此邮件，说明邮件服务配置正确。</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            <p style="color: #999; font-size: 12px; text-align: center;">
              ${siteName} - ${new Date().toLocaleString()}
            </p>
          </div>
        `
      };

      const result = await transporter.sendMail(mailOptions);
      
      logger.info('测试邮件发送成功', {
        to: email,
        messageId: result.messageId
      });

      return true;
    } catch (error) {
      logger.error('发送测试邮件失败:', error);
      throw error;
    }
  }

  /**
   * 生成6位数字验证码
   */
  static generateVerificationCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
}

module.exports = EmailService;

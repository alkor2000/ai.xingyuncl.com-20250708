/**
 * 认证控制器 - 支持SSO单点登录
 */

const User = require('../models/User');
const SystemConfig = require('../models/SystemConfig');
const { GroupService } = require('../services/admin');
const EmailService = require('../services/emailService');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const ResponseHelper = require('../utils/response');
const config = require('../config');
const logger = require('../utils/logger');
const redisConnection = require('../database/redis');
const { ValidationError } = require('../utils/errors');

class AuthController {
  /**
   * 获取刷新令牌过期时间
   * @returns {string} 返回格式如 "14d"
   */
  static async getRefreshTokenExpiry() {
    try {
      const loginConfig = await SystemConfig.getLoginSettings();
      const days = loginConfig.refresh_token_days || 14;
      return `${days}d`;
    } catch (error) {
      logger.error('获取刷新令牌过期时间失败，使用默认值:', error);
      return config.auth.jwt.refreshExpiresIn; // 降级到默认配置
    }
  }

  /**
   * 获取用户的站点配置（包含组配置）
   */
  static async getUserSiteConfig(user) {
    try {
      // 获取系统默认配置
      const systemSettings = await SystemConfig.getFormattedSettings();
      const systemSiteConfig = systemSettings.site || {
        name: 'AI Platform',
        description: '企业级AI应用聚合平台',
        logo: '',
        favicon: ''
      };

      // 如果用户有组且组开启了自定义配置
      if (user.group_id && user.group_site_customization_enabled) {
        // 优先使用组配置，如果组配置为空则使用系统配置
        return {
          name: user.group_site_name || systemSiteConfig.name,
          logo: user.group_site_logo || systemSiteConfig.logo,
          description: systemSiteConfig.description,
          favicon: systemSiteConfig.favicon,
          is_group_config: true
        };
      }

      // 使用系统默认配置
      return {
        ...systemSiteConfig,
        is_group_config: false
      };
    } catch (error) {
      logger.error('获取用户站点配置失败:', error);
      // 返回默认配置
      return {
        name: 'AI Platform',
        description: '企业级AI应用聚合平台', 
        logo: '',
        favicon: '',
        is_group_config: false
      };
    }
  }

  /**
   * SSO单点登录
   * POST /api/auth/sso
   */
  static async ssoLogin(req, res) {
    try {
      const { uuid, name, timestamp, signature } = req.body;
      const clientIp = req.ip || req.connection.remoteAddress;

      // 验证必填参数
      if (!uuid || !timestamp || !signature) {
        logger.warn('SSO登录失败：缺少必要参数', { uuid, clientIp });
        return ResponseHelper.validation(res, ['缺少必要的SSO参数']);
      }

      // 获取SSO配置
      const ssoConfig = await SystemConfig.getSetting('sso_config');
      if (!ssoConfig || !ssoConfig.enabled) {
        logger.warn('SSO登录失败：SSO功能未启用', { uuid, clientIp });
        return ResponseHelper.forbidden(res, 'SSO功能未启用');
      }

      // 检查IP白名单（如果启用）
      if (ssoConfig.ip_whitelist_enabled && ssoConfig.allowed_ips) {
        const allowedIps = ssoConfig.allowed_ips.split(',').map(ip => ip.trim());
        if (!allowedIps.includes(clientIp)) {
          logger.warn('SSO登录失败：IP不在白名单', { uuid, clientIp, allowedIps });
          return ResponseHelper.forbidden(res, '您的IP地址未授权访问SSO');
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
        return ResponseHelper.validation(res, ['SSO请求已过期，请重新发起']);
      }

      // 验证签名
      const sharedSecret = ssoConfig.shared_secret;
      if (!sharedSecret) {
        logger.error('SSO登录失败：未配置共享密钥');
        return ResponseHelper.error(res, 'SSO配置错误');
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
        return ResponseHelper.unauthorized(res, 'SSO签名验证失败');
      }

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
        return ResponseHelper.unauthorized(res, '账户已被禁用');
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
        
        return ResponseHelper.unauthorized(res, expireMessage);
      }

      // 获取用户权限
      const permissions = await user.getPermissions();

      // 获取用户的站点配置
      const siteConfig = await AuthController.getUserSiteConfig(user);

      // 生成JWT令牌
      const tokenPayload = {
        userId: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        type: 'access',
        ssoUser: true,
        uuid: user.uuid
      };
      
      // 添加唯一标识符，用于token管理
      const jti = `${user.id}-${Date.now()}-${Math.random().toString(36).substring(2)}`;
      tokenPayload.jti = jti;

      const accessToken = jwt.sign(
        tokenPayload,
        config.auth.jwt.accessSecret,
        {
          expiresIn: config.auth.jwt.accessExpiresIn,
          issuer: config.auth.jwt.issuer,
          audience: config.auth.jwt.audience
        }
      );

      // 获取动态的刷新令牌过期时间
      const refreshTokenExpiry = await AuthController.getRefreshTokenExpiry();

      const refreshToken = jwt.sign(
        {
          userId: user.id,
          type: 'refresh',
          jti: `refresh-${jti}`
        },
        config.auth.jwt.refreshSecret,
        {
          expiresIn: refreshTokenExpiry,
          issuer: config.auth.jwt.issuer,
          audience: config.auth.jwt.audience
        }
      );

      // 更新用户最后登录时间
      await user.updateLastLogin();

      logger.info('SSO登录成功', { 
        uuid, 
        userId: user.id, 
        username: user.username,
        role: user.role,
        permissions: permissions.length,
        clientIp
      });

      return ResponseHelper.success(res, {
        user: user.toJSON(),
        permissions,
        siteConfig,
        accessToken,
        refreshToken,
        expiresIn: config.auth.jwt.accessExpiresIn
      }, 'SSO登录成功');

    } catch (error) {
      logger.error('SSO登录处理失败:', error);
      return ResponseHelper.error(res, 'SSO登录失败');
    }
  }

  /**
   * 用户登录 - 支持邮箱、手机号、用户名登录
   * POST /api/auth/login
   */
  static async login(req, res) {
    try {
      const { account, password } = req.body;

      // 验证输入
      if (!account || !password) {
        return ResponseHelper.validation(res, ['账号和密码不能为空']);
      }

      // 获取登录配置
      const loginConfig = await SystemConfig.getLoginSettings();
      
      // 如果是强制邮箱验证模式，拒绝普通密码登录
      if (loginConfig.mode === 'email_verify_required') {
        logger.warn('密码登录被拒绝：系统启用了强制邮箱验证模式', { account });
        return ResponseHelper.forbidden(res, '系统已启用强制邮箱验证模式，请使用邮箱+密码+验证码登录');
      }

      logger.info('用户登录尝试', { account });

      // 判断账号类型并查找用户
      let user = null;
      
      // 邮箱格式
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account)) {
        user = await User.findByEmail(account.toLowerCase());
      }
      // 手机号格式
      else if (/^1[3-9]\d{9}$/.test(account)) {
        user = await User.findByPhone(account);
      }
      // 用户名
      else {
        user = await User.findByUsername(account);
      }

      if (!user) {
        logger.warn('登录失败：用户不存在', { account });
        return ResponseHelper.unauthorized(res, '账号或密码错误');
      }

      // SSO用户不允许密码登录
      if (user.uuid_source === 'sso') {
        logger.warn('登录失败：SSO用户不允许密码登录', { account, userId: user.id });
        return ResponseHelper.forbidden(res, 'SSO用户请通过单点登录访问');
      }

      // 验证密码（使用bcrypt）
      const isPasswordValid = await bcrypt.compare(password, user.password_hash);
      if (!isPasswordValid) {
        logger.warn('登录失败：密码错误', { account, userId: user.id });
        return ResponseHelper.unauthorized(res, '账号或密码错误');
      }

      // 检查用户状态
      if (user.status !== 'active') {
        logger.warn('登录失败：用户状态异常', { 
          account, 
          userId: user.id, 
          status: user.status 
        });
        return ResponseHelper.unauthorized(res, '账户已被禁用');
      }

      // 检查账号有效期（新增）
      if (user.isAccountExpired()) {
        const remainingDays = user.getAccountRemainingDays();
        logger.warn('登录失败：账号已过期', { 
          account, 
          userId: user.id, 
          expireAt: user.expire_at,
          expiredDays: Math.abs(remainingDays)
        });
        
        let expireMessage = '账号已过期';
        if (remainingDays !== null) {
          expireMessage = `账号已过期${Math.abs(remainingDays)}天，请联系管理员续期`;
        }
        
        return ResponseHelper.unauthorized(res, expireMessage);
      }

      // 获取用户权限
      const permissions = await user.getPermissions();

      // 获取用户的站点配置
      const siteConfig = await AuthController.getUserSiteConfig(user);

      // 生成JWT令牌
      const tokenPayload = {
        userId: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        type: 'access'
      };
      
      // 添加唯一标识符，用于token管理
      const jti = `${user.id}-${Date.now()}-${Math.random().toString(36).substring(2)}`;
      tokenPayload.jti = jti;

      const accessToken = jwt.sign(
        tokenPayload,
        config.auth.jwt.accessSecret,
        {
          expiresIn: config.auth.jwt.accessExpiresIn,
          issuer: config.auth.jwt.issuer,
          audience: config.auth.jwt.audience
        }
      );

      // 获取动态的刷新令牌过期时间
      const refreshTokenExpiry = await AuthController.getRefreshTokenExpiry();

      const refreshToken = jwt.sign(
        {
          userId: user.id,
          type: 'refresh',
          jti: `refresh-${jti}`
        },
        config.auth.jwt.refreshSecret,
        {
          expiresIn: refreshTokenExpiry,
          issuer: config.auth.jwt.issuer,
          audience: config.auth.jwt.audience
        }
      );

      // 更新用户最后登录时间
      await user.updateLastLogin();

      logger.info('用户登录成功', { 
        account, 
        userId: user.id, 
        role: user.role,
        permissions: permissions.length,
        accountExpireAt: user.expire_at,
        accountRemainingDays: user.getAccountRemainingDays(),
        refreshTokenExpiry,
        hasGroupSiteConfig: siteConfig.is_group_config
      });

      return ResponseHelper.success(res, {
        user: user.toJSON(),
        permissions,
        siteConfig,
        accessToken,
        refreshToken,
        expiresIn: config.auth.jwt.accessExpiresIn
      }, '登录成功');

    } catch (error) {
      logger.error('登录处理失败:', error);
      return ResponseHelper.error(res, '登录失败');
    }
  }

  /**
   * 发送邮箱验证码
   * POST /api/auth/send-email-code
   */
  static async sendEmailCode(req, res) {
    try {
      const { email } = req.body;

      // 验证邮箱格式
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return ResponseHelper.validation(res, ['请输入有效的邮箱地址']);
      }

      logger.info('请求发送验证码', { email });

      // 检查邮箱是否存在
      const user = await User.findByEmail(email.toLowerCase());
      if (!user) {
        logger.warn('发送验证码失败：邮箱未注册', { email });
        return ResponseHelper.validation(res, ['该邮箱未注册']);
      }

      // 检查用户状态
      if (user.status !== 'active') {
        logger.warn('发送验证码失败：用户状态异常', { email, status: user.status });
        return ResponseHelper.forbidden(res, '账户已被禁用');
      }

      // 检查60秒内是否已发送
      const sentKey = `email_sent:${email}`;
      if (redisConnection.isConnected) {
        const hasSent = await redisConnection.exists(sentKey);
        if (hasSent) {
          return ResponseHelper.validation(res, ['请等待60秒后再试']);
        }
      }

      // 生成验证码
      const code = EmailService.generateVerificationCode();
      
      // 存储验证码到Redis（5分钟有效）
      if (redisConnection.isConnected) {
        const codeKey = `email_code:${email}`;
        await redisConnection.set(codeKey, code, 300); // 5分钟
        await redisConnection.set(sentKey, '1', 60); // 60秒标记
      } else {
        logger.error('Redis未连接，无法存储验证码');
        return ResponseHelper.error(res, '服务暂时不可用，请稍后再试');
      }

      // 发送邮件
      try {
        await EmailService.sendVerificationCode(email, code);
        logger.info('验证码发送成功', { email });
        return ResponseHelper.success(res, null, '验证码已发送到您的邮箱');
      } catch (emailError) {
        logger.error('发送邮件失败:', emailError);
        // 清除已存储的验证码
        if (redisConnection.isConnected) {
          await redisConnection.del(`email_code:${email}`);
          await redisConnection.del(sentKey);
        }
        return ResponseHelper.error(res, '邮件发送失败，请检查邮件服务配置');
      }

    } catch (error) {
      logger.error('发送验证码失败:', error);
      return ResponseHelper.error(res, '发送验证码失败');
    }
  }

  /**
   * 邮箱验证码登录
   * POST /api/auth/login-by-code
   */
  static async loginByEmailCode(req, res) {
    try {
      const { email, code } = req.body;

      // 验证输入
      if (!email || !code) {
        return ResponseHelper.validation(res, ['邮箱和验证码不能为空']);
      }

      // 验证邮箱格式
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return ResponseHelper.validation(res, ['邮箱格式不正确']);
      }

      // 验证验证码格式
      if (!/^\d{6}$/.test(code)) {
        return ResponseHelper.validation(res, ['验证码格式不正确']);
      }

      // 获取登录配置
      const loginConfig = await SystemConfig.getLoginSettings();
      
      // 如果是强制邮箱验证模式，拒绝纯验证码登录
      if (loginConfig.mode === 'email_verify_required') {
        logger.warn('纯验证码登录被拒绝：系统启用了强制邮箱验证模式', { email });
        return ResponseHelper.forbidden(res, '系统已启用强制邮箱验证模式，请使用邮箱+密码+验证码登录');
      }

      logger.info('验证码登录尝试', { email });

      // 验证验证码
      if (!redisConnection.isConnected) {
        logger.error('Redis未连接，无法验证验证码');
        return ResponseHelper.error(res, '服务暂时不可用，请稍后再试');
      }

      const codeKey = `email_code:${email}`;
      const storedCode = await redisConnection.get(codeKey);

      // 添加调试日志
      logger.info("验证码比较", { 
        email, 
        inputCode: code, 
        inputCodeType: typeof code,
        storedCode: storedCode,
        storedCodeType: typeof storedCode,
        isEqual: storedCode === code
      });
      
      if (!storedCode) {
        logger.warn('验证码登录失败：验证码不存在或已过期', { email });
        return ResponseHelper.validation(res, ['验证码已过期，请重新获取']);
      }

      if (String(storedCode) !== String(code)) {
        logger.warn('验证码登录失败：验证码错误', { email });
        return ResponseHelper.validation(res, ['验证码错误']);
      }

      // 删除已使用的验证码
      await redisConnection.del(codeKey);

      // 查找用户
      const user = await User.findByEmail(email.toLowerCase());
      if (!user) {
        logger.warn('验证码登录失败：用户不存在', { email });
        return ResponseHelper.notFound(res, '用户不存在');
      }

      // 检查用户状态
      if (user.status !== 'active') {
        logger.warn('验证码登录失败：用户状态异常', { 
          email, 
          userId: user.id, 
          status: user.status 
        });
        return ResponseHelper.unauthorized(res, '账户已被禁用');
      }

      // 检查账号有效期
      if (user.isAccountExpired()) {
        const remainingDays = user.getAccountRemainingDays();
        logger.warn('验证码登录失败：账号已过期', { 
          email, 
          userId: user.id, 
          expireAt: user.expire_at,
          expiredDays: Math.abs(remainingDays)
        });
        
        let expireMessage = '账号已过期';
        if (remainingDays !== null) {
          expireMessage = `账号已过期${Math.abs(remainingDays)}天，请联系管理员续期`;
        }
        
        return ResponseHelper.unauthorized(res, expireMessage);
      }

      // 获取用户权限
      const permissions = await user.getPermissions();

      // 获取用户的站点配置
      const siteConfig = await AuthController.getUserSiteConfig(user);

      // 生成JWT令牌（与密码登录相同）
      const tokenPayload = {
        userId: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        type: 'access'
      };
      
      const jti = `${user.id}-${Date.now()}-${Math.random().toString(36).substring(2)}`;
      tokenPayload.jti = jti;

      const accessToken = jwt.sign(
        tokenPayload,
        config.auth.jwt.accessSecret,
        {
          expiresIn: config.auth.jwt.accessExpiresIn,
          issuer: config.auth.jwt.issuer,
          audience: config.auth.jwt.audience
        }
      );

      // 获取动态的刷新令牌过期时间
      const refreshTokenExpiry = await AuthController.getRefreshTokenExpiry();

      const refreshToken = jwt.sign(
        {
          userId: user.id,
          type: 'refresh',
          jti: `refresh-${jti}`
        },
        config.auth.jwt.refreshSecret,
        {
          expiresIn: refreshTokenExpiry,
          issuer: config.auth.jwt.issuer,
          audience: config.auth.jwt.audience
        }
      );

      // 更新用户最后登录时间
      await user.updateLastLogin();

      logger.info('验证码登录成功', { 
        email, 
        userId: user.id, 
        role: user.role,
        permissions: permissions.length,
        refreshTokenExpiry,
        hasGroupSiteConfig: siteConfig.is_group_config
      });

      return ResponseHelper.success(res, {
        user: user.toJSON(),
        permissions,
        siteConfig,
        accessToken,
        refreshToken,
        expiresIn: config.auth.jwt.accessExpiresIn
      }, '登录成功');

    } catch (error) {
      logger.error('验证码登录失败:', error);
      return ResponseHelper.error(res, '登录失败');
    }
  }

  /**
   * 邮箱+密码+验证码登录（强制验证模式）
   * POST /api/auth/login-by-email-password
   */
  static async loginByEmailPassword(req, res) {
    try {
      const { email, password, code } = req.body;

      // 验证输入
      if (!email || !password || !code) {
        return ResponseHelper.validation(res, ['邮箱、密码和验证码不能为空']);
      }

      // 验证邮箱格式
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return ResponseHelper.validation(res, ['邮箱格式不正确']);
      }

      // 验证验证码格式
      if (!/^\d{6}$/.test(code)) {
        return ResponseHelper.validation(res, ['验证码格式不正确']);
      }

      logger.info('邮箱密码验证码登录尝试', { email });

      // 查找用户
      const user = await User.findByEmail(email.toLowerCase());
      if (!user) {
        logger.warn('登录失败：用户不存在', { email });
        return ResponseHelper.unauthorized(res, '邮箱或密码错误');
      }

      // 验证密码
      const isPasswordValid = await bcrypt.compare(password, user.password_hash);
      if (!isPasswordValid) {
        logger.warn('登录失败：密码错误', { email, userId: user.id });
        return ResponseHelper.unauthorized(res, '邮箱或密码错误');
      }

      // 验证验证码
      if (!redisConnection.isConnected) {
        logger.error('Redis未连接，无法验证验证码');
        return ResponseHelper.error(res, '服务暂时不可用，请稍后再试');
      }

      const codeKey = `email_code:${email}`;
      const storedCode = await redisConnection.get(codeKey);

      if (!storedCode) {
        logger.warn('登录失败：验证码不存在或已过期', { email });
        return ResponseHelper.validation(res, ['验证码已过期，请重新获取']);
      }

      if (String(storedCode) !== String(code)) {
        logger.warn('登录失败：验证码错误', { email });
        return ResponseHelper.validation(res, ['验证码错误']);
      }

      // 删除已使用的验证码
      await redisConnection.del(codeKey);

      // 检查用户状态
      if (user.status !== 'active') {
        logger.warn('登录失败：用户状态异常', { 
          email, 
          userId: user.id, 
          status: user.status 
        });
        return ResponseHelper.unauthorized(res, '账户已被禁用');
      }

      // 检查账号有效期
      if (user.isAccountExpired()) {
        const remainingDays = user.getAccountRemainingDays();
        logger.warn('登录失败：账号已过期', { 
          email, 
          userId: user.id, 
          expireAt: user.expire_at,
          expiredDays: Math.abs(remainingDays)
        });
        
        let expireMessage = '账号已过期';
        if (remainingDays !== null) {
          expireMessage = `账号已过期${Math.abs(remainingDays)}天，请联系管理员续期`;
        }
        
        return ResponseHelper.unauthorized(res, expireMessage);
      }

      // 获取用户权限
      const permissions = await user.getPermissions();

      // 获取用户的站点配置
      const siteConfig = await AuthController.getUserSiteConfig(user);

      // 生成JWT令牌
      const tokenPayload = {
        userId: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        type: 'access'
      };
      
      const jti = `${user.id}-${Date.now()}-${Math.random().toString(36).substring(2)}`;
      tokenPayload.jti = jti;

      const accessToken = jwt.sign(
        tokenPayload,
        config.auth.jwt.accessSecret,
        {
          expiresIn: config.auth.jwt.accessExpiresIn,
          issuer: config.auth.jwt.issuer,
          audience: config.auth.jwt.audience
        }
      );

      // 获取动态的刷新令牌过期时间
      const refreshTokenExpiry = await AuthController.getRefreshTokenExpiry();

      const refreshToken = jwt.sign(
        {
          userId: user.id,
          type: 'refresh',
          jti: `refresh-${jti}`
        },
        config.auth.jwt.refreshSecret,
        {
          expiresIn: refreshTokenExpiry,
          issuer: config.auth.jwt.issuer,
          audience: config.auth.jwt.audience
        }
      );

      // 更新用户最后登录时间
      await user.updateLastLogin();

      logger.info('邮箱密码验证码登录成功', { 
        email, 
        userId: user.id, 
        role: user.role,
        permissions: permissions.length,
        refreshTokenExpiry,
        hasGroupSiteConfig: siteConfig.is_group_config
      });

      return ResponseHelper.success(res, {
        user: user.toJSON(),
        permissions,
        siteConfig,
        accessToken,
        refreshToken,
        expiresIn: config.auth.jwt.accessExpiresIn
      }, '登录成功');

    } catch (error) {
      logger.error('邮箱密码验证码登录失败:', error);
      return ResponseHelper.error(res, '登录失败');
    }
  }

  /**
   * 用户注册
   * POST /api/auth/register
   */
  static async register(req, res) {
    try {
      const { email, username, password, phone } = req.body;

      // 验证输入
      if (!email || !username || !password) {
        return ResponseHelper.validation(res, ['邮箱、用户名和密码不能为空']);
      }

      if (password.length < 6) {
        return ResponseHelper.validation(res, ['密码长度至少6位']);
      }

      // 验证邮箱格式
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return ResponseHelper.validation(res, ['邮箱格式不正确']);
      }

      // 验证用户名格式
      if (!/^[a-zA-Z0-9_-]{3,20}$/.test(username)) {
        return ResponseHelper.validation(res, ['用户名只能包含字母、数字、下划线和横线，长度3-20个字符']);
      }

      // 验证手机号格式（如果提供）
      if (phone && !/^1[3-9]\d{9}$/.test(phone)) {
        return ResponseHelper.validation(res, ['手机号格式不正确']);
      }

      logger.info('用户注册尝试', { email, username, phone });

      // 获取系统配置，检查是否允许注册
      let allowRegister = true;
      let defaultTokens = 10000;
      let defaultCredits = 1000;
      let defaultGroupId = 1;
      
      try {
        const systemSettings = await SystemConfig.getFormattedSettings();
        
        if (systemSettings.user) {
          // 检查是否允许注册
          allowRegister = systemSettings.user.allow_register !== false;
          
          if (!allowRegister) {
            logger.warn('注册失败：系统已关闭注册功能', { email, username });
            return ResponseHelper.forbidden(res, '系统暂时关闭了注册功能');
          }
          
          // 使用新的字段名 - 修复：正确处理0值
          defaultTokens = systemSettings.user.default_tokens !== undefined 
            ? systemSettings.user.default_tokens 
            : 10000;
            
          defaultCredits = systemSettings.user.default_credits !== undefined 
            ? systemSettings.user.default_credits 
            : 1000;
            
          defaultGroupId = systemSettings.user.default_group_id !== undefined 
            ? systemSettings.user.default_group_id 
            : 1;
        }
        
        logger.info('使用系统配置的默认值', {
          allowRegister,
          defaultTokens,
          defaultCredits,
          defaultGroupId
        });
      } catch (configError) {
        logger.warn('获取系统配置失败，使用默认值', { error: configError.message });
      }

      // 检查邮箱是否已存在
      const existingUserByEmail = await User.findByEmail(email.toLowerCase());
      if (existingUserByEmail) {
        return ResponseHelper.validation(res, ['邮箱已被注册']);
      }

      // 检查用户名是否已存在
      const existingUserByUsername = await User.findByUsername(username);
      if (existingUserByUsername) {
        return ResponseHelper.validation(res, ['用户名已被使用']);
      }

      // 检查手机号是否已存在（如果提供）
      if (phone) {
        const existingUserByPhone = await User.findByPhone(phone);
        if (existingUserByPhone) {
          return ResponseHelper.validation(res, ['手机号已被使用']);
        }
      }

      // 加密密码
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // 创建用户（使用系统配置的默认值）
      const user = await User.create({
        email: email.toLowerCase(),
        username,
        password: hashedPassword, // 使用加密后的密码
        phone: phone || null,
        role: 'user',
        status: 'active',
        group_id: defaultGroupId,
        token_quota: defaultTokens,
        credits_quota: defaultCredits,
        credits_expire_days: 365 // 默认365天有效期
      });

      // 获取新用户权限
      const permissions = await user.getPermissions();

      // 获取用户的站点配置
      const siteConfig = await AuthController.getUserSiteConfig(user);

      logger.info('用户注册成功', { 
        email, 
        userId: user.id,
        tokenQuota: defaultTokens,
        creditsQuota: defaultCredits,
        accountExpireAt: user.expire_at
      });

      return ResponseHelper.success(res, {
        user: user.toJSON(),
        permissions,
        siteConfig
      }, '注册成功', 201);

    } catch (error) {
      logger.error('注册处理失败:', error);
      return ResponseHelper.error(res, '注册失败');
    }
  }

  /**
   * 获取当前用户信息
   * GET /api/auth/me
   */
  static async getCurrentUser(req, res) {
    try {
      const userId = req.user.id;
      
      const user = await User.findById(userId);
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }

      // 获取用户权限
      const permissions = await user.getPermissions();

      // 获取用户的站点配置
      const siteConfig = await AuthController.getUserSiteConfig(user);

      return ResponseHelper.success(res, {
        user: user.toJSON(),
        permissions,
        siteConfig
      }, '获取用户信息成功');

    } catch (error) {
      logger.error('获取用户信息失败:', error);
      return ResponseHelper.error(res, '获取用户信息失败');
    }
  }

  /**
   * 更新个人信息
   * PUT /api/auth/profile
   */
  static async updateProfile(req, res) {
    try {
      const userId = req.user.id;
      const { username, phone, avatar_url } = req.body;

      // 获取用户
      const user = await User.findById(userId);
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }

      // SSO用户不允许修改用户名
      if (user.uuid_source === 'sso' && username !== undefined && username !== user.username) {
        return ResponseHelper.forbidden(res, 'SSO用户不允许修改用户名');
      }

      // 准备更新数据
      const updateData = {};
      
      // 验证用户名
      if (username !== undefined && username !== user.username) {
        // 验证用户名格式
        const usernameRegex = /^[a-zA-Z0-9_-]{3,20}$/;
        if (!usernameRegex.test(username)) {
          return ResponseHelper.validation(res, ['用户名只能包含字母、数字、下划线和横线，长度3-20个字符']);
        }
        
        // 检查用户名是否已存在
        const existingUser = await User.findByUsername(username);
        if (existingUser && existingUser.id !== userId) {
          return ResponseHelper.validation(res, ['用户名已被使用']);
        }
        updateData.username = username;
      }

      // 验证手机号 - 修复：只有当phone与当前值不同时才更新
      if (phone !== undefined && phone !== user.phone) {
        if (phone && !/^1[3-9]\d{9}$/.test(phone)) {
          return ResponseHelper.validation(res, ['手机号格式不正确']);
        }
        
        // 检查手机号是否已被其他用户使用
        if (phone) {
          const existingUser = await User.findByPhone(phone);
          if (existingUser && existingUser.id !== userId) {
            return ResponseHelper.validation(res, ['手机号已被使用']);
          }
        }
        
        updateData.phone = phone || null;
      }

      // 头像URL
      if (avatar_url !== undefined && avatar_url !== user.avatar_url) {
        updateData.avatar_url = avatar_url || null;
      }

      // 如果没有需要更新的内容
      if (Object.keys(updateData).length === 0) {
        return ResponseHelper.success(res, {
          user: user.toJSON()
        }, '无需更新');
      }

      // 更新用户信息
      const updatedUser = await user.update(updateData);

      logger.info('用户信息更新成功', { 
        userId, 
        updateFields: Object.keys(updateData) 
      });

      return ResponseHelper.success(res, {
        user: updatedUser.toJSON()
      }, '个人信息更新成功');

    } catch (error) {
      logger.error('更新个人信息失败:', error);
      return ResponseHelper.error(res, error.message || '更新个人信息失败');
    }
  }

  /**
   * 修改密码 - 简化版，用户修改自己的密码不需要原密码
   * PUT /api/auth/password
   */
  static async changePassword(req, res) {
    try {
      const userId = req.user.id;
      const { oldPassword, newPassword } = req.body;

      // 验证新密码
      if (!newPassword) {
        return ResponseHelper.validation(res, ['新密码不能为空']);
      }

      if (newPassword.length < 6) {
        return ResponseHelper.validation(res, ['新密码长度至少6位']);
      }

      // 获取用户
      const user = await User.findById(userId);
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }

      // SSO用户不允许修改密码
      if (user.uuid_source === 'sso') {
        return ResponseHelper.forbidden(res, 'SSO用户不允许修改密码');
      }

      // 注意：用户修改自己的密码时，不再需要验证原密码
      // 因为用户已经通过JWT认证了身份，这就足够了
      // 如果前端传了oldPassword（向后兼容），我们忽略它
      
      logger.info('用户自行修改密码（无需原密码验证）', { userId, username: user.username });

      // 直接更新密码（使用password字段，User模型会自动处理加密）
      await user.update({ password: newPassword });

      logger.info('用户密码修改成功', { userId });

      return ResponseHelper.success(res, null, '密码修改成功');

    } catch (error) {
      logger.error('修改密码失败:', error);
      return ResponseHelper.error(res, '修改密码失败');
    }
  }

  /**
   * 获取用户积分历史
   * GET /api/auth/credit-history
   */
  static async getCreditHistory(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 20 } = req.query;

      const result = await User.getCreditHistory(userId, {
        page: parseInt(page),
        limit: parseInt(limit)
      });

      return ResponseHelper.success(res, result, '获取积分历史成功');

    } catch (error) {
      logger.error('获取积分历史失败:', error);
      return ResponseHelper.error(res, '获取积分历史失败');
    }
  }

  /**
   * 刷新访问令牌
   * POST /api/auth/refresh
   */
  static async refreshToken(req, res) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return ResponseHelper.unauthorized(res, '刷新令牌不能为空');
      }

      // 验证刷新令牌
      const decoded = jwt.verify(refreshToken, config.auth.jwt.refreshSecret);

      if (decoded.type !== 'refresh') {
        return ResponseHelper.unauthorized(res, '无效的刷新令牌');
      }

      // 检查refresh token是否在黑名单中
      if (decoded.jti && redisConnection.isConnected) {
        const isBlacklisted = await redisConnection.exists(`token_blacklist:${decoded.jti}`);
        if (isBlacklisted) {
          return ResponseHelper.unauthorized(res, '刷新令牌已失效');
        }
      }

      // 获取用户信息
      const user = await User.findById(decoded.userId);
      if (!user || user.status !== 'active') {
        return ResponseHelper.unauthorized(res, '用户不存在或已被禁用');
      }

      // 检查账号有效期（新增）
      if (user.isAccountExpired()) {
        logger.warn('刷新令牌失败：账号已过期', { 
          userId: user.id, 
          expireAt: user.expire_at
        });
        return ResponseHelper.unauthorized(res, '账号已过期，请联系管理员续期');
      }

      // 生成新的访问令牌
      const jti = `${user.id}-${Date.now()}-${Math.random().toString(36).substring(2)}`;
      const newAccessToken = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          username: user.username,
          role: user.role,
          type: 'access',
          jti: jti
        },
        config.auth.jwt.accessSecret,
        {
          expiresIn: config.auth.jwt.accessExpiresIn,
          issuer: config.auth.jwt.issuer,
          audience: config.auth.jwt.audience
        }
      );

      logger.info('令牌刷新成功', { userId: user.id });

      return ResponseHelper.success(res, {
        accessToken: newAccessToken,
        expiresIn: config.auth.jwt.accessExpiresIn
      }, '令牌刷新成功');

    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return ResponseHelper.unauthorized(res, '刷新令牌已过期');
      }
      logger.error('令牌刷新失败:', error);
      return ResponseHelper.unauthorized(res, '刷新令牌无效或已过期');
    }
  }

  /**
   * 用户登出
   * POST /api/auth/logout
   */
  static async logout(req, res) {
    try {
      const userId = req.user?.id;
      const token = req.token;

      if (!userId || !token) {
        return ResponseHelper.success(res, null, '退出登录成功');
      }

      // 解析token获取jti和过期时间
      const decoded = jwt.decode(token);
      if (decoded && decoded.jti && redisConnection.isConnected) {
        // 计算token剩余有效时间
        const now = Math.floor(Date.now() / 1000);
        const ttl = decoded.exp - now;
        
        if (ttl > 0) {
          // 将token加入黑名单，过期时间与token过期时间一致
          await redisConnection.set(`token_blacklist:${decoded.jti}`, userId, ttl);
          logger.info('Token已加入黑名单', { userId, jti: decoded.jti, ttl });
        }
      }

      logger.info('用户登出成功', { userId });

      return ResponseHelper.success(res, null, '退出登录成功');
    } catch (error) {
      logger.error('登出处理失败:', error);
      // 即使失败也返回成功，避免暴露内部错误
      return ResponseHelper.success(res, null, '退出登录成功');
    }
  }
}

module.exports = AuthController;

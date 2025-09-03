/**
 * 重构后的认证控制器 - 采用服务层架构
 * 控制器只负责：接收请求 -> 调用服务 -> 返回响应
 */

const User = require('../models/User');
const SystemConfig = require('../models/SystemConfig');
const SSOService = require('../services/auth/SSOService');
const EmailAuthService = require('../services/auth/EmailAuthService');
const TokenService = require('../services/auth/TokenService');
const SiteConfigService = require('../services/auth/SiteConfigService');
const bcrypt = require('bcryptjs');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');

class AuthControllerRefactored {
  /**
   * SSO单点登录
   * POST /api/auth/sso
   */
  static async ssoLogin(req, res) {
    try {
      const { uuid, name, timestamp, signature } = req.body;
      const clientIp = req.ip || req.connection.remoteAddress;
      
      // 验证SSO请求
      const ssoConfig = await SSOService.validateSSORequest(
        { uuid, timestamp, signature },
        clientIp
      );
      
      // 处理SSO用户
      const user = await SSOService.handleSSOUser({ uuid, name }, ssoConfig);
      
      // 获取用户权限
      const permissions = await user.getPermissions();
      
      // 获取站点配置
      const siteConfig = await SiteConfigService.getUserSiteConfig(user);
      
      // 生成Token对
      const tokens = await TokenService.generateTokenPair(user, true);
      
      // 更新最后登录时间
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
        ...tokens
      }, 'SSO登录成功');
      
    } catch (error) {
      logger.error('SSO登录处理失败:', error);
      return ResponseHelper.error(res, error.message || 'SSO登录失败');
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
      
      // 验证密码
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
      
      // 检查账号有效期
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
      
      // 获取站点配置
      const siteConfig = await SiteConfigService.getUserSiteConfig(user);
      
      // 生成Token对
      const tokens = await TokenService.generateTokenPair(user, false);
      
      // 更新最后登录时间
      await user.updateLastLogin();
      
      logger.info('用户登录成功', { 
        account, 
        userId: user.id, 
        role: user.role,
        permissions: permissions.length,
        accountExpireAt: user.expire_at,
        accountRemainingDays: user.getAccountRemainingDays(),
        hasGroupSiteConfig: siteConfig.is_group_config
      });
      
      return ResponseHelper.success(res, {
        user: user.toJSON(),
        permissions,
        siteConfig,
        ...tokens
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
      
      // 发送验证码
      await EmailAuthService.sendVerificationCode(email, user);
      
      return ResponseHelper.success(res, null, '验证码已发送到您的邮箱');
      
    } catch (error) {
      logger.error('发送验证码失败:', error);
      return ResponseHelper.error(res, error.message || '发送验证码失败');
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
      
      // 获取登录配置
      const loginConfig = await SystemConfig.getLoginSettings();
      
      // 如果是强制邮箱验证模式，拒绝纯验证码登录
      if (loginConfig.mode === 'email_verify_required') {
        logger.warn('纯验证码登录被拒绝：系统启用了强制邮箱验证模式', { email });
        return ResponseHelper.forbidden(res, '系统已启用强制邮箱验证模式，请使用邮箱+密码+验证码登录');
      }
      
      logger.info('验证码登录尝试', { email });
      
      // 验证验证码
      await EmailAuthService.verifyCode(email, code);
      
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
      
      // 获取站点配置
      const siteConfig = await SiteConfigService.getUserSiteConfig(user);
      
      // 生成Token对
      const tokens = await TokenService.generateTokenPair(user, false);
      
      // 更新最后登录时间
      await user.updateLastLogin();
      
      logger.info('验证码登录成功', { 
        email, 
        userId: user.id, 
        role: user.role,
        permissions: permissions.length,
        hasGroupSiteConfig: siteConfig.is_group_config
      });
      
      return ResponseHelper.success(res, {
        user: user.toJSON(),
        permissions,
        siteConfig,
        ...tokens
      }, '登录成功');
      
    } catch (error) {
      logger.error('验证码登录失败:', error);
      return ResponseHelper.error(res, error.message || '登录失败');
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
      await EmailAuthService.verifyCode(email, code);
      
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
      
      // 获取站点配置
      const siteConfig = await SiteConfigService.getUserSiteConfig(user);
      
      // 生成Token对
      const tokens = await TokenService.generateTokenPair(user, false);
      
      // 更新最后登录时间
      await user.updateLastLogin();
      
      logger.info('邮箱密码验证码登录成功', { 
        email, 
        userId: user.id, 
        role: user.role,
        permissions: permissions.length,
        hasGroupSiteConfig: siteConfig.is_group_config
      });
      
      return ResponseHelper.success(res, {
        user: user.toJSON(),
        permissions,
        siteConfig,
        ...tokens
      }, '登录成功');
      
    } catch (error) {
      logger.error('邮箱密码验证码登录失败:', error);
      return ResponseHelper.error(res, error.message || '登录失败');
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
          
          // 使用新的字段名
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
      
      // 创建用户
      const user = await User.create({
        email: email.toLowerCase(),
        username,
        password: hashedPassword,
        phone: phone || null,
        role: 'user',
        status: 'active',
        group_id: defaultGroupId,
        token_quota: defaultTokens,
        credits_quota: defaultCredits,
        credits_expire_days: 365
      });
      
      // 获取新用户权限
      const permissions = await user.getPermissions();
      
      // 获取站点配置
      const siteConfig = await SiteConfigService.getUserSiteConfig(user);
      
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
      
      // 获取站点配置
      const siteConfig = await SiteConfigService.getUserSiteConfig(user);
      
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
      
      // 验证手机号
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
   * 修改密码
   * PUT /api/auth/password
   */
  static async changePassword(req, res) {
    try {
      const userId = req.user.id;
      const { oldPassword, newPassword } = req.body;
      
      // 验证输入
      if (!oldPassword || !newPassword) {
        return ResponseHelper.validation(res, ['原密码和新密码不能为空']);
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
      
      // 验证原密码
      const isOldPasswordValid = await bcrypt.compare(oldPassword, user.password_hash);
      if (!isOldPasswordValid) {
        return ResponseHelper.validation(res, ['原密码错误']);
      }
      
      // 更新密码
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
      
      // 刷新Token
      const userId = await TokenService.refreshAccessToken(refreshToken);
      
      // 获取用户信息
      const user = await User.findById(userId);
      if (!user || user.status !== 'active') {
        return ResponseHelper.unauthorized(res, '用户不存在或已被禁用');
      }
      
      // 检查账号有效期
      if (user.isAccountExpired()) {
        logger.warn('刷新令牌失败：账号已过期', { 
          userId: user.id, 
          expireAt: user.expire_at
        });
        return ResponseHelper.unauthorized(res, '账号已过期，请联系管理员续期');
      }
      
      // 生成新的访问令牌（只生成访问令牌，不生成新的刷新令牌）
      const tokens = await TokenService.generateTokenPair(user, false);
      
      logger.info('令牌刷新成功', { userId: user.id });
      
      return ResponseHelper.success(res, {
        accessToken: tokens.accessToken,
        expiresIn: tokens.expiresIn
      }, '令牌刷新成功');
      
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return ResponseHelper.unauthorized(res, '刷新令牌已过期');
      }
      logger.error('令牌刷新失败:', error);
      return ResponseHelper.unauthorized(res, error.message || '刷新令牌无效或已过期');
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
      
      if (userId && token) {
        // 将token加入黑名单
        await TokenService.blacklistToken(token, userId);
        logger.info('用户登出成功', { userId });
      }
      
      return ResponseHelper.success(res, null, '退出登录成功');
      
    } catch (error) {
      logger.error('登出处理失败:', error);
      // 即使失败也返回成功，避免暴露内部错误
      return ResponseHelper.success(res, null, '退出登录成功');
    }
  }
}

module.exports = AuthControllerRefactored;

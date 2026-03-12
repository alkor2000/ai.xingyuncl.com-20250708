/**
 * 认证控制器（重构版）
 * 
 * 职责：接收请求 -> 调用服务 -> 返回响应
 * 
 * 支持的登录方式：
 * 1. 密码登录（用户名/邮箱/手机号 + 密码）
 * 2. 邮箱验证码登录（邮箱 + 验证码）
 * 3. 邮箱+密码+验证码登录（强制验证模式）
 * 4. SSO单点登录（uuid + timestamp + signature）
 * 
 * 安全说明：
 * - 修改密码必须验证原密码（防止token被盗后永久接管账号）
 * - 登录失败信息统一为"账号或密码错误"，不暴露具体原因
 * - 登出即使内部失败也返回成功，不暴露系统状态
 */

const User = require('../models/User');
const SystemConfig = require('../models/SystemConfig');
const SSOService = require('../services/auth/SSOService');
const EmailAuthService = require('../services/auth/EmailAuthService');
const TokenService = require('../services/auth/TokenService');
const SiteConfigService = require('../services/auth/SiteConfigService');
const { GroupService } = require('../services/admin');
const bcrypt = require('bcryptjs');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');

class AuthControllerRefactored {

  // ============================================================
  // 内部辅助方法
  // ============================================================

  /**
   * 登录成功后的统一处理流程
   * 
   * 提取自 login/loginByEmailCode/loginByEmailPassword 三个方法的公共逻辑：
   * 检查用户状态 -> 检查账号有效期 -> 获取权限 -> 获取站点配置 -> 生成Token -> 更新登录时间
   * 
   * @param {Object} user - 用户实例
   * @param {Object} res - Express response
   * @param {boolean} isSSOUser - 是否SSO用户
   * @param {string} loginMethod - 登录方式描述（用于日志）
   * @returns {Object} Express response
   */
  static async _handleLoginSuccess(user, res, isSSOUser = false, loginMethod = '密码登录') {
    // 检查用户状态
    if (user.status !== 'active') {
      logger.warn(`${loginMethod}失败：用户状态异常`, {
        userId: user.id,
        status: user.status
      });
      return ResponseHelper.unauthorized(res, '账户已被禁用');
    }

    // 检查账号有效期
    if (user.isAccountExpired()) {
      const remainingDays = user.getAccountRemainingDays();
      logger.warn(`${loginMethod}失败：账号已过期`, {
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

    // 获取站点配置（支持组级覆盖）
    const siteConfig = await SiteConfigService.getUserSiteConfig(user);

    // 生成Token对
    const tokens = await TokenService.generateTokenPair(user, isSSOUser);

    // 更新最后登录时间
    await user.updateLastLogin();

    logger.info(`${loginMethod}成功`, {
      userId: user.id,
      username: user.username,
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
  }

  // ============================================================
  // SSO登录
  // ============================================================

  /**
   * SSO单点登录
   * POST /api/auth/sso
   */
  static async ssoLogin(req, res) {
    try {
      const { uuid, name, timestamp, signature } = req.body;
      const clientIp = req.ip || req.connection.remoteAddress;

      // 验证SSO请求（签名+时间戳+IP白名单）
      const ssoConfig = await SSOService.validateSSORequest(
        { uuid, timestamp, signature },
        clientIp
      );

      // 处理SSO用户（查找或自动创建）
      const user = await SSOService.handleSSOUser({ uuid, name }, ssoConfig);

      // 使用统一的登录成功处理
      return await AuthControllerRefactored._handleLoginSuccess(user, res, true, 'SSO登录');

    } catch (error) {
      logger.error('SSO登录处理失败:', error);
      return ResponseHelper.error(res, error.message || 'SSO登录失败');
    }
  }

  // ============================================================
  // 密码登录
  // ============================================================

  /**
   * 用户登录 - 支持邮箱、手机号、用户名登录
   * POST /api/auth/login
   */
  static async login(req, res) {
    try {
      const { account, password } = req.body;

      if (!account || !password) {
        return ResponseHelper.validation(res, ['账号和密码不能为空']);
      }

      // 获取登录配置，检查是否强制邮箱验证模式
      const loginConfig = await SystemConfig.getLoginSettings();

      if (loginConfig.mode === 'email_verify_required') {
        logger.warn('密码登录被拒绝：系统启用了强制邮箱验证模式', { account });
        return ResponseHelper.forbidden(res, '系统已启用强制邮箱验证模式，请使用邮箱+密码+验证码登录');
      }

      logger.info('用户登录尝试', { account });

      // 根据账号格式查找用户
      let user = null;

      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account)) {
        user = await User.findByEmail(account.toLowerCase());
      } else if (/^1[3-9]\d{9}$/.test(account)) {
        user = await User.findByPhone(account);
      } else {
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

      // 通过统一流程处理登录成功
      return await AuthControllerRefactored._handleLoginSuccess(user, res, false, '密码登录');

    } catch (error) {
      logger.error('登录处理失败:', error);
      return ResponseHelper.error(res, '登录失败');
    }
  }

  // ============================================================
  // 邮箱验证码相关
  // ============================================================

  /**
   * 发送邮箱验证码
   * POST /api/auth/send-email-code
   */
  static async sendEmailCode(req, res) {
    try {
      const { email } = req.body;

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return ResponseHelper.validation(res, ['请输入有效的邮箱地址']);
      }

      logger.info('请求发送验证码', { email });

      const user = await User.findByEmail(email.toLowerCase());
      if (!user) {
        logger.warn('发送验证码失败：邮箱未注册', { email });
        return ResponseHelper.validation(res, ['该邮箱未注册']);
      }

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

      if (!email || !code) {
        return ResponseHelper.validation(res, ['邮箱和验证码不能为空']);
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return ResponseHelper.validation(res, ['邮箱格式不正确']);
      }

      // 如果是强制邮箱验证模式，拒绝纯验证码登录
      const loginConfig = await SystemConfig.getLoginSettings();
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

      // 通过统一流程处理登录成功
      return await AuthControllerRefactored._handleLoginSuccess(user, res, false, '验证码登录');

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

      if (!email || !password || !code) {
        return ResponseHelper.validation(res, ['邮箱、密码和验证码不能为空']);
      }

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

      // 通过统一流程处理登录成功
      return await AuthControllerRefactored._handleLoginSuccess(user, res, false, '邮箱密码验证码登录');

    } catch (error) {
      logger.error('邮箱密码验证码登录失败:', error);
      return ResponseHelper.error(res, error.message || '登录失败');
    }
  }

  // ============================================================
  // 注册与验证
  // ============================================================

  /**
   * 检查邮箱是否可用
   * POST /api/auth/check-email
   */
  static async checkEmail(req, res) {
    try {
      const { email } = req.body;

      if (!email) {
        return ResponseHelper.validation(res, ['邮箱不能为空']);
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return ResponseHelper.validation(res, ['邮箱格式不正确']);
      }

      const existingUser = await User.findByEmail(email.toLowerCase());
      const available = !existingUser;

      logger.info('检查邮箱可用性', { email, available });

      return ResponseHelper.success(res, { available }, '检查成功');

    } catch (error) {
      logger.error('检查邮箱可用性失败:', error);
      return ResponseHelper.error(res, '检查失败');
    }
  }

  /**
   * 检查用户名是否可用
   * POST /api/auth/check-username
   */
  static async checkUsername(req, res) {
    try {
      const { username } = req.body;

      if (!username) {
        return ResponseHelper.validation(res, ['用户名不能为空']);
      }

      if (!/^[a-zA-Z0-9_-]{3,20}$/.test(username)) {
        return ResponseHelper.validation(res, ['用户名只能包含字母、数字、下划线和横线，长度3-20个字符']);
      }

      const existingUser = await User.findByUsername(username);
      const available = !existingUser;

      logger.info('检查用户名可用性', { username, available });

      return ResponseHelper.success(res, { available }, '检查成功');

    } catch (error) {
      logger.error('检查用户名可用性失败:', error);
      return ResponseHelper.error(res, '检查失败');
    }
  }

  /**
   * 用户注册（支持邀请码，邮箱可选，支持强制邀请码配置）
   * POST /api/auth/register
   */
  static async register(req, res) {
    try {
      const { email, username, password, phone, invitation_code } = req.body;
      const clientIp = req.ip || req.connection.remoteAddress;

      // 验证必填项：用户名和密码必填
      if (!username || !password) {
        return ResponseHelper.validation(res, ['用户名和密码不能为空']);
      }

      if (password.length < 6) {
        return ResponseHelper.validation(res, ['密码长度至少6位']);
      }

      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return ResponseHelper.validation(res, ['邮箱格式不正确']);
      }

      if (!/^[a-zA-Z0-9_-]{3,20}$/.test(username)) {
        return ResponseHelper.validation(res, ['用户名只能包含字母、数字、下划线和横线，长度3-20个字符']);
      }

      if (phone && !/^1[3-9]\d{9}$/.test(phone)) {
        return ResponseHelper.validation(res, ['手机号格式不正确']);
      }

      logger.info('用户注册尝试', {
        username,
        hasEmail: !!email,
        hasPhone: !!phone,
        hasInvitationCode: !!invitation_code
      });

      // 获取系统配置，检查注册策略
      let allowRegister = true;
      let requireInvitationCode = false;
      let defaultTokens = 10000;
      let defaultCredits = 1000;
      let defaultGroupId = 1;
      let targetGroup = null;

      try {
        const systemSettings = await SystemConfig.getFormattedSettings();

        if (systemSettings.user) {
          allowRegister = systemSettings.user.allow_register !== false;
          requireInvitationCode = systemSettings.user.require_invitation_code === true;

          if (!allowRegister) {
            logger.warn('注册失败：系统已关闭注册功能', { username });
            return ResponseHelper.forbidden(res, '系统暂时关闭了注册功能');
          }

          if (requireInvitationCode && !invitation_code) {
            logger.warn('注册失败：系统要求邀请码但未提供', { username });
            return ResponseHelper.validation(res, ['系统要求邀请码才能注册']);
          }

          defaultTokens = systemSettings.user.default_tokens !== undefined
            ? systemSettings.user.default_tokens : 10000;
          defaultCredits = systemSettings.user.default_credits !== undefined
            ? systemSettings.user.default_credits : 1000;
          defaultGroupId = systemSettings.user.default_group_id !== undefined
            ? systemSettings.user.default_group_id : 1;
        }

        logger.info('使用系统配置的注册策略', {
          allowRegister, requireInvitationCode,
          defaultTokens, defaultCredits, defaultGroupId
        });
      } catch (configError) {
        logger.warn('获取系统配置失败，使用默认值', { error: configError.message });
      }

      // 处理邀请码
      if (invitation_code) {
        targetGroup = await GroupService.findGroupByInvitationCode(invitation_code);

        if (!targetGroup) {
          logger.warn('注册失败：邀请码无效', { username, invitationCode: invitation_code });
          return ResponseHelper.validation(res, ['邀请码无效或已过期']);
        }

        defaultGroupId = targetGroup.id;
        logger.info('使用邀请码注册', {
          username, invitationCode: invitation_code,
          groupId: targetGroup.id, groupName: targetGroup.name
        });
      } else if (requireInvitationCode) {
        logger.warn('注册失败：需要邀请码', { username });
        return ResponseHelper.validation(res, ['系统要求邀请码才能注册']);
      }

      // 检查唯一性
      if (email) {
        const existingUserByEmail = await User.findByEmail(email.toLowerCase());
        if (existingUserByEmail) {
          return ResponseHelper.validation(res, ['邮箱已被注册']);
        }
      }

      const existingUserByUsername = await User.findByUsername(username);
      if (existingUserByUsername) {
        return ResponseHelper.validation(res, ['用户名已被使用']);
      }

      if (phone) {
        const existingUserByPhone = await User.findByPhone(phone);
        if (existingUserByPhone) {
          return ResponseHelper.validation(res, ['手机号已被使用']);
        }
      }

      // 没有邮箱时生成占位邮箱
      const finalEmail = email ? email.toLowerCase() : `${username}@noemail.local`;

      // 创建用户
      const user = await User.create({
        email: finalEmail,
        username,
        password: password,
        phone: phone || null,
        role: 'user',
        status: 'active',
        group_id: defaultGroupId,
        token_quota: defaultTokens,
        credits_quota: defaultCredits,
        credits_expire_days: 365,
        email_verified: !email ? true : false
      });

      // 记录邀请码使用
      if (invitation_code && targetGroup) {
        await GroupService.useInvitationCode(invitation_code, user.id, clientIp);
        logger.info('邀请码注册成功并记录', {
          userId: user.id, invitationCode: invitation_code,
          groupId: targetGroup.id, groupName: targetGroup.name
        });
      }

      // 获取新用户权限和站点配置
      const permissions = await user.getPermissions();
      const siteConfig = await SiteConfigService.getUserSiteConfig(user);

      logger.info('用户注册成功', {
        username, userId: user.id, hasEmail: !!email,
        tokenQuota: defaultTokens, creditsQuota: defaultCredits,
        accountExpireAt: user.expire_at, groupId: defaultGroupId,
        usedInvitationCode: !!invitation_code
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
   * 验证邀请码
   * POST /api/auth/verify-invitation-code
   */
  static async verifyInvitationCode(req, res) {
    try {
      const { code } = req.body;

      if (!code) {
        return ResponseHelper.validation(res, ['邀请码不能为空']);
      }

      const group = await GroupService.findGroupByInvitationCode(code);

      if (!group) {
        return ResponseHelper.validation(res, ['邀请码无效或已过期']);
      }

      logger.info('邀请码验证成功', {
        code: code.toUpperCase(),
        groupId: group.id,
        groupName: group.name
      });

      return ResponseHelper.success(res, {
        valid: true,
        group_name: group.name,
        group_id: group.id
      }, '邀请码有效');

    } catch (error) {
      logger.error('验证邀请码失败:', error);
      return ResponseHelper.error(res, '验证邀请码失败');
    }
  }

  // ============================================================
  // 用户信息管理
  // ============================================================

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

      const permissions = await user.getPermissions();
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

      const user = await User.findById(userId);
      if (!user) {
        return ResponseHelper.notFound(res, '用户不存在');
      }

      // SSO用户不允许修改用户名
      if (user.uuid_source === 'sso' && username !== undefined && username !== user.username) {
        return ResponseHelper.forbidden(res, 'SSO用户不允许修改用户名');
      }

      const updateData = {};

      // 验证并准备用户名更新
      if (username !== undefined && username !== user.username) {
        if (!/^[a-zA-Z0-9_-]{3,20}$/.test(username)) {
          return ResponseHelper.validation(res, ['用户名只能包含字母、数字、下划线和横线，长度3-20个字符']);
        }

        const existingUser = await User.findByUsername(username);
        if (existingUser && existingUser.id !== userId) {
          return ResponseHelper.validation(res, ['用户名已被使用']);
        }
        updateData.username = username;
      }

      // 验证并准备手机号更新
      if (phone !== undefined && phone !== user.phone) {
        if (phone && !/^1[3-9]\d{9}$/.test(phone)) {
          return ResponseHelper.validation(res, ['手机号格式不正确']);
        }

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

      if (Object.keys(updateData).length === 0) {
        return ResponseHelper.success(res, { user: user.toJSON() }, '无需更新');
      }

      const updatedUser = await user.update(updateData);

      logger.info('用户信息更新成功', { userId, updateFields: Object.keys(updateData) });

      return ResponseHelper.success(res, {
        user: updatedUser.toJSON()
      }, '个人信息更新成功');

    } catch (error) {
      logger.error('更新个人信息失败:', error);
      return ResponseHelper.error(res, error.message || '更新个人信息失败');
    }
  }

  /**
   * 修改密码 - 必须验证原密码
   * 
   * 安全说明：即使用户已通过JWT认证，修改密码仍需验证原密码
   * 原因：JWT token 可能被盗（XSS/设备被他人使用），
   * 仅凭token不应允许永久接管账号（改密码+改邮箱=完全接管）
   * 
   * PUT /api/auth/password
   */
  static async changePassword(req, res) {
    try {
      const userId = req.user.id;
      const { oldPassword, newPassword } = req.body;

      // 验证输入
      if (!oldPassword) {
        return ResponseHelper.validation(res, ['请输入原密码']);
      }

      if (!newPassword) {
        return ResponseHelper.validation(res, ['新密码不能为空']);
      }

      if (newPassword.length < 6) {
        return ResponseHelper.validation(res, ['新密码长度至少6位']);
      }

      // 新旧密码不能相同
      if (oldPassword === newPassword) {
        return ResponseHelper.validation(res, ['新密码不能与原密码相同']);
      }

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
        logger.warn('修改密码失败：原密码错误', { userId, username: user.username });
        return ResponseHelper.unauthorized(res, '原密码错误');
      }

      // 更新密码
      await user.update({ password: newPassword });

      logger.info('用户密码修改成功', { userId, username: user.username });

      return ResponseHelper.success(res, null, '密码修改成功');

    } catch (error) {
      logger.error('修改密码失败:', error);
      return ResponseHelper.error(res, '修改密码失败');
    }
  }

  // ============================================================
  // 积分与Token管理
  // ============================================================

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

      const userId = await TokenService.refreshAccessToken(refreshToken);

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

      // 生成新的访问令牌
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
        await TokenService.blacklistToken(token, userId);
        logger.info('用户登出成功', { userId });
      }

      return ResponseHelper.success(res, null, '退出登录成功');

    } catch (error) {
      logger.error('登出处理失败:', error);
      // 即使失败也返回成功，不暴露内部错误
      return ResponseHelper.success(res, null, '退出登录成功');
    }
  }
}

module.exports = AuthControllerRefactored;

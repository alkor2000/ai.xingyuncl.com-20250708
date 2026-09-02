/**
 * 认证路由 - 使用重构后的控制器（添加邀请码和验证端点支持）
 *
 * Identity Center安全边界：
 * - /identity/login/start、login/callback、login/consume是登录用途公开协议入口；
 * - /identity/callback是bind/unlink OAuth回调，公开是OAuth协议要求；
 * - connect/start与unlink/start必须经过本地authenticate；
 * - 历史/auth/sso继续独立保留，不与Identity OIDC混用。
 */

const express = require('express');

const AuthControllerRefactored = require('../controllers/AuthControllerRefactored');
const IdentityAuthController = require('../controllers/IdentityAuthController');

const {
  authenticate
} = require('../middleware/authMiddleware');

const router = express.Router();

// ============================================================
// 公开认证路由
// ============================================================

router.post(
  '/login',
  AuthControllerRefactored.login
);

router.post(
  '/register',
  AuthControllerRefactored.register
);

router.post(
  '/refresh',
  AuthControllerRefactored.refreshToken
);

// 历史自定义SSO协议继续独立保留，Identity绝不复用本入口。
router.post(
  '/sso',
  AuthControllerRefactored.ssoLogin
);

// ============================================================
// PKU AI Lab Identity Center - 登录用途
// ============================================================

// 顶层导航入口：生成state/nonce/PKCE后302进入Identity Center。
router.get(
  '/identity/login/start',
  IdentityAuthController.startLogin
);

// Identity登录purpose专用后端callback。
router.get(
  '/identity/login/callback',
  IdentityAuthController.loginCallback
);

// 前端使用一次性Handoff换取本平台正常JWT。
router.post(
  '/identity/login/consume',
  IdentityAuthController.consumeLogin
);

// bind/unlink共用的强认证OAuth callback。
// 本地userId来自服务器保存的短时Flow，不来自Query。
router.get(
  '/identity/callback',
  IdentityAuthController.accountCallback
);

// ============================================================
// 邮箱验证相关
// ============================================================

router.post(
  '/send-email-code',
  AuthControllerRefactored.sendEmailCode
);

router.post(
  '/login-by-code',
  AuthControllerRefactored.loginByEmailCode
);

router.post(
  '/login-by-email-password',
  AuthControllerRefactored.loginByEmailPassword
);

// 邀请码验证
router.post(
  '/verify-invitation-code',
  AuthControllerRefactored.verifyInvitationCode
);

// 注册验证端点
router.post(
  '/check-email',
  AuthControllerRefactored.checkEmail
);

router.post(
  '/check-username',
  AuthControllerRefactored.checkUsername
);

// ============================================================
// 以下路由必须先通过本地JWT认证
// ============================================================

router.use(authenticate);

router.get(
  '/me',
  AuthControllerRefactored.getCurrentUser
);

router.put(
  '/profile',
  AuthControllerRefactored.updateProfile
);

router.put(
  '/password',
  AuthControllerRefactored.changePassword
);

router.get(
  '/credit-history',
  AuthControllerRefactored.getCreditHistory
);

router.post(
  '/logout',
  AuthControllerRefactored.logout
);

// ============================================================
// PKU AI Lab Identity Center - 本地账号关联
// ============================================================

// 前端必须先展示“确认绑定当前平台账号 XXX”，
// 再POST confirm_current_account=true。
router.post(
  '/identity/connect/start',
  IdentityAuthController.startConnect
);

// unlink同样需要当前本地JWT + 明确确认，随后进入强微信认证。
router.post(
  '/identity/unlink/start',
  IdentityAuthController.startUnlink
);

module.exports = router;

/**
 * 认证路由 - 使用重构后的控制器（添加邀请码和验证端点支持）
 */
const express = require('express');
const AuthControllerRefactored = require('../controllers/AuthControllerRefactored');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

// 公开路由（不需要认证）
router.post('/login', AuthControllerRefactored.login);
router.post('/register', AuthControllerRefactored.register);
router.post('/refresh', AuthControllerRefactored.refreshToken);
router.post('/sso', AuthControllerRefactored.ssoLogin);

// 邮箱验证相关
router.post('/send-email-code', AuthControllerRefactored.sendEmailCode);
router.post('/login-by-code', AuthControllerRefactored.loginByEmailCode);
router.post('/login-by-email-password', AuthControllerRefactored.loginByEmailPassword);

// 邀请码验证（新增）
router.post('/verify-invitation-code', AuthControllerRefactored.verifyInvitationCode);

// 注册验证端点（新增） - 公开访问
router.post('/check-email', AuthControllerRefactored.checkEmail);
router.post('/check-username', AuthControllerRefactored.checkUsername);

// 需要认证的路由
router.use(authenticate);

router.get('/me', AuthControllerRefactored.getCurrentUser);
router.put('/profile', AuthControllerRefactored.updateProfile);
router.put('/password', AuthControllerRefactored.changePassword);
router.get('/credit-history', AuthControllerRefactored.getCreditHistory);
router.post('/logout', AuthControllerRefactored.logout);

module.exports = router;

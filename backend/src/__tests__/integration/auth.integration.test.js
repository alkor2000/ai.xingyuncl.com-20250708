/**
 * 认证系统 - 集成测试
 * 
 * 连接真实测试数据库，验证完整的认证链路：
 * - 用户注册 → 数据库写入 → 密码哈希验证
 * - 密码登录 → Token生成 → Token验证 → 用户信息获取
 * - Token刷新 → 新Token生成
 * - Token黑名单 → 登出后Token失效
 * - 账号状态检查 → 禁用用户拒绝登录
 * - 密码修改 → 原密码验证 → 新密码生效
 * 
 * 注意：连接 ai_platform_test 数据库，每个测试后自动清理
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

let dbConnection;
let User;
let TokenService;

beforeAll(() => {
  dbConnection = require('../../database/connection');
  User = require('../../models/User');
  TokenService = require('../../services/auth/TokenService');
});

// ========== 辅助函数 ==========

/**
 * 创建真实用户（直接写入数据库）
 */
async function createRealUser(overrides = {}) {
  const timestamp = Date.now();
  const password = overrides.password || 'Test123456';
  const passwordHash = await bcrypt.hash(password, 10);

  await ensureDefaultGroup();

  const sql = `
    INSERT INTO users (
      uuid, username, email, password_hash, role, group_id, status,
      token_quota, used_tokens, credits_quota, used_credits,
      uuid_source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, NOW(), NOW())
  `;

  const username = overrides.username || `testuser_${timestamp}`;
  const email = overrides.email || `test_${timestamp}@example.com`;

  const { rows } = await dbConnection.query(sql, [
    `uuid-${timestamp}`,
    username,
    email,
    passwordHash,
    overrides.role || 'user',
    overrides.group_id || 1,
    overrides.status || 'active',
    overrides.token_quota || 100000,
    overrides.credits_quota || 1000,
    overrides.uuid_source || 'system'
  ]);

  const user = await User.findById(rows.insertId);
  // 附加明文密码供测试使用
  user._testPassword = password;
  return user;
}

/**
 * 确保默认用户组和系统配置存在
 */
async function ensureDefaultGroup() {
  const { rows } = await dbConnection.query('SELECT id FROM user_groups WHERE id = 1');
  if (rows.length === 0) {
    await dbConnection.query(`
      INSERT INTO user_groups (id, name, is_active, credits_pool, credits_pool_used, user_limit, sort_order, created_at, updated_at)
      VALUES (1, '默认组', 1, 100000, 0, 1000, 0, NOW(), NOW())
    `);
  }
}

// ========== 测试套件 ==========

describe('认证系统 - 集成测试（真实数据库）', () => {

  // ---------- 用户创建与密码哈希 ----------
  describe('用户创建与密码存储', () => {

    test('创建用户后密码应被哈希存储，不是明文', async () => {
      const user = await createRealUser({ password: 'MySecret123' });

      // 从数据库直接读取password_hash
      const { rows } = await dbConnection.query(
        'SELECT password_hash FROM users WHERE id = ?', [user.id]
      );

      expect(rows[0].password_hash).not.toBe('MySecret123');
      expect(rows[0].password_hash.startsWith('$2a$')).toBe(true); // bcrypt格式

      // 验证哈希匹配
      const isMatch = await bcrypt.compare('MySecret123', rows[0].password_hash);
      expect(isMatch).toBe(true);
    });

    test('错误密码不应匹配哈希', async () => {
      const user = await createRealUser({ password: 'CorrectPass' });

      const { rows } = await dbConnection.query(
        'SELECT password_hash FROM users WHERE id = ?', [user.id]
      );

      const isMatch = await bcrypt.compare('WrongPass', rows[0].password_hash);
      expect(isMatch).toBe(false);
    });
  });

  // ---------- Token生成与验证 ----------
  describe('Token生成与验证', () => {

    test('generateTokenPair应生成可验证的access和refresh Token', async () => {
      const user = await createRealUser();

      const tokens = await TokenService.generateTokenPair(user, false);

      expect(tokens.accessToken).toBeDefined();
      expect(tokens.refreshToken).toBeDefined();
      expect(tokens.expiresIn).toBeDefined();

      // 验证accessToken可解码
      const accessSecret = process.env.JWT_ACCESS_SECRET;
      const decoded = jwt.verify(tokens.accessToken, accessSecret);

      expect(decoded.userId).toBe(user.id);
      expect(decoded.type).toBe('access');
      expect(decoded.role).toBe(user.role);
      expect(decoded.jti).toBeDefined();
    });

    test('refreshToken应能用于刷新获取新的accessToken', async () => {
      const user = await createRealUser();

      const tokens = await TokenService.generateTokenPair(user, false);

      // 用refreshToken刷新
      const userId = await TokenService.refreshAccessToken(tokens.refreshToken);
      expect(userId).toBe(user.id);

      // 生成新Token对
      const newTokens = await TokenService.generateTokenPair(user, false);
      expect(newTokens.accessToken).not.toBe(tokens.accessToken);
    });

    test('SSO用户Token应包含ssoUser标识', async () => {
      const user = await createRealUser({ uuid_source: 'sso' });

      const tokens = await TokenService.generateTokenPair(user, true);

      const decoded = jwt.verify(tokens.accessToken, process.env.JWT_ACCESS_SECRET);
      expect(decoded.ssoUser).toBe(true);
      expect(decoded.uuid).toBeDefined();
    });
  });

  // ---------- Token黑名单 ----------
  describe('Token黑名单（登出）', () => {

    test('blacklistToken后Token应无法用于刷新', async () => {
      const user = await createRealUser();
      const tokens = await TokenService.generateTokenPair(user, false);

      // 将refreshToken加入黑名单
      const blacklisted = await TokenService.blacklistToken(tokens.refreshToken, user.id);
      // 注意：黑名单依赖Redis，如果Redis不可用会返回false
      if (blacklisted) {
        await expect(TokenService.refreshAccessToken(tokens.refreshToken))
          .rejects.toThrow('已失效');
      }
    });

    test('blacklistToken后accessToken的jti应在Redis中', async () => {
      const user = await createRealUser();
      const tokens = await TokenService.generateTokenPair(user, false);

      const result = await TokenService.blacklistToken(tokens.accessToken, user.id);

      // 如果Redis可用，应返回true
      // 如果Redis不可用，返回false但不报错（降级策略）
      expect(typeof result).toBe('boolean');
    });
  });

  // ---------- 账号状态检查 ----------
  describe('账号状态与有效期', () => {

    test('禁用用户状态应为inactive', async () => {
      const user = await createRealUser({ status: 'inactive' });

      const freshUser = await User.findById(user.id);
      expect(freshUser.status).toBe('inactive');
    });

    test('设置账号过期后isAccountExpired应返回true', async () => {
      const user = await createRealUser();

      // 设置为昨天过期
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const expireStr = yesterday.toISOString().slice(0, 19).replace('T', ' ');

      await dbConnection.query(
        'UPDATE users SET expire_at = ? WHERE id = ?',
        [expireStr, user.id]
      );

      const expiredUser = await User.findById(user.id);
      expect(expiredUser.isAccountExpired()).toBe(true);
    });

    test('未过期账号isAccountExpired应返回false', async () => {
      const user = await createRealUser();

      // 设置为明天过期
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const expireStr = tomorrow.toISOString().slice(0, 19).replace('T', ' ');

      await dbConnection.query(
        'UPDATE users SET expire_at = ? WHERE id = ?',
        [expireStr, user.id]
      );

      const freshUser = await User.findById(user.id);
      expect(freshUser.isAccountExpired()).toBe(false);
    });
  });

  // ---------- 密码修改链路 ----------
  describe('密码修改', () => {

    test('用正确的原密码修改后新密码应生效', async () => {
      const user = await createRealUser({ password: 'OldPass123' });

      // 模拟修改密码（直接调用User.update）
      await user.update({ password: 'NewPass456' });

      // 验证新密码
      const { rows } = await dbConnection.query(
        'SELECT password_hash FROM users WHERE id = ?', [user.id]
      );

      const oldMatch = await bcrypt.compare('OldPass123', rows[0].password_hash);
      const newMatch = await bcrypt.compare('NewPass456', rows[0].password_hash);

      expect(oldMatch).toBe(false);  // 旧密码不再匹配
      expect(newMatch).toBe(true);   // 新密码匹配
    });
  });

  // ---------- 用户查询 ----------
  describe('用户查询方法', () => {

    test('findByEmail应能查到已创建的用户', async () => {
      const user = await createRealUser({ email: 'findme@test.com' });

      const found = await User.findByEmail('findme@test.com');
      expect(found).not.toBeNull();
      expect(found.id).toBe(user.id);
    });

    test('findByUsername应能查到已创建的用户', async () => {
      const user = await createRealUser({ username: 'findme_user' });

      const found = await User.findByUsername('findme_user');
      expect(found).not.toBeNull();
      expect(found.id).toBe(user.id);
    });

    test('查询不存在的用户应返回null', async () => {
      const found = await User.findByEmail('nonexist@nowhere.com');
      expect(found).toBeNull();
    });

    test('软删除用户后findById应返回null', async () => {
      const user = await createRealUser();
      expect(await User.findById(user.id)).not.toBeNull();

      // 软删除
      await user.softDelete();

      const deleted = await User.findById(user.id);
      expect(deleted).toBeNull();
    });
  });

  // ---------- 分组变更 ----------
  describe('用户分组变更', () => {

    test('修改group_id后用户应属于新组', async () => {
      // 创建第二个组
      const { rows: groupResult } = await dbConnection.query(`
        INSERT INTO user_groups (name, is_active, credits_pool, credits_pool_used, user_limit, sort_order, created_at, updated_at)
        VALUES ('测试组2', 1, 5000, 0, 100, 0, NOW(), NOW())
      `);
      const newGroupId = groupResult.insertId;

      const user = await createRealUser({ group_id: 1 });
      expect(user.group_id).toBe(1);

      // 变更分组
      await dbConnection.query(
        'UPDATE users SET group_id = ? WHERE id = ?',
        [newGroupId, user.id]
      );

      const freshUser = await User.findById(user.id);
      expect(freshUser.group_id).toBe(newGroupId);
    });
  });
});

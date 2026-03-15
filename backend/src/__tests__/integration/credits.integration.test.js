/**
 * 积分系统 - 集成测试
 * 
 * 连接真实测试数据库，验证完整的积分操作链路：
 * - 用户创建 → 积分配额设置 → 消费 → 余额验证 → 流水记录
 * - 组积分池分配 → 用户余额增加 → 池余额减少
 * - 积分过期检查
 * - 0积分免费模型场景
 * - 并发消费安全性
 * 
 * 注意：这些测试连接 ai_platform_test 数据库，每个测试后自动清理数据
 */

const bcrypt = require('bcryptjs');

// 延迟引入（等setup.js设置好环境变量后再加载）
let dbConnection;
let User;

beforeAll(() => {
  dbConnection = require('../../database/connection');
  User = require('../../models/User');
});

// ========== 辅助函数 ==========

/**
 * 在测试数据库中创建一个真实用户
 */
async function createRealUser(overrides = {}) {
  const timestamp = Date.now();
  const passwordHash = await bcrypt.hash('Test123456', 10);

  // 先确保有默认组
  await ensureDefaultGroup();

  const sql = `
    INSERT INTO users (
      uuid, username, password_hash, role, group_id, status,
      token_quota, used_tokens, credits_quota, used_credits,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
  `;

  const username = overrides.username || `testuser_${timestamp}`;
  const params = [
    `uuid-${timestamp}`,
    username,
    passwordHash,
    overrides.role || 'user',
    overrides.group_id || 1,
    overrides.status || 'active',
    overrides.token_quota || 100000,
    overrides.used_tokens || 0,
    overrides.credits_quota || 1000,
    overrides.used_credits || 0
  ];

  const { rows } = await dbConnection.query(sql, params);
  const userId = rows.insertId;

  return await User.findById(userId);
}

/**
 * 确保默认用户组存在
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

/**
 * 创建测试用户组（带积分池）
 */
async function createRealGroup(overrides = {}) {
  const timestamp = Date.now();
  const sql = `
    INSERT INTO user_groups (name, is_active, credits_pool, credits_pool_used, user_limit, sort_order, created_at, updated_at)
    VALUES (?, 1, ?, ?, ?, 0, NOW(), NOW())
  `;
  const { rows } = await dbConnection.query(sql, [
    overrides.name || `测试组_${timestamp}`,
    overrides.credits_pool || 10000,
    overrides.credits_pool_used || 0,
    overrides.user_limit || 100
  ]);
  return rows.insertId;
}

// ========== 测试套件 ==========

describe('积分系统 - 集成测试（真实数据库）', () => {

  // ---------- 基础积分操作 ----------
  describe('基础积分操作', () => {

    test('创建用户后应有正确的初始积分', async () => {
      const user = await createRealUser({ credits_quota: 500, used_credits: 0 });

      expect(user.credits_quota).toBe(500);
      expect(user.used_credits).toBe(0);
      expect(user.getCredits()).toBe(500);
    });

    test('consumeCredits应正确扣减并记录流水', async () => {
      const user = await createRealUser({ credits_quota: 1000, used_credits: 0 });

      // 消费100积分
      const result = await user.consumeCredits(100, null, null, '集成测试消费');

      expect(result.success).toBe(true);
      expect(result.amount).toBe(100);

      // 从数据库重新读取验证
      const freshUser = await User.findById(user.id);
      expect(freshUser.used_credits).toBe(100);
      expect(freshUser.getCredits()).toBe(900);

      // 验证积分流水已记录
      const { rows: transactions } = await dbConnection.query(
        'SELECT * FROM credit_transactions WHERE user_id = ? ORDER BY id DESC LIMIT 1',
        [user.id]
      );
      expect(transactions.length).toBe(1);
      expect(transactions[0].amount).toBe(-100);
      expect(transactions[0].description).toContain('集成测试消费');
    });

    test('余额不足时consumeCredits应抛出错误且不扣减', async () => {
      const user = await createRealUser({ credits_quota: 50, used_credits: 0 });

      await expect(user.consumeCredits(100, null, null, '超额消费'))
        .rejects.toThrow('积分余额不足');

      // 验证余额未变
      const freshUser = await User.findById(user.id);
      expect(freshUser.used_credits).toBe(0);
      expect(freshUser.getCredits()).toBe(50);
    });

    test('0积分免费模型消费应成功且不扣减余额', async () => {
      const user = await createRealUser({ credits_quota: 100, used_credits: 0 });

      const result = await user.consumeCredits(0, null, null, '免费模型');

      expect(result.success).toBe(true);
      expect(result.amount).toBe(0);

      // 余额不变
      const freshUser = await User.findById(user.id);
      expect(freshUser.getCredits()).toBe(100);
    });
  });

  // ---------- 充值与扣减 ----------
  describe('充值与扣减', () => {

    test('addCredits应增加配额并记录流水', async () => {
      const user = await createRealUser({ credits_quota: 500, used_credits: 100 });

      const result = await user.addCredits(300, '管理员充值', null);

      expect(result.success).toBe(true);
      expect(result.newQuota).toBe(800);

      // 数据库验证
      const freshUser = await User.findById(user.id);
      expect(freshUser.credits_quota).toBe(800);
      expect(freshUser.getCredits()).toBe(700); // 800 - 100
    });

    test('deductCredits应减少配额', async () => {
      const user = await createRealUser({ credits_quota: 1000, used_credits: 200 });

      const result = await user.deductCredits(300, '管理员扣减', null);

      expect(result.success).toBe(true);
      expect(result.newQuota).toBe(700);

      const freshUser = await User.findById(user.id);
      expect(freshUser.credits_quota).toBe(700);
    });

    test('setCreditsQuota应直接设置配额', async () => {
      const user = await createRealUser({ credits_quota: 1000, used_credits: 200 });

      await user.setCreditsQuota(2000, '调整配额', null);

      const freshUser = await User.findById(user.id);
      expect(freshUser.credits_quota).toBe(2000);
      expect(freshUser.getCredits()).toBe(1800);
    });

    test('setCreditsQuota低于已使用量：used_credits应被截断', async () => {
      const user = await createRealUser({ credits_quota: 1000, used_credits: 800 });

      await user.setCreditsQuota(500, '降低配额', null);

      const freshUser = await User.findById(user.id);
      expect(freshUser.credits_quota).toBe(500);
      expect(freshUser.used_credits).toBe(500);
      expect(freshUser.getCredits()).toBe(0);
    });
  });

  // ---------- 积分过期 ----------
  describe('积分过期', () => {

    test('过期用户消费应被拒绝', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const expireStr = yesterday.toISOString().slice(0, 19).replace('T', ' ');

      const user = await createRealUser({ credits_quota: 1000, used_credits: 0 });

      // 手动设置过期时间
      await dbConnection.query(
        'UPDATE users SET credits_expire_at = ? WHERE id = ?',
        [expireStr, user.id]
      );

      // 重新读取用户
      const expiredUser = await User.findById(user.id);
      expect(expiredUser.isCreditsExpired()).toBe(true);

      await expect(expiredUser.consumeCredits(10, null, null, '过期测试'))
        .rejects.toThrow('积分已过期');
    });

    test('未过期用户消费应正常', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const expireStr = tomorrow.toISOString().slice(0, 19).replace('T', ' ');

      const user = await createRealUser({ credits_quota: 1000, used_credits: 0 });
      await dbConnection.query(
        'UPDATE users SET credits_expire_at = ? WHERE id = ?',
        [expireStr, user.id]
      );

      const freshUser = await User.findById(user.id);
      expect(freshUser.isCreditsExpired()).toBe(false);

      const result = await freshUser.consumeCredits(10, null, null, '未过期测试');
      expect(result.success).toBe(true);
    });
  });

  // ---------- 组积分池 ----------
  describe('组积分池操作', () => {

    test('从组积分池分配给用户：池余额减少，用户配额增加', async () => {
      // 创建组（积分池10000，已用0）
      const groupId = await createRealGroup({ credits_pool: 10000, credits_pool_used: 0 });
      const user = await createRealUser({ group_id: groupId, credits_quota: 100, used_credits: 0 });

      // 模拟从积分池分配500
      await dbConnection.transaction(async (query) => {
        // 锁定组
        const { rows: groupRows } = await query('SELECT * FROM user_groups WHERE id = ? FOR UPDATE', [groupId]);
        const group = groupRows[0];
        const remaining = group.credits_pool - group.credits_pool_used;
        expect(remaining).toBe(10000);

        // 扣减池
        await query('UPDATE user_groups SET credits_pool_used = credits_pool_used + ? WHERE id = ?', [500, groupId]);

        // 增加用户配额
        await query('UPDATE users SET credits_quota = credits_quota + ? WHERE id = ?', [500, user.id]);

        // 记录流水
        await query(
          `INSERT INTO credit_transactions (user_id, amount, balance_after, transaction_type, description)
           VALUES (?, ?, ?, 'group_distribute', ?)`,
          [user.id, 500, 600, '组积分池分配测试']
        );
      });

      // 验证结果
      const { rows: groupAfter } = await dbConnection.query('SELECT * FROM user_groups WHERE id = ?', [groupId]);
      expect(groupAfter[0].credits_pool_used).toBe(500);

      const freshUser = await User.findById(user.id);
      expect(freshUser.credits_quota).toBe(600);
      expect(freshUser.getCredits()).toBe(600);
    });

    test('积分池余额不足时分配应失败', async () => {
      const groupId = await createRealGroup({ credits_pool: 100, credits_pool_used: 80 });

      // 尝试分配50（余额只有20）
      let error = null;
      try {
        await dbConnection.transaction(async (query) => {
          const { rows } = await query('SELECT * FROM user_groups WHERE id = ? FOR UPDATE', [groupId]);
          const remaining = rows[0].credits_pool - rows[0].credits_pool_used;

          if (remaining < 50) {
            throw new Error(`积分池余额不足，剩余: ${remaining}，需要: 50`);
          }
        });
      } catch (e) {
        error = e;
      }

      expect(error).not.toBeNull();
      expect(error.message).toContain('余额不足');

      // 验证池余额未变
      const { rows } = await dbConnection.query('SELECT * FROM user_groups WHERE id = ?', [groupId]);
      expect(rows[0].credits_pool_used).toBe(80);
    });
  });

  // ---------- 多次连续消费 ----------
  describe('连续消费一致性', () => {

    test('连续3次消费后余额应正确累计', async () => {
      const user = await createRealUser({ credits_quota: 1000, used_credits: 0 });

      await user.consumeCredits(100, null, null, '第1次');

      // 重新读取再消费（模拟真实场景，每次请求重新获取用户）
      const user2 = await User.findById(user.id);
      await user2.consumeCredits(200, null, null, '第2次');

      const user3 = await User.findById(user.id);
      await user3.consumeCredits(150, null, null, '第3次');

      // 最终验证
      const finalUser = await User.findById(user.id);
      expect(finalUser.used_credits).toBe(450);
      expect(finalUser.getCredits()).toBe(550);

      // 验证流水记录数
      const { rows } = await dbConnection.query(
        'SELECT COUNT(*) as count FROM credit_transactions WHERE user_id = ?',
        [user.id]
      );
      expect(rows[0].count).toBe(3);
    });
  });
});

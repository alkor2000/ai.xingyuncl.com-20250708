/**
 * 集成测试环境初始化
 * 
 * 职责：
 * 1. 设置环境变量指向测试数据库 ai_platform_test
 * 2. 手动初始化数据库连接池（connection.js是单例需要显式initialize）
 * 3. 每个测试后清理测试数据（保留表结构）
 * 4. 全部测试结束后关闭数据库连接
 * 
 * 安全措施：
 * - 强制检查数据库名必须包含 'test'，防止误连生产库
 * - 只清理数据不删除表结构
 */

// ========== 设置环境变量（必须在require任何源码之前） ==========
process.env.NODE_ENV = 'test';
process.env.DB_NAME = 'ai_platform_test';
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '3306';
process.env.DB_USER = 'ai_user';
process.env.DB_PASSWORD = 'AiPlatform@2025!';
process.env.DB_CONNECTION_LIMIT = '5';
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';
process.env.REDIS_DB = '1';
process.env.REDIS_KEY_PREFIX = 'ai_test:';
process.env.JWT_ACCESS_SECRET = 'integration-test-access-secret-key-32chars!!';
process.env.JWT_REFRESH_SECRET = 'integration-test-refresh-secret-key-32chars!!';

// ========== 全局超时 ==========
jest.setTimeout(30000);

// ========== 安全检查：确保连接的是测试数据库 ==========
const dbName = process.env.DB_NAME;
if (!dbName || !dbName.includes('test')) {
  console.error('❌ 安全检查失败：DB_NAME 必须包含 "test"，当前值:', dbName);
  console.error('   拒绝运行集成测试，防止误操作生产数据库！');
  process.exit(1);
}

// ========== 数据库连接引用（延迟加载） ==========
let dbConnection;

// ========== 全局初始化：启动前连接数据库 ==========
beforeAll(async () => {
  // 此时环境变量已设置，require会读取到测试数据库配置
  dbConnection = require('../../database/connection');

  // 核心修复：手动初始化连接池（connection.js是单例，需要显式调用initialize）
  await dbConnection.initialize();

  // 验证连接的数据库名
  const { rows } = await dbConnection.query('SELECT DATABASE() as db_name');
  const connectedDb = rows[0].db_name;

  if (!connectedDb.includes('test')) {
    console.error(`❌ 连接了错误的数据库: ${connectedDb}`);
    process.exit(1);
  }

  console.log(`✅ 集成测试数据库连接成功: ${connectedDb}`);
});

// ========== 每个测试后清理数据 ==========
afterEach(async () => {
  if (!dbConnection || !dbConnection.isConnected) return;

  try {
    // 暂时禁用外键检查，加速清理
    await dbConnection.query('SET FOREIGN_KEY_CHECKS = 0');

    // 按外键依赖顺序清理（子表先删）
    const cleanupTables = [
      'credit_transactions',
      'billing_logs',
      'messages',
      'files',
      'conversations',
      'module_combination_items',
      'module_combinations',
      'knowledge_module_tag_permissions',
      'knowledge_modules',
      'user_tag_relations',
      'user_tags',
      'ai_model_groups',
      'user_model_restrictions',
      'user_smart_app_favorites',
      'invitation_code_logs',
      'users',
      'user_groups',
      'ai_models',
      'smart_apps',
      'system_settings'
    ];

    for (const table of cleanupTables) {
      try {
        await dbConnection.query(`DELETE FROM \`${table}\``);
      } catch (e) {
        // 忽略不存在的表或其他非关键错误
      }
    }

    await dbConnection.query('SET FOREIGN_KEY_CHECKS = 1');
  } catch (error) {
    console.warn('测试数据清理警告:', error.message);
  }
});

// ========== 全部测试结束后关闭连接 ==========
afterAll(async () => {
  if (!dbConnection) return;

  try {
    // 最终清理所有数据
    await dbConnection.query('SET FOREIGN_KEY_CHECKS = 0');
    const { rows } = await dbConnection.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'ai_platform_test' AND table_type = 'BASE TABLE'"
    );
    for (const row of rows) {
      try {
        await dbConnection.query(`DELETE FROM \`${row.TABLE_NAME || row.table_name}\``);
      } catch (e) {}
    }
    await dbConnection.query('SET FOREIGN_KEY_CHECKS = 1');
  } catch (e) {
    // 清理失败不阻塞
  }

  // 关闭连接池
  try {
    await dbConnection.close();
    console.log('✅ 数据库连接已关闭');
  } catch (e) {
    console.warn('关闭数据库连接警告:', e.message);
  }
});

/**
 * Jest测试环境设置
 */

// 设置测试环境变量
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_ACCESS_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
process.env.PORT = 4001;
process.env.DATABASE_URL = 'mysql://root:password@localhost:3306/ai_platform_test';

// 设置全局超时
jest.setTimeout(10000);

// 清理函数
afterAll(async () => {
  // 关闭数据库连接等清理工作
  const dbConnection = require('../database/connection');
  if (dbConnection && dbConnection.close) {
    await dbConnection.close();
  }
});

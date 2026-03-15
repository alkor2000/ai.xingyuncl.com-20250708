/**
 * Jest集成测试配置文件
 * 
 * 与单元测试的区别：
 * - 连接真实测试数据库 ai_platform_test（不是Mock）
 * - 连接真实Redis（使用独立db=1隔离）
 * - 每个测试前后自动清理测试数据
 * - 超时时间更长（30秒，因为涉及真实IO）
 * - 只匹配 __tests__/integration/ 目录
 * 
 * 运行方式：
 *   npx jest --config jest.integration.config.js --verbose
 */
const path = require('path');

module.exports = {
  testEnvironment: 'node',
  rootDir: path.resolve(__dirname),

  // 只匹配集成测试目录
  testMatch: [
    '**/src/__tests__/integration/**/*.test.js'
  ],

  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/coverage/',
    '/_disabled/'
  ],

  // 集成测试使用独立的setup文件
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/integration/setup.js'],

  // 超时30秒（真实数据库操作较慢）
  testTimeout: 30000,

  // 串行执行（避免数据库并发冲突）
  maxWorkers: 1,

  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },

  verbose: true
};

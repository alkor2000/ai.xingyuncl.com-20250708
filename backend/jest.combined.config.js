/**
 * 合并覆盖率配置
 * 同时运行单元测试和集成测试，生成统一的覆盖率报告
 */
const path = require('path');
module.exports = {
  testEnvironment: 'node',
  rootDir: path.resolve(__dirname),
  // 匹配所有测试（单元+集成）
  testMatch: [
    '**/src/__tests__/**/*.test.js'
  ],
  testPathIgnorePatterns: [
    '/node_modules/', '/dist/', '/_disabled/'
  ],
  // 集成测试的setup会初始化数据库，单元测试的setup设置环境变量
  // 使用集成测试的setup（它兼容两种模式）
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/integration/setup.js'],
  testTimeout: 30000,
  maxWorkers: 1,
  // 覆盖率配置
  collectCoverage: true,
  coverageDirectory: 'coverage-combined',
  coverageReporters: ['text-summary', 'json-summary'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/__tests__/**',
    '!src/app.js',
    '!src/server.js',
    '!src/config/**'
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  verbose: false
};

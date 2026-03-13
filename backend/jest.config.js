/**
 * Jest配置文件
 * 
 * 说明：
 * - 测试文件放在 src/__tests__/ 目录下
 * - setup.js 全局设置环境变量和清理Mock
 * - 各测试文件内自行Mock依赖（更精确）
 * - 覆盖率阈值暂设0%（逐步提升，当前只覆盖积分模块）
 * - _disabled目录存放暂时停用的旧测试
 */

const path = require('path');

module.exports = {
  testEnvironment: 'node',
  rootDir: path.resolve(__dirname),
  
  testMatch: [
    '**/src/__tests__/**/*.test.js',
    '**/src/__tests__/**/*.spec.js'
  ],
  
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/coverage/',
    '/_disabled/'
  ],
  
  collectCoverage: false,
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/__tests__/**',
    '!src/app.js',
    '!src/server.js',
    '!src/config/**'
  ],
  
  coverageThreshold: {
    global: {
      branches: 0,
      functions: 0,
      lines: 0,
      statements: 0
    }
  },
  
  testTimeout: 10000,
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.js'],
  
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  
  verbose: true
};

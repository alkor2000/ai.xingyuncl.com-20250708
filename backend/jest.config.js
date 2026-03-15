/**
 * Jest配置文件（单元测试专用）
 * 
 * 说明：
 * - 测试文件放在 src/__tests__/ 目录下
 * - 排除 integration/ 目录（集成测试使用 jest.integration.config.js）
 * - setup.js 全局设置环境变量和清理Mock
 * - 各测试文件内自行Mock依赖（更精确）
 * - _disabled目录存放暂时停用的旧测试
 * 
 * 运行方式：
 *   npx jest --verbose                                    # 单元测试
 *   npx jest --config jest.integration.config.js --verbose # 集成测试
 */
const path = require('path');
module.exports = {
  testEnvironment: 'node',
  rootDir: path.resolve(__dirname),
  
  testMatch: [
    '**/src/__tests__/**/*.test.js',
    '**/src/__tests__/**/*.spec.js'
  ],
  
  // 排除集成测试目录（由独立配置管理）、禁用目录、依赖目录
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/coverage/',
    '/_disabled/',
    '/integration/'
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

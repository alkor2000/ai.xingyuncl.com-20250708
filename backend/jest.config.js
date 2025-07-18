/**
 * Jest配置文件
 */

module.exports = {
  // 测试环境
  testEnvironment: 'node',
  
  // 测试文件匹配模式
  testMatch: [
    '**/src/__tests__/**/*.test.js',
    '**/src/__tests__/**/*.spec.js'
  ],
  
  // 忽略的目录
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/coverage/'
  ],
  
  // 覆盖率收集
  collectCoverage: true,
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/__tests__/**',
    '!src/app.js',
    '!src/config/**'
  ],
  
  // 覆盖率阈值
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 60,
      lines: 60,
      statements: 60
    }
  },
  
  // 设置超时时间
  testTimeout: 10000,
  
  // 设置测试环境变量
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.js'],
  
  // 模块别名
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  
  // 详细输出
  verbose: true
}

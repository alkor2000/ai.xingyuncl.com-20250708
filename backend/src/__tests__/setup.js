/**
 * Jest测试环境初始化
 * 
 * 职责：
 * 1. 设置环境变量（避免加载.env连接真实数据库）
 * 2. 全局Mock数据库/Redis/日志
 * 3. 每个测试后自动清理Mock
 * 
 * 路径说明：
 * jest.mock() 的路径必须是相对于被测试模块的require路径，
 * 或者使用与源码中require()完全一致的路径。
 * 源码中使用的是相对路径如 '../database/connection'，
 * jest会自动解析到实际模块位置，所以这里用绝对路径格式。
 */

// ========== 设置测试环境变量 ==========
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-jwt-access-secret-key-for-unit-testing-only';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-key-for-unit-testing-only';

// ========== 全局测试超时 ==========
jest.setTimeout(10000);

// ========== 每个测试后清理所有Mock ==========
afterEach(() => {
  jest.clearAllMocks();
});

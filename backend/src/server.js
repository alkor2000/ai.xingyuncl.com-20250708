/**
 * 服务器启动文件
 * 
 * 职责：
 * 1. 加载环境变量
 * 2. 初始化数据库和Redis连接
 * 3. 启动HTTP服务器
 * 4. 处理进程信号（SIGTERM/SIGINT）实现优雅关闭
 * 
 * 注意：所有信号处理器集中在此文件，因为只有这里持有
 * server、数据库连接池和Redis连接的引用
 */

// 首先加载环境变量
require('dotenv').config();

const app = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const dbConnection = require('./database/connection');
const redisConnection = require('./database/redis');
const { setupProcessHandlers } = require('./middleware/errorHandler');

// 设置进程级异常处理（unhandledRejection / uncaughtException）
// 注意：不包含 SIGTERM/SIGINT，这些在下方 startServer 中处理
setupProcessHandlers();

/**
 * 启动服务器
 * 按顺序初始化：数据库 -> Redis -> HTTP Server -> 信号处理
 */
async function startServer() {
  try {
    // 1. 初始化数据库连接（必须成功）
    await dbConnection.initialize();
    logger.info('数据库连接初始化成功');

    // 2. 初始化Redis连接（允许失败，降级运行）
    try {
      await redisConnection.initialize();
      logger.info('Redis连接初始化成功');
    } catch (redisError) {
      logger.error('Redis初始化失败，缓存和Token黑名单功能将不可用:', redisError);
      logger.warn('应用将在没有缓存的情况下运行');
    }

    // 3. 启动HTTP服务器
    const PORT = process.env.PORT || config.app.port || 4000;

    const server = app.listen(PORT, () => {
      logger.info(`服务器启动成功，监听端口: ${PORT}`);
      logger.info(`环境: ${config.app.env}`);
      logger.info(`域名: ${config.app.domain}`);
      logger.info(`Redis状态: ${redisConnection.isConnected ? '已连接' : '未连接（降级模式）'}`);

      // 启动时检查JWT配置状态（不显示实际密钥）
      if (process.env.JWT_ACCESS_SECRET && process.env.JWT_ACCESS_SECRET.length >= 32) {
        logger.info('JWT密钥已从环境变量加载（安全模式）');
      } else {
        logger.warn('警告：JWT密钥未配置或强度不足，请检查环境变量！');
      }
    });

    // 设置HTTP服务器超时（防止连接长时间挂起）
    server.keepAliveTimeout = 65000; // 略高于Nginx的默认60秒
    server.headersTimeout = 66000;   // 略高于keepAliveTimeout

    // 4. 优雅关闭处理
    // 标记是否正在关闭，防止重复执行
    let isShuttingDown = false;

    const gracefulShutdown = async (signal) => {
      if (isShuttingDown) {
        logger.warn(`${signal}: 已在关闭中，忽略重复信号`);
        return;
      }
      isShuttingDown = true;

      logger.info(`收到 ${signal} 信号，开始优雅关闭...`);

      // 设置强制退出超时（10秒），防止关闭流程卡住
      const forceExitTimeout = setTimeout(() => {
        logger.error('优雅关闭超时（10秒），强制退出');
        process.exit(1);
      }, 10000);

      try {
        // 4.1 停止接受新连接
        await new Promise((resolve, reject) => {
          server.close((err) => {
            if (err) {
              logger.error('HTTP服务器关闭出错:', err);
              reject(err);
            } else {
              logger.info('HTTP服务器已关闭，不再接受新连接');
              resolve();
            }
          });
        });

        // 4.2 关闭Redis连接
        if (redisConnection.isConnected) {
          try {
            await redisConnection.close();
            logger.info('Redis连接已关闭');
          } catch (redisErr) {
            logger.error('Redis连接关闭失败:', redisErr);
          }
        }

        // 4.3 关闭数据库连接池
        try {
          await dbConnection.close();
          logger.info('数据库连接已关闭');
        } catch (dbErr) {
          logger.error('数据库连接关闭失败:', dbErr);
        }

        clearTimeout(forceExitTimeout);
        logger.info('优雅关闭完成');
        process.exit(0);
      } catch (error) {
        logger.error('优雅关闭过程中出错:', error);
        clearTimeout(forceExitTimeout);
        process.exit(1);
      }
    };

    // 注册信号处理器
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    logger.error('服务器启动失败:', error);
    process.exit(1);
  }
}

// 启动服务器
startServer();

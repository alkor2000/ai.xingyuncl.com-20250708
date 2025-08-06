/**
 * 服务器启动文件
 */

// 首先加载环境变量
require('dotenv').config();

const app = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const dbConnection = require('./database/connection');
const redisConnection = require('./database/redis');
const { setupProcessHandlers } = require('./middleware/errorHandler');

// 设置进程异常处理
setupProcessHandlers();

// 启动服务器
async function startServer() {
  try {
    // 初始化数据库连接
    await dbConnection.initialize();
    logger.info('数据库连接初始化成功');
    
    // 初始化Redis连接
    try {
      await redisConnection.initialize();
      logger.info('Redis连接初始化成功');
    } catch (redisError) {
      logger.error('Redis初始化失败，缓存功能将不可用:', redisError);
      // Redis失败不影响主服务运行，但记录警告
      logger.warn('应用将在没有缓存的情况下运行');
    }
    
    const PORT = process.env.PORT || config.app.port || 4000;
    
    const server = app.listen(PORT, () => {
      logger.info(`服务器启动成功，监听端口: ${PORT}`);
      logger.info(`环境: ${config.app.env}`);
      logger.info(`域名: ${config.app.domain}`);
      logger.info(`Redis状态: ${redisConnection.isConnected ? '已连接' : '未连接'}`);
      
      // 启动时显示JWT配置状态（不显示实际密钥）
      if (process.env.JWT_ACCESS_SECRET && process.env.JWT_ACCESS_SECRET !== 'your-super-secret-key-2025') {
        logger.info('JWT密钥已从环境变量加载（安全模式）');
      } else {
        logger.warn('警告：使用默认JWT密钥，请配置环境变量！');
      }
    });
    
    // 优雅关闭
    process.on('SIGTERM', async () => {
      logger.info('收到 SIGTERM 信号，开始优雅关闭');
      
      server.close(async () => {
        logger.info('HTTP 服务器已关闭');
        
        try {
          // 关闭Redis连接
          if (redisConnection.isConnected) {
            await redisConnection.close();
            logger.info('Redis连接已关闭');
          }
          
          // 关闭数据库连接
          await dbConnection.close();
          logger.info('数据库连接已关闭');
          
          process.exit(0);
        } catch (error) {
          logger.error('关闭连接失败:', error);
          process.exit(1);
        }
      });
    });
    
    // 处理进程异常退出
    process.on('SIGINT', async () => {
      logger.info('收到 SIGINT 信号');
      process.emit('SIGTERM');
    });
    
  } catch (error) {
    logger.error('服务器启动失败:', error);
    process.exit(1);
  }
}

// 启动服务器
startServer();

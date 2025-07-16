/**
 * 服务器启动文件
 */

const app = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const dbConnection = require('./database/connection');
const { setupProcessHandlers } = require('./middleware/errorHandler');

// 设置进程异常处理
setupProcessHandlers();

// 启动服务器
async function startServer() {
  try {
    // 初始化数据库连接
    await dbConnection.initialize();
    logger.info('数据库连接初始化成功');
    
    const PORT = process.env.PORT || config.app.port || 4000;
    
    const server = app.listen(PORT, () => {
      logger.info(`服务器启动成功，监听端口: ${PORT}`);
      logger.info(`环境: ${config.app.env}`);
      logger.info(`域名: ${config.app.domain}`);
    });

    // 优雅关闭
    process.on('SIGTERM', async () => {
      logger.info('收到 SIGTERM 信号，开始优雅关闭');
      
      server.close(async () => {
        logger.info('HTTP 服务器已关闭');
        
        try {
          await dbConnection.close();
          logger.info('数据库连接已关闭');
          process.exit(0);
        } catch (error) {
          logger.error('关闭数据库连接失败:', error);
          process.exit(1);
        }
      });
    });

  } catch (error) {
    logger.error('服务器启动失败:', error);
    process.exit(1);
  }
}

// 启动服务器
startServer();

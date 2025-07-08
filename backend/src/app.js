/**
 * AI Platform 主应用入口
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const path = require('path');

// 导入配置和工具
const config = require('./config');
const logger = require('./utils/logger');
const dbConnection = require('./database/connection');
const redisConnection = require('./database/redis');

// 导入中间件
const { 
  notFoundHandler, 
  globalErrorHandler, 
  setupProcessHandlers 
} = require('./middleware/errorHandler');

// 导入路由
const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const adminRoutes = require('./routes/admin');
const fileRoutes = require('./routes/file');

class App {
  constructor() {
    this.app = express();
    this.server = null;
  }

  /**
   * 初始化应用
   */
  async initialize() {
    try {
      // 设置进程异常处理
      setupProcessHandlers();

      // 初始化数据库连接
      await this.initializeDatabase();

      // 初始化Redis连接
      await this.initializeRedis();

      // 配置Express中间件
      this.setupMiddleware();

      // 配置路由
      this.setupRoutes();

      // 配置错误处理
      this.setupErrorHandling();

      logger.info('AI Platform应用初始化完成');
    } catch (error) {
      logger.error('应用初始化失败:', error);
      throw error;
    }
  }

  /**
   * 初始化数据库连接
   */
  async initializeDatabase() {
    try {
      await dbConnection.initialize();
      logger.info('数据库连接初始化成功');
    } catch (error) {
      logger.error('数据库连接初始化失败:', error);
      throw error;
    }
  }

  /**
   * 初始化Redis连接
   */
  async initializeRedis() {
    try {
      await redisConnection.initialize();
      logger.info('Redis连接初始化成功');
    } catch (error) {
      logger.warn('Redis连接初始化失败，部分功能可能受影响:', error);
      // Redis连接失败不阻止应用启动，但会记录警告
    }
  }

  /**
   * 配置Express中间件
   */
  setupMiddleware() {
    // 信任代理（用于正确获取客户端IP）
    this.app.set('trust proxy', 1);

    // 安全头部中间件
    this.app.use(helmet(config.security.helmet));

    // CORS跨域中间件
    this.app.use(cors(config.security.cors));

    // Gzip压缩中间件
    this.app.use(compression());

    // Cookie解析中间件
    this.app.use(cookieParser());

    // JSON解析中间件
    this.app.use(express.json({ 
      limit: '10mb',
      type: 'application/json'
    }));

    // URL编码解析中间件
    this.app.use(express.urlencoded({ 
      extended: true, 
      limit: '10mb' 
    }));

    // 静态文件服务（用户上传文件）
    this.app.use('/uploads', express.static(path.join(__dirname, '../../../storage/uploads')));

    // HTTP请求日志中间件
    const morganFormat = config.app.env === 'production' 
      ? 'combined' 
      : 'dev';
    
    this.app.use(morgan(morganFormat, {
      stream: {
        write: (message) => logger.info(message.trim(), { type: 'access' })
      },
      skip: (req, res) => {
        // 跳过健康检查等请求的日志
        return req.url === '/health' || req.url === '/favicon.ico';
      }
    }));

    // 请求ID中间件（用于追踪）
    this.app.use((req, res, next) => {
      req.requestId = Math.random().toString(36).substring(2, 15);
      res.set('X-Request-ID', req.requestId);
      next();
    });

    logger.info('Express中间件配置完成');
  }

  /**
   * 配置路由
   */
  setupRoutes() {
    // 健康检查接口
    this.app.get('/health', (req, res) => {
      const dbStatus = dbConnection.getStatus();
      const redisStatus = redisConnection.getStatus();
      
      res.json({
        success: true,
        message: 'AI Platform服务运行正常',
        data: {
          timestamp: new Date().toISOString(),
          environment: config.app.env,
          version: config.app.version,
          database: dbStatus,
          redis: redisStatus,
          memory: process.memoryUsage(),
          uptime: process.uptime()
        }
      });
    });

    // API根路径信息
    this.app.get('/api', (req, res) => {
      res.json({
        success: true,
        message: 'AI Platform API',
        data: {
          name: config.app.name,
          version: config.app.version,
          environment: config.app.env,
          timestamp: new Date().toISOString()
        }
      });
    });

    // 认证相关路由
    this.app.use('/api/auth', authRoutes);
    
    // AI对话相关路由
    this.app.use('/api/chat', chatRoutes);
    
    // 管理员相关路由
    this.app.use('/api/admin', adminRoutes);
    
    // 文件管理相关路由
    this.app.use('/api/files', fileRoutes);

    logger.info('路由配置完成');
  }

  /**
   * 配置错误处理
   */
  setupErrorHandling() {
    // 404错误处理
    this.app.use(notFoundHandler);

    // 全局错误处理
    this.app.use(globalErrorHandler);

    logger.info('错误处理配置完成');
  }

  /**
   * 启动服务器
   */
  async start() {
    try {
      const port = config.app.port;
      
      this.server = this.app.listen(port, () => {
        logger.info(`AI Platform服务器启动成功`, {
          port,
          environment: config.app.env,
          domain: config.app.domain,
          processId: process.pid
        });
        
        console.log(`
🚀 AI Platform 服务器启动成功!
📡 端口: ${port}
🌍 域名: ${config.app.domain}
🔧 环境: ${config.app.env}
📋 进程ID: ${process.pid}
⏰ 启动时间: ${new Date().toLocaleString()}

API地址: http://localhost:${port}/api
健康检查: http://localhost:${port}/health
        `);
      });

      // 处理服务器错误
      this.server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          logger.error(`端口 ${port} 已被占用`);
        } else {
          logger.error('服务器启动失败:', error);
        }
        process.exit(1);
      });

    } catch (error) {
      logger.error('启动服务器失败:', error);
      process.exit(1);
    }
  }

  /**
   * 优雅关闭服务器
   */
  async shutdown() {
    logger.info('开始优雅关闭服务器...');

    if (this.server) {
      this.server.close(async () => {
        logger.info('HTTP服务器已关闭');

        try {
          // 关闭数据库连接
          await dbConnection.close();
          
          // 关闭Redis连接
          await redisConnection.close();
          
          logger.info('所有连接已关闭，服务器安全退出');
          process.exit(0);
        } catch (error) {
          logger.error('关闭连接时发生错误:', error);
          process.exit(1);
        }
      });
    }
  }

  /**
   * 获取Express应用实例
   */
  getApp() {
    return this.app;
  }
}

// 创建并启动应用
async function bootstrap() {
  const app = new App();
  
  try {
    await app.initialize();
    await app.start();
  } catch (error) {
    logger.error('应用启动失败:', error);
    process.exit(1);
  }
}

// 如果直接运行此文件，则启动应用
if (require.main === module) {
  bootstrap();
}

module.exports = App;

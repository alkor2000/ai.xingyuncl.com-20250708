/**
 * Express 应用程序主文件
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const config = require('./config');
const logger = require('./utils/logger');
const { globalErrorHandler } = require('./middleware/errorHandler');
const HealthCheckService = require('./services/healthCheckService');

// 导入路由
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const chatRoutes = require('./routes/chat');
const statsRoutes = require('./routes/stats');
const publicRoutes = require('./routes/public');
const servicesRoutes = require('./routes/services'); // 新增服务API路由

// 创建 Express 应用
const app = express();

// 信任代理
app.set('trust proxy', 1);

// 安全中间件
app.use(helmet({
  contentSecurityPolicy: false, // 允许内联脚本
  crossOriginEmbedderPolicy: false
}));

// CORS 配置
const corsOrigin = config.app?.corsOrigin || config.security?.cors?.origin || '*';
const corsCredentials = config.security?.cors?.credentials !== false;

app.use(cors({
  origin: corsOrigin,
  credentials: corsCredentials,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Service-ID', 'X-API-Key']
}));

// 请求日志
app.use(morgan('combined', {
  stream: {
    write: (message) => logger.info(message.trim())
  }
}));

// 响应压缩
app.use(compression());

// 请求体解析
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 静态文件服务 - 服务上传的文件
// 修复：正确指向 storage/uploads 目录
app.use('/uploads', express.static(path.join(__dirname, '../../storage/uploads'), {
  maxAge: '7d',
  etag: true,
  lastModified: true
}));

// 全局速率限制
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 1000, // 限制每个IP 1000个请求
  message: {
    success: false,
    code: 429,
    message: '请求过于频繁，请稍后再试',
    data: null,
    timestamp: new Date().toISOString()
  },
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/', globalLimiter);

// 简单健康检查端点（用于负载均衡器）
app.get('/health', async (req, res) => {
  try {
    await HealthCheckService.quickHealthCheck();
    res.json({
      success: true,
      message: 'Service is healthy',
      data: {
        status: 'ok',
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      success: false,
      message: 'Service is unhealthy',
      data: {
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error.message
      }
    });
  }
});

// 详细健康检查端点（用于监控和调试）
app.get('/health/detailed', async (req, res) => {
  try {
    const healthStatus = await HealthCheckService.performHealthCheck();
    const statusCode = healthStatus.status === 'healthy' ? 200 : 503;
    
    res.status(statusCode).json({
      success: healthStatus.status === 'healthy',
      message: `Service is ${healthStatus.status}`,
      data: healthStatus
    });
  } catch (error) {
    logger.error('Detailed health check failed:', error);
    res.status(503).json({
      success: false,
      message: 'Health check failed',
      data: {
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      }
    });
  }
});

// API 路由
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/services', servicesRoutes); // 新增服务API路由

// 404 处理
app.use((req, res) => {
  res.status(404).json({
    success: false,
    code: 404,
    message: '请求的资源不存在',
    data: null,
    timestamp: new Date().toISOString()
  });
});

// 错误处理中间件
app.use(globalErrorHandler);

module.exports = app;

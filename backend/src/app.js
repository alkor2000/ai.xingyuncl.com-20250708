/**
 * Express 应用程序主文件 - 支持动态速率限制
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const path = require('path');
const config = require('./config');
const logger = require('./utils/logger');
const { globalErrorHandler } = require('./middleware/errorHandler');
const HealthCheckService = require('./services/healthCheckService');
const rateLimitService = require('./services/rateLimitService');

// 导入路由
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const chatRoutes = require('./routes/chat');
const statsRoutes = require('./routes/stats');
const publicRoutes = require('./routes/public');
const servicesRoutes = require('./routes/services'); // 新增服务API路由
const knowledgeRoutes = require('./routes/knowledgeRoutes'); // 新增知识模块路由
const imageRoutes = require('./routes/image'); // 新增图像生成路由
const videoRoutes = require('./routes/video'); // 新增视频生成路由
const htmlEditorRoutes = require('./routes/htmlEditor'); // 新增HTML编辑器路由
const storageRoutes = require('./routes/storageRoutes'); // 新增存储管理路由
const mindmapRoutes = require('./routes/mindmapRoutes'); // 新增思维导图路由
const ocrRoutes = require('./routes/ocrRoutes'); // 新增OCR路由
const calendarRoutes = require('./routes/calendar'); // 新增日历路由
const agentRoutes = require('./routes/agent'); // 新增AI工作流路由
const teachingRoutes = require('./routes/teachingRoutes'); // 新增智能教学路由
const smartAppRoutes = require('./routes/smartAppRoutes'); // 新增智能应用路由
const { adminRouter: smartAppAdminRoutes } = require('./routes/smartAppRoutes'); // 智能应用管理路由
const wikiRoutes = require('./routes/wikiRoutes'); // 新增知识库路由

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
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
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

// 动态全局速率限制中间件
const dynamicGlobalRateLimit = async (req, res, next) => {
  try {
    const limiter = await rateLimitService.getLimiter('global');
    limiter(req, res, next);
  } catch (error) {
    logger.error('获取全局速率限制器失败:', error);
    // 失败时继续处理请求，不阻塞
    next();
  }
};

// 应用动态全局速率限制到所有API路由
app.use('/api/', dynamicGlobalRateLimit);

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
app.use('/api/admin/smart-apps', smartAppAdminRoutes); // 智能应用管理路由
app.use('/api/chat', chatRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/services', servicesRoutes); // 新增服务API路由
app.use('/api/knowledge', knowledgeRoutes); // 新增知识模块路由
app.use('/api/image', imageRoutes); // 新增图像生成路由
app.use('/api/video', videoRoutes); // 新增视频生成路由
app.use('/api/html-editor', htmlEditorRoutes); // 新增HTML编辑器路由
app.use('/api/storage', storageRoutes); // 新增存储管理路由
app.use('/api/mindmap', mindmapRoutes); // 新增思维导图路由
app.use('/api/ocr', ocrRoutes); // 新增OCR路由
app.use('/api/calendar', calendarRoutes); // 新增日历路由
app.use('/api/agent', agentRoutes); // 新增AI工作流路由
app.use('/api/teaching', teachingRoutes); // 新增智能教学路由
app.use('/api/smart-apps', smartAppRoutes); // 新增智能应用用户端路由
app.use('/api/wiki', wikiRoutes); // 新增知识库路由

// 公开的HTML页面访问路由（不需要认证）
app.get('/pages/:userId/:slug', require('./controllers/HtmlEditorController').previewPage);

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

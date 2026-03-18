/**
 * Express 应用程序主文件
 * 
 * 职责：
 * 1. 中间件配置（安全、CORS、压缩、解析）
 * 2. 路由注册（20个业务模块 + 外部API + 健康检查 + 公开页面）
 * 3. 全局错误处理
 * 4. 动态速率限制
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
const { authenticate, requireRole } = require('./middleware/authMiddleware');
const HealthCheckService = require('./services/healthCheckService');
const rateLimitService = require('./services/rateLimitService');

/* ============================================================
 * 导入路由模块
 * ============================================================ */
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const chatRoutes = require('./routes/chat');
const statsRoutes = require('./routes/stats');
const publicRoutes = require('./routes/public');
const servicesRoutes = require('./routes/services');
const knowledgeRoutes = require('./routes/knowledgeRoutes');
const imageRoutes = require('./routes/image');
const videoRoutes = require('./routes/video');
const htmlEditorRoutes = require('./routes/htmlEditor');
const storageRoutes = require('./routes/storageRoutes');
const mindmapRoutes = require('./routes/mindmapRoutes');
const ocrRoutes = require('./routes/ocrRoutes');
const calendarRoutes = require('./routes/calendar');
const agentRoutes = require('./routes/agent');
const agentExternalRoutes = require('./routes/agentExternal');
const teachingRoutes = require('./routes/teachingRoutes');
const smartAppRoutes = require('./routes/smartAppRoutes');
const { adminRouter: smartAppAdminRoutes } = require('./routes/smartAppRoutes');
const wikiRoutes = require('./routes/wikiRoutes');
const forumRoutes = require('./routes/forum');

/* 创建 Express 应用 */
const app = express();

/* ============================================================
 * 基础中间件配置
 * ============================================================ */

/* 信任第一层代理（Nginx），使 req.ip 获取真实客户端IP */
app.set('trust proxy', 1);

/* 安全HTTP头 */
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

/* ============================================================
 * CORS 跨域配置
 * 
 * Agent外部API（/api/v1/agent）单独配置宽松CORS：
 *   - 允许任意origin（包括file://协议的null origin）
 *   - 该路由使用API Key认证，不依赖Cookie/Session
 *   - 适用于本地HTML文件、第三方网站、Postman等场景
 * 
 * 其他所有路由使用白名单CORS策略
 * ============================================================ */

/* Agent外部API - 宽松CORS（允许任意来源） */
app.use('/api/v1/agent', cors({
  origin: true,                   // 允许任意origin，自动回显请求的Origin头
  credentials: false,             // API Key认证，不需要Cookie凭证
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  maxAge: 86400                   // preflight缓存24小时，减少OPTIONS请求
}));

/* 其他路由 - 白名单CORS */
const corsOrigin = config.app?.corsOrigin || config.security?.cors?.origin || '*';
const corsCredentials = config.security?.cors?.credentials !== false;

app.use(cors({
  origin: corsOrigin,
  credentials: corsCredentials,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Service-ID', 'X-API-Key']
}));

/* 请求日志（Morgan -> Winston） */
app.use(morgan('combined', {
  stream: {
    write: (message) => logger.info(message.trim())
  }
}));

/* 响应压缩 */
app.use(compression());

/* 请求体解析（10MB限制） */
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/* 静态文件服务 */
app.use('/uploads', express.static(path.join(__dirname, '../../storage/uploads'), {
  maxAge: '7d',
  etag: true,
  lastModified: true
}));

/* ============================================================
 * 动态全局速率限制
 * ============================================================ */
const dynamicGlobalRateLimit = async (req, res, next) => {
  try {
    const limiter = await rateLimitService.getLimiter('global');
    limiter(req, res, next);
  } catch (error) {
    logger.error('获取全局速率限制器失败:', error);
    next();
  }
};

app.use('/api/', dynamicGlobalRateLimit);

/* ============================================================
 * 健康检查端点
 * ============================================================ */

/* 简单健康检查 - 无需认证 */
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

/* 详细健康检查 - 需要管理员认证 */
app.get('/health/detailed', authenticate, requireRole(['super_admin', 'admin']), async (req, res) => {
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

/* ============================================================
 * API 路由注册
 * ============================================================ */

/* 认证与管理 */
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/smart-apps', smartAppAdminRoutes);

/* 核心业务 */
app.use('/api/chat', chatRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/services', servicesRoutes);
app.use('/api/knowledge', knowledgeRoutes);

/* AI生成 */
app.use('/api/image', imageRoutes);
app.use('/api/video', videoRoutes);

/* 工具模块 */
app.use('/api/html-editor', htmlEditorRoutes);
app.use('/api/storage', storageRoutes);
app.use('/api/mindmap', mindmapRoutes);
app.use('/api/ocr', ocrRoutes);
app.use('/api/calendar', calendarRoutes);

/* 高级功能 */
app.use('/api/agent', agentRoutes);
app.use('/api/teaching', teachingRoutes);
app.use('/api/smart-apps', smartAppRoutes);
app.use('/api/wiki', wikiRoutes);
app.use('/api/forum', forumRoutes);

/* 外部API（Agent工作流对外接口，使用API Key认证） */
app.use('/api/v1/agent', agentExternalRoutes);

/* ============================================================
 * 公开页面路由（无需认证）
 * ============================================================ */
app.get('/pages/:userId/:slug', require('./controllers/HtmlEditorController').previewPage);

/* ============================================================
 * 错误处理
 * ============================================================ */

/* 404 处理 */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    code: 404,
    message: '请求的资源不存在',
    data: null,
    timestamp: new Date().toISOString()
  });
});

/* 全局错误处理中间件 */
app.use(globalErrorHandler);

module.exports = app;

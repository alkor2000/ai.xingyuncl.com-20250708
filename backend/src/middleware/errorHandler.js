/**
 * 全局错误处理中间件
 * 
 * 职责：
 * 1. 全局错误捕获和分类处理
 * 2. 异步错误包装器
 * 3. 进程级异常处理（unhandledRejection/uncaughtException）
 * 
 * 注意：SIGTERM/SIGINT 信号处理由 server.js 负责，
 * 因为只有 server.js 持有 HTTP server 和数据库/Redis 连接的引用，
 * 能够执行完整的优雅关闭流程。本文件不再注册信号处理器以避免冲突。
 */

const logger = require('../utils/logger');
const ResponseHelper = require('../utils/response');
const { AppError } = require('../utils/errors');

/**
 * 需要从日志中过滤的敏感字段名列表
 * 防止密码、密钥等敏感信息被写入日志文件
 */
const SENSITIVE_FIELDS = [
  'password', 'new_password', 'old_password', 'confirm_password',
  'api_key', 'api_secret', 'secret', 'secret_key',
  'access_key', 'accessKeySecret', 'accessKeyId',
  'token', 'refresh_token', 'access_token',
  'jwt_secret', 'jwt_access_secret', 'jwt_refresh_secret',
  'credit_card', 'card_number', 'cvv',
  'smtp_pass', 'smtp_password'
];

/**
 * 过滤请求体中的敏感字段
 * 将敏感字段的值替换为 [FILTERED]，防止泄露到日志
 * 
 * @param {Object} body - 请求体对象
 * @returns {Object} - 过滤后的请求体（浅拷贝，不修改原对象）
 */
function filterSensitiveData(body) {
  if (!body || typeof body !== 'object') {
    return body;
  }

  const filtered = { ...body };
  for (const key of Object.keys(filtered)) {
    // 检查字段名是否匹配敏感字段（不区分大小写）
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_FIELDS.some(field => lowerKey.includes(field))) {
      filtered[key] = '[FILTERED]';
    }
  }
  return filtered;
}

/**
 * 全局错误处理中间件
 * 
 * 按错误类型分类处理，返回适当的HTTP状态码和消息
 * 生产环境隐藏具体错误堆栈，开发环境返回详细信息
 */
function globalErrorHandler(err, req, res, next) {
  // 如果响应已经发送，则交给Express默认处理
  if (res.headersSent) {
    return next(err);
  }

  // 记录错误日志（过滤敏感字段）
  logger.error('全局错误捕获', {
    error: err.message,
    stack: err.stack,
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    body: filterSensitiveData(req.body),
    query: req.query,
    params: req.params
  });

  // 处理已知的应用错误
  if (err instanceof AppError) {
    return ResponseHelper.error(res, err.message, err.statusCode);
  }

  // 处理JWT相关错误
  if (err.name === 'JsonWebTokenError') {
    return ResponseHelper.unauthorized(res, '无效的令牌');
  }

  if (err.name === 'TokenExpiredError') {
    return ResponseHelper.unauthorized(res, '令牌已过期');
  }

  // 处理数据库相关错误
  if (err.code === 'ER_DUP_ENTRY') {
    return ResponseHelper.error(res, '数据已存在', 409);
  }

  if (err.code === 'ER_NO_REFERENCED_ROW_2') {
    return ResponseHelper.error(res, '关联数据不存在', 400);
  }

  // 处理Joi验证错误
  if (err.name === 'ValidationError' && err.details) {
    const validationErrors = err.details.map(detail => detail.message);
    return ResponseHelper.validation(res, validationErrors, '数据验证失败');
  }

  // 处理Multer文件上传错误
  if (err.code === 'LIMIT_FILE_SIZE') {
    return ResponseHelper.error(res, '文件大小超出限制', 400);
  }

  if (err.code === 'LIMIT_FILE_COUNT') {
    return ResponseHelper.error(res, '文件数量超出限制', 400);
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return ResponseHelper.error(res, '不允许的文件字段', 400);
  }

  // 处理语法错误（如无效的JSON请求体）
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return ResponseHelper.error(res, 'JSON格式错误', 400);
  }

  // 处理速率限制错误
  if (err.status === 429) {
    return ResponseHelper.error(res, '请求过于频繁，请稍后再试', 429);
  }

  // 生产环境隐藏具体错误信息，防止泄露内部实现细节
  if (process.env.NODE_ENV === 'production') {
    return ResponseHelper.error(res, '服务器内部错误', 500);
  } else {
    // 开发环境返回详细错误信息便于调试
    return ResponseHelper.error(res, err.message || '服务器内部错误', 500, {
      stack: err.stack,
      type: err.constructor.name
    });
  }
}

/**
 * 异步错误处理包装器
 * 
 * 包装 async 路由处理函数，自动捕获 Promise rejection 并传递给错误中间件
 * 使用方式：router.get('/path', asyncHandler(async (req, res) => { ... }))
 * 
 * @param {Function} fn - async 路由处理函数
 * @returns {Function} - 包装后的路由处理函数
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * 进程级异常处理
 * 
 * 只处理 unhandledRejection 和 uncaughtException
 * SIGTERM/SIGINT 信号由 server.js 负责处理（因为它持有 server/db/redis 引用）
 */
function setupProcessHandlers() {
  // 处理未捕获的Promise异常
  // 记录错误但不立即退出，避免中断正在处理的请求
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('未处理的Promise异常:', {
      reason: reason instanceof Error ? { message: reason.message, stack: reason.stack } : reason
    });
    // 注意：不再直接 process.exit(1)
    // PM2 的 max_restarts 配置已提供进程级别的保护
    // 如果需要在持续错误时退出，应通过健康检查机制来处理
  });

  // 处理未捕获的同步异常
  // 这类错误通常意味着程序状态不可预测，必须退出
  process.on('uncaughtException', (err) => {
    logger.error('未捕获的异常（进程将退出）:', {
      message: err.message,
      stack: err.stack,
      name: err.name
    });
    console.error('UNCAUGHT EXCEPTION! Shutting down...');
    // uncaughtException 后进程状态不可信，必须退出
    // PM2 会自动重启进程
    process.exit(1);
  });

  // 注意：SIGTERM 和 SIGINT 的处理已移至 server.js
  // server.js 持有 HTTP server、数据库连接池和 Redis 连接的引用
  // 能够执行完整的优雅关闭流程：关闭HTTP→关闭Redis→关闭数据库→退出
}

module.exports = {
  globalErrorHandler,
  asyncHandler,
  setupProcessHandlers
};

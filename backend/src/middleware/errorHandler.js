/**
 * 全局错误处理中间件
 */

const logger = require('../utils/logger');
const ResponseHelper = require('../utils/response');
const { AppError } = require('../utils/errors');

/**
 * 404错误处理中间件
 */
function notFoundHandler(req, res, next) {
  logger.warn('404 Not Found', { 
    method: req.method, 
    url: req.url, 
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  
  return ResponseHelper.notFound(res, `路由 ${req.method} ${req.url} 不存在`);
}

/**
 * 全局错误处理中间件
 */
function globalErrorHandler(err, req, res, next) {
  // 如果响应已经发送，则交给Express默认处理
  if (res.headersSent) {
    return next(err);
  }

  // 记录错误日志
  logger.error('全局错误捕获', {
    error: err.message,
    stack: err.stack,
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    body: req.body,
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

  // 处理语法错误
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return ResponseHelper.error(res, 'JSON格式错误', 400);
  }

  // 处理速率限制错误
  if (err.status === 429) {
    return ResponseHelper.error(res, '请求过于频繁，请稍后再试', 429);
  }

  // 生产环境隐藏具体错误信息
  if (process.env.NODE_ENV === 'production') {
    return ResponseHelper.error(res, '服务器内部错误', 500);
  } else {
    // 开发环境返回详细错误信息
    return ResponseHelper.error(res, err.message || '服务器内部错误', 500, {
      stack: err.stack,
      type: err.constructor.name
    });
  }
}

/**
 * 异步错误处理包装器
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * 进程异常处理
 */
function setupProcessHandlers() {
  // 处理未捕获的Promise异常
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('未处理的Promise异常:', { reason, promise });
    // 在生产环境中，可能需要优雅地关闭服务器
    if (process.env.NODE_ENV === 'production') {
      console.error('UNHANDLED PROMISE REJECTION! Shutting down...');
      process.exit(1);
    }
  });

  // 处理未捕获的异常
  process.on('uncaughtException', (err) => {
    logger.error('未捕获的异常:', err);
    console.error('UNCAUGHT EXCEPTION! Shutting down...');
    process.exit(1);
  });

  // 处理SIGTERM信号（优雅关闭）
  process.on('SIGTERM', () => {
    logger.info('收到SIGTERM信号，开始优雅关闭...');
    // 这里可以添加清理逻辑
    process.exit(0);
  });

  // 处理SIGINT信号（Ctrl+C）
  process.on('SIGINT', () => {
    logger.info('收到SIGINT信号，开始优雅关闭...');
    // 这里可以添加清理逻辑
    process.exit(0);
  });
}

module.exports = {
  notFoundHandler,
  globalErrorHandler,
  asyncHandler,
  setupProcessHandlers
};

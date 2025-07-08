/**
 * 自定义错误类和错误处理中间件
 */

/**
 * 应用基础错误类
 */
class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.name = this.constructor.name;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 验证错误
 */
class ValidationError extends AppError {
  constructor(message = 'Validation Failed', errors = []) {
    super(message, 400);
    this.errors = errors;
  }
}

/**
 * 认证错误
 */
class AuthenticationError extends AppError {
  constructor(message = 'Authentication Failed') {
    super(message, 401);
  }
}

/**
 * 授权错误
 */
class AuthorizationError extends AppError {
  constructor(message = 'Access Denied') {
    super(message, 403);
  }
}

/**
 * 资源未找到错误
 */
class NotFoundError extends AppError {
  constructor(message = 'Resource Not Found') {
    super(message, 404);
  }
}

/**
 * 冲突错误
 */
class ConflictError extends AppError {
  constructor(message = 'Resource Conflict') {
    super(message, 409);
  }
}

/**
 * 限流错误
 */
class RateLimitError extends AppError {
  constructor(message = 'Too Many Requests') {
    super(message, 429);
  }
}

/**
 * 数据库错误
 */
class DatabaseError extends AppError {
  constructor(message = 'Database Error', originalError = null) {
    super(message, 500);
    this.originalError = originalError;
  }
}

/**
 * 外部服务错误
 */
class ExternalServiceError extends AppError {
  constructor(message = 'External Service Error', service = 'unknown') {
    super(message, 503);
    this.service = service;
  }
}

module.exports = {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  DatabaseError,
  ExternalServiceError
};

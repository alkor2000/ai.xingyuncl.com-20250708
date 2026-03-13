/**
 * 自定义错误类体系 - 单元测试
 * 
 * 测试范围：
 * - AppError           基础错误类（statusCode、isOperational、堆栈捕获）
 * - ValidationError    验证错误（400、errors数组）
 * - AuthenticationError 认证错误（401）
 * - AuthorizationError  授权错误（403）
 * - NotFoundError      资源未找到（404）
 * - ConflictError      冲突错误（409）
 * - RateLimitError     限流错误（429）
 * - DatabaseError      数据库错误（500、originalError）
 * - ExternalServiceError 外部服务错误（503、service字段）
 * 
 * Mock策略：无外部依赖，纯逻辑测试
 */

const {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  DatabaseError,
  ExternalServiceError
} = require('../../../utils/errors');

describe('自定义错误类体系', () => {

  // ---------- AppError 基础类 ----------
  describe('AppError - 基础错误类', () => {
    test('应继承自Error', () => {
      const err = new AppError('测试错误');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(AppError);
    });

    test('默认statusCode应为500', () => {
      const err = new AppError('服务器错误');
      expect(err.statusCode).toBe(500);
    });

    test('应支持自定义statusCode', () => {
      const err = new AppError('自定义错误', 418);
      expect(err.statusCode).toBe(418);
    });

    test('默认isOperational应为true', () => {
      const err = new AppError('操作错误');
      expect(err.isOperational).toBe(true);
    });

    test('应支持设置isOperational为false', () => {
      const err = new AppError('系统错误', 500, false);
      expect(err.isOperational).toBe(false);
    });

    test('name应为类名AppError', () => {
      const err = new AppError('测试');
      expect(err.name).toBe('AppError');
    });

    test('应有堆栈信息', () => {
      const err = new AppError('堆栈测试');
      expect(err.stack).toBeDefined();
      expect(err.stack).toContain('AppError');
    });

    test('message应正确设置', () => {
      const err = new AppError('具体错误信息');
      expect(err.message).toBe('具体错误信息');
    });
  });

  // ---------- ValidationError ----------
  describe('ValidationError - 验证错误', () => {
    test('statusCode应为400', () => {
      const err = new ValidationError('验证失败');
      expect(err.statusCode).toBe(400);
    });

    test('默认message应为Validation Failed', () => {
      const err = new ValidationError();
      expect(err.message).toBe('Validation Failed');
    });

    test('应支持errors数组', () => {
      const errors = [{ field: 'email', message: '格式错误' }];
      const err = new ValidationError('表单验证失败', errors);
      expect(err.errors).toEqual(errors);
    });

    test('默认errors应为空数组', () => {
      const err = new ValidationError('失败');
      expect(err.errors).toEqual([]);
    });

    test('name应为ValidationError', () => {
      const err = new ValidationError();
      expect(err.name).toBe('ValidationError');
    });

    test('应继承自AppError', () => {
      const err = new ValidationError();
      expect(err).toBeInstanceOf(AppError);
    });
  });

  // ---------- AuthenticationError ----------
  describe('AuthenticationError - 认证错误', () => {
    test('statusCode应为401', () => {
      const err = new AuthenticationError('未登录');
      expect(err.statusCode).toBe(401);
    });

    test('默认message应为Authentication Failed', () => {
      const err = new AuthenticationError();
      expect(err.message).toBe('Authentication Failed');
    });

    test('name应为AuthenticationError', () => {
      const err = new AuthenticationError();
      expect(err.name).toBe('AuthenticationError');
    });
  });

  // ---------- AuthorizationError ----------
  describe('AuthorizationError - 授权错误', () => {
    test('statusCode应为403', () => {
      const err = new AuthorizationError();
      expect(err.statusCode).toBe(403);
    });

    test('默认message应为Access Denied', () => {
      const err = new AuthorizationError();
      expect(err.message).toBe('Access Denied');
    });
  });

  // ---------- NotFoundError ----------
  describe('NotFoundError - 资源未找到', () => {
    test('statusCode应为404', () => {
      const err = new NotFoundError();
      expect(err.statusCode).toBe(404);
    });

    test('支持自定义message', () => {
      const err = new NotFoundError('用户不存在');
      expect(err.message).toBe('用户不存在');
    });
  });

  // ---------- ConflictError ----------
  describe('ConflictError - 冲突错误', () => {
    test('statusCode应为409', () => {
      const err = new ConflictError();
      expect(err.statusCode).toBe(409);
    });
  });

  // ---------- RateLimitError ----------
  describe('RateLimitError - 限流错误', () => {
    test('statusCode应为429', () => {
      const err = new RateLimitError();
      expect(err.statusCode).toBe(429);
    });

    test('默认message应为Too Many Requests', () => {
      const err = new RateLimitError();
      expect(err.message).toBe('Too Many Requests');
    });
  });

  // ---------- DatabaseError ----------
  describe('DatabaseError - 数据库错误', () => {
    test('statusCode应为500', () => {
      const err = new DatabaseError();
      expect(err.statusCode).toBe(500);
    });

    test('应保存originalError', () => {
      const original = new Error('ECONNREFUSED');
      const err = new DatabaseError('数据库连接失败', original);
      expect(err.originalError).toBe(original);
    });

    test('originalError默认为null', () => {
      const err = new DatabaseError('数据库错误');
      expect(err.originalError).toBeNull();
    });
  });

  // ---------- ExternalServiceError ----------
  describe('ExternalServiceError - 外部服务错误', () => {
    test('statusCode应为503', () => {
      const err = new ExternalServiceError();
      expect(err.statusCode).toBe(503);
    });

    test('应保存service名称', () => {
      const err = new ExternalServiceError('OpenAI服务异常', 'openai');
      expect(err.service).toBe('openai');
    });

    test('默认service应为unknown', () => {
      const err = new ExternalServiceError('服务异常');
      expect(err.service).toBe('unknown');
    });
  });

  // ---------- 跨类验证 ----------
  describe('错误类型识别 - instanceof检查', () => {
    test('所有子类都应是AppError的实例', () => {
      expect(new ValidationError()).toBeInstanceOf(AppError);
      expect(new AuthenticationError()).toBeInstanceOf(AppError);
      expect(new AuthorizationError()).toBeInstanceOf(AppError);
      expect(new NotFoundError()).toBeInstanceOf(AppError);
      expect(new ConflictError()).toBeInstanceOf(AppError);
      expect(new RateLimitError()).toBeInstanceOf(AppError);
      expect(new DatabaseError()).toBeInstanceOf(AppError);
      expect(new ExternalServiceError()).toBeInstanceOf(AppError);
    });

    test('所有子类都应是Error的实例', () => {
      expect(new ValidationError()).toBeInstanceOf(Error);
      expect(new DatabaseError()).toBeInstanceOf(Error);
    });

    test('不同子类之间不应互相匹配', () => {
      const err = new ValidationError();
      expect(err).not.toBeInstanceOf(AuthenticationError);
      expect(err).not.toBeInstanceOf(NotFoundError);
    });
  });
});

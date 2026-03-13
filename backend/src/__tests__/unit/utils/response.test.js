/**
 * ResponseHelper - 统一响应工具单元测试
 * 
 * 测试范围：
 * - success()     成功响应（200、自定义code）
 * - error()       失败响应（500、自定义code）
 * - validation()  验证失败（400）
 * - unauthorized() 未授权（401）
 * - forbidden()   禁止访问（403）
 * - notFound()    资源未找到（404）
 * - paginated()   分页响应（pagination计算）
 * 
 * Mock策略：无外部依赖，使用Mock的res对象验证调用
 */

const ResponseHelper = require('../../../utils/response');

// ========== 辅助函数 ==========

/**
 * 创建Mock响应对象
 */
function createMockRes() {
  const res = {
    statusCode: null,
    responseData: null,
    status: jest.fn(function(code) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(function(data) {
      this.responseData = data;
      return this;
    })
  };
  return res;
}

// ========== 测试套件 ==========

describe('ResponseHelper - 统一响应格式', () => {

  // ---------- success() 测试 ----------
  describe('success() - 成功响应', () => {
    test('默认参数：statusCode=200, success=true', () => {
      const res = createMockRes();
      ResponseHelper.success(res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.responseData.success).toBe(true);
      expect(res.responseData.code).toBe(200);
      expect(res.responseData.message).toBe('Success');
      expect(res.responseData.data).toBeNull();
      expect(res.responseData.timestamp).toBeDefined();
    });

    test('应正确传递data和message', () => {
      const res = createMockRes();
      const data = { id: 1, name: '测试' };
      ResponseHelper.success(res, data, '操作成功');

      expect(res.responseData.data).toEqual(data);
      expect(res.responseData.message).toBe('操作成功');
    });

    test('应支持自定义状态码201', () => {
      const res = createMockRes();
      ResponseHelper.success(res, null, '创建成功', 201);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.responseData.code).toBe(201);
    });

    test('timestamp应为ISO格式', () => {
      const res = createMockRes();
      ResponseHelper.success(res);

      const timestamp = res.responseData.timestamp;
      expect(new Date(timestamp).toISOString()).toBe(timestamp);
    });
  });

  // ---------- error() 测试 ----------
  describe('error() - 失败响应', () => {
    test('默认参数：statusCode=500, success=false', () => {
      const res = createMockRes();
      ResponseHelper.error(res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.responseData.success).toBe(false);
      expect(res.responseData.message).toBe('Internal Server Error');
    });

    test('应支持自定义错误码和消息', () => {
      const res = createMockRes();
      ResponseHelper.error(res, '数据库连接失败', 503);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.responseData.message).toBe('数据库连接失败');
      expect(res.responseData.code).toBe(503);
    });

    test('应支持传递data', () => {
      const res = createMockRes();
      const errorData = { field: 'email' };
      ResponseHelper.error(res, '错误', 500, errorData);

      expect(res.responseData.data).toEqual(errorData);
    });
  });

  // ---------- validation() 测试 ----------
  describe('validation() - 验证失败', () => {
    test('statusCode应为400', () => {
      const res = createMockRes();
      ResponseHelper.validation(res, []);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.responseData.success).toBe(false);
    });

    test('应将errors放入data.errors', () => {
      const res = createMockRes();
      const errors = [
        { field: 'email', message: '邮箱格式错误' },
        { field: 'password', message: '密码太短' }
      ];
      ResponseHelper.validation(res, errors);

      expect(res.responseData.data.errors).toEqual(errors);
    });

    test('应支持自定义message', () => {
      const res = createMockRes();
      ResponseHelper.validation(res, [], '表单验证不通过');

      expect(res.responseData.message).toBe('表单验证不通过');
    });
  });

  // ---------- unauthorized() 测试 ----------
  describe('unauthorized() - 未授权', () => {
    test('statusCode应为401', () => {
      const res = createMockRes();
      ResponseHelper.unauthorized(res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.responseData.code).toBe(401);
      expect(res.responseData.data).toBeNull();
    });

    test('应支持自定义消息', () => {
      const res = createMockRes();
      ResponseHelper.unauthorized(res, 'Token已过期');

      expect(res.responseData.message).toBe('Token已过期');
    });
  });

  // ---------- forbidden() 测试 ----------
  describe('forbidden() - 禁止访问', () => {
    test('statusCode应为403', () => {
      const res = createMockRes();
      ResponseHelper.forbidden(res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.responseData.code).toBe(403);
    });
  });

  // ---------- notFound() 测试 ----------
  describe('notFound() - 资源未找到', () => {
    test('statusCode应为404', () => {
      const res = createMockRes();
      ResponseHelper.notFound(res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.responseData.message).toBe('Resource Not Found');
    });

    test('应支持自定义消息', () => {
      const res = createMockRes();
      ResponseHelper.notFound(res, '用户不存在');

      expect(res.responseData.message).toBe('用户不存在');
    });
  });

  // ---------- paginated() 测试 ----------
  describe('paginated() - 分页响应', () => {
    test('应正确计算分页信息', () => {
      const res = createMockRes();
      const data = [{ id: 1 }, { id: 2 }];
      const pagination = { page: 1, limit: 20, total: 50 };

      ResponseHelper.paginated(res, data, pagination);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.responseData.success).toBe(true);
      expect(res.responseData.data).toEqual(data);
      expect(res.responseData.pagination.page).toBe(1);
      expect(res.responseData.pagination.limit).toBe(20);
      expect(res.responseData.pagination.total).toBe(50);
      expect(res.responseData.pagination.totalPages).toBe(3);
      expect(res.responseData.pagination.hasNext).toBe(true);
      expect(res.responseData.pagination.hasPrev).toBe(false);
    });

    test('最后一页：hasNext应为false', () => {
      const res = createMockRes();
      ResponseHelper.paginated(res, [], { page: 3, limit: 20, total: 50 });

      expect(res.responseData.pagination.hasNext).toBe(false);
      expect(res.responseData.pagination.hasPrev).toBe(true);
    });

    test('只有一页：hasNext和hasPrev都为false', () => {
      const res = createMockRes();
      ResponseHelper.paginated(res, [], { page: 1, limit: 20, total: 5 });

      expect(res.responseData.pagination.totalPages).toBe(1);
      expect(res.responseData.pagination.hasNext).toBe(false);
      expect(res.responseData.pagination.hasPrev).toBe(false);
    });

    test('空数据：total=0, totalPages=0', () => {
      const res = createMockRes();
      ResponseHelper.paginated(res, [], { page: 1, limit: 20, total: 0 });

      expect(res.responseData.pagination.totalPages).toBe(0);
      expect(res.responseData.pagination.hasNext).toBe(false);
    });

    test('total不能被limit整除：totalPages应向上取整', () => {
      const res = createMockRes();
      ResponseHelper.paginated(res, [], { page: 1, limit: 20, total: 41 });

      expect(res.responseData.pagination.totalPages).toBe(3);
    });
  });
});

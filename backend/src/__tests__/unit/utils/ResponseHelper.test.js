/**
 * ResponseHelper 单元测试
 */

const ResponseHelper = require('../../../utils/response');
const { mockResponse } = require('../../utils/testHelpers');

describe('ResponseHelper', () => {
  let res;
  
  beforeEach(() => {
    res = mockResponse();
  });
  
  describe('success', () => {
    it('应该返回成功响应格式', () => {
      const data = { id: 1, name: 'test' };
      const message = '操作成功';
      
      ResponseHelper.success(res, data, message);
      
      expect(res.statusCode).toBe(200);
      expect(res.data).toMatchObject({
        success: true,
        code: 200,
        message,
        data
      });
      expect(res.data.timestamp).toBeDefined();
    });
    
    it('应该支持自定义状态码', () => {
      ResponseHelper.success(res, null, '创建成功', 201);
      
      expect(res.statusCode).toBe(201);
      expect(res.data.code).toBe(201);
    });
  });
  
  describe('error', () => {
    it('应该返回错误响应格式', () => {
      const message = '服务器错误';
      
      ResponseHelper.error(res, message);
      
      expect(res.statusCode).toBe(500);
      expect(res.data).toMatchObject({
        success: false,
        code: 500,
        message,
        data: null
      });
    });
    
    it('应该支持自定义错误码', () => {
      ResponseHelper.error(res, 'Bad Request', 400);
      
      expect(res.statusCode).toBe(400);
      expect(res.data.code).toBe(400);
    });
  });
  
  describe('validation', () => {
    it('应该返回验证失败响应', () => {
      const errors = [
        { field: 'email', message: '邮箱格式无效' },
        { field: 'password', message: '密码太短' }
      ];
      
      ResponseHelper.validation(res, errors);
      
      expect(res.statusCode).toBe(400);
      expect(res.data).toMatchObject({
        success: false,
        code: 400,
        message: 'Validation Failed',
        data: { errors }
      });
    });
  });
  
  describe('unauthorized', () => {
    it('应该返回401响应', () => {
      ResponseHelper.unauthorized(res);
      
      expect(res.statusCode).toBe(401);
      expect(res.data.code).toBe(401);
      expect(res.data.message).toBe('Unauthorized');
    });
  });
  
  describe('forbidden', () => {
    it('应该返回403响应', () => {
      ResponseHelper.forbidden(res);
      
      expect(res.statusCode).toBe(403);
      expect(res.data.code).toBe(403);
      expect(res.data.message).toBe('Forbidden');
    });
  });
  
  describe('notFound', () => {
    it('应该返回404响应', () => {
      ResponseHelper.notFound(res, '用户不存在');
      
      expect(res.statusCode).toBe(404);
      expect(res.data.code).toBe(404);
      expect(res.data.message).toBe('用户不存在');
    });
  });
  
  describe('paginated', () => {
    it('应该返回分页响应格式', () => {
      const data = [{ id: 1 }, { id: 2 }];
      const pagination = {
        page: 1,
        limit: 10,
        total: 25
      };
      
      ResponseHelper.paginated(res, data, pagination);
      
      expect(res.statusCode).toBe(200);
      expect(res.data).toMatchObject({
        success: true,
        code: 200,
        data,
        pagination: {
          page: 1,
          limit: 10,
          total: 25,
          totalPages: 3,
          hasNext: true,
          hasPrev: false
        }
      });
    });
  });
});

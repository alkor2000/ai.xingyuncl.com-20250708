/**
 * 统一响应格式工具
 */

class ResponseHelper {
  /**
   * 成功响应
   */
  static success(res, data = null, message = 'Success', code = 200) {
    return res.status(code).json({
      success: true,
      code,
      message,
      data,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * 失败响应
   */
  static error(res, message = 'Internal Server Error', code = 500, data = null) {
    return res.status(code).json({
      success: false,
      code,
      message,
      data,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * 验证失败响应
   */
  static validation(res, errors, message = 'Validation Failed') {
    return res.status(400).json({
      success: false,
      code: 400,
      message,
      data: { errors },
      timestamp: new Date().toISOString()
    });
  }

  /**
   * 未授权响应
   */
  static unauthorized(res, message = 'Unauthorized') {
    return res.status(401).json({
      success: false,
      code: 401,
      message,
      data: null,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * 禁止访问响应
   */
  static forbidden(res, message = 'Forbidden') {
    return res.status(403).json({
      success: false,
      code: 403,
      message,
      data: null,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * 资源未找到响应
   */
  static notFound(res, message = 'Resource Not Found') {
    return res.status(404).json({
      success: false,
      code: 404,
      message,
      data: null,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * 分页响应
   */
  static paginated(res, data, pagination, message = 'Success') {
    return res.status(200).json({
      success: true,
      code: 200,
      message,
      data,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: pagination.total,
        totalPages: Math.ceil(pagination.total / pagination.limit),
        hasNext: pagination.page < Math.ceil(pagination.total / pagination.limit),
        hasPrev: pagination.page > 1
      },
      timestamp: new Date().toISOString()
    });
  }
}

module.exports = ResponseHelper;

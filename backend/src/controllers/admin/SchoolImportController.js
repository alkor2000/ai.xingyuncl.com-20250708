/**
 * 学校批量导入控制器
 *
 * 提供 4 个 HTTP 端点：
 *  - GET  /admin/school-import/template          下载导入模板（无需 multer，纯 buffer 响应）
 *  - POST /admin/school-import/preview           预览校验（multer 内存存储 5MB）
 *  - POST /admin/school-import/execute           执行导入（multer 内存存储 5MB）
 *  - GET  /admin/groups/:id/export-users         按组导出用户为 Excel
 *
 * 权限：所有端点都需要 super_admin（由路由层 requireSuperAdmin 中间件保护）
 *
 * 创建日期：2026-05-09
 */

const multer = require('multer');
const SchoolImportService = require('../../services/admin/SchoolImportService');
const ResponseHelper = require('../../utils/response');
const logger = require('../../utils/logger');

// ===== Multer 配置：内存存储，仅接受 .xlsx/.xls，5MB 上限 =====
const ALLOWED_MIMES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',  // .xlsx
  'application/vnd.ms-excel',                                            // .xls
  'application/octet-stream'                                             // 部分浏览器/系统的兜底
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,  // 5MB
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const isExcelExt = /\.(xlsx|xls)$/i.test(file.originalname || '');
    const isExcelMime = ALLOWED_MIMES.includes(file.mimetype);
    if (isExcelExt || isExcelMime) {
      cb(null, true);
    } else {
      cb(new Error('只支持 .xlsx 或 .xls 格式的 Excel 文件'));
    }
  }
});

class SchoolImportController {
  /**
   * Multer 中间件（导出供路由使用）
   */
  static uploadMiddleware = upload.single('file');

  /**
   * GET /admin/school-import/template
   * 下载 Excel 导入模板
   */
  static async downloadTemplate(req, res) {
    try {
      const buffer = SchoolImportService.generateTemplate();
      const filename = `学校批量导入模板_${new Date().toISOString().split('T')[0]}.xlsx`;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="template.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`
      );
      res.setHeader('Content-Length', buffer.length);
      res.end(buffer);

      logger.info('下载学校导入模板', { operatorId: req.user?.id });
    } catch (error) {
      logger.error('下载导入模板失败', { error: error.message });
      return ResponseHelper.error(res, '下载模板失败');
    }
  }

  /**
   * POST /admin/school-import/preview
   * 预览导入：解析 Excel + 行级校验 + 用户名冲突检测，但不写入数据库
   * 用于前端在执行导入前展示"即将创建 N 所学校 + M 个用户，跳过 K 行"
   */
  static async previewImport(req, res) {
    try {
      if (!req.file) {
        return ResponseHelper.validation(res, '请上传 Excel 文件（字段名: file）');
      }

      const result = await SchoolImportService.preview(req.file.buffer);

      logger.info('学校导入预览成功', {
        operatorId: req.user?.id,
        totalRows: result.total_rows,
        validRows: result.valid_rows,
        willCreate: result.will_create_count
      });

      return ResponseHelper.success(res, result, '预览成功');
    } catch (error) {
      logger.error('学校导入预览失败', {
        error: error.message,
        operatorId: req.user?.id
      });

      // ValidationError 用 422，其他用 500
      if (error.name === 'ValidationError') {
        return ResponseHelper.validation(res, error.message);
      }
      return ResponseHelper.error(res, error.message || '预览失败');
    }
  }

  /**
   * POST /admin/school-import/execute
   * 执行批量导入：创建组 + 用户 + 标签分配
   */
  static async executeImport(req, res) {
    try {
      if (!req.file) {
        return ResponseHelper.validation(res, '请上传 Excel 文件（字段名: file）');
      }

      const result = await SchoolImportService.execute(req.file.buffer, req.user);

      logger.info('学校批量导入执行成功', {
        operatorId: req.user?.id,
        summary: result.summary
      });

      return ResponseHelper.success(res, result, result.message);
    } catch (error) {
      logger.error('学校批量导入执行失败', {
        error: error.message,
        operatorId: req.user?.id
      });

      if (error.name === 'ValidationError') {
        return ResponseHelper.validation(res, error.message);
      }
      return ResponseHelper.error(res, error.message || '导入失败');
    }
  }

  /**
   * GET /admin/user-groups/:id/export-users
   * 按用户组导出全部用户为 Excel（结构与导入模板对称）
   */
  static async exportGroupUsers(req, res) {
    try {
      const groupId = parseInt(req.params.id, 10);
      if (!Number.isFinite(groupId) || groupId <= 0) {
        return ResponseHelper.validation(res, '用户组 ID 无效');
      }

      const { buffer, filename } = await SchoolImportService.exportGroupUsers(groupId);

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`
      );
      res.setHeader('Content-Length', buffer.length);
      res.end(buffer);

      logger.info('按组导出用户成功', {
        operatorId: req.user?.id,
        groupId,
        filename
      });
    } catch (error) {
      logger.error('按组导出用户失败', {
        error: error.message,
        operatorId: req.user?.id,
        groupId: req.params.id
      });

      if (error.name === 'ValidationError') {
        return ResponseHelper.validation(res, error.message);
      }
      return ResponseHelper.error(res, error.message || '导出失败');
    }
  }

  /**
   * Multer 错误处理中间件（路由层使用）
   */
  static handleMulterError(err, req, res, next) {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return ResponseHelper.validation(res, '文件大小超过限制（最大 5MB）');
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return ResponseHelper.validation(res, '只能上传 1 个文件');
      }
      return ResponseHelper.validation(res, `上传错误: ${err.message}`);
    }
    if (err) {
      return ResponseHelper.validation(res, err.message || '文件上传失败');
    }
    next();
  }
}

module.exports = SchoolImportController;

/**
 * 学校批量导入控制器
 *
 * 提供 5 个 HTTP 端点：
 *  - GET  /admin/users/school-import/template               下载导入模板（无需 multer，纯 buffer 响应）
 *  - POST /admin/users/school-import/preview                预览校验（multer 内存存储 5MB）
 *  - POST /admin/users/school-import/execute                提交异步导入任务（multer 内存存储 5MB）
 *  - GET  /admin/users/school-import/execute/status/:taskId 查询导入任务进度/结果（v1.2 新增）
 *  - GET  /admin/users/export-by-group/:id                  按组导出用户为 Excel
 *
 * 权限：所有端点都需要 super_admin（由路由层 requireSuperAdmin 中间件保护）
 *
 * 创建日期：2026-05-09
 *
 * v1.2 异步化改造（2026-06-08）：
 *   解决"大批量导入（数千用户）同步 HTTP 请求 30 秒超时"问题。
 *   - executeImport 从"同步执行到底"改为：
 *       1) 创建异步任务（SchoolImportTaskManager）→ 立即返回 taskId（秒级响应）
 *       2) 用 setImmediate 在后台异步执行实际导入
 *   - 新增 getImportStatus：前端轮询此端点获取进度与最终结果
 *   - buffer 引用安全：multer 内存 buffer 在响应返回后可能被回收，
 *     因此用闭包固定 buffer 引用后再异步执行，确保后台任务能正常读取
 *
 * v1.3（2026-06-08 同日）：
 *   getImportStatus 任务不存在（404）时的文案优化：明确提示"任务可能已过期或服务已重启，
 *   请到用户列表确认导入结果，不要直接重试"。原因：内存任务在后端重启后丢失，
 *   但数据库里可能已提交部分/全部用户，若用户误以为"失败"直接重导会撞大量"用户名已存在"。
 */

const multer = require('multer');
const SchoolImportService = require('../../services/admin/SchoolImportService');
const SchoolImportTaskManager = require('../../services/admin/SchoolImportTaskManager');
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
   * GET /admin/users/school-import/template
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
   * POST /admin/users/school-import/preview
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
   * POST /admin/users/school-import/execute
   * 提交异步批量导入任务：创建任务 → 立即返回 taskId → 后台异步执行
   *
   * v1.2 改造说明：
   *   不再在请求内同步跑完整个导入（数千用户会超 30 秒导致 HTTP 超时）。
   *   改为：
   *     1) 立即创建任务并返回 { task_id }，前端拿到后开始轮询进度
   *     2) setImmediate 在后台执行 SchoolImportService.execute(buffer, user, taskId)
   *        执行过程持续向 TaskManager 上报进度，完成后写入完整报告
   */
  static async executeImport(req, res) {
    try {
      if (!req.file) {
        return ResponseHelper.validation(res, '请上传 Excel 文件（字段名: file）');
      }

      const currentUser = req.user;

      // 权限前置校验（Service 内也会再校验一次，这里提前拦截给出清晰错误）
      if (!currentUser || currentUser.role !== 'super_admin') {
        return ResponseHelper.validation(res, '只有超级管理员可以执行学校批量导入');
      }

      // 关键：固定 buffer 引用。
      // multer 内存 buffer 在响应返回后可能被回收，用闭包持有引用确保后台任务可读
      const fileBuffer = req.file.buffer;

      // 创建异步任务（初始 total 未知，置 0，Service 解析后会上报准确 total）
      const taskId = SchoolImportTaskManager.createTask(currentUser.id, 0);

      // 后台异步执行实际导入（不阻塞当前响应）
      setImmediate(async () => {
        try {
          const result = await SchoolImportService.execute(fileBuffer, currentUser, taskId);
          SchoolImportTaskManager.finishTask(taskId, result);
        } catch (error) {
          // 致命错误（解析失败/事务回滚等）→ 标记任务失败
          logger.error('学校批量导入后台任务执行失败', {
            taskId,
            operatorId: currentUser.id,
            error: error.message
          });
          SchoolImportTaskManager.failTask(taskId, error.message || '导入失败');
        }
      });

      logger.info('学校批量导入任务已提交', {
        taskId,
        operatorId: currentUser.id
      });

      // 立即返回 taskId（秒级响应，彻底规避 HTTP 超时）
      return ResponseHelper.success(res, { task_id: taskId }, '导入任务已提交，正在后台处理');
    } catch (error) {
      logger.error('提交学校批量导入任务失败', {
        error: error.message,
        operatorId: req.user?.id
      });
      return ResponseHelper.error(res, error.message || '提交导入任务失败');
    }
  }

  /**
   * GET /admin/users/school-import/execute/status/:taskId
   * 查询导入任务进度与结果（v1.2 新增，供前端轮询）
   *
   * 返回结构：
   *   {
   *     task_id, status, progress: { phase, percent, processed, total, groups },
   *     result, error
   *   }
   *   - status=running 时 result 为 null，前端展示进度条
   *   - status=completed 时 result 为完整导入报告
   *   - status=failed 时 error 为错误信息
   */
  static async getImportStatus(req, res) {
    try {
      const { taskId } = req.params;
      if (!taskId) {
        return ResponseHelper.validation(res, '缺少任务 ID');
      }

      const task = SchoolImportTaskManager.getTask(taskId);
      if (!task) {
        // 任务不存在（可能已过期清理、taskId 错误，或后端重启丢失内存任务）。
        // v1.3：文案明确提示"勿直接重试"——因为重启前数据库可能已提交部分/全部用户，
        // 误重导会撞大量"用户名已存在"。引导用户先到用户列表核对实际结果。
        return ResponseHelper.notFound(
          res,
          '无法获取任务状态（任务可能已过期或服务已重启）。请勿直接重新导入，先到用户列表确认本次导入是否已生效，再决定是否补录剩余数据。'
        );
      }

      // 权限隔离：只允许任务发起者本人查询自己的任务进度
      if (req.user && task.operatorId !== req.user.id) {
        return ResponseHelper.forbidden(res, '无权查看该导入任务');
      }

      return ResponseHelper.success(res, {
        task_id: task.taskId,
        status: task.status,
        progress: task.progress,
        result: task.result,
        error: task.error
      }, '查询成功');
    } catch (error) {
      logger.error('查询学校导入任务状态失败', {
        error: error.message,
        taskId: req.params?.taskId,
        operatorId: req.user?.id
      });
      return ResponseHelper.error(res, error.message || '查询任务状态失败');
    }
  }

  /**
   * GET /admin/users/export-by-group/:id
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

/**
 * 学校批量导入 - 异步任务管理器
 *
 * 设计目标：
 *   解决"大批量导入（数千用户）同步 HTTP 请求超时"问题。
 *   将原来的"一次性同步执行"改为"后台异步执行 + 前端轮询进度"模式。
 *
 * 实现方式：
 *   纯内存 Map 存储任务状态（不落数据库），理由：
 *     1. 导入任务是一次性、短生命周期（通常几分钟内完成）
 *     2. 平台后端为单实例部署（dev=PM2 单进程，生产=Docker 单后端容器），
 *        提交任务与查询进度必然落在同一进程，内存 Map 安全可靠
 *     3. 避免新增数据库表与 Knex 迁移，符合"轻量、少改库"的工程取舍
 *
 * 取舍说明：
 *   后端进程重启会丢失"进行中"的任务状态。但导入是管理员低频手动操作，
 *   几分钟内完成，重启撞上的概率极低；即便撞上，前端轮询会拿到 404，
 *   此时应提示用户"到用户列表确认结果，勿直接重试"（已创建的用户名会被自动跳过）。
 *
 * 任务生命周期：
 *   pending（已创建，等待执行）
 *     → running（执行中，持续上报 progress）
 *       → completed（成功完成，result 为完整导入报告）
 *       → failed（致命错误，error 为错误信息）
 *   完成/失败后保留 TASK_TTL_MS，供前端轮询拿到最终结果，之后自动清理防内存泄漏。
 *
 * 创建日期：2026-06-08
 *
 * v1.1（2026-06-08 同日）：
 *   progress 新增 percent 字段（0-100 的整数百分比），由 Service 按阶段算好后上报。
 *   原因：导入分"密码哈希(hashing)"与"创建用户(creating_users)"两个阶段，
 *   两阶段各自的 processed 都从 0 计数，若前端直接用 processed/total 算百分比，
 *   进度条会先涨到一半再归零（视觉退步）。改由后端统一映射到单调递增的 percent
 *   区间（哈希 0-40%、建用户 40-100%），前端进度条直接用 percent，
 *   而 processed/total 仅用于展示真实数字。
 */

const crypto = require('crypto');
const logger = require('../../utils/logger');

class SchoolImportTaskManager {
  // ========== 静态配置 ==========

  /**
   * 任务 Map：taskId -> task 对象
   * task 结构：
   *   {
   *     taskId:    string,           // 任务唯一 ID
   *     operatorId: number,          // 发起导入的超级管理员 ID
   *     status:    string,           // pending | running | completed | failed
   *     progress:  {                 // 进度信息
   *       phase:     string,         // 当前阶段：pending|hashing|running|creating_users|completed|failed
   *       percent:   number,         // 0-100 单调递增百分比（v1.1 新增，前端进度条直接用此值）
   *       processed: number,         // 当前阶段已处理数（真实计数，用于展示数字）
   *       total:     number,         // 待创建用户总数
   *       groups:    number          // 已创建学校（组）数
   *     },
   *     result:    Object | null,    // 完成时的完整导入报告
   *     error:     string | null,    // 失败时的错误信息
   *     createdAt: number,           // 任务创建时间戳（ms）
   *     updatedAt: number,           // 最后更新时间戳（ms）
   *     finishedAt: number | null    // 完成/失败时间戳（ms），用于 TTL 清理
   *   }
   */
  static tasks = new Map();

  /** 完成/失败任务的保留时长（ms）：30 分钟后自动清理 */
  static TASK_TTL_MS = 30 * 60 * 1000;

  /** 清理扫描间隔（ms）：每 5 分钟扫描一次过期任务 */
  static CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

  /** 清理定时器句柄（避免重复启动） */
  static _cleanupTimer = null;

  // ========== 任务创建 ==========

  /**
   * 创建一个新的导入任务（初始状态 pending）
   * @param {number} operatorId - 发起导入的超级管理员 ID
   * @param {number} estimatedTotal - 预估待创建用户总数（用于进度条初始显示，可为 0）
   * @returns {string} taskId
   */
  static createTask(operatorId, estimatedTotal = 0) {
    // 启动后台清理（首次创建任务时惰性启动）
    SchoolImportTaskManager._ensureCleanupTimer();

    const taskId = `school_import_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const now = Date.now();

    const task = {
      taskId,
      operatorId,
      status: 'pending',
      progress: {
        phase: 'pending',     // 等待开始
        percent: 0,
        processed: 0,
        total: estimatedTotal,
        groups: 0
      },
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      finishedAt: null
    };

    SchoolImportTaskManager.tasks.set(taskId, task);

    logger.info('创建学校导入异步任务', { taskId, operatorId, estimatedTotal });
    return taskId;
  }

  // ========== 任务查询 ==========

  /**
   * 查询任务（返回任务的浅拷贝，避免外部直接篡改内部状态）
   * @param {string} taskId
   * @returns {Object | null} 任务对象（不存在返回 null）
   */
  static getTask(taskId) {
    const task = SchoolImportTaskManager.tasks.get(taskId);
    if (!task) return null;

    // 返回浅拷贝 + progress 深拷贝，保证调用方拿到的是稳定快照
    return {
      taskId: task.taskId,
      operatorId: task.operatorId,
      status: task.status,
      progress: { ...task.progress },
      result: task.result,
      error: task.error,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      finishedAt: task.finishedAt
    };
  }

  // ========== 状态流转 ==========

  /**
   * 标记任务进入执行中（pending -> running）
   * @param {string} taskId
   * @param {number} total - 实际待创建用户总数（解析校验后才能确定的准确值）
   */
  static markRunning(taskId, total) {
    const task = SchoolImportTaskManager.tasks.get(taskId);
    if (!task) return;

    task.status = 'running';
    task.progress.phase = 'running';
    if (Number.isFinite(total)) {
      task.progress.total = total;
    }
    task.updatedAt = Date.now();
  }

  /**
   * 上报进度（执行过程中持续调用）
   * @param {string} taskId
   * @param {Object} partial - 部分进度字段 { phase?, percent?, processed?, total?, groups? }
   */
  static updateProgress(taskId, partial = {}) {
    const task = SchoolImportTaskManager.tasks.get(taskId);
    if (!task) return;

    if (partial.phase !== undefined)     task.progress.phase = partial.phase;
    if (partial.processed !== undefined) task.progress.processed = partial.processed;
    if (partial.total !== undefined)     task.progress.total = partial.total;
    if (partial.groups !== undefined)    task.progress.groups = partial.groups;

    // percent 单调递增保护：只允许往上走，避免阶段切换时回退
    if (partial.percent !== undefined) {
      const next = Math.max(0, Math.min(100, Math.floor(partial.percent)));
      if (next > task.progress.percent) {
        task.progress.percent = next;
      }
    }

    task.updatedAt = Date.now();
  }

  /**
   * 标记任务成功完成（running -> completed）
   * @param {string} taskId
   * @param {Object} result - 完整导入报告
   */
  static finishTask(taskId, result) {
    const task = SchoolImportTaskManager.tasks.get(taskId);
    if (!task) return;

    task.status = 'completed';
    task.progress.phase = 'completed';
    task.progress.percent = 100;
    // 完成时把已处理数对齐为成功创建数，确保进度条 100%
    if (result && result.summary && Number.isFinite(result.summary.success)) {
      task.progress.processed = result.summary.success;
    }
    task.result = result;
    task.error = null;
    task.updatedAt = Date.now();
    task.finishedAt = Date.now();

    logger.info('学校导入异步任务完成', {
      taskId,
      operatorId: task.operatorId,
      summary: result?.summary
    });
  }

  /**
   * 标记任务失败（running/pending -> failed）
   * @param {string} taskId
   * @param {string} errorMessage - 错误信息
   */
  static failTask(taskId, errorMessage) {
    const task = SchoolImportTaskManager.tasks.get(taskId);
    if (!task) return;

    task.status = 'failed';
    task.progress.phase = 'failed';
    task.error = errorMessage || '未知错误';
    task.updatedAt = Date.now();
    task.finishedAt = Date.now();

    logger.error('学校导入异步任务失败', {
      taskId,
      operatorId: task.operatorId,
      error: errorMessage
    });
  }

  // ========== 内部：过期清理 ==========

  /**
   * 惰性启动后台清理定时器（首次创建任务时调用，全局只启动一次）
   * 使用 unref() 避免该定时器阻止 Node 进程正常退出
   */
  static _ensureCleanupTimer() {
    if (SchoolImportTaskManager._cleanupTimer) return;

    SchoolImportTaskManager._cleanupTimer = setInterval(() => {
      SchoolImportTaskManager._cleanupExpiredTasks();
    }, SchoolImportTaskManager.CLEANUP_INTERVAL_MS);

    // 不阻止进程退出（优雅关闭时不被该定时器卡住）
    if (typeof SchoolImportTaskManager._cleanupTimer.unref === 'function') {
      SchoolImportTaskManager._cleanupTimer.unref();
    }
  }

  /**
   * 清理已完成/失败且超过 TTL 的任务，防止内存无限增长
   */
  static _cleanupExpiredTasks() {
    const now = Date.now();
    let cleaned = 0;

    for (const [taskId, task] of SchoolImportTaskManager.tasks.entries()) {
      // 只清理已结束（completed/failed）且超过 TTL 的任务
      const isFinished = task.status === 'completed' || task.status === 'failed';
      if (isFinished && task.finishedAt && (now - task.finishedAt > SchoolImportTaskManager.TASK_TTL_MS)) {
        SchoolImportTaskManager.tasks.delete(taskId);
        cleaned += 1;
      }
    }

    if (cleaned > 0) {
      logger.info('清理过期学校导入任务', { cleaned, remaining: SchoolImportTaskManager.tasks.size });
    }
  }
}

module.exports = SchoolImportTaskManager;

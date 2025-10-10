/**
 * 日历控制器
 * 处理所有日历相关的HTTP请求
 */

const CalendarEvent = require('../models/CalendarEvent');
const CalendarCategory = require('../models/CalendarCategory');
const CalendarAIAnalysis = require('../models/CalendarAIAnalysis');
const CalendarUserSettings = require('../models/CalendarUserSettings');
const CalendarService = require('../services/CalendarService');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');

class CalendarController {
  // ==================== 事项管理 ====================

  /**
   * 获取用户事项列表
   * GET /api/calendar/events
   */
  static async getEvents(req, res) {
    try {
      const userId = req.user.id;
      const {
        start_date,
        end_date,
        status,
        category,
        importance_min,
        importance_max,
        page = 1,
        limit = 100
      } = req.query;

      const result = await CalendarEvent.getUserEvents(userId, {
        start_date,
        end_date,
        status,
        category,
        importance_min: importance_min ? parseInt(importance_min) : undefined,
        importance_max: importance_max ? parseInt(importance_max) : undefined,
        page: parseInt(page),
        limit: parseInt(limit)
      });

      const events = result.events.map(event => event.toJSON());

      return ResponseHelper.paginated(
        res,
        events,
        result.pagination,
        '获取事项列表成功'
      );
    } catch (error) {
      logger.error('获取事项列表失败:', error);
      return ResponseHelper.error(res, error.message || '获取事项列表失败');
    }
  }

  /**
   * 获取月度统计数据
   * GET /api/calendar/events/month-stats
   */
  static async getMonthStats(req, res) {
    try {
      const userId = req.user.id;
      const { year, month } = req.query;

      if (!year || !month) {
        return ResponseHelper.validation(res, {
          year: !year ? '年份不能为空' : null,
          month: !month ? '月份不能为空' : null
        });
      }

      const stats = await CalendarEvent.getMonthStats(
        userId,
        parseInt(year),
        parseInt(month)
      );

      return ResponseHelper.success(res, stats, '获取月度统计成功');
    } catch (error) {
      logger.error('获取月度统计失败:', error);
      return ResponseHelper.error(res, '获取月度统计失败');
    }
  }

  /**
   * 创建事项
   * POST /api/calendar/events
   */
  static async createEvent(req, res) {
    try {
      const userId = req.user.id;
      const {
        event_date,
        content,
        importance = 5,
        category = '其他',
        color,
        status = 'not_started',
        file_link,
        recurrence_type = 'none',
        recurrence_end_date,
        sort_order = 0
      } = req.body;

      // 验证必填字段
      if (!event_date || !content) {
        return ResponseHelper.validation(res, {
          event_date: !event_date ? '事项日期不能为空' : null,
          content: !content ? '事项内容不能为空' : null
        });
      }

      const event = await CalendarEvent.create({
        event_date,
        content,
        importance,
        category,
        color,
        status,
        file_link,
        recurrence_type,
        recurrence_end_date,
        sort_order
      }, userId);

      logger.info('创建日历事项成功', { userId, eventId: event.id });

      return ResponseHelper.success(res, event.toJSON(), '事项创建成功', 201);
    } catch (error) {
      logger.error('创建事项失败:', error);
      return ResponseHelper.error(res, error.message || '创建事项失败');
    }
  }

  /**
   * 更新事项
   * PUT /api/calendar/events/:id
   */
  static async updateEvent(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const updateData = req.body;

      const event = await CalendarEvent.update(parseInt(id), updateData, userId);

      return ResponseHelper.success(res, event.toJSON(), '事项更新成功');
    } catch (error) {
      logger.error('更新事项失败:', error);
      return ResponseHelper.error(res, error.message || '更新事项失败');
    }
  }

  /**
   * 删除事项
   * DELETE /api/calendar/events/:id
   */
  static async deleteEvent(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      await CalendarEvent.delete(parseInt(id), userId);

      return ResponseHelper.success(res, null, '事项删除成功');
    } catch (error) {
      logger.error('删除事项失败:', error);
      return ResponseHelper.error(res, error.message || '删除事项失败');
    }
  }

  /**
   * 批量删除事项
   * POST /api/calendar/events/batch-delete
   */
  static async batchDeleteEvents(req, res) {
    try {
      const userId = req.user.id;
      const { ids } = req.body;

      if (!Array.isArray(ids) || ids.length === 0) {
        return ResponseHelper.validation(res, {
          ids: '请选择要删除的事项'
        });
      }

      const deletedCount = await CalendarEvent.batchDelete(ids, userId);

      return ResponseHelper.success(
        res,
        { deleted_count: deletedCount },
        `成功删除${deletedCount}个事项`
      );
    } catch (error) {
      logger.error('批量删除事项失败:', error);
      return ResponseHelper.error(res, error.message || '批量删除失败');
    }
  }

  /**
   * 快速标记完成
   * POST /api/calendar/events/:id/complete
   */
  static async markEventComplete(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const event = await CalendarEvent.markComplete(parseInt(id), userId);

      return ResponseHelper.success(res, event.toJSON(), '已标记为完成');
    } catch (error) {
      logger.error('标记完成失败:', error);
      return ResponseHelper.error(res, error.message || '标记失败');
    }
  }

  // ==================== 分类管理 ====================

  /**
   * 获取用户可用分类
   * GET /api/calendar/categories
   */
  static async getCategories(req, res) {
    try {
      const userId = req.user.id;

      const categories = await CalendarCategory.getUserCategories(userId);

      const formattedCategories = categories.map(cat => cat.toJSON());

      return ResponseHelper.success(res, formattedCategories, '获取分类列表成功');
    } catch (error) {
      logger.error('获取分类列表失败:', error);
      return ResponseHelper.error(res, '获取分类列表失败');
    }
  }

  /**
   * 创建自定义分类
   * POST /api/calendar/categories
   */
  static async createCategory(req, res) {
    try {
      const userId = req.user.id;
      const { name, color, icon, sort_order } = req.body;

      if (!name) {
        return ResponseHelper.validation(res, {
          name: '分类名称不能为空'
        });
      }

      const category = await CalendarCategory.create({
        name,
        color,
        icon,
        sort_order
      }, userId);

      return ResponseHelper.success(res, category.toJSON(), '分类创建成功', 201);
    } catch (error) {
      logger.error('创建分类失败:', error);
      return ResponseHelper.error(res, error.message || '创建分类失败');
    }
  }

  /**
   * 更新分类
   * PUT /api/calendar/categories/:id
   */
  static async updateCategory(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const updateData = req.body;

      const category = await CalendarCategory.update(parseInt(id), updateData, userId);

      return ResponseHelper.success(res, category.toJSON(), '分类更新成功');
    } catch (error) {
      logger.error('更新分类失败:', error);
      return ResponseHelper.error(res, error.message || '更新分类失败');
    }
  }

  /**
   * 删除分类
   * DELETE /api/calendar/categories/:id
   */
  static async deleteCategory(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      await CalendarCategory.delete(parseInt(id), userId);

      return ResponseHelper.success(res, null, '分类删除成功');
    } catch (error) {
      logger.error('删除分类失败:', error);
      return ResponseHelper.error(res, error.message || '删除分类失败');
    }
  }

  // ==================== AI分析 ====================

  /**
   * 执行AI分析
   * POST /api/calendar/ai-analysis
   */
  static async performAnalysis(req, res) {
    try {
      const userId = req.user.id;
      const { scan_days = 15, model_id, focus_areas } = req.body;

      // 验证参数
      if (!model_id) {
        return ResponseHelper.validation(res, {
          model_id: '请选择AI模型'
        });
      }

      if (scan_days < 1 || scan_days > 180) {
        return ResponseHelper.validation(res, {
          scan_days: '扫描范围必须在1-180天之间'
        });
      }

      // 执行分析
      const result = await CalendarService.performAnalysis(userId, {
        scan_days: parseInt(scan_days),
        model_id: parseInt(model_id),
        focus_areas
      });

      logger.info('AI分析完成', {
        userId,
        analysisId: result.analysis.id,
        creditsConsumed: result.analysis.credits_consumed
      });

      return ResponseHelper.success(res, result, 'AI分析完成');
    } catch (error) {
      logger.error('AI分析失败:', error);
      return ResponseHelper.error(res, error.message || 'AI分析失败');
    }
  }

  /**
   * 获取分析历史列表
   * GET /api/calendar/ai-analyses
   */
  static async getAnalyses(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 20 } = req.query;

      const result = await CalendarAIAnalysis.getUserAnalyses(userId, {
        page: parseInt(page),
        limit: parseInt(limit)
      });

      const analyses = result.analyses.map(analysis => analysis.toJSON());

      return ResponseHelper.paginated(
        res,
        analyses,
        result.pagination,
        '获取分析历史成功'
      );
    } catch (error) {
      logger.error('获取分析历史失败:', error);
      return ResponseHelper.error(res, '获取分析历史失败');
    }
  }

  /**
   * 获取单个分析详情
   * GET /api/calendar/ai-analyses/:id
   */
  static async getAnalysisById(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const analysis = await CalendarAIAnalysis.findById(parseInt(id), userId);

      if (!analysis) {
        return ResponseHelper.notFound(res, '分析记录不存在');
      }

      return ResponseHelper.success(res, analysis.toJSON(), '获取分析详情成功');
    } catch (error) {
      logger.error('获取分析详情失败:', error);
      return ResponseHelper.error(res, '获取分析详情失败');
    }
  }

  /**
   * 删除分析记录
   * DELETE /api/calendar/ai-analyses/:id
   */
  static async deleteAnalysis(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      await CalendarAIAnalysis.delete(parseInt(id), userId);

      return ResponseHelper.success(res, null, '分析记录删除成功');
    } catch (error) {
      logger.error('删除分析记录失败:', error);
      return ResponseHelper.error(res, error.message || '删除失败');
    }
  }

  /**
   * 获取分析统计
   * GET /api/calendar/ai-analyses/stats
   */
  static async getAnalysisStats(req, res) {
    try {
      const userId = req.user.id;

      const stats = await CalendarAIAnalysis.getUserStats(userId);

      return ResponseHelper.success(res, stats, '获取分析统计成功');
    } catch (error) {
      logger.error('获取分析统计失败:', error);
      return ResponseHelper.error(res, '获取统计失败');
    }
  }

  // ==================== 用户设置 ====================

  /**
   * 获取用户设置
   * GET /api/calendar/settings
   */
  static async getSettings(req, res) {
    try {
      const userId = req.user.id;

      const settings = await CalendarUserSettings.getOrCreate(userId);

      return ResponseHelper.success(res, settings.toJSON(), '获取设置成功');
    } catch (error) {
      logger.error('获取用户设置失败:', error);
      return ResponseHelper.error(res, '获取设置失败');
    }
  }

  /**
   * 更新用户设置
   * PUT /api/calendar/settings
   */
  static async updateSettings(req, res) {
    try {
      const userId = req.user.id;
      const updateData = req.body;

      const settings = await CalendarUserSettings.update(userId, updateData);

      return ResponseHelper.success(res, settings.toJSON(), '设置更新成功');
    } catch (error) {
      logger.error('更新用户设置失败:', error);
      return ResponseHelper.error(res, error.message || '更新设置失败');
    }
  }

  /**
   * 重置用户设置
   * POST /api/calendar/settings/reset
   */
  static async resetSettings(req, res) {
    try {
      const userId = req.user.id;

      const settings = await CalendarUserSettings.reset(userId);

      return ResponseHelper.success(res, settings.toJSON(), '设置已重置为默认值');
    } catch (error) {
      logger.error('重置用户设置失败:', error);
      return ResponseHelper.error(res, '重置失败');
    }
  }

  // ==================== 统计与概览 ====================

  /**
   * 获取用户统计概览
   * GET /api/calendar/overview
   */
  static async getOverview(req, res) {
    try {
      const userId = req.user.id;

      // 获取今日事项
      const today = new Date().toISOString().split('T')[0];
      const { events: todayEvents } = await CalendarEvent.getUserEvents(userId, {
        start_date: today,
        end_date: today,
        limit: 100
      });

      // 获取未来7天事项
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);
      const { events: upcomingEvents } = await CalendarEvent.getUserEvents(userId, {
        start_date: today,
        end_date: nextWeek.toISOString().split('T')[0],
        limit: 100
      });

      // 统计数据
      const overview = {
        today: {
          total: todayEvents.length,
          completed: todayEvents.filter(e => e.status === 'completed').length,
          in_progress: todayEvents.filter(e => e.status === 'in_progress').length,
          not_started: todayEvents.filter(e => e.status === 'not_started').length,
          high_priority: todayEvents.filter(e => e.importance >= 8).length
        },
        upcoming: {
          total: upcomingEvents.length,
          by_category: {},
          high_priority: upcomingEvents.filter(e => e.importance >= 8).length
        }
      };

      // 按分类统计
      upcomingEvents.forEach(event => {
        const cat = event.category || '其他';
        overview.upcoming.by_category[cat] = (overview.upcoming.by_category[cat] || 0) + 1;
      });

      return ResponseHelper.success(res, overview, '获取概览成功');
    } catch (error) {
      logger.error('获取统计概览失败:', error);
      return ResponseHelper.error(res, '获取概览失败');
    }
  }
}

module.exports = CalendarController;

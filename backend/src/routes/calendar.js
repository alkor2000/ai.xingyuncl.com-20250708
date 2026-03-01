/**
 * 日历路由 - 带权限验证（包含背景知识路由）
 * 处理所有日历相关的API请求
 * 
 * v1.1 (2026-03-01):
 *   - 移除硬编码rateLimit，改为通过全局限流统一管理
 *   - 日历操作和AI分析均受全局限流保护，无需独立限流
 */

const express = require('express');
const CalendarController = require('../controllers/CalendarController');
const { authenticate, requirePermission } = require('../middleware/authMiddleware');

const router = express.Router();

// 所有路由都需要认证和calendar.use权限
router.use(authenticate);
router.use(requirePermission('calendar.use'));

// ==================== 事项管理路由 ====================

/**
 * @route GET /api/calendar/events
 * @desc 获取用户事项列表（支持筛选）
 * @access Private - 需要calendar.use权限
 */
router.get('/events', CalendarController.getEvents);

/**
 * @route GET /api/calendar/events/month-stats
 * @desc 获取月度统计数据
 * @access Private - 需要calendar.use权限
 */
router.get('/events/month-stats', CalendarController.getMonthStats);

/**
 * @route POST /api/calendar/events
 * @desc 创建事项
 * @access Private - 需要calendar.use权限
 */
router.post('/events', CalendarController.createEvent);

/**
 * @route PUT /api/calendar/events/:id
 * @desc 更新事项
 * @access Private - 需要calendar.use权限
 */
router.put('/events/:id', CalendarController.updateEvent);

/**
 * @route DELETE /api/calendar/events/:id
 * @desc 删除事项
 * @access Private - 需要calendar.use权限
 */
router.delete('/events/:id', CalendarController.deleteEvent);

/**
 * @route POST /api/calendar/events/batch-delete
 * @desc 批量删除事项
 * @access Private - 需要calendar.use权限
 */
router.post('/events/batch-delete', CalendarController.batchDeleteEvents);

/**
 * @route POST /api/calendar/events/:id/complete
 * @desc 快速标记完成
 * @access Private - 需要calendar.use权限
 */
router.post('/events/:id/complete', CalendarController.markEventComplete);

// ==================== 分类管理路由 ====================

/**
 * @route GET /api/calendar/categories
 * @desc 获取用户可用分类（系统+自定义）
 * @access Private - 需要calendar.use权限
 */
router.get('/categories', CalendarController.getCategories);

/**
 * @route POST /api/calendar/categories
 * @desc 创建自定义分类
 * @access Private - 需要calendar.use权限
 */
router.post('/categories', CalendarController.createCategory);

/**
 * @route PUT /api/calendar/categories/:id
 * @desc 更新分类
 * @access Private - 需要calendar.use权限
 */
router.put('/categories/:id', CalendarController.updateCategory);

/**
 * @route DELETE /api/calendar/categories/:id
 * @desc 删除分类
 * @access Private - 需要calendar.use权限
 */
router.delete('/categories/:id', CalendarController.deleteCategory);

// ==================== AI分析路由 ====================

/**
 * @route POST /api/calendar/ai-analysis
 * @desc 执行AI分析（消耗积分）
 * @access Private - 需要calendar.use权限
 */
router.post('/ai-analysis', CalendarController.performAnalysis);

/**
 * @route GET /api/calendar/ai-analyses
 * @desc 获取分析历史列表
 * @access Private - 需要calendar.use权限
 */
router.get('/ai-analyses', CalendarController.getAnalyses);

/**
 * @route GET /api/calendar/ai-analyses/stats
 * @desc 获取分析统计
 * @access Private - 需要calendar.use权限
 */
router.get('/ai-analyses/stats', CalendarController.getAnalysisStats);

/**
 * @route GET /api/calendar/ai-analyses/:id
 * @desc 获取单个分析详情
 * @access Private - 需要calendar.use权限
 */
router.get('/ai-analyses/:id', CalendarController.getAnalysisById);

/**
 * @route DELETE /api/calendar/ai-analyses/:id
 * @desc 删除分析记录
 * @access Private - 需要calendar.use权限
 */
router.delete('/ai-analyses/:id', CalendarController.deleteAnalysis);

// ==================== 背景知识管理路由 ====================

/**
 * @route GET /api/calendar/background-knowledge
 * @desc 获取用户背景知识列表
 * @access Private - 需要calendar.use权限
 */
router.get('/background-knowledge', CalendarController.getBackgroundKnowledge);

/**
 * @route POST /api/calendar/background-knowledge
 * @desc 创建背景知识
 * @access Private - 需要calendar.use权限
 */
router.post('/background-knowledge', CalendarController.createBackgroundKnowledge);

/**
 * @route PUT /api/calendar/background-knowledge/:id
 * @desc 更新背景知识
 * @access Private - 需要calendar.use权限
 */
router.put('/background-knowledge/:id', CalendarController.updateBackgroundKnowledge);

/**
 * @route DELETE /api/calendar/background-knowledge/:id
 * @desc 删除背景知识
 * @access Private - 需要calendar.use权限
 */
router.delete('/background-knowledge/:id', CalendarController.deleteBackgroundKnowledge);

/**
 * @route POST /api/calendar/background-knowledge/reorder
 * @desc 批量调整排序
 * @access Private - 需要calendar.use权限
 */
router.post('/background-knowledge/reorder', CalendarController.reorderBackgroundKnowledge);

// ==================== 用户设置路由 ====================

/**
 * @route GET /api/calendar/settings
 * @desc 获取用户设置
 * @access Private - 需要calendar.use权限
 */
router.get('/settings', CalendarController.getSettings);

/**
 * @route PUT /api/calendar/settings
 * @desc 更新用户设置
 * @access Private - 需要calendar.use权限
 */
router.put('/settings', CalendarController.updateSettings);

/**
 * @route POST /api/calendar/settings/reset
 * @desc 重置用户设置
 * @access Private - 需要calendar.use权限
 */
router.post('/settings/reset', CalendarController.resetSettings);

// ==================== 统计与概览路由 ====================

/**
 * @route GET /api/calendar/overview
 * @desc 获取用户统计概览
 * @access Private - 需要calendar.use权限
 */
router.get('/overview', CalendarController.getOverview);

module.exports = router;

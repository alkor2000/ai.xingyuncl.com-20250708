/**
 * 日历服务层 - 使用配置化的积分倍数和提示词模板（支持背景知识）
 * 修复：时区导致的日期错误
 * 新增：AI分析时拼接用户背景知识
 * 优化：formattedEvents包含title字段
 */

const CalendarEvent = require('../models/CalendarEvent');
const CalendarAIAnalysis = require('../models/CalendarAIAnalysis');
const CalendarConfig = require('../models/CalendarConfig');
const CalendarPromptTemplate = require('../models/CalendarPromptTemplate');
const CalendarBackgroundKnowledge = require('../models/CalendarBackgroundKnowledge');
const AIModel = require('../models/AIModel');
const User = require('../models/User');
const AIService = require('./aiService');
const logger = require('../utils/logger');
const { ValidationError, DatabaseError } = require('../utils/errors');
const dayjs = require('dayjs');
require('dayjs/locale/zh-cn');

dayjs.locale('zh-cn');

class CalendarService {
  /**
   * 计算AI分析需要的积分（使用配置的倍数）
   */
  static async calculateAnalysisCredits(scanDays, modelCreditsPerChat) {
    // 获取配置的倍数
    const config = await CalendarConfig.getConfig();
    const multiplier = config?.credits_multiplier || 1.0;
    
    const baseCost = 10;
    const daysCost = Math.ceil((scanDays * 2) / 7) * 5;
    const modelMultiplier = Math.ceil(modelCreditsPerChat / 10);
    
    const baseTotal = baseCost + daysCost + modelMultiplier;
    return Math.ceil(baseTotal * multiplier);
  }

  /**
   * 构建AI分析的Prompt（使用模板+背景知识）
   * @param {Array} events - 事项列表
   * @param {String} scanDateStart - 扫描开始日期
   * @param {String} scanDateEnd - 扫描结束日期
   * @param {Number} templateId - 模板ID（可选）
   * @param {Array} backgroundKnowledge - 背景知识列表（新增）
   */
  static async buildAnalysisPrompt(events, scanDateStart, scanDateEnd, templateId = null, backgroundKnowledge = []) {
    let finalPrompt = '';

    // ========== 1. 背景知识部分（新增 - 最优先）==========
    if (backgroundKnowledge && backgroundKnowledge.length > 0) {
      finalPrompt += '【背景信息】\n';
      backgroundKnowledge.forEach((bg, index) => {
        finalPrompt += `${index + 1}. ${bg.title}：${bg.content}\n`;
      });
      finalPrompt += '\n';
    }

    // ========== 2. 获取模板 ==========
    let template;
    if (templateId) {
      template = await CalendarPromptTemplate.findById(templateId);
    } else {
      template = await CalendarPromptTemplate.getDefault();
    }
    
    if (!template) {
      // 回退到内置默认提示词
      const fallbackPrompt = CalendarService.buildFallbackPrompt(events, scanDateStart, scanDateEnd);
      finalPrompt += fallbackPrompt;
      return finalPrompt;
    }
    
    // ========== 3. 准备统计数据 ==========
    const stats = {
      total: events.length,
      by_category: {},
      by_status: {},
      by_importance: {
        high: 0,
        medium: 0,
        low: 0
      }
    };

    events.forEach(event => {
      stats.by_category[event.category] = (stats.by_category[event.category] || 0) + 1;
      stats.by_status[event.status] = (stats.by_status[event.status] || 0) + 1;
      
      if (event.importance >= 8) stats.by_importance.high++;
      else if (event.importance >= 5) stats.by_importance.medium++;
      else stats.by_importance.low++;
    });

    // ========== 4. 格式化事项数据（🔥 新增title字段）==========
    const formattedEvents = events.map(event => ({
      date: dayjs(event.event_date).format('YYYY-MM-DD'),
      title: event.title || '（无标题）',  // 🔥 新增title字段
      content: event.content || '',        // content可能为空
      importance: event.importance,
      category: event.category,
      status: event.status
    }));
    
    // ========== 5. 获取当前时间信息 ==========
    const now = dayjs();
    const today = now.format('YYYY-MM-DD');
    const currentDateTime = now.format('YYYY-MM-DD HH:mm:ss');
    const currentWeekday = now.format('dddd');
    const currentTime = now.format('HH:mm');
    
    // ========== 6. 准备变量映射（包含时间变量）==========
    const variables = {
      // 时间相关变量
      today: today,
      currentDateTime: currentDateTime,
      currentWeekday: currentWeekday,
      currentTime: currentTime,
      
      // 扫描范围
      scanDateStart: scanDateStart,
      scanDateEnd: scanDateEnd,
      
      // 事项数据
      eventsCount: events.length,
      eventsData: JSON.stringify(formattedEvents, null, 2),
      
      // 统计数据
      statsTotal: stats.total,
      categoryDistribution: Object.entries(stats.by_category).map(([k, v]) => `${k}(${v})`).join('、'),
      statusDistribution: `已完成(${stats.by_status.completed || 0})、进行中(${stats.by_status.in_progress || 0})、未开始(${stats.by_status.not_started || 0})、日常(${stats.by_status.daily || 0})`,
      importanceDistribution: `高优(${stats.by_importance.high})、中等(${stats.by_importance.medium})、低优(${stats.by_importance.low})`
    };
    
    // ========== 7. 渲染模板并拼接 ==========
    const templatePrompt = template.renderPrompt(variables);
    finalPrompt += templatePrompt;

    return finalPrompt;
  }

  /**
   * 回退默认提示词（当模板不可用时）
   */
  static buildFallbackPrompt(events, scanDateStart, scanDateEnd) {
    const now = dayjs();
    const today = now.format('YYYY-MM-DD');
    
    const stats = {
      total: events.length,
      by_category: {},
      by_status: {}
    };

    events.forEach(event => {
      stats.by_category[event.category] = (stats.by_category[event.category] || 0) + 1;
      stats.by_status[event.status] = (stats.by_status[event.status] || 0) + 1;
    });

    return `你是时间管理专家。今天是${today}，请分析${scanDateStart}到${scanDateEnd}的${events.length}个日历事项，给出优先级排序、时间分配建议、冲突检测和效率优化方案。`;
  }

  /**
   * 执行AI分析（支持背景知识）
   */
  static async performAnalysis(userId, options) {
    try {
      const {
        scan_days = 15,
        model_id,
        template_id,
        focus_areas = ['priority', 'time_allocation', 'conflicts', 'progress', 'optimization']
      } = options;

      // ========== 1. 验证用户 ==========
      const user = await User.findById(userId);
      if (!user) {
        throw new ValidationError('用户不存在');
      }

      // 获取用户UUID（用于背景知识查询）
      const userUuid = user.uuid;
      if (!userUuid) {
        logger.warn('用户UUID不存在，将跳过背景知识', { userId });
      }

      // ========== 2. 验证并获取AI模型 ==========
      const model = await AIModel.findById(model_id);
      if (!model) {
        throw new ValidationError('AI模型不存在');
      }

      if (!model.is_active) {
        throw new ValidationError('该AI模型已禁用');
      }

      // ========== 3. 计算日期范围 ==========
      const today = new Date();
      const scanDateStart = new Date(today);
      scanDateStart.setDate(today.getDate() - scan_days);
      const scanDateEnd = new Date(today);
      scanDateEnd.setDate(today.getDate() + scan_days);

      const formatDate = (date) => date.toISOString().split('T')[0];

      // ========== 4. 获取事项数据 ==========
      const { events } = await CalendarEvent.getUserEvents(userId, {
        start_date: formatDate(scanDateStart),
        end_date: formatDate(scanDateEnd),
        limit: 1000
      });

      if (events.length === 0) {
        throw new ValidationError('该时间范围内没有事项，无需分析');
      }

      // ========== 5. 获取用户已启用的背景知识（新增）==========
      let backgroundKnowledge = [];
      if (userUuid) {
        try {
          backgroundKnowledge = await CalendarBackgroundKnowledge.getEnabledKnowledge(userUuid);
          logger.info('获取用户背景知识成功', {
            userId,
            userUuid,
            knowledgeCount: backgroundKnowledge.length
          });
        } catch (error) {
          logger.error('获取背景知识失败，将继续分析', { userId, error: error.message });
        }
      }

      // ========== 6. 计算需要消耗的积分（使用配置的倍数）==========
      const totalScanDays = scan_days * 2;
      const creditsNeeded = await CalendarService.calculateAnalysisCredits(
        totalScanDays, 
        model.credits_per_chat || 10
      );

      // ========== 7. 检查积分余额 ==========
      if (!user.hasCredits(creditsNeeded)) {
        throw new ValidationError(`积分不足，需要${creditsNeeded}积分，当前余额${user.getCredits()}积分`);
      }

      // ========== 8. 构建Prompt（传入背景知识）==========
      const prompt = await CalendarService.buildAnalysisPrompt(
        events,
        formatDate(scanDateStart),
        formatDate(scanDateEnd),
        template_id,
        backgroundKnowledge  // 传入背景知识
      );

      // ========== 9. 调用AI模型 ==========
      const messages = [
        {
          role: 'user',
          content: prompt
        }
      ];

      logger.info('开始调用AI模型进行日历分析', {
        userId,
        userUuid,
        modelName: model.name,
        modelId: model.id,
        templateId: template_id,
        eventsCount: events.length,
        backgroundKnowledgeCount: backgroundKnowledge.length,
        creditsNeeded
      });

      const aiResponse = await AIService.sendMessage(model.name, messages, {
        temperature: 0.7,
        messageId: `calendar_analysis_${Date.now()}`
      });

      const analysisText = aiResponse.content;

      if (!analysisText) {
        throw new Error('AI分析返回内容为空');
      }

      // ========== 10. 扣除积分 ==========
      await user.consumeCredits(
        creditsNeeded,
        model_id,
        null,
        `日历AI分析 - ${events.length}个事项 - ${model.display_name}`,
        'calendar_analysis'
      );

      // ========== 11. 保存分析结果 ==========
      const analysisData = {
        scan_date_start: formatDate(scanDateStart),
        scan_date_end: formatDate(scanDateEnd),
        model_id: model.id,
        model_name: model.display_name,
        analysis_result: {
          raw_text: analysisText,
          events_analyzed: events.length,
          scan_range_days: totalScanDays,
          focus_areas,
          template_id: template_id || null,
          background_knowledge_count: backgroundKnowledge.length,  // 记录使用的背景知识数量
          generated_at: new Date().toISOString()
        },
        credits_consumed: creditsNeeded,
        events_count: events.length
      };

      const analysis = await CalendarAIAnalysis.create(analysisData, userId);

      logger.info('日历AI分析完成', {
        userId,
        userUuid,
        analysisId: analysis.id,
        eventsCount: events.length,
        backgroundKnowledgeCount: backgroundKnowledge.length,
        creditsConsumed: creditsNeeded,
        modelName: model.display_name
      });

      return {
        analysis: analysis.toJSON(),
        balance_after: user.getCredits() - creditsNeeded
      };

    } catch (error) {
      logger.error('日历AI分析失败:', error);
      throw error;
    }
  }

  /**
   * 验证分析参数
   */
  static validateAnalysisParams(params) {
    const { scan_days, model_id } = params;

    if (!model_id) {
      throw new ValidationError('请选择AI模型');
    }

    if (scan_days < 1 || scan_days > 180) {
      throw new ValidationError('扫描范围必须在1-180天之间');
    }

    return true;
  }
}

module.exports = CalendarService;

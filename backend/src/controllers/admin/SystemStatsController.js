/**
 * 系统统计控制器 - 负责系统统计数据的获取
 */

const dbConnection = require('../../database/connection');
const ResponseHelper = require('../../utils/response');
const logger = require('../../utils/logger');

class SystemStatsController {
  /**
   * 获取系统统计 - 基于用户组过滤
   */
  static async getSystemStats(req, res) {
    try {
      const currentUser = req.user;
      let groupFilter = '';
      let groupParams = [];

      // 如果是普通管理员，只能看到自己组的统计
      if (currentUser.role === 'admin' && currentUser.group_id) {
        groupFilter = 'WHERE u.group_id = ?';
        groupParams = [currentUser.group_id];
      }

      // 获取用户统计
      const userStatsQuery = `
        SELECT 
          COUNT(*) as total_users,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_users,
          SUM(CASE WHEN role = 'admin' OR role = 'super_admin' THEN 1 ELSE 0 END) as admin_users,
          SUM(used_tokens) as total_tokens_used,
          AVG(used_tokens) as avg_tokens_per_user,
          SUM(credits_quota) as total_credits_quota,
          SUM(used_credits) as total_credits_used,
          AVG(credits_quota - used_credits) as avg_credits_remaining
        FROM users u
        ${groupFilter}
      `;
      const { rows: userStats } = await dbConnection.query(userStatsQuery, groupParams);
      
      // 获取分组统计 - 管理员只能看到自己组的统计
      let groupStatsQuery;
      let groupStatsParams = [];
      
      if (currentUser.role === 'admin' && currentUser.group_id) {
        groupStatsQuery = `
          SELECT g.name, g.color, COUNT(u.id) as user_count, 
                 AVG(u.used_tokens) as avg_tokens,
                 AVG(u.used_credits) as avg_credits,
                 SUM(u.credits_quota - u.used_credits) as total_credits_remaining
          FROM user_groups g
          LEFT JOIN users u ON g.id = u.group_id AND u.status = 'active'
          WHERE g.id = ?
          GROUP BY g.id
        `;
        groupStatsParams = [currentUser.group_id];
      } else {
        groupStatsQuery = `
          SELECT g.name, g.color, COUNT(u.id) as user_count, 
                 AVG(u.used_tokens) as avg_tokens,
                 AVG(u.used_credits) as avg_credits,
                 SUM(u.credits_quota - u.used_credits) as total_credits_remaining
          FROM user_groups g
          LEFT JOIN users u ON g.id = u.group_id AND u.status = 'active'
          GROUP BY g.id
          ORDER BY g.sort_order ASC
        `;
      }
      
      const { rows: groupStats } = await dbConnection.query(groupStatsQuery, groupStatsParams);
      
      // 获取对话统计 - 基于用户组过滤
      let conversationStatsQuery;
      let conversationParams = [];
      
      if (currentUser.role === 'admin' && currentUser.group_id) {
        conversationStatsQuery = `
          SELECT 
            COUNT(DISTINCT c.id) as total_conversations,
            SUM(c.message_count) as total_messages,
            SUM(c.total_tokens) as conversation_tokens,
            AVG(c.message_count) as avg_messages_per_conversation
          FROM conversations c
          INNER JOIN users u ON c.user_id = u.id
          WHERE u.group_id = ?
        `;
        conversationParams = [currentUser.group_id];
      } else {
        conversationStatsQuery = `
          SELECT 
            COUNT(*) as total_conversations,
            SUM(message_count) as total_messages,
            SUM(total_tokens) as conversation_tokens,
            AVG(message_count) as avg_messages_per_conversation
          FROM conversations
        `;
      }
      
      const { rows: conversationStats } = await dbConnection.query(conversationStatsQuery, conversationParams);
      
      // AI模型统计 - 所有管理员都可以看到
      const modelStatsQuery = `
        SELECT 
          am.display_name as model_name,
          am.credits_per_chat,
          COUNT(c.id) as conversation_count,
          SUM(c.total_tokens) as total_tokens
        FROM ai_models am
        LEFT JOIN conversations c ON am.name = c.model_name 
        WHERE am.is_active = 1
        GROUP BY am.id
        ORDER BY conversation_count DESC
        LIMIT 10
      `;
      const { rows: modelStats } = await dbConnection.query(modelStatsQuery);

      const stats = {
        users: userStats[0] || {},
        groups: groupStats || [],
        conversations: conversationStats[0] || {},
        models: modelStats || []
      };

      logger.info('获取系统统计成功', { 
        adminId: req.user.id,
        adminRole: req.user.role,
        adminGroupId: req.user.group_id,
        stats: Object.keys(stats)
      });

      return ResponseHelper.success(res, stats, '获取系统统计成功');
    } catch (error) {
      logger.error('获取系统统计失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '获取系统统计失败');
    }
  }

  /**
   * 获取系统设置
   */
  static async getSystemSettings(req, res) {
    try {
      const settings = {
        site: {
          name: 'AI Platform',
          description: '企业级AI应用聚合平台',
          logo: '',
          favicon: ''
        },
        user: {
          allow_register: true,
          default_token_quota: 10000,
          default_group_id: 1,
          default_credits_quota: 1000
        },
        ai: {
          default_model: 'openai/gpt-4.1-mini',
          temperature: 0.0
        },
        credits: {
          default_credits: 1000,
          max_credits: 100000,
          min_credits_for_chat: 1
        }
      };

      return ResponseHelper.success(res, settings, '获取系统设置成功');
    } catch (error) {
      logger.error('获取系统设置失败', { 
        userId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '获取系统设置失败');
    }
  }

  /**
   * 更新系统设置
   */
  static async updateSystemSettings(req, res) {
    try {
      const settings = req.body;

      logger.info('管理员更新系统设置', { 
        adminId: req.user.id,
        settings
      });

      return ResponseHelper.success(res, settings, '系统设置更新成功');
    } catch (error) {
      logger.error('更新系统设置失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, '更新系统设置失败');
    }
  }
}

module.exports = SystemStatsController;

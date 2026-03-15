/**
 * Agent API Key 数据模型
 * 
 * 管理工作流的外部API访问密钥
 * 每个工作流只能有一个API Key（一对一绑定）
 * 
 * 功能：
 * - API Key 的 CRUD 操作
 * - 密钥验证（通过哈希快速查找）
 * - 访问控制检查（频率、IP、有效期、次数）
 * - 调用统计更新
 */

const crypto = require('crypto');
const dbConnection = require('../database/connection');
const logger = require('../utils/logger');

class AgentApiKey {
  constructor(data) {
    Object.assign(this, data);
  }

  /**
   * 生成API密钥
   * 格式: ak-{32位随机hex}
   * @returns {string} 明文API密钥
   */
  static generateApiKey() {
    const random = crypto.randomBytes(32).toString('hex');
    return `ak-${random}`;
  }

  /**
   * 计算API密钥的SHA-256哈希
   * 用于数据库中快速查找（不存储明文）
   * @param {string} apiKey - 明文API密钥
   * @returns {string} 64位十六进制哈希值
   */
  static hashApiKey(apiKey) {
    return crypto.createHash('sha256').update(apiKey).digest('hex');
  }

  /**
   * 通过API Key哈希查找记录
   * 外部API认证时使用
   * @param {string} apiKey - 明文API密钥
   * @returns {AgentApiKey|null}
   */
  static async findByApiKey(apiKey) {
    try {
      const hash = AgentApiKey.hashApiKey(apiKey);
      const sql = `
        SELECT k.*, w.name AS workflow_name, w.flow_data, w.is_published,
               u.username AS owner_username, u.credits_quota, u.used_credits
        FROM agent_api_keys k
        JOIN agent_workflows w ON k.workflow_id = w.id
        JOIN users u ON k.user_id = u.id
        WHERE k.api_key_hash = ?
      `;
      const { rows } = await dbConnection.query(sql, [hash]);
      return rows.length > 0 ? new AgentApiKey(rows[0]) : null;
    } catch (error) {
      logger.error('通过API Key查找失败:', error);
      throw error;
    }
  }

  /**
   * 通过工作流ID查找API Key
   * @param {number} workflowId - 工作流ID
   * @returns {AgentApiKey|null}
   */
  static async findByWorkflowId(workflowId) {
    try {
      const sql = `SELECT * FROM agent_api_keys WHERE workflow_id = ?`;
      const { rows } = await dbConnection.query(sql, [workflowId]);
      return rows.length > 0 ? new AgentApiKey(rows[0]) : null;
    } catch (error) {
      logger.error('通过工作流ID查找API Key失败:', error);
      throw error;
    }
  }

  /**
   * 创建API Key
   * 发布工作流时自动调用
   * @param {Object} data - { workflow_id, user_id, key_name }
   * @returns {Object} { id, api_key } api_key为明文，仅此一次返回
   */
  static async create(data) {
    try {
      const { workflow_id, user_id, key_name = '默认密钥' } = data;

      /* 检查是否已存在（一个工作流只能有一个Key） */
      const existing = await AgentApiKey.findByWorkflowId(workflow_id);
      if (existing) {
        throw new Error('该工作流已存在API Key，请先删除旧Key');
      }

      /* 生成密钥和哈希 */
      const apiKey = AgentApiKey.generateApiKey();
      const apiKeyHash = AgentApiKey.hashApiKey(apiKey);

      const sql = `
        INSERT INTO agent_api_keys 
        (workflow_id, user_id, api_key, api_key_hash, key_name, status)
        VALUES (?, ?, ?, ?, ?, 'active')
      `;
      const { rows } = await dbConnection.query(sql, [
        workflow_id, user_id, apiKey, apiKeyHash, key_name
      ]);

      logger.info('API Key创建成功', { workflowId: workflow_id, userId: user_id });

      return { id: rows.insertId, api_key: apiKey };
    } catch (error) {
      logger.error('创建API Key失败:', error);
      throw error;
    }
  }

  /**
   * 重新生成API Key
   * 旧Key立即失效
   * @param {number} workflowId - 工作流ID
   * @param {number} userId - 用户ID（权限校验）
   * @returns {Object} { id, api_key } 新的明文密钥
   */
  static async regenerate(workflowId, userId) {
    try {
      const existing = await AgentApiKey.findByWorkflowId(workflowId);
      if (!existing) {
        throw new Error('API Key不存在');
      }
      if (existing.user_id !== userId) {
        throw new Error('无权操作此API Key');
      }

      const apiKey = AgentApiKey.generateApiKey();
      const apiKeyHash = AgentApiKey.hashApiKey(apiKey);

      const sql = `
        UPDATE agent_api_keys 
        SET api_key = ?, api_key_hash = ?, status = 'active', updated_at = NOW()
        WHERE workflow_id = ?
      `;
      await dbConnection.query(sql, [apiKey, apiKeyHash, workflowId]);

      logger.info('API Key重新生成成功', { workflowId });

      return { id: existing.id, api_key: apiKey };
    } catch (error) {
      logger.error('重新生成API Key失败:', error);
      throw error;
    }
  }

  /**
   * 更新API Key配置（访问控制）
   * @param {number} workflowId - 工作流ID
   * @param {number} userId - 用户ID
   * @param {Object} config - 配置项
   * @returns {boolean}
   */
  static async updateConfig(workflowId, userId, config) {
    try {
      const existing = await AgentApiKey.findByWorkflowId(workflowId);
      if (!existing) throw new Error('API Key不存在');
      if (existing.user_id !== userId) throw new Error('无权操作此API Key');

      const allowedFields = [
        'key_name', 'status', 'rate_limit_per_minute',
        'ip_whitelist', 'expires_at', 'max_calls'
      ];

      const updates = [];
      const values = [];

      for (const field of allowedFields) {
        if (config[field] !== undefined) {
          updates.push(`${field} = ?`);
          /* ip_whitelist 需要JSON序列化 */
          if (field === 'ip_whitelist' && Array.isArray(config[field])) {
            values.push(JSON.stringify(config[field]));
          } else {
            values.push(config[field]);
          }
        }
      }

      if (updates.length === 0) return true;

      updates.push('updated_at = NOW()');
      values.push(workflowId);

      const sql = `UPDATE agent_api_keys SET ${updates.join(', ')} WHERE workflow_id = ?`;
      await dbConnection.query(sql, values);

      logger.info('API Key配置更新成功', { workflowId, fields: Object.keys(config) });
      return true;
    } catch (error) {
      logger.error('更新API Key配置失败:', error);
      throw error;
    }
  }

  /**
   * 删除API Key
   * @param {number} workflowId - 工作流ID
   * @param {number} userId - 用户ID
   * @returns {boolean}
   */
  static async deleteByWorkflowId(workflowId, userId) {
    try {
      const sql = `DELETE FROM agent_api_keys WHERE workflow_id = ? AND user_id = ?`;
      const { rows } = await dbConnection.query(sql, [workflowId, userId]);
      const deleted = rows.affectedRows > 0;

      if (deleted) {
        logger.info('API Key删除成功', { workflowId, userId });
      }
      return deleted;
    } catch (error) {
      logger.error('删除API Key失败:', error);
      throw error;
    }
  }

  /**
   * 更新调用统计
   * 每次外部API调用后更新
   * @param {number} keyId - API Key ID
   * @param {number} creditsUsed - 本次消耗积分
   */
  static async updateCallStats(keyId, creditsUsed = 0) {
    try {
      const sql = `
        UPDATE agent_api_keys 
        SET total_calls = total_calls + 1,
            total_credits_used = total_credits_used + ?,
            last_called_at = NOW(),
            updated_at = NOW()
        WHERE id = ?
      `;
      await dbConnection.query(sql, [creditsUsed, keyId]);
    } catch (error) {
      logger.error('更新调用统计失败:', error);
      /* 统计更新失败不阻塞业务 */
    }
  }

  /**
   * 记录API调用日志
   * @param {Object} logData - 日志数据
   */
  static async logCall(logData) {
    try {
      const sql = `
        INSERT INTO agent_api_call_logs 
        (api_key_id, workflow_id, user_id, call_type, session_id, 
         caller_ip, credits_used, duration_ms, status, error_message)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      await dbConnection.query(sql, [
        logData.api_key_id, logData.workflow_id, logData.user_id,
        logData.call_type, logData.session_id || null,
        logData.caller_ip || null, logData.credits_used || 0,
        logData.duration_ms || null, logData.status || 'success',
        logData.error_message || null
      ]);
    } catch (error) {
      logger.error('记录API调用日志失败:', error);
      /* 日志记录失败不阻塞业务 */
    }
  }

  /**
   * 获取调用日志（分页）
   * @param {number} workflowId - 工作流ID
   * @param {Object} options - 分页参数
   * @returns {Object} { logs, pagination }
   */
  static async getCallLogs(workflowId, options = {}) {
    try {
      const { page = 1, limit = 20 } = options;
      const offset = (page - 1) * limit;

      const countSql = `SELECT COUNT(*) as total FROM agent_api_call_logs WHERE workflow_id = ?`;
      const { rows: countRows } = await dbConnection.query(countSql, [workflowId]);
      const total = countRows[0].total;

      const sql = `
        SELECT * FROM agent_api_call_logs 
        WHERE workflow_id = ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `;
      const { rows } = await dbConnection.query(sql, [workflowId, limit, offset]);

      return {
        logs: rows,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
      };
    } catch (error) {
      logger.error('获取调用日志失败:', error);
      throw error;
    }
  }

  /**
   * 验证访问控制
   * 检查频率限制、IP白名单、有效期、调用次数
   * @param {string} callerIp - 调用方IP
   * @returns {Object} { allowed: boolean, reason?: string }
   */
  validateAccess(callerIp) {
    /* 检查状态 */
    if (this.status !== 'active') {
      return { allowed: false, reason: 'API Key已停用' };
    }

    /* 检查有效期 */
    if (this.expires_at) {
      const expiresAt = new Date(this.expires_at);
      if (expiresAt < new Date()) {
        return { allowed: false, reason: 'API Key已过期' };
      }
    }

    /* 检查调用次数上限 */
    if (this.max_calls && this.total_calls >= this.max_calls) {
      return { allowed: false, reason: `已达到最大调用次数上限(${this.max_calls})` };
    }

    /* 检查IP白名单 */
    if (this.ip_whitelist) {
      let whitelist = this.ip_whitelist;
      if (typeof whitelist === 'string') {
        try { whitelist = JSON.parse(whitelist); } catch (e) { whitelist = []; }
      }
      if (Array.isArray(whitelist) && whitelist.length > 0) {
        if (!whitelist.includes(callerIp)) {
          return { allowed: false, reason: `IP ${callerIp} 不在白名单中` };
        }
      }
    }

    return { allowed: true };
  }

  /**
   * 输出安全信息（隐藏完整密钥）
   * @returns {Object}
   */
  toSafeJSON() {
    const masked = this.api_key
      ? `${this.api_key.substring(0, 7)}...${this.api_key.substring(this.api_key.length - 4)}`
      : null;

    /* 解析ip_whitelist */
    let ipWhitelist = this.ip_whitelist;
    if (typeof ipWhitelist === 'string') {
      try { ipWhitelist = JSON.parse(ipWhitelist); } catch (e) { ipWhitelist = []; }
    }

    return {
      id: this.id,
      workflow_id: this.workflow_id,
      user_id: this.user_id,
      api_key_masked: masked,
      key_name: this.key_name,
      status: this.status,
      rate_limit_per_minute: this.rate_limit_per_minute,
      ip_whitelist: ipWhitelist || [],
      expires_at: this.expires_at,
      max_calls: this.max_calls,
      total_calls: this.total_calls,
      total_credits_used: this.total_credits_used,
      last_called_at: this.last_called_at,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }
}

module.exports = AgentApiKey;

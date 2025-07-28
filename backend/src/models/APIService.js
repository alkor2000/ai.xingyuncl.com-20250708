/**
 * API服务模型
 */

const dbConnection = require('../database/connection');
const { DatabaseError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');
const crypto = require('crypto');

class APIService {
  constructor(serviceData) {
    Object.assign(this, serviceData);
  }

  /**
   * 生成API密钥
   */
  static generateApiKey(serviceId) {
    const timestamp = Date.now();
    const random = crypto.randomBytes(16).toString('hex');
    return `sk-${crypto.createHash('md5').update(`${serviceId}-${timestamp}-${random}`).digest('hex')}`;
  }

  /**
   * 获取所有服务
   */
  static async findAll(options = {}) {
    try {
      const { status = null } = options;
      
      let sql = `
        SELECT s.*, 
               COUNT(DISTINCT a.id) as action_count,
               SUM(CASE WHEN a.status = 'active' THEN 1 ELSE 0 END) as active_action_count
        FROM api_services s
        LEFT JOIN api_service_actions a ON s.service_id = a.service_id
      `;
      
      const conditions = [];
      const params = [];
      
      if (status) {
        conditions.push('s.status = ?');
        params.push(status);
      }
      
      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }
      
      sql += ' GROUP BY s.id ORDER BY s.created_at DESC';
      
      const { rows } = await dbConnection.query(sql, params);
      return rows.map(row => new APIService(row));
    } catch (error) {
      logger.error('获取API服务列表失败:', error);
      throw new DatabaseError('获取API服务列表失败', error);
    }
  }

  /**
   * 根据服务ID查找
   */
  static async findByServiceId(serviceId) {
    try {
      const sql = `
        SELECT * FROM api_services WHERE service_id = ?
      `;
      const { rows } = await dbConnection.query(sql, [serviceId]);
      
      if (rows.length === 0) {
        return null;
      }
      
      return new APIService(rows[0]);
    } catch (error) {
      logger.error('查找API服务失败:', error);
      throw new DatabaseError('查找API服务失败', error);
    }
  }

  /**
   * 验证API密钥
   */
  static async validateApiKey(serviceId, apiKey) {
    try {
      const sql = `
        SELECT * FROM api_services 
        WHERE service_id = ? AND api_key = ? AND status = 'active'
      `;
      const { rows } = await dbConnection.query(sql, [serviceId, apiKey]);
      
      return rows.length > 0 ? new APIService(rows[0]) : null;
    } catch (error) {
      logger.error('验证API密钥失败:', error);
      throw new DatabaseError('验证API密钥失败', error);
    }
  }

  /**
   * 创建服务
   */
  static async create(serviceData) {
    try {
      const {
        service_id,
        service_name,
        description = null
      } = serviceData;

      // 验证必填字段
      if (!service_id || !service_name) {
        throw new ValidationError('服务ID和名称为必填项');
      }

      // 生成API密钥
      const api_key = APIService.generateApiKey(service_id);

      const sql = `
        INSERT INTO api_services (service_id, service_name, api_key, description)
        VALUES (?, ?, ?, ?)
      `;

      const { rows } = await dbConnection.query(sql, [
        service_id, service_name, api_key, description
      ]);

      logger.info('API服务创建成功', { serviceId: service_id });

      return await APIService.findByServiceId(service_id);
    } catch (error) {
      logger.error('创建API服务失败:', error);
      
      if (error.code === 'ER_DUP_ENTRY') {
        throw new ValidationError('服务ID已存在');
      }
      
      throw new DatabaseError('创建API服务失败', error);
    }
  }

  /**
   * 更新服务
   */
  async update(updateData) {
    try {
      const allowedFields = ['service_name', 'description', 'status'];
      const updateFields = Object.keys(updateData)
        .filter(field => allowedFields.includes(field));
      
      if (updateFields.length === 0) {
        return this;
      }

      const setClause = updateFields.map(field => `${field} = ?`).join(', ');
      const values = updateFields.map(field => updateData[field]);
      values.push(this.service_id);

      const sql = `UPDATE api_services SET ${setClause} WHERE service_id = ?`;
      await dbConnection.query(sql, values);

      Object.assign(this, updateData);

      logger.info('API服务更新成功', { serviceId: this.service_id, updatedFields: updateFields });

      return this;
    } catch (error) {
      logger.error('更新API服务失败:', error);
      throw new DatabaseError('更新API服务失败', error);
    }
  }

  /**
   * 重置API密钥
   */
  async resetApiKey() {
    try {
      const newApiKey = APIService.generateApiKey(this.service_id);
      
      const sql = `UPDATE api_services SET api_key = ? WHERE service_id = ?`;
      await dbConnection.query(sql, [newApiKey, this.service_id]);
      
      this.api_key = newApiKey;
      
      logger.info('API密钥重置成功', { serviceId: this.service_id });
      
      return newApiKey;
    } catch (error) {
      logger.error('重置API密钥失败:', error);
      throw new DatabaseError('重置API密钥失败', error);
    }
  }

  /**
   * 删除服务
   */
  async delete() {
    try {
      const sql = 'DELETE FROM api_services WHERE service_id = ?';
      await dbConnection.query(sql, [this.service_id]);
      
      logger.info('API服务删除成功', { serviceId: this.service_id });
    } catch (error) {
      logger.error('删除API服务失败:', error);
      throw new DatabaseError('删除API服务失败', error);
    }
  }

  /**
   * 获取服务的操作列表
   */
  async getActions(options = {}) {
    try {
      const { status = null } = options;
      
      let sql = `
        SELECT * FROM api_service_actions 
        WHERE service_id = ?
      `;
      
      const params = [this.service_id];
      
      if (status) {
        sql += ' AND status = ?';
        params.push(status);
      }
      
      sql += ' ORDER BY created_at DESC';
      
      const { rows } = await dbConnection.query(sql, params);
      return rows;
    } catch (error) {
      logger.error('获取服务操作列表失败:', error);
      throw new DatabaseError('获取服务操作列表失败', error);
    }
  }

  /**
   * 获取特定操作的配置
   */
  async getAction(actionType) {
    try {
      const sql = `
        SELECT * FROM api_service_actions 
        WHERE service_id = ? AND action_type = ? AND status = 'active'
      `;
      
      const { rows } = await dbConnection.query(sql, [this.service_id, actionType]);
      
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      logger.error('获取服务操作配置失败:', error);
      throw new DatabaseError('获取服务操作配置失败', error);
    }
  }

  /**
   * 创建或更新操作配置
   */
  async upsertAction(actionData) {
    try {
      const {
        action_type,
        action_name,
        credits = 1,
        description = null,
        status = 'active'
      } = actionData;

      const sql = `
        INSERT INTO api_service_actions 
        (service_id, action_type, action_name, credits, description, status)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
        action_name = VALUES(action_name),
        credits = VALUES(credits),
        description = VALUES(description),
        status = VALUES(status)
      `;

      await dbConnection.query(sql, [
        this.service_id, action_type, action_name, credits, description, status
      ]);

      logger.info('服务操作配置更新成功', { 
        serviceId: this.service_id, 
        actionType: action_type 
      });

      return await this.getAction(action_type);
    } catch (error) {
      logger.error('更新服务操作配置失败:', error);
      throw new DatabaseError('更新服务操作配置失败', error);
    }
  }

  /**
   * 删除操作配置
   */
  async deleteAction(actionType) {
    try {
      const sql = `
        DELETE FROM api_service_actions 
        WHERE service_id = ? AND action_type = ?
      `;
      
      const { rows } = await dbConnection.query(sql, [this.service_id, actionType]);
      
      logger.info('服务操作配置删除成功', { 
        serviceId: this.service_id, 
        actionType: actionType 
      });
      
      return rows.affectedRows > 0;
    } catch (error) {
      logger.error('删除服务操作配置失败:', error);
      throw new DatabaseError('删除服务操作配置失败', error);
    }
  }

  /**
   * 检查请求是否重复
   */
  static async checkDuplicateRequest(requestId) {
    try {
      const sql = `
        SELECT id FROM credit_transactions 
        WHERE request_id = ? 
        AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      `;
      
      const { rows } = await dbConnection.query(sql, [requestId]);
      
      return rows.length > 0;
    } catch (error) {
      logger.error('检查重复请求失败:', error);
      throw new DatabaseError('检查重复请求失败', error);
    }
  }
}

module.exports = APIService;

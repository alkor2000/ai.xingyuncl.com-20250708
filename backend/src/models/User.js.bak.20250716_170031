/**
 * 用户数据模型 - 支持用户分组和积分管理 (事务优化版)
 */

const dbConnection = require('../database/connection');
const { DatabaseError } = require('../utils/errors');
const logger = require('../utils/logger');

class User {
  constructor(data = {}) {
    this.id = data.id || null;
    this.email = data.email || null;
    this.username = data.username || null;
    this.password_hash = data.password_hash || null;
    this.role = data.role || 'user';
    this.group_id = data.group_id || null;
    this.status = data.status || 'active';
    this.email_verified = data.email_verified || false;
    this.email_verification_token = data.email_verification_token || null;
    this.password_reset_token = data.password_reset_token || null;
    this.password_reset_expires = data.password_reset_expires || null;
    this.avatar_url = data.avatar_url || null;
    this.token_quota = data.token_quota || 10000;
    this.credits_quota = data.credits_quota || 1000;
    this.login_attempts = data.login_attempts || 0;
    this.used_tokens = data.used_tokens || 0;
    this.used_credits = data.used_credits || 0;
    this.last_login_at = data.last_login_at || null;
    this.created_at = data.created_at || null;
    this.updated_at = data.updated_at || null;
    // 分组信息 (从联表查询获得)
    this.group_name = data.group_name || null;
    this.group_color = data.group_color || null;
  }

  /**
   * 根据ID查找用户 (包含分组信息)
   */
  static async findById(id) {
    try {
      const sql = `
        SELECT u.*, g.name as group_name, g.color as group_color
        FROM users u 
        LEFT JOIN user_groups g ON u.group_id = g.id
        WHERE u.id = ?
      `;
      const { rows } = await dbConnection.query(sql, [id]);
      
      if (rows.length === 0) {
        return null;
      }
      
      return new User(rows[0]);
    } catch (error) {
      logger.error('根据ID查找用户失败:', error);
      throw new DatabaseError(`查找用户失败: ${error.message}`, error);
    }
  }

  /**
   * 根据邮箱查找用户
   */
  static async findByEmail(email) {
    try {
      const sql = `
        SELECT u.*, g.name as group_name, g.color as group_color
        FROM users u 
        LEFT JOIN user_groups g ON u.group_id = g.id
        WHERE u.email = ?
      `;
      const { rows } = await dbConnection.query(sql, [email]);
      
      if (rows.length === 0) {
        return null;
      }
      
      return new User(rows[0]);
    } catch (error) {
      logger.error('根据邮箱查找用户失败:', error);
      throw new DatabaseError(`查找用户失败: ${error.message}`, error);
    }
  }

  /**
   * 根据用户名查找用户
   */
  static async findByUsername(username) {
    try {
      const sql = `
        SELECT u.*, g.name as group_name, g.color as group_color
        FROM users u 
        LEFT JOIN user_groups g ON u.group_id = g.id
        WHERE u.username = ?
      `;
      const { rows } = await dbConnection.query(sql, [username]);
      
      if (rows.length === 0) {
        return null;
      }
      
      return new User(rows[0]);
    } catch (error) {
      logger.error('根据用户名查找用户失败:', error);
      throw new DatabaseError(`查找用户失败: ${error.message}`, error);
    }
  }

  /**
   * 获取用户列表 - 支持分组过滤和信息显示
   */
  static async getList(options = {}) {
    try {
      const { page = 1, limit = 20, role = null, status = null, group_id = null, search = null } = options;
      
      logger.info('开始获取用户列表', { page, limit, role, status, group_id, search });
      
      let whereConditions = [];
      let params = [];

      if (role) {
        whereConditions.push('u.role = ?');
        params.push(role);
      }

      if (status) {
        whereConditions.push('u.status = ?');
        params.push(status);
      }

      if (group_id) {
        whereConditions.push('u.group_id = ?');
        params.push(group_id);
      }

      if (search) {
        whereConditions.push('(u.username LIKE ? OR u.email LIKE ?)');
        params.push(`%${search}%`, `%${search}%`);
      }

      const whereClause = whereConditions.length > 0 
        ? `WHERE ${whereConditions.join(' AND ')}` 
        : '';

      // 获取总数
      const countSql = `
        SELECT COUNT(*) as total 
        FROM users u 
        LEFT JOIN user_groups g ON u.group_id = g.id 
        ${whereClause}
      `;
      const { rows: totalRows } = await dbConnection.query(countSql, params);
      const total = totalRows[0].total;

      logger.info('获取用户总数成功', { total, page, limit });

      // 获取用户列表 (包含分组信息)
      const offset = (page - 1) * limit;
      const listSql = `
        SELECT u.*, g.name as group_name, g.color as group_color
        FROM users u 
        LEFT JOIN user_groups g ON u.group_id = g.id
        ${whereClause} 
        ORDER BY u.created_at DESC 
        LIMIT ? OFFSET ?
      `;
      
      logger.info('执行用户列表查询', { 
        limit, 
        offset, 
        whereClause,
        paramsCount: params.length 
      });

      const { rows } = await dbConnection.simpleQuery(listSql, [...params, limit, offset]);

      logger.info('获取用户列表成功', { count: rows.length, total });

      return {
        users: rows.map(row => new User(row)),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('获取用户列表失败:', {
        error: error.message,
        stack: error.stack,
        options
      });
      throw new DatabaseError(`获取用户列表失败: ${error.message}`, error);
    }
  }

  /**
   * 创建新用户 - 支持分组设置
   */
  static async create(userData) {
    try {
      const {
        email,
        username,
        password,
        role = 'user',
        group_id = null,
        status = 'active',
        token_quota = 10000,
        credits_quota = 1000
      } = userData;

      const sql = `
        INSERT INTO users (email, username, password_hash, role, group_id, status, token_quota, credits_quota) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const { rows } = await dbConnection.query(sql, [
        email.toLowerCase(),
        username,
        password,
        role,
        group_id,
        status,
        token_quota,
        credits_quota
      ]);

      const insertId = rows.insertId;

      logger.info('用户创建成功', { 
        userId: insertId,
        email, 
        username, 
        role,
        group_id,
        credits_quota
      });

      return await User.findById(insertId);
    } catch (error) {
      logger.error('创建用户失败:', error);
      throw new DatabaseError(`创建用户失败: ${error.message}`, error);
    }
  }

  /**
   * 更新用户 - 支持分组更新
   */
  async update(updateData) {
    try {
      const fields = [];
      const values = [];
      
      const allowedFields = [
        'username', 'password_hash', 'role', 'group_id', 'status', 
        'email_verified', 'avatar_url', 'token_quota', 'used_tokens',
        'credits_quota', 'used_credits'
      ];
      
      allowedFields.forEach(field => {
        if (updateData.hasOwnProperty(field)) {
          fields.push(`${field} = ?`);
          values.push(updateData[field]);
        }
      });
      
      if (fields.length === 0) {
        return this;
      }
      
      fields.push('updated_at = CURRENT_TIMESTAMP');
      values.push(this.id);
      
      const sql = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
      
      await dbConnection.query(sql, values);

      logger.info('用户更新成功', { 
        userId: this.id,
        updateFields: Object.keys(updateData)
      });

      return await User.findById(this.id);
    } catch (error) {
      logger.error('更新用户失败:', error);
      throw new DatabaseError(`更新用户失败: ${error.message}`, error);
    }
  }

  /**
   * 删除用户
   */
  async delete() {
    try {
      const sql = 'DELETE FROM users WHERE id = ?';
      await dbConnection.query(sql, [this.id]);

      logger.info('用户删除成功', { 
        userId: this.id,
        email: this.email
      });
    } catch (error) {
      logger.error('删除用户失败:', error);
      throw new DatabaseError(`删除用户失败: ${error.message}`, error);
    }
  }

  // ===== 积分管理方法 (事务优化版) =====

  /**
   * 获取用户积分余额
   */
  getCredits() {
    return Math.max(0, (this.credits_quota || 0) - (this.used_credits || 0));
  }

  /**
   * 检查积分配额
   */
  hasCredits(requiredCredits = 1) {
    return this.getCredits() >= requiredCredits;
  }

  /**
   * 获取积分使用统计
   */
  getCreditsStats() {
    return {
      quota: this.credits_quota || 0,
      used: this.used_credits || 0,
      remaining: this.getCredits(),
      usageRate: this.credits_quota ? ((this.used_credits || 0) / this.credits_quota * 100).toFixed(2) : 0
    };
  }

  /**
   * 增加积分 (管理员操作) - 使用事务
   */
  async addCredits(amount, reason = '管理员充值', operatorId = null) {
    try {
      if (amount <= 0) {
        throw new Error('积分数量必须大于0');
      }

      // 使用事务确保原子性
      const result = await dbConnection.transaction(async (query) => {
        // 更新用户积分配额
        const updateSql = `
          UPDATE users 
          SET credits_quota = credits_quota + ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `;
        await query(updateSql, [amount, this.id]);

        // 获取更新后的余额
        const { rows: balanceRows } = await query(
          'SELECT credits_quota - used_credits as balance FROM users WHERE id = ?',
          [this.id]
        );
        const balanceAfter = balanceRows[0].balance;

        // 记录积分历史
        const historySql = `
          INSERT INTO credit_transactions 
          (user_id, amount, balance_after, transaction_type, description, operator_id)
          VALUES (?, ?, ?, 'admin_add', ?, ?)
        `;
        await query(historySql, [
          this.id, amount, balanceAfter, reason, operatorId
        ]);

        return { balanceAfter };
      });

      // 更新当前对象
      this.credits_quota += amount;

      logger.info('用户积分充值成功', {
        userId: this.id,
        amount,
        newQuota: this.credits_quota,
        balanceAfter: result.balanceAfter,
        reason,
        operatorId
      });

      return {
        success: true,
        amount,
        newQuota: this.credits_quota,
        balanceAfter: result.balanceAfter,
        message: '积分充值成功'
      };

    } catch (error) {
      logger.error('用户积分充值失败:', {
        userId: this.id,
        amount,
        reason,
        error: error.message
      });
      throw new DatabaseError(`积分充值失败: ${error.message}`, error);
    }
  }

  /**
   * 扣减积分 (管理员操作) - 使用事务
   */
  async deductCredits(amount, reason = '管理员扣减', operatorId = null) {
    try {
      if (amount <= 0) {
        throw new Error('扣减积分数量必须大于0');
      }

      // 检查余额是否充足
      if (!this.hasCredits(amount)) {
        throw new Error(`积分余额不足，当前余额: ${this.getCredits()}，需要: ${amount}`);
      }

      // 使用事务确保原子性
      const result = await dbConnection.transaction(async (query) => {
        // 更新用户已使用积分
        const updateSql = `
          UPDATE users 
          SET used_credits = used_credits + ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `;
        await query(updateSql, [amount, this.id]);

        // 获取更新后的余额
        const { rows: balanceRows } = await query(
          'SELECT credits_quota - used_credits as balance FROM users WHERE id = ?',
          [this.id]
        );
        const balanceAfter = balanceRows[0].balance;

        // 记录积分历史
        const historySql = `
          INSERT INTO credit_transactions 
          (user_id, amount, balance_after, transaction_type, description, operator_id)
          VALUES (?, ?, ?, 'admin_deduct', ?, ?)
        `;
        await query(historySql, [
          this.id, -amount, balanceAfter, reason, operatorId
        ]);

        return { balanceAfter };
      });

      // 更新当前对象
      this.used_credits += amount;

      logger.info('用户积分扣减成功', {
        userId: this.id,
        amount,
        newUsed: this.used_credits,
        balanceAfter: result.balanceAfter,
        reason,
        operatorId
      });

      return {
        success: true,
        amount,
        newUsed: this.used_credits,
        balanceAfter: result.balanceAfter,
        message: '积分扣减成功'
      };

    } catch (error) {
      logger.error('用户积分扣减失败:', {
        userId: this.id,
        amount,
        reason,
        error: error.message
      });
      throw new DatabaseError(`积分扣减失败: ${error.message}`, error);
    }
  }

  /**
   * 消耗积分 (AI对话) - 使用事务
   */
  async consumeCredits(amount, modelId = null, conversationId = null, reason = 'AI对话消费') {
    try {
      if (amount <= 0) {
        throw new Error('消费积分数量必须大于0');
      }

      // 检查余额是否充足
      if (!this.hasCredits(amount)) {
        throw new Error(`积分余额不足，当前余额: ${this.getCredits()}，需要: ${amount}`);
      }

      // 使用事务确保原子性
      const result = await dbConnection.transaction(async (query) => {
        // 更新用户已使用积分
        const updateSql = `
          UPDATE users 
          SET used_credits = used_credits + ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `;
        await query(updateSql, [amount, this.id]);

        // 获取更新后的余额
        const { rows: balanceRows } = await query(
          'SELECT credits_quota - used_credits as balance FROM users WHERE id = ?',
          [this.id]
        );
        const balanceAfter = balanceRows[0].balance;

        // 记录积分消费历史
        const historySql = `
          INSERT INTO credit_transactions 
          (user_id, amount, balance_after, transaction_type, description, 
           related_model_id, related_conversation_id)
          VALUES (?, ?, ?, 'chat_consume', ?, ?, ?)
        `;
        await query(historySql, [
          this.id, -amount, balanceAfter, reason, modelId, conversationId
        ]);

        return { balanceAfter };
      });

      // 更新当前对象
      this.used_credits += amount;

      logger.info('用户积分消费成功', {
        userId: this.id,
        amount,
        modelId,
        conversationId,
        balanceAfter: result.balanceAfter,
        reason
      });

      return {
        success: true,
        amount,
        balanceAfter: result.balanceAfter,
        message: '积分消费成功'
      };

    } catch (error) {
      logger.error('用户积分消费失败:', {
        userId: this.id,
        amount,
        modelId,
        conversationId,
        error: error.message
      });
      throw new DatabaseError(`积分消费失败: ${error.message}`, error);
    }
  }

  /**
   * 设置积分配额 (管理员操作) - 使用事务
   */
  async setCreditsQuota(newQuota, reason = '管理员设置配额', operatorId = null) {
    try {
      if (newQuota < 0) {
        throw new Error('积分配额不能为负数');
      }

      const oldQuota = this.credits_quota || 0;
      const quotaDiff = newQuota - oldQuota;

      // 使用事务确保原子性
      const result = await dbConnection.transaction(async (query) => {
        // 更新用户积分配额
        const updateSql = `
          UPDATE users 
          SET credits_quota = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `;
        await query(updateSql, [newQuota, this.id]);

        // 获取更新后的余额
        const { rows: balanceRows } = await query(
          'SELECT credits_quota - used_credits as balance FROM users WHERE id = ?',
          [this.id]
        );
        const balanceAfter = balanceRows[0].balance;

        // 记录积分历史
        const historySql = `
          INSERT INTO credit_transactions 
          (user_id, amount, balance_after, transaction_type, description, operator_id)
          VALUES (?, ?, ?, 'admin_set', ?, ?)
        `;
        await query(historySql, [
          this.id, quotaDiff, balanceAfter, `${reason} (从 ${oldQuota} 调整为 ${newQuota})`, operatorId
        ]);

        return { balanceAfter };
      });

      // 更新当前对象
      this.credits_quota = newQuota;

      logger.info('用户积分配额设置成功', {
        userId: this.id,
        oldQuota,
        newQuota,
        quotaDiff,
        balanceAfter: result.balanceAfter,
        reason,
        operatorId
      });

      return {
        success: true,
        oldQuota,
        newQuota,
        quotaDiff,
        balanceAfter: result.balanceAfter,
        message: '积分配额设置成功'
      };

    } catch (error) {
      logger.error('用户积分配额设置失败:', {
        userId: this.id,
        newQuota,
        reason,
        error: error.message
      });
      throw new DatabaseError(`积分配额设置失败: ${error.message}`, error);
    }
  }

  /**
   * 获取积分使用历史
   */
  static async getCreditHistory(userId, options = {}) {
    try {
      const { page = 1, limit = 20, transaction_type = null } = options;
      
      let whereConditions = ['ct.user_id = ?'];
      let params = [userId];

      if (transaction_type) {
        whereConditions.push('ct.transaction_type = ?');
        params.push(transaction_type);
      }

      const whereClause = whereConditions.join(' AND ');

      // 获取总数
      const countSql = `SELECT COUNT(*) as total FROM credit_transactions ct WHERE ${whereClause}`;
      const { rows: totalRows } = await dbConnection.query(countSql, params);
      const total = totalRows[0].total;

      // 获取历史记录
      const offset = (page - 1) * limit;
      const listSql = `
        SELECT ct.*, am.display_name as model_name, u.username as operator_name
        FROM credit_transactions ct
        LEFT JOIN ai_models am ON ct.related_model_id = am.id
        LEFT JOIN users u ON ct.operator_id = u.id
        WHERE ${whereClause}
        ORDER BY ct.created_at DESC
        LIMIT ? OFFSET ?
      `;

      const { rows } = await dbConnection.simpleQuery(listSql, [...params, limit, offset]);

      logger.info('获取积分历史成功', { userId, count: rows.length, total });

      return {
        history: rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / limit)
        }
      };

    } catch (error) {
      logger.error('获取积分历史失败:', {
        userId,
        error: error.message
      });
      throw new DatabaseError(`获取积分历史失败: ${error.message}`, error);
    }
  }

  // ===== 分组管理方法 (保持不变) =====

  /**
   * 获取用户分组列表
   */
  static async getGroups() {
    try {
      const sql = `
        SELECT g.*, 
               COUNT(u.id) as user_count,
               AVG(u.used_tokens) as avg_tokens_used,
               AVG(u.used_credits) as avg_credits_used
        FROM user_groups g
        LEFT JOIN users u ON g.id = u.group_id AND u.status = 'active'
        GROUP BY g.id
        ORDER BY g.sort_order ASC, g.created_at ASC
      `;
      
      const { rows } = await dbConnection.query(sql);
      
      logger.info('获取用户分组列表成功', { count: rows.length });
      
      return rows;
    } catch (error) {
      logger.error('获取用户分组列表失败:', error);
      throw new DatabaseError(`获取用户分组列表失败: ${error.message}`, error);
    }
  }

  /**
   * 创建用户分组
   */
  static async createGroup(groupData, createdBy) {
    try {
      const { name, description, color = '#1677ff', is_active = 1, sort_order = 0 } = groupData;

      const sql = `
        INSERT INTO user_groups (name, description, color, is_active, sort_order, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `;

      const { rows } = await dbConnection.query(sql, [
        name, description, color, is_active, sort_order, createdBy
      ]);

      const groupId = rows.insertId;

      logger.info('用户分组创建成功', { 
        groupId, 
        name, 
        createdBy 
      });

      return await User.getGroupById(groupId);
    } catch (error) {
      logger.error('创建用户分组失败:', error);
      throw new DatabaseError(`创建用户分组失败: ${error.message}`, error);
    }
  }

  /**
   * 根据ID获取分组
   */
  static async getGroupById(id) {
    try {
      const sql = `
        SELECT g.*, 
               COUNT(u.id) as user_count,
               AVG(u.used_tokens) as avg_tokens_used,
               AVG(u.used_credits) as avg_credits_used
        FROM user_groups g
        LEFT JOIN users u ON g.id = u.group_id AND u.status = 'active'
        WHERE g.id = ?
        GROUP BY g.id
      `;
      
      const { rows } = await dbConnection.query(sql, [id]);
      
      if (rows.length === 0) {
        return null;
      }
      
      return rows[0];
    } catch (error) {
      logger.error('根据ID获取分组失败:', error);
      throw new DatabaseError(`获取分组失败: ${error.message}`, error);
    }
  }

  /**
   * 更新用户分组
   */
  static async updateGroup(groupId, updateData) {
    try {
      const fields = [];
      const values = [];
      
      const allowedFields = ['name', 'description', 'color', 'is_active', 'sort_order'];
      
      allowedFields.forEach(field => {
        if (updateData.hasOwnProperty(field)) {
          fields.push(`${field} = ?`);
          values.push(updateData[field]);
        }
      });
      
      if (fields.length === 0) {
        throw new Error('没有有效的更新字段');
      }
      
      fields.push('updated_at = CURRENT_TIMESTAMP');
      values.push(groupId);
      
      const sql = `UPDATE user_groups SET ${fields.join(', ')} WHERE id = ?`;
      await dbConnection.query(sql, values);

      logger.info('用户分组更新成功', { 
        groupId,
        updateFields: Object.keys(updateData)
      });

      return await User.getGroupById(groupId);
    } catch (error) {
      logger.error('更新用户分组失败:', error);
      throw new DatabaseError(`更新用户分组失败: ${error.message}`, error);
    }
  }

  /**
   * 删除用户分组
   */
  static async deleteGroup(groupId) {
    try {
      // 检查是否有用户在此分组
      const { rows: userCheck } = await dbConnection.query(
        'SELECT COUNT(*) as count FROM users WHERE group_id = ?', [groupId]
      );

      if (userCheck[0].count > 0) {
        throw new Error(`该分组下还有 ${userCheck[0].count} 个用户，无法删除`);
      }

      const sql = 'DELETE FROM user_groups WHERE id = ?';
      await dbConnection.query(sql, [groupId]);

      logger.info('用户分组删除成功', { groupId });
    } catch (error) {
      logger.error('删除用户分组失败:', error);
      throw new DatabaseError(`删除用户分组失败: ${error.message}`, error);
    }
  }

  // ===== 其他方法 (保持不变) =====

  /**
   * 更新最后登录时间
   */
  async updateLastLogin() {
    try {
      const sql = 'UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?';
      await dbConnection.query(sql, [this.id]);
      
      logger.info('更新用户最后登录时间', { userId: this.id });
    } catch (error) {
      logger.error('更新最后登录时间失败:', error);
    }
  }

  /**
   * 更新Token使用量
   */
  async updateTokenUsage(tokens) {
    try {
      const sql = 'UPDATE users SET used_tokens = used_tokens + ? WHERE id = ?';
      await dbConnection.query(sql, [tokens, this.id]);
      
      this.used_tokens = (this.used_tokens || 0) + tokens;
      
      logger.info('更新用户Token使用量', { 
        userId: this.id, 
        tokens,
        totalUsed: this.used_tokens
      });
    } catch (error) {
      logger.error('更新Token使用量失败:', error);
    }
  }

  /**
   * 获取用户权限 - 可基于分组扩展权限
   */
  async getPermissions() {
    try {
      // 超级管理员拥有所有权限
      if (this.role === 'super_admin') {
        return ['chat.use', 'file.upload', 'system.all', 'user.manage', 'group.manage', 'credits.manage', 'admin.*'];
      }

      // 管理员权限 (包含分组管理和积分管理)
      if (this.role === 'admin') {
        return ['chat.use', 'file.upload', 'user.manage', 'group.manage', 'credits.manage'];
      }

      // 普通用户权限
      if (this.role === 'user') {
        return ['chat.use', 'file.upload'];
      }

      return [];
    } catch (error) {
      logger.error('获取用户权限失败:', error);
      return [];
    }
  }

  /**
   * 检查用户状态
   */
  isActive() {
    return this.status === 'active';
  }

  /**
   * 检查邮箱是否已验证
   */
  isEmailVerified() {
    return this.email_verified === 1 || this.email_verified === true;
  }

  /**
   * 检查Token配额
   */
  hasTokenQuota(requiredTokens = 1) {
    const currentUsed = this.used_tokens || 0;
    const quota = this.token_quota || 10000;
    return (currentUsed + requiredTokens) <= quota;
  }

  /**
   * 检查是否超出Token配额
   */
  isTokenQuotaExceeded() {
    return !this.hasTokenQuota();
  }

  /**
   * 获取剩余Token配额
   */
  getRemainingTokens() {
    return Math.max(0, (this.token_quota || 10000) - (this.used_tokens || 0));
  }

  /**
   * 检查Token配额是否足够
   */
  checkTokenQuota(requiredTokens = 1) {
    return this.hasTokenQuota(requiredTokens);
  }

  /**
   * 转换为JSON (包含分组信息和积分信息)
   */
  toJSON() {
    const userData = { ...this };
    delete userData.password_hash;
    return {
      ...userData,
      credits_stats: this.getCreditsStats()
    };
  }
}

module.exports = User;

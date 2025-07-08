/**
 * 用户数据模型
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
    this.status = data.status || 'active';
    this.email_verified = data.email_verified || false;
    this.email_verification_token = data.email_verification_token || null;
    this.password_reset_token = data.password_reset_token || null;
    this.password_reset_expires = data.password_reset_expires || null;
    this.avatar_url = data.avatar_url || null;
    this.token_quota = data.token_quota || 10000;
    this.login_attempts = data.login_attempts || 0;
    this.used_tokens = data.used_tokens || 0;
    this.last_login_at = data.last_login_at || null;
    this.created_at = data.created_at || null;
    this.updated_at = data.updated_at || null;
  }

  /**
   * 根据ID查找用户
   */
  static async findById(id) {
    try {
      const sql = 'SELECT * FROM users WHERE id = ?';
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
      const sql = 'SELECT * FROM users WHERE email = ?';
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
      const sql = 'SELECT * FROM users WHERE username = ?';
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
   * 获取用户列表 - 修复LIMIT/OFFSET参数绑定问题
   */
  static async getList(options = {}) {
    try {
      const { page = 1, limit = 20, role = null, status = null, search = null } = options;
      
      logger.info('开始获取用户列表', { page, limit, role, status, search });
      
      let whereConditions = [];
      let params = [];

      if (role) {
        whereConditions.push('role = ?');
        params.push(role);
      }

      if (status) {
        whereConditions.push('status = ?');
        params.push(status);
      }

      if (search) {
        whereConditions.push('(username LIKE ? OR email LIKE ?)');
        params.push(`%${search}%`, `%${search}%`);
      }

      const whereClause = whereConditions.length > 0 
        ? `WHERE ${whereConditions.join(' AND ')}` 
        : '';

      // 获取总数 - 使用普通查询
      const countSql = `SELECT COUNT(*) as total FROM users ${whereClause}`;
      const { rows: totalRows } = await dbConnection.query(countSql, params);
      const total = totalRows[0].total;

      logger.info('获取用户总数成功', { total, page, limit });

      // 获取用户列表 - 使用simpleQuery避免LIMIT/OFFSET参数绑定问题
      const offset = (page - 1) * limit;
      const listSql = `
        SELECT * FROM users ${whereClause} 
        ORDER BY created_at DESC 
        LIMIT ? OFFSET ?
      `;
      
      logger.info('执行用户列表查询', { 
        limit, 
        offset, 
        whereClause,
        paramsCount: params.length 
      });

      // 使用simpleQuery方法处理LIMIT/OFFSET
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
   * 创建新用户
   */
  static async create(userData) {
    try {
      const {
        email,
        username,
        password,
        role = 'user',
        status = 'active',
        token_quota = 10000
      } = userData;

      const sql = `
        INSERT INTO users (email, username, password_hash, role, status, token_quota) 
        VALUES (?, ?, ?, ?, ?, ?)
      `;

      const { rows } = await dbConnection.query(sql, [
        email.toLowerCase(),
        username,
        password, // 明文密码存储
        role,
        status,
        token_quota
      ]);

      const insertId = rows.insertId;

      logger.info('用户创建成功', { 
        userId: insertId,
        email, 
        username, 
        role 
      });

      return await User.findById(insertId);
    } catch (error) {
      logger.error('创建用户失败:', error);
      throw new DatabaseError(`创建用户失败: ${error.message}`, error);
    }
  }

  /**
   * 更新用户
   */
  async update(updateData) {
    try {
      const fields = [];
      const values = [];
      
      const allowedFields = [
        'username', 'password_hash', 'role', 'status', 
        'email_verified', 'avatar_url', 'token_quota', 'used_tokens'
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
      
      // 更新当前对象的used_tokens值
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
   * 获取用户权限
   */
  async getPermissions() {
    try {
      // 超级管理员拥有所有权限
      if (this.role === 'super_admin') {
        return ['chat.use', 'file.upload', 'system.all', 'user.manage', 'admin.*'];
      }

      // 管理员权限
      if (this.role === 'admin') {
        return ['chat.use', 'file.upload', 'user.manage'];
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
   * 检查Token配额 - 修复chatController依赖的方法
   */
  hasTokenQuota(requiredTokens = 1) {
    const currentUsed = this.used_tokens || 0;
    const quota = this.token_quota || 10000;
    return (currentUsed + requiredTokens) <= quota;
  }

  /**
   * 检查是否超出Token配额 - 兼容性方法
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
   * 检查Token配额是否足够 - 别名方法，确保兼容性
   */
  checkTokenQuota(requiredTokens = 1) {
    return this.hasTokenQuota(requiredTokens);
  }

  /**
   * 转换为JSON
   */
  toJSON() {
    const userData = { ...this };
    delete userData.password_hash; // 不返回密码
    return userData;
  }
}

module.exports = User;

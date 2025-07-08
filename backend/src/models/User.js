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
    this.token_quota = data.token_quota || 0;
    this.used_tokens = data.used_tokens || 0;
    this.last_login_at = data.last_login_at || null;
    this.created_at = data.created_at || null;
    this.updated_at = data.updated_at || null;
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
   * 创建新用户
   */
  static async create(userData) {
    try {
      const { email, username, password, role = 'user', status = 'active', token_quota = 10000 } = userData;

      const sql = `
        INSERT INTO users (email, username, password_hash, role, status, token_quota) 
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      
      // 使用明文密码
      const { rows } = await dbConnection.query(sql, [
        email, 
        username, 
        password, // 直接存储明文密码
        role, 
        status, 
        token_quota
      ]);

      logger.info('用户创建成功', { 
        userId: rows.insertId, 
        email, 
        username, 
        role 
      });

      return await User.findById(rows.insertId);
    } catch (error) {
      logger.error('用户创建失败:', error);
      if (error.code === 'ER_DUP_ENTRY') {
        throw new DatabaseError('邮箱或用户名已被使用', error);
      }
      throw new DatabaseError(`用户创建失败: ${error.message}`, error);
    }
  }

  /**
   * 获取用户列表
   */
  static async getList(options = {}) {
    try {
      const { page = 1, limit = 20, role = null, status = null, search = null } = options;
      
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

      const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

      // 获取总数
      const countSql = `SELECT COUNT(*) as total FROM users ${whereClause}`;
      const { rows: totalRows } = await dbConnection.query(countSql, params);
      const total = totalRows[0].total;

      // 获取用户列表
      const offset = (page - 1) * limit;
      const listSql = `
        SELECT * FROM users ${whereClause} 
        ORDER BY created_at DESC 
        LIMIT ? OFFSET ?
      `;

      const { rows } = await dbConnection.query(listSql, [...params, limit, offset]);

      return {
        users: rows.map(row => new User(row)),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('获取用户列表失败:', error);
      throw new DatabaseError(`获取用户列表失败: ${error.message}`, error);
    }
  }

  /**
   * 更新最后登录时间
   */
  async updateLastLogin() {
    try {
      const sql = 'UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?';
      await dbConnection.query(sql, [this.id]);
      this.last_login_at = new Date();
    } catch (error) {
      logger.error('更新最后登录时间失败:', error);
      // 非关键错误，不抛出异常
    }
  }

  /**
   * 更新Token使用量
   */
  async updateTokenUsage(tokens) {
    try {
      const sql = 'UPDATE users SET used_tokens = used_tokens + ? WHERE id = ?';
      await dbConnection.query(sql, [tokens, this.id]);
      this.used_tokens += tokens;

      logger.info('用户Token使用量更新', { 
        userId: this.id, 
        addedTokens: tokens, 
        totalUsed: this.used_tokens 
      });
    } catch (error) {
      logger.error('更新Token使用量失败:', error);
      throw new DatabaseError(`更新Token使用量失败: ${error.message}`, error);
    }
  }

  /**
   * 检查Token配额
   */
  hasTokenQuota(requiredTokens) {
    return (this.used_tokens + requiredTokens) <= this.token_quota;
  }

  /**
   * 获取用户权限
   */
  async getPermissions() {
    try {
      const sql = 'SELECT permission_type FROM permissions WHERE user_id = ?';
      const { rows } = await dbConnection.query(sql, [this.id]);
      
      const permissions = rows.map(row => row.permission_type);
      
      // 根据角色添加默认权限
      if (this.role === 'super_admin') {
        permissions.push('system.all', 'user.manage', 'chat.use', 'file.upload');
      } else if (this.role === 'admin') {
        permissions.push('user.manage', 'chat.use', 'file.upload');
      } else if (this.role === 'user') {
        permissions.push('chat.use', 'file.upload');
      }
      
      // 去重
      return [...new Set(permissions)];
    } catch (error) {
      logger.error('获取用户权限失败:', error);
      throw new DatabaseError(`获取用户权限失败: ${error.message}`, error);
    }
  }

  /**
   * 检查用户是否有特定权限
   */
  async hasPermission(permission) {
    const permissions = await this.getPermissions();
    return permissions.includes(permission);
  }

  /**
   * 转换为JSON（隐藏敏感信息）
   */
  toJSON() {
    return {
      id: this.id,
      email: this.email,
      username: this.username,
      role: this.role,
      status: this.status,
      token_quota: this.token_quota,
      used_tokens: this.used_tokens,
      last_login_at: this.last_login_at,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }

  /**
   * 获取完整信息（包含敏感数据，仅供内部使用）
   */
  toFullJSON() {
    return {
      id: this.id,
      email: this.email,
      username: this.username,
      password_hash: this.password_hash,
      role: this.role,
      status: this.status,
      token_quota: this.token_quota,
      used_tokens: this.used_tokens,
      last_login_at: this.last_login_at,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }
}

module.exports = User;

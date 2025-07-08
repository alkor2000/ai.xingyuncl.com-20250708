/**
 * 用户数据模型
 */

const dbConnection = require('../database/connection');
const { DatabaseError, AuthenticationError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

class User {
  constructor(data = {}) {
    this.id = data.id || null;
    this.email = data.email || null;
    this.username = data.username || null;
    this.password_hash = data.password_hash || null;
    this.role = data.role || 'user';
    this.status = data.status || 'active';
    this.token_quota = data.token_quota || 10000;
    this.used_tokens = data.used_tokens || 0;
    this.avatar_url = data.avatar_url || null;
    this.last_login_at = data.last_login_at || null; // 修正字段名
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
      const { email, username, password, role = 'user', token_quota = 10000 } = userData;
      
      // 检查邮箱是否已存在
      const existingEmailUser = await User.findByEmail(email);
      if (existingEmailUser) {
        throw new ValidationError('该邮箱已被注册');
      }
      
      // 检查用户名是否已存在
      const existingUsernameUser = await User.findByUsername(username);
      if (existingUsernameUser) {
        throw new ValidationError('该用户名已被使用');
      }

      const sql = `
        INSERT INTO users (email, username, password_hash, role, token_quota) 
        VALUES (?, ?, ?, ?, ?)
      `;
      
      const { rows } = await dbConnection.query(sql, [email, username, password, role, token_quota]);

      logger.info('用户创建成功', { 
        userId: rows.insertId, 
        email, 
        username, 
        role 
      });

      return await User.findById(rows.insertId);
    } catch (error) {
      logger.error('用户创建失败:', error);
      throw error;
    }
  }

  /**
   * 验证用户密码
   */
  static async validateCredentials(email, password) {
    try {
      const user = await User.findByEmail(email);
      if (!user) {
        throw new AuthenticationError('邮箱或密码错误');
      }
      
      if (user.status !== 'active') {
        throw new AuthenticationError('用户账户已被禁用');
      }
      
      // 简化版密码验证（生产环境应该使用bcrypt）
      if (user.password_hash !== password) {
        throw new AuthenticationError('邮箱或密码错误');
      }
      
      return user;
    } catch (error) {
      logger.error('验证用户凭证失败:', error);
      throw error;
    }
  }

  /**
   * 更新最后登录时间
   */
  async updateLastLogin(ip) {
    try {
      const sql = `
        UPDATE users 
        SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `;
      
      await dbConnection.query(sql, [this.id]);
      
      this.last_login_at = new Date();

      logger.info('用户登录信息更新', { userId: this.id, ip });
    } catch (error) {
      logger.error('更新用户登录信息失败:', error);
      throw new DatabaseError(`更新登录信息失败: ${error.message}`, error);
    }
  }

  /**
   * 获取用户权限列表
   */
  async getPermissions() {
    try {
      const sql = `
        SELECT permission_type FROM permissions WHERE user_id = ?
      `;
      
      const { rows } = await dbConnection.query(sql, [this.id]);
      
      const permissions = rows.map(row => row.permission_type);
      
      // 根据角色添加默认权限
      const rolePermissions = this.getDefaultPermissions();
      return [...new Set([...permissions, ...rolePermissions])];
    } catch (error) {
      logger.error('获取用户权限失败:', error);
      return this.getDefaultPermissions();
    }
  }

  /**
   * 获取角色默认权限
   */
  getDefaultPermissions() {
    const permissionMap = {
      'super_admin': [
        'user.manage',
        'system.all',
        'chat.use',
        'file.upload',
        'admin.access'
      ],
      'admin': [
        'user.manage',
        'chat.use',
        'file.upload',
        'admin.access'
      ],
      'user': [
        'chat.use',
        'file.upload'
      ]
    };
    
    return permissionMap[this.role] || permissionMap['user'];
  }

  /**
   * 检查Token配额是否足够
   */
  hasTokenQuota(requiredTokens) {
    return (this.used_tokens + requiredTokens) <= this.token_quota;
  }

  /**
   * 更新Token使用量
   */
  async updateTokenUsage(tokens) {
    try {
      const sql = `
        UPDATE users 
        SET used_tokens = used_tokens + ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `;
      
      await dbConnection.query(sql, [tokens, this.id]);
      
      this.used_tokens += tokens;

      logger.info('用户Token使用量更新', { 
        userId: this.id, 
        tokens,
        totalUsed: this.used_tokens,
        quota: this.token_quota
      });
    } catch (error) {
      logger.error('更新用户Token使用量失败:', error);
      throw new DatabaseError(`更新Token使用量失败: ${error.message}`, error);
    }
  }

  /**
   * 获取用户列表（管理员功能）
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
        SELECT id, email, username, role, status, token_quota, used_tokens, 
               last_login_at, created_at, updated_at
        FROM users ${whereClause} 
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
      avatar_url: this.avatar_url,
      last_login_at: this.last_login_at,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }

  /**
   * 转换为安全的JSON（用于JWT等）
   */
  toSafeJSON() {
    return {
      id: this.id,
      email: this.email,
      username: this.username,
      role: this.role,
      status: this.status
    };
  }
}

module.exports = User;

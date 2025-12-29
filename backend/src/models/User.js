/**
 * 用户模型 - 支持用户分组、积分管理、UUID和软删除（自动重命名释放唯一字段）
 * 
 * 软删除说明：
 * - deleted_at IS NULL     → 正常用户
 * - deleted_at IS NOT NULL → 已删除用户
 * - 删除时自动重命名 email/username/uuid，释放唯一字段，允许重新注册
 * - 所有查询自动过滤已删除用户
 * 
 * 更新记录：
 * - v1.1 (2025-01-XX): 新增 can_view_chat_history 字段
 *   * 仅对组管理员(role=admin)有效
 *   * 控制组管理员是否可以查看组员的对话记录
 */

const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const dbConnection = require('../database/connection');
const { DatabaseError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

class User {
  constructor(userData) {
    Object.assign(this, userData);
  }

  // 转换为JSON（隐藏敏感信息）
  toJSON() {
    const { password_hash, password_reset_token, email_verification_token, ...safeUser } = this;
    
    // 添加积分统计信息
    if (this.credits_quota !== undefined && this.used_credits !== undefined) {
      safeUser.credits_stats = this.getCreditsStats();
    }
    
    // 添加账号有效期信息
    safeUser.account_stats = {
      isExpired: this.isAccountExpired(),
      expireAt: this.expire_at,
      remainingDays: this.getAccountRemainingDays()
    };
    
    // 添加组的站点配置信息
    if (this.group_site_customization_enabled) {
      safeUser.group_site_config = {
        enabled: this.group_site_customization_enabled,
        site_name: this.group_site_name,
        site_logo: this.group_site_logo
      };
    }

    // v1.1新增：添加查看对话记录权限字段（仅对组管理员有意义）
    safeUser.can_view_chat_history = this.can_view_chat_history === 1 || this.can_view_chat_history === true;
    
    return safeUser;
  }

  /**
   * 根据ID查找用户（自动过滤已删除）
   */
  static async findById(id) {
    try {
      const sql = `
        SELECT u.*, 
               g.name as group_name, 
               g.color as group_color, 
               g.expire_date as group_expire_date,
               g.site_customization_enabled as group_site_customization_enabled,
               g.site_name as group_site_name,
               g.site_logo as group_site_logo
        FROM users u
        LEFT JOIN user_groups g ON u.group_id = g.id
        WHERE u.id = ? AND u.deleted_at IS NULL
      `;
      const { rows } = await dbConnection.query(sql, [id]);
      
      if (rows.length === 0) {
        return null;
      }
      
      return new User(rows[0]);
    } catch (error) {
      logger.error('根据ID查找用户失败:', error);
      throw new DatabaseError('查找用户失败', error);
    }
  }

  /**
   * 根据UUID查找用户（自动过滤已删除）
   */
  static async findByUUID(uuid) {
    try {
      const sql = `
        SELECT u.*, 
               g.name as group_name, 
               g.color as group_color, 
               g.expire_date as group_expire_date,
               g.site_customization_enabled as group_site_customization_enabled,
               g.site_name as group_site_name,
               g.site_logo as group_site_logo
        FROM users u
        LEFT JOIN user_groups g ON u.group_id = g.id
        WHERE u.uuid = ? AND u.deleted_at IS NULL
      `;
      const { rows } = await dbConnection.query(sql, [uuid]);
      
      if (rows.length === 0) {
        return null;
      }
      
      return new User(rows[0]);
    } catch (error) {
      logger.error('根据UUID查找用户失败:', error);
      throw new DatabaseError('查找用户失败', error);
    }
  }

  /**
   * 根据邮箱查找用户（自动过滤已删除）
   */
  static async findByEmail(email) {
    try {
      const sql = `
        SELECT u.*, 
               g.name as group_name, 
               g.color as group_color, 
               g.expire_date as group_expire_date,
               g.site_customization_enabled as group_site_customization_enabled,
               g.site_name as group_site_name,
               g.site_logo as group_site_logo
        FROM users u
        LEFT JOIN user_groups g ON u.group_id = g.id
        WHERE u.email = ? AND u.deleted_at IS NULL
      `;
      const { rows } = await dbConnection.query(sql, [email]);
      
      if (rows.length === 0) {
        return null;
      }
      
      return new User(rows[0]);
    } catch (error) {
      logger.error('根据邮箱查找用户失败:', error);
      throw new DatabaseError('查找用户失败', error);
    }
  }

  /**
   * 根据用户名查找用户（自动过滤已删除）
   */
  static async findByUsername(username) {
    try {
      const sql = `
        SELECT u.*, 
               g.name as group_name, 
               g.color as group_color, 
               g.expire_date as group_expire_date,
               g.site_customization_enabled as group_site_customization_enabled,
               g.site_name as group_site_name,
               g.site_logo as group_site_logo
        FROM users u
        LEFT JOIN user_groups g ON u.group_id = g.id
        WHERE u.username = ? AND u.deleted_at IS NULL
      `;
      const { rows } = await dbConnection.query(sql, [username]);
      
      if (rows.length === 0) {
        return null;
      }
      
      return new User(rows[0]);
    } catch (error) {
      logger.error('根据用户名查找用户失败:', error);
      throw new DatabaseError('查找用户失败', error);
    }
  }

  /**
   * 根据手机号查找用户（自动过滤已删除）
   */
  static async findByPhone(phone) {
    try {
      const sql = `
        SELECT u.*, 
               g.name as group_name, 
               g.color as group_color, 
               g.expire_date as group_expire_date,
               g.site_customization_enabled as group_site_customization_enabled,
               g.site_name as group_site_name,
               g.site_logo as group_site_logo
        FROM users u
        LEFT JOIN user_groups g ON u.group_id = g.id
        WHERE u.phone = ? AND u.deleted_at IS NULL
      `;
      const { rows } = await dbConnection.query(sql, [phone]);
      
      if (rows.length === 0) {
        return null;
      }
      
      return new User(rows[0]);
    } catch (error) {
      logger.error('根据手机号查找用户失败:', error);
      throw new DatabaseError('查找用户失败', error);
    }
  }

  /**
   * 创建用户（支持UUID）
   */
  static async create(userData) {
    try {
      const {
        uuid = null,
        uuid_source = 'system',
        email,
        username,
        password,
        phone = null,
        role = 'user',
        group_id = 1,
        status = 'active',
        remark = null,
        token_quota = 10000,
        credits_expire_days = 365
      } = userData;

      let credits_quota = userData.credits_quota;
      if (credits_quota === undefined) {
        credits_quota = 1000;
      }

      if (!email || !username || !password) {
        throw new ValidationError('邮箱、用户名和密码为必填项');
      }

      const userUuid = uuid || uuidv4();
      const hashedPassword = await bcrypt.hash(password, 10);
      
      let creditsExpireAt = null;
      if (credits_expire_days && credits_expire_days > 0) {
        const expireDate = new Date();
        expireDate.setDate(expireDate.getDate() + credits_expire_days);
        creditsExpireAt = expireDate;
      }

      let accountExpireAt = null;
      if (role !== 'super_admin') {
        const groupSql = 'SELECT expire_date FROM user_groups WHERE id = ?';
        const { rows: groupRows } = await dbConnection.query(groupSql, [group_id]);
        if (groupRows.length > 0 && groupRows[0].expire_date) {
          accountExpireAt = groupRows[0].expire_date;
        }
      }

      const sql = `
        INSERT INTO users (
          uuid, uuid_source, email, username, password_hash, phone, role, group_id, status, remark,
          token_quota, credits_quota, credits_expire_at, expire_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `;

      const params = [
        userUuid, uuid_source, email, username, hashedPassword, phone, role, group_id, status, remark,
        token_quota, credits_quota, creditsExpireAt, accountExpireAt
      ];

      const { rows } = await dbConnection.query(sql, params);
      const userId = rows.insertId;

      logger.info('用户创建成功', { 
        userId, 
        uuid: userUuid,
        uuid_source,
        email, 
        username, 
        role, 
        accountExpireAt, 
        credits_quota 
      });

      return await User.findById(userId);
    } catch (error) {
      logger.error('创建用户失败:', error);
      
      if (error.code === 'ER_DUP_ENTRY') {
        if (error.message.includes('uuid')) {
          throw new ValidationError('该UUID已存在');
        }
        if (error.message.includes('email')) {
          throw new ValidationError('该邮箱已被注册');
        }
        if (error.message.includes('username')) {
          throw new ValidationError('该用户名已被使用');
        }
      }
      
      throw new DatabaseError('创建用户失败', error);
    }
  }

  /**
   * 创建或更新SSO用户
   */
  static async createOrUpdateSSOUser(ssoData) {
    try {
      const {
        uuid,
        name = null,
        group_id,
        default_credits,
        credits_expire_days = 365
      } = ssoData;

      const existingUser = await User.findByUUID(uuid);
      
      if (existingUser) {
        await existingUser.updateLastLogin();
        logger.info('SSO用户登录', { 
          userId: existingUser.id, 
          uuid,
          username: existingUser.username 
        });
        return existingUser;
      }

      const username = `sso_${uuid.substring(0, 8)}`;
      const randomPassword = crypto.randomBytes(32).toString('hex');
      const email = `${uuid}@sso.local`;

      const newUser = await User.create({
        uuid,
        uuid_source: 'sso',
        email,
        username,
        password: randomPassword,
        phone: null,
        role: 'user',
        group_id,
        status: 'active',
        remark: `SSO用户 - ${name || 'Unknown'}`,
        token_quota: 10000,
        credits_quota: default_credits,
        credits_expire_days
      });

      logger.info('SSO用户创建成功', {
        userId: newUser.id,
        uuid,
        username,
        group_id,
        default_credits
      });

      return newUser;
    } catch (error) {
      logger.error('创建或更新SSO用户失败:', error);
      throw new DatabaseError('SSO用户处理失败', error);
    }
  }

  /**
   * 获取用户列表 - 支持基于用户组的权限过滤和标签信息（自动过滤已删除）
   */
  static async getList(options = {}, currentUser = null) {
    try {
      const { 
        page = 1, 
        limit = 20, 
        role = null, 
        status = null, 
        group_id = null, 
        search = null,
        include_tags = false,
        requesterRole = null,
        requesterGroupId = null
      } = options;
      
      logger.info('开始获取用户列表', { page, limit, role, status, group_id, search, include_tags, requesterRole, requesterGroupId });
      
      let whereConditions = ['u.deleted_at IS NULL']; // 🔧 核心：过滤已删除用户
      let params = [];

      if (currentUser) {
        if (currentUser.role === 'admin' && currentUser.group_id) {
          whereConditions.push('u.group_id = ?');
          params.push(currentUser.group_id);
        }
      }

      if (role) {
        whereConditions.push('u.role = ?');
        params.push(role);
      }

      if (status) {
        whereConditions.push('u.status = ?');
        params.push(status);
      }

      if (group_id) {
        if (currentUser && currentUser.role === 'admin' && currentUser.group_id) {
          if (parseInt(group_id) !== currentUser.group_id) {
            logger.warn('管理员尝试查看其他组用户', { 
              adminGroupId: currentUser.group_id, 
              requestedGroupId: group_id 
            });
            return { users: [], pagination: { page, limit, total: 0 } };
          }
        }
        whereConditions.push('u.group_id = ?');
        params.push(group_id);
      }

      if (search) {
        whereConditions.push('(u.username LIKE ? OR u.email LIKE ? OR u.uuid LIKE ?)');
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }

      const whereClause = whereConditions.length > 0 
        ? `WHERE ${whereConditions.join(' AND ')}` 
        : '';

      const countSql = `
        SELECT COUNT(*) as total 
        FROM users u 
        LEFT JOIN user_groups g ON u.group_id = g.id 
        ${whereClause}
      `;
      const { rows: totalRows } = await dbConnection.query(countSql, params);
      const total = totalRows[0].total;
      
      logger.info('获取用户总数成功', { total, page, limit });

      const offset = (page - 1) * limit;
      const listSql = `
        SELECT u.*, 
               g.name as group_name, 
               g.color as group_color, 
               g.expire_date as group_expire_date,
               g.site_customization_enabled as group_site_customization_enabled,
               g.site_name as group_site_name,
               g.site_logo as group_site_logo,
               CASE 
                 WHEN u.credits_expire_at IS NULL THEN 0
                 WHEN u.credits_expire_at < NOW() THEN 1
                 ELSE 0
               END as credits_is_expired,
               CASE
                 WHEN u.credits_expire_at IS NULL THEN NULL
                 ELSE DATEDIFF(u.credits_expire_at, NOW())
               END as credits_remaining_days,
               CASE 
                 WHEN u.role = 'super_admin' THEN 0
                 WHEN u.expire_at IS NULL THEN 0
                 WHEN u.expire_at < NOW() THEN 1
                 ELSE 0
               END as account_is_expired,
               CASE
                 WHEN u.role = 'super_admin' THEN NULL
                 WHEN u.expire_at IS NULL THEN NULL
                 ELSE DATEDIFF(u.expire_at, NOW())
               END as account_remaining_days
        FROM users u 
        LEFT JOIN user_groups g ON u.group_id = g.id
        ${whereClause}
        ORDER BY u.created_at DESC
        LIMIT ? OFFSET ?
      `;
      const { rows: users } = await dbConnection.simpleQuery(listSql, [...params, limit, offset]);
      
      logger.info('获取用户列表成功', { count: users.length, page, limit });

      if (include_tags && users.length > 0) {
        const userIds = users.map(u => u.id);
        const placeholders = userIds.map(() => '?').join(',');
        
        const tagsSql = `
          SELECT 
            utr.user_id,
            ut.id as tag_id,
            ut.name as tag_name,
            ut.color as tag_color,
            ut.icon as tag_icon,
            ut.description as tag_description
          FROM user_tag_relations utr
          JOIN user_tags ut ON utr.tag_id = ut.id
          WHERE utr.user_id IN (${placeholders}) 
            AND ut.is_active = 1
          ORDER BY ut.sort_order ASC, ut.name ASC
        `;
        
        const { rows: allTags } = await dbConnection.query(tagsSql, userIds);
        
        const userTagsMap = {};
        allTags.forEach(tag => {
          if (!userTagsMap[tag.user_id]) {
            userTagsMap[tag.user_id] = [];
          }
          userTagsMap[tag.user_id].push({
            id: tag.tag_id,
            name: tag.tag_name,
            color: tag.tag_color,
            icon: tag.tag_icon,
            description: tag.tag_description
          });
        });
        
        users.forEach(user => {
          user.tags = userTagsMap[user.id] || [];
        });
        
        logger.info('获取用户标签成功', { userCount: users.length });
      }

      const userInstances = users.map(userData => {
        const user = new User(userData);
        user.credits_stats = user.getCreditsStats();
        if (userData.tags) {
          user.tags = userData.tags;
        }
        return user.toJSON();
      });

      return {
        users: userInstances,
        pagination: {
          page,
          limit,
          total
        }
      };
    } catch (error) {
      logger.error('获取用户列表失败:', error);
      throw new DatabaseError('获取用户列表失败', error);
    }
  }

  /**
   * 更新用户信息
   * v1.1更新：添加 can_view_chat_history 字段支持
   */
  async update(updateData) {
    try {
      // v1.1更新：添加 can_view_chat_history 到允许更新的字段列表
      const allowedFields = [
        'email', 'username', 'phone', 'role', 'group_id', 'status', 'remark',
        'token_quota', 'credits_quota', 'credits_expire_at', 'expire_at',
        'email_verified', 'password', 'can_view_chat_history'
      ];
      
      const updateFields = Object.keys(updateData).filter(field => allowedFields.includes(field));
      
      if (updateFields.length === 0) {
        return this;
      }

      if (updateData.password) {
        updateData.password_hash = await bcrypt.hash(updateData.password, 10);
        delete updateData.password;
        updateFields[updateFields.indexOf('password')] = 'password_hash';
      }

      const setClause = updateFields.map(field => `${field} = ?`).join(', ');
      const values = updateFields.map(field => updateData[field === 'password_hash' ? 'password_hash' : field]);
      values.push(this.id);

      const sql = `UPDATE users SET ${setClause}, updated_at = NOW() WHERE id = ? AND deleted_at IS NULL`;
      await dbConnection.query(sql, values);

      updateFields.forEach(field => {
        const originalField = field === 'password_hash' ? 'password' : field;
        if (field === 'password_hash') {
          this.password_hash = updateData.password_hash;
        } else {
          this[field] = updateData[originalField];
        }
      });

      logger.info('用户信息更新成功', { userId: this.id, updatedFields: updateFields });

      return this;
    } catch (error) {
      logger.error('更新用户信息失败:', error);
      throw new DatabaseError('更新用户信息失败', error);
    }
  }

  /**
   * 软删除用户（核心方法 - 自动重命名唯一字段）
   */
  async softDelete() {
    try {
      // 使用Unix时间戳确保唯一性
      const timestamp = Math.floor(Date.now() / 1000);
      const newEmail = `deleted_${timestamp}_${this.email}`;
      const newUsername = `deleted_${timestamp}_${this.username}`;
      const newUuid = `deleted_${timestamp}_${this.uuid}`;
      
      const sql = `
        UPDATE users 
        SET deleted_at = NOW(), 
            status = ?, 
            email = ?,
            username = ?,
            uuid = ?,
            updated_at = NOW() 
        WHERE id = ? AND deleted_at IS NULL
      `;
      await dbConnection.query(sql, ['inactive', newEmail, newUsername, newUuid, this.id]);
      
      const oldEmail = this.email;
      const oldUsername = this.username;
      
      this.deleted_at = new Date();
      this.status = 'inactive';
      this.email = newEmail;
      this.username = newUsername;
      this.uuid = newUuid;
      
      logger.info('用户软删除成功（已重命名唯一字段，释放注册资格）', { 
        userId: this.id, 
        oldEmail,
        oldUsername,
        newEmail,
        newUsername
      });
    } catch (error) {
      logger.error('软删除用户失败:', error);
      throw new DatabaseError('删除用户失败', error);
    }
  }

  /**
   * 删除用户（软删除别名，兼容旧代码）
   */
  async delete() {
    return await this.softDelete();
  }

  /**
   * 验证密码
   */
  async verifyPassword(password) {
    try {
      return await bcrypt.compare(password, this.password_hash);
    } catch (error) {
      logger.error('密码验证失败:', error);
      return false;
    }
  }

  /**
   * 获取用户权限 - 基于角色和用户组的权限系统
   */
  async getPermissions() {
    try {
      if (this.role === 'super_admin') {
        return [
          'chat.use', 
          'file.upload', 
          'calendar.use',
          'system.all', 
          'user.manage', 
          'group.manage', 
          'credits.manage', 
          'admin.*'
        ];
      }

      if (this.role === 'admin') {
        return [
          'chat.use', 
          'file.upload', 
          'calendar.use',
          'user.manage.group',
          'user.view.group',
          'user.password.group',
          'user.status.group',
          'credits.view'
        ];
      }

      if (this.role === 'user') {
        const sql = `
          SELECT DISTINCT permission_type 
          FROM permissions 
          WHERE user_id = ?
        `;
        const { rows } = await dbConnection.query(sql, [this.id]);
        
        const dbPermissions = rows.map(row => row.permission_type);
        const basePermissions = ['chat.use', 'file.upload'];
        
        return [...new Set([...basePermissions, ...dbPermissions])];
      }

      return [];
    } catch (error) {
      logger.error('获取用户权限失败:', error);
      return [];
    }
  }

  /**
   * 检查是否有特定权限
   */
  async hasPermission(permission, targetUserId = null) {
    const permissions = await this.getPermissions();
    
    const hasBasePermission = permissions.some(p => {
      if (p === permission) return true;
      if (p.endsWith('.*') && permission.startsWith(p.slice(0, -1))) return true;
      return false;
    });

    if (!hasBasePermission) return false;

    if (permission.includes('.group') && targetUserId) {
      if (this.role === 'super_admin') return true;
      
      const targetUser = await User.findById(targetUserId);
      if (!targetUser) return false;
      
      return this.group_id === targetUser.group_id;
    }

    return true;
  }

  /**
   * 检查用户状态
   */
  isActive() {
    return this.status === 'active' && !this.deleted_at;
  }

  /**
   * 检查是否已删除
   */
  isDeleted() {
    return this.deleted_at !== null;
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
    const currentUsed = this.used_tokens || 0;
    const quota = this.token_quota || 10000;
    return currentUsed >= quota;
  }

  /**
   * 消耗Token
   */
  async consumeTokens(tokens) {
    try {
      if (!this.hasTokenQuota(tokens)) {
        throw new Error('Token配额不足');
      }

      const sql = `
        UPDATE users 
        SET used_tokens = used_tokens + ?, updated_at = NOW()
        WHERE id = ? AND deleted_at IS NULL
      `;
      await dbConnection.query(sql, [tokens, this.id]);

      this.used_tokens = (this.used_tokens || 0) + tokens;

      logger.info('用户Token消耗成功', { userId: this.id, tokens, newUsedTokens: this.used_tokens });
    } catch (error) {
      logger.error('消耗Token失败:', error);
      throw new DatabaseError('消耗Token失败', error);
    }
  }

  /**
   * 更新最后登录时间
   */
  async updateLastLogin() {
    try {
      const sql = 'UPDATE users SET last_login_at = NOW() WHERE id = ? AND deleted_at IS NULL';
      await dbConnection.query(sql, [this.id]);
      this.last_login_at = new Date();
    } catch (error) {
      logger.error('更新最后登录时间失败:', error);
    }
  }

  /**
   * 增加登录尝试次数
   */
  async incrementLoginAttempts() {
    try {
      const sql = 'UPDATE users SET login_attempts = login_attempts + 1 WHERE id = ? AND deleted_at IS NULL';
      await dbConnection.query(sql, [this.id]);
      this.login_attempts = (this.login_attempts || 0) + 1;
    } catch (error) {
      logger.error('增加登录尝试次数失败:', error);
    }
  }

  /**
   * 重置登录尝试次数
   */
  async resetLoginAttempts() {
    try {
      const sql = 'UPDATE users SET login_attempts = 0 WHERE id = ? AND deleted_at IS NULL';
      await dbConnection.query(sql, [this.id]);
      this.login_attempts = 0;
    } catch (error) {
      logger.error('重置登录尝试次数失败:', error);
    }
  }

  // ===== 用户分组管理 =====

  /**
   * 获取所有用户分组
   */
  static async getGroups() {
    try {
      const sql = `
        SELECT g.*, 
               COUNT(u.id) as user_count,
               AVG(u.used_tokens) as avg_tokens_used,
               AVG(u.used_credits) as avg_credits_used
        FROM user_groups g
        LEFT JOIN users u ON g.id = u.group_id AND u.status = 'active' AND u.deleted_at IS NULL
        GROUP BY g.id
        ORDER BY g.sort_order ASC, g.created_at ASC
      `;
      const { rows } = await dbConnection.query(sql);
      return rows;
    } catch (error) {
      logger.error('获取用户分组失败:', error);
      throw new DatabaseError('获取用户分组失败', error);
    }
  }

  /**
   * 创建用户分组
   */
  static async createGroup(groupData, createdBy = null) {
    try {
      const { name, description = null, color = '#1677ff', is_active = true, sort_order = 0, expire_date = null } = groupData;

      const sql = `
        INSERT INTO user_groups (name, description, color, is_active, sort_order, expire_date, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;
      const { rows } = await dbConnection.query(sql, [name, description, color, is_active, sort_order, expire_date, createdBy]);
      
      const groupId = rows.insertId;
      logger.info('用户分组创建成功', { groupId, name, expire_date });

      const { rows: [group] } = await dbConnection.query('SELECT * FROM user_groups WHERE id = ?', [groupId]);
      return group;
    } catch (error) {
      logger.error('创建用户分组失败:', error);
      
      if (error.code === 'ER_DUP_ENTRY') {
        throw new ValidationError('该分组名称已存在');
      }
      
      throw new DatabaseError('创建用户分组失败', error);
    }
  }

  /**
   * 更新用户分组
   */
  static async updateGroup(groupId, updateData) {
    try {
      const allowedFields = ['name', 'description', 'color', 'is_active', 'sort_order', 'expire_date'];
      const updateFields = Object.keys(updateData).filter(field => allowedFields.includes(field));
      
      if (updateFields.length === 0) {
        return null;
      }

      const setClause = updateFields.map(field => `${field} = ?`).join(', ');
      const values = updateFields.map(field => updateData[field]);
      values.push(groupId);

      const sql = `UPDATE user_groups SET ${setClause}, updated_at = NOW() WHERE id = ?`;
      await dbConnection.query(sql, values);

      logger.info('用户分组更新成功', { groupId, updatedFields: updateFields });

      const { rows: [group] } = await dbConnection.query('SELECT * FROM user_groups WHERE id = ?', [groupId]);
      return group;
    } catch (error) {
      logger.error('更新用户分组失败:', error);
      
      if (error.code === 'ER_DUP_ENTRY') {
        throw new ValidationError('该分组名称已存在');
      }
      
      throw new DatabaseError('更新用户分组失败', error);
    }
  }

  /**
   * 删除用户分组
   */
  static async deleteGroup(groupId) {
    try {
      const { rows: users } = await dbConnection.query(
        'SELECT COUNT(*) as count FROM users WHERE group_id = ? AND deleted_at IS NULL', 
        [groupId]
      );
      if (users[0].count > 0) {
        throw new ValidationError('该分组下还有用户，无法删除');
      }

      const sql = 'DELETE FROM user_groups WHERE id = ?';
      await dbConnection.query(sql, [groupId]);
      
      logger.info('用户分组删除成功', { groupId });
    } catch (error) {
      logger.error('删除用户分组失败:', error);
      
      if (error instanceof ValidationError) {
        throw error;
      }
      
      throw new DatabaseError('删除用户分组失败', error);
    }
  }

  // ===== 积分管理功能（包含有效期） =====

  /**
   * 检查积分是否过期
   */
  isCreditsExpired() {
    if (!this.credits_expire_at) {
      return false;
    }
    return new Date() > new Date(this.credits_expire_at);
  }

  /**
   * 获取积分剩余天数
   */
  getCreditsRemainingDays() {
    if (!this.credits_expire_at) {
      return null;
    }
    
    const now = new Date();
    const expireDate = new Date(this.credits_expire_at);
    const diffTime = expireDate - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays;
  }

  /**
   * 获取积分统计信息
   */
  getCreditsStats() {
    const quota = this.credits_quota || 0;
    const used = this.used_credits || 0;
    const remaining = Math.max(0, quota - used);
    const isExpired = this.isCreditsExpired();
    const remainingDays = this.getCreditsRemainingDays();
    
    return {
      quota,
      used,
      remaining: isExpired ? 0 : remaining,
      usageRate: quota > 0 ? Math.round(used / quota * 100) : 0,
      isExpired,
      expireAt: this.credits_expire_at,
      remainingDays
    };
  }

  /**
   * 获取积分余额（考虑过期）
   */
  getCredits() {
    if (this.isCreditsExpired()) {
      return 0;
    }
    return Math.max(0, (this.credits_quota || 0) - (this.used_credits || 0));
  }

  /**
   * 检查积分是否充足（考虑过期）
   */
  hasCredits(amount = 1) {
    return this.getCredits() >= amount;
  }

  /**
   * 设置积分配额
   */
  async setCreditsQuota(newQuota, reason = '管理员设置', operatorId = null) {
    try {
      if (newQuota < 0) {
        throw new ValidationError('积分配额不能为负数');
      }

      const oldQuota = this.credits_quota || 0;
      const usedCredits = this.used_credits || 0;
      const newUsedCredits = Math.min(usedCredits, newQuota);

      await dbConnection.transaction(async (query) => {
        const updateSql = `
          UPDATE users 
          SET credits_quota = ?, used_credits = ?, updated_at = NOW()
          WHERE id = ? AND deleted_at IS NULL
        `;
        await query(updateSql, [newQuota, newUsedCredits, this.id]);

        const balanceAfter = newQuota - newUsedCredits;

        const historySql = `
          INSERT INTO credit_transactions 
          (user_id, amount, balance_after, transaction_type, description, operator_id)
          VALUES (?, ?, ?, 'admin_set', ?, ?)
        `;
        await query(historySql, [
          this.id, 
          newQuota - oldQuota,
          balanceAfter,
          reason,
          operatorId
        ]);
      });

      this.credits_quota = newQuota;
      this.used_credits = newUsedCredits;

      logger.info('设置用户积分配额成功', {
        userId: this.id,
        oldQuota,
        newQuota,
        reason,
        operatorId
      });

      return {
        success: true,
        oldQuota,
        newQuota,
        balanceAfter: newQuota - newUsedCredits,
        message: '积分配额设置成功'
      };
    } catch (error) {
      logger.error('设置用户积分配额失败:', error);
      throw new DatabaseError(`设置积分配额失败: ${error.message}`, error);
    }
  }

  /**
   * 充值积分
   */
  async addCredits(amount, reason = '管理员充值', operatorId = null, extendDays = null) {
    try {
      if (amount <= 0) {
        throw new ValidationError('充值金额必须大于0');
      }

      const oldQuota = this.credits_quota || 0;
      const newQuota = oldQuota + amount;
      const usedCredits = this.used_credits || 0;

      await dbConnection.transaction(async (query) => {
        let updateSql = `
          UPDATE users 
          SET credits_quota = ?, updated_at = NOW()
        `;
        const updateParams = [newQuota];
        
        if (extendDays && extendDays > 0) {
          updateSql = `
            UPDATE users 
            SET credits_quota = ?, 
                credits_expire_at = CASE 
                  WHEN credits_expire_at IS NULL OR credits_expire_at < NOW() 
                  THEN DATE_ADD(NOW(), INTERVAL ? DAY)
                  ELSE DATE_ADD(credits_expire_at, INTERVAL ? DAY)
                END,
                updated_at = NOW()
          `;
          updateParams.push(extendDays, extendDays);
        }
        
        updateSql += ' WHERE id = ? AND deleted_at IS NULL';
        updateParams.push(this.id);
        
        await query(updateSql, updateParams);

        const balanceAfter = newQuota - usedCredits;

        const historySql = `
          INSERT INTO credit_transactions 
          (user_id, amount, balance_after, transaction_type, description, operator_id)
          VALUES (?, ?, ?, 'admin_add', ?, ?)
        `;
        await query(historySql, [
          this.id,
          amount,
          balanceAfter,
          reason + (extendDays ? ` (延长${extendDays}天)` : ''),
          operatorId
        ]);

        if (extendDays) {
          const { rows: [userData] } = await query(
            'SELECT credits_expire_at FROM users WHERE id = ? AND deleted_at IS NULL',
            [this.id]
          );
          this.credits_expire_at = userData.credits_expire_at;
        }
      });

      this.credits_quota = newQuota;

      logger.info('用户积分充值成功', {
        userId: this.id,
        amount,
        oldQuota,
        newQuota,
        extendDays,
        reason,
        operatorId
      });

      const result = {
        success: true,
        amount,
        oldQuota,
        newQuota,
        balanceAfter: newQuota - usedCredits,
        message: '积分充值成功'
      };

      if (extendDays) {
        result.newExpireAt = this.credits_expire_at;
      }

      return result;
    } catch (error) {
      logger.error('用户积分充值失败:', error);
      throw new DatabaseError(`积分充值失败: ${error.message}`, error);
    }
  }

  /**
   * 扣减积分配额
   */
  async deductCredits(amount, reason = '管理员扣减', operatorId = null) {
    try {
      if (amount <= 0) {
        throw new ValidationError('扣减金额必须大于0');
      }

      const oldQuota = this.credits_quota || 0;
      const newQuota = Math.max(0, oldQuota - amount);
      const usedCredits = Math.min(this.used_credits || 0, newQuota);

      await dbConnection.transaction(async (query) => {
        const updateSql = `
          UPDATE users 
          SET credits_quota = ?, used_credits = ?, updated_at = NOW()
          WHERE id = ? AND deleted_at IS NULL
        `;
        await query(updateSql, [newQuota, usedCredits, this.id]);

        const balanceAfter = newQuota - usedCredits;

        const historySql = `
          INSERT INTO credit_transactions 
          (user_id, amount, balance_after, transaction_type, description, operator_id)
          VALUES (?, ?, ?, 'admin_deduct', ?, ?)
        `;
        await query(historySql, [
          this.id,
          -amount,
          balanceAfter,
          reason,
          operatorId
        ]);
      });

      this.credits_quota = newQuota;
      this.used_credits = usedCredits;

      logger.info('用户积分扣减成功', {
        userId: this.id,
        amount,
        oldQuota,
        newQuota,
        reason,
        operatorId
      });

      return {
        success: true,
        amount,
        oldQuota,
        newQuota,
        balanceAfter: newQuota - usedCredits,
        message: '积分扣减成功'
      };
    } catch (error) {
      logger.error('用户积分扣减失败:', error);
      throw new DatabaseError(`积分扣减失败: ${error.message}`, error);
    }
  }

  /**
   * 消耗积分 - 使用事务确保原子性（支持0积分免费模型）
   */
  async consumeCredits(amount, modelId = null, conversationId = null, reason = 'AI对话消费', transactionType = 'chat_consume') {
    try {
      if (amount === 0) {
        logger.info('使用免费模型，不扣除积分', {
          userId: this.id,
          modelId,
          conversationId,
          transactionType
        });

        const result = await dbConnection.transaction(async (query) => {
          const { rows: balanceRows } = await query(
            'SELECT credits_quota - used_credits as balance FROM users WHERE id = ? AND deleted_at IS NULL',
            [this.id]
          );
          const balanceAfter = balanceRows[0].balance;

          const historySql = `
            INSERT INTO credit_transactions 
            (user_id, amount, balance_after, transaction_type, description, 
             related_model_id, related_conversation_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `;
          await query(historySql, [
            this.id, 
            0,
            balanceAfter, 
            transactionType, 
            reason + ' (免费模型)', 
            modelId, 
            conversationId
          ]);

          return { balanceAfter };
        });

        return {
          success: true,
          amount: 0,
          balanceAfter: result.balanceAfter,
          message: '免费模型使用成功'
        };
      }

      if (amount < 0) {
        throw new Error('消费积分数量不能为负数');
      }

      if (this.isCreditsExpired()) {
        const remainingDays = this.getCreditsRemainingDays();
        throw new Error(`积分已过期${remainingDays === 0 ? '今天' : Math.abs(remainingDays) + '天前'}，请联系管理员续期`);
      }

      if (!this.hasCredits(amount)) {
        throw new Error(`积分余额不足，当前余额: ${this.getCredits()}，需要: ${amount}`);
      }

      const result = await dbConnection.transaction(async (query) => {
        const updateSql = `
          UPDATE users 
          SET used_credits = used_credits + ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND deleted_at IS NULL
        `;
        await query(updateSql, [amount, this.id]);

        const { rows: balanceRows } = await query(
          'SELECT credits_quota - used_credits as balance FROM users WHERE id = ? AND deleted_at IS NULL',
          [this.id]
        );
        const balanceAfter = balanceRows[0].balance;

        const historySql = `
          INSERT INTO credit_transactions 
          (user_id, amount, balance_after, transaction_type, description, 
           related_model_id, related_conversation_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        await query(historySql, [
          this.id, -amount, balanceAfter, transactionType, reason, modelId, conversationId
        ]);

        return { balanceAfter };
      });

      this.used_credits += amount;

      logger.info('用户积分消费成功', {
        userId: this.id,
        amount,
        modelId,
        conversationId,
        transactionType,
        balanceAfter: result.balanceAfter
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
        transactionType,
        error: error.message
      });
      throw new DatabaseError(`积分消费失败: ${error.message}`, error);
    }
  }

  /**
   * 设置积分过期时间
   */
  async setCreditsExpireDate(expireDate, reason = '管理员设置', operatorId = null) {
    try {
      await dbConnection.transaction(async (query) => {
        const updateSql = `
          UPDATE users 
          SET credits_expire_at = ?, updated_at = NOW()
          WHERE id = ? AND deleted_at IS NULL
        `;
        await query(updateSql, [expireDate, this.id]);

        const historySql = `
          INSERT INTO credit_transactions 
          (user_id, amount, balance_after, transaction_type, description, operator_id)
          VALUES (?, 0, (SELECT credits_quota - used_credits FROM users WHERE id = ? AND deleted_at IS NULL), 
                  'admin_set', ?, ?)
        `;
        await query(historySql, [
          this.id, this.id,
          `${reason} - 设置过期时间为: ${new Date(expireDate).toLocaleDateString()}`,
          operatorId
        ]);
      });

      this.credits_expire_at = expireDate;

      logger.info('设置用户积分过期时间成功', {
        userId: this.id,
        expireDate,
        reason,
        operatorId
      });

      return {
        success: true,
        expireDate,
        remainingDays: this.getCreditsRemainingDays(),
        message: '积分有效期设置成功'
      };
    } catch (error) {
      logger.error('设置用户积分过期时间失败:', error);
      throw new DatabaseError(`设置积分有效期失败: ${error.message}`, error);
    }
  }

  /**
   * 延长积分有效期
   */
  async extendCreditsExpireDate(days, reason = '管理员延期', operatorId = null) {
    try {
      if (days <= 0) {
        throw new ValidationError('延长天数必须大于0');
      }

      let newExpireDate;
      
      if (!this.credits_expire_at || this.isCreditsExpired()) {
        newExpireDate = new Date();
        newExpireDate.setDate(newExpireDate.getDate() + days);
      } else {
        newExpireDate = new Date(this.credits_expire_at);
        newExpireDate.setDate(newExpireDate.getDate() + days);
      }

      return await this.setCreditsExpireDate(
        newExpireDate, 
        `${reason} - 延长${days}天`, 
        operatorId
      );
    } catch (error) {
      logger.error('延长用户积分有效期失败:', error);
      throw new DatabaseError(`延长积分有效期失败: ${error.message}`, error);
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

      const countSql = `
        SELECT COUNT(*) as total 
        FROM credit_transactions ct 
        WHERE ${whereClause}
      `;
      const { rows: totalRows } = await dbConnection.query(countSql, params);
      const total = totalRows[0].total;

      const offset = (page - 1) * limit;
      const listSql = `
        SELECT ct.*, 
               u.username as operator_name,
               am.display_name as model_name
        FROM credit_transactions ct
        LEFT JOIN users u ON ct.operator_id = u.id AND u.deleted_at IS NULL
        LEFT JOIN ai_models am ON ct.related_model_id = am.id
        WHERE ${whereClause}
        ORDER BY ct.created_at DESC
        LIMIT ? OFFSET ?
      `;
      const { rows: history } = await dbConnection.simpleQuery(listSql, [...params, limit, offset]);

      return {
        history,
        pagination: {
          page,
          limit,
          total
        }
      };
    } catch (error) {
      logger.error('获取用户积分历史失败:', error);
      throw new DatabaseError('获取积分历史失败', error);
    }
  }

  // ===== 账号有效期管理功能 =====

  /**
   * 检查账号是否过期
   */
  isAccountExpired() {
    if (this.role === 'super_admin') {
      return false;
    }

    if (!this.expire_at) {
      return false;
    }
    return new Date() > new Date(this.expire_at);
  }

  /**
   * 获取账号剩余天数
   */
  getAccountRemainingDays() {
    if (this.role === 'super_admin') {
      return null;
    }

    if (!this.expire_at) {
      return null;
    }
    
    const now = new Date();
    const expireDate = new Date(this.expire_at);
    const diffTime = expireDate - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays;
  }

  /**
   * 设置账号有效期
   */
  async setAccountExpireDate(expireDate, reason = '管理员设置', operatorId = null) {
    try {
      if (this.role === 'super_admin') {
        throw new ValidationError('超级管理员账号无需设置有效期');
      }

      await dbConnection.transaction(async (query) => {
        const updateSql = `
          UPDATE users 
          SET expire_at = ?, updated_at = NOW()
          WHERE id = ? AND deleted_at IS NULL
        `;
        await query(updateSql, [expireDate, this.id]);

        logger.info('设置用户账号有效期', {
          userId: this.id,
          expireDate,
          reason,
          operatorId
        });
      });

      this.expire_at = expireDate;

      return {
        success: true,
        expireDate,
        remainingDays: this.getAccountRemainingDays(),
        message: '账号有效期设置成功'
      };
    } catch (error) {
      logger.error('设置用户账号有效期失败:', error);
      throw new DatabaseError(`设置账号有效期失败: ${error.message}`, error);
    }
  }

  /**
   * 延长账号有效期
   */
  async extendAccountExpireDate(days, reason = '管理员延期', operatorId = null) {
    try {
      if (days <= 0) {
        throw new ValidationError('延长天数必须大于0');
      }

      if (this.role === 'super_admin') {
        throw new ValidationError('超级管理员账号无需设置有效期');
      }

      let newExpireDate;
      
      if (!this.expire_at || this.isAccountExpired()) {
        newExpireDate = new Date();
        newExpireDate.setDate(newExpireDate.getDate() + days);
      } else {
        newExpireDate = new Date(this.expire_at);
        newExpireDate.setDate(newExpireDate.getDate() + days);
      }

      return await this.setAccountExpireDate(
        newExpireDate, 
        `${reason} - 延长${days}天`, 
        operatorId
      );
    } catch (error) {
      logger.error('延长用户账号有效期失败:', error);
      throw new DatabaseError(`延长账号有效期失败: ${error.message}`, error);
    }
  }

  /**
   * 根据组有效期更新用户有效期
   */
  async syncAccountExpireWithGroup() {
    try {
      if (this.role === 'super_admin') {
        return { success: true, message: '超级管理员不需要更新有效期' };
      }

      const sql = 'SELECT expire_date FROM user_groups WHERE id = ?';
      const { rows } = await dbConnection.query(sql, [this.group_id]);
      
      if (rows.length === 0) {
        throw new ValidationError('用户组不存在');
      }

      const groupExpireDate = rows[0].expire_date;
      
      if (!groupExpireDate) {
        await this.setAccountExpireDate(null, '组有效期已清除');
      } else {
        await this.setAccountExpireDate(groupExpireDate, '同步组有效期');
      }

      return {
        success: true,
        groupExpireDate,
        message: '账号有效期已同步组设置'
      };
    } catch (error) {
      logger.error('根据组更新用户有效期失败:', error);
      throw error;
    }
  }
}

module.exports = User;

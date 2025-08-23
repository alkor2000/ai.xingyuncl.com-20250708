/**
 * 知识模块模型
 */

const dbConnection = require('../database/connection');
const { DatabaseError } = require('../utils/errors');
const logger = require('../utils/logger');
const { calculateTokens } = require('../utils/tokenCalculator');

class KnowledgeModule {
  constructor(data = {}) {
    this.id = data.id || null;
    this.name = data.name || '';
    this.description = data.description || '';
    this.content = data.content || '';
    this.token_count = data.token_count || 0;  // 添加token_count字段
    this.prompt_type = data.prompt_type || 'normal';
    this.module_scope = data.module_scope || 'personal';
    this.content_visible = data.content_visible !== undefined ? data.content_visible : true;
    this.creator_id = data.creator_id || null;
    this.group_id = data.group_id || null;
    this.group_ids = data.group_ids || null;
    this.category = data.category || null;
    this.tags = data.tags || null;
    this.sort_order = data.sort_order || 0;
    this.is_active = data.is_active !== undefined ? data.is_active : true;
    this.usage_count = data.usage_count || 0;
    this.created_at = data.created_at || null;
    this.updated_at = data.updated_at || null;
  }

  /**
   * 获取用户可用的知识模块列表
   * 修复：超级管理员可以看到所有模块
   */
  static async getUserAvailableModules(userId, groupId, includeInactive = false, userRole = null) {
    try {
      // 如果没有传入用户角色，查询用户角色
      if (!userRole) {
        const userResult = await dbConnection.query('SELECT role FROM users WHERE id = ?', [userId]);
        userRole = userResult.rows[0]?.role;
      }
      
      // 超级管理员可以看到所有模块
      if (userRole === 'super_admin') {
        let sql = `
          SELECT km.*, u.username as creator_name, ug.name as group_name
          FROM knowledge_modules km
          LEFT JOIN users u ON km.creator_id = u.id
          LEFT JOIN user_groups ug ON km.group_id = ug.id
        `;
        
        if (!includeInactive) {
          sql += ' WHERE km.is_active = 1';
        }
        
        sql += ' ORDER BY km.module_scope DESC, km.sort_order ASC, km.created_at DESC';
        
        const { rows } = await dbConnection.query(sql);
        
        logger.debug('超级管理员获取所有模块', {
          userId,
          moduleCount: rows.length,
          includeInactive
        });
        
        return rows.map(row => {
          const module = new KnowledgeModule(row);
          module.creator_name = row.creator_name;
          module.group_name = row.group_name;
          
          // 解析group_ids
          if (module.group_ids && typeof module.group_ids === 'string') {
            try {
              module.group_ids = JSON.parse(module.group_ids);
            } catch (e) {
              module.group_ids = null;
            }
          }
          
          // 超级管理员可以看到所有内容
          return module;
        });
      }
      
      // 普通用户和组管理员的权限检查
      let sql = `
        SELECT km.*, u.username as creator_name, ug.name as group_name
        FROM knowledge_modules km
        LEFT JOIN users u ON km.creator_id = u.id
        LEFT JOIN user_groups ug ON km.group_id = ug.id
        WHERE (
          -- 个人模块：只能看到自己的
          (km.module_scope = 'personal' AND km.creator_id = ?)
          -- 团队模块：同组可见
          OR (km.module_scope = 'team' AND km.group_id = ?)
          -- 全局模块：根据group_ids权限控制
          OR (km.module_scope = 'system' AND (
            km.group_ids IS NULL  -- NULL表示所有组可见
            OR JSON_CONTAINS(km.group_ids, CAST(? AS JSON), '$')  -- 检查用户组是否在允许列表中
          ))
        )
      `;
      
      if (!includeInactive) {
        sql += ' AND km.is_active = 1';
      }
      
      sql += ' ORDER BY km.module_scope DESC, km.sort_order ASC, km.created_at DESC';
      
      const { rows } = await dbConnection.query(sql, [userId, groupId, groupId || 0]);
      
      return rows.map(row => {
        const module = new KnowledgeModule(row);
        module.creator_name = row.creator_name;
        module.group_name = row.group_name;
        
        // 解析group_ids
        if (module.group_ids && typeof module.group_ids === 'string') {
          try {
            module.group_ids = JSON.parse(module.group_ids);
          } catch (e) {
            module.group_ids = null;
          }
        }
        
        // 判断内容是否可见
        // 全局模块内容的可见性判断
        if (module.module_scope === 'system') {
          // 全局模块根据content_visible设置
          if (!module.content_visible && module.creator_id !== userId) {
            module.content = null;
            module.content_hidden = true;
            module.token_count = 0;  // 隐藏内容时也隐藏token数
          }
        } else if (module.module_scope !== 'personal' && module.creator_id !== userId && !module.content_visible) {
          // 团队模块才检查content_visible
          module.content = null; // 隐藏内容
          module.content_hidden = true;
          module.token_count = 0;  // 隐藏内容时也隐藏token数
        }
        
        return module;
      });
    } catch (error) {
      logger.error('获取用户可用知识模块失败:', error);
      throw new DatabaseError('获取知识模块列表失败', error);
    }
  }

  /**
   * 获取所有系统级模块（管理端）
   */
  static async getSystemModules(includeInactive = false) {
    try {
      let sql = `
        SELECT km.*, u.username as creator_name
        FROM knowledge_modules km
        LEFT JOIN users u ON km.creator_id = u.id
        WHERE km.module_scope = 'system'
      `;
      
      if (!includeInactive) {
        sql += ' AND km.is_active = 1';
      }
      
      sql += ' ORDER BY km.sort_order ASC, km.created_at DESC';
      
      const { rows } = await dbConnection.query(sql);
      
      return rows.map(row => {
        const module = new KnowledgeModule(row);
        module.creator_name = row.creator_name;
        
        // 解析group_ids
        if (module.group_ids && typeof module.group_ids === 'string') {
          try {
            module.group_ids = JSON.parse(module.group_ids);
          } catch (e) {
            module.group_ids = null;
          }
        }
        
        return module;
      });
    } catch (error) {
      logger.error('获取系统级知识模块失败:', error);
      throw new DatabaseError('获取系统级知识模块失败', error);
    }
  }

  /**
   * 根据ID获取知识模块
   */
  static async findById(id, userId = null) {
    try {
      const sql = `
        SELECT km.*, u.username as creator_name, ug.name as group_name
        FROM knowledge_modules km
        LEFT JOIN users u ON km.creator_id = u.id
        LEFT JOIN user_groups ug ON km.group_id = ug.id
        WHERE km.id = ?
      `;
      
      const { rows } = await dbConnection.query(sql, [id]);
      
      if (rows.length === 0) {
        return null;
      }
      
      const module = new KnowledgeModule(rows[0]);
      module.creator_name = rows[0].creator_name;
      module.group_name = rows[0].group_name;
      
      // 解析group_ids
      if (module.group_ids && typeof module.group_ids === 'string') {
        try {
          module.group_ids = JSON.parse(module.group_ids);
        } catch (e) {
          module.group_ids = null;
        }
      }
      
      // 检查内容可见性
      if (userId) {
        // 获取用户角色
        const userResult = await dbConnection.query('SELECT role FROM users WHERE id = ?', [userId]);
        const userRole = userResult.rows[0]?.role;
        
        // 超级管理员可以看到所有内容
        if (userRole === 'super_admin') {
          logger.debug('超级管理员查看模块', {
            moduleId: id,
            moduleName: module.name,
            userId
          });
          return module;
        }
      }
      
      // 检查内容可见性
      // 全局模块的内容可见性
      if (module.module_scope === 'system') {
        if (!module.content_visible && module.creator_id !== userId) {
          module.content = null;
          module.content_hidden = true;
          module.token_count = 0;  // 隐藏内容时也隐藏token数
        }
      } else if (userId && module.module_scope !== 'personal' && module.creator_id !== userId && !module.content_visible) {
        // 只对非系统级、非个人模块检查content_visible
        module.content = null;
        module.content_hidden = true;
        module.token_count = 0;  // 隐藏内容时也隐藏token数
      }
      
      return module;
    } catch (error) {
      logger.error('根据ID查找知识模块失败:', error);
      throw new DatabaseError('查找知识模块失败', error);
    }
  }

  /**
   * 创建知识模块
   */
  static async create(data, creatorId) {
    try {
      // 验证权限
      const { module_scope, group_id, group_ids } = data;
      
      // 如果是团队模块，必须有group_id
      if (module_scope === 'team' && !group_id) {
        throw new Error('团队模块必须指定所属组');
      }
      
      // 计算token数量
      const tokenCount = calculateTokens(data.content || '');
      
      const sql = `
        INSERT INTO knowledge_modules (
          name, description, content, token_count, prompt_type, module_scope,
          content_visible, creator_id, group_id, group_ids, category, tags,
          sort_order, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      const params = [
        data.name,
        data.description || null,
        data.content,
        tokenCount,  // 保存计算的token数
        data.prompt_type || 'normal',
        module_scope || 'personal',
        data.content_visible !== undefined ? data.content_visible : true,
        creatorId,
        module_scope === 'team' ? group_id : null,
        module_scope === 'system' && data.group_ids ? JSON.stringify(data.group_ids) : null,
        data.category || null,
        data.tags ? JSON.stringify(data.tags) : null,
        data.sort_order || 0,
        data.is_active !== undefined ? data.is_active : true
      ];
      
      const result = await dbConnection.query(sql, params);
      const insertId = result.rows.insertId;
      
      logger.info('创建知识模块成功', { 
        moduleId: insertId, 
        name: data.name,
        creatorId,
        scope: module_scope,
        group_ids: data.group_ids,
        tokenCount
      });
      
      return await KnowledgeModule.findById(insertId);
    } catch (error) {
      logger.error('创建知识模块失败:', error);
      throw new DatabaseError('创建知识模块失败', error);
    }
  }

  /**
   * 更新知识模块
   */
  static async update(id, data, operatorId) {
    try {
      // 获取原模块信息
      const originalModule = await KnowledgeModule.findById(id);
      if (!originalModule) {
        throw new Error('知识模块不存在');
      }
      
      // 检查权限
      if (originalModule.creator_id !== operatorId) {
        const operator = await dbConnection.query('SELECT role FROM users WHERE id = ?', [operatorId]);
        if (operator.rows[0]?.role !== 'super_admin') {
          throw new Error('无权修改此模块');
        }
      }
      
      const updateFields = [];
      const updateValues = [];
      
      // 如果更新了内容，重新计算token
      if (data.content !== undefined) {
        const tokenCount = calculateTokens(data.content);
        updateFields.push('content = ?', 'token_count = ?');
        updateValues.push(data.content, tokenCount);
      }
      
      // 允许更新的其他字段
      const allowedFields = ['name', 'description', 'prompt_type', 'content_visible', 
                           'category', 'tags', 'sort_order', 'is_active'];
      
      // 如果是系统级模块，允许更新group_ids
      if (originalModule.module_scope === 'system' && data.group_ids !== undefined) {
        updateFields.push('group_ids = ?');
        updateValues.push(data.group_ids ? JSON.stringify(data.group_ids) : null);
      }
      
      allowedFields.forEach(field => {
        if (data[field] !== undefined && field !== 'content') {  // content已经处理过了
          updateFields.push(`${field} = ?`);
          if (field === 'tags') {
            updateValues.push(data[field] ? JSON.stringify(data[field]) : null);
          } else {
            updateValues.push(data[field]);
          }
        }
      });
      
      if (updateFields.length === 0) {
        return originalModule;
      }
      
      updateValues.push(id);
      const sql = `UPDATE knowledge_modules SET ${updateFields.join(', ')} WHERE id = ?`;
      
      await dbConnection.query(sql, updateValues);
      
      logger.info('更新知识模块成功', { 
        moduleId: id, 
        operatorId,
        updatedFields: updateFields 
      });
      
      return await KnowledgeModule.findById(id);
    } catch (error) {
      logger.error('更新知识模块失败:', error);
      throw new DatabaseError('更新知识模块失败', error);
    }
  }

  /**
   * 删除知识模块
   */
  static async delete(id, operatorId) {
    try {
      // 获取模块信息
      const module = await KnowledgeModule.findById(id);
      if (!module) {
        throw new Error('知识模块不存在');
      }
      
      // 检查权限
      if (module.creator_id !== operatorId) {
        const operator = await dbConnection.query('SELECT role FROM users WHERE id = ?', [operatorId]);
        if (operator.rows[0]?.role !== 'super_admin') {
          throw new Error('无权删除此模块');
        }
      }
      
      // 软删除
      const sql = 'UPDATE knowledge_modules SET is_active = 0 WHERE id = ?';
      await dbConnection.query(sql, [id]);
      
      logger.info('删除知识模块成功', { moduleId: id, operatorId });
      
      return true;
    } catch (error) {
      logger.error('删除知识模块失败:', error);
      throw new DatabaseError('删除知识模块失败', error);
    }
  }

  /**
   * 检查用户是否有权限使用该模块
   * 修复：超级管理员总是有权限
   */
  static async checkUserAccess(moduleId, userId, groupId, userRole = null) {
    try {
      // 如果没有传入用户角色，查询用户角色
      if (!userRole) {
        const userResult = await dbConnection.query('SELECT role FROM users WHERE id = ?', [userId]);
        userRole = userResult.rows[0]?.role;
      }
      
      // 超级管理员总是有权限
      if (userRole === 'super_admin') {
        logger.debug('超级管理员访问模块', {
          moduleId,
          userId
        });
        return true;
      }
      
      // 普通用户和组管理员的权限检查
      const sql = `
        SELECT COUNT(*) as count
        FROM knowledge_modules
        WHERE id = ? 
        AND is_active = 1
        AND (
          (module_scope = 'personal' AND creator_id = ?)
          OR (module_scope = 'team' AND group_id = ?)
          OR (module_scope = 'system' AND (
            group_ids IS NULL
            OR JSON_CONTAINS(group_ids, CAST(? AS JSON), '$')
          ))
        )
      `;
      
      const { rows } = await dbConnection.query(sql, [moduleId, userId, groupId, groupId || 0]);
      
      return rows[0].count > 0;
    } catch (error) {
      logger.error('检查模块访问权限失败:', error);
      return false;
    }
  }

  /**
   * 更新使用次数
   */
  static async incrementUsageCount(moduleId) {
    try {
      const sql = 'UPDATE knowledge_modules SET usage_count = usage_count + 1 WHERE id = ?';
      await dbConnection.query(sql, [moduleId]);
    } catch (error) {
      logger.error('更新模块使用次数失败:', error);
    }
  }

  /**
   * 转换为JSON（控制内容可见性）
   */
  toJSON() {
    const data = {
      id: this.id,
      name: this.name,
      description: this.description,
      token_count: this.token_count,  // 添加token_count到输出
      prompt_type: this.prompt_type,
      module_scope: this.module_scope,
      content_visible: this.content_visible,
      creator_id: this.creator_id,
      group_id: this.group_id,
      group_ids: this.group_ids,
      category: this.category,
      tags: this.tags,
      sort_order: this.sort_order,
      is_active: this.is_active,
      usage_count: this.usage_count,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
    
    // 如果内容被隐藏，添加标识
    if (this.content_hidden) {
      data.content_hidden = true;
    } else {
      data.content = this.content;
    }
    
    // 添加额外信息
    if (this.creator_name) {
      data.creator_name = this.creator_name;
    }
    if (this.group_name) {
      data.group_name = this.group_name;
    }
    
    return data;
  }
}

module.exports = KnowledgeModule;

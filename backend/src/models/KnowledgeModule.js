/**
 * 知识模块模型
 */

const dbConnection = require('../database/connection');
const { DatabaseError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');
const { calculateTokens } = require('../utils/tokenCalculator');

class KnowledgeModule {
  constructor(data = {}) {
    this.id = data.id || null;
    this.name = data.name || '';
    this.description = data.description || '';
    this.content = data.content || '';
    this.token_count = data.token_count || 0;
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
    // 新增：允许访问的标签ID列表
    this.allowed_tag_ids = data.allowed_tag_ids || [];
  }

  /**
   * 获取用户可用的知识模块列表（优化版本）
   * 修复：正确处理系统级模块的权限和可见性
   * 优化：减少N+1查询问题
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
          SELECT km.*, u.username as creator_name, ug.name as group_name,
                 GROUP_CONCAT(DISTINCT kmtp.tag_id) as allowed_tag_ids_str
          FROM knowledge_modules km
          LEFT JOIN users u ON km.creator_id = u.id
          LEFT JOIN user_groups ug ON km.group_id = ug.id
          LEFT JOIN knowledge_module_tag_permissions kmtp ON km.id = kmtp.module_id
        `;
        
        if (!includeInactive) {
          sql += ' WHERE km.is_active = 1';
        }
        
        sql += ' GROUP BY km.id ORDER BY km.module_scope DESC, km.sort_order ASC, km.created_at DESC';
        
        const { rows } = await dbConnection.query(sql);
        
        const modules = rows.map(row => {
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
          
          // 解析allowed_tag_ids
          if (row.allowed_tag_ids_str) {
            module.allowed_tag_ids = row.allowed_tag_ids_str.split(',').map(id => parseInt(id));
          } else {
            module.allowed_tag_ids = [];
          }
          
          return module;
        });
        
        logger.debug('超级管理员获取所有模块', {
          userId,
          moduleCount: modules.length,
          includeInactive
        });
        
        return modules;
      }
      
      // 普通用户和组管理员的权限检查
      // 获取用户的标签ID列表
      const userTagsSql = `
        SELECT tag_id FROM user_tag_relations WHERE user_id = ?
      `;
      const { rows: userTagRows } = await dbConnection.query(userTagsSql, [userId]);
      const userTagIds = userTagRows.map(row => row.tag_id);
      
      // 优化查询：使用LEFT JOIN一次性获取所有需要的数据
      let sql = `
        SELECT DISTINCT km.*, u.username as creator_name, ug.name as group_name,
               GROUP_CONCAT(DISTINCT kmtp.tag_id) as allowed_tag_ids_str
        FROM knowledge_modules km
        LEFT JOIN users u ON km.creator_id = u.id
        LEFT JOIN user_groups ug ON km.group_id = ug.id
        LEFT JOIN knowledge_module_tag_permissions kmtp ON km.id = kmtp.module_id
        WHERE (
          -- 个人模块：只能看到自己的
          (km.module_scope = 'personal' AND km.creator_id = ?)
          -- 团队模块：同组可见，需要检查标签权限
          OR (km.module_scope = 'team' AND km.group_id = ? AND (
            -- 创建者始终可见
            km.creator_id = ?
            -- 没有标签限制的模块对所有组内用户可见
            OR NOT EXISTS (
              SELECT 1 FROM knowledge_module_tag_permissions 
              WHERE module_id = km.id
            )
            ${userTagIds.length > 0 ? `
            -- 有标签限制的模块，用户必须拥有至少一个允许的标签
            OR EXISTS (
              SELECT 1 FROM knowledge_module_tag_permissions kmtp2
              WHERE kmtp2.module_id = km.id 
              AND kmtp2.tag_id IN (${userTagIds.map(() => '?').join(',')})
            )` : ''}
          ))
          -- 全局模块：根据group_ids权限控制
          OR (km.module_scope = 'system' AND (
            km.group_ids IS NULL  -- NULL表示所有组可见
            OR JSON_LENGTH(km.group_ids) = 0  -- 空数组也表示所有组可见
            OR JSON_CONTAINS(km.group_ids, CAST(? AS JSON), '$')  -- 检查用户组是否在允许列表中
          ))
        )
      `;
      
      const params = [userId, groupId, userId];
      if (userTagIds.length > 0) {
        params.push(...userTagIds);
      }
      params.push(groupId || 0);
      
      if (!includeInactive) {
        sql += ' AND km.is_active = 1';
      }
      
      sql += ' GROUP BY km.id ORDER BY km.module_scope DESC, km.sort_order ASC, km.created_at DESC';
      
      const { rows } = await dbConnection.query(sql, params);
      
      const modules = rows.map(row => {
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
        
        // 解析allowed_tag_ids
        if (row.allowed_tag_ids_str) {
          module.allowed_tag_ids = row.allowed_tag_ids_str.split(',').map(id => parseInt(id));
        } else {
          module.allowed_tag_ids = [];
        }
        
        // 处理内容可见性
        if (module.module_scope === 'system') {
          if (!module.content_visible) {
            module.content = null;
            module.content_hidden = true;
          }
        } else if (module.module_scope === 'team') {
          if (module.creator_id !== userId && !module.content_visible) {
            module.content = null;
            module.content_hidden = true;
          }
        }
        
        return module;
      });
      
      return modules;
    } catch (error) {
      logger.error('获取用户可用知识模块失败:', error);
      throw new DatabaseError('获取知识模块列表失败', error);
    }
  }

  /**
   * 获取模块的标签权限列表
   */
  static async getModuleTagPermissions(moduleId) {
    try {
      const sql = 'SELECT tag_id FROM knowledge_module_tag_permissions WHERE module_id = ?';
      const { rows } = await dbConnection.query(sql, [moduleId]);
      return rows.map(row => row.tag_id);
    } catch (error) {
      logger.error('获取模块标签权限失败:', error);
      return [];
    }
  }

  /**
   * 设置模块的标签权限
   */
  static async setModuleTagPermissions(moduleId, tagIds, operatorId) {
    const transaction = await dbConnection.beginTransaction();
    try {
      // 删除旧的权限
      await transaction.query('DELETE FROM knowledge_module_tag_permissions WHERE module_id = ?', [moduleId]);
      
      // 添加新的权限
      if (tagIds && tagIds.length > 0) {
        for (const tagId of tagIds) {
          await transaction.query(
            'INSERT INTO knowledge_module_tag_permissions (module_id, tag_id, created_by) VALUES (?, ?, ?)',
            [moduleId, tagId, operatorId]
          );
        }
      }
      
      await transaction.commit();
      
      logger.info('设置模块标签权限成功', {
        moduleId,
        tagIds,
        operatorId
      });
    } catch (error) {
      await transaction.rollback();
      logger.error('设置模块标签权限失败:', error);
      throw new DatabaseError('设置模块标签权限失败', error);
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
        SELECT km.*, u.username as creator_name, ug.name as group_name,
               GROUP_CONCAT(kmtp.tag_id) as allowed_tag_ids_str
        FROM knowledge_modules km
        LEFT JOIN users u ON km.creator_id = u.id
        LEFT JOIN user_groups ug ON km.group_id = ug.id
        LEFT JOIN knowledge_module_tag_permissions kmtp ON km.id = kmtp.module_id
        WHERE km.id = ?
        GROUP BY km.id
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
      
      // 解析allowed_tag_ids
      if (rows[0].allowed_tag_ids_str) {
        module.allowed_tag_ids = rows[0].allowed_tag_ids_str.split(',').map(id => parseInt(id));
      } else {
        module.allowed_tag_ids = [];
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
        
        // 系统级模块的内容可见性处理
        if (module.module_scope === 'system') {
          if (!module.content_visible) {
            module.content = null;
            module.content_hidden = true;
          }
        } else if (module.module_scope === 'team') {
          // 团队模块：非创建者需要检查content_visible
          if (module.creator_id !== userId && !module.content_visible) {
            module.content = null;
            module.content_hidden = true;
          }
        } else if (module.module_scope === 'personal' && module.creator_id !== userId) {
          // 个人模块：非创建者不应该能访问
          return null;
        }
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
    const transaction = await dbConnection.beginTransaction();
    try {
      // 验证权限
      const { module_scope, group_id, group_ids, allowed_tag_ids } = data;
      
      // 如果是团队模块，必须有group_id
      if (module_scope === 'team' && !group_id) {
        throw new ValidationError('团队模块必须指定所属组');
      }
      
      // 计算token数量
      const tokenCount = calculateTokens(data.content || '');
      
      // 处理group_ids：如果是空数组或未指定，设为NULL（表示所有组可见）
      let processedGroupIds = null;
      if (module_scope === 'system' && group_ids) {
        if (Array.isArray(group_ids) && group_ids.length > 0) {
          processedGroupIds = JSON.stringify(group_ids);
        }
      }
      
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
        tokenCount,
        data.prompt_type || 'normal',
        module_scope || 'personal',
        data.content_visible !== undefined ? data.content_visible : true,
        creatorId,
        module_scope === 'team' ? group_id : null,
        processedGroupIds,
        data.category || null,
        data.tags ? JSON.stringify(data.tags) : null,
        data.sort_order || 0,
        data.is_active !== undefined ? data.is_active : true
      ];
      
      const result = await transaction.query(sql, params);
      const insertId = result.rows.insertId;
      
      // 如果是团队模块且设置了标签权限，保存标签权限
      if (module_scope === 'team' && allowed_tag_ids && allowed_tag_ids.length > 0) {
        for (const tagId of allowed_tag_ids) {
          await transaction.query(
            'INSERT INTO knowledge_module_tag_permissions (module_id, tag_id, created_by) VALUES (?, ?, ?)',
            [insertId, tagId, creatorId]
          );
        }
      }
      
      await transaction.commit();
      
      logger.info('创建知识模块成功', { 
        moduleId: insertId, 
        name: data.name,
        creatorId,
        scope: module_scope,
        group_ids: processedGroupIds,
        allowed_tag_ids,
        tokenCount
      });
      
      return await KnowledgeModule.findById(insertId);
    } catch (error) {
      await transaction.rollback();
      logger.error('创建知识模块失败:', error);
      throw error;
    }
  }

  /**
   * 更新知识模块
   */
  static async update(id, data, operatorId) {
    const transaction = await dbConnection.beginTransaction();
    try {
      // 获取原模块信息
      const originalModule = await KnowledgeModule.findById(id);
      if (!originalModule) {
        throw new ValidationError('知识模块不存在');
      }
      
      // 检查权限
      if (originalModule.creator_id !== operatorId) {
        const operator = await transaction.query('SELECT role FROM users WHERE id = ?', [operatorId]);
        if (operator.rows[0]?.role !== 'super_admin') {
          throw new ValidationError('无权修改此模块');
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
        if (Array.isArray(data.group_ids) && data.group_ids.length > 0) {
          updateValues.push(JSON.stringify(data.group_ids));
        } else {
          updateValues.push(null);
        }
      }
      
      allowedFields.forEach(field => {
        if (data[field] !== undefined && field !== 'content') {
          updateFields.push(`${field} = ?`);
          if (field === 'tags') {
            updateValues.push(data[field] ? JSON.stringify(data[field]) : null);
          } else {
            updateValues.push(data[field]);
          }
        }
      });
      
      if (updateFields.length > 0) {
        updateValues.push(id);
        const sql = `UPDATE knowledge_modules SET ${updateFields.join(', ')} WHERE id = ?`;
        await transaction.query(sql, updateValues);
      }
      
      // 如果是团队模块，更新标签权限
      if (originalModule.module_scope === 'team' && data.allowed_tag_ids !== undefined) {
        // 删除旧的权限
        await transaction.query('DELETE FROM knowledge_module_tag_permissions WHERE module_id = ?', [id]);
        
        // 添加新的权限
        if (data.allowed_tag_ids && data.allowed_tag_ids.length > 0) {
          for (const tagId of data.allowed_tag_ids) {
            await transaction.query(
              'INSERT INTO knowledge_module_tag_permissions (module_id, tag_id, created_by) VALUES (?, ?, ?)',
              [id, tagId, operatorId]
            );
          }
        }
      }
      
      await transaction.commit();
      
      logger.info('更新知识模块成功', { 
        moduleId: id, 
        operatorId,
        updatedFields: updateFields,
        allowed_tag_ids: data.allowed_tag_ids
      });
      
      return await KnowledgeModule.findById(id);
    } catch (error) {
      await transaction.rollback();
      logger.error('更新知识模块失败:', error);
      throw error;
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
        throw new ValidationError('知识模块不存在');
      }
      
      // 检查权限
      if (module.creator_id !== operatorId) {
        const operator = await dbConnection.query('SELECT role FROM users WHERE id = ?', [operatorId]);
        if (operator.rows[0]?.role !== 'super_admin') {
          throw new ValidationError('无权删除此模块');
        }
      }
      
      // 软删除
      const sql = 'UPDATE knowledge_modules SET is_active = 0 WHERE id = ?';
      await dbConnection.query(sql, [id]);
      
      logger.info('删除知识模块成功', { moduleId: id, operatorId });
      
      return true;
    } catch (error) {
      logger.error('删除知识模块失败:', error);
      throw error;
    }
  }

  /**
   * 检查用户是否有权限使用该模块
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
      
      // 获取用户的标签ID列表
      const userTagsSql = `
        SELECT tag_id FROM user_tag_relations WHERE user_id = ?
      `;
      const { rows: userTagRows } = await dbConnection.query(userTagsSql, [userId]);
      const userTagIds = userTagRows.map(row => row.tag_id);
      
      // 检查模块访问权限
      const sql = `
        SELECT km.*, 
               (SELECT COUNT(*) FROM knowledge_module_tag_permissions WHERE module_id = km.id) as tag_permission_count
        FROM knowledge_modules km
        WHERE km.id = ? 
        AND km.is_active = 1
      `;
      
      const { rows } = await dbConnection.query(sql, [moduleId]);
      
      if (rows.length === 0) {
        return false;
      }
      
      const module = rows[0];
      
      // 个人模块：只有创建者可以访问
      if (module.module_scope === 'personal') {
        return module.creator_id === userId;
      }
      
      // 团队模块：检查组和标签权限
      if (module.module_scope === 'team') {
        // 首先检查是否同组
        if (module.group_id !== groupId) {
          return false;
        }
        
        // 创建者始终有权限
        if (module.creator_id === userId) {
          return true;
        }
        
        // 如果没有标签限制，组内所有用户都有权限
        if (module.tag_permission_count === 0) {
          return true;
        }
        
        // 如果有标签限制，检查用户是否拥有允许的标签
        if (userTagIds.length > 0) {
          const checkTagSql = `
            SELECT COUNT(*) as count 
            FROM knowledge_module_tag_permissions 
            WHERE module_id = ? AND tag_id IN (${userTagIds.map(() => '?').join(',')})
          `;
          const { rows: tagCheckRows } = await dbConnection.query(checkTagSql, [moduleId, ...userTagIds]);
          return tagCheckRows[0].count > 0;
        }
        
        return false;
      }
      
      // 系统模块：检查group_ids
      if (module.module_scope === 'system') {
        // 解析group_ids
        let allowedGroups = null;
        if (module.group_ids) {
          try {
            allowedGroups = JSON.parse(module.group_ids);
          } catch (e) {
            allowedGroups = null;
          }
        }
        
        // NULL或空数组表示所有组可见
        if (!allowedGroups || allowedGroups.length === 0) {
          return true;
        }
        
        // 检查用户组是否在允许列表中
        return allowedGroups.includes(groupId);
      }
      
      return false;
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
      token_count: this.token_count,
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
      updated_at: this.updated_at,
      allowed_tag_ids: this.allowed_tag_ids
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

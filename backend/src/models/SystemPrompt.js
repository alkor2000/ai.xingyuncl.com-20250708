/**
 * 系统提示词模型
 */

const dbConnection = require('../database/connection');
const { DatabaseError } = require('../utils/errors');
const logger = require('../utils/logger');

class SystemPrompt {
  constructor(data = {}) {
    this.id = data.id || null;
    this.name = data.name || '';
    this.description = data.description || '';
    this.content = data.content || '';
    this.is_active = data.is_active !== undefined ? data.is_active : 1;
    this.sort_order = data.sort_order || 0;
    this.created_by = data.created_by || null;
    this.created_at = data.created_at || null;
    this.updated_at = data.updated_at || null;
  }

  /**
   * 获取所有系统提示词（管理端）
   */
  static async getAll(includeInactive = false) {
    try {
      let sql = `
        SELECT sp.*, u.username as creator_name,
               GROUP_CONCAT(DISTINCT ug.name ORDER BY ug.name) as group_names,
               GROUP_CONCAT(DISTINCT CAST(ug.id AS CHAR)) as group_ids
        FROM system_prompts sp
        LEFT JOIN users u ON sp.created_by = u.id
        LEFT JOIN system_prompt_groups spg ON sp.id = spg.prompt_id
        LEFT JOIN user_groups ug ON spg.group_id = ug.id
      `;
      
      if (!includeInactive) {
        sql += ' WHERE sp.is_active = 1';
      }
      
      sql += ' GROUP BY sp.id ORDER BY sp.sort_order ASC, sp.created_at DESC';
      
      const { rows } = await dbConnection.query(sql);
      
      return rows.map(row => {
        const prompt = new SystemPrompt(row);
        prompt.creator_name = row.creator_name;
        prompt.group_names = row.group_names ? row.group_names.split(',') : [];
        prompt.group_ids = row.group_ids ? row.group_ids.split(',').map(id => parseInt(id)) : [];
        return prompt;
      });
    } catch (error) {
      logger.error('获取系统提示词列表失败:', error);
      throw new DatabaseError('获取系统提示词列表失败', error);
    }
  }

  /**
   * 根据ID获取系统提示词
   */
  static async findById(id) {
    try {
      const sql = `
        SELECT sp.*, u.username as creator_name
        FROM system_prompts sp
        LEFT JOIN users u ON sp.created_by = u.id
        WHERE sp.id = ?
      `;
      
      const { rows } = await dbConnection.query(sql, [id]);
      
      if (rows.length === 0) {
        return null;
      }
      
      const prompt = new SystemPrompt(rows[0]);
      prompt.creator_name = rows[0].creator_name;
      
      // 获取关联的用户组
      const groupSql = `
        SELECT ug.id, ug.name
        FROM system_prompt_groups spg
        JOIN user_groups ug ON spg.group_id = ug.id
        WHERE spg.prompt_id = ?
      `;
      
      const { rows: groups } = await dbConnection.query(groupSql, [id]);
      prompt.groups = groups;
      prompt.group_ids = groups.map(g => g.id);
      
      return prompt;
    } catch (error) {
      logger.error('根据ID查找系统提示词失败:', error);
      throw new DatabaseError('查找系统提示词失败', error);
    }
  }

  /**
   * 获取用户可用的系统提示词（不包含内容）
   */
  static async getUserAvailablePrompts(userId, groupId) {
    try {
      // 检查功能是否启用
      const enabledSql = `
        SELECT setting_value 
        FROM system_settings 
        WHERE setting_key = 'system_prompts_enabled'
      `;
      const { rows: enabledRows } = await dbConnection.query(enabledSql);
      
      if (enabledRows.length === 0 || enabledRows[0].setting_value !== 'true') {
        return [];
      }
      
      // 获取用户组可用的提示词（修复DISTINCT和ORDER BY的问题）
      let sql = `
        SELECT DISTINCT sp.id, sp.name, sp.description, sp.sort_order
        FROM system_prompts sp
        WHERE sp.is_active = 1
      `;
      
      // 如果有组ID，只返回该组可用的提示词
      if (groupId) {
        sql += `
          AND EXISTS (
            SELECT 1 FROM system_prompt_groups spg 
            WHERE spg.prompt_id = sp.id AND spg.group_id = ?
          )
        `;
      }
      
      sql += ' ORDER BY sp.sort_order ASC, sp.name ASC';
      
      const params = groupId ? [groupId] : [];
      const { rows } = await dbConnection.query(sql, params);
      
      // 返回时不包含content字段和sort_order字段
      return rows.map(row => ({
        id: row.id,
        name: row.name,
        description: row.description
      }));
    } catch (error) {
      logger.error('获取用户可用系统提示词失败:', error);
      throw new DatabaseError('获取可用系统提示词失败', error);
    }
  }

  /**
   * 创建系统提示词
   */
  static async create(data, creatorId) {
    const transaction = await dbConnection.beginTransaction();
    
    try {
      const { name, description, content, is_active = 1, sort_order = 0, group_ids = [] } = data;
      
      // 创建提示词
      const insertSql = `
        INSERT INTO system_prompts (name, description, content, is_active, sort_order, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      
      const result = await transaction.query(insertSql, [
        name,
        description || null,
        content,
        is_active ? 1 : 0,
        sort_order || 0,
        creatorId || null
      ]);
      
      // 从结果中获取insertId
      const insertId = result.rows.insertId;
      
      if (!insertId) {
        throw new Error('创建系统提示词失败，无法获取ID');
      }
      
      // 设置用户组权限
      if (group_ids && group_ids.length > 0) {
        // 使用循环插入，避免批量插入语法问题
        for (const groupId of group_ids) {
          const groupSql = 'INSERT INTO system_prompt_groups (prompt_id, group_id) VALUES (?, ?)';
          await transaction.query(groupSql, [insertId, groupId]);
        }
      } else {
        // 如果没有指定组，则对所有组可用
        const allGroupsSql = `
          INSERT INTO system_prompt_groups (prompt_id, group_id)
          SELECT ?, id FROM user_groups
        `;
        await transaction.query(allGroupsSql, [insertId]);
      }
      
      await transaction.commit();
      
      logger.info('创建系统提示词成功', { 
        promptId: insertId, 
        name,
        creatorId,
        groupIds: group_ids 
      });
      
      return await SystemPrompt.findById(insertId);
    } catch (error) {
      await transaction.rollback();
      logger.error('创建系统提示词失败:', error);
      throw new DatabaseError('创建系统提示词失败', error);
    }
  }

  /**
   * 更新系统提示词
   */
  static async update(id, data, operatorId) {
    const transaction = await dbConnection.beginTransaction();
    
    try {
      const { name, description, content, is_active, sort_order, group_ids } = data;
      
      // 更新提示词基本信息
      const updateFields = [];
      const updateValues = [];
      
      if (name !== undefined) {
        updateFields.push('name = ?');
        updateValues.push(name);
      }
      if (description !== undefined) {
        updateFields.push('description = ?');
        updateValues.push(description || null);
      }
      if (content !== undefined) {
        updateFields.push('content = ?');
        updateValues.push(content);
      }
      if (is_active !== undefined) {
        updateFields.push('is_active = ?');
        updateValues.push(is_active ? 1 : 0);
      }
      if (sort_order !== undefined) {
        updateFields.push('sort_order = ?');
        updateValues.push(sort_order || 0);
      }
      
      if (updateFields.length > 0) {
        updateValues.push(id);
        const updateSql = `UPDATE system_prompts SET ${updateFields.join(', ')} WHERE id = ?`;
        await transaction.query(updateSql, updateValues);
      }
      
      // 更新用户组权限
      if (group_ids !== undefined) {
        // 删除旧的权限
        await transaction.query('DELETE FROM system_prompt_groups WHERE prompt_id = ?', [id]);
        
        // 添加新的权限
        if (group_ids && group_ids.length > 0) {
          // 使用循环插入，避免批量插入语法问题
          for (const groupId of group_ids) {
            const groupSql = 'INSERT INTO system_prompt_groups (prompt_id, group_id) VALUES (?, ?)';
            await transaction.query(groupSql, [id, groupId]);
          }
        } else {
          // 如果没有指定组，则对所有组可用
          const allGroupsSql = `
            INSERT INTO system_prompt_groups (prompt_id, group_id)
            SELECT ?, id FROM user_groups
          `;
          await transaction.query(allGroupsSql, [id]);
        }
      }
      
      await transaction.commit();
      
      logger.info('更新系统提示词成功', { 
        promptId: id, 
        operatorId,
        updatedFields: updateFields 
      });
      
      return await SystemPrompt.findById(id);
    } catch (error) {
      await transaction.rollback();
      logger.error('更新系统提示词失败:', error);
      throw new DatabaseError('更新系统提示词失败', error);
    }
  }

  /**
   * 删除系统提示词
   */
  static async delete(id) {
    try {
      const sql = 'DELETE FROM system_prompts WHERE id = ?';
      const { affectedRows } = await dbConnection.query(sql, [id]);
      
      if (affectedRows === 0) {
        throw new Error('系统提示词不存在');
      }
      
      logger.info('删除系统提示词成功', { promptId: id });
      
      return true;
    } catch (error) {
      logger.error('删除系统提示词失败:', error);
      throw new DatabaseError('删除系统提示词失败', error);
    }
  }

  /**
   * 获取提示词内容（仅在实际使用时调用）
   */
  static async getPromptContent(id) {
    try {
      const sql = 'SELECT content FROM system_prompts WHERE id = ? AND is_active = 1';
      const { rows } = await dbConnection.query(sql, [id]);
      
      if (rows.length === 0) {
        return null;
      }
      
      return rows[0].content;
    } catch (error) {
      logger.error('获取提示词内容失败:', error);
      throw new DatabaseError('获取提示词内容失败', error);
    }
  }

  /**
   * 切换功能开关
   */
  static async toggleFeature(enabled) {
    try {
      // 使用 system_settings 表
      const sql = `
        INSERT INTO system_settings (setting_key, setting_value) 
        VALUES ('system_prompts_enabled', ?)
        ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)
      `;
      
      await dbConnection.query(sql, [enabled ? 'true' : 'false']);
      
      logger.info('系统提示词功能开关已更新', { enabled });
      
      return enabled;
    } catch (error) {
      logger.error('切换系统提示词功能失败:', error);
      throw new DatabaseError('切换功能开关失败', error);
    }
  }

  /**
   * 获取功能开关状态
   */
  static async getFeatureStatus() {
    try {
      const sql = `
        SELECT setting_value as enabled
        FROM system_settings 
        WHERE setting_key = 'system_prompts_enabled'
        LIMIT 1
      `;
      const { rows } = await dbConnection.query(sql);
      
      return {
        enabled: rows.length > 0 && rows[0].enabled === 'true'
      };
    } catch (error) {
      logger.error('获取功能开关状态失败:', error);
      return { enabled: false };
    }
  }

  /**
   * 转换为JSON（不包含敏感内容）
   */
  toJSON(includeContent = false) {
    const data = {
      id: this.id,
      name: this.name,
      description: this.description,
      is_active: this.is_active,
      sort_order: this.sort_order,
      created_by: this.created_by,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
    
    if (includeContent) {
      data.content = this.content;
    }
    
    if (this.creator_name) {
      data.creator_name = this.creator_name;
    }
    
    if (this.groups) {
      data.groups = this.groups;
    }
    
    if (this.group_names) {
      data.group_names = this.group_names;
    }
    
    if (this.group_ids) {
      data.group_ids = this.group_ids;
    }
    
    return data;
  }
}

module.exports = SystemPrompt;

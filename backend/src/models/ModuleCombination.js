/**
 * 模块组合模型
 */

const dbConnection = require('../database/connection');
const { DatabaseError } = require('../utils/errors');
const logger = require('../utils/logger');
const KnowledgeModule = require('./KnowledgeModule');

class ModuleCombination {
  constructor(data = {}) {
    this.id = data.id || null;
    this.name = data.name || '';
    this.description = data.description || '';
    this.user_id = data.user_id || null;
    this.estimated_tokens = data.estimated_tokens || 0;
    this.is_active = data.is_active !== undefined ? data.is_active : true;
    this.usage_count = data.usage_count || 0;
    this.created_at = data.created_at || null;
    this.updated_at = data.updated_at || null;
    this.modules = data.modules || [];
  }

  /**
   * 获取用户的组合列表
   */
  static async getUserCombinations(userId, includeInactive = false) {
    try {
      let sql = `
        SELECT mc.*, 
               COUNT(mci.module_id) as module_count
        FROM module_combinations mc
        LEFT JOIN module_combination_items mci ON mc.id = mci.combination_id
        WHERE mc.user_id = ?
      `;
      
      if (!includeInactive) {
        sql += ' AND mc.is_active = 1';
      }
      
      sql += ' GROUP BY mc.id ORDER BY mc.created_at DESC';
      
      const { rows } = await dbConnection.query(sql, [userId]);
      
      return rows.map(row => new ModuleCombination(row));
    } catch (error) {
      logger.error('获取用户模块组合列表失败:', error);
      throw new DatabaseError('获取模块组合列表失败', error);
    }
  }

  /**
   * 根据ID获取组合详情（包含模块）
   */
  static async findById(id, userId = null) {
    try {
      const sql = 'SELECT * FROM module_combinations WHERE id = ?';
      const { rows } = await dbConnection.query(sql, [id]);
      
      if (rows.length === 0) {
        return null;
      }
      
      const combination = new ModuleCombination(rows[0]);
      
      // 获取组合中的模块
      const modulesSql = `
        SELECT km.*, mci.order_index
        FROM module_combination_items mci
        JOIN knowledge_modules km ON mci.module_id = km.id
        WHERE mci.combination_id = ?
        ORDER BY mci.order_index ASC
      `;
      
      const { rows: moduleRows } = await dbConnection.query(modulesSql, [id]);
      
      // 获取用户信息以检查权限
      let userGroupId = null;
      if (userId) {
        const userResult = await dbConnection.query('SELECT group_id FROM users WHERE id = ?', [userId]);
        userGroupId = userResult.rows[0]?.group_id;
      }
      
      combination.modules = [];
      for (const row of moduleRows) {
        const module = await KnowledgeModule.findById(row.id, userId);
        if (module) {
          module.order_index = row.order_index;
          combination.modules.push(module);
        }
      }
      
      return combination;
    } catch (error) {
      logger.error('根据ID查找模块组合失败:', error);
      throw new DatabaseError('查找模块组合失败', error);
    }
  }

  /**
   * 创建模块组合
   * 修复：传递用户角色给checkUserAccess
   */
  static async create(data, userId) {
    const transaction = await dbConnection.beginTransaction();
    
    try {
      const { name, description, module_ids = [] } = data;
      
      // 获取用户信息和角色
      const userResult = await transaction.query('SELECT group_id, role FROM users WHERE id = ?', [userId]);
      const userGroupId = userResult.rows[0]?.group_id;
      const userRole = userResult.rows[0]?.role;
      
      // 创建组合
      const sql = `
        INSERT INTO module_combinations (name, description, user_id, estimated_tokens)
        VALUES (?, ?, ?, ?)
      `;
      
      // 估算token数（简单估算）
      let estimatedTokens = 0;
      if (module_ids.length > 0) {
        // 修复：正确处理IN子句
        const placeholders = module_ids.map(() => '?').join(',');
        const modulesResult = await transaction.query(
          `SELECT SUM(LENGTH(content)) as total_length FROM knowledge_modules WHERE id IN (${placeholders})`,
          module_ids
        );
        const totalLength = modulesResult.rows[0]?.total_length || 0;
        estimatedTokens = Math.ceil(totalLength / 4); // 粗略估算
      }
      
      const result = await transaction.query(sql, [
        name,
        description || null,
        userId,
        estimatedTokens
      ]);
      
      // 修复：正确获取insertId
      const combinationId = result.rows.insertId;
      
      // 添加模块关联
      if (module_ids.length > 0) {
        for (let i = 0; i < module_ids.length; i++) {
          const moduleId = module_ids[i];
          
          // 验证用户是否有权限使用该模块（传递用户角色）
          const hasAccess = await KnowledgeModule.checkUserAccess(moduleId, userId, userGroupId, userRole);
          if (!hasAccess) {
            // 对超级管理员不应该出现这种情况
            if (userRole === 'super_admin') {
              logger.error('超级管理员权限检查失败', {
                moduleId,
                userId,
                userRole
              });
            }
            throw new Error(`无权使用模块ID: ${moduleId}`);
          }
          
          await transaction.query(
            'INSERT INTO module_combination_items (combination_id, module_id, order_index) VALUES (?, ?, ?)',
            [combinationId, moduleId, i]
          );
        }
      }
      
      await transaction.commit();
      
      logger.info('创建模块组合成功', { 
        combinationId,
        name,
        userId,
        moduleCount: module_ids.length
      });
      
      return await ModuleCombination.findById(combinationId);
    } catch (error) {
      await transaction.rollback();
      logger.error('创建模块组合失败:', error);
      throw new DatabaseError('创建模块组合失败', error);
    }
  }

  /**
   * 更新模块组合
   * 修复：传递用户角色给checkUserAccess
   */
  static async update(id, data, userId) {
    const transaction = await dbConnection.beginTransaction();
    
    try {
      // 获取用户信息和角色
      const userResult = await transaction.query('SELECT group_id, role FROM users WHERE id = ?', [userId]);
      const userGroupId = userResult.rows[0]?.group_id;
      const userRole = userResult.rows[0]?.role;
      
      // 验证所有权（超级管理员可以修改任何组合）
      const combination = await ModuleCombination.findById(id);
      if (!combination) {
        throw new Error('模块组合不存在');
      }
      
      // 修复：超级管理员可以修改任何组合
      if (combination.user_id !== userId && userRole !== 'super_admin') {
        throw new Error('无权修改此组合');
      }
      
      // 更新基本信息
      const updateFields = [];
      const updateValues = [];
      
      if (data.name !== undefined) {
        updateFields.push('name = ?');
        updateValues.push(data.name);
      }
      
      if (data.description !== undefined) {
        updateFields.push('description = ?');
        updateValues.push(data.description || null);
      }
      
      if (data.is_active !== undefined) {
        updateFields.push('is_active = ?');
        updateValues.push(data.is_active);
      }
      
      if (updateFields.length > 0) {
        updateValues.push(id);
        const sql = `UPDATE module_combinations SET ${updateFields.join(', ')} WHERE id = ?`;
        await transaction.query(sql, updateValues);
      }
      
      // 更新模块列表
      if (data.module_ids !== undefined) {
        // 删除旧的关联
        await transaction.query('DELETE FROM module_combination_items WHERE combination_id = ?', [id]);
        
        // 添加新的关联
        const module_ids = data.module_ids || [];
        let estimatedTokens = 0;
        
        if (module_ids.length > 0) {
          // 估算token数 - 修复IN子句
          const placeholders = module_ids.map(() => '?').join(',');
          const modulesResult = await transaction.query(
            `SELECT SUM(LENGTH(content)) as total_length FROM knowledge_modules WHERE id IN (${placeholders})`,
            module_ids
          );
          const totalLength = modulesResult.rows[0]?.total_length || 0;
          estimatedTokens = Math.ceil(totalLength / 4);
          
          // 添加模块
          for (let i = 0; i < module_ids.length; i++) {
            const moduleId = module_ids[i];
            
            // 验证权限（传递用户角色）
            const hasAccess = await KnowledgeModule.checkUserAccess(moduleId, userId, userGroupId, userRole);
            
            if (!hasAccess) {
              // 对超级管理员记录警告
              if (userRole === 'super_admin') {
                logger.warn('超级管理员权限检查异常', {
                  moduleId,
                  userId,
                  userRole,
                  action: 'update_combination'
                });
              }
              throw new Error(`无权使用模块ID: ${moduleId}`);
            }
            
            await transaction.query(
              'INSERT INTO module_combination_items (combination_id, module_id, order_index) VALUES (?, ?, ?)',
              [id, moduleId, i]
            );
          }
        }
        
        // 更新token估算
        await transaction.query(
          'UPDATE module_combinations SET estimated_tokens = ? WHERE id = ?',
          [estimatedTokens, id]
        );
      }
      
      await transaction.commit();
      
      logger.info('更新模块组合成功', { 
        combinationId: id, 
        userId,
        userRole,
        isOwner: combination.user_id === userId
      });
      
      return await ModuleCombination.findById(id);
    } catch (error) {
      await transaction.rollback();
      logger.error('更新模块组合失败:', error);
      throw new DatabaseError('更新模块组合失败', error);
    }
  }

  /**
   * 删除模块组合
   * 修复：超级管理员可以删除任何组合
   */
  static async delete(id, userId) {
    try {
      // 获取用户角色
      const userResult = await dbConnection.query('SELECT role FROM users WHERE id = ?', [userId]);
      const userRole = userResult.rows[0]?.role;
      
      // 验证所有权
      const combination = await ModuleCombination.findById(id);
      if (!combination) {
        throw new Error('模块组合不存在');
      }
      
      // 修复：超级管理员可以删除任何组合
      if (combination.user_id !== userId && userRole !== 'super_admin') {
        throw new Error('无权删除此组合');
      }
      
      // 软删除
      const sql = 'UPDATE module_combinations SET is_active = 0 WHERE id = ?';
      await dbConnection.query(sql, [id]);
      
      logger.info('删除模块组合成功', { 
        combinationId: id, 
        userId,
        userRole,
        isOwner: combination.user_id === userId
      });
      
      return true;
    } catch (error) {
      logger.error('删除模块组合失败:', error);
      throw new DatabaseError('删除模块组合失败', error);
    }
  }

  /**
   * 获取组合的完整内容（用于对话）
   * 修复：如果组合包含系统级模块，则允许所有用户使用
   */
  static async getCombinedContent(id, userId) {
    try {
      const combination = await ModuleCombination.findById(id, userId);
      if (!combination) {
        throw new Error('模块组合不存在');
      }
      
      // 获取用户角色
      const userResult = await dbConnection.query('SELECT role FROM users WHERE id = ?', [userId]);
      const userRole = userResult.rows[0]?.role;
      
      // 超级管理员可以使用任何组合
      if (userRole !== 'super_admin') {
        // 检查组合中是否包含系统级模块
        const hasSystemModule = combination.modules.some(module => module.module_scope === 'system');
        
        // 如果不包含系统级模块，则检查所有权
        if (!hasSystemModule && combination.user_id !== userId) {
          throw new Error('无权使用此组合');
        }
        
        // 如果包含系统级模块，记录日志
        if (hasSystemModule) {
          logger.info('用户使用包含系统级模块的组合', {
            userId,
            combinationId: id,
            combinationOwnerId: combination.user_id,
            systemModules: combination.modules.filter(m => m.module_scope === 'system').map(m => ({
              id: m.id,
              name: m.name
            }))
          });
        }
      }
      
      let systemPrompts = [];
      let normalPrompts = [];
      
      for (const module of combination.modules) {
        // 跳过内容被隐藏的模块（超级管理员除外）
        if (userRole !== 'super_admin' && (module.content_hidden || !module.content)) {
          logger.debug('跳过隐藏内容的模块', {
            moduleId: module.id,
            moduleName: module.name,
            userId
          });
          continue;
        }
        
        if (module.prompt_type === 'system') {
          systemPrompts.push(module.content);
        } else {
          normalPrompts.push(module.content);
        }
        
        // 更新使用次数
        await KnowledgeModule.incrementUsageCount(module.id);
      }
      
      // 更新组合使用次数
      await dbConnection.query(
        'UPDATE module_combinations SET usage_count = usage_count + 1 WHERE id = ?',
        [id]
      );
      
      return {
        systemPrompt: systemPrompts.join('\n\n'),
        normalPrompt: normalPrompts.join('\n\n')
      };
    } catch (error) {
      logger.error('获取组合内容失败:', error);
      throw new DatabaseError('获取组合内容失败', error);
    }
  }

  /**
   * 复制组合
   * 修复：需要检查用户对所有模块的访问权限
   */
  static async copy(id, userId, newName) {
    try {
      const original = await ModuleCombination.findById(id);
      if (!original) {
        throw new Error('原组合不存在');
      }
      
      // 获取用户信息
      const userResult = await dbConnection.query('SELECT group_id, role FROM users WHERE id = ?', [userId]);
      const userGroupId = userResult.rows[0]?.group_id;
      const userRole = userResult.rows[0]?.role;
      
      // 过滤用户有权限的模块
      const accessibleModuleIds = [];
      for (const module of original.modules) {
        const hasAccess = await KnowledgeModule.checkUserAccess(
          module.id, 
          userId, 
          userGroupId, 
          userRole
        );
        if (hasAccess) {
          accessibleModuleIds.push(module.id);
        } else {
          logger.warn('复制组合时跳过无权限的模块', {
            moduleId: module.id,
            moduleName: module.name,
            userId,
            userRole
          });
        }
      }
      
      if (accessibleModuleIds.length === 0) {
        throw new Error('您没有权限使用原组合中的任何模块');
      }
      
      const newCombination = await ModuleCombination.create({
        name: newName || `${original.name} (副本)`,
        description: original.description,
        module_ids: accessibleModuleIds
      }, userId);
      
      // 如果有模块被过滤，记录日志
      if (accessibleModuleIds.length < original.modules.length) {
        logger.info('复制组合时过滤了部分模块', {
          originalCount: original.modules.length,
          copiedCount: accessibleModuleIds.length,
          userId,
          userRole
        });
      }
      
      return newCombination;
    } catch (error) {
      logger.error('复制模块组合失败:', error);
      throw new DatabaseError('复制模块组合失败', error);
    }
  }

  /**
   * 转换为JSON
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      user_id: this.user_id,
      estimated_tokens: this.estimated_tokens,
      is_active: this.is_active,
      usage_count: this.usage_count,
      created_at: this.created_at,
      updated_at: this.updated_at,
      module_count: this.module_count || this.modules.length,
      modules: this.modules.map(m => m.toJSON())
    };
  }
}

module.exports = ModuleCombination;

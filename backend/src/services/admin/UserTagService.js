/**
 * 用户标签服务层 - 处理标签相关业务逻辑
 */

const dbConnection = require('../../database/connection');
const logger = require('../../utils/logger');
const { DatabaseError, ValidationError, ConflictError } = require('../../utils/errors');

class UserTagService {
  /**
   * 获取组内所有标签
   */
  static async getGroupTags(groupId, includeInactive = false) {
    try {
      let sql = `
        SELECT 
          ut.*,
          COUNT(DISTINCT utr.user_id) as user_count,
          u.username as creator_name
        FROM user_tags ut
        LEFT JOIN user_tag_relations utr ON ut.id = utr.tag_id
        LEFT JOIN users u ON ut.created_by = u.id
        WHERE ut.group_id = ?
      `;
      
      if (!includeInactive) {
        sql += ' AND ut.is_active = 1';
      }
      
      sql += ' GROUP BY ut.id ORDER BY ut.sort_order ASC, ut.created_at ASC';
      
      const { rows } = await dbConnection.query(sql, [groupId]);
      return rows;
    } catch (error) {
      logger.error('获取组标签失败', { error: error.message, groupId });
      throw new DatabaseError('获取标签列表失败', error);
    }
  }

  /**
   * 批量获取标签信息
   * 新增：根据标签ID数组批量获取标签详细信息
   */
  static async getBatchTagInfo(tagIds, currentUser) {
    try {
      if (!Array.isArray(tagIds) || tagIds.length === 0) {
        return [];
      }

      // 去重
      const uniqueTagIds = [...new Set(tagIds)];
      const placeholders = uniqueTagIds.map(() => '?').join(',');
      
      let sql = `
        SELECT 
          ut.id,
          ut.group_id,
          ut.name,
          ut.color,
          ut.description,
          ut.icon,
          ut.sort_order,
          ut.is_active,
          ug.name as group_name
        FROM user_tags ut
        LEFT JOIN user_groups ug ON ut.group_id = ug.id
        WHERE ut.id IN (${placeholders})
      `;

      // 如果是组管理员，只返回本组的标签
      if (currentUser.role === 'admin') {
        sql += ' AND ut.group_id = ?';
        uniqueTagIds.push(currentUser.group_id);
      }

      const { rows } = await dbConnection.query(sql, uniqueTagIds);
      
      logger.debug('批量获取标签信息', {
        requestedIds: tagIds,
        returnedCount: rows.length,
        operatorId: currentUser.id
      });

      return rows;
    } catch (error) {
      logger.error('批量获取标签信息失败', { error: error.message, tagIds });
      throw new DatabaseError('批量获取标签信息失败', error);
    }
  }

  /**
   * 创建标签
   */
  static async createTag(tagData, operatorId) {
    try {
      const { group_id, name, color = '#1677ff', description, icon, sort_order = 0 } = tagData;

      // 验证必填字段
      if (!group_id || !name) {
        throw new ValidationError('组ID和标签名称不能为空');
      }

      // 检查同组内是否有重名标签
      const existingSql = 'SELECT id FROM user_tags WHERE group_id = ? AND name = ?';
      const { rows: existing } = await dbConnection.query(existingSql, [group_id, name]);
      
      if (existing.length > 0) {
        throw new ConflictError('该组内已存在同名标签');
      }

      // 创建标签
      const insertSql = `
        INSERT INTO user_tags (group_id, name, color, description, icon, sort_order, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;
      
      const { rows } = await dbConnection.query(insertSql, [
        group_id, name, color, description, icon, sort_order, operatorId
      ]);

      const tagId = rows.insertId;

      logger.info('创建标签成功', {
        tagId,
        groupId: group_id,
        name,
        operatorId
      });

      // 返回创建的标签
      const { rows: [newTag] } = await dbConnection.query(
        'SELECT * FROM user_tags WHERE id = ?',
        [tagId]
      );
      
      return newTag;
    } catch (error) {
      logger.error('创建标签失败', { error: error.message, tagData });
      throw error;
    }
  }

  /**
   * 更新标签
   */
  static async updateTag(tagId, updateData, operatorId) {
    try {
      // 获取原标签信息
      const { rows: [tag] } = await dbConnection.query(
        'SELECT * FROM user_tags WHERE id = ?',
        [tagId]
      );
      
      if (!tag) {
        throw new ValidationError('标签不存在');
      }

      // 如果要更新名称，检查同组内是否有重名
      if (updateData.name && updateData.name !== tag.name) {
        const existingSql = 'SELECT id FROM user_tags WHERE group_id = ? AND name = ? AND id != ?';
        const { rows: existing } = await dbConnection.query(existingSql, [
          tag.group_id, updateData.name, tagId
        ]);
        
        if (existing.length > 0) {
          throw new ConflictError('该组内已存在同名标签');
        }
      }

      // 构建更新SQL
      const updateFields = [];
      const values = [];
      
      ['name', 'color', 'description', 'icon', 'sort_order', 'is_active'].forEach(field => {
        if (updateData[field] !== undefined) {
          updateFields.push(`${field} = ?`);
          values.push(updateData[field]);
        }
      });

      if (updateFields.length === 0) {
        return tag;
      }

      values.push(tagId);
      const updateSql = `
        UPDATE user_tags 
        SET ${updateFields.join(', ')}, updated_at = NOW()
        WHERE id = ?
      `;

      await dbConnection.query(updateSql, values);

      logger.info('更新标签成功', {
        tagId,
        updatedFields: updateFields,
        operatorId
      });

      // 返回更新后的标签
      const { rows: [updatedTag] } = await dbConnection.query(
        'SELECT * FROM user_tags WHERE id = ?',
        [tagId]
      );
      
      return updatedTag;
    } catch (error) {
      logger.error('更新标签失败', { error: error.message, tagId, updateData });
      throw error;
    }
  }

  /**
   * 删除标签
   */
  static async deleteTag(tagId, operatorId) {
    try {
      // 检查标签是否存在
      const { rows: [tag] } = await dbConnection.query(
        'SELECT * FROM user_tags WHERE id = ?',
        [tagId]
      );
      
      if (!tag) {
        throw new ValidationError('标签不存在');
      }

      // 删除标签（会级联删除关系）
      await dbConnection.query('DELETE FROM user_tags WHERE id = ?', [tagId]);

      logger.info('删除标签成功', {
        tagId,
        tagName: tag.name,
        operatorId
      });

      return { success: true, message: '标签删除成功' };
    } catch (error) {
      logger.error('删除标签失败', { error: error.message, tagId });
      throw error;
    }
  }

  /**
   * 获取用户的标签
   */
  static async getUserTags(userId) {
    try {
      const sql = `
        SELECT 
          ut.*,
          utr.assigned_at,
          utr.assigned_by,
          u.username as assigned_by_name
        FROM user_tag_relations utr
        JOIN user_tags ut ON utr.tag_id = ut.id
        LEFT JOIN users u ON utr.assigned_by = u.id
        WHERE utr.user_id = ? AND ut.is_active = 1
        ORDER BY ut.sort_order ASC, ut.name ASC
      `;
      
      const { rows } = await dbConnection.query(sql, [userId]);
      return rows;
    } catch (error) {
      logger.error('获取用户标签失败', { error: error.message, userId });
      throw new DatabaseError('获取用户标签失败', error);
    }
  }

  /**
   * 分配标签给用户
   */
  static async assignTagsToUser(userId, tagIds, operatorId) {
    try {
      if (!Array.isArray(tagIds) || tagIds.length === 0) {
        throw new ValidationError('标签ID列表不能为空');
      }

      // 验证用户是否存在
      const { rows: [user] } = await dbConnection.query(
        'SELECT id, group_id FROM users WHERE id = ?',
        [userId]
      );
      
      if (!user) {
        throw new ValidationError('用户不存在');
      }

      // 验证所有标签是否属于用户所在组
      const placeholders = tagIds.map(() => '?').join(',');
      const tagCheckSql = `
        SELECT id FROM user_tags 
        WHERE id IN (${placeholders}) 
        AND group_id = ? 
        AND is_active = 1
      `;
      
      const { rows: validTags } = await dbConnection.query(
        tagCheckSql,
        [...tagIds, user.group_id]
      );

      if (validTags.length !== tagIds.length) {
        throw new ValidationError('包含无效的标签ID或标签不属于用户所在组');
      }

      // 使用事务批量插入
      await dbConnection.transaction(async (query) => {
        // 获取用户现有标签
        const { rows: existingTags } = await query(
          'SELECT tag_id FROM user_tag_relations WHERE user_id = ?',
          [userId]
        );
        const existingTagIds = existingTags.map(t => t.tag_id);

        // 找出需要新增的标签
        const newTagIds = tagIds.filter(id => !existingTagIds.includes(id));
        
        if (newTagIds.length > 0) {
          // 批量插入新标签关系
          const insertValues = newTagIds.map(tagId => [userId, tagId, operatorId]);
          const insertSql = `
            INSERT INTO user_tag_relations (user_id, tag_id, assigned_by)
            VALUES ${insertValues.map(() => '(?, ?, ?)').join(', ')}
          `;
          await query(insertSql, insertValues.flat());
        }

        // 更新用户的标签计数
        await query(
          'UPDATE users SET tag_count = (SELECT COUNT(*) FROM user_tag_relations WHERE user_id = ?) WHERE id = ?',
          [userId, userId]
        );
      });

      logger.info('分配标签给用户成功', {
        userId,
        tagIds,
        operatorId
      });

      return { success: true, message: '标签分配成功' };
    } catch (error) {
      logger.error('分配标签失败', { error: error.message, userId, tagIds });
      throw error;
    }
  }

  /**
   * 移除用户的标签
   */
  static async removeUserTags(userId, tagIds, operatorId) {
    try {
      if (!Array.isArray(tagIds) || tagIds.length === 0) {
        throw new ValidationError('标签ID列表不能为空');
      }

      const placeholders = tagIds.map(() => '?').join(',');
      const deleteSql = `
        DELETE FROM user_tag_relations 
        WHERE user_id = ? AND tag_id IN (${placeholders})
      `;
      
      const { rows } = await dbConnection.query(deleteSql, [userId, ...tagIds]);

      // 更新用户的标签计数
      await dbConnection.query(
        'UPDATE users SET tag_count = (SELECT COUNT(*) FROM user_tag_relations WHERE user_id = ?) WHERE id = ?',
        [userId, userId]
      );

      logger.info('移除用户标签成功', {
        userId,
        tagIds,
        removedCount: rows.affectedRows,
        operatorId
      });

      return { 
        success: true, 
        message: `成功移除${rows.affectedRows}个标签` 
      };
    } catch (error) {
      logger.error('移除用户标签失败', { error: error.message, userId, tagIds });
      throw error;
    }
  }

  /**
   * 批量更新用户标签（覆盖式更新）
   */
  static async updateUserTags(userId, tagIds, operatorId) {
    try {
      // 使用事务确保原子性
      await dbConnection.transaction(async (query) => {
        // 1. 删除用户所有现有标签
        await query('DELETE FROM user_tag_relations WHERE user_id = ?', [userId]);

        // 2. 如果有新标签，批量插入
        if (tagIds && tagIds.length > 0) {
          // 验证用户和标签
          const { rows: [user] } = await query(
            'SELECT id, group_id FROM users WHERE id = ?',
            [userId]
          );
          
          if (!user) {
            throw new ValidationError('用户不存在');
          }

          // 验证标签属于用户所在组
          const placeholders = tagIds.map(() => '?').join(',');
          const tagCheckSql = `
            SELECT id FROM user_tags 
            WHERE id IN (${placeholders}) 
            AND group_id = ? 
            AND is_active = 1
          `;
          
          const { rows: validTags } = await query(
            tagCheckSql,
            [...tagIds, user.group_id]
          );

          if (validTags.length !== tagIds.length) {
            throw new ValidationError('包含无效的标签ID');
          }

          // 批量插入新标签
          const insertValues = tagIds.map(tagId => [userId, tagId, operatorId]);
          const insertSql = `
            INSERT INTO user_tag_relations (user_id, tag_id, assigned_by)
            VALUES ${insertValues.map(() => '(?, ?, ?)').join(', ')}
          `;
          await query(insertSql, insertValues.flat());
        }

        // 3. 更新用户标签计数
        await query(
          'UPDATE users SET tag_count = ? WHERE id = ?',
          [tagIds ? tagIds.length : 0, userId]
        );
      });

      logger.info('批量更新用户标签成功', {
        userId,
        newTagCount: tagIds ? tagIds.length : 0,
        operatorId
      });

      return { success: true, message: '用户标签更新成功' };
    } catch (error) {
      logger.error('批量更新用户标签失败', { error: error.message, userId, tagIds });
      throw error;
    }
  }

  /**
   * 根据标签筛选用户
   */
  static async getUsersByTags(groupId, tagIds, includeAll = false) {
    try {
      let sql;
      let params;

      if (includeAll) {
        // 包含所有指定标签的用户（AND关系）
        sql = `
          SELECT 
            u.id,
            u.username,
            u.email,
            u.status,
            u.remark,
            u.tag_count,
            GROUP_CONCAT(ut.name) as tag_names,
            GROUP_CONCAT(ut.color) as tag_colors
          FROM users u
          JOIN user_tag_relations utr ON u.id = utr.user_id
          JOIN user_tags ut ON utr.tag_id = ut.id
          WHERE u.group_id = ?
            AND ut.id IN (${tagIds.map(() => '?').join(',')})
          GROUP BY u.id
          HAVING COUNT(DISTINCT ut.id) = ?
        `;
        params = [groupId, ...tagIds, tagIds.length];
      } else {
        // 包含任意指定标签的用户（OR关系）
        sql = `
          SELECT DISTINCT
            u.id,
            u.username,
            u.email,
            u.status,
            u.remark,
            u.tag_count
          FROM users u
          JOIN user_tag_relations utr ON u.id = utr.user_id
          WHERE u.group_id = ?
            AND utr.tag_id IN (${tagIds.map(() => '?').join(',')})
        `;
        params = [groupId, ...tagIds];
      }

      const { rows } = await dbConnection.query(sql, params);

      // 获取每个用户的所有标签
      for (const user of rows) {
        const tags = await UserTagService.getUserTags(user.id);
        user.tags = tags;
      }

      return rows;
    } catch (error) {
      logger.error('根据标签筛选用户失败', { error: error.message, groupId, tagIds });
      throw new DatabaseError('筛选用户失败', error);
    }
  }

  /**
   * 获取标签统计信息
   */
  static async getTagStatistics(groupId) {
    try {
      const sql = `
        SELECT 
          ut.id,
          ut.name,
          ut.color,
          ut.description,
          COUNT(DISTINCT utr.user_id) as user_count,
          GROUP_CONCAT(DISTINCT u.username ORDER BY u.username SEPARATOR ', ') as user_names
        FROM user_tags ut
        LEFT JOIN user_tag_relations utr ON ut.id = utr.tag_id
        LEFT JOIN users u ON utr.user_id = u.id
        WHERE ut.group_id = ? AND ut.is_active = 1
        GROUP BY ut.id
        ORDER BY user_count DESC, ut.sort_order ASC
      `;

      const { rows } = await dbConnection.query(sql, [groupId]);
      
      return {
        total_tags: rows.length,
        tags: rows
      };
    } catch (error) {
      logger.error('获取标签统计失败', { error: error.message, groupId });
      throw new DatabaseError('获取标签统计失败', error);
    }
  }
}

module.exports = UserTagService;

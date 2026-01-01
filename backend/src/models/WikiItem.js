/**
 * 知识库数据模型
 * 
 * 功能：
 * - 三级范围管理：personal个人/team团队/global全局
 * - 版本管理：保存历史版本，支持回滚
 * - 协作编辑：团队知识库可指定额外编辑者
 * - JSON字段：notes备注数组(最多10条)、links链接数组(最多10条)
 * 
 * 创建时间：2026-01-02
 * 更新：修复getVersions方法LIMIT参数问题
 */

const dbConnection = require('../database/connection');
const { DatabaseError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

class WikiItem {
  constructor(data = {}) {
    this.id = data.id || null;
    this.title = data.title || '';
    this.description = data.description || '';
    this.content = data.content || '';
    this.notes = data.notes || [];
    this.links = data.links || [];
    this.scope = data.scope || 'personal';
    this.creator_id = data.creator_id || null;
    this.group_id = data.group_id || null;
    this.is_pinned = data.is_pinned || false;
    this.sort_order = data.sort_order || 0;
    this.current_version = data.current_version || 1;
    this.version_count = data.version_count || 1;
    this.created_at = data.created_at || null;
    this.updated_at = data.updated_at || null;
    // 额外字段
    this.creator_name = data.creator_name || null;
    this.group_name = data.group_name || null;
    this.can_edit = data.can_edit || false;
  }

  /**
   * 解析JSON字段
   */
  static parseJsonField(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch (e) {
        return [];
      }
    }
    return [];
  }

  /**
   * 验证notes数组（最多10条）
   */
  static validateNotes(notes) {
    if (!notes) return [];
    const arr = Array.isArray(notes) ? notes : [];
    // 最多10条，每条限制500字符
    return arr.slice(0, 10).map(note => 
      typeof note === 'string' ? note.substring(0, 500) : ''
    ).filter(note => note.trim());
  }

  /**
   * 验证links数组（最多10条）
   */
  static validateLinks(links) {
    if (!links) return [];
    const arr = Array.isArray(links) ? links : [];
    // 最多10条，每条包含title和url
    return arr.slice(0, 10).map(link => ({
      title: (link.title || '').substring(0, 200),
      url: (link.url || '').substring(0, 1000)
    })).filter(link => link.title || link.url);
  }

  /**
   * 获取用户可访问的知识库列表
   * @param {number} userId - 用户ID
   * @param {number} groupId - 用户所属组ID
   * @param {string} userRole - 用户角色
   * @param {string} scope - 筛选范围（可选）
   */
  static async getUserAccessibleItems(userId, groupId, userRole, scope = null) {
    try {
      let sql = `
        SELECT wi.*, 
               u.username as creator_name,
               ug.name as group_name
        FROM wiki_items wi
        LEFT JOIN users u ON wi.creator_id = u.id
        LEFT JOIN user_groups ug ON wi.group_id = ug.id
        WHERE (
          -- 个人知识库：只能看自己的
          (wi.scope = 'personal' AND wi.creator_id = ?)
          -- 团队知识库：同组可见
          OR (wi.scope = 'team' AND wi.group_id = ?)
          -- 全局知识库：所有人可见
          OR wi.scope = 'global'
        )
      `;
      
      const params = [userId, groupId];
      
      // 按范围筛选
      if (scope && ['personal', 'team', 'global'].includes(scope)) {
        sql += ' AND wi.scope = ?';
        params.push(scope);
      }
      
      sql += ' ORDER BY wi.is_pinned DESC, wi.sort_order ASC, wi.updated_at DESC';
      
      const { rows } = await dbConnection.query(sql, params);
      
      return rows.map(row => {
        const item = new WikiItem(row);
        item.notes = WikiItem.parseJsonField(row.notes);
        item.links = WikiItem.parseJsonField(row.links);
        item.can_edit = WikiItem.checkCanEdit(row, userId, groupId, userRole);
        return item;
      });
    } catch (error) {
      logger.error('获取知识库列表失败:', error);
      throw new DatabaseError('获取知识库列表失败', error);
    }
  }

  /**
   * 检查用户是否有编辑权限
   */
  static checkCanEdit(item, userId, groupId, userRole) {
    // 超级管理员可以编辑所有
    if (userRole === 'super_admin') return true;
    
    // 个人知识库：只有创建者可以编辑
    if (item.scope === 'personal') {
      return item.creator_id === userId;
    }
    
    // 团队知识库：组管理员或指定编辑者可以编辑
    if (item.scope === 'team') {
      // 创建者可以编辑
      if (item.creator_id === userId) return true;
      // 组管理员可以编辑同组的
      if (userRole === 'admin' && item.group_id === groupId) return true;
      // 检查是否是指定编辑者（需要额外查询）
      return false; // 这个在控制器层面再判断
    }
    
    // 全局知识库：只有超级管理员可以编辑
    if (item.scope === 'global') {
      return userRole === 'super_admin';
    }
    
    return false;
  }

  /**
   * 检查用户是否是指定编辑者
   */
  static async isEditor(wikiId, userId) {
    try {
      const sql = 'SELECT id FROM wiki_editors WHERE wiki_id = ? AND user_id = ?';
      const { rows } = await dbConnection.query(sql, [wikiId, userId]);
      return rows.length > 0;
    } catch (error) {
      logger.error('检查编辑者权限失败:', error);
      return false;
    }
  }

  /**
   * 根据ID获取知识库详情
   */
  static async findById(id, userId = null, groupId = null, userRole = null) {
    try {
      const sql = `
        SELECT wi.*, 
               u.username as creator_name,
               ug.name as group_name
        FROM wiki_items wi
        LEFT JOIN users u ON wi.creator_id = u.id
        LEFT JOIN user_groups ug ON wi.group_id = ug.id
        WHERE wi.id = ?
      `;
      
      const { rows } = await dbConnection.query(sql, [id]);
      
      if (rows.length === 0) return null;
      
      const row = rows[0];
      const item = new WikiItem(row);
      item.notes = WikiItem.parseJsonField(row.notes);
      item.links = WikiItem.parseJsonField(row.links);
      
      // 计算编辑权限
      if (userId) {
        item.can_edit = WikiItem.checkCanEdit(row, userId, groupId, userRole);
        // 如果是团队知识库且基本权限为false，检查是否是指定编辑者
        if (!item.can_edit && row.scope === 'team') {
          item.can_edit = await WikiItem.isEditor(id, userId);
        }
      }
      
      return item;
    } catch (error) {
      logger.error('获取知识库详情失败:', error);
      throw new DatabaseError('获取知识库详情失败', error);
    }
  }

  /**
   * 检查用户是否有权限访问该知识库
   */
  static async checkAccess(wikiId, userId, groupId, userRole) {
    try {
      const item = await WikiItem.findById(wikiId);
      if (!item) return { hasAccess: false, canEdit: false, item: null };
      
      let hasAccess = false;
      let canEdit = false;
      
      // 超级管理员有所有权限
      if (userRole === 'super_admin') {
        return { hasAccess: true, canEdit: true, item };
      }
      
      switch (item.scope) {
        case 'personal':
          hasAccess = item.creator_id === userId;
          canEdit = hasAccess;
          break;
        case 'team':
          hasAccess = item.group_id === groupId;
          canEdit = item.creator_id === userId || 
                   (userRole === 'admin' && item.group_id === groupId) ||
                   await WikiItem.isEditor(wikiId, userId);
          break;
        case 'global':
          hasAccess = true;
          canEdit = userRole === 'super_admin';
          break;
      }
      
      return { hasAccess, canEdit, item };
    } catch (error) {
      logger.error('检查知识库访问权限失败:', error);
      return { hasAccess: false, canEdit: false, item: null };
    }
  }

  /**
   * 创建知识库
   */
  static async create(data, creatorId) {
    const transaction = await dbConnection.beginTransaction();
    try {
      // 验证必填字段
      if (!data.title || !data.title.trim()) {
        throw new ValidationError('标题不能为空');
      }
      
      // 验证scope
      const scope = data.scope || 'personal';
      if (!['personal', 'team', 'global'].includes(scope)) {
        throw new ValidationError('无效的范围类型');
      }
      
      // 团队知识库必须有group_id
      if (scope === 'team' && !data.group_id) {
        throw new ValidationError('团队知识库必须指定所属组');
      }
      
      // 验证并处理notes和links
      const notes = WikiItem.validateNotes(data.notes);
      const links = WikiItem.validateLinks(data.links);
      
      const sql = `
        INSERT INTO wiki_items (
          title, description, content, notes, links,
          scope, creator_id, group_id, is_pinned, sort_order,
          current_version, version_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
      `;
      
      const params = [
        data.title.trim().substring(0, 500),
        (data.description || '').substring(0, 2000),
        data.content || '',
        JSON.stringify(notes),
        JSON.stringify(links),
        scope,
        creatorId,
        scope === 'team' ? data.group_id : null,
        data.is_pinned ? 1 : 0,
        data.sort_order || 0
      ];
      
      const result = await transaction.query(sql, params);
      const insertId = result.rows.insertId;
      
      // 创建初始版本
      await WikiItem.saveVersionInTransaction(transaction, insertId, {
        title: data.title.trim(),
        description: data.description || '',
        content: data.content || '',
        notes,
        links
      }, creatorId, '初始版本');
      
      await transaction.commit();
      
      logger.info('创建知识库成功', { id: insertId, title: data.title, creatorId });
      
      return await WikiItem.findById(insertId);
    } catch (error) {
      await transaction.rollback();
      logger.error('创建知识库失败:', error);
      throw error;
    }
  }

  /**
   * 更新知识库（不保存版本）
   */
  static async update(id, data, operatorId) {
    try {
      const updateFields = [];
      const updateValues = [];
      
      // 允许更新的字段
      if (data.title !== undefined) {
        if (!data.title.trim()) {
          throw new ValidationError('标题不能为空');
        }
        updateFields.push('title = ?');
        updateValues.push(data.title.trim().substring(0, 500));
      }
      
      if (data.description !== undefined) {
        updateFields.push('description = ?');
        updateValues.push((data.description || '').substring(0, 2000));
      }
      
      if (data.content !== undefined) {
        updateFields.push('content = ?');
        updateValues.push(data.content || '');
      }
      
      if (data.notes !== undefined) {
        updateFields.push('notes = ?');
        updateValues.push(JSON.stringify(WikiItem.validateNotes(data.notes)));
      }
      
      if (data.links !== undefined) {
        updateFields.push('links = ?');
        updateValues.push(JSON.stringify(WikiItem.validateLinks(data.links)));
      }
      
      if (data.is_pinned !== undefined) {
        updateFields.push('is_pinned = ?');
        updateValues.push(data.is_pinned ? 1 : 0);
      }
      
      if (data.sort_order !== undefined) {
        updateFields.push('sort_order = ?');
        updateValues.push(parseInt(data.sort_order) || 0);
      }
      
      if (updateFields.length === 0) {
        throw new ValidationError('没有要更新的字段');
      }
      
      updateValues.push(id);
      const sql = `UPDATE wiki_items SET ${updateFields.join(', ')} WHERE id = ?`;
      
      await dbConnection.query(sql, updateValues);
      
      logger.info('更新知识库成功', { id, operatorId });
      
      return await WikiItem.findById(id);
    } catch (error) {
      logger.error('更新知识库失败:', error);
      throw error;
    }
  }

  /**
   * 在事务中保存版本
   */
  static async saveVersionInTransaction(transaction, wikiId, data, userId, changeSummary = null) {
    // 获取当前版本号
    const versionSql = 'SELECT current_version, version_count FROM wiki_items WHERE id = ? FOR UPDATE';
    const { rows } = await transaction.query(versionSql, [wikiId]);
    
    if (rows.length === 0) {
      throw new ValidationError('知识库不存在');
    }
    
    const newVersion = rows[0].current_version + 1;
    let newCount = rows[0].version_count + 1;
    
    // 限制最多50个版本
    if (newCount > 50) {
      // 删除最旧的版本 - 使用子查询方式
      const deleteOldSql = `
        DELETE FROM wiki_versions 
        WHERE wiki_id = ? AND id IN (
          SELECT id FROM (
            SELECT id FROM wiki_versions WHERE wiki_id = ? ORDER BY version_number ASC LIMIT ${newCount - 50}
          ) as tmp
        )
      `;
      await transaction.query(deleteOldSql, [wikiId, wikiId]);
      newCount = 50;
    }
    
    // 插入新版本
    const insertSql = `
      INSERT INTO wiki_versions (
        wiki_id, version_number, title, description, content,
        notes_snapshot, links_snapshot, change_summary, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    await transaction.query(insertSql, [
      wikiId,
      newVersion,
      data.title,
      data.description || '',
      data.content || '',
      JSON.stringify(data.notes || []),
      JSON.stringify(data.links || []),
      changeSummary,
      userId
    ]);
    
    // 更新主表版本号
    const updateSql = 'UPDATE wiki_items SET current_version = ?, version_count = ? WHERE id = ?';
    await transaction.query(updateSql, [newVersion, newCount, wikiId]);
    
    return newVersion;
  }

  /**
   * 保存新版本
   */
  static async saveVersion(wikiId, data, userId, changeSummary = null) {
    const transaction = await dbConnection.beginTransaction();
    try {
      const newVersion = await WikiItem.saveVersionInTransaction(
        transaction, wikiId, data, userId, changeSummary
      );
      
      await transaction.commit();
      
      logger.info('保存知识库版本成功', { wikiId, version: newVersion, userId });
      
      return { version: newVersion };
    } catch (error) {
      await transaction.rollback();
      logger.error('保存知识库版本失败:', error);
      throw error;
    }
  }

  /**
   * 获取版本历史
   * 注意：MySQL2的prepared statement对LIMIT参数处理有问题，所以limit直接拼入SQL
   * @param {number} wikiId - 知识库ID
   * @param {number} limit - 返回条数（默认50，最大100）
   */
  static async getVersions(wikiId, limit = 50) {
    try {
      // 确保limit是合法的整数，防止SQL注入
      const safeLimit = Math.min(Math.max(parseInt(limit) || 50, 1), 100);
      
      // 将limit直接拼入SQL，避免MySQL2的prepared statement参数问题
      const sql = `
        SELECT wv.*, u.username as created_by_name
        FROM wiki_versions wv
        LEFT JOIN users u ON wv.created_by = u.id
        WHERE wv.wiki_id = ?
        ORDER BY wv.version_number DESC
        LIMIT ${safeLimit}
      `;
      
      const { rows } = await dbConnection.query(sql, [wikiId]);
      
      return rows.map(row => ({
        id: row.id,
        version_number: row.version_number,
        title: row.title,
        change_summary: row.change_summary,
        created_by: row.created_by,
        created_by_name: row.created_by_name,
        created_at: row.created_at
      }));
    } catch (error) {
      logger.error('获取版本历史失败:', error);
      throw new DatabaseError('获取版本历史失败', error);
    }
  }

  /**
   * 获取指定版本详情
   */
  static async getVersionDetail(versionId) {
    try {
      const sql = `
        SELECT wv.*, u.username as created_by_name
        FROM wiki_versions wv
        LEFT JOIN users u ON wv.created_by = u.id
        WHERE wv.id = ?
      `;
      
      const { rows } = await dbConnection.query(sql, [versionId]);
      
      if (rows.length === 0) return null;
      
      const row = rows[0];
      return {
        ...row,
        notes_snapshot: WikiItem.parseJsonField(row.notes_snapshot),
        links_snapshot: WikiItem.parseJsonField(row.links_snapshot)
      };
    } catch (error) {
      logger.error('获取版本详情失败:', error);
      throw new DatabaseError('获取版本详情失败', error);
    }
  }

  /**
   * 回滚到指定版本
   */
  static async rollbackToVersion(wikiId, versionId, userId) {
    const transaction = await dbConnection.beginTransaction();
    try {
      // 获取版本详情
      const version = await WikiItem.getVersionDetail(versionId);
      if (!version || version.wiki_id !== wikiId) {
        throw new ValidationError('版本不存在');
      }
      
      // 更新主表内容
      const updateSql = `
        UPDATE wiki_items 
        SET title = ?, description = ?, content = ?, notes = ?, links = ?
        WHERE id = ?
      `;
      
      await transaction.query(updateSql, [
        version.title,
        version.description,
        version.content,
        JSON.stringify(version.notes_snapshot),
        JSON.stringify(version.links_snapshot),
        wikiId
      ]);
      
      // 保存回滚版本
      await WikiItem.saveVersionInTransaction(transaction, wikiId, {
        title: version.title,
        description: version.description,
        content: version.content,
        notes: version.notes_snapshot,
        links: version.links_snapshot
      }, userId, `回滚到版本 ${version.version_number}`);
      
      await transaction.commit();
      
      logger.info('回滚知识库版本成功', { wikiId, fromVersion: version.version_number, userId });
      
      return await WikiItem.findById(wikiId);
    } catch (error) {
      await transaction.rollback();
      logger.error('回滚知识库版本失败:', error);
      throw error;
    }
  }

  /**
   * 删除知识库
   */
  static async delete(id) {
    try {
      // 级联删除会自动删除版本和编辑者
      const sql = 'DELETE FROM wiki_items WHERE id = ?';
      await dbConnection.query(sql, [id]);
      
      logger.info('删除知识库成功', { id });
      
      return true;
    } catch (error) {
      logger.error('删除知识库失败:', error);
      throw new DatabaseError('删除知识库失败', error);
    }
  }

  /**
   * 获取编辑者列表
   */
  static async getEditors(wikiId) {
    try {
      const sql = `
        SELECT we.*, u.username, u.email,
               adder.username as added_by_name
        FROM wiki_editors we
        JOIN users u ON we.user_id = u.id
        LEFT JOIN users adder ON we.added_by = adder.id
        WHERE we.wiki_id = ?
        ORDER BY we.created_at ASC
      `;
      
      const { rows } = await dbConnection.query(sql, [wikiId]);
      return rows;
    } catch (error) {
      logger.error('获取编辑者列表失败:', error);
      throw new DatabaseError('获取编辑者列表失败', error);
    }
  }

  /**
   * 添加编辑者
   */
  static async addEditor(wikiId, userId, addedBy) {
    try {
      const sql = `
        INSERT INTO wiki_editors (wiki_id, user_id, added_by)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE added_by = VALUES(added_by)
      `;
      
      await dbConnection.query(sql, [wikiId, userId, addedBy]);
      
      logger.info('添加编辑者成功', { wikiId, userId, addedBy });
      
      return true;
    } catch (error) {
      logger.error('添加编辑者失败:', error);
      throw new DatabaseError('添加编辑者失败', error);
    }
  }

  /**
   * 移除编辑者
   */
  static async removeEditor(wikiId, userId) {
    try {
      const sql = 'DELETE FROM wiki_editors WHERE wiki_id = ? AND user_id = ?';
      await dbConnection.query(sql, [wikiId, userId]);
      
      logger.info('移除编辑者成功', { wikiId, userId });
      
      return true;
    } catch (error) {
      logger.error('移除编辑者失败:', error);
      throw new DatabaseError('移除编辑者失败', error);
    }
  }

  /**
   * 切换置顶状态
   */
  static async togglePin(id) {
    try {
      const sql = 'UPDATE wiki_items SET is_pinned = NOT is_pinned WHERE id = ?';
      await dbConnection.query(sql, [id]);
      
      return await WikiItem.findById(id);
    } catch (error) {
      logger.error('切换置顶状态失败:', error);
      throw new DatabaseError('切换置顶状态失败', error);
    }
  }

  /**
   * 转换为JSON
   */
  toJSON() {
    return {
      id: this.id,
      title: this.title,
      description: this.description,
      content: this.content,
      notes: this.notes,
      links: this.links,
      scope: this.scope,
      creator_id: this.creator_id,
      creator_name: this.creator_name,
      group_id: this.group_id,
      group_name: this.group_name,
      is_pinned: this.is_pinned,
      sort_order: this.sort_order,
      current_version: this.current_version,
      version_count: this.version_count,
      can_edit: this.can_edit,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }
}

module.exports = WikiItem;

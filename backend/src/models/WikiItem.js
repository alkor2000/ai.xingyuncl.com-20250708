/**
 * 知识库数据模型 v2.2
 * 
 * 功能：
 * - 三级范围管理：personal个人/team团队/global全局
 * - 版本管理：保存、删除、回滚历史版本
 * - 协作编辑：团队知识库可指定额外编辑者
 * - JSON字段：notes备注数组(最多10条)、links链接数组(最多10条)
 * 
 * 更新：2026-01-02 v2.2 修复update方法，保存时同步更新当前版本的wiki_versions记录
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
    return arr.slice(0, 10).map(link => ({
      title: (link.title || '').substring(0, 200),
      url: (link.url || '').substring(0, 1000)
    })).filter(link => link.title || link.url);
  }

  /**
   * 获取用户可访问的知识库列表
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
          (wi.scope = 'personal' AND wi.creator_id = ?)
          OR (wi.scope = 'team' AND wi.group_id = ?)
          OR wi.scope = 'global'
        )
      `;
      
      const params = [userId, groupId];
      
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
    if (userRole === 'super_admin') return true;
    
    if (item.scope === 'personal') {
      return item.creator_id === userId;
    }
    
    if (item.scope === 'team') {
      if (item.creator_id === userId) return true;
      if (userRole === 'admin' && item.group_id === groupId) return true;
      return false;
    }
    
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
      
      if (userId) {
        item.can_edit = WikiItem.checkCanEdit(row, userId, groupId, userRole);
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
      if (!data.title || !data.title.trim()) {
        throw new ValidationError('标题不能为空');
      }
      
      const scope = data.scope || 'personal';
      if (!['personal', 'team', 'global'].includes(scope)) {
        throw new ValidationError('无效的范围类型');
      }
      
      if (scope === 'team' && !data.group_id) {
        throw new ValidationError('团队知识库必须指定所属组');
      }
      
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
   * 更新知识库（覆盖保存）
   * v2.2修复：同时更新wiki_items和当前版本的wiki_versions记录
   */
  static async update(id, data, operatorId) {
    const transaction = await dbConnection.beginTransaction();
    try {
      // 先获取当前版本号
      const { rows: wikiRows } = await transaction.query(
        'SELECT current_version FROM wiki_items WHERE id = ? FOR UPDATE', 
        [id]
      );
      
      if (wikiRows.length === 0) {
        throw new ValidationError('知识库不存在');
      }
      
      const currentVersion = wikiRows[0].current_version;
      
      // 构建wiki_items的更新
      const updateFields = [];
      const updateValues = [];
      
      // 同时准备wiki_versions的更新
      const versionUpdateFields = [];
      const versionUpdateValues = [];
      
      if (data.title !== undefined) {
        if (!data.title.trim()) {
          throw new ValidationError('标题不能为空');
        }
        const titleValue = data.title.trim().substring(0, 500);
        updateFields.push('title = ?');
        updateValues.push(titleValue);
        versionUpdateFields.push('title = ?');
        versionUpdateValues.push(titleValue);
      }
      
      if (data.description !== undefined) {
        const descValue = (data.description || '').substring(0, 2000);
        updateFields.push('description = ?');
        updateValues.push(descValue);
        versionUpdateFields.push('description = ?');
        versionUpdateValues.push(descValue);
      }
      
      if (data.content !== undefined) {
        const contentValue = data.content || '';
        updateFields.push('content = ?');
        updateValues.push(contentValue);
        versionUpdateFields.push('content = ?');
        versionUpdateValues.push(contentValue);
      }
      
      if (data.notes !== undefined) {
        const notesValue = JSON.stringify(WikiItem.validateNotes(data.notes));
        updateFields.push('notes = ?');
        updateValues.push(notesValue);
        versionUpdateFields.push('notes_snapshot = ?');
        versionUpdateValues.push(notesValue);
      }
      
      if (data.links !== undefined) {
        const linksValue = JSON.stringify(WikiItem.validateLinks(data.links));
        updateFields.push('links = ?');
        updateValues.push(linksValue);
        versionUpdateFields.push('links_snapshot = ?');
        versionUpdateValues.push(linksValue);
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
      
      // 更新wiki_items
      updateValues.push(id);
      const sql = `UPDATE wiki_items SET ${updateFields.join(', ')} WHERE id = ?`;
      await transaction.query(sql, updateValues);
      
      // 同步更新当前版本的wiki_versions记录
      if (versionUpdateFields.length > 0) {
        versionUpdateValues.push(id);
        versionUpdateValues.push(currentVersion);
        const versionSql = `UPDATE wiki_versions SET ${versionUpdateFields.join(', ')} WHERE wiki_id = ? AND version_number = ?`;
        await transaction.query(versionSql, versionUpdateValues);
        
        logger.info('同步更新版本记录', { wikiId: id, versionNumber: currentVersion });
      }
      
      await transaction.commit();
      
      logger.info('更新知识库成功', { id, operatorId, currentVersion });
      
      return await WikiItem.findById(id);
    } catch (error) {
      await transaction.rollback();
      logger.error('更新知识库失败:', error);
      throw error;
    }
  }

  /**
   * 在事务中保存版本
   */
  static async saveVersionInTransaction(transaction, wikiId, data, userId, changeSummary = null) {
    const versionSql = 'SELECT current_version, version_count FROM wiki_items WHERE id = ? FOR UPDATE';
    const { rows } = await transaction.query(versionSql, [wikiId]);
    
    if (rows.length === 0) {
      throw new ValidationError('知识库不存在');
    }
    
    const newVersion = rows[0].current_version + 1;
    let newCount = rows[0].version_count + 1;
    
    // 限制最多50个版本
    if (newCount > 50) {
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
   */
  static async getVersions(wikiId, limit = 50) {
    try {
      const safeLimit = Math.min(Math.max(parseInt(limit) || 50, 1), 100);
      
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
   * 删除指定版本
   * 规则：
   * - 不能删除唯一的版本
   * - 删除后自动更新version_count
   * - 如果删除的是当前版本，自动切换到最新的版本
   */
  static async deleteVersion(wikiId, versionId) {
    const transaction = await dbConnection.beginTransaction();
    try {
      // 获取要删除的版本信息
      const versionSql = 'SELECT * FROM wiki_versions WHERE id = ? AND wiki_id = ?';
      const { rows: versionRows } = await transaction.query(versionSql, [versionId, wikiId]);
      
      if (versionRows.length === 0) {
        throw new ValidationError('版本不存在');
      }
      
      const targetVersion = versionRows[0];
      
      // 检查是否是唯一的版本
      const countSql = 'SELECT COUNT(*) as cnt FROM wiki_versions WHERE wiki_id = ?';
      const { rows: countRows } = await transaction.query(countSql, [wikiId]);
      
      if (countRows[0].cnt <= 1) {
        throw new ValidationError('不能删除唯一的版本');
      }
      
      // 获取当前wiki的current_version
      const wikiSql = 'SELECT current_version FROM wiki_items WHERE id = ? FOR UPDATE';
      const { rows: wikiRows } = await transaction.query(wikiSql, [wikiId]);
      const currentVersion = wikiRows[0].current_version;
      
      // 删除版本
      const deleteSql = 'DELETE FROM wiki_versions WHERE id = ?';
      await transaction.query(deleteSql, [versionId]);
      
      // 更新version_count
      const updateCountSql = 'UPDATE wiki_items SET version_count = version_count - 1 WHERE id = ?';
      await transaction.query(updateCountSql, [wikiId]);
      
      // 如果删除的是当前版本，需要切换到最新的版本
      if (targetVersion.version_number === currentVersion) {
        // 找到最新的版本
        const latestSql = `
          SELECT version_number, title, description, content, notes_snapshot, links_snapshot 
          FROM wiki_versions 
          WHERE wiki_id = ? 
          ORDER BY version_number DESC 
          LIMIT 1
        `;
        const { rows: latestRows } = await transaction.query(latestSql, [wikiId]);
        
        if (latestRows.length > 0) {
          const latest = latestRows[0];
          // 更新wiki_items的current_version和内容
          const updateWikiSql = `
            UPDATE wiki_items 
            SET current_version = ?, title = ?, description = ?, content = ?, notes = ?, links = ?
            WHERE id = ?
          `;
          await transaction.query(updateWikiSql, [
            latest.version_number,
            latest.title,
            latest.description,
            latest.content,
            latest.notes_snapshot,
            latest.links_snapshot,
            wikiId
          ]);
        }
      }
      
      await transaction.commit();
      
      logger.info('删除版本成功', { wikiId, versionId, deletedVersion: targetVersion.version_number });
      
      // 返回更新后的wiki信息
      const updatedWiki = await WikiItem.findById(wikiId);
      return {
        success: true,
        deletedVersion: targetVersion.version_number,
        currentVersion: updatedWiki.current_version,
        versionCount: updatedWiki.version_count
      };
    } catch (error) {
      await transaction.rollback();
      logger.error('删除版本失败:', error);
      throw error;
    }
  }

  /**
   * 回滚到指定版本
   */
  static async rollbackToVersion(wikiId, versionId, userId) {
    const transaction = await dbConnection.beginTransaction();
    try {
      const version = await WikiItem.getVersionDetail(versionId);
      if (!version || version.wiki_id !== wikiId) {
        throw new ValidationError('版本不存在');
      }
      
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

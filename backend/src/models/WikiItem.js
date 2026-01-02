/**
 * 知识库数据模型 v3.0
 * 
 * 功能：
 * - 三级范围管理：personal个人/team团队/global全局
 * - 版本管理：所有版本平等，保存到指定版本
 * - 协作编辑：团队知识库可指定额外编辑者
 * 
 * 版本管理说明（v3.0重构）：
 * - wiki_items: 存储知识库元信息，current_version记录上次查看的版本
 * - wiki_versions: 存储所有版本的完整内容
 * - 保存操作直接更新wiki_versions表中的指定版本
 * - 新建版本基于指定版本复制内容
 * 
 * 更新：2026-01-02 v3.0 重构版本管理
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
    this.creator_name = data.creator_name || null;
    this.group_name = data.group_name || null;
    this.can_edit = data.can_edit || false;
  }

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

  static validateNotes(notes) {
    if (!notes) return [];
    const arr = Array.isArray(notes) ? notes : [];
    return arr.slice(0, 10).map(note => 
      typeof note === 'string' ? note.substring(0, 500) : ''
    ).filter(note => note.trim());
  }

  static validateLinks(links) {
    if (!links) return [];
    const arr = Array.isArray(links) ? links : [];
    return arr.slice(0, 10).map(link => ({
      title: (link.title || '').substring(0, 200),
      url: (link.url || '').substring(0, 1000)
    })).filter(link => link.title || link.url);
  }

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

  static checkCanEdit(item, userId, groupId, userRole) {
    if (userRole === 'super_admin') return true;
    if (item.scope === 'personal') return item.creator_id === userId;
    if (item.scope === 'team') {
      if (item.creator_id === userId) return true;
      if (userRole === 'admin' && item.group_id === groupId) return true;
      return false;
    }
    if (item.scope === 'global') return userRole === 'super_admin';
    return false;
  }

  static async isEditor(wikiId, userId) {
    try {
      const sql = 'SELECT id FROM wiki_editors WHERE wiki_id = ? AND user_id = ?';
      const { rows } = await dbConnection.query(sql, [wikiId, userId]);
      return rows.length > 0;
    } catch (error) {
      return false;
    }
  }

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

  static async checkAccess(wikiId, userId, groupId, userRole) {
    try {
      const item = await WikiItem.findById(wikiId);
      if (!item) return { hasAccess: false, canEdit: false, item: null };
      
      if (userRole === 'super_admin') {
        return { hasAccess: true, canEdit: true, item };
      }
      
      let hasAccess = false;
      let canEdit = false;
      
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
      logger.error('检查访问权限失败:', error);
      return { hasAccess: false, canEdit: false, item: null };
    }
  }

  /**
   * 创建知识库（同时创建第一个版本）
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
      
      // 创建知识库记录（不存储内容，内容存在版本表）
      const sql = `
        INSERT INTO wiki_items (
          title, description, content, notes, links,
          scope, creator_id, group_id, is_pinned, sort_order,
          current_version, version_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
      `;
      
      const result = await transaction.query(sql, [
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
      ]);
      
      const insertId = result.rows.insertId;
      
      // 创建第一个版本
      const versionSql = `
        INSERT INTO wiki_versions (
          wiki_id, version_number, title, description, content,
          notes_snapshot, links_snapshot, change_summary, created_by
        ) VALUES (?, 1, ?, ?, ?, ?, ?, '初始版本', ?)
      `;
      
      await transaction.query(versionSql, [
        insertId,
        data.title.trim().substring(0, 500),
        (data.description || '').substring(0, 2000),
        data.content || '',
        JSON.stringify(notes),
        JSON.stringify(links),
        creatorId
      ]);
      
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
   * 更新知识库基本信息（不涉及版本内容）
   */
  static async updateBasicInfo(id, data) {
    try {
      const updateFields = [];
      const updateValues = [];
      
      if (data.is_pinned !== undefined) {
        updateFields.push('is_pinned = ?');
        updateValues.push(data.is_pinned ? 1 : 0);
      }
      
      if (data.sort_order !== undefined) {
        updateFields.push('sort_order = ?');
        updateValues.push(parseInt(data.sort_order) || 0);
      }
      
      if (updateFields.length === 0) return;
      
      updateValues.push(id);
      const sql = `UPDATE wiki_items SET ${updateFields.join(', ')} WHERE id = ?`;
      await dbConnection.query(sql, updateValues);
      
      logger.info('更新知识库基本信息成功', { id });
    } catch (error) {
      logger.error('更新知识库基本信息失败:', error);
      throw new DatabaseError('更新失败', error);
    }
  }

  /**
   * 获取版本历史列表
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
        wiki_id: row.wiki_id,
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
   * 获取版本详情（完整内容）
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
        id: row.id,
        wiki_id: row.wiki_id,
        version_number: row.version_number,
        title: row.title,
        description: row.description,
        content: row.content,
        notes_snapshot: WikiItem.parseJsonField(row.notes_snapshot),
        links_snapshot: WikiItem.parseJsonField(row.links_snapshot),
        change_summary: row.change_summary,
        created_by: row.created_by,
        created_by_name: row.created_by_name,
        created_at: row.created_at
      };
    } catch (error) {
      logger.error('获取版本详情失败:', error);
      throw new DatabaseError('获取版本详情失败', error);
    }
  }

  /**
   * 保存到指定版本（v3.0核心方法）
   * 
   * 直接更新wiki_versions表中的指定版本记录
   * 同时更新wiki_items的current_version和同步字段
   */
  static async updateVersion(versionId, data, operatorId) {
    const transaction = await dbConnection.beginTransaction();
    try {
      // 获取版本信息
      const versionSql = 'SELECT * FROM wiki_versions WHERE id = ? FOR UPDATE';
      const { rows: versionRows } = await transaction.query(versionSql, [versionId]);
      
      if (versionRows.length === 0) {
        throw new ValidationError('版本不存在');
      }
      
      const version = versionRows[0];
      const wikiId = version.wiki_id;
      const versionNumber = version.version_number;
      
      // 构建更新字段
      const updateFields = [];
      const updateValues = [];
      
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
        updateFields.push('notes_snapshot = ?');
        updateValues.push(JSON.stringify(WikiItem.validateNotes(data.notes)));
      }
      
      if (data.links !== undefined) {
        updateFields.push('links_snapshot = ?');
        updateValues.push(JSON.stringify(WikiItem.validateLinks(data.links)));
      }
      
      if (updateFields.length === 0) {
        throw new ValidationError('没有要更新的字段');
      }
      
      // 更新版本表
      updateValues.push(versionId);
      const updateSql = `UPDATE wiki_versions SET ${updateFields.join(', ')} WHERE id = ?`;
      await transaction.query(updateSql, updateValues);
      
      // 同步更新wiki_items的current_version和内容字段
      const syncSql = `
        UPDATE wiki_items 
        SET current_version = ?,
            title = COALESCE(?, title),
            description = COALESCE(?, description),
            content = COALESCE(?, content),
            notes = COALESCE(?, notes),
            links = COALESCE(?, links)
        WHERE id = ?
      `;
      
      await transaction.query(syncSql, [
        versionNumber,
        data.title !== undefined ? data.title.trim().substring(0, 500) : null,
        data.description !== undefined ? (data.description || '').substring(0, 2000) : null,
        data.content !== undefined ? (data.content || '') : null,
        data.notes !== undefined ? JSON.stringify(WikiItem.validateNotes(data.notes)) : null,
        data.links !== undefined ? JSON.stringify(WikiItem.validateLinks(data.links)) : null,
        wikiId
      ]);
      
      await transaction.commit();
      
      logger.info('保存版本成功', { versionId, wikiId, versionNumber, operatorId });
      
      // 返回更新后的版本详情
      return await WikiItem.getVersionDetail(versionId);
    } catch (error) {
      await transaction.rollback();
      logger.error('保存版本失败:', error);
      throw error;
    }
  }

  /**
   * 创建新版本（基于指定版本复制）
   */
  static async createNewVersion(wikiId, userId, baseVersionId = null) {
    const transaction = await dbConnection.beginTransaction();
    try {
      // 获取wiki信息
      const wikiSql = 'SELECT * FROM wiki_items WHERE id = ? FOR UPDATE';
      const { rows: wikiRows } = await transaction.query(wikiSql, [wikiId]);
      
      if (wikiRows.length === 0) {
        throw new ValidationError('知识库不存在');
      }
      
      const wiki = wikiRows[0];
      
      // 确定基于哪个版本创建
      let baseVersion;
      if (baseVersionId) {
        baseVersion = await WikiItem.getVersionDetail(baseVersionId);
        if (!baseVersion || baseVersion.wiki_id !== wikiId) {
          throw new ValidationError('基础版本不存在');
        }
      } else {
        // 默认基于当前版本
        const currentVersionSql = 'SELECT * FROM wiki_versions WHERE wiki_id = ? AND version_number = ?';
        const { rows } = await transaction.query(currentVersionSql, [wikiId, wiki.current_version]);
        if (rows.length === 0) {
          throw new ValidationError('当前版本不存在');
        }
        baseVersion = rows[0];
        baseVersion.notes_snapshot = WikiItem.parseJsonField(baseVersion.notes_snapshot);
        baseVersion.links_snapshot = WikiItem.parseJsonField(baseVersion.links_snapshot);
      }
      
      // 计算新版本号
      const maxVersionSql = 'SELECT MAX(version_number) as max_ver FROM wiki_versions WHERE wiki_id = ?';
      const { rows: maxRows } = await transaction.query(maxVersionSql, [wikiId]);
      const newVersionNumber = (maxRows[0].max_ver || 0) + 1;
      
      // 限制最多50个版本
      let newCount = wiki.version_count + 1;
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
      
      // 创建新版本
      const insertSql = `
        INSERT INTO wiki_versions (
          wiki_id, version_number, title, description, content,
          notes_snapshot, links_snapshot, change_summary, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      const result = await transaction.query(insertSql, [
        wikiId,
        newVersionNumber,
        baseVersion.title,
        baseVersion.description || '',
        baseVersion.content || '',
        JSON.stringify(baseVersion.notes_snapshot || []),
        JSON.stringify(baseVersion.links_snapshot || []),
        `基于v${baseVersion.version_number}创建`,
        userId
      ]);
      
      const newVersionId = result.rows.insertId;
      
      // 更新wiki_items
      const updateWikiSql = `
        UPDATE wiki_items 
        SET current_version = ?, version_count = ?,
            title = ?, description = ?, content = ?, notes = ?, links = ?
        WHERE id = ?
      `;
      
      await transaction.query(updateWikiSql, [
        newVersionNumber,
        newCount,
        baseVersion.title,
        baseVersion.description || '',
        baseVersion.content || '',
        JSON.stringify(baseVersion.notes_snapshot || []),
        JSON.stringify(baseVersion.links_snapshot || []),
        wikiId
      ]);
      
      await transaction.commit();
      
      logger.info('创建新版本成功', { wikiId, newVersionNumber, baseVersionNumber: baseVersion.version_number, userId });
      
      return {
        id: newVersionId,
        version_number: newVersionNumber,
        wiki_id: wikiId,
        base_version: baseVersion.version_number
      };
    } catch (error) {
      await transaction.rollback();
      logger.error('创建新版本失败:', error);
      throw error;
    }
  }

  /**
   * 删除指定版本
   */
  static async deleteVersion(wikiId, versionId) {
    const transaction = await dbConnection.beginTransaction();
    try {
      const versionSql = 'SELECT * FROM wiki_versions WHERE id = ? AND wiki_id = ?';
      const { rows: versionRows } = await transaction.query(versionSql, [versionId, wikiId]);
      
      if (versionRows.length === 0) {
        throw new ValidationError('版本不存在');
      }
      
      const targetVersion = versionRows[0];
      
      const countSql = 'SELECT COUNT(*) as cnt FROM wiki_versions WHERE wiki_id = ?';
      const { rows: countRows } = await transaction.query(countSql, [wikiId]);
      
      if (countRows[0].cnt <= 1) {
        throw new ValidationError('不能删除唯一的版本');
      }
      
      const wikiSql = 'SELECT current_version FROM wiki_items WHERE id = ? FOR UPDATE';
      const { rows: wikiRows } = await transaction.query(wikiSql, [wikiId]);
      const currentVersion = wikiRows[0].current_version;
      
      // 删除版本
      await transaction.query('DELETE FROM wiki_versions WHERE id = ?', [versionId]);
      await transaction.query('UPDATE wiki_items SET version_count = version_count - 1 WHERE id = ?', [wikiId]);
      
      // 如果删除的是当前版本，切换到最新版本
      if (targetVersion.version_number === currentVersion) {
        const latestSql = `
          SELECT * FROM wiki_versions 
          WHERE wiki_id = ? 
          ORDER BY version_number DESC 
          LIMIT 1
        `;
        const { rows: latestRows } = await transaction.query(latestSql, [wikiId]);
        
        if (latestRows.length > 0) {
          const latest = latestRows[0];
          await transaction.query(`
            UPDATE wiki_items 
            SET current_version = ?, title = ?, description = ?, content = ?, notes = ?, links = ?
            WHERE id = ?
          `, [
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

  static async delete(id) {
    try {
      await dbConnection.query('DELETE FROM wiki_items WHERE id = ?', [id]);
      logger.info('删除知识库成功', { id });
      return true;
    } catch (error) {
      logger.error('删除知识库失败:', error);
      throw new DatabaseError('删除知识库失败', error);
    }
  }

  static async getEditors(wikiId) {
    try {
      const sql = `
        SELECT we.*, u.username, u.email, adder.username as added_by_name
        FROM wiki_editors we
        JOIN users u ON we.user_id = u.id
        LEFT JOIN users adder ON we.added_by = adder.id
        WHERE we.wiki_id = ?
        ORDER BY we.created_at ASC
      `;
      const { rows } = await dbConnection.query(sql, [wikiId]);
      return rows;
    } catch (error) {
      throw new DatabaseError('获取编辑者列表失败', error);
    }
  }

  static async addEditor(wikiId, userId, addedBy) {
    try {
      const sql = `
        INSERT INTO wiki_editors (wiki_id, user_id, added_by)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE added_by = VALUES(added_by)
      `;
      await dbConnection.query(sql, [wikiId, userId, addedBy]);
      return true;
    } catch (error) {
      throw new DatabaseError('添加编辑者失败', error);
    }
  }

  static async removeEditor(wikiId, userId) {
    try {
      await dbConnection.query('DELETE FROM wiki_editors WHERE wiki_id = ? AND user_id = ?', [wikiId, userId]);
      return true;
    } catch (error) {
      throw new DatabaseError('移除编辑者失败', error);
    }
  }

  static async togglePin(id) {
    try {
      await dbConnection.query('UPDATE wiki_items SET is_pinned = NOT is_pinned WHERE id = ?', [id]);
      return await WikiItem.findById(id);
    } catch (error) {
      throw new DatabaseError('切换置顶状态失败', error);
    }
  }

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

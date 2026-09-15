/**
 * 公文模板模型（doc_templates）
 *
 * 老师上传的 Word 样板 + 段落角色（roles）+ 解析摘要（summary）。
 * 文件本体在 storage/uploads/doc-templates/<uuid>.docx（相对路径存 file_path），
 * 读写文件由 DocTemplateService 负责，这里只管表。
 *
 * 可见性：private 只有本人；group 同一 group_id 的用户可用（只读，不能改角色/删除）。
 */
const dbConnection = require('../database/connection');
const { DatabaseError } = require('../utils/errors');
const logger = require('../utils/logger');

const SCOPES = ['private', 'group'];

class DocTemplate {
  static parseJson(value, fallback = null) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch (e) { return fallback; }
  }

  static format(row) {
    if (!row) return null;
    return {
      id: row.id,
      uuid: row.uuid,
      user_id: row.user_id,
      group_id: row.group_id,
      name: row.name,
      description: row.description || '',
      file_path: row.file_path,
      file_size: row.file_size,
      original_filename: row.original_filename,
      block_count: row.block_count,
      roles: DocTemplate.parseJson(row.roles, []),
      summary: DocTemplate.parseJson(row.summary, {}),
      scope: row.scope,
      use_count: row.use_count,
      last_used_at: row.last_used_at,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  static async create(data) {
    try {
      const { rows } = await dbConnection.query(
        `INSERT INTO doc_templates (uuid, user_id, group_id, name, description, file_path, file_size, original_filename, block_count, roles, summary, scope)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [data.uuid, data.user_id, data.group_id || null, data.name, data.description || null, data.file_path, data.file_size || 0,
          data.original_filename || null, data.block_count || 0, JSON.stringify(data.roles || []), JSON.stringify(data.summary || {}),
          SCOPES.includes(data.scope) ? data.scope : 'private']
      );
      return DocTemplate.findById(rows.insertId);
    } catch (error) {
      logger.error('创建公文模板失败:', error);
      throw new DatabaseError('创建公文模板失败', error);
    }
  }

  static async findById(id) {
    try {
      const { rows } = await dbConnection.query('SELECT * FROM doc_templates WHERE id = ?', [id]);
      return rows.length ? DocTemplate.format(rows[0]) : null;
    } catch (error) {
      logger.error('查询公文模板失败:', error);
      throw new DatabaseError('查询公文模板失败', error);
    }
  }

  /** 本人的 + 同组共享的（按更新时间倒序） */
  static async listVisible(userId, groupId) {
    try {
      const params = [userId];
      let where = 'user_id = ?';
      if (groupId) { where += " OR (scope = 'group' AND group_id = ?)"; params.push(groupId); }
      const { rows } = await dbConnection.query(`SELECT * FROM doc_templates WHERE ${where} ORDER BY updated_at DESC LIMIT 200`, params);
      return rows.map(DocTemplate.format);
    } catch (error) {
      logger.error('查询公文模板列表失败:', error);
      throw new DatabaseError('查询公文模板列表失败', error);
    }
  }

  /** 白名单更新：name / description / scope / roles */
  static async update(id, patch) {
    const sets = [];
    const params = [];
    if (patch.name !== undefined) { sets.push('name = ?'); params.push(patch.name); }
    if (patch.description !== undefined) { sets.push('description = ?'); params.push(patch.description || null); }
    if (patch.scope !== undefined && SCOPES.includes(patch.scope)) { sets.push('scope = ?'); params.push(patch.scope); }
    if (patch.roles !== undefined) { sets.push('roles = ?'); params.push(JSON.stringify(patch.roles)); }
    if (patch.summary !== undefined) { sets.push('summary = ?'); params.push(JSON.stringify(patch.summary)); }
    if (!sets.length) return DocTemplate.findById(id);
    try {
      params.push(id);
      await dbConnection.query(`UPDATE doc_templates SET ${sets.join(', ')} WHERE id = ?`, params);
      return DocTemplate.findById(id);
    } catch (error) {
      logger.error('更新公文模板失败:', error);
      throw new DatabaseError('更新公文模板失败', error);
    }
  }

  static async touchUsed(id) {
    try {
      await dbConnection.query('UPDATE doc_templates SET use_count = use_count + 1, last_used_at = NOW() WHERE id = ?', [id]);
    } catch (error) {
      logger.warn('更新公文模板使用次数失败:', error.message);
    }
  }

  static async remove(id) {
    try {
      await dbConnection.query('DELETE FROM doc_templates WHERE id = ?', [id]);
    } catch (error) {
      logger.error('删除公文模板失败:', error);
      throw new DatabaseError('删除公文模板失败', error);
    }
  }

  static canRead(template, user) {
    if (!template || !user) return false;
    if (Number(template.user_id) === Number(user.id)) return true;
    if (template.scope === 'group' && template.group_id && Number(template.group_id) === Number(user.group_id)) return true;
    return user.role === 'super_admin';
  }

  static canWrite(template, user) {
    return !!template && !!user && Number(template.user_id) === Number(user.id);
  }
}

DocTemplate.SCOPES = SCOPES;
module.exports = DocTemplate;

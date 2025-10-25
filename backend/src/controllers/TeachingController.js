/**
 * 教学系统控制器（增强版）
 * 处理教学模块、课程、权限的业务逻辑
 * 新增：管理员全局数据管理功能
 * 修复：使用simpleQuery解决LIMIT/OFFSET兼容性问题
 * 修复：添加cover_image支持
 */

const TeachingModule = require('../models/TeachingModule');
const TeachingLesson = require('../models/TeachingLesson');
const TeachingPermission = require('../models/TeachingPermission');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');
const { getUserTags } = require('../middleware/teachingPermissions');

class TeachingController {
  // ==================== 模块管理 ====================

  /**
   * 创建教学模块
   */
  static async createModule(req, res) {
    try {
      const user = req.user;
      const {
        name,
        description,
        cover_image,
        visibility = 'private',
        status = 'draft',
        owner_group_id
      } = req.body;

      // 验证必填项
      if (!name) {
        return ResponseHelper.validation(res, ['模块名称不能为空']);
      }

      // 如果是admin创建，自动设置owner_group_id为其所在组
      let finalOwnerGroupId = owner_group_id;
      if (user.role === 'admin' && !owner_group_id) {
        finalOwnerGroupId = user.group_id;
      }

      const module = await TeachingModule.create({
        name,
        description,
        cover_image,
        creator_id: user.id,
        owner_group_id: finalOwnerGroupId,
        visibility,
        status
      });

      logger.info('教学模块创建成功', {
        moduleId: module.id,
        userId: user.id,
        name
      });

      return ResponseHelper.success(res, module, '模块创建成功', 201);
    } catch (error) {
      logger.error('创建教学模块失败:', error);
      return ResponseHelper.error(res, error.message || '创建模块失败');
    }
  }

  /**
   * 获取模块列表（用户可访问的）
   */
  static async getModules(req, res) {
    try {
      const user = req.user;
      const {
        page = 1,
        limit = 20,
        status,
        visibility,
        search
      } = req.query;

      // 获取用户标签
      const userTags = await getUserTags(user.id);

      const result = await TeachingModule.getUserModules(
        user.id,
        user.role,
        user.group_id,
        userTags,
        {
          page: parseInt(page),
          limit: parseInt(limit),
          status,
          visibility,
          search
        }
      );

      return ResponseHelper.success(res, result, '获取模块列表成功');
    } catch (error) {
      logger.error('获取模块列表失败:', error);
      return ResponseHelper.error(res, '获取模块列表失败');
    }
  }

  /**
   * 获取单个模块详情
   */
  static async getModule(req, res) {
    try {
      const module = req.module; // 从中间件获取
      const permission = req.modulePermission;

      // 增加查看次数
      await module.incrementViewCount();

      const result = {
        ...module.toJSON(),
        user_permission: permission
      };

      return ResponseHelper.success(res, result, '获取模块详情成功');
    } catch (error) {
      logger.error('获取模块详情失败:', error);
      return ResponseHelper.error(res, '获取模块详情失败');
    }
  }

  /**
   * 更新模块信息
   */
  static async updateModule(req, res) {
    try {
      const module = req.module; // 从中间件获取
      const {
        name,
        description,
        cover_image,
        visibility,
        status,
        order_index
      } = req.body;

      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (cover_image !== undefined) updateData.cover_image = cover_image;
      if (visibility !== undefined) updateData.visibility = visibility;
      if (status !== undefined) updateData.status = status;
      if (order_index !== undefined) updateData.order_index = order_index;

      await module.update(updateData);

      logger.info('模块更新成功', {
        moduleId: module.id,
        userId: req.user.id
      });

      return ResponseHelper.success(res, module, '模块更新成功');
    } catch (error) {
      logger.error('更新模块失败:', error);
      return ResponseHelper.error(res, '更新模块失败');
    }
  }

  /**
   * 删除模块
   */
  static async deleteModule(req, res) {
    try {
      const module = req.module; // 从中间件获取
      const user = req.user;

      await module.softDelete(user.id);

      logger.info('模块删除成功', {
        moduleId: module.id,
        userId: user.id
      });

      return ResponseHelper.success(res, null, '模块删除成功');
    } catch (error) {
      logger.error('删除模块失败:', error);
      return ResponseHelper.error(res, '删除模块失败');
    }
  }

  // ==================== 管理员功能（新增）====================

  /**
   * 获取所有模块（管理员视角，不受权限限制）
   * 修复：使用simpleQuery解决LIMIT/OFFSET兼容性问题
   */
  static async getAllModules(req, res) {
    try {
      const user = req.user;

      // 验证超级管理员权限
      if (user.role !== 'super_admin') {
        return ResponseHelper.forbidden(res, '仅超级管理员可访问');
      }

      // 严格的参数验证
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.max(1, Math.min(1000, parseInt(req.query.limit) || 100));
      const offset = (page - 1) * limit;
      const { status, visibility, search } = req.query;

      const dbConnection = require('../database/connection');

      // 构建查询条件
      let whereClause = 'tm.deleted_at IS NULL';
      const whereParams = [];

      if (status) {
        whereClause += ' AND tm.status = ?';
        whereParams.push(status);
      }

      if (visibility) {
        whereClause += ' AND tm.visibility = ?';
        whereParams.push(visibility);
      }

      if (search) {
        whereClause += ' AND (tm.name LIKE ? OR tm.description LIKE ?)';
        whereParams.push(`%${search}%`, `%${search}%`);
      }

      // 查询总数
      const countSql = `
        SELECT COUNT(*) as total 
        FROM teaching_modules tm
        WHERE ${whereClause}
      `;
      const { rows: countRows } = await dbConnection.query(countSql, whereParams);
      const total = countRows[0].total;

      // ✅ 关键修复：使用simpleQuery代替query，解决LIMIT/OFFSET兼容性问题
      const dataSql = `
        SELECT 
          tm.*,
          u.username as creator_name,
          u.remark as creator_remark,
          ug.name as owner_group_name,
          (SELECT COUNT(*) FROM teaching_lessons WHERE module_id = tm.id AND deleted_at IS NULL) as lesson_count
        FROM teaching_modules tm
        LEFT JOIN users u ON tm.creator_id = u.id
        LEFT JOIN user_groups ug ON tm.owner_group_id = ug.id
        WHERE ${whereClause}
        ORDER BY tm.created_at DESC
        LIMIT ? OFFSET ?
      `;
      
      const dataParams = [...whereParams, limit, offset];
      const { rows: modules } = await dbConnection.simpleQuery(dataSql, dataParams);

      logger.info('管理员获取所有模块', {
        adminId: user.id,
        total,
        page,
        limit
      });

      return ResponseHelper.success(res, {
        modules,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }, '获取所有模块成功');
    } catch (error) {
      logger.error('获取所有模块失败:', error);
      return ResponseHelper.error(res, '获取所有模块失败');
    }
  }

  /**
   * 批量更新模块（管理员功能）
   */
  static async batchUpdateModules(req, res) {
    try {
      const user = req.user;

      // 验证超级管理员权限
      if (user.role !== 'super_admin') {
        return ResponseHelper.forbidden(res, '仅超级管理员可操作');
      }

      const { module_ids, update_data } = req.body;

      // 验证输入
      if (!Array.isArray(module_ids) || module_ids.length === 0) {
        return ResponseHelper.validation(res, ['模块ID列表不能为空']);
      }

      if (!update_data || Object.keys(update_data).length === 0) {
        return ResponseHelper.validation(res, ['更新数据不能为空']);
      }

      const dbConnection = require('../database/connection');

      // 允许批量更新的字段
      const allowedFields = ['status', 'visibility', 'order_index'];
      const updateFields = [];
      const updateValues = [];

      for (const [key, value] of Object.entries(update_data)) {
        if (allowedFields.includes(key)) {
          updateFields.push(`${key} = ?`);
          updateValues.push(value);
        }
      }

      if (updateFields.length === 0) {
        return ResponseHelper.validation(res, ['没有有效的更新字段']);
      }

      // 添加updated_at
      updateFields.push('updated_at = NOW()');

      // 构建SQL
      const placeholders = module_ids.map(() => '?').join(',');
      const sql = `
        UPDATE teaching_modules 
        SET ${updateFields.join(', ')}
        WHERE id IN (${placeholders}) AND deleted_at IS NULL
      `;

      const params = [...updateValues, ...module_ids];
      const { rows } = await dbConnection.query(sql, params);

      logger.info('批量更新模块成功', {
        adminId: user.id,
        moduleIds: module_ids,
        updateData: update_data,
        affectedRows: rows.affectedRows
      });

      return ResponseHelper.success(res, {
        updated_count: rows.affectedRows,
        module_ids
      }, `成功更新${rows.affectedRows}个模块`);
    } catch (error) {
      logger.error('批量更新模块失败:', error);
      return ResponseHelper.error(res, error.message || '批量更新模块失败');
    }
  }

  // ==================== 课程管理 ====================

  /**
   * 创建课程
   */
  static async createLesson(req, res) {
    try {
      const user = req.user;
      const {
        module_id,
        title,
        description,
        cover_image,
        content_type = 'course',
        content,
        status = 'draft',
        order_index
      } = req.body;

      // 验证必填项
      if (!module_id || !title || !content) {
        return ResponseHelper.validation(res, ['模块ID、标题和内容不能为空']);
      }

      // 验证用户是否有模块编辑权限
      const userTags = await getUserTags(user.id);
      const permission = await TeachingModule.checkUserPermission(
        module_id,
        user.id,
        user.role,
        user.group_id,
        userTags
      );

      if (permission !== 'edit') {
        return ResponseHelper.forbidden(res, '无权在此模块创建课程');
      }

      const lesson = await TeachingLesson.create({
        module_id,
        title,
        description,
        cover_image,
        content_type,
        content,
        creator_id: user.id,
        status,
        order_index
      });

      logger.info('课程创建成功', {
        lessonId: lesson.id,
        moduleId: module_id,
        userId: user.id,
        title
      });

      return ResponseHelper.success(res, lesson, '课程创建成功', 201);
    } catch (error) {
      logger.error('创建课程失败:', error);
      return ResponseHelper.error(res, error.message || '创建课程失败');
    }
  }

  /**
   * 获取模块的课程列表
   */
  static async getModuleLessons(req, res) {
    try {
      const { moduleId } = req.params;
      const { status } = req.query;
      const user = req.user;

      // 验证模块访问权限
      const userTags = await getUserTags(user.id);
      const permission = await TeachingModule.checkUserPermission(
        moduleId,
        user.id,
        user.role,
        user.group_id,
        userTags
      );

      if (!permission) {
        return ResponseHelper.forbidden(res, '无权访问此模块');
      }

      // 获取课程列表（自动过滤教师专属内容）
      const lessons = await TeachingLesson.getModuleLessons(
        moduleId,
        user.id,
        user.role,
        userTags,
        {
          status,
          include_teacher_content: permission === 'edit' // 有编辑权限时包含教师内容
        }
      );

      return ResponseHelper.success(res, lessons, '获取课程列表成功');
    } catch (error) {
      logger.error('获取课程列表失败:', error);
      return ResponseHelper.error(res, '获取课程列表失败');
    }
  }

  /**
   * 获取单个课程详情
   */
  static async getLesson(req, res) {
    try {
      const lesson = req.lesson; // 从中间件获取

      // 增加查看次数
      await lesson.incrementViewCount();

      return ResponseHelper.success(res, lesson, '获取课程详情成功');
    } catch (error) {
      logger.error('获取课程详情失败:', error);
      return ResponseHelper.error(res, '获取课程详情失败');
    }
  }

  /**
   * 更新课程信息
   * 修复：添加cover_image支持
   */
  static async updateLesson(req, res) {
    try {
      const lesson = req.lesson; // 从中间件获取
      const {
        title,
        description,
        cover_image,
        content_type,
        content,
        status,
        order_index
      } = req.body;

      const updateData = {};
      if (title !== undefined) updateData.title = title;
      if (description !== undefined) updateData.description = description;
      if (cover_image !== undefined) updateData.cover_image = cover_image;
      if (content_type !== undefined) updateData.content_type = content_type;
      if (content !== undefined) updateData.content = content;
      if (status !== undefined) updateData.status = status;
      if (order_index !== undefined) updateData.order_index = order_index;

      await lesson.update(updateData);

      logger.info('课程更新成功', {
        lessonId: lesson.id,
        userId: req.user.id
      });

      return ResponseHelper.success(res, lesson, '课程更新成功');
    } catch (error) {
      logger.error('更新课程失败:', error);
      return ResponseHelper.error(res, '更新课程失败');
    }
  }

  /**
   * 删除课程
   */
  static async deleteLesson(req, res) {
    try {
      const lesson = req.lesson; // 从中间件获取
      const user = req.user;

      await lesson.softDelete(user.id);

      logger.info('课程删除成功', {
        lessonId: lesson.id,
        userId: user.id
      });

      return ResponseHelper.success(res, null, '课程删除成功');
    } catch (error) {
      logger.error('删除课程失败:', error);
      return ResponseHelper.error(res, '删除课程失败');
    }
  }

  // ==================== 权限管理 ====================

  /**
   * 获取模块的权限列表
   */
  static async getModulePermissions(req, res) {
    try {
      const { moduleId } = req.params;

      const permissions = await TeachingPermission.getModulePermissions(moduleId);

      return ResponseHelper.success(res, permissions, '获取权限列表成功');
    } catch (error) {
      logger.error('获取权限列表失败:', error);
      return ResponseHelper.error(res, '获取权限列表失败');
    }
  }

  /**
   * 授予权限
   */
  static async grantPermission(req, res) {
    try {
      const user = req.user;
      const {
        module_id,
        user_id,
        group_id,
        tag_id,
        permission_type = 'view',
        expires_at,
        note
      } = req.body;

      // 验证必填项
      if (!module_id) {
        return ResponseHelper.validation(res, ['模块ID不能为空']);
      }

      const permission = await TeachingPermission.grant({
        module_id,
        user_id,
        group_id,
        tag_id,
        permission_type,
        granted_by: user.id,
        expires_at,
        note
      });

      logger.info('权限授予成功', {
        permissionId: permission.id,
        moduleId: module_id,
        grantedBy: user.id
      });

      return ResponseHelper.success(res, permission, '权限授予成功', 201);
    } catch (error) {
      logger.error('授予权限失败:', error);
      return ResponseHelper.error(res, error.message || '授予权限失败');
    }
  }

  /**
   * 撤销权限
   */
  static async revokePermission(req, res) {
    try {
      const { permissionId } = req.params;

      await TeachingPermission.revoke(permissionId);

      logger.info('权限撤销成功', {
        permissionId,
        userId: req.user.id
      });

      return ResponseHelper.success(res, null, '权限撤销成功');
    } catch (error) {
      logger.error('撤销权限失败:', error);
      return ResponseHelper.error(res, '撤销权限失败');
    }
  }

  /**
   * 批量撤销权限
   */
  static async revokeMultiplePermissions(req, res) {
    try {
      const { permission_ids } = req.body;

      if (!Array.isArray(permission_ids) || permission_ids.length === 0) {
        return ResponseHelper.validation(res, ['权限ID列表不能为空']);
      }

      await TeachingPermission.revokeMultiple(permission_ids);

      logger.info('批量撤销权限成功', {
        count: permission_ids.length,
        userId: req.user.id
      });

      return ResponseHelper.success(res, null, `成功撤销${permission_ids.length}个权限`);
    } catch (error) {
      logger.error('批量撤销权限失败:', error);
      return ResponseHelper.error(res, '批量撤销权限失败');
    }
  }

  // ==================== 草稿管理 ====================

  /**
   * 自动保存课程草稿
   */
  static async saveDraft(req, res) {
    try {
      const user = req.user;
      const {
        lesson_id,
        draft_content,
        draft_title
      } = req.body;

      if (!draft_content) {
        return ResponseHelper.validation(res, ['草稿内容不能为空']);
      }

      const dbConnection = require('../database/connection');

      // 检查是否已存在草稿
      let sql, params;

      if (lesson_id) {
        sql = `
          SELECT id FROM teaching_lesson_drafts 
          WHERE lesson_id = ? AND user_id = ?
        `;
        params = [lesson_id, user.id];
      } else {
        sql = `
          SELECT id FROM teaching_lesson_drafts 
          WHERE user_id = ? AND lesson_id IS NULL 
          ORDER BY updated_at DESC LIMIT 1
        `;
        params = [user.id];
      }

      const { rows: existingDrafts } = await dbConnection.query(sql, params);

      if (existingDrafts.length > 0) {
        // 更新现有草稿
        const draftId = existingDrafts[0].id;
        const updateSql = `
          UPDATE teaching_lesson_drafts 
          SET draft_content = ?, draft_title = ?, updated_at = NOW()
          WHERE id = ?
        `;
        const contentStr = typeof draft_content === 'string' 
          ? draft_content 
          : JSON.stringify(draft_content);
        
        await dbConnection.query(updateSql, [contentStr, draft_title, draftId]);

        return ResponseHelper.success(res, { draft_id: draftId }, '草稿已更新');
      } else {
        // 创建新草稿
        const insertSql = `
          INSERT INTO teaching_lesson_drafts 
          (lesson_id, user_id, draft_content, draft_title, auto_saved, created_at, updated_at)
          VALUES (?, ?, ?, ?, 1, NOW(), NOW())
        `;
        const contentStr = typeof draft_content === 'string' 
          ? draft_content 
          : JSON.stringify(draft_content);
        
        const { rows } = await dbConnection.query(insertSql, [
          lesson_id || null,
          user.id,
          contentStr,
          draft_title
        ]);

        return ResponseHelper.success(res, { draft_id: rows.insertId }, '草稿已保存', 201);
      }
    } catch (error) {
      logger.error('保存草稿失败:', error);
      return ResponseHelper.error(res, '保存草稿失败');
    }
  }

  /**
   * 获取课程草稿
   */
  static async getDraft(req, res) {
    try {
      const user = req.user;
      const { lessonId } = req.params;

      const dbConnection = require('../database/connection');

      let sql, params;

      if (lessonId && lessonId !== 'null') {
        sql = `
          SELECT * FROM teaching_lesson_drafts 
          WHERE lesson_id = ? AND user_id = ?
          ORDER BY updated_at DESC LIMIT 1
        `;
        params = [lessonId, user.id];
      } else {
        sql = `
          SELECT * FROM teaching_lesson_drafts 
          WHERE user_id = ? AND lesson_id IS NULL 
          ORDER BY updated_at DESC LIMIT 1
        `;
        params = [user.id];
      }

      const { rows } = await dbConnection.query(sql, params);

      if (rows.length === 0) {
        return ResponseHelper.success(res, null, '无草稿数据');
      }

      const draft = rows[0];

      // 解析JSON内容
      if (typeof draft.draft_content === 'string') {
        try {
          draft.draft_content = JSON.parse(draft.draft_content);
        } catch (e) {
          logger.warn('解析草稿内容失败', { draftId: draft.id });
        }
      }

      return ResponseHelper.success(res, draft, '获取草稿成功');
    } catch (error) {
      logger.error('获取草稿失败:', error);
      return ResponseHelper.error(res, '获取草稿失败');
    }
  }

  // ==================== 浏览记录 ====================

  /**
   * 记录浏览行为
   */
  static async recordView(req, res) {
    try {
      const user = req.user;
      const {
        module_id,
        lesson_id,
        page_number = 1,
        duration = 0,
        is_completed = false
      } = req.body;

      if (!module_id) {
        return ResponseHelper.validation(res, ['模块ID不能为空']);
      }

      const dbConnection = require('../database/connection');

      const sql = `
        INSERT INTO teaching_view_logs 
        (user_id, module_id, lesson_id, page_number, duration, is_completed, viewed_at)
        VALUES (?, ?, ?, ?, ?, ?, NOW())
      `;

      await dbConnection.query(sql, [
        user.id,
        module_id,
        lesson_id || null,
        page_number,
        duration,
        is_completed
      ]);

      return ResponseHelper.success(res, null, '浏览记录已保存');
    } catch (error) {
      logger.error('记录浏览行为失败:', error);
      return ResponseHelper.error(res, '记录浏览行为失败');
    }
  }
}

module.exports = TeachingController;

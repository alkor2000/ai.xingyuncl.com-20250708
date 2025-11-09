/**
 * 教学系统控制器（三级权限版 + 课程资料功能 + 教案功能 + 双层授权配置）
 * 
 * 版本更新：
 * - v2.0.0 (2025-11-09): 双层授权配置架构
 *   * 超级管理员配置存储在superAdminConfig层
 *   * 组管理员配置存储在groupAdminConfig层
 *   * 防止权限覆盖，保持配置独立
 * 
 * - v1.3.0 (2025-11-09): 支持组管理员二次授权
 *   * 组管理员可以管理本组的教学授权
 *   * 只能操作超级管理员已授权给本组的模块
 * 
 * - v1.2.0 (2025-10-31): 支持三级权限体系
 *   * view_lesson: 查看课程（学生）
 *   * view_plan: 查看教案（教师）
 *   * edit: 编辑权限（创建者/管理员）
 * 
 * - v1.1.2 (2025-10-29): 修复数据库连接方式
 */

const TeachingModule = require('../models/TeachingModule');
const TeachingLesson = require('../models/TeachingLesson');
const TeachingPermission = require('../models/TeachingPermission');
const TeachingModuleGroup = require('../models/TeachingModuleGroup');
const GlobalAuthorizationService = require('../services/GlobalAuthorizationService');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');
const { getUserTags } = require('../middleware/teachingPermissions');

class TeachingController {
  // ==================== 模块管理 ====================

  /**
   * 创建教学模块（增强：支持分组）
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
        owner_group_id,
        group_ids = []
      } = req.body;

      if (!name) {
        return ResponseHelper.validation(res, ['模块名称不能为空']);
      }

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

      if (group_ids.length > 0) {
        await TeachingModuleGroup.setModuleGroups(module.id, group_ids);
      }

      logger.info('教学模块创建成功', {
        moduleId: module.id,
        userId: user.id,
        name,
        groupIds: group_ids
      });

      return ResponseHelper.success(res, module, '模块创建成功', 201);
    } catch (error) {
      logger.error('创建教学模块失败:', error);
      return ResponseHelper.error(res, error.message || '创建模块失败');
    }
  }

  /**
   * 获取模块列表（修复：过滤空分组）
   */
  static async getModules(req, res) {
    try {
      const user = req.user;
      const {
        page = 1,
        limit = 20,
        status,
        visibility,
        search,
        group_by = 'none'
      } = req.query;

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

      if (group_by === 'group') {
        const dbConnection = require('../database/connection');
        
        const groups = await TeachingModuleGroup.getAll({ is_active: true });
        
        const groupedData = [];
        
        for (const group of groups) {
          const modules = await TeachingModuleGroup.getGroupModules(group.id);
          
          const accessibleModules = modules.filter(m => 
            result.modules.some(rm => rm.id === m.id)
          );
          
          if (accessibleModules.length > 0) {
            groupedData.push({
              ...group.toJSON(),
              modules: accessibleModules
            });
          }
        }

        const groupedModuleIds = new Set();
        groupedData.forEach(g => {
          g.modules.forEach(m => groupedModuleIds.add(m.id));
        });

        const ungroupedModules = result.modules.filter(m => !groupedModuleIds.has(m.id));
        
        if (ungroupedModules.length > 0) {
          groupedData.push({
            id: null,
            name: '未分组',
            description: '未分配到任何分组的模块',
            sort_order: 999999,
            is_active: true,
            module_count: ungroupedModules.length,
            modules: ungroupedModules
          });
        }

        logger.info('返回分组模块列表', {
          userId: user.id,
          totalGroups: groupedData.length,
          totalModules: result.modules.length
        });

        return ResponseHelper.success(res, {
          groups: groupedData,
          pagination: result.pagination
        }, '获取模块列表成功');
      }

      return ResponseHelper.success(res, result, '获取模块列表成功');
    } catch (error) {
      logger.error('获取模块列表失败:', error);
      return ResponseHelper.error(res, '获取模块列表失败');
    }
  }

  /**
   * 获取单个模块详情（增强：包含分组信息）
   */
  static async getModule(req, res) {
    try {
      const module = req.module;
      const permission = req.modulePermission;

      await module.incrementViewCount();

      const groups = await TeachingModuleGroup.getModuleGroups(module.id);

      const result = {
        ...module.toJSON(),
        user_permission: permission,
        groups: groups.map(g => g.toJSON())
      };

      return ResponseHelper.success(res, result, '获取模块详情成功');
    } catch (error) {
      logger.error('获取模块详情失败:', error);
      return ResponseHelper.error(res, '获取模块详情失败');
    }
  }

  /**
   * 更新模块信息（增强：支持更新分组）
   */
  static async updateModule(req, res) {
    try {
      const module = req.module;
      const {
        name,
        description,
        cover_image,
        visibility,
        status,
        order_index,
        group_ids
      } = req.body;

      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (cover_image !== undefined) updateData.cover_image = cover_image;
      if (visibility !== undefined) updateData.visibility = visibility;
      if (status !== undefined) updateData.status = status;
      if (order_index !== undefined) updateData.order_index = order_index;

      await module.update(updateData);

      if (group_ids !== undefined) {
        await TeachingModuleGroup.setModuleGroups(module.id, group_ids);
      }

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
      const module = req.module;
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

  // ==================== 分组管理（新增）====================

  static async getGroups(req, res) {
    try {
      const { is_active } = req.query;
      
      const groups = await TeachingModuleGroup.getAll({
        is_active: is_active !== undefined ? is_active === 'true' : null
      });

      return ResponseHelper.success(res, groups, '获取分组列表成功');
    } catch (error) {
      logger.error('获取分组列表失败:', error);
      return ResponseHelper.error(res, '获取分组列表失败');
    }
  }

  static async createGroup(req, res) {
    try {
      const user = req.user;

      if (user.role !== 'super_admin') {
        return ResponseHelper.forbidden(res, '仅超级管理员可创建分组');
      }

      const {
        name,
        description,
        sort_order = 0,
        is_active = true,
        visibility = 'public',
        owner_group_id
      } = req.body;

      if (!name) {
        return ResponseHelper.validation(res, ['分组名称不能为空']);
      }

      const group = await TeachingModuleGroup.create({
        name,
        description,
        sort_order,
        is_active,
        visibility,
        owner_group_id,
        created_by: user.id
      });

      logger.info('分组创建成功', {
        groupId: group.id,
        name,
        userId: user.id
      });

      return ResponseHelper.success(res, group, '分组创建成功', 201);
    } catch (error) {
      logger.error('创建分组失败:', error);
      return ResponseHelper.error(res, error.message || '创建分组失败');
    }
  }

  static async updateGroup(req, res) {
    try {
      const user = req.user;
      const { groupId } = req.params;

      if (user.role !== 'super_admin') {
        return ResponseHelper.forbidden(res, '仅超级管理员可更新分组');
      }

      const group = await TeachingModuleGroup.findById(groupId);
      if (!group) {
        return ResponseHelper.notFound(res, '分组不存在');
      }

      const {
        name,
        description,
        sort_order,
        is_active,
        visibility,
        owner_group_id
      } = req.body;

      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (sort_order !== undefined) updateData.sort_order = sort_order;
      if (is_active !== undefined) updateData.is_active = is_active;
      if (visibility !== undefined) updateData.visibility = visibility;
      if (owner_group_id !== undefined) updateData.owner_group_id = owner_group_id;

      await group.update(updateData);

      logger.info('分组更新成功', {
        groupId: group.id,
        userId: user.id
      });

      return ResponseHelper.success(res, group, '分组更新成功');
    } catch (error) {
      logger.error('更新分组失败:', error);
      return ResponseHelper.error(res, '更新分组失败');
    }
  }

  static async deleteGroup(req, res) {
    try {
      const user = req.user;
      const { groupId } = req.params;

      if (user.role !== 'super_admin') {
        return ResponseHelper.forbidden(res, '仅超级管理员可删除分组');
      }

      const group = await TeachingModuleGroup.findById(groupId);
      if (!group) {
        return ResponseHelper.notFound(res, '分组不存在');
      }

      await group.delete();

      logger.info('分组删除成功', {
        groupId: group.id,
        userId: user.id
      });

      return ResponseHelper.success(res, null, '分组删除成功');
    } catch (error) {
      logger.error('删除分组失败:', error);
      return ResponseHelper.error(res, '删除分组失败');
    }
  }

  static async getGroupModules(req, res) {
    try {
      const { groupId } = req.params;

      const modules = await TeachingModuleGroup.getGroupModules(groupId);

      return ResponseHelper.success(res, modules, '获取分组模块成功');
    } catch (error) {
      logger.error('获取分组模块失败:', error);
      return ResponseHelper.error(res, '获取分组模块失败');
    }
  }

  // ==================== 管理员功能 ====================

  static async getAllModules(req, res) {
    try {
      const user = req.user;

      // 组管理员只能看到本组的模块
      if (user.role === 'admin') {
        return await TeachingController.getGroupModulesForAdmin(req, res);
      }

      if (user.role !== 'super_admin') {
        return ResponseHelper.forbidden(res, '无权访问');
      }

      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.max(1, Math.min(1000, parseInt(req.query.limit) || 100));
      const offset = (page - 1) * limit;
      const { status, visibility, search } = req.query;

      const dbConnection = require('../database/connection');

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

      const countSql = `SELECT COUNT(*) as total FROM teaching_modules tm WHERE ${whereClause}`;
      const { rows: countRows } = await dbConnection.query(countSql, whereParams);
      const total = countRows[0].total;

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
   * 组管理员获取本组授权的模块（支持双层配置）
   */
  static async getGroupModulesForAdmin(req, res) {
    try {
      const user = req.user;
      const dbConnection = require('../database/connection');

      // 获取本组的全局授权配置
      const authSql = `
        SELECT config_data 
        FROM teaching_global_authorizations 
        WHERE group_id = ?
      `;
      const { rows: authRows } = await dbConnection.query(authSql, [user.group_id]);

      if (authRows.length === 0) {
        return ResponseHelper.success(res, {
          modules: [],
          pagination: {
            page: 1,
            limit: 100,
            total: 0,
            pages: 0
          }
        }, '获取模块列表成功');
      }

      let config;
      try {
        config = typeof authRows[0].config_data === 'string' 
          ? JSON.parse(authRows[0].config_data) 
          : authRows[0].config_data;
      } catch (error) {
        logger.error('解析授权配置失败:', error);
        return ResponseHelper.success(res, {
          modules: [],
          pagination: {
            page: 1,
            limit: 100,
            total: 0,
            pages: 0
          }
        }, '获取模块列表成功');
      }

      // 从双层配置中提取模块ID
      let moduleIds = [];
      
      if (config.version === '2.0.0') {
        // 新的双层格式：从superAdminConfig中提取
        const superConfig = config.superAdminConfig || {};
        moduleIds = (superConfig.modulePermissions || [])
          .filter(mp => mp.view_lesson || mp.view_plan || mp.edit || mp.view)
          .map(mp => mp.moduleId);
      } else {
        // 兼容旧格式
        moduleIds = (config.modulePermissions || [])
          .filter(mp => mp.view_lesson || mp.view_plan || mp.edit || mp.view)
          .map(mp => mp.moduleId);
      }

      if (moduleIds.length === 0) {
        return ResponseHelper.success(res, {
          modules: [],
          pagination: {
            page: 1,
            limit: 100,
            total: 0,
            pages: 0
          }
        }, '获取模块列表成功');
      }

      // 查询这些模块的详细信息
      const placeholders = moduleIds.map(() => '?').join(',');
      const modulesSql = `
        SELECT 
          tm.*,
          u.username as creator_name,
          u.remark as creator_remark,
          ug.name as owner_group_name,
          (SELECT COUNT(*) FROM teaching_lessons WHERE module_id = tm.id AND deleted_at IS NULL) as lesson_count
        FROM teaching_modules tm
        LEFT JOIN users u ON tm.creator_id = u.id
        LEFT JOIN user_groups ug ON tm.owner_group_id = ug.id
        WHERE tm.id IN (${placeholders}) AND tm.deleted_at IS NULL
        ORDER BY tm.created_at DESC
      `;

      const { rows: modules } = await dbConnection.query(modulesSql, moduleIds);

      logger.info('组管理员获取授权模块', {
        adminId: user.id,
        groupId: user.group_id,
        moduleCount: modules.length,
        configVersion: config.version || '1.0.0'
      });

      return ResponseHelper.success(res, {
        modules,
        pagination: {
          page: 1,
          limit: 100,
          total: modules.length,
          pages: 1
        }
      }, '获取模块列表成功');
    } catch (error) {
      logger.error('组管理员获取模块失败:', error);
      return ResponseHelper.error(res, '获取模块列表失败');
    }
  }

  static async batchUpdateModules(req, res) {
    try {
      const user = req.user;

      if (user.role !== 'super_admin') {
        return ResponseHelper.forbidden(res, '仅超级管理员可操作');
      }

      const { module_ids, update_data } = req.body;

      if (!Array.isArray(module_ids) || module_ids.length === 0) {
        return ResponseHelper.validation(res, ['模块ID列表不能为空']);
      }

      if (!update_data || Object.keys(update_data).length === 0) {
        return ResponseHelper.validation(res, ['更新数据不能为空']);
      }

      const dbConnection = require('../database/connection');

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

      updateFields.push('updated_at = NOW()');

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
   * 创建课程（修复：添加materials字段支持）
   */
  static async createLesson(req, res) {
    try {
      const user = req.user;
      const {
        module_id,
        title,
        description,
        cover_image,
        materials,
        content_type = 'course',
        content,
        status = 'draft',
        order_index
      } = req.body;

      if (!module_id || !title || !content) {
        return ResponseHelper.validation(res, ['模块ID、标题和内容不能为空']);
      }

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
        materials: materials || [],
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
        title,
        materialsCount: materials ? materials.length : 0
      });

      return ResponseHelper.success(res, lesson, '课程创建成功', 201);
    } catch (error) {
      logger.error('创建课程失败:', error);
      return ResponseHelper.error(res, error.message || '创建课程失败');
    }
  }

  /**
   * 获取模块的课程列表（核心修复：正确处理新的授权返回格式）
   */
  static async getModuleLessons(req, res) {
    try {
      const { moduleId } = req.params;
      const { status } = req.query;
      const user = req.user;

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

      const allLessons = await TeachingLesson.getModuleLessons(
        moduleId,
        user.id,
        user.role,
        userTags,
        {
          status,
          include_teacher_content: permission === 'edit'
        }
      );

      let filteredLessons = allLessons;

      const module = await TeachingModule.findById(moduleId);
      const isSuperAdmin = user.role === 'super_admin';
      const isCreator = module && module.creator_id === user.id;

      if (!isSuperAdmin && !isCreator) {
        const authResult = await GlobalAuthorizationService.getUserAuthorizedLessonIds(
          user.id,
          parseInt(moduleId),
          user.group_id,
          userTags
        );

        logger.info('课程授权检查结果', {
          userId: user.id,
          moduleId,
          authResult
        });

        if (authResult === null) {
          filteredLessons = allLessons;
        } else if (authResult && typeof authResult === 'object' && authResult.mode === 'all_except') {
          const deniedIds = authResult.deniedLessonIds || [];
          filteredLessons = allLessons.filter(lesson => 
            !deniedIds.includes(lesson.id)
          );
          
          logger.info('过滤被禁用的课程', {
            totalLessons: allLessons.length,
            deniedCount: deniedIds.length,
            remainingCount: filteredLessons.length
          });
        } else if (Array.isArray(authResult)) {
          if (authResult.length === 0) {
            filteredLessons = [];
          } else {
            filteredLessons = allLessons.filter(lesson => 
              authResult.includes(lesson.id)
            );
          }
        } else {
          logger.warn('未知的授权返回格式', { authResult });
          filteredLessons = [];
        }
      }

      return ResponseHelper.success(res, filteredLessons, '获取课程列表成功');
    } catch (error) {
      logger.error('获取课程列表失败:', error);
      return ResponseHelper.error(res, '获取课程列表失败');
    }
  }

  static async getLesson(req, res) {
    try {
      const lesson = req.lesson;

      await lesson.incrementViewCount();

      return ResponseHelper.success(res, lesson, '获取课程详情成功');
    } catch (error) {
      logger.error('获取课程详情失败:', error);
      return ResponseHelper.error(res, '获取课程详情失败');
    }
  }

  /**
   * 更新课程（修复：添加materials字段支持）
   */
  static async updateLesson(req, res) {
    try {
      const lesson = req.lesson;
      const {
        title,
        description,
        cover_image,
        materials,
        content_type,
        content,
        status,
        order_index
      } = req.body;

      const updateData = {};
      if (title !== undefined) updateData.title = title;
      if (description !== undefined) updateData.description = description;
      if (cover_image !== undefined) updateData.cover_image = cover_image;
      if (materials !== undefined) updateData.materials = materials;
      if (content_type !== undefined) updateData.content_type = content_type;
      if (content !== undefined) updateData.content = content;
      if (status !== undefined) updateData.status = status;
      if (order_index !== undefined) updateData.order_index = order_index;

      await lesson.update(updateData);

      logger.info('课程更新成功', {
        lessonId: lesson.id,
        userId: req.user.id,
        materialsCount: materials ? materials.length : undefined
      });

      return ResponseHelper.success(res, lesson, '课程更新成功');
    } catch (error) {
      logger.error('更新课程失败:', error);
      return ResponseHelper.error(res, '更新课程失败');
    }
  }

  static async deleteLesson(req, res) {
    try {
      const lesson = req.lesson;
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

  // ==================== 教案管理（三级权限版）====================

  /**
   * 保存教案
   * POST /api/teaching/lessons/:id/teaching-plan
   * 权限要求：edit（编辑权限）
   */
  static async saveTeachingPlan(req, res) {
    const dbConnection = require('../database/connection');
    
    try {
      const { id } = req.params;
      const { page_number, content } = req.body;
      const userId = req.user.id;

      if (!page_number || page_number < 1) {
        return ResponseHelper.validation(res, ['页面编号无效']);
      }

      // 检查课程是否存在
      const { rows: lessons } = await dbConnection.query(
        'SELECT * FROM teaching_lessons WHERE id = ?',
        [id]
      );

      if (lessons.length === 0) {
        return ResponseHelper.notFound(res, '课程不存在');
      }

      const lesson = lessons[0];

      // 权限检查：只有edit权限才能保存教案
      const userTags = await getUserTags(userId);
      const permission = await TeachingModule.checkUserPermission(
        lesson.module_id,
        userId,
        req.user.role,
        req.user.group_id,
        userTags
      );

      if (permission !== 'edit') {
        return ResponseHelper.forbidden(res, '无权编辑此课程的教案');
      }

      // 保存教案（使用正确的字段名 creator_id）
      const insertSql = `
        INSERT INTO teaching_lesson_plans 
        (lesson_id, page_number, content, creator_id) 
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 
        content = VALUES(content),
        updated_at = CURRENT_TIMESTAMP
      `;

      await dbConnection.query(insertSql, [id, page_number, content, userId]);

      // 获取保存后的教案
      const { rows: plans } = await dbConnection.query(
        'SELECT * FROM teaching_lesson_plans WHERE lesson_id = ? AND page_number = ?',
        [id, page_number]
      );

      logger.info('教案保存成功', {
        lessonId: id,
        pageNumber: page_number,
        userId,
        permission
      });

      return ResponseHelper.success(res, plans[0], '教案保存成功');
    } catch (error) {
      logger.error('保存教案失败:', error);
      return ResponseHelper.error(res, error.message || '保存教案失败');
    }
  }

  /**
   * 获取教案
   * GET /api/teaching/lessons/:id/teaching-plan/:pageNumber
   * 权限要求：view_plan（查看教案）或 edit（编辑）- 三级权限核心逻辑
   */
  static async getTeachingPlan(req, res) {
    const dbConnection = require('../database/connection');
    
    try {
      const { id, pageNumber } = req.params;
      const userId = req.user.id;

      // 检查课程是否存在
      const { rows: lessons } = await dbConnection.query(
        'SELECT * FROM teaching_lessons WHERE id = ?',
        [id]
      );

      if (lessons.length === 0) {
        return ResponseHelper.notFound(res, '课程不存在');
      }

      const lesson = lessons[0];

      // 【核心修改】三级权限检查：只有 view_plan 或 edit 才能查看教案
      const userTags = await getUserTags(userId);
      const permission = await TeachingModule.checkUserPermission(
        lesson.module_id,
        userId,
        req.user.role,
        req.user.group_id,
        userTags
      );

      // 权限层级验证
      if (!['view_plan', 'edit'].includes(permission)) {
        logger.warn('用户尝试查看教案但权限不足', {
          userId,
          username: req.user.username,
          lessonId: id,
          currentPermission: permission,
          requiredPermission: 'view_plan 或 edit'
        });
        return ResponseHelper.forbidden(res, '无权查看此课程的教案，需要教师权限或更高级别');
      }

      // 获取教案
      const { rows: plans } = await dbConnection.query(
        'SELECT * FROM teaching_lesson_plans WHERE lesson_id = ? AND page_number = ?',
        [id, pageNumber]
      );

      if (plans.length === 0) {
        return ResponseHelper.notFound(res, '该页面暂无教案');
      }

      logger.info('教案访问成功', {
        lessonId: id,
        pageNumber,
        userId,
        permission
      });

      return ResponseHelper.success(res, plans[0], '获取教案成功');
    } catch (error) {
      logger.error('获取教案失败:', error);
      return ResponseHelper.error(res, error.message || '获取教案失败');
    }
  }

  // ==================== 权限管理 ====================

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

  static async grantPermission(req, res) {
    try {
      const user = req.user;
      const {
        module_id,
        user_id,
        group_id,
        tag_id,
        permission_type = 'view_lesson', // 【修改】默认值改为 view_lesson（向后兼容）
        expires_at,
        note
      } = req.body;

      if (!module_id) {
        return ResponseHelper.validation(res, ['模块ID不能为空']);
      }

      // 验证权限类型（三级权限）
      const validPermissions = ['view_lesson', 'view_plan', 'edit'];
      if (!validPermissions.includes(permission_type)) {
        return ResponseHelper.validation(res, ['权限类型无效，必须是 view_lesson、view_plan 或 edit']);
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
        permissionType: permission_type,
        grantedBy: user.id
      });

      return ResponseHelper.success(res, permission, '权限授予成功', 201);
    } catch (error) {
      logger.error('授予权限失败:', error);
      return ResponseHelper.error(res, error.message || '授予权限失败');
    }
  }

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

  // ==================== 草稿和浏览记录 ====================

  static async saveDraft(req, res) {
    try {
      const user = req.user;
      const { lesson_id, draft_content, draft_title } = req.body;

      if (!draft_content) {
        return ResponseHelper.validation(res, ['草稿内容不能为空']);
      }

      const dbConnection = require('../database/connection');

      let sql, params;

      if (lesson_id) {
        sql = 'SELECT id FROM teaching_lesson_drafts WHERE lesson_id = ? AND user_id = ?';
        params = [lesson_id, user.id];
      } else {
        sql = 'SELECT id FROM teaching_lesson_drafts WHERE user_id = ? AND lesson_id IS NULL ORDER BY updated_at DESC LIMIT 1';
        params = [user.id];
      }

      const { rows: existingDrafts } = await dbConnection.query(sql, params);

      if (existingDrafts.length > 0) {
        const draftId = existingDrafts[0].id;
        const updateSql = 'UPDATE teaching_lesson_drafts SET draft_content = ?, draft_title = ?, updated_at = NOW() WHERE id = ?';
        const contentStr = typeof draft_content === 'string' ? draft_content : JSON.stringify(draft_content);
        
        await dbConnection.query(updateSql, [contentStr, draft_title, draftId]);

        return ResponseHelper.success(res, { draft_id: draftId }, '草稿已更新');
      } else {
        const insertSql = 'INSERT INTO teaching_lesson_drafts (lesson_id, user_id, draft_content, draft_title, auto_saved, created_at, updated_at) VALUES (?, ?, ?, ?, 1, NOW(), NOW())';
        const contentStr = typeof draft_content === 'string' ? draft_content : JSON.stringify(draft_content);
        
        const { rows } = await dbConnection.query(insertSql, [lesson_id || null, user.id, contentStr, draft_title]);

        return ResponseHelper.success(res, { draft_id: rows.insertId }, '草稿已保存', 201);
      }
    } catch (error) {
      logger.error('保存草稿失败:', error);
      return ResponseHelper.error(res, '保存草稿失败');
    }
  }

  static async getDraft(req, res) {
    try {
      const user = req.user;
      const { lessonId } = req.params;

      const dbConnection = require('../database/connection');

      let sql, params;

      if (lessonId && lessonId !== 'null') {
        sql = 'SELECT * FROM teaching_lesson_drafts WHERE lesson_id = ? AND user_id = ? ORDER BY updated_at DESC LIMIT 1';
        params = [lessonId, user.id];
      } else {
        sql = 'SELECT * FROM teaching_lesson_drafts WHERE user_id = ? AND lesson_id IS NULL ORDER BY updated_at DESC LIMIT 1';
        params = [user.id];
      }

      const { rows } = await dbConnection.query(sql, params);

      if (rows.length === 0) {
        return ResponseHelper.success(res, null, '无草稿数据');
      }

      const draft = rows[0];

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

      const sql = 'INSERT INTO teaching_view_logs (user_id, module_id, lesson_id, page_number, duration, is_completed, viewed_at) VALUES (?, ?, ?, ?, ?, ?, NOW())';

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

  // ==================== 全局授权管理（双层配置版 v2.0）====================

  /**
   * 保存全局授权配置（双层配置版）
   * 超级管理员：更新superAdminConfig层（模块级授权）
   * 组管理员：更新groupAdminConfig层（标签和用户级分配）
   * 
   * @version 2.0.0
   * @since 2025-11-09
   */
  static async saveGlobalAuthorizations(req, res) {
    try {
      const user = req.user;
      const { authorizations } = req.body;

      if (!Array.isArray(authorizations) || authorizations.length === 0) {
        return ResponseHelper.validation(res, ['授权配置不能为空']);
      }

      const dbConnection = require('../database/connection');

      // 组管理员权限检查
      if (user.role === 'admin') {
        // 检查是否只操作本组
        const invalidGroups = authorizations.filter(auth => auth.groupId !== user.group_id);
        if (invalidGroups.length > 0) {
          return ResponseHelper.forbidden(res, '组管理员只能管理本组的授权配置');
        }
      }

      // 使用事务保存配置
      await dbConnection.transaction(async (query) => {
        for (const auth of authorizations) {
          const { groupId, modulePermissions, tags } = auth;

          if (!groupId) {
            continue;
          }

          // 获取现有配置
          const { rows: existingRows } = await query(
            'SELECT config_data FROM teaching_global_authorizations WHERE group_id = ?',
            [groupId]
          );

          let existingConfig = {};
          if (existingRows.length > 0) {
            try {
              existingConfig = typeof existingRows[0].config_data === 'string'
                ? JSON.parse(existingRows[0].config_data)
                : existingRows[0].config_data;
            } catch (error) {
              logger.error('解析现有配置失败:', error);
              existingConfig = {};
            }
          }

          // 构建双层配置
          let newConfig;
          
          if (user.role === 'super_admin') {
            // 超级管理员：更新superAdminConfig层
            newConfig = {
              ...existingConfig,
              superAdminConfig: {
                modulePermissions: modulePermissions || [],
                createdBy: existingConfig.superAdminConfig?.createdBy || user.id,
                createdAt: existingConfig.superAdminConfig?.createdAt || new Date().toISOString(),
                updatedBy: user.id,
                updatedAt: new Date().toISOString(),
                note: '超级管理员授权配置'
              },
              // 保留现有的groupAdminConfig或初始化
              groupAdminConfig: existingConfig.groupAdminConfig || {
                tags: [],
                updatedBy: user.id,
                updatedAt: new Date().toISOString(),
                note: '组管理员分配配置'
              },
              version: '2.0.0',
              lastUpdatedBy: user.id,
              lastUpdatedAt: new Date().toISOString()
            };
          } else if (user.role === 'admin') {
            // 组管理员：只更新groupAdminConfig层
            if (!existingConfig.superAdminConfig || !existingConfig.superAdminConfig.modulePermissions) {
              return ResponseHelper.forbidden(res, '超级管理员尚未对该组进行授权配置');
            }

            // 验证组管理员不能分配超出授权范围的模块
            const authorizedModuleIds = new Set(
              (existingConfig.superAdminConfig.modulePermissions || [])
                .filter(mp => mp.view_lesson || mp.view_plan || mp.edit || mp.view)
                .map(mp => mp.moduleId)
            );

            // 检查标签和用户配置中的模块
            for (const tag of (tags || [])) {
              for (const mp of (tag.modulePermissions || [])) {
                if (!authorizedModuleIds.has(mp.moduleId)) {
                  logger.warn('组管理员尝试分配未授权模块', {
                    adminId: user.id,
                    moduleId: mp.moduleId,
                    moduleName: mp.moduleName
                  });
                  return ResponseHelper.forbidden(res, 
                    `模块 ${mp.moduleName || mp.moduleId} 未被超级管理员授权，无法分配`
                  );
                }
              }
              
              // 检查用户级配置
              for (const userConfig of (tag.users || [])) {
                for (const mp of (userConfig.modulePermissions || [])) {
                  if (!authorizedModuleIds.has(mp.moduleId)) {
                    logger.warn('组管理员尝试给用户分配未授权模块', {
                      adminId: user.id,
                      userId: userConfig.userId,
                      moduleId: mp.moduleId
                    });
                    return ResponseHelper.forbidden(res, 
                      `模块 ${mp.moduleName || mp.moduleId} 未被超级管理员授权，无法分配`
                    );
                  }
                }
              }
            }

            // 更新groupAdminConfig层，保持superAdminConfig不变
            newConfig = {
              ...existingConfig,
              superAdminConfig: existingConfig.superAdminConfig, // 保持不变
              groupAdminConfig: {
                tags: tags || [],
                updatedBy: user.id,
                updatedAt: new Date().toISOString(),
                note: '组管理员分配配置'
              },
              version: '2.0.0',
              lastUpdatedBy: user.id,
              lastUpdatedAt: new Date().toISOString()
            };
          } else {
            return ResponseHelper.forbidden(res, '无权执行此操作');
          }

          // 保存配置
          if (existingRows.length > 0) {
            // 更新现有记录
            const updateSql = `
              UPDATE teaching_global_authorizations 
              SET config_data = ?, updated_by = ?, updated_at = NOW()
              WHERE group_id = ?
            `;
            await query(updateSql, [JSON.stringify(newConfig), user.id, groupId]);
          } else {
            // 插入新记录
            const insertSql = `
              INSERT INTO teaching_global_authorizations 
              (group_id, config_data, created_by, updated_by, created_at, updated_at)
              VALUES (?, ?, ?, ?, NOW(), NOW())
            `;
            await query(insertSql, [groupId, JSON.stringify(newConfig), user.id, user.id]);
          }
        }
      });

      logger.info('双层授权配置保存成功', {
        userId: user.id,
        userRole: user.role,
        groupCount: authorizations.length,
        layer: user.role === 'super_admin' ? 'superAdminConfig' : 'groupAdminConfig'
      });

      return ResponseHelper.success(res, null, '授权配置保存成功');
    } catch (error) {
      logger.error('保存双层授权配置失败:', error);
      return ResponseHelper.error(res, error.message || '保存授权配置失败');
    }
  }

  /**
   * 获取全局授权配置（双层配置版）
   * 返回合并后的配置，前端可以正确显示两层权限
   * 
   * @version 2.0.0
   * @since 2025-11-09
   */
  static async getGlobalAuthorizations(req, res) {
    try {
      const user = req.user;
      const dbConnection = require('../database/connection');

      let sql;
      let params = [];

      if (user.role === 'admin') {
        // 组管理员只获取本组的配置
        sql = `
          SELECT 
            tga.id,
            tga.group_id,
            tga.config_data,
            ug.name as group_name,
            (SELECT COUNT(*) FROM users WHERE group_id = ug.id AND deleted_at IS NULL) as user_count,
            tga.created_at,
            tga.updated_at
          FROM teaching_global_authorizations tga
          LEFT JOIN user_groups ug ON tga.group_id = ug.id
          WHERE tga.group_id = ?
        `;
        params = [user.group_id];
      } else if (user.role === 'super_admin') {
        // 超级管理员获取所有组的配置
        sql = `
          SELECT 
            tga.id,
            tga.group_id,
            tga.config_data,
            ug.name as group_name,
            (SELECT COUNT(*) FROM users WHERE group_id = ug.id AND deleted_at IS NULL) as user_count,
            tga.created_at,
            tga.updated_at
          FROM teaching_global_authorizations tga
          LEFT JOIN user_groups ug ON tga.group_id = ug.id
          WHERE ug.id IS NOT NULL
          ORDER BY ug.name ASC
        `;
      } else {
        return ResponseHelper.forbidden(res, '无权访问授权配置');
      }

      const { rows } = await dbConnection.query(sql, params);

      const authorizations = rows.map(row => {
        let configData;
        try {
          configData = typeof row.config_data === 'string' 
            ? JSON.parse(row.config_data) 
            : row.config_data;
        } catch (error) {
          logger.error('解析配置数据失败:', error);
          configData = {};
        }

        // 合并双层配置为前端期望的格式
        let mergedConfig;
        
        if (configData.version === '2.0.0') {
          // 新的双层格式
          const superConfig = configData.superAdminConfig || {};
          const groupConfig = configData.groupAdminConfig || {};
          
          mergedConfig = {
            modulePermissions: superConfig.modulePermissions || [],
            tags: groupConfig.tags || [],
            // 保留元数据供前端参考
            _metadata: {
              version: '2.0.0',
              superAdminUpdatedAt: superConfig.updatedAt,
              superAdminUpdatedBy: superConfig.updatedBy || superConfig.createdBy,
              groupAdminUpdatedAt: groupConfig.updatedAt,
              groupAdminUpdatedBy: groupConfig.updatedBy,
              isGroupAdminManaged: user.role === 'admin'
            }
          };
        } else {
          // 兼容旧格式
          mergedConfig = {
            modulePermissions: configData.modulePermissions || [],
            tags: configData.tags || [],
            _metadata: {
              version: '1.0.0',
              needsMigration: true
            }
          };
        }

        return {
          id: row.id,
          groupId: row.group_id,
          groupName: row.group_name,
          userCount: row.user_count,
          config: mergedConfig,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
      });

      logger.info('获取双层授权配置成功', {
        userId: user.id,
        userRole: user.role,
        recordCount: authorizations.length
      });

      return ResponseHelper.success(res, authorizations, '获取授权配置成功');
    } catch (error) {
      logger.error('获取双层授权配置失败:', error);
      return ResponseHelper.error(res, '获取授权配置失败');
    }
  }

  static async getTagUsers(req, res) {
    try {
      const { tagId } = req.params;
      const { page = 1, limit = 20 } = req.query;

      const pageNum = Math.max(1, parseInt(page));
      const limitNum = Math.max(1, Math.min(100, parseInt(limit)));
      const offset = (pageNum - 1) * limitNum;

      const dbConnection = require('../database/connection');

      const countSql = `
        SELECT COUNT(DISTINCT u.id) as total
        FROM users u
        INNER JOIN user_tag_relations utr ON u.id = utr.user_id
        WHERE utr.tag_id = ? 
        AND u.deleted_at IS NULL
      `;

      const { rows: countRows } = await dbConnection.query(countSql, [tagId]);
      const total = countRows[0].total;

      const dataSql = `
        SELECT 
          u.id,
          u.username,
          u.email,
          u.remark,
          u.created_at
        FROM users u
        INNER JOIN user_tag_relations utr ON u.id = utr.user_id
        WHERE utr.tag_id = ? 
        AND u.deleted_at IS NULL
        ORDER BY u.username ASC
        LIMIT ? OFFSET ?
      `;

      const { rows: users } = await dbConnection.simpleQuery(dataSql, [tagId, limitNum, offset]);

      return ResponseHelper.success(res, {
        users,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum)
        }
      }, '获取标签用户列表成功');
    } catch (error) {
      logger.error('获取标签用户列表失败:', error);
      return ResponseHelper.error(res, '获取标签用户列表失败');
    }
  }

  static async getModuleLessonsForAuth(req, res) {
    try {
      const { moduleId } = req.params;

      const dbConnection = require('../database/connection');

      const sql = `
        SELECT 
          id,
          title,
          description,
          cover_image,
          content_type,
          status,
          order_index
        FROM teaching_lessons
        WHERE module_id = ? 
        AND is_deleted = 0
        AND status = 'published'
        ORDER BY order_index ASC, created_at ASC
      `;

      const { rows: lessons } = await dbConnection.query(sql, [moduleId]);

      return ResponseHelper.success(res, lessons, '获取课程列表成功');
    } catch (error) {
      logger.error('获取模块课程列表失败:', error);
      return ResponseHelper.error(res, '获取课程列表失败');
    }
  }
}

module.exports = TeachingController;

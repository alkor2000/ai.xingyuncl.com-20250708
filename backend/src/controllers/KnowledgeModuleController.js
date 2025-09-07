/**
 * 知识模块控制器
 */

const KnowledgeModule = require('../models/KnowledgeModule');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');

class KnowledgeModuleController {
  /**
   * 获取用户可用的知识模块列表
   * 修复：传递用户角色给模型方法
   */
  static async getModules(req, res) {
    try {
      const userId = req.user.id;
      const groupId = req.user.group_id;
      const userRole = req.user.role; // 添加用户角色
      const { include_inactive = false } = req.query;
      
      const modules = await KnowledgeModule.getUserAvailableModules(
        userId, 
        groupId, 
        include_inactive === 'true',
        userRole // 传递用户角色
      );
      
      return ResponseHelper.success(res, modules, '获取知识模块列表成功');
    } catch (error) {
      logger.error('获取知识模块列表失败', { 
        error: error.message,
        userId: req.user?.id 
      });
      return ResponseHelper.error(res, '获取知识模块列表失败');
    }
  }

  /**
   * 获取单个知识模块详情
   * 修复：传递用户角色给权限检查
   */
  static async getModule(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const groupId = req.user.group_id;
      const userRole = req.user.role; // 添加用户角色
      
      const module = await KnowledgeModule.findById(id, userId);
      
      if (!module) {
        return ResponseHelper.notFound(res, '知识模块不存在');
      }
      
      // 检查访问权限（传递用户角色）
      const hasAccess = await KnowledgeModule.checkUserAccess(id, userId, groupId, userRole);
      if (!hasAccess) {
        return ResponseHelper.forbidden(res, '无权访问此模块');
      }
      
      return ResponseHelper.success(res, module.toJSON(), '获取知识模块详情成功');
    } catch (error) {
      logger.error('获取知识模块详情失败', { 
        error: error.message,
        moduleId: req.params.id,
        userId: req.user?.id 
      });
      return ResponseHelper.error(res, '获取知识模块详情失败');
    }
  }

  /**
   * 创建知识模块
   * 新增：处理标签权限
   */
  static async createModule(req, res) {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;
      const userGroupId = req.user.group_id;
      const moduleData = req.body;
      
      // 验证必填字段
      if (!moduleData.name || !moduleData.content) {
        return ResponseHelper.validation(res, ['名称和内容不能为空']);
      }
      
      // 权限验证
      if (moduleData.module_scope === 'system' && userRole !== 'super_admin') {
        return ResponseHelper.forbidden(res, '只有超级管理员可以创建全局模块');
      }
      
      if (moduleData.module_scope === 'team') {
        if (userRole !== 'admin' && userRole !== 'super_admin') {
          return ResponseHelper.forbidden(res, '只有管理员可以创建团队模块');
        }
        // 组管理员只能为自己的组创建
        if (userRole === 'admin') {
          moduleData.group_id = userGroupId;
        }
        
        // 验证标签权限：确保选择的标签属于该组
        if (moduleData.allowed_tag_ids && moduleData.allowed_tag_ids.length > 0) {
          const validateTagsSql = `
            SELECT COUNT(*) as valid_count 
            FROM user_tags 
            WHERE id IN (${moduleData.allowed_tag_ids.map(() => '?').join(',')})
            AND group_id = ? 
            AND is_active = 1
          `;
          const dbConnection = require('../database/connection');
          const { rows } = await dbConnection.query(
            validateTagsSql, 
            [...moduleData.allowed_tag_ids, moduleData.group_id]
          );
          
          if (rows[0].valid_count !== moduleData.allowed_tag_ids.length) {
            return ResponseHelper.validation(res, ['选择的标签无效或不属于当前组']);
          }
        }
      }
      
      const module = await KnowledgeModule.create(moduleData, userId);
      
      return ResponseHelper.success(res, module.toJSON(), '创建知识模块成功', 201);
    } catch (error) {
      logger.error('创建知识模块失败', { 
        error: error.message,
        userId: req.user?.id,
        data: req.body 
      });
      return ResponseHelper.error(res, error.message || '创建知识模块失败');
    }
  }

  /**
   * 更新知识模块
   * 新增：处理标签权限更新
   */
  static async updateModule(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const userRole = req.user.role;
      const userGroupId = req.user.group_id;
      const updateData = req.body;
      
      // 获取原模块信息
      const originalModule = await KnowledgeModule.findById(id);
      if (!originalModule) {
        return ResponseHelper.notFound(res, '知识模块不存在');
      }
      
      // 如果是团队模块，验证标签权限
      if (originalModule.module_scope === 'team' && updateData.allowed_tag_ids !== undefined) {
        // 只有创建者或超级管理员可以修改标签权限
        if (originalModule.creator_id !== userId && userRole !== 'super_admin') {
          return ResponseHelper.forbidden(res, '无权修改此模块的访问权限');
        }
        
        // 验证标签属于该组
        if (updateData.allowed_tag_ids && updateData.allowed_tag_ids.length > 0) {
          const validateTagsSql = `
            SELECT COUNT(*) as valid_count 
            FROM user_tags 
            WHERE id IN (${updateData.allowed_tag_ids.map(() => '?').join(',')})
            AND group_id = ? 
            AND is_active = 1
          `;
          const dbConnection = require('../database/connection');
          const { rows } = await dbConnection.query(
            validateTagsSql, 
            [...updateData.allowed_tag_ids, originalModule.group_id]
          );
          
          if (rows[0].valid_count !== updateData.allowed_tag_ids.length) {
            return ResponseHelper.validation(res, ['选择的标签无效或不属于模块所在组']);
          }
        }
      }
      
      const module = await KnowledgeModule.update(id, updateData, userId);
      
      return ResponseHelper.success(res, module.toJSON(), '更新知识模块成功');
    } catch (error) {
      logger.error('更新知识模块失败', { 
        error: error.message,
        moduleId: req.params.id,
        userId: req.user?.id,
        data: req.body 
      });
      return ResponseHelper.error(res, error.message || '更新知识模块失败');
    }
  }

  /**
   * 删除知识模块
   */
  static async deleteModule(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      
      await KnowledgeModule.delete(id, userId);
      
      return ResponseHelper.success(res, null, '删除知识模块成功');
    } catch (error) {
      logger.error('删除知识模块失败', { 
        error: error.message,
        moduleId: req.params.id,
        userId: req.user?.id 
      });
      return ResponseHelper.error(res, error.message || '删除知识模块失败');
    }
  }

  /**
   * 获取模块分类列表
   */
  static async getCategories(req, res) {
    try {
      // 这是一个简单的实现，后续可以从数据库动态获取
      const categories = [
        { value: 'general', label: '通用' },
        { value: 'development', label: '开发' },
        { value: 'marketing', label: '营销' },
        { value: 'design', label: '设计' },
        { value: 'business', label: '商务' },
        { value: 'education', label: '教育' },
        { value: 'other', label: '其他' }
      ];
      
      return ResponseHelper.success(res, categories, '获取分类列表成功');
    } catch (error) {
      logger.error('获取分类列表失败', { 
        error: error.message,
        userId: req.user?.id 
      });
      return ResponseHelper.error(res, '获取分类列表失败');
    }
  }
}

module.exports = KnowledgeModuleController;

/**
 * 系统模块控制器
 */

const Module = require('../../models/Module');
const ResponseHelper = require('../../utils/response');
const JWTService = require('../../services/jwtService');
const logger = require('../../utils/logger');

class ModuleController {
  /**
   * 获取所有模块
   */
  static async getModules(req, res) {
    try {
      const modules = await Module.findAll();
      
      // 解析JSON字段
      const formattedModules = modules.map(module => ({
        ...module,
        allowed_groups: Module.parseAllowedGroups(module.allowed_groups)
      }));
      
      return ResponseHelper.success(res, formattedModules);
    } catch (error) {
      console.error('获取模块列表失败:', error);
      return ResponseHelper.error(res, '获取模块列表失败');
    }
  }

  /**
   * 获取单个模块
   */
  static async getModule(req, res) {
    try {
      const { id } = req.params;
      const module = await Module.findById(id);
      
      if (!module) {
        return ResponseHelper.notFound(res, '模块不存在');
      }
      
      // 解析JSON字段
      module.allowed_groups = Module.parseAllowedGroups(module.allowed_groups);
      
      return ResponseHelper.success(res, module);
    } catch (error) {
      console.error('获取模块详情失败:', error);
      return ResponseHelper.error(res, '获取模块详情失败');
    }
  }

  /**
   * 获取用户可访问的模块
   */
  static async getUserModules(req, res) {
    try {
      const { id: userId, group_id: userGroupId } = req.user;
      
      const modules = await Module.findAccessibleModules(userId, userGroupId);
      
      return ResponseHelper.success(res, modules);
    } catch (error) {
      console.error('获取用户模块失败:', error);
      return ResponseHelper.error(res, '获取用户模块失败');
    }
  }
  
  /**
   * 获取模块的认证访问URL
   */
  static async getModuleAuthUrl(req, res) {
    try {
      const { id: moduleId } = req.params;
      const { id: userId, group_id: userGroupId } = req.user;
      
      // 获取模块信息
      const module = await Module.findById(moduleId);
      if (!module) {
        return ResponseHelper.notFound(res, '模块不存在');
      }
      
      // 检查用户是否有权限访问该模块
      const accessibleModules = await Module.findAccessibleModules(userId, userGroupId);
      const hasAccess = accessibleModules.some(m => m.id === parseInt(moduleId));
      
      if (!hasAccess) {
        return ResponseHelper.forbidden(res, '您没有权限访问此模块');
      }
      
      // 如果模块不需要认证，直接返回原始URL
      if (module.auth_mode === 'none' || !module.auth_mode) {
        return ResponseHelper.success(res, {
          url: module.module_url,
          method: 'GET',
          requiresAuth: false
        });
      }
      
      // 如果是JWT认证
      if (module.auth_mode === 'jwt' && module.config && module.config.auth) {
        try {
          // 生成JWT Token
          const token = JWTService.generateModuleToken(req.user, module.config.auth);
          
          // 构建认证URL
          const authInfo = JWTService.buildAuthenticatedUrl(
            module.module_url,
            token,
            module.config.auth
          );
          
          logger.info('生成模块认证URL', {
            userId,
            moduleId,
            moduleName: module.name,
            authMode: module.auth_mode,
            tokenMethod: module.config.auth.tokenMethod
          });
          
          return ResponseHelper.success(res, {
            ...authInfo,
            requiresAuth: true,
            authMode: module.auth_mode,
            openMode: module.open_mode
          });
        } catch (error) {
          logger.error('生成JWT认证失败:', error);
          return ResponseHelper.error(res, '生成认证信息失败');
        }
      }
      
      // 其他认证方式暂不支持
      return ResponseHelper.error(res, '不支持的认证方式');
      
    } catch (error) {
      console.error('获取模块认证URL失败:', error);
      return ResponseHelper.error(res, '获取模块认证URL失败');
    }
  }

  /**
   * 创建模块
   */
  static async createModule(req, res) {
    try {
      const {
        name,
        display_name,
        description,
        module_url,
        open_mode,
        menu_icon,
        is_active,
        sort_order,
        allowed_groups,
        auth_mode,
        config
      } = req.body;

      // 验证必填字段
      if (!name || !display_name || !module_url) {
        return ResponseHelper.validation(res, {
          name: !name ? '模块标识不能为空' : null,
          display_name: !display_name ? '显示名称不能为空' : null,
          module_url: !module_url ? '模块URL不能为空' : null
        }, '请填写必填字段');
      }

      // 检查名称是否已存在
      const existingModule = await Module.findByName(name);
      if (existingModule) {
        return ResponseHelper.validation(res, {
          name: '模块标识已存在'
        }, '模块标识已存在');
      }

      // 创建模块
      const moduleId = await Module.create({
        name,
        display_name,
        description,
        module_url,
        open_mode,
        menu_icon,
        is_active: is_active !== undefined ? is_active : 1,
        sort_order: sort_order || 0,
        allowed_groups,
        auth_mode: auth_mode || 'none',
        config
      });

      if (moduleId) {
        const newModule = await Module.findById(moduleId);
        if (newModule) {
          newModule.allowed_groups = Module.parseAllowedGroups(newModule.allowed_groups);
          return ResponseHelper.success(res, newModule, '模块创建成功');
        }
      }
      
      return ResponseHelper.error(res, '创建模块失败');
    } catch (error) {
      console.error('创建模块失败:', error);
      return ResponseHelper.error(res, '创建模块失败');
    }
  }

  /**
   * 更新模块
   */
  static async updateModule(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;

      // 检查模块是否存在
      const module = await Module.findById(id);
      if (!module) {
        return ResponseHelper.notFound(res, '模块不存在');
      }

      // 更新模块
      const success = await Module.update(id, updateData);
      
      if (!success) {
        return ResponseHelper.error(res, '更新失败');
      }

      const updatedModule = await Module.findById(id);
      if (updatedModule) {
        updatedModule.allowed_groups = Module.parseAllowedGroups(updatedModule.allowed_groups);
      }
      
      return ResponseHelper.success(res, updatedModule, '模块更新成功');
    } catch (error) {
      console.error('更新模块失败:', error);
      return ResponseHelper.error(res, '更新模块失败');
    }
  }

  /**
   * 删除模块
   */
  static async deleteModule(req, res) {
    try {
      const { id } = req.params;

      // 检查模块是否存在
      const module = await Module.findById(id);
      if (!module) {
        return ResponseHelper.notFound(res, '模块不存在');
      }

      // 删除模块
      const success = await Module.delete(id);
      
      if (!success) {
        return ResponseHelper.error(res, '删除失败');
      }

      return ResponseHelper.success(res, null, '模块删除成功');
    } catch (error) {
      console.error('删除模块失败:', error);
      return ResponseHelper.error(res, '删除模块失败');
    }
  }

  /**
   * 切换模块状态
   */
  static async toggleModuleStatus(req, res) {
    try {
      const { id } = req.params;

      // 检查模块是否存在
      const module = await Module.findById(id);
      if (!module) {
        return ResponseHelper.notFound(res, '模块不存在');
      }

      // 切换状态
      const success = await Module.toggleStatus(id);
      
      if (!success) {
        return ResponseHelper.error(res, '操作失败');
      }

      const updatedModule = await Module.findById(id);
      if (updatedModule) {
        updatedModule.allowed_groups = Module.parseAllowedGroups(updatedModule.allowed_groups);
      }
      
      return ResponseHelper.success(res, updatedModule, '状态更新成功');
    } catch (error) {
      console.error('切换模块状态失败:', error);
      return ResponseHelper.error(res, '操作失败');
    }
  }

  /**
   * 模块健康检查（暂时返回固定值）
   */
  static async checkModuleHealth(req, res) {
    try {
      const { id } = req.params;

      const module = await Module.findById(id);
      if (!module) {
        return ResponseHelper.notFound(res, '模块不存在');
      }

      // 暂时返回固定的健康状态
      return ResponseHelper.success(res, {
        moduleId: id,
        status: 'online',
        message: '模块运行正常'
      });
    } catch (error) {
      console.error('健康检查失败:', error);
      return ResponseHelper.error(res, '健康检查失败');
    }
  }
}

module.exports = ModuleController;

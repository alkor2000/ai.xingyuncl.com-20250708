/**
 * 系统模块控制器 - 支持系统内置模块和外部模块管理
 */

const Module = require('../../models/Module');
const ResponseHelper = require('../../utils/response');
const JWTService = require('../../services/jwtService');
const logger = require('../../utils/logger');
const CacheService = require('../../services/cacheService');

class ModuleController {
  /**
   * 获取所有模块（管理员接口）
   */
  static async getModules(req, res) {
    try {
      const modules = await Module.findAll();
      
      // 解析JSON字段并标记模块类型
      const formattedModules = modules.map(module => ({
        ...module,
        allowed_groups: Module.parseAllowedGroups(module.allowed_groups),
        // 添加编辑权限标记
        can_edit: module.module_category === 'external' || 
                  (module.module_category === 'system' && module.can_disable),
        can_delete: module.module_category === 'external',
        can_toggle: module.can_disable
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
      module.can_edit = module.module_category === 'external' || 
                       (module.module_category === 'system' && module.can_disable);
      module.can_delete = module.module_category === 'external';
      module.can_toggle = module.can_disable;
      
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
      const { id: userId, group_id: userGroupId, role: userRole } = req.user;
      
      // 传递用户角色给Model，以便处理超级管理员的特殊权限
      const modules = await Module.findAccessibleModules(userId, userGroupId, userRole);
      
      // 过滤并格式化模块信息
      const formattedModules = modules.map(module => ({
        id: module.id,
        name: module.name,
        display_name: module.display_name,
        description: module.description,
        module_category: module.module_category,
        module_url: module.module_url,
        route_path: module.route_path,
        access_url: module.access_url,
        open_mode: module.open_mode,
        menu_icon: module.menu_icon,
        auth_mode: module.auth_mode,
        sort_order: module.sort_order,
        is_active: module.is_active
      }));
      
      return ResponseHelper.success(res, formattedModules);
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
      const { id: userId, group_id: userGroupId, role: userRole } = req.user;
      
      // 获取模块信息
      const module = await Module.findById(moduleId);
      if (!module) {
        return ResponseHelper.notFound(res, '模块不存在');
      }
      
      // 系统模块不需要认证，直接返回路由路径
      if (module.module_category === 'system') {
        return ResponseHelper.success(res, {
          url: module.route_path || module.module_url,
          method: 'GET',
          requiresAuth: false,
          isSystemModule: true
        });
      }
      
      // 检查用户是否有权限访问该模块
      const accessibleModules = await Module.findAccessibleModules(userId, userGroupId, userRole);
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
   * 创建模块（只能创建外部模块）
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
          // 清除相关缓存
      await CacheService.clearCacheByType(CacheService.CACHE_KEYS.SYSTEM_MODULES);


          return ResponseHelper.success(res, newModule, '模块创建成功');
        }
      }
      
      return ResponseHelper.error(res, '创建模块失败');
    } catch (error) {
      console.error('创建模块失败:', error);
      
      // 处理特殊错误消息
      if (error.message === '不能创建系统预设模块') {
        return ResponseHelper.validation(res, {
          name: '该名称为系统保留名称，请使用其他名称'
        }, error.message);
      }
      
      return ResponseHelper.error(res, error.message || '创建模块失败');
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
      
      // 清除相关缓存
      await CacheService.clearCacheByType(CacheService.CACHE_KEYS.SYSTEM_MODULES);


      
      return ResponseHelper.success(res, updatedModule, '模块更新成功');
    } catch (error) {
      console.error('更新模块失败:', error);
      
      // 处理特殊错误消息
      if (error.message === '核心管理模块不能禁用') {
        return ResponseHelper.validation(res, {
          is_active: '核心管理模块必须保持启用状态'
        }, error.message);
      }
      
      return ResponseHelper.error(res, error.message || '更新模块失败');
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

      // 清除相关缓存
      await CacheService.clearCacheByType(CacheService.CACHE_KEYS.SYSTEM_MODULES);



      return ResponseHelper.success(res, null, '模块删除成功');
    } catch (error) {
      console.error('删除模块失败:', error);
      
      // 处理特殊错误消息
      if (error.message === '系统内置模块不能删除') {
        return ResponseHelper.forbidden(res, error.message);
      }
      
      return ResponseHelper.error(res, error.message || '删除模块失败');
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
      
      // 处理特殊错误消息
      if (error.message === '核心管理模块不能禁用') {
        return ResponseHelper.forbidden(res, error.message);
      }
      
      return ResponseHelper.error(res, error.message || '操作失败');
    }
  }

  /**
   * 模块健康检查
   */
  static async checkModuleHealth(req, res) {
    try {
      const { id } = req.params;

      const module = await Module.findById(id);
      if (!module) {
        return ResponseHelper.notFound(res, '模块不存在');
      }

      // 系统模块始终返回在线状态
      if (module.module_category === 'system') {
        return ResponseHelper.success(res, {
          moduleId: id,
          moduleName: module.name,
          moduleCategory: module.module_category,
          status: 'online',
          message: '系统内置模块运行正常'
        });
      }

      // 外部模块暂时返回固定的健康状态
      // TODO: 实现真实的健康检查逻辑
      return ResponseHelper.success(res, {
        moduleId: id,
        moduleName: module.name,
        moduleCategory: module.module_category,
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

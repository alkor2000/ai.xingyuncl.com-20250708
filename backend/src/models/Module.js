/**
 * 系统模块模型 - 支持系统内置模块和外部模块
 */

const dbConnection = require('../database/connection');
const logger = require('../utils/logger');
const crypto = require('crypto');

class Module {
  /**
   * 获取所有模块（包括系统模块和外部模块）
   */
  static async findAll() {
    const query = `
      SELECT id, name, display_name, description, module_type, module_category,
             module_url, route_path, open_mode, menu_icon, is_active, can_disable,
             sort_order, allowed_groups, auth_mode, config, created_at, updated_at
      FROM system_modules 
      ORDER BY module_category ASC, sort_order ASC, id ASC
    `;
    const result = await dbConnection.query(query);
    
    // 解析JSON字段并解密配置
    const modules = result.rows.map(module => ({
      ...module,
      allowed_groups: Module.parseAllowedGroups(module.allowed_groups),
      config: Module.decryptConfig(module.config)
    }));
    
    return modules;
  }

  /**
   * 根据ID获取模块
   */
  static async findById(id) {
    const query = `
      SELECT id, name, display_name, description, module_type, module_category,
             module_url, route_path, open_mode, menu_icon, is_active, can_disable,
             sort_order, allowed_groups, auth_mode, config, created_at, updated_at
      FROM system_modules WHERE id = ?
    `;
    const result = await dbConnection.query(query, [id]);
    const module = result.rows[0];
    
    if (module) {
      module.allowed_groups = Module.parseAllowedGroups(module.allowed_groups);
      module.config = Module.decryptConfig(module.config);
    }
    
    return module;
  }

  /**
   * 根据name获取模块
   */
  static async findByName(name) {
    const query = `
      SELECT id, name, display_name, description, module_type, module_category,
             module_url, route_path, open_mode, menu_icon, is_active, can_disable,
             sort_order, allowed_groups, auth_mode, config, created_at, updated_at
      FROM system_modules WHERE name = ?
    `;
    const result = await dbConnection.query(query, [name]);
    const module = result.rows[0];
    
    if (module) {
      module.allowed_groups = Module.parseAllowedGroups(module.allowed_groups);
      module.config = Module.decryptConfig(module.config);
    }
    
    return module;
  }

  /**
   * 获取用户可访问的模块
   * @param {number} userId - 用户ID
   * @param {number} userGroupId - 用户组ID
   * @param {string} userRole - 用户角色
   */
  static async findAccessibleModules(userId, userGroupId, userRole) {
    logger.info(`查询用户可访问模块 - userId: ${userId}, groupId: ${userGroupId}, role: ${userRole}`);
    
    // 超级管理员强制可以访问管理模块
    let query;
    let params;
    
    if (userRole === 'super_admin') {
      // 超级管理员：获取所有激活的模块 + 管理模块（即使被禁用）
      query = `
        SELECT id, name, display_name, description, module_type, module_category,
               module_url, route_path, open_mode, menu_icon, is_active, can_disable,
               sort_order, allowed_groups, auth_mode, config
        FROM system_modules 
        WHERE (is_active = 1 OR name IN ('admin_users', 'admin_settings'))
        ORDER BY module_category ASC, sort_order ASC, id ASC
      `;
      params = [];
    } else {
      // 其他用户：只获取激活的且有权限的模块
      query = `
        SELECT id, name, display_name, description, module_type, module_category,
               module_url, route_path, open_mode, menu_icon, is_active, can_disable,
               sort_order, allowed_groups, auth_mode, config
        FROM system_modules 
        WHERE is_active = 1 
          AND (
            allowed_groups IS NULL 
            OR JSON_CONTAINS(allowed_groups, CAST(? AS JSON), '$')
          )
        ORDER BY module_category ASC, sort_order ASC, id ASC
      `;
      params = [userGroupId];
    }
    
    const result = await dbConnection.query(query, params);
    
    // 解析JSON字段并解密配置
    const modules = result.rows.map(module => ({
      ...module,
      allowed_groups: Module.parseAllowedGroups(module.allowed_groups),
      config: Module.decryptConfig(module.config),
      // 添加实际访问URL（系统模块用route_path，外部模块用module_url）
      access_url: module.module_category === 'system' ? module.route_path : module.module_url
    }));
    
    logger.info(`查询到 ${modules.length} 个可访问模块`);
    
    return modules;
  }

  /**
   * 创建模块（只能创建外部模块）
   */
  static async create(moduleData) {
    const {
      name,
      display_name,
      description,
      module_url,
      open_mode = 'new_tab',
      menu_icon = 'AppstoreOutlined',
      is_active = 1,
      sort_order = 0,
      allowed_groups = null,
      auth_mode = 'none',
      config = null
    } = moduleData;

    // 检查是否尝试创建系统模块
    if (['dashboard', 'chat', 'knowledge', 'admin_users', 'admin_settings'].includes(name)) {
      throw new Error('不能创建系统预设模块');
    }

    // 构建allowed_groups的JSON值
    let allowedGroupsValue = null;
    if (allowed_groups && Array.isArray(allowed_groups) && allowed_groups.length > 0) {
      allowedGroupsValue = JSON.stringify(allowed_groups);
    }
    
    // 加密并构建config的JSON值
    let configValue = null;
    if (config && typeof config === 'object') {
      configValue = Module.encryptConfig(config);
    }

    const query = `
      INSERT INTO system_modules 
      (name, display_name, description, module_type, module_category, module_url, 
       open_mode, menu_icon, is_active, can_disable, sort_order, allowed_groups, 
       proxy_path, auth_mode, config)
      VALUES (?, ?, ?, 'fullstack', 'external', ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
    `;
    
    const result = await dbConnection.query(query, [
      name,
      display_name,
      description,
      module_url,
      open_mode,
      menu_icon,
      is_active,
      sort_order,
      allowedGroupsValue,
      `/${name}`,
      auth_mode,
      configValue
    ]);

    return result.rows.insertId;
  }

  /**
   * 更新模块
   */
  static async update(id, updateData) {
    // 先获取模块信息，检查是否是系统模块
    const module = await Module.findById(id);
    if (!module) {
      throw new Error('模块不存在');
    }

    // 系统模块的限制
    if (module.module_category === 'system') {
      // 系统模块基础可修改字段：display_name, description, menu_icon, allowed_groups
      const systemAllowedFields = ['display_name', 'description', 'menu_icon', 'allowed_groups'];
      
      // ✅ 修复：非核心系统模块可以修改sort_order
      if (module.can_disable) {
        systemAllowedFields.push('sort_order');
      }
      
      const fields = [];
      const values = [];

      for (const field of systemAllowedFields) {
        if (updateData.hasOwnProperty(field)) {
          // 核心管理模块不能修改权限组
          if (field === 'allowed_groups' && !module.can_disable) {
            continue; // 跳过权限组修改
          }
          
          fields.push(`${field} = ?`);
          if (field === 'allowed_groups') {
            if (updateData[field] === null || 
                (Array.isArray(updateData[field]) && updateData[field].length === 0)) {
              values.push(null);
            } else if (Array.isArray(updateData[field])) {
              values.push(JSON.stringify(updateData[field]));
            } else {
              values.push(updateData[field]);
            }
          } else {
            values.push(updateData[field]);
          }
        }
      }

      // 核心管理模块不能禁用
      if (updateData.hasOwnProperty('is_active') && !module.can_disable && updateData.is_active === 0) {
        throw new Error('核心管理模块不能禁用');
      }

      // 非核心系统模块可以修改is_active
      if (updateData.hasOwnProperty('is_active') && module.can_disable) {
        fields.push('is_active = ?');
        values.push(updateData.is_active);
      }

      if (fields.length === 0) {
        return false;
      }

      values.push(id);
      const query = `UPDATE system_modules SET ${fields.join(', ')} WHERE id = ?`;
      const result = await dbConnection.query(query, values);
      return result.rows.affectedRows > 0;

    } else {
      // 外部模块可以修改所有允许的字段
      const allowedFields = [
        'display_name', 'description', 'module_url', 'open_mode',
        'menu_icon', 'is_active', 'sort_order', 'allowed_groups',
        'auth_mode', 'config'
      ];

      const fields = [];
      const values = [];

      for (const field of allowedFields) {
        if (updateData.hasOwnProperty(field)) {
          fields.push(`${field} = ?`);
          if (field === 'allowed_groups') {
            if (updateData[field] === null || 
                (Array.isArray(updateData[field]) && updateData[field].length === 0)) {
              values.push(null);
            } else if (Array.isArray(updateData[field])) {
              values.push(JSON.stringify(updateData[field]));
            } else {
              values.push(updateData[field]);
            }
          } else if (field === 'config') {
            if (updateData[field] && typeof updateData[field] === 'object') {
              values.push(Module.encryptConfig(updateData[field]));
            } else {
              values.push(updateData[field]);
            }
          } else {
            values.push(updateData[field]);
          }
        }
      }

      if (fields.length === 0) {
        return false;
      }

      values.push(id);
      const query = `UPDATE system_modules SET ${fields.join(', ')} WHERE id = ?`;
      const result = await dbConnection.query(query, values);
      return result.rows.affectedRows > 0;
    }
  }

  /**
   * 删除模块（只能删除外部模块）
   */
  static async delete(id) {
    // 先获取模块信息
    const module = await Module.findById(id);
    if (!module) {
      throw new Error('模块不存在');
    }

    // 系统模块不能删除
    if (module.module_category === 'system') {
      throw new Error('系统内置模块不能删除');
    }

    const query = `DELETE FROM system_modules WHERE id = ?`;
    const result = await dbConnection.query(query, [id]);
    return result.rows.affectedRows > 0;
  }

  /**
   * 切换模块状态
   */
  static async toggleStatus(id) {
    // 先获取模块信息
    const module = await Module.findById(id);
    if (!module) {
      throw new Error('模块不存在');
    }

    // 检查是否可以禁用
    if (!module.can_disable && module.is_active) {
      throw new Error('核心管理模块不能禁用');
    }

    const query = `UPDATE system_modules SET is_active = NOT is_active WHERE id = ?`;
    const result = await dbConnection.query(query, [id]);
    return result.rows.affectedRows > 0;
  }

  /**
   * 解析allowed_groups字段
   */
  static parseAllowedGroups(allowedGroups) {
    if (!allowedGroups) return [];
    
    try {
      if (Array.isArray(allowedGroups)) {
        return allowedGroups;
      }
      
      if (typeof allowedGroups === 'string') {
        return JSON.parse(allowedGroups);
      }
      
      return [];
    } catch (e) {
      console.error('解析allowed_groups失败:', allowedGroups, e);
      return [];
    }
  }
  
  /**
   * 加密配置信息
   */
  static encryptConfig(config) {
    if (!config || typeof config !== 'object') return null;
    
    const configCopy = JSON.parse(JSON.stringify(config));
    
    if (configCopy.auth && configCopy.auth.secret) {
      const algorithm = 'aes-256-cbc';
      const key = crypto.scryptSync(process.env.JWT_ACCESS_SECRET || 'default-encryption-key', 'salt', 32);
      const iv = crypto.randomBytes(16);
      
      const cipher = crypto.createCipheriv(algorithm, key, iv);
      let encrypted = cipher.update(configCopy.auth.secret, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      configCopy.auth.secret = {
        encrypted: true,
        data: encrypted,
        iv: iv.toString('hex')
      };
    }
    
    return JSON.stringify(configCopy);
  }
  
  /**
   * 解密配置信息
   */
  static decryptConfig(configStr) {
    if (!configStr) return null;
    
    try {
      const config = typeof configStr === 'string' ? JSON.parse(configStr) : configStr;
      
      if (config.auth && config.auth.secret && config.auth.secret.encrypted) {
        const algorithm = 'aes-256-cbc';
        const key = crypto.scryptSync(process.env.JWT_ACCESS_SECRET || 'default-encryption-key', 'salt', 32);
        const iv = Buffer.from(config.auth.secret.iv, 'hex');
        
        const decipher = crypto.createDecipheriv(algorithm, key, iv);
        let decrypted = decipher.update(config.auth.secret.data, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        config.auth.secret = decrypted;
      }
      
      return config;
    } catch (e) {
      console.error('解密config失败:', e);
      return null;
    }
  }
}

module.exports = Module;

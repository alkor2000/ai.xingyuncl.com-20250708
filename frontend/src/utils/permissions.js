/**
 * 权限配置文件
 * 定义不同角色的权限和限制
 */

// 角色定义
export const ROLES = {
  SUPER_ADMIN: 'super_admin',  // 超级管理员
  ADMIN: 'admin',              // 组管理员
  USER: 'user'                 // 普通用户
}

// 权限定义
export const PERMISSIONS = {
  // 系统管理权限
  SYSTEM: {
    VIEW_ALL: 'system.view.all',         // 查看所有系统信息
    VIEW_LIMITED: 'system.view.limited', // 查看受限系统信息
    MANAGE_ALL: 'system.manage.all',     // 管理所有系统设置
    MANAGE_LIMITED: 'system.manage.limited' // 管理受限系统设置
  },
  
  // AI模型权限
  AI_MODEL: {
    VIEW_FULL: 'ai_model.view.full',     // 查看完整模型信息（包括API密钥）
    VIEW_LIMITED: 'ai_model.view.limited', // 查看受限模型信息
    MANAGE: 'ai_model.manage',           // 管理模型
    TEST: 'ai_model.test'                // 测试模型
  },
  
  // 用户管理权限
  USER: {
    VIEW_ALL: 'user.view.all',           // 查看所有用户
    VIEW_GROUP: 'user.view.group',       // 只查看组内用户
    MANAGE_ALL: 'user.manage.all',       // 管理所有用户
    MANAGE_GROUP: 'user.manage.group'     // 只管理组内用户
  },
  
  // 积分管理权限
  CREDITS: {
    VIEW_ALL: 'credits.view.all',        // 查看所有积分
    VIEW_GROUP: 'credits.view.group',    // 只查看组内积分
    MANAGE_ALL: 'credits.manage.all',    // 管理所有积分
    MANAGE_GROUP: 'credits.manage.group'  // 只管理组内积分
  }
}

// 角色权限映射
export const ROLE_PERMISSIONS = {
  [ROLES.SUPER_ADMIN]: [
    'system.*',      // 所有系统权限
    'ai_model.*',    // 所有AI模型权限
    'user.*',        // 所有用户权限
    'credits.*'      // 所有积分权限
  ],
  
  [ROLES.ADMIN]: [
    PERMISSIONS.SYSTEM.VIEW_LIMITED,
    PERMISSIONS.SYSTEM.MANAGE_LIMITED,
    PERMISSIONS.AI_MODEL.VIEW_LIMITED,
    PERMISSIONS.AI_MODEL.TEST,
    PERMISSIONS.USER.VIEW_GROUP,
    PERMISSIONS.USER.MANAGE_GROUP,
    PERMISSIONS.CREDITS.VIEW_GROUP,
    PERMISSIONS.CREDITS.MANAGE_GROUP
  ],
  
  [ROLES.USER]: [
    'chat.use'       // 使用聊天功能
  ]
}

// AI模型字段权限配置
export const AI_MODEL_FIELD_PERMISSIONS = {
  // 超级管理员可以看到所有字段
  [ROLES.SUPER_ADMIN]: {
    name: { visible: true, editable: true },
    display_name: { visible: true, editable: true },
    api_key: { visible: true, editable: true },
    api_endpoint: { visible: true, editable: true },
    credits_per_chat: { visible: true, editable: true },
    stream_enabled: { visible: true, editable: true },
    image_upload_enabled: { visible: true, editable: true },
    is_active: { visible: true, editable: true }
  },
  
  // 组管理员的字段权限
  [ROLES.ADMIN]: {
    name: { visible: false, editable: false },              // 不能看到真实模型名
    display_name: { visible: true, editable: false },       // 可以看到显示名但不能编辑
    api_key: { visible: false, editable: false },           // 不能看到API密钥
    api_endpoint: { visible: false, editable: false },      // 不能看到API端点
    credits_per_chat: { visible: true, editable: false },   // 可以看到积分但不能编辑
    stream_enabled: { visible: true, editable: false },     // 可以看到流式状态但不能编辑
    image_upload_enabled: { visible: true, editable: false }, // 可以看到图片上传状态但不能编辑
    is_active: { visible: true, editable: false }           // 可以看到激活状态但不能编辑
  }
}

// 检查用户是否有某个权限
export const hasPermission = (userRole, permission) => {
  const rolePermissions = ROLE_PERMISSIONS[userRole] || []
  
  return rolePermissions.some(p => {
    // 精确匹配
    if (p === permission) return true
    
    // 通配符匹配
    if (p.endsWith('*')) {
      const prefix = p.slice(0, -1)
      return permission.startsWith(prefix)
    }
    
    return false
  })
}

// 获取用户对某个字段的权限
export const getFieldPermission = (userRole, fieldName) => {
  const fieldPermissions = AI_MODEL_FIELD_PERMISSIONS[userRole] || {}
  return fieldPermissions[fieldName] || { visible: false, editable: false }
}

// 判断是否为组管理员
export const isGroupAdmin = (userRole) => {
  return userRole === ROLES.ADMIN
}

// 判断是否为超级管理员
export const isSuperAdmin = (userRole) => {
  return userRole === ROLES.SUPER_ADMIN
}

/**
 * 权限类型常量定义
 * 
 * @module constants/permissionTypes
 */

/**
 * 权限级别枚举
 * 
 * 三级权限体系：
 * - Level 1: VIEW_LESSON（查看课程）- 学生权限
 * - Level 2: VIEW_PLAN（查看教案）- 教师权限
 * - Level 3: EDIT（编辑）- 完全控制
 */
export const PERMISSION_LEVELS = {
  VIEW_LESSON: 'view_lesson',
  VIEW_PLAN: 'view_plan',
  EDIT: 'edit'
};

/**
 * 权限级别顺序（用于级联判断）
 * 
 * 数值越大权限越高
 */
export const PERMISSION_LEVEL_ORDER = {
  [PERMISSION_LEVELS.VIEW_LESSON]: 1,
  [PERMISSION_LEVELS.VIEW_PLAN]: 2,
  [PERMISSION_LEVELS.EDIT]: 3
};

/**
 * 权限显示名称（中文）
 */
export const PERMISSION_NAMES = {
  [PERMISSION_LEVELS.VIEW_LESSON]: '查看课程',
  [PERMISSION_LEVELS.VIEW_PLAN]: '查看教案',
  [PERMISSION_LEVELS.EDIT]: '编辑权限'
};

/**
 * 权限图标映射
 */
export const PERMISSION_ICONS = {
  [PERMISSION_LEVELS.VIEW_LESSON]: 'ReadOutlined',
  [PERMISSION_LEVELS.VIEW_PLAN]: 'FileTextOutlined',
  [PERMISSION_LEVELS.EDIT]: 'EditOutlined'
};

/**
 * 权限颜色映射（Ant Design Tag颜色）
 */
export const PERMISSION_COLORS = {
  [PERMISSION_LEVELS.VIEW_LESSON]: 'cyan',
  [PERMISSION_LEVELS.VIEW_PLAN]: 'blue',
  [PERMISSION_LEVELS.EDIT]: 'purple'
};

/**
 * 权限描述（用于提示）
 */
export const PERMISSION_DESCRIPTIONS = {
  [PERMISSION_LEVELS.VIEW_LESSON]: '学生权限 - 查看课程内容',
  [PERMISSION_LEVELS.VIEW_PLAN]: '教师权限 - 查看课程+教案',
  [PERMISSION_LEVELS.EDIT]: '完全控制 - 查看课程+教案+编辑'
};

/**
 * 级联规则：授予高级权限时自动授予的下级权限
 */
export const PERMISSION_CASCADE_GRANT = {
  [PERMISSION_LEVELS.VIEW_LESSON]: [],
  [PERMISSION_LEVELS.VIEW_PLAN]: [PERMISSION_LEVELS.VIEW_LESSON],
  [PERMISSION_LEVELS.EDIT]: [PERMISSION_LEVELS.VIEW_LESSON, PERMISSION_LEVELS.VIEW_PLAN]
};

/**
 * 级联规则：撤销低级权限时自动撤销的上级权限
 */
export const PERMISSION_CASCADE_REVOKE = {
  [PERMISSION_LEVELS.VIEW_LESSON]: [PERMISSION_LEVELS.VIEW_PLAN, PERMISSION_LEVELS.EDIT],
  [PERMISSION_LEVELS.VIEW_PLAN]: [PERMISSION_LEVELS.EDIT],
  [PERMISSION_LEVELS.EDIT]: []
};

/**
 * UI提示文案常量
 * 
 * @module constants/uiMessages
 */

/**
 * 成功提示文案
 */
export const SUCCESS_MESSAGES = {
  SAVE: '授权配置保存成功',
  ADD_GROUPS: (count) => `已添加 ${count} 个用户组`,
  REMOVE_GROUP: '已移除用户组授权',
  COPY_PERMISSIONS: '已将上级权限复制到当前配置，您现在可以独立修改',
  RESET: '已重置为上次保存的状态'
};

/**
 * 错误提示文案
 */
export const ERROR_MESSAGES = {
  LOAD_DATA: '加载数据失败',
  LOAD_GROUPS: '获取分组列表失败',
  LOAD_MODULES: '获取全部模块失败',
  LOAD_LESSONS: '加载课程列表失败',
  LOAD_TAGS: '加载标签失败',
  LOAD_USERS: '加载用户列表失败',
  LOAD_AUTH: '加载授权配置失败',
  SAVE: '保存授权配置失败',
  INVALID_DATA: '数据格式错误'
};

/**
 * 警告提示文案
 */
export const WARNING_MESSAGES = {
  SELECT_GROUP: '请选择至少一个用户组',
  UNSAVED_CHANGES: '有未保存的更改',
  NO_PERMISSION: '权限不足'
};

/**
 * 确认对话框文案
 */
export const CONFIRM_MESSAGES = {
  REMOVE_GROUP: {
    title: '确认移除授权',
    content: '移除此用户组将删除其所有授权配置，确定继续吗？',
    okText: '确认',
    cancelText: '取消'
  },
  RESET: {
    title: '确认重置',
    content: '重置将放弃所有未保存的更改，确定继续吗？',
    okText: '确认',
    cancelText: '取消'
  }
};

/**
 * 空状态提示文案
 */
export const EMPTY_MESSAGES = {
  NO_GROUPS: '当前还未配置任何授权',
  NO_GROUPS_DESC: '点击上方"新建授权"按钮开始添加授权',
  NO_MODULES: '暂无可授权的模块',
  NO_TAGS: '该组织暂无标签',
  NO_USERS: '该标签暂无用户',
  NO_LESSONS: '该模块暂无课程',
  NO_GROUPS_AVAILABLE: '暂无用户组'
};

/**
 * 加载中提示文案
 */
export const LOADING_MESSAGES = {
  LOADING_DATA: '加载授权配置...',
  LOADING_MODULE: '加载模块中...',
  SAVING: '保存中...'
};

/**
 * 按钮文案
 */
export const BUTTON_TEXTS = {
  NEW_AUTH: '新建授权',
  REFRESH: '刷新',
  RESET: '重置',
  SAVE: '保存所有更改',
  EXPAND_TAGS: '展开标签列表',
  COLLAPSE_TAGS: '收起标签列表',
  EXPAND_USERS: (count) => `展开用户列表 (${count}人)`,
  COLLAPSE_USERS: (count) => `收起用户列表 (${count}人)`,
  EXPAND_LESSONS: '展开课程',
  REMOVE_AUTH: '移除授权'
};

/**
 * 标签文案
 */
export const TAG_TEXTS = {
  INHERITED: '继承',
  INDEPENDENT: '独立配置',
  INHERIT_FROM_MODULE: '继承自模块',
  EXPLICIT_DENY: '无权限',
  DEFAULT_GROUP: '默认组'
};

/**
 * 权限说明文案
 */
export const HELP_TEXTS = {
  THREE_LEVEL_TITLE: '三级权限体系说明',
  THREE_LEVEL_DESC: [
    'Level 1 - 查看课程：学生权限，仅能查看课程内容',
    'Level 2 - 查看教案：教师权限，可查看课程+教案',
    'Level 3 - 编辑权限：完全控制，可查看课程+教案+编辑'
  ],
  CASCADE_RULE: '💡 级联规则：授予高级权限自动授予下级，撤销低级权限自动撤销上级',
  INHERIT_RULE: '🔄 继承逻辑：取消继承时自动复制上级权限，保持权限连续性'
};

/**
 * 知识库控制器 v2.1
 * 
 * 功能：
 * - 知识库CRUD操作
 * - 版本管理（创建、历史、删除、回滚）
 * - 编辑者管理（添加、移除）
 * - 权限控制（三级范围：personal/team/global）
 * 
 * 权限规则：
 * - personal: 只有创建者可以访问和编辑
 * - team: 同组成员可以查看，组管理员和指定编辑者可以编辑
 * - global: 所有人可以查看，只有超级管理员可以编辑
 * 
 * 更新：2026-01-02 v2.1 修复updateItem返回can_edit丢失问题
 */

const WikiItem = require('../models/WikiItem');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');

/**
 * 获取知识库列表
 */
const getItems = async (req, res) => {
  try {
    const userId = req.user.id;
    const groupId = req.user.group_id;
    const userRole = req.user.role;
    const { scope } = req.query;
    
    const items = await WikiItem.getUserAccessibleItems(userId, groupId, userRole, scope);
    
    // 返回简化的列表数据（不包含content以减少传输）
    const listData = items.map(item => ({
      id: item.id,
      title: item.title,
      description: item.description,
      scope: item.scope,
      creator_id: item.creator_id,
      creator_name: item.creator_name,
      group_id: item.group_id,
      group_name: item.group_name,
      is_pinned: item.is_pinned,
      current_version: item.current_version,
      can_edit: item.can_edit,
      created_at: item.created_at,
      updated_at: item.updated_at
    }));
    
    return ResponseHelper.success(res, listData, '获取知识库列表成功');
  } catch (error) {
    logger.error('获取知识库列表失败:', error);
    return ResponseHelper.error(res, error.message || '获取知识库列表失败');
  }
};

/**
 * 获取知识库详情
 */
const getItem = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const groupId = req.user.group_id;
    const userRole = req.user.role;
    
    const { hasAccess, canEdit, item } = await WikiItem.checkAccess(id, userId, groupId, userRole);
    
    if (!item) {
      return ResponseHelper.notFound(res, '知识库不存在');
    }
    
    if (!hasAccess) {
      return ResponseHelper.forbidden(res, '无权访问此知识库');
    }
    
    // 重新获取完整详情（包含can_edit）
    const fullItem = await WikiItem.findById(id, userId, groupId, userRole);
    fullItem.can_edit = canEdit;
    
    return ResponseHelper.success(res, fullItem.toJSON(), '获取知识库详情成功');
  } catch (error) {
    logger.error('获取知识库详情失败:', error);
    return ResponseHelper.error(res, error.message || '获取知识库详情失败');
  }
};

/**
 * 创建知识库
 */
const createItem = async (req, res) => {
  try {
    const userId = req.user.id;
    const groupId = req.user.group_id;
    const userRole = req.user.role;
    const data = req.body;
    
    // 权限检查
    const scope = data.scope || 'personal';
    
    // 只有超级管理员可以创建全局知识库
    if (scope === 'global' && userRole !== 'super_admin') {
      return ResponseHelper.forbidden(res, '只有超级管理员可以创建全局知识库');
    }
    
    // 只有组管理员可以创建团队知识库
    if (scope === 'team') {
      if (userRole !== 'super_admin' && userRole !== 'admin') {
        return ResponseHelper.forbidden(res, '只有组管理员可以创建团队知识库');
      }
      // 如果没有指定group_id，使用当前用户的group_id
      if (!data.group_id) {
        data.group_id = groupId;
      }
      // 非超管只能为自己的组创建
      if (userRole !== 'super_admin' && data.group_id !== groupId) {
        return ResponseHelper.forbidden(res, '只能为自己的组创建团队知识库');
      }
    }
    
    const item = await WikiItem.create(data, userId);
    // 创建者肯定有编辑权限
    item.can_edit = true;
    
    return ResponseHelper.success(res, item.toJSON(), '创建知识库成功', 201);
  } catch (error) {
    logger.error('创建知识库失败:', error);
    if (error.name === 'ValidationError') {
      return ResponseHelper.validationError(res, error.message);
    }
    return ResponseHelper.error(res, error.message || '创建知识库失败');
  }
};

/**
 * 更新知识库（覆盖保存，不创建新版本）
 * v2.1修复：返回数据时包含正确的can_edit
 */
const updateItem = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const groupId = req.user.group_id;
    const userRole = req.user.role;
    const data = req.body;
    
    // 检查权限
    const { hasAccess, canEdit, item } = await WikiItem.checkAccess(id, userId, groupId, userRole);
    
    if (!item) {
      return ResponseHelper.notFound(res, '知识库不存在');
    }
    
    if (!canEdit) {
      return ResponseHelper.forbidden(res, '无权编辑此知识库');
    }
    
    // 不允许修改scope
    delete data.scope;
    delete data.creator_id;
    delete data.group_id;
    
    // 执行更新
    await WikiItem.update(id, data, userId);
    
    // 重新获取完整详情（包含用户信息以计算can_edit）
    const fullItem = await WikiItem.findById(id, userId, groupId, userRole);
    // 使用之前检查权限得到的canEdit（更准确）
    fullItem.can_edit = canEdit;
    
    return ResponseHelper.success(res, fullItem.toJSON(), '保存成功');
  } catch (error) {
    logger.error('更新知识库失败:', error);
    if (error.name === 'ValidationError') {
      return ResponseHelper.validationError(res, error.message);
    }
    return ResponseHelper.error(res, error.message || '保存失败');
  }
};

/**
 * 删除知识库
 */
const deleteItem = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const groupId = req.user.group_id;
    const userRole = req.user.role;
    
    // 检查权限
    const { hasAccess, canEdit, item } = await WikiItem.checkAccess(id, userId, groupId, userRole);
    
    if (!item) {
      return ResponseHelper.notFound(res, '知识库不存在');
    }
    
    // 删除权限更严格：只有创建者和超级管理员可以删除
    const canDelete = item.creator_id === userId || userRole === 'super_admin';
    
    if (!canDelete) {
      return ResponseHelper.forbidden(res, '只有创建者或超级管理员可以删除知识库');
    }
    
    await WikiItem.delete(id);
    
    return ResponseHelper.success(res, null, '删除知识库成功');
  } catch (error) {
    logger.error('删除知识库失败:', error);
    return ResponseHelper.error(res, error.message || '删除知识库失败');
  }
};

/**
 * 创建新版本
 */
const saveVersion = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const groupId = req.user.group_id;
    const userRole = req.user.role;
    const { change_summary } = req.body;
    
    // 检查权限
    const { canEdit, item } = await WikiItem.checkAccess(id, userId, groupId, userRole);
    
    if (!item) {
      return ResponseHelper.notFound(res, '知识库不存在');
    }
    
    if (!canEdit) {
      return ResponseHelper.forbidden(res, '无权编辑此知识库');
    }
    
    // 获取当前内容保存为新版本
    const fullItem = await WikiItem.findById(id);
    
    const result = await WikiItem.saveVersion(id, {
      title: fullItem.title,
      description: fullItem.description,
      content: fullItem.content,
      notes: fullItem.notes,
      links: fullItem.links
    }, userId, change_summary);
    
    return ResponseHelper.success(res, result, '新版本创建成功');
  } catch (error) {
    logger.error('创建版本失败:', error);
    return ResponseHelper.error(res, error.message || '创建版本失败');
  }
};

/**
 * 获取版本历史
 */
const getVersions = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const groupId = req.user.group_id;
    const userRole = req.user.role;
    
    // 检查访问权限
    const { hasAccess, item } = await WikiItem.checkAccess(id, userId, groupId, userRole);
    
    if (!item) {
      return ResponseHelper.notFound(res, '知识库不存在');
    }
    
    if (!hasAccess) {
      return ResponseHelper.forbidden(res, '无权访问此知识库');
    }
    
    const versions = await WikiItem.getVersions(id);
    
    return ResponseHelper.success(res, versions, '获取版本历史成功');
  } catch (error) {
    logger.error('获取版本历史失败:', error);
    return ResponseHelper.error(res, error.message || '获取版本历史失败');
  }
};

/**
 * 获取版本详情
 */
const getVersionDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const groupId = req.user.group_id;
    const userRole = req.user.role;
    
    const version = await WikiItem.getVersionDetail(id);
    
    if (!version) {
      return ResponseHelper.notFound(res, '版本不存在');
    }
    
    // 检查访问权限
    const { hasAccess } = await WikiItem.checkAccess(version.wiki_id, userId, groupId, userRole);
    
    if (!hasAccess) {
      return ResponseHelper.forbidden(res, '无权访问此知识库');
    }
    
    return ResponseHelper.success(res, version, '获取版本详情成功');
  } catch (error) {
    logger.error('获取版本详情失败:', error);
    return ResponseHelper.error(res, error.message || '获取版本详情失败');
  }
};

/**
 * 删除指定版本
 */
const deleteVersion = async (req, res) => {
  try {
    const { id, versionId } = req.params;
    const userId = req.user.id;
    const groupId = req.user.group_id;
    const userRole = req.user.role;
    
    // 检查编辑权限
    const { canEdit, item } = await WikiItem.checkAccess(id, userId, groupId, userRole);
    
    if (!item) {
      return ResponseHelper.notFound(res, '知识库不存在');
    }
    
    if (!canEdit) {
      return ResponseHelper.forbidden(res, '无权编辑此知识库');
    }
    
    // 调用模型层删除版本
    const result = await WikiItem.deleteVersion(parseInt(id), parseInt(versionId));
    
    return ResponseHelper.success(res, result, '版本删除成功');
  } catch (error) {
    logger.error('删除版本失败:', error);
    if (error.name === 'ValidationError') {
      return ResponseHelper.validationError(res, error.message);
    }
    return ResponseHelper.error(res, error.message || '删除版本失败');
  }
};

/**
 * 回滚到指定版本
 */
const rollbackToVersion = async (req, res) => {
  try {
    const { id, versionId } = req.params;
    const userId = req.user.id;
    const groupId = req.user.group_id;
    const userRole = req.user.role;
    
    // 检查编辑权限
    const { canEdit, item } = await WikiItem.checkAccess(id, userId, groupId, userRole);
    
    if (!item) {
      return ResponseHelper.notFound(res, '知识库不存在');
    }
    
    if (!canEdit) {
      return ResponseHelper.forbidden(res, '无权编辑此知识库');
    }
    
    const result = await WikiItem.rollbackToVersion(parseInt(id), parseInt(versionId), userId);
    result.can_edit = canEdit;
    
    return ResponseHelper.success(res, result.toJSON(), '回滚版本成功');
  } catch (error) {
    logger.error('回滚版本失败:', error);
    if (error.name === 'ValidationError') {
      return ResponseHelper.validationError(res, error.message);
    }
    return ResponseHelper.error(res, error.message || '回滚版本失败');
  }
};

/**
 * 切换置顶状态
 */
const togglePin = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const groupId = req.user.group_id;
    const userRole = req.user.role;
    
    // 检查编辑权限
    const { canEdit, item } = await WikiItem.checkAccess(id, userId, groupId, userRole);
    
    if (!item) {
      return ResponseHelper.notFound(res, '知识库不存在');
    }
    
    if (!canEdit) {
      return ResponseHelper.forbidden(res, '无权编辑此知识库');
    }
    
    const result = await WikiItem.togglePin(id);
    result.can_edit = canEdit;
    
    return ResponseHelper.success(res, result.toJSON(), '切换置顶状态成功');
  } catch (error) {
    logger.error('切换置顶状态失败:', error);
    return ResponseHelper.error(res, error.message || '切换置顶状态失败');
  }
};

/**
 * 获取编辑者列表
 */
const getEditors = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const groupId = req.user.group_id;
    const userRole = req.user.role;
    
    // 检查访问权限
    const { hasAccess, item } = await WikiItem.checkAccess(id, userId, groupId, userRole);
    
    if (!item) {
      return ResponseHelper.notFound(res, '知识库不存在');
    }
    
    // 只有团队知识库支持编辑者管理
    if (item.scope !== 'team') {
      return ResponseHelper.validationError(res, '只有团队知识库支持编辑者管理');
    }
    
    if (!hasAccess) {
      return ResponseHelper.forbidden(res, '无权访问此知识库');
    }
    
    const editors = await WikiItem.getEditors(id);
    
    return ResponseHelper.success(res, editors, '获取编辑者列表成功');
  } catch (error) {
    logger.error('获取编辑者列表失败:', error);
    return ResponseHelper.error(res, error.message || '获取编辑者列表失败');
  }
};

/**
 * 添加编辑者
 */
const addEditor = async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.body;
    const operatorId = req.user.id;
    const groupId = req.user.group_id;
    const userRole = req.user.role;
    
    if (!user_id) {
      return ResponseHelper.validationError(res, '请指定要添加的用户');
    }
    
    // 检查编辑权限
    const { canEdit, item } = await WikiItem.checkAccess(id, operatorId, groupId, userRole);
    
    if (!item) {
      return ResponseHelper.notFound(res, '知识库不存在');
    }
    
    // 只有团队知识库支持编辑者管理
    if (item.scope !== 'team') {
      return ResponseHelper.validationError(res, '只有团队知识库支持编辑者管理');
    }
    
    // 只有创建者和超级管理员可以管理编辑者
    const canManageEditors = item.creator_id === operatorId || userRole === 'super_admin';
    
    if (!canManageEditors) {
      return ResponseHelper.forbidden(res, '只有创建者或超级管理员可以管理编辑者');
    }
    
    await WikiItem.addEditor(id, user_id, operatorId);
    
    const editors = await WikiItem.getEditors(id);
    
    return ResponseHelper.success(res, editors, '添加编辑者成功');
  } catch (error) {
    logger.error('添加编辑者失败:', error);
    return ResponseHelper.error(res, error.message || '添加编辑者失败');
  }
};

/**
 * 移除编辑者
 */
const removeEditor = async (req, res) => {
  try {
    const { id, userId: targetUserId } = req.params;
    const operatorId = req.user.id;
    const groupId = req.user.group_id;
    const userRole = req.user.role;
    
    // 检查权限
    const { item } = await WikiItem.checkAccess(id, operatorId, groupId, userRole);
    
    if (!item) {
      return ResponseHelper.notFound(res, '知识库不存在');
    }
    
    // 只有团队知识库支持编辑者管理
    if (item.scope !== 'team') {
      return ResponseHelper.validationError(res, '只有团队知识库支持编辑者管理');
    }
    
    // 只有创建者和超级管理员可以管理编辑者
    const canManageEditors = item.creator_id === operatorId || userRole === 'super_admin';
    
    if (!canManageEditors) {
      return ResponseHelper.forbidden(res, '只有创建者或超级管理员可以管理编辑者');
    }
    
    await WikiItem.removeEditor(id, targetUserId);
    
    const editors = await WikiItem.getEditors(id);
    
    return ResponseHelper.success(res, editors, '移除编辑者成功');
  } catch (error) {
    logger.error('移除编辑者失败:', error);
    return ResponseHelper.error(res, error.message || '移除编辑者失败');
  }
};

module.exports = {
  getItems,
  getItem,
  createItem,
  updateItem,
  deleteItem,
  saveVersion,
  getVersions,
  getVersionDetail,
  deleteVersion,
  rollbackToVersion,
  togglePin,
  getEditors,
  addEditor,
  removeEditor
};

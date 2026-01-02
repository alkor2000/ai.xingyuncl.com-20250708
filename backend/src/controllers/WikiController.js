/**
 * 知识库控制器 v3.0
 * 
 * 功能：
 * - 知识库CRUD操作
 * - 版本管理（创建、查看、保存、删除）
 * - 编辑者管理
 * - 权限控制
 * 
 * 版本管理说明（v3.0重构）：
 * - 所有版本平等，保存到用户当前查看的版本
 * - updateVersion: 保存到指定版本
 * - createVersion: 基于指定版本创建新版本
 * 
 * 更新：2026-01-02 v3.0 重构版本管理
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
    
    const scope = data.scope || 'personal';
    
    if (scope === 'global' && userRole !== 'super_admin') {
      return ResponseHelper.forbidden(res, '只有超级管理员可以创建全局知识库');
    }
    
    if (scope === 'team') {
      if (userRole !== 'super_admin' && userRole !== 'admin') {
        return ResponseHelper.forbidden(res, '只有组管理员可以创建团队知识库');
      }
      if (!data.group_id) {
        data.group_id = groupId;
      }
      if (userRole !== 'super_admin' && data.group_id !== groupId) {
        return ResponseHelper.forbidden(res, '只能为自己的组创建团队知识库');
      }
    }
    
    const item = await WikiItem.create(data, userId);
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
 * 更新知识库基本信息（置顶、排序等，不涉及版本内容）
 */
const updateItem = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const groupId = req.user.group_id;
    const userRole = req.user.role;
    const data = req.body;
    
    const { canEdit, item } = await WikiItem.checkAccess(id, userId, groupId, userRole);
    
    if (!item) {
      return ResponseHelper.notFound(res, '知识库不存在');
    }
    
    if (!canEdit) {
      return ResponseHelper.forbidden(res, '无权编辑此知识库');
    }
    
    // 只允许更新基本信息
    const allowedFields = ['is_pinned', 'sort_order'];
    const updateData = {};
    allowedFields.forEach(field => {
      if (data[field] !== undefined) {
        updateData[field] = data[field];
      }
    });
    
    if (Object.keys(updateData).length > 0) {
      await WikiItem.updateBasicInfo(id, updateData);
    }
    
    const fullItem = await WikiItem.findById(id, userId, groupId, userRole);
    fullItem.can_edit = canEdit;
    
    return ResponseHelper.success(res, fullItem.toJSON(), '更新成功');
  } catch (error) {
    logger.error('更新知识库失败:', error);
    return ResponseHelper.error(res, error.message || '更新失败');
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
    
    const { item } = await WikiItem.checkAccess(id, userId, groupId, userRole);
    
    if (!item) {
      return ResponseHelper.notFound(res, '知识库不存在');
    }
    
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
 * 获取版本历史
 */
const getVersions = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const groupId = req.user.group_id;
    const userRole = req.user.role;
    
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
 * 创建新版本（基于当前内容）
 */
const createVersion = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const groupId = req.user.group_id;
    const userRole = req.user.role;
    const { base_version_id } = req.body; // 可选：基于哪个版本创建
    
    const { canEdit, item } = await WikiItem.checkAccess(id, userId, groupId, userRole);
    
    if (!item) {
      return ResponseHelper.notFound(res, '知识库不存在');
    }
    
    if (!canEdit) {
      return ResponseHelper.forbidden(res, '无权编辑此知识库');
    }
    
    const result = await WikiItem.createNewVersion(id, userId, base_version_id);
    
    return ResponseHelper.success(res, result, '新版本创建成功');
  } catch (error) {
    logger.error('创建版本失败:', error);
    return ResponseHelper.error(res, error.message || '创建版本失败');
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
    
    const { hasAccess, canEdit } = await WikiItem.checkAccess(version.wiki_id, userId, groupId, userRole);
    
    if (!hasAccess) {
      return ResponseHelper.forbidden(res, '无权访问此知识库');
    }
    
    // 在版本详情中加入can_edit信息
    version.can_edit = canEdit;
    
    return ResponseHelper.success(res, version, '获取版本详情成功');
  } catch (error) {
    logger.error('获取版本详情失败:', error);
    return ResponseHelper.error(res, error.message || '获取版本详情失败');
  }
};

/**
 * 保存到指定版本（v3.0核心API）
 * 
 * 这是版本管理的核心：用户在哪个版本上编辑，就保存到哪个版本
 */
const updateVersion = async (req, res) => {
  try {
    const { id: versionId } = req.params;
    const userId = req.user.id;
    const groupId = req.user.group_id;
    const userRole = req.user.role;
    const data = req.body;
    
    // 先获取版本信息
    const version = await WikiItem.getVersionDetail(versionId);
    
    if (!version) {
      return ResponseHelper.notFound(res, '版本不存在');
    }
    
    // 检查对该知识库的编辑权限
    const { canEdit } = await WikiItem.checkAccess(version.wiki_id, userId, groupId, userRole);
    
    if (!canEdit) {
      return ResponseHelper.forbidden(res, '无权编辑此知识库');
    }
    
    // 保存到该版本
    const result = await WikiItem.updateVersion(versionId, data, userId);
    
    return ResponseHelper.success(res, result, '保存成功');
  } catch (error) {
    logger.error('保存版本失败:', error);
    if (error.name === 'ValidationError') {
      return ResponseHelper.validationError(res, error.message);
    }
    return ResponseHelper.error(res, error.message || '保存失败');
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
    
    const { canEdit, item } = await WikiItem.checkAccess(id, userId, groupId, userRole);
    
    if (!item) {
      return ResponseHelper.notFound(res, '知识库不存在');
    }
    
    if (!canEdit) {
      return ResponseHelper.forbidden(res, '无权编辑此知识库');
    }
    
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
 * 切换置顶状态
 */
const togglePin = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const groupId = req.user.group_id;
    const userRole = req.user.role;
    
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
    
    const { hasAccess, item } = await WikiItem.checkAccess(id, userId, groupId, userRole);
    
    if (!item) {
      return ResponseHelper.notFound(res, '知识库不存在');
    }
    
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
    
    const { item } = await WikiItem.checkAccess(id, operatorId, groupId, userRole);
    
    if (!item) {
      return ResponseHelper.notFound(res, '知识库不存在');
    }
    
    if (item.scope !== 'team') {
      return ResponseHelper.validationError(res, '只有团队知识库支持编辑者管理');
    }
    
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
    
    const { item } = await WikiItem.checkAccess(id, operatorId, groupId, userRole);
    
    if (!item) {
      return ResponseHelper.notFound(res, '知识库不存在');
    }
    
    if (item.scope !== 'team') {
      return ResponseHelper.validationError(res, '只有团队知识库支持编辑者管理');
    }
    
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
  getVersions,
  createVersion,
  getVersionDetail,
  updateVersion,
  deleteVersion,
  togglePin,
  getEditors,
  addEditor,
  removeEditor
};

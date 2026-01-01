/**
 * 知识库路由定义 v2.0
 * 
 * 端点列表：
 * - GET    /items              获取知识库列表
 * - GET    /items/:id          获取知识库详情
 * - POST   /items              创建知识库
 * - PUT    /items/:id          更新知识库（覆盖保存，不创建版本）
 * - DELETE /items/:id          删除知识库
 * - POST   /items/:id/version  创建新版本
 * - GET    /items/:id/versions 获取版本历史
 * - GET    /versions/:id       获取版本详情
 * - DELETE /items/:id/versions/:versionId  删除指定版本（v2.0新增）
 * - POST   /items/:id/rollback/:versionId  回滚到指定版本
 * - PUT    /items/:id/pin      切换置顶状态
 * - GET    /items/:id/editors  获取编辑者列表
 * - POST   /items/:id/editors  添加编辑者
 * - DELETE /items/:id/editors/:userId  移除编辑者
 * 
 * 更新：2026-01-02 v2.0 新增删除版本API
 */

const express = require('express');
const router = express.Router();
const WikiController = require('../controllers/WikiController');
const { authenticate } = require('../middleware/authMiddleware');

// 所有路由都需要认证
router.use(authenticate);

// ==================== 知识库CRUD ====================

// 获取知识库列表
router.get('/items', WikiController.getItems);

// 获取知识库详情
router.get('/items/:id', WikiController.getItem);

// 创建知识库
router.post('/items', WikiController.createItem);

// 更新知识库（覆盖保存，不创建新版本）
router.put('/items/:id', WikiController.updateItem);

// 删除知识库
router.delete('/items/:id', WikiController.deleteItem);

// ==================== 版本管理 ====================

// 创建新版本
router.post('/items/:id/version', WikiController.saveVersion);

// 获取版本历史
router.get('/items/:id/versions', WikiController.getVersions);

// 获取版本详情
router.get('/versions/:id', WikiController.getVersionDetail);

// 删除指定版本（v2.0新增）
router.delete('/items/:id/versions/:versionId', WikiController.deleteVersion);

// 回滚到指定版本
router.post('/items/:id/rollback/:versionId', WikiController.rollbackToVersion);

// ==================== 其他功能 ====================

// 切换置顶状态
router.put('/items/:id/pin', WikiController.togglePin);

// 获取编辑者列表
router.get('/items/:id/editors', WikiController.getEditors);

// 添加编辑者
router.post('/items/:id/editors', WikiController.addEditor);

// 移除编辑者
router.delete('/items/:id/editors/:userId', WikiController.removeEditor);

module.exports = router;

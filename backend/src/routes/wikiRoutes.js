/**
 * 知识库路由 v3.0
 * 
 * 功能：
 * - 知识库CRUD
 * - 版本管理（创建、查看、保存、删除）
 * - 编辑者管理
 * - 置顶切换
 * 
 * 版本管理说明（v3.0重构）：
 * - 所有版本平等，没有"当前版本"和"历史版本"的区分
 * - 切换版本 = 切换工作区
 * - 保存到用户当前查看的版本
 * 
 * 更新：2026-01-02 v3.0 重构版本管理逻辑
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
// 更新知识库基本信息（不涉及版本内容）
router.put('/items/:id', WikiController.updateItem);
// 删除知识库
router.delete('/items/:id', WikiController.deleteItem);

// ==================== 版本管理 ====================
// 获取版本历史列表
router.get('/items/:id/versions', WikiController.getVersions);
// 创建新版本（基于当前查看的版本复制）
router.post('/items/:id/version', WikiController.createVersion);
// 获取指定版本详情
router.get('/versions/:id', WikiController.getVersionDetail);
// 保存到指定版本（v3.0核心API）
router.put('/versions/:id', WikiController.updateVersion);
// 删除指定版本
router.delete('/items/:id/versions/:versionId', WikiController.deleteVersion);

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

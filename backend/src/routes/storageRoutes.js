/**
 * 存储管理路由 v1.1
 * 
 * v1.1 更新：
 * 1. 新增文件重命名路由 PUT /files/:id/rename
 */

const express = require('express');
const StorageController = require('../controllers/StorageController');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

// 所有路由都需要认证
router.use(authenticate);

// ===== 文件操作 =====
router.post('/files/upload', StorageController.uploadFiles);          // 上传文件
router.get('/files', StorageController.getFiles);                     // 获取文件列表
router.put('/files/:id/rename', StorageController.renameFile);        // v1.1 重命名文件
router.put('/files/:id/move', StorageController.moveFile);            // 移动文件
router.delete('/files/:id', StorageController.deleteFile);            // 删除文件
router.post('/files/batch-delete', StorageController.deleteFiles);    // 批量删除文件

// ===== 文件夹操作 =====
router.post('/folders', StorageController.createFolder);              // 创建文件夹
router.get('/folders', StorageController.getFolders);                 // 获取文件夹列表
router.put('/folders/:id/rename', StorageController.renameFolder);    // 重命名文件夹
router.delete('/folders/:id', StorageController.deleteFolder);        // 删除文件夹

// ===== 存储统计 =====
router.get('/stats', StorageController.getStorageStats);              // 获取存储统计

module.exports = router;

/**
 * 存储管理路由
 */

const express = require('express');
const StorageController = require('../controllers/StorageController');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

// 所有路由都需要认证
router.use(authenticate);

// 文件操作
router.post('/files/upload', StorageController.uploadFiles);
router.get('/files', StorageController.getFiles);
router.delete('/files/:id', StorageController.deleteFile);
router.post('/files/batch-delete', StorageController.deleteFiles);
router.put('/files/:id/move', StorageController.moveFile);

// 文件夹操作
router.post('/folders', StorageController.createFolder);
router.get('/folders', StorageController.getFolders);
router.delete('/folders/:id', StorageController.deleteFolder);

// 存储统计
router.get('/stats', StorageController.getStorageStats);

module.exports = router;

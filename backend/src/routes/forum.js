/**
 * 论坛模块路由定义
 * 
 * 三层路由结构：
 * 1. 用户端 /forum/*        — 所有认证用户
 * 2. 版主操作 /forum/mod/*   — 版主/管理员（Controller层鉴权）
 * 3. 管理端 /forum/admin/*   — 超级管理员
 * 
 * 附件上传使用独立的 multer 配置（图片+文件双通道）
 * 
 * @module routes/forum
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs').promises;
const config = require('../config');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const ForumController = require('../controllers/ForumController');

/* ================================================================
 * Multer 上传配置 - 论坛专用
 * 图片：forum-images/{YYYY-MM}/  最多9张，每张10MB
 * 文件：forum-files/{YYYY-MM}/   最多5个，每个50MB
 * ================================================================ */

/**
 * 确保目录存在
 */
const ensureDir = async (dirPath) => {
  try { await fs.access(dirPath); } catch { await fs.mkdir(dirPath, { recursive: true }); }
};

/**
 * 论坛图片存储配置
 */
const imageStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const yearMonth = new Date().toISOString().slice(0, 7);
    const dir = path.join(config.upload.uploadDir, 'forum-images', yearMonth);
    try { await ensureDir(dir); cb(null, dir); } catch (e) { cb(e); }
  },
  filename: (req, file, cb) => {
    /* 修复中文文件名 */
    const original = Buffer.from(file.originalname, 'latin1').toString('utf8');
    file.originalname = original;
    const ext = path.extname(original);
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  }
});

/**
 * 论坛文件存储配置
 */
const fileStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const yearMonth = new Date().toISOString().slice(0, 7);
    const dir = path.join(config.upload.uploadDir, 'forum-files', yearMonth);
    try { await ensureDir(dir); cb(null, dir); } catch (e) { cb(e); }
  },
  filename: (req, file, cb) => {
    const original = Buffer.from(file.originalname, 'latin1').toString('utf8');
    file.originalname = original;
    const ext = path.extname(original);
    cb(null, `doc_${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  }
});

/* 图片 MIME 白名单 */
const IMAGE_MIMES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];

/* 文件扩展名白名单 */
const FILE_EXTS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv', '.zip', '.rar', '.7z', '.md'];

const uploadImages = multer({
  storage: imageStorage,
  fileFilter: (req, file, cb) => {
    cb(null, IMAGE_MIMES.includes(file.mimetype));
  },
  limits: { fileSize: 10 * 1024 * 1024, files: 9 }
}).array('images', 9);

const uploadFiles = multer({
  storage: fileStorage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, FILE_EXTS.includes(ext));
  },
  limits: { fileSize: 50 * 1024 * 1024, files: 5 }
}).array('files', 5);

/* 统一上传错误处理包装 */
const handleUpload = (uploadFn) => (req, res, next) => {
  uploadFn(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const messages = {
        LIMIT_FILE_SIZE: '文件大小超出限制',
        LIMIT_FILE_COUNT: '文件数量超出限制',
        LIMIT_UNEXPECTED_FILE: '上传字段名错误'
      };
      return res.status(400).json({ success: false, message: messages[err.code] || err.message });
    }
    if (err) return res.status(400).json({ success: false, message: err.message });
    next();
  });
};

/* ================================================================
 * 所有路由需要认证
 * ================================================================ */
router.use(authenticate);

/* ================================================================
 * 用户端路由 - 版块与帖子
 * ================================================================ */

/* 版块 */
router.get('/boards', ForumController.getBoards);
router.get('/boards/:boardId/posts', ForumController.getBoardPosts);

/* 热帖 */
router.get('/posts/hot', ForumController.getHotPosts);

/* 帖子 CRUD */
router.get('/posts/:id', ForumController.getPostDetail);
router.post('/posts', ForumController.createPost);
router.put('/posts/:id', ForumController.updatePost);
router.delete('/posts/:id', ForumController.deletePost);

/* 回复 */
router.get('/posts/:postId/replies', ForumController.getReplies);
router.post('/posts/:postId/replies', ForumController.createReply);
router.put('/replies/:id', ForumController.updateReply);
router.delete('/replies/:id', ForumController.deleteReply);

/* 点赞/收藏 */
router.post('/posts/:id/like', ForumController.togglePostLike);
router.post('/replies/:id/like', ForumController.toggleReplyLike);
router.post('/posts/:id/favorite', ForumController.toggleFavorite);
router.get('/favorites', ForumController.getFavorites);

/* 我的帖子 */
router.get('/my-posts', ForumController.getMyPosts);

/* 附件上传 */
router.post('/upload/images', handleUpload(uploadImages), ForumController.uploadImages);
router.post('/upload/files', handleUpload(uploadFiles), ForumController.uploadFiles);

/* 通知 */
router.get('/notifications', ForumController.getNotifications);
router.put('/notifications/read-all', ForumController.markAllNotificationsRead);
router.get('/notifications/unread-count', ForumController.getUnreadCount);

/* 用户搜索（@提及联想） */
router.get('/users/search', ForumController.searchUsers);

/* ================================================================
 * 版主操作路由 - Controller层鉴权
 * ================================================================ */
router.put('/mod/posts/:id/pin', ForumController.modTogglePin);
router.put('/mod/posts/:id/feature', ForumController.modToggleFeature);
router.put('/mod/posts/:id/hide', ForumController.modToggleHide);
router.put('/mod/posts/:id/lock', ForumController.modToggleLock);
router.put('/mod/posts/:id/disable-reply', ForumController.modToggleDisableReply);
router.put('/mod/replies/:id/hide', ForumController.modHideReply);

/* ================================================================
 * 管理端路由 - 超级管理员
 * ================================================================ */
router.get('/admin/boards', requireRole(['super_admin']), ForumController.adminGetBoards);
router.post('/admin/boards', requireRole(['super_admin']), ForumController.adminCreateBoard);
router.put('/admin/boards/:id', requireRole(['super_admin']), ForumController.adminUpdateBoard);
router.delete('/admin/boards/:id', requireRole(['super_admin']), ForumController.adminDeleteBoard);

/* 版主管理 */
router.get('/admin/boards/:boardId/moderators', requireRole(['super_admin']), ForumController.adminGetModerators);
router.post('/admin/boards/:boardId/moderators', requireRole(['super_admin']), ForumController.adminAppointModerator);
router.delete('/admin/moderators/:id', requireRole(['super_admin']), ForumController.adminRemoveModerator);

/* 论坛统计 */
router.get('/admin/stats', requireRole(['super_admin']), ForumController.adminGetStats);

module.exports = router;

/**
 * 知识库路由
 * 
 * 功能：知识库CRUD + 版本管理 + 编辑者管理 + RAG文件上传/索引/检索 + Embedding配置
 */

const express = require('express');
const router = express.Router();
const WikiController = require('../controllers/WikiController');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const config = require('../config');

/* 所有路由需要认证 */
router.use(authenticate);

/* ========== 文件上传中间件（Wiki文档上传） ========== */
const wikiUploadDir = path.join(config.storage?.paths?.uploads || '/var/www/ai-platform/storage/uploads', 'wiki-documents');
/* 确保目录存在 */
if (!fs.existsSync(wikiUploadDir)) {
  fs.mkdirSync(wikiUploadDir, { recursive: true });
}

const wikiUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, wikiUploadDir),
    filename: (req, file, cb) => {
      const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
      const ext = path.extname(file.originalname);
      cb(null, `wiki-${uniqueSuffix}${ext}`);
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, /* 50MB */
  fileFilter: (req, file, cb) => {
    const allowedExts = ['.pdf', '.docx', '.txt', '.md', '.markdown'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件格式: ${ext}，支持 PDF/Word/TXT/Markdown`));
    }
  }
});

/* ========== 知识库CRUD ========== */
router.get('/items', WikiController.getItems);
router.get('/items/:id', WikiController.getItem);
router.post('/items', WikiController.createItem);
router.put('/items/:id', WikiController.updateItem);
router.delete('/items/:id', WikiController.deleteItem);

/* ========== 版本管理 ========== */
router.get('/items/:id/versions', WikiController.getVersions);
router.post('/items/:id/version', WikiController.createVersion);
router.get('/versions/:id', WikiController.getVersionDetail);
router.put('/versions/:id', WikiController.updateVersion);
router.delete('/items/:id/versions/:versionId', WikiController.deleteVersion);

/* ========== RAG文件上传与索引 ========== */
/* 上传文档到知识库（解析内容写入wiki） */
router.post('/items/:id/upload', wikiUpload.array('files', 20), WikiController.uploadDocument);
/* 构建/重建向量索引 */
router.post('/items/:id/build-index', WikiController.buildIndex);
/* 获取索引状态 */
router.get('/items/:id/index-status', WikiController.getIndexStatus);
/* RAG检索测试 */
router.post('/items/:id/search', WikiController.ragSearch);
/* 获取chunks列表（预览用） */
router.get('/items/:id/chunks', WikiController.getChunks);

/* ========== Embedding配置（超级管理员） ========== */
router.get('/embedding-config', requireRole(['super_admin']), WikiController.getEmbeddingConfig);
router.put('/embedding-config', requireRole(['super_admin']), WikiController.updateEmbeddingConfig);

/* ========== 其他功能 ========== */
router.put('/items/:id/pin', WikiController.togglePin);
router.get('/items/:id/editors', WikiController.getEditors);
router.post('/items/:id/editors', WikiController.addEditor);
router.delete('/items/:id/editors/:userId', WikiController.removeEditor);

module.exports = router;

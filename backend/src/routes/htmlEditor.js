/**
 * HTML编辑器路由
 */

const express = require('express');
const router = express.Router();
const HtmlEditorController = require('../controllers/HtmlEditorController');
const { authenticate } = require('../middleware/authMiddleware');

// 需要认证的路由 - 使用authenticate中间件
router.use(authenticate);

// 项目管理
router.get('/projects', HtmlEditorController.getProjects);
router.post('/projects', HtmlEditorController.createProject);
router.put('/projects/:id', HtmlEditorController.updateProject);
router.delete('/projects/:id', HtmlEditorController.deleteProject);

// 页面管理
router.get('/pages', HtmlEditorController.getPages);
router.post('/pages', HtmlEditorController.createPage);
router.get('/pages/:id', HtmlEditorController.getPage);
router.put('/pages/:id', HtmlEditorController.updatePage);
router.delete('/pages/:id', HtmlEditorController.deletePage);
router.post('/pages/:id/toggle-publish', HtmlEditorController.togglePublish);

// 模板
router.get('/templates', HtmlEditorController.getTemplates);

module.exports = router;

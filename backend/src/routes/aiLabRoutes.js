/**
 * AI训练专区路由（/api/ai-lab）
 *
 * 全部需要 authenticate；/admin/projects 额外 requireRole(['admin','super_admin'])。
 * 项目级读写权限在控制器内按 AiLabService.canAccess / canWrite 裁决。
 * 样本上传先由 resolveUploadTarget 解析数据集，再由 handleSampleUpload 按 kind 走图片 / 音频管线。
 * POST /projects/:id/models 的 JSON 上限 20MB 在 app.js 里按路径单独设置（其余接口沿用全局 10MB）。
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const { handleSampleUpload } = require('../middleware/aiLabUploadMiddleware');
const AiLabController = require('../controllers/AiLabController');

router.use(authenticate);

/* 任务模板 / 预置数据包 */
router.get('/tasks', AiLabController.getTasks);
router.get('/presets', AiLabController.getPresets);

/* 项目 */
router.get('/projects', AiLabController.getProjects);
router.post('/projects', AiLabController.createProject);
router.get('/projects/:id', AiLabController.getProject);
router.patch('/projects/:id', AiLabController.updateProject);
router.post('/projects/:id/datasets', AiLabController.createDataset);
router.post('/projects/:id/models', AiLabController.createModel);
router.get('/projects/:id/events', AiLabController.getEvents);
router.post('/projects/:id/events', AiLabController.createEvents);

/* 数据集与样本 */
router.patch('/datasets/:id', AiLabController.updateDataset);
router.get('/datasets/:id/samples', AiLabController.getSamples);
router.post('/datasets/:id/samples', AiLabController.resolveUploadTarget, handleSampleUpload, AiLabController.uploadSamples);
router.post('/datasets/:id/lock', AiLabController.lockDataset);
router.post('/datasets/:id/import-preset', AiLabController.importPreset);
router.post('/datasets/:id/rows', AiLabController.createRows);
router.post('/datasets/:id/mislabel', AiLabController.mislabelDataset);
router.post('/datasets/:id/restore-labels', AiLabController.restoreLabels);
router.delete('/samples/:id', AiLabController.deleteSample);
router.patch('/samples/:id', AiLabController.updateSample);

/* 模型与评测 */
router.get('/models/:id', AiLabController.getModel);
router.patch('/models/:id', AiLabController.updateModel);
router.get('/models/:id/evaluations', AiLabController.getEvaluations);
router.post('/models/:id/evaluations', AiLabController.createEvaluation);

/* 管理端 */
router.get('/admin/projects', requireRole(['admin', 'super_admin']), AiLabController.getAdminProjects);

module.exports = router;

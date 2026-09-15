/**
 * 公文模板路由（/api/doc-templates），全部需要登录；权限在控制器 resolveTemplate 里裁决。
 * 上传接口用 multer 内存存储，单文件 ≤10MB，只收 .docx。
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authMiddleware');
const C = require('../controllers/DocTemplateController');

router.use(authenticate);
router.get('/', C.list);
router.post('/', C.uploadDocx, C.create);
router.post('/extract-draft', C.uploadDocx, C.extractDraft);
router.get('/:id', C.get);
router.patch('/:id', C.update);
router.delete('/:id', C.remove);
router.get('/:id/file', C.downloadFile);
router.post('/:id/render', C.render);
router.post('/:id/preview', C.preview);

module.exports = router;

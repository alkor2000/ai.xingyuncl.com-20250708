/**
 * 公文模板控制器（/api/doc-templates）
 *
 * GET    /                 我的 + 同组共享的模板列表（不含段落）
 * POST   /                 multipart file(.docx) + name/description/scope → 解析、猜角色、落盘 → {template, blocks}
 * GET    /:id              模板 + 样板段落（贴角色界面用；每次现解析文件）
 * PATCH  /:id              {name, description, scope, roles}（只有所有者）
 * DELETE /:id              删除模板与文件（只有所有者）
 * GET    /:id/file         下载样板原件（有读权限即可）
 * POST   /:id/render       {content} → .docx 文件流（Content-Disposition attachment）
 * POST   /:id/preview      {content} → {html}（mammoth 转的正文预览，不含页眉页脚）
 * POST   /extract-draft    multipart file(.docx) 或 {text} → {content}（老师自己的草稿拆成字段与正文块）
 *
 * 权限：读 = 本人 / 同组且 scope=group / 超管；写 = 本人。
 */
const multer = require('multer');
const DocTemplate = require('../models/DocTemplate');
const DocTemplateService = require('../services/docTemplate/DocTemplateService');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');
const { ValidationError } = require('../utils/errors');

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const badRequest = (res, message) => ResponseHelper.validation(res, [message], message);
const handleError = (res, error, fallbackMessage) => {
  if (error instanceof ValidationError) return badRequest(res, error.message);
  logger.error(`${fallbackMessage}:`, error);
  return ResponseHelper.error(res, error.message || fallbackMessage);
};
const parseId = (value) => { const n = parseInt(value, 10); return Number.isInteger(n) && n > 0 ? n : null; };

const docxMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (req, file, cb) => {
    const okExt = /\.docx$/i.test(file.originalname || '');
    const okMime = [DOCX_MIME, 'application/octet-stream', 'application/zip'].includes(file.mimetype);
    if (okExt && okMime) return cb(null, true);
    return cb(new Error('只能上传 .docx 格式的 Word 文件'));
  }
});
/** 单文件上传：字段名 file；缺文件时不报错（extract-draft 允许只传 text） */
const uploadDocx = (req, res, next) => {
  docxMulter.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return ResponseHelper.error(res, err.code === 'LIMIT_FILE_SIZE' ? `文件不能超过 ${MAX_FILE_SIZE / 1024 / 1024}MB` : `上传失败: ${err.message}`, 400);
    }
    if (err) return ResponseHelper.error(res, err.message, 400);
    return next();
  });
};

/** 找模板并校验读/写权限；失败时已写响应，返回 null */
const resolveTemplate = async (req, res, { write = false } = {}) => {
  const id = parseId(req.params.id);
  if (!id) { badRequest(res, '模板 ID 无效'); return null; }
  const template = await DocTemplate.findById(id);
  if (!template) { ResponseHelper.notFound(res, '模板不存在'); return null; }
  if (write ? !DocTemplate.canWrite(template, req.user) : !DocTemplate.canRead(template, req.user)) {
    ResponseHelper.forbidden(res, write ? '只有模板的创建者可以修改' : '无权使用这个模板');
    return null;
  }
  return template;
};
const publicView = (template, user) => ({ ...template, file_path: undefined, is_owner: Number(template.user_id) === Number(user.id) });
const sendDocx = (res, buffer, filename) => {
  const safe = String(filename || 'document').replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 80) || 'document';
  res.setHeader('Content-Type', DOCX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safe)}.docx"; filename*=UTF-8''${encodeURIComponent(safe)}.docx`);
  res.setHeader('Content-Length', buffer.length);
  return res.end(buffer);
};

const list = async (req, res) => {
  try {
    const templates = await DocTemplate.listVisible(req.user.id, req.user.group_id);
    return ResponseHelper.success(res, templates.map((t) => publicView(t, req.user)));
  } catch (error) {
    return handleError(res, error, '获取公文模板列表失败');
  }
};

const create = async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) return badRequest(res, '请上传一个 .docx 文件（字段名 file）');
    const { template, blocks } = await DocTemplateService.createFromUpload({
      user: req.user, buffer: req.file.buffer, originalname: req.file.originalname, name: req.body.name, description: req.body.description, scope: req.body.scope
    });
    logger.info('公文模板已创建', { id: template.id, userId: req.user.id, blocks: blocks.length });
    return ResponseHelper.success(res, { template: publicView(template, req.user), blocks }, '模板已创建', 201);
  } catch (error) {
    return handleError(res, error, '创建公文模板失败');
  }
};

const get = async (req, res) => {
  try {
    const template = await resolveTemplate(req, res);
    if (!template) return undefined;
    const { blocks } = await DocTemplateService.getWithBlocks(template);
    return ResponseHelper.success(res, { template: publicView(template, req.user), blocks });
  } catch (error) {
    return handleError(res, error, '获取公文模板失败');
  }
};

const update = async (req, res) => {
  try {
    const template = await resolveTemplate(req, res, { write: true });
    if (!template) return undefined;
    let updated = template;
    if (req.body.roles !== undefined) updated = await DocTemplateService.updateRoles(template, req.body.roles);
    const patch = {};
    if (req.body.name !== undefined) { const name = String(req.body.name).trim(); if (!name) return badRequest(res, '模板名不能为空'); patch.name = name.slice(0, 100); }
    if (req.body.description !== undefined) patch.description = String(req.body.description).slice(0, 500);
    if (req.body.scope !== undefined) { if (!DocTemplate.SCOPES.includes(req.body.scope)) return badRequest(res, 'scope 只能是 private 或 group'); patch.scope = req.body.scope; }
    if (Object.keys(patch).length) updated = await DocTemplate.update(template.id, patch);
    return ResponseHelper.success(res, publicView(updated, req.user), '已保存');
  } catch (error) {
    return handleError(res, error, '更新公文模板失败');
  }
};

const remove = async (req, res) => {
  try {
    const template = await resolveTemplate(req, res, { write: true });
    if (!template) return undefined;
    await DocTemplateService.remove(template);
    return ResponseHelper.success(res, null, '已删除');
  } catch (error) {
    return handleError(res, error, '删除公文模板失败');
  }
};

const downloadFile = async (req, res) => {
  try {
    const template = await resolveTemplate(req, res);
    if (!template) return undefined;
    const buffer = await DocTemplateService.readFile(template);
    return sendDocx(res, buffer, template.original_filename ? template.original_filename.replace(/\.docx$/i, '') : template.name);
  } catch (error) {
    return handleError(res, error, '下载模板文件失败');
  }
};

const render = async (req, res) => {
  try {
    const template = await resolveTemplate(req, res);
    if (!template) return undefined;
    const { buffer, content } = await DocTemplateService.render(template, req.body.content);
    logger.info('公文模板生成文档', { id: template.id, userId: req.user.id, blocks: content.blocks.length });
    return sendDocx(res, buffer, req.body.filename || content.title || template.name);
  } catch (error) {
    return handleError(res, error, '生成文档失败');
  }
};

const preview = async (req, res) => {
  try {
    const template = await resolveTemplate(req, res);
    if (!template) return undefined;
    const { buffer } = await DocTemplateService.render(template, req.body.content);
    const html = await DocTemplateService.previewHtml(buffer);
    return ResponseHelper.success(res, { html });
  } catch (error) {
    return handleError(res, error, '预览失败');
  }
};

const extractDraft = async (req, res) => {
  try {
    if (req.file && req.file.buffer) {
      const content = await DocTemplateService.extractDraft(req.file.buffer);
      return ResponseHelper.success(res, { content });
    }
    const text = req.body && req.body.text;
    if (typeof text === 'string' && text.trim()) return ResponseHelper.success(res, { content: DocTemplateService.contentFromText(text) });
    return badRequest(res, '请上传草稿 .docx（字段名 file）或提供 text');
  } catch (error) {
    return handleError(res, error, '解析草稿失败');
  }
};

module.exports = { uploadDocx, list, create, get, update, remove, downloadFile, render, preview, extractDraft };

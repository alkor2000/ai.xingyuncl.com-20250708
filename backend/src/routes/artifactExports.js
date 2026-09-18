// Local downloads only. Does not register a receiver, save resources, or issue identity tickets.
const express = require('express');
const { randomUUID } = require('crypto');
const rateLimit = require('express-rate-limit');
const { HandoffError, createSourceAdapter } = require('../services/artifactHandoff/source');
const { ArtifactExportService } = require('../services/artifactExportService');

const messages = {
  invalid_request: '请求格式不正确', unsupported_schema: '不支持的请求版本',
  unauthenticated: '请重新登录', forbidden: '当前账号不可用',
  source_unavailable: '回答已删除或无访问权限', source_not_ready: '请选择已完成的回答',
  source_too_large: '回答超过支持的大小', source_changed: '原文或附件已变化，请重新核对',
  invalid_selection: '请选择有效的原文范围', attachment_unavailable: '所选附件不可访问',
  attachment_unsupported: '所选附件格式或大小暂不支持', rate_limited: '请求过于频繁，请稍后重试',
  internal_error: '下载暂不可用，请稍后重试'
};
function createRouter({ service, authenticate }) {
  const router = express.Router();
  router.use((req, res, next) => {
    req.exportRequestId = randomUUID();
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Request-ID': req.exportRequestId });
    const json = res.json.bind(res);
    res.json = body => {
      if (res.statusCode >= 400 && !body.error?.code) {
        const code = res.statusCode === 401 ? 'unauthenticated' : 'forbidden';
        body = { error: { code, message: messages[code], retryable: false } };
      }
      return json({ ...body, request_id: req.exportRequestId });
    };
    if (Object.keys(req.query).length) return next(new HandoffError('invalid_request'));
    if (req.method === 'POST' && !req.is('application/json')) return next(new HandoffError('invalid_request', 415));
    next();
  });
  router.use(rateLimit({ windowMs: 60_000, max: 60,
    handler: (req, res, next) => next(new HandoffError('rate_limited', 429, true)) }));
  router.use(authenticate);
  router.use((req, res, next) => req.user?.id ? next() : next(new HandoffError('unauthenticated', 401)));
  router.use(express.json({ limit: '16kb', strict: true }));
  router.get('/messages/:id', async (req, res, next) => {
    try { res.json({ schema_version: 1, ...await service.inspect(req.user.id, req.params.id) }); }
    catch (error) { next(error); }
  });
  router.post('/messages/:id/download', async (req, res, next) => {
    try {
      // Re-read ownership, source version and attachments for every download. No persistent spool.
      const result = await service.download(req.user.id, req.params.id, req.body);
      res.attachment(result.filename).type('application/zip').send(result.buffer);
    } catch (error) { next(error); }
  });
  router.use((req, res, next) => next(new HandoffError('invalid_request', 404)));
  router.use((error, req, res, next) => {
    const known = error instanceof HandoffError;
    const parser = ['entity.parse.failed', 'entity.too.large'].includes(error.type);
    const code = known ? error.code : parser ? 'invalid_request' : 'internal_error';
    if (error.retryable) res.set('Retry-After', '2');
    res.status(known ? error.status : parser ? error.status || 400 : 500).json({
      error: { code, message: messages[code] || messages.internal_error, retryable: !!error.retryable }
    });
  });
  return router;
}
function mount(app) {
  const config = require('../config');
  const source = createSourceAdapter({ Message: require('../models/Message'), Conversation: require('../models/Conversation'),
    File: require('../models/File'), uploadRoot: config.storage.paths.uploads });
  app.use('/api/artifact-exports', createRouter({ service: new ArtifactExportService(source),
    authenticate: require('../middleware/authMiddleware').authenticate }));
}
module.exports = { createRouter, mount };

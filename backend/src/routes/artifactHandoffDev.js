// Deliberately has no production receiver, Identity client or TE-DNA URL setting.
const express = require('express');
const { randomUUID } = require('crypto');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { createSourceAdapter, HandoffError } = require('../services/artifactHandoff/source');
const { ArtifactHandoffService, SCHEMA_VERSION, validUUID } = require('../services/artifactHandoff/service');
const { DraftStore } = require('../services/artifactHandoff/store');

function enabled(env = process.env) {
  return ['development', 'test'].includes(env.NODE_ENV) && env.P03_DEV_ENABLED === 'true';
}
const messages = {
  disabled: '开发验证入口未启用', invalid_request: '请求格式不正确', unsupported_schema: '草案版本不受支持',
  invalid_idempotency_key: '需要有效的幂等键', unauthenticated: '请重新登录', forbidden: '账号未获开发验证授权',
  source_unavailable: '来源已不可访问', source_not_ready: '请选择已完成的助手回答', source_too_large: '来源超出首版文本大小限制',
  source_changed: '来源已变化，请重新核对范围', invalid_selection: '请选择有效的原文范围',
  attachment_unavailable: '选定附件已不可访问', attachment_unsupported: '附件格式或大小暂不支持',
  snapshot_unavailable: '快照已不可访问或已过期', authorization_expired: '模拟授权已过期或已撤销，请重新授权',
  idempotency_conflict: '同一幂等键不能用于不同请求', draft_limit: '开发快照数量已达上限',
  receiver_unavailable: '模拟接收方暂不可用，可重试', response_lost: '模拟响应丢失，请查询并恢复同一操作',
  rate_limited: '请求过于频繁，请稍后重试', internal_error: '成果准备暂不可用'
};
function createRouter({ service, authenticate, env = process.env }) {
  const router = express.Router();
  router.use((req, res, next) => {
    req.p03RequestId = randomUUID();
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Request-ID': req.p03RequestId });
    // Normalize legacy authentication middleware responses into the new endpoint envelope.
    const json = res.json.bind(res);
    res.json = body => {
      if (res.statusCode >= 400 && !body.error?.code) {
        body = { error: { code: res.statusCode === 401 ? 'unauthenticated' : 'forbidden',
          message: res.statusCode === 401 ? messages.unauthenticated : messages.forbidden, retryable: false } };
      }
      return json({ ...body, request_id: req.p03RequestId });
    };
    if (!enabled(env)) return next(new HandoffError('disabled', 404));
    if (Object.keys(req.query).length) return next(new HandoffError('invalid_request'));
    if (req.method === 'POST' && !req.is('application/json')) return next(new HandoffError('invalid_request', 415));
    next();
  });
  router.use(rateLimit({ windowMs: 60_000, max: 90, handler: (req, res, next) => next(new HandoffError('rate_limited', 429, true)) }));
  router.use(express.json({ limit: '16kb', strict: true }));
  router.use(authenticate);
  router.use((req, res, next) => {
    // Local allowlist is for development testers only, never a teacher-role assertion.
    const allowed = (env.P03_DEV_USER_IDS || '').split(',').map(value => value.trim());
    if (!req.user?.id || !allowed.includes(String(req.user.id))) return next(new HandoffError('forbidden', 403));
    next();
  });
  const run = fn => async (req, res, next) => {
    try { res.json({ schema_version: SCHEMA_VERSION, ...(await fn(req)) }); } catch (error) { next(error); }
  };
  router.get('/messages/:id', run(req => {
    if (!validUUID(req.params.id)) throw new HandoffError('source_unavailable', 404);
    return service.inspect(req.user.id, req.params.id);
  }));
  router.post('/snapshots', run(req => service.freeze(req.user.id, req.body, req.get('Idempotency-Key'))));
  router.get('/snapshots/:id', run(req => service.get(req.user.id, req.params.id)));
  router.post('/snapshots/:id/authorize', run(req => service.authorize(req.user.id, req.params.id, req.body, req.get('Idempotency-Key'))));
  router.post('/snapshots/:id/deliver', run(req => service.deliver(req.user.id, req.params.id, req.body, req.get('Idempotency-Key'))));
  router.get('/snapshots/:id/status', run(req => service.status(req.user.id, req.params.id)));
  router.use((req, res, next) => next(new HandoffError('invalid_request', 404)));
  router.use((error, req, res, next) => {
    const known = error instanceof HandoffError;
    const parser = ['entity.parse.failed', 'entity.too.large'].includes(error.type);
    const code = known ? error.code : parser ? 'invalid_request' : 'internal_error';
    const status = known ? error.status : parser ? (error.status || 400) : 500;
    if (error.retryable) res.set('Retry-After', '2');
    res.status(status).json({ error: { code, message: messages[code] || messages.internal_error, retryable: !!error.retryable } });
  });
  return router;
}
function mount(app, env = process.env) {
  if (!enabled(env)) return;
  const config = require('../config');
  const source = createSourceAdapter({ Message: require('../models/Message'), Conversation: require('../models/Conversation'),
    File: require('../models/File'), uploadRoot: config.storage.paths.uploads });
  const service = new ArtifactHandoffService({ source, store: new DraftStore(path.join(config.storage.root, 'private/p03-dev')) });
  app.use('/api/dev/p03', createRouter({ service, authenticate: require('../middleware/authMiddleware').authenticate, env }));
}
module.exports = { mount, createRouter, enabled };

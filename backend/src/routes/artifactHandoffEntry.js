// Login-protected product entry for "保存到备课资源库" (teacher artifact handoff, wire teacher-artifact-handoff/1).
// It only speaks to the default-off formal runtime held in app.locals.p03Handoff (formalRuntime.js): while the
// runtime is disabled every call answers handoff_disabled without touching a pool, a credential or a peer.
// The teacher's identity is the authenticated session only; nothing about the teacher, the target account or
// the instance comes from the request body. Eligibility (active, not shadow/student), copy rights (own
// uncleared conversation, own text attachments) and instance/policy gates are enforced by the runtime, Identity
// and the target — this router never bypasses them with its own flags.
const express = require('express');
const { randomUUID } = require('crypto');
const rateLimit = require('express-rate-limit');
const { HandoffError } = require('../services/artifactHandoff/source');
const { validUUID } = require('../services/artifactHandoff/selection');
const { TRUST } = require('../services/artifactHandoff/i03HttpsTransport');
const { FORMAL_VERSION } = require('../services/artifactHandoff/i03Draft');

const SCHEMA_VERSION = 1;
const PURPOSES = ['reference', 'lesson_preparation', 'courseware'];
const messages = {
  handoff_disabled: '保存到备课资源库尚未开放', invalid_request: '请求格式不正确', unsupported_schema: '页面已更新，请刷新后重试',
  invalid_idempotency_key: '需要有效的幂等键', unauthenticated: '请重新登录', forbidden: '当前账号不可用',
  subject_disabled: '当前账号不可用', subject_not_eligible: '当前账号不能发起保存',
  source_link_unavailable: '账号尚未与统一身份关联，不能保存', target_link_unavailable: '目标平台未关联到你的账号',
  action_not_allowed: '当前实例不允许保存到该资源库', wrong_target: '目标实例不匹配', phase_not_allowed: '当前阶段不允许该操作',
  source_unavailable: '回答已删除或无访问权限', source_not_ready: '请选择已完成的回答', source_too_large: '回答超过支持的大小',
  source_changed: '原文或附件已变化，请重新核对', source_permission_revoked: '来源权限已变化，本次保存已取消',
  invalid_selection: '请选择有效的原文范围', attachment_unavailable: '所选附件不可访问', attachment_unsupported: '所选附件格式或大小暂不支持',
  snapshot_unavailable: '本次保存已过期或不存在，请重新选择', idempotency_conflict: '同一请求标识不能用于不同内容', draft_limit: '待处理的保存过多，请稍后再试',
  binding_mismatch: '来源版本不一致，请重新选择', operation_expired: '保存窗口已过，请重新选择', operation_cancelled: '本次保存已取消', operation_deleted: '目标已删除同一内容，不能重新保存',
  not_prepared: '目标尚未准备好接收，请重试', recovery_window_closed: '状态查询窗口已关闭，显示最后已知结果', reconciliation_required: '本次保存需要运维核对，请勿重复提交',
  retry_later: '请稍后重试', rate_limited: '操作过于频繁，请稍后重试', identity_unavailable: '统一身份服务暂不可用，请稍后重试', target_unavailable: '备课资源库暂不可用，请稍后重试',
  storage_unavailable: '目标存储暂不可用，请稍后重试', receipt_invalid: '目标回执未通过核对，请稍后查询状态', operation_busy: '正在处理同一保存，请稍候', operation_lock_lost: '处理连接中断，请查询状态后重试',
  ticket_invalid: '授权票据无效', ticket_expired: '授权票据已过期，请重试', stale_request: '时间校验失败，请重试', replay_detected: '重复请求已被拒绝',
  payload_too_large: '内容超过大小限制', unsupported_media: '不支持的内容类型', invalid_package: '内容包未通过核对', invalid_client: '客户端身份无效',
  internal_error: '保存暂不可用，请稍后重试'
};

function runtimeOf(req) {
  const runtime = req.app.locals.p03Handoff;
  if (!runtime || runtime.enabled !== true || !runtime.service) throw new HandoffError('handoff_disabled', 503);
  return runtime;
}
function requireKey(req) {
  const key = req.get('Idempotency-Key');
  if (!validUUID(key)) throw new HandoffError('invalid_idempotency_key');
  return key;
}
const plain = value => typeof value === 'string' && value.length > 0 && Array.from(value).length <= 120 && !/[\x00-\x1f\x7f]/.test(value);

function createRouter({ authenticate }) {
  const router = express.Router();
  router.use((req, res, next) => {
    req.p03RequestId = randomUUID();
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Request-ID': req.p03RequestId });
    const json = res.json.bind(res);
    res.json = body => {
      if (res.statusCode >= 400 && !body.error?.code) {
        const code = res.statusCode === 401 ? 'unauthenticated' : 'forbidden';
        body = { error: { code, message: messages[code], retryable: false } };
      }
      return json({ ...body, request_id: req.p03RequestId });
    };
    // Only the list endpoint takes a query string, and only message_id.
    const allowed = req.method === 'GET' && req.path === '/' ? ['message_id'] : [];
    if (Object.keys(req.query).some(k => !allowed.includes(k))) return next(new HandoffError('invalid_request'));
    if (req.method === 'POST' && req.headers['content-length'] !== '0' && req.headers['content-length'] !== undefined && !req.is('application/json')) return next(new HandoffError('invalid_request', 415));
    next();
  });
  router.use(rateLimit({ windowMs: 60_000, max: 60, handler: (req, res, next) => next(new HandoffError('rate_limited', 429, true)) }));
  router.use(authenticate);
  router.use((req, res, next) => (req.user?.id ? next() : next(new HandoffError('unauthenticated', 401))));
  router.use(express.json({ limit: '16kb', strict: true }));
  const run = fn => async (req, res, next) => {
    try { res.json({ schema_version: SCHEMA_VERSION, ...(await fn(req)) }); } catch (error) { next(error); }
  };
  // Availability is a fact of this deployment, never of the request: the UI hides the entry when it is false.
  router.get('/capability', run(req => {
    const runtime = req.app.locals.p03Handoff;
    if (!runtime || runtime.enabled !== true) return { available: false, reason: 'disabled' };
    return { available: true, wire: FORMAL_VERSION, target: { instance: TRUST.targetInstance, origin: TRUST.targetOrigin, kind: 'personal_library' },
      purposes: PURPOSES, limits: { max_attachments: 3, max_attachment_bytes: 65536, title_max_chars: 120 } };
  }));
  // Preview of one assistant answer: exactly what the export entry shows (text, version, attachments) plus the
  // eligibility/copy pre-check so an account that cannot start is told before it selects anything.
  router.get('/messages/:id', run(async req => {
    const { service } = runtimeOf(req);
    if (!validUUID(req.params.id)) throw new HandoffError('source_unavailable', 404);
    await service.authority.checkExport(req.user.id, req.params.id);
    return service.source.inspect(req.user.id, req.params.id);
  }));
  // Local views of this account's saves for one message; page reloads recover from here without any peer call.
  router.get('/', run(async req => {
    const { service } = runtimeOf(req);
    if (!validUUID(req.query.message_id)) throw new HandoffError('invalid_request');
    return { operations: await service.list(req.user.id, req.query.message_id) };
  }));
  // Freeze the explicit selection (nothing is sent yet). Idempotent per key; the same selection maps to one operation.
  router.post('/', run(async req => {
    const { service } = runtimeOf(req);
    const key = requireKey(req);
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HandoffError('invalid_request');
    if (body.schema_version !== SCHEMA_VERSION) throw new HandoffError('unsupported_schema');
    const { title, ...selection } = body;
    delete selection.schema_version;
    if (!plain(title)) throw new HandoffError('invalid_request');
    if (!PURPOSES.includes(selection.purpose)) throw new HandoffError('invalid_request');
    return service.freeze(req.user.id, { schema_version: SCHEMA_VERSION, ...selection }, key, title);
  }));
  // The explicit "保存到备课资源库" action: prepare/commit through Identity and the target. Re-clicking resumes the
  // same operation (status first, never a second copy).
  router.post('/:id/save', run(async req => {
    const { service } = runtimeOf(req);
    if (!validUUID(req.params.id)) throw new HandoffError('snapshot_unavailable', 404);
    return service.resume(req.user.id, req.params.id);
  }));
  // Local state without any peer call (page reload), and an explicit status query (respects R and backoff).
  router.get('/:id', run(async req => {
    const { service } = runtimeOf(req);
    if (!validUUID(req.params.id)) throw new HandoffError('snapshot_unavailable', 404);
    return service.get(req.user.id, req.params.id);
  }));
  router.post('/:id/refresh', run(async req => {
    const { service } = runtimeOf(req);
    if (!validUUID(req.params.id)) throw new HandoffError('snapshot_unavailable', 404);
    return service.status(req.user.id, req.params.id);
  }));
  router.post('/:id/cancel', run(async req => {
    const { service } = runtimeOf(req);
    if (!validUUID(req.params.id)) throw new HandoffError('snapshot_unavailable', 404);
    return service.cancel(req.user.id, req.params.id);
  }));
  router.use((req, res, next) => next(new HandoffError('invalid_request', 404)));
  router.use((error, req, res, next) => {
    const known = error instanceof HandoffError;
    const parser = ['entity.parse.failed', 'entity.too.large', 'charset.unsupported'].includes(error.type);
    const code = known ? error.code : parser ? 'invalid_request' : 'internal_error';
    if (known && error.retryable) res.set('Retry-After', String(error.retryAfter || 2));
    res.status(known ? error.status : parser ? error.status || 400 : 500).json({
      error: { code, message: messages[code] || messages.internal_error, retryable: !!(known && error.retryable),
        ...(known && error.peer ? { peer: error.peer } : {}) }
    });
  });
  return router;
}
function mount(app) {
  app.use('/api/p03/handoffs', createRouter({ authenticate: require('../middleware/authMiddleware').authenticate }));
}
module.exports = { createRouter, mount, messages, PURPOSES };

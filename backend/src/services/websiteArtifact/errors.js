'use strict';

// Fixed error classification for the P09 website-artifact source side (docs/30, C06 website supplement
// candidate). Codes are the contract surface: messages are operator-facing Chinese sentences that never
// carry request bytes, identifiers of other platforms, credentials or stack traces (contracts/00 §3/§4).
class P09Error extends Error {
  constructor(code, status = 400, retryable = false) {
    super(code);
    Object.assign(this, { code, status, retryable, name: 'P09Error' });
  }
}
const fail = (code, status, retryable) => { throw new P09Error(code, status, retryable); };

// Request/runtime shape
const MESSAGES = Object.freeze({
  website_artifacts_disabled: '网站作品接入尚未开放',
  invalid_request: '请求格式不正确',
  unsupported_schema: '不支持的 schema_version',
  invalid_idempotency_key: '需要有效的幂等键',
  unauthenticated: '请重新登录',
  forbidden: '当前账号不可用',
  // Task context (the only source of assignment/lesson scope)
  task_context_required: '缺少可信的任务上下文',
  task_context_unavailable: '本实例尚未配置任务上下文发行方',
  task_context_invalid: '任务上下文签名或范围无效',
  task_context_expired: '任务上下文已过期',
  task_context_replayed: '任务上下文已被使用',
  task_context_instance_mismatch: '任务上下文不属于本实例',
  subject_mismatch: '任务上下文与当前账号不一致',
  subject_not_eligible: '当前账号不能关联教学任务',
  // Source facts
  project_unavailable: '项目不存在或无访问权限',
  project_not_ready: '项目尚无可关联的页面',
  entry_page_invalid: '入口页面不属于该项目',
  project_empty: '默认空项目不能作为作品关联',
  link_exists: '该任务已关联其他作品',
  project_already_linked: '该项目已关联到本任务',
  link_unavailable: '关联不存在或已撤销',
  link_revoked: '关联已撤销',
  source_deleted: '源作品已删除',
  revision_unavailable: '评阅版本不存在',
  revision_too_large: '作品超过评阅版本的大小限制',
  // Handing the work in (edu decides; these are only this platform's own refusals)
  submit_unconfigured: '本实例尚未接入作业提交通道',
  assignment_ref_missing: '这次作业没有填课次编号，请老师补齐后再交',
  submit_unavailable: '没有交上，请稍后再试',
  submit_answer_invalid: '没有交上，请稍后再试',
  submit_refused: '这次提交被拒绝了',
  // Review access
  review_session_invalid: '评阅会话无效或已过期',
  review_session_consumed: '评阅入口已被使用',
  preview_origin_required: '预览必须在隔离域名上打开',
  preview_unavailable: '当前没有可打开的预览',
  audience_mismatch: '评阅会话不属于当前访问者',
  review_session_binding: '评阅入口只能在领取它的浏览器中打开',
  eligibility_unavailable: '本实例尚未接入评阅资格提供方',
  not_eligible: '当前访问者已不具备该作品的评阅资格',
  issuer_revoked: '签发该评阅入口的发行方已停用',
  owner_unavailable: '作品所属账号当前不可用',
  asset_unavailable: '该资源不属于本作品或不可读取',
  // Incremental read
  cursor_invalid: '游标无效',
  range_too_large: '查询范围过大',
  school_not_provisioned: '该学校尚未开通',
  // Infrastructure
  storage_unavailable: '存储暂不可用，请稍后重试',
  rate_limited: '操作过于频繁，请稍后重试',
  internal_error: '暂不可用，请稍后重试'
});
const message = code => MESSAGES[code] || MESSAGES.internal_error;
module.exports = { P09Error, fail, MESSAGES, message };

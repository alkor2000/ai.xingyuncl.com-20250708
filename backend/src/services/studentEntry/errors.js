'use strict';

// C05 (edu → practice student entry) error classification. The codes are the contract surface from
// contracts/C05-student-sso.md §6; messages are operator-facing Chinese sentences that never carry a
// request body, a signature, a secret or another platform's identifiers.
class C05Error extends Error {
  constructor(code, status = 400, retryable = false) {
    super(code);
    Object.assign(this, { code, status, retryable, name: 'C05Error' });
  }
}
const fail = (code, status, retryable) => { throw new C05Error(code, status, retryable); };

const MESSAGES = Object.freeze({
  // exchange (contract §6)
  invalid_signature: '签名校验失败',
  stale_timestamp: '请求时间超出允许范围',
  replay_detected: '该请求已被使用',
  platform_disabled: '该对接平台未启用',
  ip_not_allowed: '来源地址未被授权',
  subject_disabled: '该学生账号不可用',
  cohort_not_supported: '本通道只接受学生',
  school_not_provisioned: '该学校尚未开通',
  entry_not_allowed: '不允许的落地页面',
  rate_limited: '操作过于频繁，请稍后重试',
  storage_unavailable: '存储暂不可用，请稍后重试',
  // consume
  handoff_invalid: '登录入口无效或已使用',
  // this deployment's own refusals — named rather than guessed
  student_entry_disabled: '学生入口尚未开放',
  config_invalid: '学生入口配置不完整',
  issuance_policy_missing: '学生组发放策略尚未确定，入口对生产关闭',
  group_change_refused: '本部署未开启换组/换校处理，请联系管理员',
  subject_not_student: '该 uuid 已属于非学生账号，不能被学生断言接管',
  subject_expired: '该学生账号已过期，请联系管理员续期',
  // 交换与兑换之间隔着最多 60 秒，这些码说的是"那 60 秒里现态变了"
  session_scope_changed: '登录信息已过期，请回到作业页面重新进入',
  session_store_unavailable: '会话上下文暂不可用，请稍后重试',
  context_unavailable: '当前会话没有可读的作业线索',
  refresh_not_supported: '本入口不签发长效登录凭证，请勿开启该配置',
  username_conflict: '无法为该学生分配用户名',
  invalid_request: '请求格式不正确',
  internal_error: '暂不可用，请稍后重试'
});
const message = code => MESSAGES[code] || MESSAGES.internal_error;
module.exports = { C05Error, fail, MESSAGES, message };

/**
 * Identity账号操作完成后的站内返回策略。
 *
 * 职责：
 * 1. 复用IdentityFlowService的通用站内return_to安全校验；
 * 2. bind只允许返回个人中心、Dashboard或已冻结的8个AI能力工作区；
 * 3. unlink始终只能返回个人中心；
 * 4. 不接受任意站内路径，更不接受站外URL。
 *
 * 这里保存的是AI平台自己的内部页面合同。
 * Identity Center仍然只知道stable entry_key，
 * 不知道/chat、/image等具体页面。
 */

const {
  IdentityFlowService
} = require('./IdentityFlowService');

const ACCOUNT_RESULT_PATH =
  '/profile';

const ACCOUNT_BIND_RETURN_TO_PATHS =
  Object.freeze([
    '/profile',
    '/dashboard',
    '/chat',
    '/image',
    '/video',
    '/agent',
    '/knowledge',
    '/html-editor',
    '/mindmap',
    '/storage'
  ]);

const ACCOUNT_BIND_RETURN_TO_PATH_SET =
  new Set(
    ACCOUNT_BIND_RETURN_TO_PATHS
  );

class IdentityAccountReturnToPolicy {
  /**
   * 账号操作只允许进入固定的本平台目标。
   *
   * IdentityFlowService先负责：
   * - 必须以单个/开头；
   * - 拒绝//；
   * - 拒绝反斜杠；
   * - 拒绝控制字符；
   * - 限制长度。
   *
   * 本层再负责业务白名单。
   */
  static normalize(
    purpose,
    value
  ) {
    const normalized =
      IdentityFlowService.normalizeReturnTo(
        value
      );

    if (purpose === 'unlink') {
      if (
        normalized !==
          ACCOUNT_RESULT_PATH
      ) {
        throw IdentityAccountReturnToPolicy
          .createError(
            'IDENTITY_ACCOUNT_RETURN_TO_INVALID',
            '解绑操作只能返回个人中心'
          );
      }

      return normalized;
    }

    if (
      purpose !== 'bind' ||
      !ACCOUNT_BIND_RETURN_TO_PATH_SET.has(
        normalized
      )
    ) {
      throw IdentityAccountReturnToPolicy
        .createError(
          'IDENTITY_ACCOUNT_RETURN_TO_INVALID',
          '账号关联返回位置不在允许范围'
        );
    }

    return normalized;
  }

  static createError(
    code,
    message
  ) {
    const error =
      new Error(message);

    error.code =
      code;

    return error;
  }
}

module.exports = {
  IdentityAccountReturnToPolicy,
  ACCOUNT_RESULT_PATH,
  ACCOUNT_BIND_RETURN_TO_PATHS
};

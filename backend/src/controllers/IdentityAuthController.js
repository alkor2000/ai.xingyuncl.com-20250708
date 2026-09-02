/**
 * PKU AI Lab Identity Center认证控制器。
 *
 * 职责：
 * 1. 发起login-purpose OAuth/OIDC流程
 * 2. 处理login callback并生成一次性本地Handoff
 * 3. Handoff消费后复用本平台既有登录成功逻辑签发本地JWT
 * 4. 发起bind/unlink强认证流程
 * 5. 处理bind/unlink callback并调用Identity Backchannel
 *
 * 安全边界：
 * - 不复用历史/auth/sso协议。
 * - 不自动创建本地用户。
 * - Identity local_account_id固定解释为String(users.id)。
 * - login callback绝不把Identity Access Token、ID Token或本地JWT放进URL。
 * - bind/unlink的本地账号只能来自已认证req.user或加密短时Flow。
 * - bind/unlink开始前必须收到前端明确确认标志。
 * - callback错误只使用固定本地错误码，不回显Identity code/state/token。
 */

const crypto = require('crypto');

const User = require('../models/User');
const AuthControllerRefactored = require('./AuthControllerRefactored');

const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');

const identityFlowService = require('../services/auth/IdentityFlowService');
const identityOIDCService = require('../services/auth/IdentityOIDCService');

const {
  IdentityFlowService
} = require('../services/auth/IdentityFlowService');

const {
  IdentityAccountReturnToPolicy,
  ACCOUNT_RESULT_PATH
} = require('../services/auth/IdentityAccountReturnToPolicy');

const LOGIN_FRONTEND_CALLBACK = '/auth/identity/callback';
const LOGIN_FAILURE_PATH = '/login';

class IdentityAuthController {
  constructor({
    flowService = identityFlowService,
    oidcService = identityOIDCService,
    userModel = User,
    localAuthController = AuthControllerRefactored,
    responseHelper = ResponseHelper,
    appLogger = logger
  } = {}) {
    this.flowService = flowService;
    this.oidcService = oidcService;
    this.userModel = userModel;
    this.localAuthController = localAuthController;
    this.responseHelper = responseHelper;
    this.logger = appLogger;

    this.startLogin = this.startLogin.bind(this);
    this.loginCallback = this.loginCallback.bind(this);
    this.consumeLogin = this.consumeLogin.bind(this);
    this.startConnect = this.startConnect.bind(this);
    this.startUnlink = this.startUnlink.bind(this);
    this.accountCallback = this.accountCallback.bind(this);
  }

  /**
   * GET /api/auth/identity/login/start
   *
   * 顶层导航入口，既可供本平台登录页使用，也可供未来统一门户直接跳转。
   */
  async startLogin(req, res) {
    this._setNoStore(res);

    try {
      const returnTo =
        IdentityAuthController._readOptionalQueryString(
          req,
          'return_to'
        ) || '/dashboard';

      const flow =
        await this.flowService.createFlow({
          purpose: 'login',
          returnTo
        });

      const authorizationURL =
        this.oidcService.buildAuthorizationURL({
          state: flow.state,
          nonce: flow.nonce,
          codeChallenge: flow.codeChallenge,
          purpose: 'login'
        });

      return res.redirect(
        302,
        authorizationURL
      );

    } catch (error) {
      this._logProtocolFailure(
        'Identity登录发起失败',
        error
      );

      return this.responseHelper.error(
        res,
        '统一身份登录暂时不可用',
        503
      );
    }
  }

  /**
   * GET /api/auth/identity/login/callback
   *
   * Identity只回传Authorization Code与state。
   * 本端后端完成Code交换、ID Token验签和UserInfo读取后，只向浏览器暴露
   * 一次性本地Handoff ticket。
   */
  async loginCallback(req, res) {
    this._setNoStore(res);

    let flow;

    try {
      const state =
        IdentityAuthController._readRequiredQueryString(
          req,
          'state'
        );

      flow =
        await this.flowService.consumeFlow(
          state
        );

      if (flow.purpose !== 'login') {
        return this._redirectLoginFailure(
          res,
          'purpose_mismatch'
        );
      }

      const oauthError =
        IdentityAuthController._readOptionalQueryString(
          req,
          'error'
        );

      if (oauthError) {
        return this._redirectLoginFailure(
          res,
          'authorization_failed'
        );
      }

      const code =
        IdentityAuthController._readRequiredQueryString(
          req,
          'code'
        );

      const identityResult =
        await this.oidcService.completeAuthorization({
          code,
          codeVerifier: flow.codeVerifier,
          nonce: flow.nonce,
          purpose: 'login'
        });

      if (!identityResult.platformLink ||
          identityResult.platformLink.linked !== true) {
        return this._redirectLoginFailure(
          res,
          'not_linked'
        );
      }

      const localAccountID =
        IdentityFlowService.normalizeLocalUserId(
          identityResult.platformLink.local_account_id
        );

      const user =
        await this.userModel.findById(
          Number(localAccountID)
        );

      if (!user ||
          String(user.id) !== localAccountID) {
        return this._redirectLoginFailure(
          res,
          'account_unavailable'
        );
      }

      // callback阶段先做防御性检查，真正签发JWT时
      // _handleLoginSuccess还会再次完整检查状态和有效期。
      if (user.status !== 'active' ||
          user.isAccountExpired()) {
        return this._redirectLoginFailure(
          res,
          'account_unavailable'
        );
      }

      const handoff =
        await this.flowService.createHandoff({
          userId: user.id,
          returnTo: flow.returnTo
        });

      const query =
        new URLSearchParams({
          handoff: handoff.ticket
        });

      return res.redirect(
        302,
        `${LOGIN_FRONTEND_CALLBACK}?${query.toString()}`
      );

    } catch (error) {
      this._logProtocolFailure(
        'Identity登录callback失败',
        error
      );

      return this._redirectLoginFailure(
        res,
        'callback_failed'
      );
    }
  }

  /**
   * POST /api/auth/identity/login/consume
   *
   * Handoff只能消费一次。
   *
   * 本方法不复制Token、权限、站点配置和账号有效期逻辑；
   * 最终直接复用AuthControllerRefactored._handleLoginSuccess。
   */
  async consumeLogin(req, res) {
    this._setNoStore(res);

    try {
      const handoff =
        IdentityAuthController._readRequiredBodyString(
          req,
          'handoff'
        );

      const payload =
        await this.flowService.consumeHandoff(
          handoff
        );

      const localUserID =
        IdentityFlowService.normalizeLocalUserId(
          payload.userId
        );

      const user =
        await this.userModel.findById(
          Number(localUserID)
        );

      if (!user ||
          String(user.id) !== localUserID) {
        return this.responseHelper.unauthorized(
          res,
          '关联的平台账号不存在或已不可用'
        );
      }

      // returnTo来自已经原子消费的Redis Handoff。
      // 浏览器callback URL不能覆盖这个可信值。
      if (typeof res.set === 'function') {
        res.set(
          'X-Identity-Return-To',
          payload.returnTo
        );
      }

      // false非常关键：
      // Identity关联的是普通本地账号，不得转换成历史uuid_source=sso语义。
      return this.localAuthController._handleLoginSuccess(
        user,
        res,
        false,
        '统一身份登录'
      );

    } catch (error) {
      this._logProtocolFailure(
        'Identity登录Handoff消费失败',
        error
      );

      return this.responseHelper.unauthorized(
        res,
        '统一身份登录凭据无效或已过期'
      );
    }
  }

  /**
   * POST /api/auth/identity/connect/start
   *
   * 必须经过authenticate中间件，并且前端必须明确确认“绑定当前账号”。
   */
  async startConnect(req, res) {
    return this._startAccountMutation(
      req,
      res,
      'bind'
    );
  }

  /**
   * POST /api/auth/identity/unlink/start
   *
   * unlink同样使用Identity数据库purpose=bind的强认证redirect，
   * 因而不会静默复用Central Session。
   */
  async startUnlink(req, res) {
    return this._startAccountMutation(
      req,
      res,
      'unlink'
    );
  }

  async _startAccountMutation(
    req,
    res,
    purpose
  ) {
    this._setNoStore(res);

    try {
      if (!req.user ||
          !req.user.id) {
        return this.responseHelper.unauthorized(
          res,
          '请先登录当前平台账号'
        );
      }

      if (req.body?.confirm_current_account !== true) {
        return this.responseHelper.validation(
          res,
          ['必须明确确认当前平台账号'],
          '请先确认当前平台账号'
        );
      }

      const localUserID =
        IdentityFlowService.normalizeLocalUserId(
          req.user.id
        );

      const returnTo =
        IdentityAccountReturnToPolicy
          .normalize(
            purpose,
            req.body?.return_to ||
              ACCOUNT_RESULT_PATH
          );

      const flow =
        await this.flowService.createFlow({
          purpose,
          localUserId: localUserID,
          returnTo
        });

      const authorizationURL =
        this.oidcService.buildAuthorizationURL({
          state: flow.state,
          nonce: flow.nonce,
          codeChallenge: flow.codeChallenge,
          purpose
        });

      return this.responseHelper.success(
        res,
        {
          authorizationUrl:
            authorizationURL,
          account: {
            id: localUserID,
            username:
              req.user.username || ''
          }
        },
        purpose === 'bind'
          ? '账号关联确认已建立'
          : '账号解绑确认已建立'
      );

    } catch (error) {
      if (
        error?.code ===
        'IDENTITY_ACCOUNT_RETURN_TO_INVALID'
      ) {
        return this.responseHelper.validation(
          res,
          ['return_to无效'],
          '账号操作返回位置无效'
        );
      }

      this._logProtocolFailure(
        purpose === 'bind'
          ? 'Identity账号关联发起失败'
          : 'Identity账号解绑发起失败',
        error
      );

      return this.responseHelper.error(
        res,
        '统一身份账号操作暂时不可用',
        503
      );
    }
  }

  /**
   * GET /api/auth/identity/callback
   *
   * bind与unlink共用Identity的bind-purpose redirect。
   * 本地userId只能来自已经原子消费的Flow，不从callback Query读取。
   */
  async accountCallback(req, res) {
    this._setNoStore(res);

    let flow;

    try {
      const state =
        IdentityAuthController._readRequiredQueryString(
          req,
          'state'
        );

      flow =
        await this.flowService.consumeFlow(
          state
        );

      if (flow.purpose !== 'bind' &&
          flow.purpose !== 'unlink') {
        return this._redirectAccountFailure(
          res,
          'purpose_mismatch'
        );
      }

      const oauthError =
        IdentityAuthController._readOptionalQueryString(
          req,
          'error'
        );

      if (oauthError) {
        return this._redirectAccountFailure(
          res,
          'authorization_failed'
        );
      }

      const code =
        IdentityAuthController._readRequiredQueryString(
          req,
          'code'
        );

      const identityResult =
        await this.oidcService.completeAuthorization({
          code,
          codeVerifier: flow.codeVerifier,
          nonce: flow.nonce,
          purpose: flow.purpose
        });

      const localUserID =
        IdentityFlowService.normalizeLocalUserId(
          flow.localUserId
        );

      const user =
        await this.userModel.findById(
          Number(localUserID)
        );

      if (!user ||
          String(user.id) !== localUserID ||
          user.status !== 'active' ||
          user.isAccountExpired()) {
        return this._redirectAccountFailure(
          res,
          'account_unavailable'
        );
      }

      const platformLink =
        identityResult.platformLink;

      if (!platformLink ||
          typeof platformLink.linked !== 'boolean') {
        return this._redirectAccountFailure(
          res,
          'identity_state_invalid'
        );
      }

      if (flow.purpose === 'bind') {
        return await this._completeBind(
          res,
          identityResult.subject,
          platformLink,
          localUserID,
          flow.returnTo
        );
      }

      return await this._completeUnlink(
        res,
        identityResult.subject,
        platformLink,
        localUserID
      );

    } catch (error) {
      this._logProtocolFailure(
        'Identity账号关联callback失败',
        error
      );

      if (error?.code === 'IDENTITY_LINK_CONFLICT') {
        return this._redirectAccountFailure(
          res,
          'link_conflict'
        );
      }

      return this._redirectAccountFailure(
        res,
        'callback_failed'
      );
    }
  }

  async _completeBind(
    res,
    globalPersonID,
    platformLink,
    localUserID,
    returnTo
  ) {
    if (platformLink.linked) {
      const existingLocalID =
        IdentityFlowService.normalizeLocalUserId(
          platformLink.local_account_id
        );

      if (existingLocalID !== localUserID) {
        return this._redirectAccountFailure(
          res,
          'link_conflict'
        );
      }

      return this._redirectAccountSuccess(
        res,
        'link',
        returnTo
      );
    }

    const result =
      await this.oidcService.mutatePlatformLink({
        operation: 'link',
        globalPersonId: globalPersonID,
        localAccountId: localUserID,
        traceId:
          IdentityAuthController._createTraceID()
      });

    IdentityAuthController._validateMutationResult(
      result,
      'link',
      globalPersonID,
      localUserID
    );

    return this._redirectAccountSuccess(
      res,
      'link',
      returnTo
    );
  }

  async _completeUnlink(
    res,
    globalPersonID,
    platformLink,
    localUserID
  ) {
    // 未关联已经满足最终目标，按幂等成功处理。
    if (!platformLink.linked) {
      return this._redirectAccountSuccess(
        res,
        'unlink'
      );
    }

    const existingLocalID =
      IdentityFlowService.normalizeLocalUserId(
        platformLink.local_account_id
      );

    if (existingLocalID !== localUserID) {
      return this._redirectAccountFailure(
        res,
        'link_conflict'
      );
    }

    const result =
      await this.oidcService.mutatePlatformLink({
        operation: 'unlink',
        globalPersonId: globalPersonID,
        localAccountId: localUserID,
        traceId:
          IdentityAuthController._createTraceID()
      });

    IdentityAuthController._validateMutationResult(
      result,
      'unlink',
      globalPersonID,
      localUserID
    );

    return this._redirectAccountSuccess(
      res,
      'unlink'
    );
  }

  _redirectLoginFailure(
    res,
    code
  ) {
    return res.redirect(
      302,
      IdentityAuthController._buildLocalResultURL(
        LOGIN_FAILURE_PATH,
        {
          identity_error: code
        }
      )
    );
  }

  _redirectAccountFailure(
    res,
    code
  ) {
    return res.redirect(
      302,
      IdentityAuthController._buildLocalResultURL(
        ACCOUNT_RESULT_PATH,
        {
          identity_error: code
        }
      )
    );
  }

  _redirectAccountSuccess(
    res,
    operation,
    returnTo = ACCOUNT_RESULT_PATH
  ) {
    const purpose =
      operation === 'link'
        ? 'bind'
        : 'unlink';

    const normalizedReturnTo =
      IdentityAccountReturnToPolicy
        .normalize(
          purpose,
          returnTo
        );

    // Capability场景：
    // bind成功后直接继续服务器Flow里已经验证过的AI平台能力入口。
    if (
      operation === 'link' &&
      normalizedReturnTo !==
        ACCOUNT_RESULT_PATH
    ) {
      return res.redirect(
        302,
        normalizedReturnTo
      );
    }

    // 普通Profile link/unlink继续保持既有结果页合同。
    const params =
      operation === 'link'
        ? { identity_link: 'success' }
        : { identity_unlink: 'success' };

    return res.redirect(
      302,
      IdentityAuthController._buildLocalResultURL(
        ACCOUNT_RESULT_PATH,
        params
      )
    );
  }

  _setNoStore(res) {
    if (res &&
        typeof res.set === 'function') {
      res.set(
        'Cache-Control',
        'no-store, no-cache, must-revalidate'
      );

      res.set(
        'Pragma',
        'no-cache'
      );

      res.set(
        'Referrer-Policy',
        'no-referrer'
      );
    }
  }

  _logProtocolFailure(
    message,
    error
  ) {
    this.logger.warn(
      message,
      {
        code:
          error?.code || 'internal_error'
      }
    );
  }

  static _readRequiredQueryString(
    req,
    name
  ) {
    const value =
      req?.query?.[name];

    if (typeof value !== 'string' ||
        value.length < 1) {
      throw IdentityAuthController._error(
        'IDENTITY_QUERY_INVALID',
        `缺少${name}`
      );
    }

    return value;
  }

  static _readOptionalQueryString(
    req,
    name
  ) {
    const value =
      req?.query?.[name];

    if (value === undefined ||
        value === null ||
        value === '') {
      return '';
    }

    if (typeof value !== 'string') {
      throw IdentityAuthController._error(
        'IDENTITY_QUERY_INVALID',
        `${name}格式无效`
      );
    }

    return value;
  }

  static _readRequiredBodyString(
    req,
    name
  ) {
    const value =
      req?.body?.[name];

    if (typeof value !== 'string' ||
        value.length < 1) {
      throw IdentityAuthController._error(
        'IDENTITY_BODY_INVALID',
        `缺少${name}`
      );
    }

    return value;
  }

  static _buildLocalResultURL(
    path,
    params
  ) {
    const query =
      new URLSearchParams(params);

    return `${path}?${query.toString()}`;
  }

  static _createTraceID() {
    return `ai-identity:${crypto.randomUUID()}`;
  }

  static _validateMutationResult(
    result,
    operation,
    globalPersonID,
    localUserID
  ) {
    if (!result ||
        result.schema_version !== 1 ||
        result.operation !== operation ||
        result.outcome !== 'success' ||
        result.global_person_id !== globalPersonID ||
        result.local_account_id !== localUserID ||
        result.retryable !== false) {
      throw IdentityAuthController._error(
        'IDENTITY_MUTATION_INVALID',
        'Identity Backchannel结果与请求不一致'
      );
    }
  }

  static _error(
    code,
    message
  ) {
    const error =
      new Error(message);

    error.code = code;

    return error;
  }
}

const identityAuthController =
  new IdentityAuthController();

module.exports =
  identityAuthController;

module.exports.IdentityAuthController =
  IdentityAuthController;

const {
  IdentityAuthController
} = require('../../../controllers/IdentityAuthController');

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    redirectCode: null,
    redirectURL: null,
    headers: {},

    set(name, value) {
      this.headers[name] = value;
      return this;
    },

    status(code) {
      this.statusCode = code;
      return this;
    },

    json(payload) {
      this.body = payload;
      return this;
    },

    redirect(code, url) {
      this.redirectCode = code;
      this.redirectURL = url;
      return this;
    }
  };
}

function createResponseHelper() {
  return {
    success(
      res,
      data,
      message = 'Success',
      code = 200
    ) {
      res.statusCode = code;
      res.body = {
        success: true,
        code,
        message,
        data
      };

      return res;
    },

    error(
      res,
      message,
      code = 500,
      data = null
    ) {
      res.statusCode = code;
      res.body = {
        success: false,
        code,
        message,
        data
      };

      return res;
    },

    unauthorized(
      res,
      message = 'Unauthorized'
    ) {
      res.statusCode = 401;
      res.body = {
        success: false,
        code: 401,
        message
      };

      return res;
    },

    validation(
      res,
      errors,
      message
    ) {
      res.statusCode = 400;
      res.body = {
        success: false,
        code: 400,
        message,
        data: {
          errors
        }
      };

      return res;
    }
  };
}

function createActiveUser(
  id = 128
) {
  return {
    id,
    username: 'teacher128',
    status: 'active',

    isAccountExpired:
      jest.fn(() => false)
  };
}

function buildController({
  flowOverrides = {},
  oidcOverrides = {},
  userOverrides = {},
  authOverrides = {}
} = {}) {
  const flowService = {
    createFlow:
      jest.fn(async ({
        purpose,
        localUserId = null,
        returnTo
      }) => ({
        state: 'S'.repeat(43),
        nonce: 'N'.repeat(43),
        codeChallenge: 'C'.repeat(43),
        purpose,
        localUserId:
          localUserId === null
            ? null
            : String(localUserId),
        returnTo:
          returnTo || '/dashboard'
      })),

    consumeFlow:
      jest.fn(async () => ({
        version: 1,
        purpose: 'login',
        nonce: 'N'.repeat(43),
        codeVerifier: 'V'.repeat(43),
        localUserId: null,
        returnTo: '/dashboard'
      })),

    createHandoff:
      jest.fn(async ({
        userId,
        returnTo
      }) => ({
        ticket: 'H'.repeat(43),
        userId: String(userId),
        returnTo
      })),

    consumeHandoff:
      jest.fn(async () => ({
        version: 1,
        userId: '128',
        returnTo: '/dashboard'
      })),

    ...flowOverrides
  };

  const oidcService = {
    buildAuthorizationURL:
      jest.fn(() =>
        'https://id.pkuailab.com/oauth/authorize?client_id=ai-platform-client'
      ),

    completeAuthorization:
      jest.fn(async () => ({
        subject:
          '55a8827b-06af-47de-a3b0-743fd889711e',

        platformLink: {
          linked: true,
          local_account_id: '128'
        }
      })),

    mutatePlatformLink:
      jest.fn(async ({
        operation,
        globalPersonId,
        localAccountId
      }) => ({
        schema_version: 1,
        global_person_id:
          globalPersonId,
        local_account_id:
          String(localAccountId),
        operation,
        outcome: 'success',
        state:
          operation === 'link'
            ? 'linked'
            : 'unlinked',
        idempotent_replay: false,
        retryable: false
      })),

    ...oidcOverrides
  };

  const userModel = {
    findById:
      jest.fn(async () =>
        createActiveUser(128)
      ),

    ...userOverrides
  };

  const localAuthController = {
    _handleLoginSuccess:
      jest.fn(async (
        user,
        res,
        isSSOUser,
        loginMethod
      ) => {
        res.statusCode = 200;

        res.body = {
          success: true,
          data: {
            userId: user.id,
            isSSOUser,
            loginMethod,
            accessToken:
              'local-access-token',
            refreshToken:
              'local-refresh-token'
          }
        };

        return res;
      }),

    ...authOverrides
  };

  const logger = {
    warn: jest.fn()
  };

  const controller =
    new IdentityAuthController({
      flowService,
      oidcService,
      userModel,
      localAuthController,
      responseHelper:
        createResponseHelper(),
      appLogger: logger
    });

  return {
    controller,
    flowService,
    oidcService,
    userModel,
    localAuthController,
    logger
  };
}

describe(
  'IdentityAuthController',
  () => {
    test(
      'login start由本平台生成Flow并302进入Identity',
      async () => {
        const {
          controller,
          flowService,
          oidcService
        } =
          buildController();

        const req = {
          query: {
            return_to:
              '/wiki?source=portal'
          }
        };

        const res =
          createResponse();

        await controller.startLogin(
          req,
          res
        );

        expect(
          flowService.createFlow
        ).toHaveBeenCalledWith({
          purpose: 'login',
          returnTo:
            '/wiki?source=portal'
        });

        expect(
          oidcService
            .buildAuthorizationURL
        ).toHaveBeenCalled();

        expect(res.redirectCode)
          .toBe(302);

        expect(res.redirectURL)
          .toContain(
            'https://id.pkuailab.com/'
          );
      }
    );

    test(
      'login callback只把一次性handoff放进前端URL',
      async () => {
        const {
          controller,
          flowService
        } =
          buildController();

        const req = {
          query: {
            state: 'S'.repeat(43),
            code: 'identity-code'
          }
        };

        const res =
          createResponse();

        await controller.loginCallback(
          req,
          res
        );

        expect(
          flowService.createHandoff
        ).toHaveBeenCalledWith({
          userId: 128,
          returnTo: '/dashboard'
        });

        expect(res.redirectCode)
          .toBe(302);

        expect(res.redirectURL)
          .toContain(
            '/auth/identity/callback?'
          );

        expect(res.redirectURL)
          .toContain(
            `handoff=${'H'.repeat(43)}`
          );

        expect(res.redirectURL)
          .not.toContain(
            'access_token'
          );

        expect(res.redirectURL)
          .not.toContain(
            'id_token'
          );

        expect(res.redirectURL)
          .not.toContain(
            'local-access-token'
          );
      }
    );

    test(
      '未关联自然人登录必须失败关闭',
      async () => {
        const {
          controller,
          flowService
        } =
          buildController({
            oidcOverrides: {
              completeAuthorization:
                jest.fn(
                  async () => ({
                    subject:
                      '55a8827b-06af-47de-a3b0-743fd889711e',

                    platformLink: {
                      linked: false
                    }
                  })
                )
            }
          });

        const res =
          createResponse();

        await controller.loginCallback(
          {
            query: {
              state:
                'S'.repeat(43),
              code:
                'identity-code'
            }
          },
          res
        );

        expect(
          flowService.createHandoff
        ).not.toHaveBeenCalled();

        expect(res.redirectURL)
          .toBe(
            '/login?identity_error=not_linked'
          );
      }
    );

    test(
      'consume必须复用正常本地登录成功逻辑且isSSOUser=false',
      async () => {
        const {
          controller,
          localAuthController
        } =
          buildController();

        const res =
          createResponse();

        await controller.consumeLogin(
          {
            body: {
              handoff:
                'H'.repeat(43)
            }
          },
          res
        );

        expect(
          localAuthController
            ._handleLoginSuccess
        ).toHaveBeenCalledTimes(1);

        const call =
          localAuthController
            ._handleLoginSuccess
            .mock.calls[0];

        expect(call[0].id)
          .toBe(128);

        expect(call[2])
          .toBe(false);

        expect(call[3])
          .toBe('统一身份登录');

        expect(res.body.data.accessToken)
          .toBe('local-access-token');
      }
    );

    test(
      'connect start必须显式确认当前账号',
      async () => {
        const {
          controller,
          flowService
        } =
          buildController();

        const res =
          createResponse();

        await controller.startConnect(
          {
            user: {
              id: 128,
              username: 'teacher128'
            },
            body: {}
          },
          res
        );

        expect(res.statusCode)
          .toBe(400);

        expect(
          flowService.createFlow
        ).not.toHaveBeenCalled();
      }
    );

    test(
      'connect start只能使用req.user中的本地账号',
      async () => {
        const {
          controller,
          flowService
        } =
          buildController();

        const res =
          createResponse();

        await controller.startConnect(
          {
            user: {
              id: 128,
              username: 'teacher128'
            },

            body: {
              confirm_current_account: true,
              local_user_id: 999,
              return_to: '/profile'
            }
          },
          res
        );

        expect(res.statusCode)
          .toBe(200);

        expect(
          flowService.createFlow
        ).toHaveBeenCalledWith({
          purpose: 'bind',
          localUserId: '128',
          returnTo: '/profile'
        });
      }
    );

    test(
      'bind callback绑定的local_account_id固定来自Flow里的users.id',
      async () => {
        const {
          controller,
          oidcService
        } =
          buildController({
            flowOverrides: {
              consumeFlow:
                jest.fn(
                  async () => ({
                    version: 1,
                    purpose: 'bind',
                    nonce:
                      'N'.repeat(43),
                    codeVerifier:
                      'V'.repeat(43),
                    localUserId: '128',
                    returnTo: '/profile'
                  })
                )
            },

            oidcOverrides: {
              completeAuthorization:
                jest.fn(
                  async () => ({
                    subject:
                      '55a8827b-06af-47de-a3b0-743fd889711e',

                    platformLink: {
                      linked: false
                    }
                  })
                )
            }
          });

        const res =
          createResponse();

        await controller.accountCallback(
          {
            query: {
              state:
                'S'.repeat(43),
              code:
                'identity-code'
            }
          },
          res
        );

        expect(
          oidcService
            .mutatePlatformLink
        ).toHaveBeenCalledTimes(1);

        const input =
          oidcService
            .mutatePlatformLink
            .mock.calls[0][0];

        expect(input.operation)
          .toBe('link');

        expect(input.localAccountId)
          .toBe('128');

        expect(input)
          .not.toHaveProperty(
            'clientSecret'
          );

        expect(res.redirectURL)
          .toBe(
            '/profile?identity_link=success'
          );
      }
    );

    test(
      'unlink callback只允许解绑当前Flow对应的本地账号',
      async () => {
        const {
          controller,
          oidcService
        } =
          buildController({
            flowOverrides: {
              consumeFlow:
                jest.fn(
                  async () => ({
                    version: 1,
                    purpose: 'unlink',
                    nonce:
                      'N'.repeat(43),
                    codeVerifier:
                      'V'.repeat(43),
                    localUserId: '128',
                    returnTo: '/profile'
                  })
                )
            }
          });

        const res =
          createResponse();

        await controller.accountCallback(
          {
            query: {
              state:
                'S'.repeat(43),
              code:
                'identity-code'
            }
          },
          res
        );

        expect(
          oidcService
            .mutatePlatformLink
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            operation: 'unlink',
            localAccountId: '128'
          })
        );

        expect(res.redirectURL)
          .toBe(
            '/profile?identity_unlink=success'
          );
      }
    );
  }
);

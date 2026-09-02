jest.mock(
  '../../models/User',
  () => ({})
);

jest.mock(
  '../../controllers/AuthControllerRefactored',
  () => ({})
);

jest.mock(
  '../../utils/response',
  () => ({})
);

jest.mock(
  '../../utils/logger',
  () => ({
    warn: jest.fn()
  })
);

jest.mock(
  '../../services/auth/IdentityFlowService',
  () => {
    class IdentityFlowService {
      static normalizeLocalUserId(
        value
      ) {
        const normalized =
          String(value ?? '');

        if (
          !/^[1-9][0-9]*$/.test(
            normalized
          )
        ) {
          throw new Error(
            'invalid local user'
          );
        }

        return normalized;
      }

      static normalizeReturnTo(
        value
      ) {
        if (
          typeof value !== 'string' ||
          !value.startsWith('/') ||
          value.startsWith('//') ||
          value.includes('\\')
        ) {
          const error =
            new Error(
              'invalid returnTo'
            );

          error.code =
            'IDENTITY_RETURN_TO_INVALID';

          throw error;
        }

        return value;
      }
    }

    return {
      IdentityFlowService
    };
  }
);

jest.mock(
  '../../services/auth/IdentityOIDCService',
  () => ({})
);

const {
  IdentityAuthController
} = require(
  '../../controllers/IdentityAuthController'
);

const SUBJECT =
  '11111111-2222-4333-8444-555555555555';

function createResponse() {
  return {
    set:
      jest.fn(),

    redirect:
      jest.fn(
        (
          status,
          location
        ) => ({
          status,
          location
        })
      )
  };
}

function createController({
  purpose = 'bind',
  returnTo = '/profile',
  platformLink = {
    linked: false
  }
} = {}) {
  const flowService = {
    consumeFlow:
      jest.fn()
        .mockResolvedValue({
          purpose,
          localUserId: '42',
          returnTo,
          codeVerifier:
            'test-code-verifier',
          nonce:
            'test-nonce'
        })
  };

  const oidcService = {
    completeAuthorization:
      jest.fn()
        .mockResolvedValue({
          subject: SUBJECT,
          platformLink
        }),

    mutatePlatformLink:
      jest.fn()
        .mockResolvedValue({
          schema_version: 1,
          operation: 'link',
          outcome: 'success',
          global_person_id:
            SUBJECT,
          local_account_id:
            '42',
          retryable: false
        })
  };

  const userModel = {
    findById:
      jest.fn()
        .mockResolvedValue({
          id: 42,
          status: 'active',
          isAccountExpired:
            () => false
        })
  };

  const responseHelper = {
    unauthorized:
      jest.fn(),

    validation:
      jest.fn(),

    error:
      jest.fn()
  };

  const controller =
    new IdentityAuthController({
      flowService,
      oidcService,
      userModel,
      localAuthController: {},
      responseHelper,
      appLogger: {
        warn:
          jest.fn()
      }
    });

  return {
    controller,
    oidcService
  };
}

function createRequest() {
  return {
    query: {
      state:
        'test-state',
      code:
        'test-code'
    }
  };
}

describe(
  'Identity Capability continuation',
  () => {
    test(
      '新建bind成功后继续图片生成landing',
      async () => {
        const {
          controller,
          oidcService
        } =
          createController({
            returnTo:
              '/image'
          });

        const res =
          createResponse();

        await controller.accountCallback(
          createRequest(),
          res
        );

        expect(
          oidcService.mutatePlatformLink
        ).toHaveBeenCalledTimes(1);

        expect(
          res.redirect
        ).toHaveBeenCalledWith(
          302,
          '/image'
        );
      }
    );

    test(
      '已关联同账号也继续Capability landing',
      async () => {
        const {
          controller,
          oidcService
        } =
          createController({
            returnTo:
              '/agent',

            platformLink: {
              linked: true,
              local_account_id:
                '42'
            }
          });

        const res =
          createResponse();

        await controller.accountCallback(
          createRequest(),
          res
        );

        expect(
          oidcService.mutatePlatformLink
        ).not.toHaveBeenCalled();

        expect(
          res.redirect
        ).toHaveBeenCalledWith(
          302,
          '/agent'
        );
      }
    );

    test(
      '普通Profile关联保持原成功结果',
      async () => {
        const {
          controller
        } =
          createController({
            returnTo:
              '/profile',

            platformLink: {
              linked: true,
              local_account_id:
                '42'
            }
          });

        const res =
          createResponse();

        await controller.accountCallback(
          createRequest(),
          res
        );

        expect(
          res.redirect
        ).toHaveBeenCalledWith(
          302,
          '/profile?identity_link=success'
        );
      }
    );

    test(
      '无关站内路径必须fail closed',
      async () => {
        const {
          controller
        } =
          createController({
            returnTo:
              '/admin/users',

            platformLink: {
              linked: true,
              local_account_id:
                '42'
            }
          });

        const res =
          createResponse();

        await controller.accountCallback(
          createRequest(),
          res
        );

        expect(
          res.redirect
        ).toHaveBeenCalledWith(
          302,
          '/profile?identity_error=callback_failed'
        );
      }
    );

    test(
      '外部returnTo不能成为重定向目标',
      async () => {
        const {
          controller
        } =
          createController({
            returnTo:
              'https://example.com',

            platformLink: {
              linked: true,
              local_account_id:
                '42'
            }
          });

        const res =
          createResponse();

        await controller.accountCallback(
          createRequest(),
          res
        );

        expect(
          res.redirect
        ).toHaveBeenCalledWith(
          302,
          '/profile?identity_error=callback_failed'
        );
      }
    );

    test(
      'unlink始终保持Profile结果页',
      async () => {
        const {
          controller
        } =
          createController({
            purpose:
              'unlink',

            returnTo:
              '/profile',

            platformLink: {
              linked: false
            }
          });

        const res =
          createResponse();

        await controller.accountCallback(
          createRequest(),
          res
        );

        expect(
          res.redirect
        ).toHaveBeenCalledWith(
          302,
          '/profile?identity_unlink=success'
        );
      }
    );
  }
);

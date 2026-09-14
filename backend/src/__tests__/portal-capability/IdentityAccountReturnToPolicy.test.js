jest.mock(
  '../../services/auth/IdentityFlowService',
  () => {
    class IdentityFlowService {
      static normalizeReturnTo(
        value
      ) {
        if (
          typeof value !== 'string' ||
          value.length < 1 ||
          !value.startsWith('/') ||
          value.startsWith('//') ||
          value.includes('\\') ||
          /[\x00-\x1F\x7F]/.test(
            value
          )
        ) {
          const error =
            new Error(
              'invalid return_to'
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

const {
  IdentityAccountReturnToPolicy,
  ACCOUNT_RESULT_PATH,
  ACCOUNT_BIND_RETURN_TO_PATHS
} = require(
  '../../services/auth/IdentityAccountReturnToPolicy'
);

describe(
  'IdentityAccountReturnToPolicy',
  () => {
    test(
      'bind允许Profile、Dashboard和8个Capability landing',
      () => {
        expect(
          ACCOUNT_BIND_RETURN_TO_PATHS
        ).toEqual([
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

        for (
          const path
          of ACCOUNT_BIND_RETURN_TO_PATHS
        ) {
          expect(
            IdentityAccountReturnToPolicy
              .normalize(
                'bind',
                path
              )
          ).toBe(path);
        }
      }
    );

    test(
      'unlink只允许Profile',
      () => {
        expect(
          IdentityAccountReturnToPolicy
            .normalize(
              'unlink',
              ACCOUNT_RESULT_PATH
            )
        ).toBe('/profile');

        expect(
          () =>
            IdentityAccountReturnToPolicy
              .normalize(
                'unlink',
                '/image'
              )
        ).toThrow(
          '解绑操作只能返回个人中心'
        );
      }
    );

    test(
      'bind拒绝无关站内管理路径',
      () => {
        expect(
          () =>
            IdentityAccountReturnToPolicy
              .normalize(
                'bind',
                '/admin/users'
              )
        ).toThrow(
          '账号关联返回位置不在允许范围'
        );
      }
    );

    test(
      '未知purpose必须fail closed',
      () => {
        expect(
          () =>
            IdentityAccountReturnToPolicy
              .normalize(
                'unknown',
                '/image'
              )
        ).toThrow(
          '账号关联返回位置不在允许范围'
        );
      }
    );

    test(
      '站外URL必须拒绝',
      () => {
        expect(
          () =>
            IdentityAccountReturnToPolicy
              .normalize(
                'bind',
                'https://example.com'
              )
        ).toThrow(
          'invalid return_to'
        );
      }
    );

    test(
      '协议相对URL必须拒绝',
      () => {
        expect(
          () =>
            IdentityAccountReturnToPolicy
              .normalize(
                'bind',
                '//example.com/image'
              )
        ).toThrow(
          'invalid return_to'
        );
      }
    );
  }
);

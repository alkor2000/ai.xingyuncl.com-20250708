import {
  afterEach,
  describe,
  expect,
  it
} from 'vitest'

import {
  buildPortalConnectPostLoginTarget,
  getPortalConnectAuthFailureRedirect,
  getPortalConnectCapabilityFromProfileSearch,
  isPortalConnectLoginLocation,
  isPortalConnectProfileSearch,
  shouldHoldPortalConnectLoginRoute
} from './portalIdentityConnect'

import {
  buildPortalConnectPostLoginContinuation
} from './portalIdentityConnectContinuation'

describe(
  'Portal Connect Capability continuation',
  () => {
    afterEach(() => {
      window.history.replaceState(
        {},
        '',
        '/'
      )
    })

    it(
      'accepts exact combined profile entry',
      () => {
        const search =
          '?portal_connect=identity' +
          '&portal_capability=ai-practice.image'

        expect(
          isPortalConnectProfileSearch(
            search
          )
        ).toBe(true)

        expect(
          getPortalConnectCapabilityFromProfileSearch(
            search
          )
        ).toBe(
          'ai-practice.image'
        )
      }
    )

    it(
      'keeps capability after local login',
      () => {
        const location = {
          pathname: '/login',
          search:
            '?portal_connect=account' +
            '&portal_capability=ai-practice.image',
          hash: '',
          state: null
        }

        expect(
          isPortalConnectLoginLocation(
            location
          )
        ).toBe(true)

        expect(
          buildPortalConnectPostLoginTarget(
            location
          )
        ).toBe(
          '/profile?portal_connect=identity' +
          '&portal_capability=ai-practice.image'
        )
      }
    )

    it(
      '刚完成本地登录且无Capability时自动绑定后进入Dashboard',
      () => {
        const location = {
          pathname: '/login',
          search:
            '?portal_connect=account',
          hash: '',
          state: null
        }

        expect(
          buildPortalConnectPostLoginContinuation(
            location
          )
        ).toEqual({
          endpoint:
            '/auth/identity/connect/start',

          fallbackTarget:
            '/profile?portal_connect=identity',

          body: {
            confirm_current_account:
              true,

            return_to:
              '/dashboard'
          }
        })
      }
    )

    it(
      '自动续接保留合法Capability landing',
      () => {
        const location = {
          pathname: '/login',
          search:
            '?portal_connect=account' +
            '&portal_capability=ai-practice.image',
          hash: '',
          state: null
        }

        expect(
          buildPortalConnectPostLoginContinuation(
            location
          )
        ).toEqual({
          endpoint:
            '/auth/identity/connect/start',

          fallbackTarget:
            '/profile?portal_connect=identity' +
            '&portal_capability=ai-practice.image',

          body: {
            confirm_current_account:
              true,

            return_to:
              '/image'
          }
        })
      }
    )

    it(
      '已认证Portal Login保持挂载直到Identity顶层跳转',
      () => {
        const location = {
          pathname: '/login',
          search:
            '?portal_connect=account',
          hash: '',
          state: null
        }

        expect(
          shouldHoldPortalConnectLoginRoute(
            location,
            true
          )
        ).toBe(true)
      }
    )

    it(
      'ProtectedRoute保存的Portal来源在认证后也保持Login',
      () => {
        const location = {
          pathname: '/login',
          search: '',
          hash: '',
          state: {
            from: {
              pathname: '/profile',
              search:
                '?portal_connect=identity' +
                '&portal_capability=ai-practice.image',
              hash: ''
            }
          }
        }

        expect(
          shouldHoldPortalConnectLoginRoute(
            location,
            true
          )
        ).toBe(true)
      }
    )

    it(
      '普通已认证Login仍按PublicRoute原规则跳转',
      () => {
        expect(
          shouldHoldPortalConnectLoginRoute(
            {
              pathname: '/login',
              search: '',
              hash: '',
              state: null
            },
            true
          )
        ).toBe(false)
      }
    )

    it(
      '未认证Portal Login不需要过渡保持',
      () => {
        expect(
          shouldHoldPortalConnectLoginRoute(
            {
              pathname: '/login',
              search:
                '?portal_connect=account',
              hash: '',
              state: null
            },
            false
          )
        ).toBe(false)
      }
    )

    it(
      '污染Portal Query不能触发过渡保持',
      () => {
        expect(
          shouldHoldPortalConnectLoginRoute(
            {
              pathname: '/login',
              search:
                '?portal_connect=account' +
                '&target=https://example.com',
              hash: '',
              state: null
            },
            true
          )
        ).toBe(false)
      }
    )

    it(
      '普通Login绝不生成自动绑定请求',
      () => {
        expect(
          buildPortalConnectPostLoginContinuation({
            pathname: '/login',
            search: '',
            hash: '',
            state: null
          })
        ).toBe(null)
      }
    )

    it(
      '污染的Portal Query绝不生成自动绑定请求',
      () => {
        expect(
          buildPortalConnectPostLoginContinuation({
            pathname: '/login',
            search:
              '?portal_connect=account' +
              '&target=https://example.com',
            hash: '',
            state: null
          })
        ).toBe(null)
      }
    )

    it(
      'keeps capability from ProtectedRoute state',
      () => {
        const location = {
          pathname: '/login',
          search: '',
          hash: '',
          state: {
            from: {
              pathname: '/profile',
              search:
                '?portal_connect=identity' +
                '&portal_capability=ai-practice.agent',
              hash: ''
            }
          }
        }

        expect(
          buildPortalConnectPostLoginTarget(
            location
          )
        ).toBe(
          '/profile?portal_connect=identity' +
          '&portal_capability=ai-practice.agent'
        )
      }
    )

    it(
      'keeps capability when local auth expires',
      () => {
        window.history.replaceState(
          {},
          '',
          '/profile?portal_connect=identity' +
            '&portal_capability=ai-practice.mindmap'
        )

        expect(
          getPortalConnectAuthFailureRedirect()
        ).toBe(
          '/login?portal_connect=account' +
          '&portal_capability=ai-practice.mindmap'
        )
      }
    )

    it(
      'rejects polluted unknown and duplicate capability',
      () => {
        expect(
          isPortalConnectProfileSearch(
            '?portal_connect=identity' +
            '&portal_capability=ai-practice.image' +
            '&target=https://example.com'
          )
        ).toBe(false)

        expect(
          isPortalConnectProfileSearch(
            '?portal_connect=identity' +
            '&portal_capability=ai-practice.unknown'
          )
        ).toBe(false)

        expect(
          isPortalConnectProfileSearch(
            '?portal_connect=identity' +
            '&portal_capability=ai-practice.image' +
            '&portal_capability=ai-practice.video'
          )
        ).toBe(false)
      }
    )
  }
)

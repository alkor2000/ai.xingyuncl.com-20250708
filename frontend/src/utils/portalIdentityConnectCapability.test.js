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
  isPortalConnectProfileSearch
} from './portalIdentityConnect'

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

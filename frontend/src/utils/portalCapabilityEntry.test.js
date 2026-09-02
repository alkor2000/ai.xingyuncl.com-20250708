import {
  describe,
  expect,
  it
} from 'vitest'

import {
  buildPortalCapabilityEntryPath,
  buildPortalCapabilityIdentityStartPath,
  getPortalCapabilityLandingPath,
  isPortalCapabilityEntryKey,
  readStandalonePortalCapability
} from './portalCapabilityEntry'

describe(
  'Portal Capability Adapter',
  () => {
    const cases = [
      ['ai-practice.chat', '/chat'],
      ['ai-practice.image', '/image'],
      ['ai-practice.video', '/video'],
      ['ai-practice.agent', '/agent'],
      ['ai-practice.knowledge', '/knowledge'],
      ['ai-practice.html', '/html-editor'],
      ['ai-practice.mindmap', '/mindmap'],
      ['ai-practice.storage', '/storage']
    ]

    it.each(cases)(
      '%s maps to %s',
      (
        entryKey,
        landing
      ) => {
        expect(
          isPortalCapabilityEntryKey(
            entryKey
          )
        ).toBe(true)

        expect(
          getPortalCapabilityLandingPath(
            entryKey
          )
        ).toBe(landing)
      }
    )

    it(
      'rejects unknown capability',
      () => {
        expect(
          isPortalCapabilityEntryKey(
            'ai-practice.unknown'
          )
        ).toBe(false)

        expect(
          getPortalCapabilityLandingPath(
            'ai-practice.unknown'
          )
        ).toBeNull()
      }
    )

    it(
      'requires exact standalone query',
      () => {
        expect(
          readStandalonePortalCapability(
            '?portal_capability=ai-practice.image'
          )
        ).toBe(
          'ai-practice.image'
        )

        expect(
          readStandalonePortalCapability(
            '?portal_capability=ai-practice.image&target=https://example.com'
          )
        ).toBeNull()

        expect(
          readStandalonePortalCapability(
            '?portal_capability=ai-practice.image&portal_capability=ai-practice.video'
          )
        ).toBeNull()

        expect(
          readStandalonePortalCapability(
            '?portal_capability=ai-practice.unknown'
          )
        ).toBeNull()
      }
    )

    it(
      'builds semantic entry without business URL',
      () => {
        expect(
          buildPortalCapabilityEntryPath(
            'ai-practice.image'
          )
        ).toBe(
          '/portal-capability?portal_capability=ai-practice.image'
        )
      }
    )

    it(
      'translates capability to local Identity return_to',
      () => {
        expect(
          buildPortalCapabilityIdentityStartPath(
            'ai-practice.image'
          )
        ).toBe(
          '/api/auth/identity/login/start?return_to=%2Fimage'
        )
      }
    )
  }
)

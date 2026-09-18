import { describe, expect, it, vi } from 'vitest'
vi.mock('antd', () => ({ message: { error: vi.fn() } }))
vi.mock('../../../utils/i18n', () => ({ default: { t: key => key } }))
import api from '../../../utils/api'

describe('cancelable API cleanup', () => {
  it('returns the original rejection without a detached unhandled cleanup rejection', async () => {
    const request = api.post('/dev/p03/failure-test', {}, {
      adapter: config => Promise.reject(Object.assign(new Error('simulated receiver unavailable'), {
        config, response: { status: 503, data: { error: { code: 'receiver_unavailable' } } }
      }))
    })
    expect(request.cancel).toBeTypeOf('function')
    await expect(request).rejects.toThrow('simulated receiver unavailable')
    // Let any detached rejection reach Vitest's unhandled-error detector.
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  it('does not put private handoff request data into development debug logs', async () => {
    api.debug(true)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await api.post('/dev/p03/privacy-test', { grant_id: 'SIMULATED_PRIVATE_GRANT' }, {
        skipDebugLogging: true,
        adapter: async config => ({ status: 200, statusText: 'OK', data: {}, headers: {}, config })
      })
      expect(log).not.toHaveBeenCalled()
    } finally { log.mockRestore() }
  })
})

import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ArtifactHandoff, { resetCapabilityCache } from '../../../components/chat/ArtifactHandoff'
import api from '../../../utils/api'
vi.mock('../../../utils/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key, opts) => (opts?.id ? `${key}:${opts.id}` : key), i18n: { exists: () => true, language: 'zh-CN' } }) }))
const id = 'a0300000-0000-4000-8000-000000000001'
const opId = 'b0300000-0000-4000-8000-000000000002'
const ROOT = '/p03/handoffs'
const preview = { source: { version: 'sha256:original' }, text: '保留这一段\n不要这段', attachments: [{ source_id: 'file-id', version: 'sha256:file', status: 'ready', name: 'activity.md', text: 'attachment' }] }
const capability = { available: true, purposes: ['reference', 'lesson_preparation'] }
const future = Math.floor(Date.now() / 1000) + 86400
const op = (status, extra = {}) => ({ operation_id: opId, status, message_id: id, recovery_until: future + 29 * 86400, ...extra })
// GET routes: capability, list (message_id query), preview, local view.
function routes({ list = [], view = null, cap = capability, previewData = preview } = {}) {
  api.get.mockImplementation(path => {
    if (path === `${ROOT}/capability`) return Promise.resolve({ data: cap })
    if (path.startsWith(`${ROOT}?message_id=`)) return Promise.resolve({ data: { operations: list } })
    if (path === `${ROOT}/messages/${id}`) return Promise.resolve({ data: previewData })
    if (path === `${ROOT}/${opId}`) return Promise.resolve({ data: view })
    return Promise.reject(new Error(`unexpected GET ${path}`))
  })
}
const failure = (code, retryable = false, status = 409) => ({ response: { status, data: { error: { code, retryable }, request_id: 'req-1' } } })
beforeEach(() => { vi.clearAllMocks(); api.get.mockReset(); api.post.mockReset(); resetCapabilityCache() })
const click = key => fireEvent.click(screen.getByRole('button', { name: `chat.handoff.${key}` }))
const posts = () => api.post.mock.calls.map(call => call[0])
async function open(options) {
  routes(options)
  render(<ArtifactHandoff messageId={id} />)
  fireEvent.click(await screen.findByRole('button', { name: 'chat.handoff.entry' }))
}
describe('save to lesson library entry', () => {
  it('renders nothing at all when the deployment reports the handoff as unavailable or the capability call fails', async () => {
    api.get.mockResolvedValueOnce({ data: { available: false, reason: 'disabled' } })
    const { unmount } = render(<ArtifactHandoff messageId={id} />)
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(`${ROOT}/capability`, { skipDebugLogging: true, skipErrorMessage: true }))
    expect(screen.queryByRole('button')).toBeNull(); unmount(); resetCapabilityCache()
    api.get.mockRejectedValueOnce(new Error('offline'))
    render(<ArtifactHandoff messageId={id} />)
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('button')).toBeNull()
    expect(api.post).not.toHaveBeenCalled()
  })
  it('sends nothing before the explicit confirm; then freezes exactly the chosen range/attachments and saves once', async () => {
    await open(); await screen.findByTestId('handoff-selection')
    fireEvent.click(screen.getByRole('radio', { name: 'chat.p03.range' }))
    expect(screen.getByRole('button', { name: 'chat.handoff.toPreview' })).toBeDisabled()
    const input = screen.getByRole('textbox', { name: 'chat.p03.original' }); input.focus(); input.setSelectionRange(0, 5); fireEvent.select(input)
    fireEvent.click(screen.getByRole('checkbox', { name: 'activity.md' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'chat.handoff.titleLabel' }), { target: { value: '  分数教学要点  ' } })
    click('toPreview')
    expect(screen.getByTestId('handoff-preview').textContent).toBe('保留这一段')
    expect(screen.getByText('chat.handoff.targetValue')).toBeTruthy()
    expect(api.post).not.toHaveBeenCalled() // preview is local: zero sends before confirm
    api.post.mockResolvedValueOnce({ data: op('ready') }).mockResolvedValueOnce({ data: op('succeeded', { resource_ref: 'r-1', last_synced_at: Date.now() }) })
    fireEvent.click(screen.getByTestId('handoff-confirm'))
    await waitFor(() => expect(screen.getByTestId('handoff-status').textContent).toBe('chat.handoff.status.succeeded'))
    expect(posts()).toEqual([ROOT, `${ROOT}/${opId}/save`])
    const [path, body, config] = api.post.mock.calls[0]
    expect(path).toBe(ROOT)
    expect(body).toEqual({ schema_version: 1, message_id: id, expected_version: 'sha256:original', selection: { start: 0, end: 5 }, attachments: [{ source_id: 'file-id', expected_version: 'sha256:file' }], purpose: 'reference', title: '分数教学要点' })
    expect(config.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/)
    expect(screen.getByText('chat.handoff.statusHint.succeeded')).toBeTruthy()
    expect(screen.queryByTestId('handoff-retry')).toBeNull()
  })
  it('ignores a duplicate confirm click while the first save is in flight and reuses the same idempotency key on retry', async () => {
    await open({ view: op('unknown', { last_error: 'target_unavailable' }) }); await screen.findByTestId('handoff-selection'); click('toPreview')
    let release
    api.post.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    fireEvent.click(screen.getByTestId('handoff-confirm')); fireEvent.click(screen.getByTestId('handoff-confirm'))
    expect(api.post).toHaveBeenCalledTimes(1)
    api.post.mockRejectedValueOnce(failure('target_unavailable', true, 503))
    release({ data: op('ready') })
    await screen.findByTestId('handoff-error')
    expect(screen.getByText('chat.handoff.error.target_unavailable')).toBeTruthy()
    expect(screen.getByText('chat.handoff.requestId:req-1')).toBeTruthy()
    expect(posts()).toEqual([ROOT, `${ROOT}/${opId}/save`])
    expect(screen.getByTestId('handoff-status').textContent).toBe('chat.handoff.status.unknown') // server view, not a guess
    // The failed save left a retryable operation; retry resumes the same operation (no second freeze).
    api.post.mockResolvedValueOnce({ data: op('succeeded') })
    fireEvent.click(await screen.findByTestId('handoff-retry'))
    await waitFor(() => expect(screen.getByTestId('handoff-status').textContent).toBe('chat.handoff.status.succeeded'))
    expect(posts()).toEqual([ROOT, `${ROOT}/${opId}/save`, `${ROOT}/${opId}/save`])
  })
  it('keeps the same idempotency key for the same selection and mints a new one after the selection changes', async () => {
    await open(); await screen.findByTestId('handoff-selection'); click('toPreview')
    api.post.mockRejectedValueOnce(new Error('connection lost'))
    fireEvent.click(screen.getByTestId('handoff-confirm'))
    await screen.findByText('chat.handoff.error.network_error')
    expect(screen.getByTestId('handoff-preview')).toBeTruthy() // nothing frozen: still on the preview step
    api.post.mockRejectedValueOnce(new Error('connection lost'))
    fireEvent.click(screen.getByTestId('handoff-confirm'))
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2))
    expect(api.post.mock.calls[0][2].headers['Idempotency-Key']).toBe(api.post.mock.calls[1][2].headers['Idempotency-Key'])
    click('back')
    fireEvent.change(screen.getByRole('textbox', { name: 'chat.handoff.titleLabel' }), { target: { value: '另一个标题' } })
    click('toPreview')
    api.post.mockResolvedValueOnce({ data: op('ready') }).mockResolvedValueOnce({ data: op('succeeded') })
    fireEvent.click(screen.getByTestId('handoff-confirm'))
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(4))
    expect(api.post.mock.calls[2][2].headers['Idempotency-Key']).not.toBe(api.post.mock.calls[0][2].headers['Idempotency-Key'])
  })
  it('recovers an existing operation after a reload from the local list without any preview or peer call', async () => {
    await open({ list: [op('unknown', { last_error: 'target_unavailable', last_synced_at: Date.now() })] })
    await waitFor(() => expect(screen.getByTestId('handoff-status').textContent).toBe('chat.handoff.status.unknown'))
    expect(api.get.mock.calls.some(call => call[0] === `${ROOT}/messages/${id}`)).toBe(false)
    expect(api.post).not.toHaveBeenCalled()
    api.post.mockResolvedValueOnce({ data: op('recycled', { recycle_until: future + 30 * 86400, resource_ref: 'r-1' }) })
    fireEvent.click(screen.getByTestId('handoff-refresh'))
    await waitFor(() => expect(screen.getByTestId('handoff-status').textContent).toBe('chat.handoff.status.recycled'))
    expect(posts()).toEqual([`${ROOT}/${opId}/refresh`])
    expect(screen.getByText('chat.handoff.statusHint.recycled')).toBeTruthy()
    expect(screen.queryByTestId('handoff-retry')).toBeNull()
  })
  it('shows a terminal state as-is and stops querying past the recovery window', async () => {
    await open({ list: [op('deleted', { recovery_until: Math.floor(Date.now() / 1000) - 10 })] })
    await waitFor(() => expect(screen.getByTestId('handoff-status').textContent).toBe('chat.handoff.status.deleted'))
    expect(screen.getByText('chat.handoff.statusHint.pastR')).toBeTruthy()
    expect(screen.queryByTestId('handoff-refresh')).toBeNull()
    expect(screen.queryByTestId('handoff-retry')).toBeNull()
    expect(api.post).not.toHaveBeenCalled()
  })
  it('surfaces an eligibility refusal from the preview call and offers nothing to send', async () => {
    routes(); api.get.mockImplementation(path => {
      if (path === `${ROOT}/capability`) return Promise.resolve({ data: capability })
      if (path.startsWith(`${ROOT}?message_id=`)) return Promise.resolve({ data: { operations: [] } })
      return Promise.reject(failure('subject_not_eligible', false, 403))
    })
    render(<ArtifactHandoff messageId={id} />)
    fireEvent.click(await screen.findByRole('button', { name: 'chat.handoff.entry' }))
    await screen.findByText('chat.handoff.error.subject_not_eligible')
    expect(screen.queryByTestId('handoff-confirm')).toBeNull()
    expect(screen.queryByTestId('handoff-selection')).toBeNull()
    expect(api.post).not.toHaveBeenCalled()
  })
})

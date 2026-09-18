import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ArtifactHandoffDev from '../../../components/chat/ArtifactHandoffDev'
import api from '../../../utils/api'
import { downloadBlob } from '../../../utils/canvas/download'
vi.mock('../../../utils/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../../../utils/canvas/download', () => ({ downloadBlob: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: key => key, i18n: { language: 'zh-CN', exists: () => true } }) }))
const messageId = 'a0300000-0000-4000-8000-000000000001'
const preview = { source: { object_id: messageId, version: 'sha256:old' }, text: '保留这一段\n未选内容', attachments: [] }
const snapshot = { id: 'a0300000-0000-4000-8000-000000000007', expires_at: 1900000000,
  manifest: { source: preview.source, purpose: 'reference' }, payload: { text: '保留这一段', attachments: [] } }
beforeEach(() => { vi.clearAllMocks(); api.get.mockReset(); api.post.mockReset(); window.history.replaceState({}, '', '/') })
const data = value => ({ data: value })
const click = key => fireEvent.click(screen.getByRole('button', { name: `chat.p03.${key}` }))
async function open() {
  api.get.mockResolvedValue(data(preview))
  render(<ArtifactHandoffDev messageId={messageId} />)
  click('entry')
  await screen.findByTestId('handoff-selection')
}
async function freeze() {
  api.post.mockResolvedValueOnce(data(snapshot))
  click('freeze')
  await screen.findByText('chat.p03.status.prepared')
}
describe('P03 scope and recovery UI', () => {
  it('shows exact substring and sends only source ID/version/offsets, never the conversation body', async () => {
    await open()
    expect(screen.queryByText('chat.p03.technicalDetails')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('chat.p03.original')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'chat.p03.range' }))
    expect(screen.getByRole('button', { name: 'chat.p03.freeze' })).toBeDisabled()
    const area = screen.getByLabelText('chat.p03.original')
    act(() => { area.focus(); area.setSelectionRange(0, 5); fireEvent.select(area) })
    expect(screen.getByTestId('handoff-selection')).toHaveTextContent('保留这一段')
    expect(screen.getByTestId('handoff-selection')).not.toHaveTextContent('未选内容')
    await freeze()
    expect(screen.queryByText('chat.p03.deliver')).not.toBeInTheDocument()
    expect(screen.queryByText('chat.p03.downloadManifest')).not.toBeInTheDocument()
    expect(api.post.mock.calls[0][1]).toEqual({ schema_version: 1, message_id: messageId, expected_version: 'sha256:old',
      selection: { start: 0, end: 5 }, attachments: [], purpose: 'reference' })
    expect(screen.queryByText('已保存到 TE-DNA')).not.toBeInTheDocument()
  })
  it('uses the same snapshot and request key after a lost response', async () => {
    window.history.replaceState({}, '', '/?p03Debug=1')
    await open(); await freeze()
    const details = screen.getByText('chat.p03.technicalDetails').closest('details')
    expect(details).not.toHaveAttribute('open')
    fireEvent.click(screen.getByText('chat.p03.technicalDetails'))
    api.post.mockResolvedValueOnce(data({ grant_id: 'simulated-grant' })).mockRejectedValueOnce({ response: { data: { error: { code: 'response_lost' } } } })
    api.get.mockResolvedValueOnce(data({ state: 'outcome_unknown' }))
    click('deliver')
    await screen.findByText('chat.p03.error.response_lost')
    expect(screen.getByText('chat.p03.status.outcome_unknown')).toBeInTheDocument()
    api.post.mockResolvedValueOnce(data({ state: 'mock_received' }))
    click('deliver')
    await screen.findByText('chat.p03.status.mock_received')
    const deliveries = api.post.mock.calls.filter(call => call[0].endsWith('/deliver'))
    expect(deliveries).toHaveLength(2)
    expect(deliveries[0]).toEqual(deliveries[1])
  })
  it('revalidates download permission and does not download stale in-memory content after revocation', async () => {
    await open(); await freeze()
    api.get.mockRejectedValueOnce({ response: { data: { error: { code: 'source_unavailable' } } } })
    click('downloadText')
    await screen.findByText('chat.p03.error.source_unavailable')
    expect(downloadBlob).not.toHaveBeenCalled()
  })
  it('blocks duplicate freeze while pending and retries a lost response with the same key', async () => {
    await open()
    let reject
    api.post.mockImplementationOnce(() => new Promise((resolve, fail) => { reject = fail }))
    click('freeze'); click('freeze')
    expect(api.post).toHaveBeenCalledTimes(1)
    reject(new Error('network'))
    await screen.findByText('chat.p03.error.network_error')
    api.post.mockResolvedValueOnce(data(snapshot))
    click('freeze')
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2))
    expect(api.post.mock.calls[0]).toEqual(api.post.mock.calls[1])
  })
})

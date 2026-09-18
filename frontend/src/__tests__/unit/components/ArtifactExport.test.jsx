import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ArtifactExport from '../../../components/chat/ArtifactExport'
import api from '../../../utils/api'
import { downloadBlob } from '../../../utils/canvas/download'
vi.mock('../../../utils/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../../../utils/canvas/download', () => ({ downloadBlob: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: key => key, i18n: { exists: () => true } }) }))
const id = 'a0300000-0000-4000-8000-000000000001'
const preview = { source: { version: 'sha256:original' }, text: '保留这一段\n不要这段', attachments: [{ source_id: 'file-id', version: 'sha256:file', status: 'ready', name: 'activity.md', text: 'attachment' }] }
beforeEach(() => { vi.clearAllMocks(); api.get.mockReset(); api.post.mockReset() })
const click = key => fireEvent.click(screen.getByRole('button', { name: `chat.export.${key}` }))
async function open() {
  api.get.mockResolvedValue({ data: preview })
  render(<ArtifactExport messageId={id} />); click('entry')
  await screen.findByTestId('export-selection')
}
describe('selected answer download', () => {
  it('previews exact selection and sends only version/offsets and explicitly chosen attachment IDs', async () => {
    await open(); fireEvent.click(screen.getByRole('radio', { name: 'chat.p03.range' }))
    expect(screen.getByRole('button', { name: 'chat.export.download' })).toBeDisabled()
    const input = screen.getByRole('textbox'); input.focus(); input.setSelectionRange(0, 5); fireEvent.select(input)
    expect(screen.getByTestId('export-selection').textContent).toBe('保留这一段')
    fireEvent.click(screen.getByRole('checkbox', { name: 'activity.md' }))
    const blob = new Blob(['zip']); api.post.mockResolvedValueOnce({ data: blob }); click('download')
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(blob, 'answer-a0300000.zip'))
    expect(api.post).toHaveBeenCalledWith(`/artifact-exports/messages/${id}/download`, { schema_version: 1, expected_version: preview.source.version, selection: { start: 0, end: 5 }, attachments: [{ source_id: 'file-id', expected_version: 'sha256:file' }] }, { responseType: 'blob', skipDebugLogging: true })
  })
  it('prevents duplicate clicks and retries the same selection after a network failure', async () => {
    await open(); let reject
    api.post.mockImplementationOnce(() => new Promise((resolve, fail) => { reject = fail }))
    click('download'); click('download'); expect(api.post).toHaveBeenCalledTimes(1)
    reject(new Error('connection lost')); await screen.findByText('chat.export.error.network_error')
    api.post.mockResolvedValueOnce({ data: new Blob(['zip']) }); click('download')
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    expect(api.post.mock.calls[0]).toEqual(api.post.mock.calls[1])
    expect(api.post.mock.calls[0][1].attachments).toEqual([])
  })
  it('never downloads stale preview content after revocation or source change; refresh is explicit', async () => {
    await open()
    api.post.mockRejectedValueOnce({ response: { data: { error: { code: 'source_changed' } } } }); click('download')
    await screen.findByText('chat.export.error.source_changed')
    expect(downloadBlob).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'chat.export.download' })).toBeDisabled()
    api.get.mockResolvedValueOnce({ data: { ...preview, text: 'new answer', source: { version: 'sha256:new' } } })
    fireEvent.click(screen.getByRole('button', { name: 'chat.p03.reload' }))
    await waitFor(() => expect(screen.getByTestId('export-selection').textContent).toBe('new answer'))
    expect(screen.getByRole('button', { name: 'chat.export.download' })).toBeEnabled()
  })
})

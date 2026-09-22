import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import TaskArtifactPanel, { resetCapabilityCache, setTaskContext, captureTaskContext } from '../../../components/htmlEditor/TaskArtifactPanel'
import api from '../../../utils/api'

vi.mock('../../../utils/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key, opts) => (opts?.no ? `${key}:${opts.no}` : key), i18n: { language: 'zh-CN' } }) }))

const ROOT = '/p09/website-artifacts'
const project = { id: 3, name: '校园节水网站' }
const pages = [{ id: 7, title: '首页', slug: 'home' }, { id: 8, title: '数据', slug: 'data' }]
const linkRow = (extra = {}) => ({ link_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', project_id: 3, entry_page_id: 7,
  artifact_ref: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', assignment_ref: 'assign-1', state: 'active',
  work_state: 'preview_ready', has_effective_save: true, preview_available: true, saved_at: Date.now(), revisions: [], ...extra })

function routes({ available = true, links = [] } = {}) {
  api.get.mockImplementation(path => {
    if (path === `${ROOT}/capability`) return Promise.resolve({ data: { available, source_instance: 'practice-lab', task_context_configured: true } })
    if (path === `${ROOT}/links`) return Promise.resolve({ data: { links } })
    return Promise.reject(new Error(`unexpected GET ${path}`))
  })
}
beforeEach(() => { vi.clearAllMocks(); api.get.mockReset(); api.post.mockReset(); resetCapabilityCache(); setTaskContext(null) })

describe('assignment artifact panel', () => {
  it('renders nothing when the site has not opened website artifacts', async () => {
    routes({ available: false })
    render(<TaskArtifactPanel project={project} pages={pages} />)
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(`${ROOT}/capability`, { skipDebugLogging: true, skipErrorMessage: true }))
    expect(screen.queryByTestId('p09-link')).toBeNull()
    expect(screen.queryByTestId('p09-no-context')).toBeNull()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('without a task context it offers no way to link, and it never invents an assignment', async () => {
    routes()
    render(<TaskArtifactPanel project={project} pages={pages} />)
    await screen.findByTestId('p09-no-context')
    expect(screen.queryByTestId('p09-link')).toBeNull()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('takes the task context out of the URL fragment, links the chosen entry page and sends it as a header', async () => {
    routes()
    window.history.replaceState({}, '', '/html-editor?project=3#p09_task=p09g.abc.def')
    expect(captureTaskContext()).toBe('p09g.abc.def')
    // A fragment is never sent to a server; it is also removed from the address bar immediately.
    expect(window.location.hash).not.toContain('p09_task')
    expect(window.location.search).not.toContain('p09_task')
    render(<TaskArtifactPanel project={project} pages={pages} />)
    fireEvent.click(await screen.findByTestId('p09-link'))
    fireEvent.click(screen.getByRole('button', { name: 'htmlEditor.p09.confirmLink' }))
    api.post.mockResolvedValueOnce({ data: { link: linkRow() } })
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
    const [path, body, config] = api.post.mock.calls[0]
    expect(path).toBe(`${ROOT}/links`)
    expect(body).toEqual({ schema_version: 1, project_id: 3, entry_page_id: 7 })
    expect(config.headers['X-P09-Task-Context']).toBe('p09g.abc.def')
    expect(config.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/)
    expect(JSON.stringify(body)).not.toContain('assign')          // the assignment comes only from the context
  })

  it('shows the linked state, keeps "saved is not submitted" visible and freezes a review version once', async () => {
    routes({ links: [linkRow()] })
    render(<TaskArtifactPanel project={project} pages={pages} />)
    await waitFor(() => expect(screen.getByTestId('p09-state').textContent).toBe('htmlEditor.p09.state.preview_ready'))
    expect(screen.getByText('htmlEditor.p09.submitHint')).toBeTruthy()
    api.post.mockResolvedValueOnce({ data: { revision: { revision_no: 1 } } })
    const freeze = screen.getByTestId('p09-freeze')
    fireEvent.click(freeze); fireEvent.click(freeze)                // a double click must not freeze twice
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
    expect(api.post.mock.calls[0][0]).toBe(`${ROOT}/links/${linkRow().link_id}/revisions`)
  })

  it('opens the private preview on the isolated origin in a new tab', async () => {
    routes({ links: [linkRow()] })
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<TaskArtifactPanel project={project} pages={pages} />)
    api.post.mockResolvedValueOnce({ data: { session: { open_url: 'http://preview.localhost:4599/p09/preview/open?h=token' } } })
    fireEvent.click(await screen.findByTestId('p09-preview'))
    await waitFor(() => expect(open).toHaveBeenCalledWith('http://preview.localhost:4599/p09/preview/open?h=token', '_blank', 'noopener,noreferrer'))
    open.mockRestore()
  })

  it('surfaces a refusal by its fixed code without guessing', async () => {
    routes({ links: [linkRow({ work_state: 'linked', has_effective_save: false, preview_available: false })] })
    render(<TaskArtifactPanel project={project} pages={pages} />)
    await waitFor(() => expect(screen.getByTestId('p09-state').textContent).toBe('htmlEditor.p09.state.linked'))
    expect(screen.getByTestId('p09-freeze')).toBeDisabled()
    expect(screen.getByTestId('p09-preview')).toBeDisabled()
    api.post.mockRejectedValueOnce({ response: { data: { error: { code: 'link_revoked' } } } })
    fireEvent.click(screen.getByTestId('p09-unlink'))
    fireEvent.click(await screen.findByTestId('p09-unlink-ok'))
    await waitFor(() => expect(screen.getByTestId('p09-error').textContent).toContain('htmlEditor.p09.error.link_revoked'))
  })
})

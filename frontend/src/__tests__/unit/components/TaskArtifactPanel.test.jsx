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
  work_state: 'preview_ready', has_effective_save: true, save_evidence: 'observed', save_evidence_reason: 'observed_save',
  preview_available: true, real_save_count: 2, last_real_save_at: Date.now(), saved_at: Date.now(), revisions: [], ...extra })

function routes({ available = true, links = [], submitConfigured = false } = {}) {
  api.get.mockImplementation(path => {
    if (path === `${ROOT}/capability`) return Promise.resolve({ data: { available, source_instance: 'practice-lab',
      task_context_configured: true, submit_configured: submitConfigured } })
    if (path === `${ROOT}/links`) return Promise.resolve({ data: { links } })
    return Promise.reject(new Error(`unexpected GET ${path}`))
  })
}
beforeEach(() => { vi.clearAllMocks(); api.get.mockReset(); api.post.mockReset(); resetCapabilityCache(); setTaskContext(null) })

describe('assignment artifact panel', () => {
  it('shows 未知 with its reason when the save evidence does not reach back, and still allows freezing', async () => {
    routes({ links: [linkRow({ work_state: 'unknown', has_effective_save: null, save_evidence: 'legacy_unknown',
      save_evidence_reason: 'history_before_observation', last_real_save_at: null, saved_at: null })] })
    render(<TaskArtifactPanel project={project} pages={pages} />)
    const tag = await screen.findByTestId('p09-state')
    // Never 未开始: the state and the field both say the evidence is what is unknown.
    expect(tag.textContent).toBe('htmlEditor.p09.state.unknown')
    expect(screen.getByText('htmlEditor.p09.evidence.legacy_unknown')).toBeTruthy()
    expect(screen.getByTestId('p09-freeze').disabled).toBe(false)
  })

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

  // ---- 交作业 from the editor ---------------------------------------------------------------------
  it('makes 交作业 the primary action and shows the version edu fixed, not one of our own', async () => {
    routes({ submitConfigured: true, links: [linkRow()] })
    api.post.mockResolvedValue({ data: { submission: { submitted: true, revision_ref: 'e9a1', revision_no: 2,
      submitted_at: 1790234708549, assignment_ref: 'assign-1' } } })
    render(<TaskArtifactPanel project={project} pages={pages} />)
    const button = await screen.findByTestId('p09-submit')
    fireEvent.click(button)
    await waitFor(() => expect(screen.getByTestId('p09-submitted')).toBeTruthy())
    expect(api.post).toHaveBeenCalledWith(`${ROOT}/links/${linkRow().link_id}/submissions`, { schema_version: 1 },
      expect.objectContaining({ skipDebugLogging: true }))
    // The student is told which version the teacher will see; freezing is no longer the primary button.
    expect(screen.getByTestId('p09-submitted').textContent).toContain('htmlEditor.p09.submitted:2')
    expect(screen.getByTestId('p09-freeze').className).not.toContain('ant-btn-primary')
  })

  it('shows edu\u2019s refusal as a refusal, never as handed in', async () => {
    routes({ submitConfigured: true, links: [linkRow()] })
    api.post.mockResolvedValue({ data: { submission: { submitted: false, outcome: 'refused',
      code: 'submission_limit', message: '提交次数已用完', retryable: false } } })
    render(<TaskArtifactPanel project={project} pages={pages} />)
    fireEvent.click(await screen.findByTestId('p09-submit'))
    await waitFor(() => expect(screen.getByTestId('p09-submit-refusal')).toBeTruthy())
    // edu's own sentence, shown as it is; nothing claims 已交.
    expect(screen.getByText('提交次数已用完')).toBeTruthy()
    expect(screen.queryByTestId('p09-submitted')).toBeNull()
  })

  it('a lost answer says the result cannot be confirmed — not that it was refused or not handed in', async () => {
    routes({ submitConfigured: true, links: [linkRow()] })
    api.post.mockResolvedValue({ data: { submission: { submitted: false, outcome: 'unknown',
      code: 'submit_unavailable', retryable: true } } })
    render(<TaskArtifactPanel project={project} pages={pages} />)
    fireEvent.click(await screen.findByTestId('p09-submit'))
    // Its own box, not the refusal box: edu may already hold this submission.
    await waitFor(() => expect(screen.getByTestId('p09-submit-unknown')).toBeTruthy())
    expect(screen.queryByTestId('p09-submitted')).toBeNull()
    expect(screen.queryByTestId('p09-submit-refusal')).toBeNull()
    expect(screen.getByText('htmlEditor.p09.submitUnknown')).toBeTruthy()
    expect(screen.getByText('htmlEditor.p09.submitUnknownHint')).toBeTruthy()
    // Pressing again is the student's decision after checking, so nothing retried by itself.
    expect(api.post).toHaveBeenCalledTimes(1)
  })

  it('an edu outage is still edu’s own answer, shown as a refusal that can be retried', async () => {
    routes({ submitConfigured: true, links: [linkRow()] })
    api.post.mockResolvedValue({ data: { submission: { submitted: false, outcome: 'refused',
      code: 'source_unavailable', message: '稍后再试', retryable: true } } })
    render(<TaskArtifactPanel project={project} pages={pages} />)
    fireEvent.click(await screen.findByTestId('p09-submit'))
    await waitFor(() => expect(screen.getByTestId('p09-submit-refusal')).toBeTruthy())
    expect(screen.getByText('稍后再试')).toBeTruthy()
    expect(screen.queryByTestId('p09-submit-unknown')).toBeNull()
  })

  // ---- 最后一跳：本侧答复没能到浏览器 -------------------------------------------------------------
  // 这几例是冲着旧代码写的：旧的 submit 直接 await post，断连落进通用 catch 只显示"连接中断"，
  // 2xx 读不出来就静默清空——两种情况下 edu 都可能已经落库。

  it('a submission whose answer never reaches the browser is unknown, not a network error', async () => {
    routes({ submitConfigured: true, links: [linkRow()] })
    api.post.mockRejectedValue(Object.assign(new Error('Network Error'), { request: {} }))
    render(<TaskArtifactPanel project={project} pages={pages} />)
    fireEvent.click(await screen.findByTestId('p09-submit'))
    await waitFor(() => expect(screen.getByTestId('p09-submit-unknown')).toBeTruthy())
    expect(screen.getByText('htmlEditor.p09.submitUnknownHint')).toBeTruthy()
    expect(screen.queryByTestId('p09-error')).toBeNull()          // 不能说成"连接中断，请稍后重试"
    expect(screen.queryByTestId('p09-submitted')).toBeNull()
    expect(screen.queryByTestId('p09-submit-refusal')).toBeNull()
    expect(api.post).toHaveBeenCalledTimes(1)                     // 不自己重发
  })

  it('a gateway error with no code of ours is unknown too: the press may have finished at edu', async () => {
    routes({ submitConfigured: true, links: [linkRow()] })
    api.post.mockRejectedValue({ response: { status: 504, data: '<html>gateway timeout</html>' } })
    render(<TaskArtifactPanel project={project} pages={pages} />)
    fireEvent.click(await screen.findByTestId('p09-submit'))
    await waitFor(() => expect(screen.getByTestId('p09-submit-unknown')).toBeTruthy())
    expect(screen.queryByTestId('p09-error')).toBeNull()
  })

  it('a 2xx the browser cannot read is unknown, not a silent nothing', async () => {
    routes({ submitConfigured: true, links: [linkRow()] })
    api.post.mockResolvedValue({ data: '{"submission":{"submitt' })   // 答复被截断
    render(<TaskArtifactPanel project={project} pages={pages} />)
    fireEvent.click(await screen.findByTestId('p09-submit'))
    await waitFor(() => expect(screen.getByTestId('p09-submit-unknown')).toBeTruthy())
    expect(screen.queryByTestId('p09-submitted')).toBeNull()
  })

  it('a refusal this platform makes before calling edu stays a named error, not an unknown', async () => {
    routes({ submitConfigured: true, links: [linkRow()] })
    api.post.mockRejectedValue({ response: { data: { error: { code: 'assignment_ref_missing' } } } })
    render(<TaskArtifactPanel project={project} pages={pages} />)
    fireEvent.click(await screen.findByTestId('p09-submit'))
    await waitFor(() => expect(screen.getByTestId('p09-error').textContent)
      .toContain('htmlEditor.p09.error.assignment_ref_missing'))
    expect(screen.queryByTestId('p09-submit-unknown')).toBeNull()   // 什么都没发出去，别说"可能已提交"
  })

  it('a double click is one submission', async () => {
    routes({ submitConfigured: true, links: [linkRow()] })
    let release
    api.post.mockImplementation(() => new Promise(resolve => { release = () => resolve({ data: { submission: { submitted: true,
      revision_ref: 'e9a1', revision_no: 1, submitted_at: 1 } } }) }))
    render(<TaskArtifactPanel project={project} pages={pages} />)
    const button = await screen.findByTestId('p09-submit')
    fireEvent.click(button); fireEvent.click(button)
    release()
    await waitFor(() => expect(screen.getByTestId('p09-submitted')).toBeTruthy())
    expect(api.post.mock.calls.filter(call => String(call[0]).endsWith('/submissions'))).toHaveLength(1)
  })

  it('tells a student who saved before linking to save again, and keeps unlink small and explicit', async () => {
    routes({ submitConfigured: true, links: [linkRow({ save_evidence: 'none', has_effective_save: false, work_state: 'linked' })] })
    render(<TaskArtifactPanel project={project} pages={pages} />)
    expect(await screen.findByTestId('p09-save-after-link')).toBeTruthy()
    const unlink = screen.getByTestId('p09-unlink')
    // Secondary, not the way out of a stuck state: a text button, and its confirmation says what it destroys.
    expect(unlink.className).toContain('ant-btn-text')
    expect(unlink.className).toContain('ant-btn-dangerous')
  })

  it('without the relay configured there is no 交作业 button at all', async () => {
    routes({ submitConfigured: false, links: [linkRow()] })
    render(<TaskArtifactPanel project={project} pages={pages} />)
    await screen.findByTestId('p09-freeze')
    expect(screen.queryByTestId('p09-submit')).toBeNull()
    // The non-E09 path keeps what it had: freezing is still the primary action there.
    expect(screen.getByTestId('p09-freeze').className).toContain('ant-btn-primary')
  })
})

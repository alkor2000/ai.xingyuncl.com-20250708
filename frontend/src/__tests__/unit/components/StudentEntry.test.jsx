import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import StudentLoginEntry from '../../../components/auth/StudentLoginEntry'
import StudentEntryConsume from '../../../pages/auth/StudentEntryConsume'
import api from '../../../utils/api'
import useAuthStore from '../../../stores/authStore'

vi.mock('../../../utils/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('react-i18next', async importOriginal => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key, options) => options?.defaultValue || key, i18n: { language: 'zh-CN' } })
}))

const LAUNCH = 'https://edu.example.edu/sso/practice/launch?entry=dashboard'
// Every handoff is unique in life, and this page remembers the ticket it has already spent, so each
// case brings its own.
let issued = 0
const ticket = () => String(issued++).padStart(43, 'h')

beforeEach(() => {
  vi.clearAllMocks()
  window.history.replaceState({}, '', '/')
})

const renderAt = (url, element, path) => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes>
      <Route path={path} element={element} />
      <Route path="/login" element={<div data-testid="login-page" />} />
      <Route path="/chat" element={<div data-testid="chat-page" />} />
      <Route path="/dashboard" element={<div data-testid="dashboard-page" />} />
    </Routes>
  </MemoryRouter>
)

describe('C05 login page entry', () => {
  it('renders nothing at all while the entry is switched off', async () => {
    api.get.mockResolvedValue({ data: { schema_version: 1, available: false } })
    const { container } = renderAt('/login', <StudentLoginEntry />, '/login')
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/auth/sso/capability'))
    expect(container).toBeEmptyDOMElement()
  })

  it('stays silent when the capability call fails, so the login page is unchanged', async () => {
    api.get.mockRejectedValue(new Error('offline'))
    const { container } = renderAt('/login', <StudentLoginEntry />, '/login')
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('offers exactly the configured https launch link, with no account or return parameter', async () => {
    api.get.mockResolvedValue({ data: { schema_version: 1, available: true, launch_url: LAUNCH } })
    renderAt('/login', <StudentLoginEntry />, '/login')
    const link = await screen.findByRole('link', { name: /学校学生登录/ })
    expect(link).toHaveAttribute('href', LAUNCH)
  })

  it('refuses a launch target that is not https, even if the backend offers one', async () => {
    api.get.mockResolvedValue({ data: { available: true, launch_url: 'javascript:alert(1)' } })
    const { container } = renderAt('/login', <StudentLoginEntry />, '/login')
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})

describe('C05 consume page', () => {
  const loginWith = result => {
    const spy = vi.fn().mockImplementation(result)
    vi.spyOn(useAuthStore, 'getState').mockReturnValue({ loginWithStudentHandoff: spy })
    return spy
  }

  it('spends the handoff, clears it from the address bar and lands on the returned entry', async () => {
    const spy = loginWith(async () => ({ entry: 'ai-practice.chat', context: { lesson_id: '456' } }))
    const handoff = ticket()
    renderAt(`/auth/sso/consume?handoff=${handoff}`, <StudentEntryConsume />, '/auth/sso/consume')
    await screen.findByTestId('chat-page')
    expect(spy).toHaveBeenCalledWith(handoff)
    expect(window.location.search).toBe('')
  })

  it('lands on the dashboard when the entry is unknown to this build', async () => {
    loginWith(async () => ({ entry: 'ai-practice.not-a-page' }))
    renderAt(`/auth/sso/consume?handoff=${ticket()}`, <StudentEntryConsume />, '/auth/sso/consume')
    await screen.findByTestId('dashboard-page')
  })

  it('never follows an entry that looks like a URL', async () => {
    loginWith(async () => ({ entry: 'https://elsewhere.example/steal' }))
    renderAt(`/auth/sso/consume?handoff=${ticket()}`, <StudentEntryConsume />, '/auth/sso/consume')
    await screen.findByTestId('dashboard-page')
  })

  it('does not call the backend for something that is not a ticket, and sends the student back to login', async () => {
    const spy = loginWith(async () => ({}))
    renderAt('/auth/sso/consume?handoff=../../admin', <StudentEntryConsume />, '/auth/sso/consume')
    await screen.findByText(/学校账号登录未完成/)
    expect(spy).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByTestId('login-page')).toBeInTheDocument(), { timeout: 4000 })
    expect(window.location.search).toBe('')
  })

  it('spends one ticket exactly once even when the effect runs twice (StrictMode, remount)', async () => {
    // A one-time ticket and a double-invoked effect: the second call must join the first, not burn the
    // ticket and turn a successful login into a failure notice.
    const spy = loginWith(async () => ({ entry: 'ai-practice.chat' }))
    render(
      <MemoryRouter initialEntries={[`/auth/sso/consume?handoff=${ticket()}`]}>
        <Routes>
          <Route path="/auth/sso/consume" element={
            <React.StrictMode><StudentEntryConsume /></React.StrictMode>} />
          <Route path="/chat" element={<div data-testid="chat-page" />} />
          <Route path="/login" element={<div data-testid="login-page" />} />
          <Route path="/dashboard" element={<div data-testid="dashboard-page" />} />
        </Routes>
      </MemoryRouter>
    )
    await screen.findByTestId('chat-page')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/学校账号登录未完成/)).not.toBeInTheDocument()
  })

  it('shows one fixed message when the handoff is refused, without any server detail', async () => {
    loginWith(async () => {
      const error = new Error('refused')
      error.response = { data: { error: { code: 'handoff_invalid', message: '登录入口无效或已使用' } } }
      throw error
    })
    renderAt(`/auth/sso/consume?handoff=${ticket()}`, <StudentEntryConsume />, '/auth/sso/consume')
    await screen.findByText(/学校账号登录未完成/)
    expect(screen.queryByText(/handoff_invalid/)).not.toBeInTheDocument()
  })
})

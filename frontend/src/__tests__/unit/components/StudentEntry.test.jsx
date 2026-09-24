import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import StudentLoginEntry from '../../../components/auth/StudentLoginEntry'
import StudentEntryConsume from '../../../pages/auth/StudentEntryConsume'
import api from '../../../utils/api'
import useAuthStore from '../../../stores/authStore'
import {
  adoptTaskContext, carryTaskContext, currentTaskContext, resetTaskContexts, takeCarriedTaskContext
} from '../../../utils/taskContextHandoff'

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

// 一份形状合规的作业上下文：edu 签的那种 p09g.<载荷>.<签名>。内容是合成的，签名由后端校验，
// 这一层只关心"有没有被带过去、会不会泄漏"。
const TASK = `p09g.${'e'.repeat(240)}.${'s'.repeat(43)}`

beforeEach(() => {
  vi.clearAllMocks()
  window.history.replaceState({}, '', '/')
  resetTaskContexts()
})

// 同一条路由不卸载，换一张票再来一次：点一下就把地址换成新票（和用户在同一个标签页里又点了一次
// 作业页入口是一样的），落地页组件自己不会重新挂载，只有 effect 会再跑。
const Switcher = ({ to }) => {
  const navigate = useNavigate()
  return <button data-testid="switch-ticket" onClick={() => navigate(to, { replace: true })} />
}

const renderAt = (url, element, path) => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes>
      <Route path={path} element={element} />
      <Route path="/login" element={<div data-testid="login-page" />} />
      <Route path="/chat" element={<div data-testid="chat-page" />} />
      <Route path="/html-editor" element={<div data-testid="editor-page" />} />
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

  it('carries the lesson cue without acting on it: no association call, no submission', async () => {
    // 登录线索不等于作业关联：落地页只是进站，关联要学生自己再确认一次。
    const spy = loginWith(async () => ({ entry: 'ai-practice.chat',
      context: { lesson_id: '456', assignment_id: '77' } }))
    renderAt(`/auth/sso/consume?handoff=${ticket()}`, <StudentEntryConsume />, '/auth/sso/consume')
    await screen.findByTestId('chat-page')
    expect(spy).toHaveBeenCalledTimes(1)
    // 除了那一次 consume，页面没有替学生发出任何请求（关联/提交都不在这里发生）
    expect(api.post).not.toHaveBeenCalled()
    expect(api.get).not.toHaveBeenCalled()
  })

  // ---- 一次进入：登录成功之后，作业上下文还在不在 ------------------------------------------------

  it('carries the assignment context through the login when the server lands on the editor', async () => {
    const spy = loginWith(async () => ({ entry: 'ai-practice.html' }))
    renderAt(`/auth/sso/consume?handoff=${ticket()}#p09_task=${TASK}`, <StudentEntryConsume />, '/auth/sso/consume')
    await screen.findByTestId('editor-page')
    expect(spy).toHaveBeenCalledWith(expect.any(String))      // 登录请求里只有 handoff
    expect(spy.mock.calls[0]).toHaveLength(1)
    expect(takeCarriedTaskContext()).toBe(TASK)               // 编辑器来取的时候还在
  })

  it('approves what the app parked at boot, which is how a real page load arrives', async () => {
    // 真实浏览器里片段在应用启动时就被取走清掉了，等落地页渲染时地址上已经没有它——
    // 这一例就是那条路径：页面自己看不到片段，只有寄存的那一个。
    carryTaskContext(TASK)
    loginWith(async () => ({ entry: 'ai-practice.html' }))
    renderAt(`/auth/sso/consume?handoff=${ticket()}`, <StudentEntryConsume />, '/auth/sso/consume')
    await screen.findByTestId('editor-page')
    expect(takeCarriedTaskContext()).toBe(TASK)
  })

  it('does not hand over what the app parked when the login lands anywhere else', async () => {
    carryTaskContext(TASK)
    loginWith(async () => ({ entry: 'ai-practice.chat' }))
    renderAt(`/auth/sso/consume?handoff=${ticket()}`, <StudentEntryConsume />, '/auth/sso/consume')
    await screen.findByTestId('chat-page')
    expect(takeCarriedTaskContext()).toBeNull()
  })

  it('never leaves the assignment context in the address bar, storage or a log line', async () => {
    const stored = []
    const setLocal = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k, v) => { stored.push([k, v]) })
    const logs = []
    for (const level of ['log', 'info', 'warn', 'error']) {
      vi.spyOn(console, level).mockImplementation((...args) => { logs.push(args.join(' ')) })
    }
    loginWith(async () => ({ entry: 'ai-practice.html' }))
    renderAt(`/auth/sso/consume?handoff=${ticket()}#p09_task=${TASK}`, <StudentEntryConsume />, '/auth/sso/consume')
    await screen.findByTestId('editor-page')
    expect(window.location.hash).toBe('')
    expect(window.location.search).toBe('')
    expect(stored.some(([, value]) => String(value).includes(TASK))).toBe(false)
    expect(document.cookie).not.toContain('p09g.')
    expect(logs.some(line => line.includes(TASK))).toBe(false)
    expect(logs.some(line => line.includes('p09_task'))).toBe(false)
    setLocal.mockRestore()
    vi.restoreAllMocks()
  })

  it('drops the context when the server lands anywhere but the editor', async () => {
    loginWith(async () => ({ entry: 'ai-practice.chat' }))
    renderAt(`/auth/sso/consume?handoff=${ticket()}#p09_task=${TASK}`, <StudentEntryConsume />, '/auth/sso/consume')
    await screen.findByTestId('chat-page')
    expect(takeCarriedTaskContext()).toBeNull()
  })

  it('drops the context when the login itself fails', async () => {
    loginWith(async () => { throw new Error('refused') })
    renderAt(`/auth/sso/consume?handoff=${ticket()}#p09_task=${TASK}`, <StudentEntryConsume />, '/auth/sso/consume')
    await screen.findByText(/学校账号登录未完成/)
    expect(takeCarriedTaskContext()).toBeNull()
  })

  it('takes nothing from a duplicated, malformed or foreign fragment', async () => {
    for (const fragment of [
      `p09_task=${TASK}&p09_task=${TASK}`,               // 两个：不猜信哪个
      'p09_task=../../admin',                            // 畸形
      'p09_task=https://elsewhere.example/steal',        // 外部地址当上下文
      'return_to=https://elsewhere.example/steal',       // 无关片段
      `entry=ai-practice.html&p09_task=`                 // 空值
    ]) {
      loginWith(async () => ({ entry: 'ai-practice.html' }))
      const view = renderAt(`/auth/sso/consume?handoff=${ticket()}#${fragment}`,
        <StudentEntryConsume />, '/auth/sso/consume')
      await screen.findByTestId('editor-page')            // 登录照常成功
      expect(takeCarriedTaskContext()).toBeNull()         // 但什么都没带过去
      view.unmount()
    }
  })

  it('does not let one login’s context be picked up by the next login', async () => {
    loginWith(async () => ({ entry: 'ai-practice.html' }))
    const first = renderAt(`/auth/sso/consume?handoff=${ticket()}#p09_task=${TASK}`,
      <StudentEntryConsume />, '/auth/sso/consume')
    await screen.findByTestId('editor-page')
    adoptTaskContext(takeCarriedTaskContext())      // 编辑器面板拿走它，就像真的进了编辑器一样
    expect(currentTaskContext()).toBe(TASK)
    first.unmount()
    // 第二次登录：另一张票、没有上下文。上一次那个不能被这次接着用。
    loginWith(async () => ({ entry: 'ai-practice.html' }))
    renderAt(`/auth/sso/consume?handoff=${ticket()}`, <StudentEntryConsume />, '/auth/sso/consume')
    await screen.findByTestId('editor-page')
    expect(takeCarriedTaskContext()).toBeNull()
    expect(currentTaskContext()).toBeNull()
  })

  it('spends one ticket once under StrictMode and still hands the context over', async () => {
    const spy = loginWith(async () => ({ entry: 'ai-practice.html' }))
    render(
      <MemoryRouter initialEntries={[`/auth/sso/consume?handoff=${ticket()}#p09_task=${TASK}`]}>
        <Routes>
          <Route path="/auth/sso/consume" element={
            <React.StrictMode><StudentEntryConsume /></React.StrictMode>} />
          <Route path="/html-editor" element={<div data-testid="editor-page" />} />
          <Route path="/login" element={<div data-testid="login-page" />} />
          <Route path="/dashboard" element={<div data-testid="dashboard-page" />} />
        </Routes>
      </MemoryRouter>
    )
    await screen.findByTestId('editor-page')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(takeCarriedTaskContext()).toBe(TASK)
  })

  it('keeps the parked context through a StrictMode double effect, the real dev-mode path', async () => {
    // 真实浏览器里两件事同时成立：片段在启动时就被取走寄存了，而 StrictMode 会把 effect 跑两遍。
    // 判定是消耗性的，所以必须按票只判一次——否则第二遍拿到空手，学生的作业就没了。
    carryTaskContext(TASK)
    const spy = loginWith(async () => ({ entry: 'ai-practice.html' }))
    render(
      <MemoryRouter initialEntries={[`/auth/sso/consume?handoff=${ticket()}`]}>
        <Routes>
          <Route path="/auth/sso/consume" element={
            <React.StrictMode><StudentEntryConsume /></React.StrictMode>} />
          <Route path="/html-editor" element={<div data-testid="editor-page" />} />
          <Route path="/login" element={<div data-testid="login-page" />} />
          <Route path="/dashboard" element={<div data-testid="dashboard-page" />} />
        </Routes>
      </MemoryRouter>
    )
    await screen.findByTestId('editor-page')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(takeCarriedTaskContext()).toBe(TASK)
  })

  // ---- 同一条路由不卸载，从票 A 换到票 B --------------------------------------------------------
  // 这一组是冲着"整个组件只记住第一次的片段"写的：A 还没完成或已经失败时换到 B，
  // effect 会再跑，但它读到的必须是 B 这一次到达的东西。

  const renderSwitchable = (first, then) => render(
    <MemoryRouter initialEntries={[first]}>
      <Routes>
        <Route path="/auth/sso/consume" element={<><StudentEntryConsume /><Switcher to={then} /></>} />
        <Route path="/login" element={<div data-testid="login-page" />} />
        <Route path="/chat" element={<div data-testid="chat-page" />} />
        <Route path="/html-editor" element={<div data-testid="editor-page" />} />
        <Route path="/dashboard" element={<div data-testid="dashboard-page" />} />
      </Routes>
    </MemoryRouter>
  )

  it('takes ticket B’s own context when the first login is still in flight', async () => {
    const OTHER = `p09g.${'b'.repeat(240)}.${'t'.repeat(43)}`
    const answers = new Map()
    const spy = vi.fn().mockImplementation(handoff => answers.get(handoff))
    vi.spyOn(useAuthStore, 'getState').mockReturnValue({ loginWithStudentHandoff: spy })
    const a = ticket()
    const b = ticket()
    answers.set(a, new Promise(() => {}))                       // A 卡住不返回
    answers.set(b, Promise.resolve({ entry: 'ai-practice.html' }))
    renderSwitchable(`/auth/sso/consume?handoff=${a}#p09_task=${TASK}`,
      `/auth/sso/consume?handoff=${b}#p09_task=${OTHER}`)
    await waitFor(() => expect(spy).toHaveBeenCalledWith(a))
    fireEvent.click(screen.getByTestId('switch-ticket'))
    await screen.findByTestId('editor-page')
    expect(spy).toHaveBeenCalledWith(b)
    expect(takeCarriedTaskContext()).toBe(OTHER)                // B 的，不是 A 的
  })

  it('carries nothing into ticket B when B brings no context of its own', async () => {
    const answers = new Map()
    const spy = vi.fn().mockImplementation(handoff => answers.get(handoff))
    vi.spyOn(useAuthStore, 'getState').mockReturnValue({ loginWithStudentHandoff: spy })
    const a = ticket()
    const b = ticket()
    answers.set(a, Promise.reject(new Error('refused')))        // A 先失败
    answers.set(b, Promise.resolve({ entry: 'ai-practice.html' }))
    renderSwitchable(`/auth/sso/consume?handoff=${a}#p09_task=${TASK}`,
      `/auth/sso/consume?handoff=${b}`)
    await screen.findByText(/学校账号登录未完成/)
    fireEvent.click(screen.getByTestId('switch-ticket'))
    await screen.findByTestId('editor-page')
    expect(takeCarriedTaskContext()).toBeNull()                 // A 的作业不能接着用
  })

  it('leaves a login without any context exactly as it was', async () => {
    loginWith(async () => ({ entry: 'ai-practice.html' }))
    renderAt(`/auth/sso/consume?handoff=${ticket()}`, <StudentEntryConsume />, '/auth/sso/consume')
    await screen.findByTestId('editor-page')
    expect(takeCarriedTaskContext()).toBeNull()
    expect(api.post).not.toHaveBeenCalled()               // 落地页从不替学生关联或提交
    expect(api.get).not.toHaveBeenCalled()
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

  it('says the same fixed thing when the refusal is about role, school or scope', async () => {
    // 兑换时的现态拒绝（角色变了、学校撤下、换了组）对学生是同一件事：回作业页重新进来。
    for (const code of ['subject_not_student', 'school_not_provisioned', 'session_scope_changed']) {
      loginWith(async () => {
        const error = new Error('refused')
        error.response = { data: { error: { code, message: '服务端中文短句' } } }
        throw error
      })
      const view = renderAt(`/auth/sso/consume?handoff=${ticket()}`, <StudentEntryConsume />, '/auth/sso/consume')
      await screen.findByText(/学校账号登录未完成/)
      expect(screen.queryByText(new RegExp(code))).not.toBeInTheDocument()
      view.unmount()
    }
  })
})

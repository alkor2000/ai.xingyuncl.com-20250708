import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import NotificationsView from '../../../pages/forum/components/NotificationsView'
import WorkflowRun from '../../../pages/agent/WorkflowRun'
import ExecutionHistory from '../../../pages/agent/ExecutionHistory'
import useForumStore from '../../../stores/forumStore'
import useAgentStore from '../../../stores/agentStore'
import api from '../../../utils/api'

vi.mock('../../../utils/api', () => ({ default: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() } }))
vi.mock('../../../utils/i18n', () => ({ default: { t: key => key } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key, args) => args?.count != null ? `${key}:${args.count}` : key }) }))
const response = data => ({ data: { success: true, data } })
const forumInitial = useForumStore.getState()
const agentInitial = useAgentStore.getState()
const notification = { id: 8, type: 'reply', post_id: 12, content: 'A reply arrived', is_read: 0, created_at: '2026-09-17 10:00:00' }
const renderAt = (element, path, route) => render(<MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={element} /></Routes></MemoryRouter>)
beforeEach(() => {
  vi.clearAllMocks()
  for (const method of Object.values(api)) method.mockReset()
  useForumStore.setState(forumInitial, true)
  useAgentStore.setState(agentInitial, true)
})

describe('Forum notification flow', () => {
  it('loads pages and marks the chosen notification before opening the post', async () => {
    api.get.mockResolvedValue(response({ items: [notification], unreadCount: 2, pagination: { page: 1, limit: 20, total: 21 } }))
    api.put.mockResolvedValue(response(null))
    const open = vi.fn()
    render(<NotificationsView onBack={vi.fn()} onPostClick={open} />)
    await screen.findByText('A reply arrived')
    fireEvent.click(screen.getByTitle('2'))
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/forum/notifications', { params: { page: 2, limit: 20 } }))
    fireEvent.click(screen.getByRole('button', { name: 'forum.notification.viewPost' }))
    await waitFor(() => expect(open).toHaveBeenCalledWith({ id: 12 }))
    expect(api.put).toHaveBeenCalledWith('/forum/notifications/8/read')
    expect(useForumStore.getState().unreadCount).toBe(1)
  })
  it('shows load failure with retry instead of an empty inbox', async () => {
    api.get.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response({ items: [], pagination: { page: 1, limit: 20, total: 0 } }))
    render(<NotificationsView onBack={vi.fn()} onPostClick={vi.fn()} />)
    await screen.findByText('forum.notification.loadFailed')
    fireEvent.click(screen.getByRole('button', { name: 'forum.notification.retry' }))
    await screen.findByText('forum.notification.empty')
  })
  it('ignores an older response when a newer filter completes first', async () => {
    let resolveOld
    api.get.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
      .mockResolvedValueOnce(response({ items: [notification], pagination: { page: 1, limit: 20, total: 1 } }))
    const old = useForumStore.getState().fetchNotifications()
    await useForumStore.getState().fetchNotifications({ type: 'reply' })
    resolveOld(response({ items: [], pagination: { page: 1, limit: 20, total: 0 } }))
    await old
    expect(useForumStore.getState().notifications).toEqual([notification])
  })
  it('retains unread state when marking fails', async () => {
    useForumStore.setState({ notifications: [notification], unreadCount: 1 })
    api.put.mockRejectedValue(new Error('offline'))
    await expect(useForumStore.getState().markNotificationRead(8)).rejects.toThrow()
    expect(useForumStore.getState().unreadCount).toBe(1)
  })
})

describe('Agent run and history', () => {
  it('passes text as query, prevents double submission, and displays the execution result', async () => {
    api.get.mockResolvedValue(response({ id: 7, name: 'Example workflow' }))
    let resolveRun
    api.post.mockImplementation(() => new Promise(resolve => { resolveRun = resolve }))
    renderAt(<WorkflowRun />, '/agent/execute/7', '/agent/execute/:id')
    const input = await screen.findByRole('textbox', { name: 'agent.execution.inputData' })
    fireEvent.change(input, { target: { value: 'hello' } })
    const run = screen.getByRole('button', { name: 'agent.workflow.execute' })
    fireEvent.click(run); fireEvent.click(run)
    expect(api.post).toHaveBeenCalledTimes(1)
    expect(api.post).toHaveBeenCalledWith('/agent/workflows/7/execute', { input_data: { query: 'hello' } }, { timeout: 600000 })
    await act(async () => resolveRun(response({ executionId: 3, output: 'result text', credits: { used: 2 } })))
    await screen.findByText('result text')
  })
  it('rejects arrays in JSON mode without executing', async () => {
    api.get.mockResolvedValue(response({ id: 7, name: 'Example workflow' }))
    renderAt(<WorkflowRun />, '/agent/execute/7', '/agent/execute/:id')
    await screen.findByRole('textbox')
    fireEvent.click(screen.getByText('JSON'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '[]' } })
    fireEvent.click(screen.getByRole('button', { name: 'agent.workflow.execute' }))
    await screen.findByText('agent.execution.invalidJson')
    expect(api.post).not.toHaveBeenCalled()
  })
  it('renders actual started_at and zero duration, and loads failed execution details', async () => {
    const row = { id: 10, workflow_name: 'Example workflow', status: 'failed', started_at: '2026-09-17 08:15:00', duration_ms: 0, total_credits_used: 0 }
    api.get.mockImplementation(url => Promise.resolve(response(url.includes('/executions?')
      ? { data: [row], pagination: { page: 1, limit: 20, total: 1 } }
      : { ...row, error_message: 'node failed', input_data: { query: 'hello' } })))
    renderAt(<ExecutionHistory />, '/agent/executions?workflow_id=7', '/agent/executions')
    await screen.findByText('2026-09-17 08:15:00')
    expect(screen.getByText('agent.execution.seconds:0')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/agent/executions?page=1&limit=20&workflow_id=7')
    fireEvent.click(screen.getByRole('button', { name: 'agent.execution.detail' }))
    await screen.findByText('node failed')
  })
})

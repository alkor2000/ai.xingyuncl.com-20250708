import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import PostEditor from '../../../pages/forum/components/PostEditor'
import ForumHome from '../../../pages/forum/components/ForumHome'
import useForumStore from '../../../stores/forumStore'
import api from '../../../utils/api'

vi.mock('../../../utils/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../../../utils/i18n', () => ({ default: { t: key => key } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: key => key }) }))
const response = data => ({ data: { success: true, data } })
const board = { id: 7, name: 'Allowed board', is_active: 1 }
const initial = useForumStore.getState()

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  useForumStore.getState().reset()
  useForumStore.setState({ ...initial, boardsLoaded: true })
})

describe('forum board availability', () => {
  it('keeps an authorized empty response distinct from a failed request', async () => {
    api.get.mockResolvedValueOnce(response([]))
    await useForumStore.getState().fetchBoards()
    expect(useForumStore.getState()).toMatchObject({ boards: [], boardsLoaded: true, boardsLoading: false, boardsError: null })
    api.get.mockRejectedValueOnce({ response: { status: 503 } })
    await useForumStore.getState().fetchBoards()
    expect(useForumStore.getState()).toMatchObject({ boards: [], boardsLoading: false, boardsError: 'loadFailed' })
  })

  it('clears stale options on permission failure and recovers through the same list endpoint', async () => {
    useForumStore.setState({ boards: [board] })
    api.get.mockRejectedValueOnce({ response: { status: 403 } }).mockResolvedValueOnce(response([board]))
    await useForumStore.getState().fetchBoards()
    expect(useForumStore.getState()).toMatchObject({ boards: [], boardsError: 'forbidden' })
    await useForumStore.getState().fetchBoards()
    expect(useForumStore.getState()).toMatchObject({ boards: [board], boardsError: null })
    expect(api.get.mock.calls).toEqual([['/forum/boards'], ['/forum/boards']])
  })

  it.each([{ success: false, data: [] }, { success: true, data: {} }])('rejects an invalid list envelope: %j', async data => {
    api.get.mockResolvedValueOnce({ data })
    await useForumStore.getState().fetchBoards()
    expect(useForumStore.getState().boardsError).toBe('loadFailed')
  })

  it('ignores an older list response after a newer forbidden response or reset', async () => {
    let resolveFirst
    api.get.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve }))
      .mockRejectedValueOnce({ response: { status: 403 } })
    const first = useForumStore.getState().fetchBoards()
    await useForumStore.getState().fetchBoards()
    resolveFirst(response([board]))
    await first
    expect(useForumStore.getState()).toMatchObject({ boards: [], boardsError: 'forbidden' })
    api.get.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve }))
    const pending = useForumStore.getState().fetchBoards()
    useForumStore.getState().reset()
    resolveFirst(response([board]))
    await pending
    expect(useForumStore.getState()).toMatchObject({ boards: [], boardsLoaded: false, boardsLoading: false })
  })

  it('explains no available boards and disables publishing, including a stale default board', () => {
    render(<PostEditor boards={[]} defaultBoardId={7} onBack={vi.fn()} onSuccess={vi.fn()} />)
    expect(screen.getByText('forum.board.unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /forum\.post\.form\.submit/ })).toBeDisabled()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('retains draft text through failed loading and retry, then publishes only the selected allowed board', async () => {
    useForumStore.setState({ boardsError: 'loadFailed' })
    const onSuccess = vi.fn()
    const ConnectedEditor = () => <PostEditor boards={useForumStore(state => state.boards)} defaultBoardId={7} onBack={vi.fn()} onSuccess={onSuccess} />
    render(<ConnectedEditor />)
    fireEvent.change(screen.getByPlaceholderText('forum.post.form.titlePlaceholder'), { target: { value: 'My title' } })
    fireEvent.change(screen.getByPlaceholderText('forum.post.form.contentPlaceholder'), { target: { value: 'My draft' } })
    api.get.mockResolvedValueOnce(response([board]))
    fireEvent.click(screen.getByRole('button', { name: 'forum.board.retry' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /forum\.post\.form\.submit/ })).toBeEnabled())
    expect(screen.getByDisplayValue('My draft')).toBeInTheDocument()
    api.post.mockResolvedValueOnce(response({ id: 9 }))
    fireEvent.click(screen.getByRole('button', { name: /forum\.post\.form\.submit/ }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ id: 9 }))
    expect(api.post).toHaveBeenCalledWith('/forum/posts', { title: 'My title', content: 'My draft', board_id: 7, attachment_ids: [] })
  })

  it('blocks inactive options and loading while leaving existing post editing independent of the list', () => {
    useForumStore.setState({ boardsLoading: true })
    const { rerender } = render(<PostEditor boards={[board]} defaultBoardId={7} onBack={vi.fn()} onSuccess={vi.fn()} />)
    expect(screen.getByRole('button', { name: /forum\.post\.form\.submit/ })).toBeDisabled()
    act(() => useForumStore.setState({ boardsLoading: false }))
    rerender(<PostEditor boards={[{ ...board, is_active: 0 }]} defaultBoardId={7} onBack={vi.fn()} onSuccess={vi.fn()} />)
    expect(screen.getByRole('button', { name: /forum\.post\.form\.submit/ })).toBeDisabled()
    rerender(<PostEditor boards={[]} editPost={{ id: 9, board_id: 7, title: 'Existing', content: 'Text' }} onBack={vi.fn()} onSuccess={vi.fn()} />)
    expect(screen.getByRole('button', { name: /forum\.post\.form\.submit/ })).toBeEnabled()
  })

  it('does not offer new posting from the home page without an active visible board', () => {
    const onNewPost = vi.fn()
    render(<ForumHome boards={[]} boardsLoaded boardsLoading={false} boardsError={null} onRetryBoards={vi.fn()} hotPosts={[]} unreadCount={0} onNewPost={onNewPost} />)
    expect(screen.getByText('forum.board.unavailable')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /forum\.post\.new/ }))
    expect(onNewPost).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import useStorageStore from '../../../stores/storageStore'
import api from '../../../utils/api'

vi.mock('../../../utils/api', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }))
vi.mock('../../../utils/i18n', () => ({ default: { t: key => key } }))
const state = () => useStorageStore.getState()
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const file = id => ({ id, original_name: `file-${id}.txt` })
const response = (total, page = 1, ids) => ({ data: { data: {
  files: (ids || Array.from({ length: Math.max(0, Math.min(50, total - (page - 1) * 50)) }, (_, i) => (page - 1) * 50 + i + 1)).map(file),
  pagination: { page, limit: 50, total, pages: Math.ceil(total / 50) }
} } })
const initial = state()
beforeEach(() => { useStorageStore.setState(initial, true); vi.resetAllMocks() })

describe('cloud pagination', () => {
  it.each([51, 101])('requests the last page of %i files and retains server totals', async total => {
    api.get.mockImplementation((url, { params }) => Promise.resolve(response(total, params.page)))
    await state().getFiles()
    expect(state().files).toHaveLength(50)
    const page = Math.ceil(total / 50)
    await state().getFiles(null, { page })
    expect(api.get).toHaveBeenLastCalledWith('/storage/files', { params: { folder_id: null, page, limit: 50 } })
    expect(state().files.map(f => f.id)).toEqual([total])
    expect(state().pagination).toEqual({ page, limit: 50, total, pages: page })
  })

  it('ignores an older page response that arrives after a newer page', async () => {
    const slow = deferred(); api.get.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(response(101, 3))
    const first = state().getFiles(null, { page: 2 })
    await state().getFiles(null, { page: 3 }); slow.resolve(response(101, 2)); await first
    expect(state().pagination.page).toBe(3); expect(state().files[0].id).toBe(101)
  })

  it('invalidates old file and folder responses immediately on navigation', async () => {
    const a = deferred(), b = deferred()
    state().setCurrentFolder({ id: 1 }); api.get.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    const files = state().getFiles(1, { page: 3 }), folders = state().getFolders(1)
    state().setSelectedFiles([101]); state().setCurrentFolder({ id: 2 })
    expect(state().pagination.page).toBe(1); expect(state().selectedFiles).toEqual([])
    a.resolve(response(101, 3)); b.resolve({ data: { data: [{ id: 7 }] } }); await Promise.all([files, folders])
    expect(state().files).toEqual([]); expect(state().folders).toEqual([])
    expect(state().currentFolder.id).toBe(2)
  })

  it('does not display a stale error or end the newer request loading state', async () => {
    const old = deferred(), fresh = deferred()
    api.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    const first = state().getFiles()
    state().setCurrentFolder({ id: 2 }); const second = state().getFiles(2)
    old.reject(new Error('old failure')); await first
    expect(state().filesError).toBeNull(); expect(state().filesLoading).toBe(true)
    fresh.resolve(response(1)); await second
    expect(state().filesLoading).toBe(false)
  })

  it('keeps files loading while folder-tree loading ends', async () => {
    const pending = deferred(); api.get.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ data: { data: [] } })
    const request = state().getFiles(); await state().getFolderTree()
    expect(state().filesLoading).toBe(true)
    pending.resolve(response(0)); await request
  })

  it('corrects the last page and refreshes the total after deletion', async () => {
    api.get.mockResolvedValueOnce(response(101, 3)).mockResolvedValueOnce(response(100, 3)).mockResolvedValueOnce(response(100, 2))
    api.delete.mockResolvedValue({})
    await state().getFiles(null, { page: 3 }); state().setSelectedFiles([101])
    await state().deleteFile(101); await state().refreshFiles()
    expect(state().pagination).toEqual({ page: 2, limit: 50, total: 100, pages: 2 })
    expect(state().files).toHaveLength(50); expect(state().selectedFiles).toEqual([])
  })

  it('handles deleting every file without requesting page zero', async () => {
    api.get.mockResolvedValueOnce(response(0, 2)).mockResolvedValueOnce(response(0, 1))
    await state().getFiles(null, { page: 2 })
    expect(state().pagination).toEqual({ page: 1, limit: 50, total: 0, pages: 0 })
    expect(api.get.mock.calls.map(call => call[1].params.page)).toEqual([2, 1])
  })

  it('makes failure visible, retries the requested page, and keeps navigation', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    state().setCurrentFolder({ id: 7 })
    api.get.mockRejectedValueOnce({ response: { data: { message: 'fixture unavailable' } } }).mockResolvedValueOnce(response(101, 3))
    await expect(state().getFiles(7, { page: 3 })).rejects.toBeTruthy()
    expect(state().filesError).toEqual({ key: 'storage.getFilesFailed', detail: 'fixture unavailable' })
    await state().refreshFiles()
    expect(api.get).toHaveBeenLastCalledWith('/storage/files', { params: { folder_id: 7, page: 3, limit: 50 } })
    expect(state().filesError).toBeNull(); expect(state().files[0].id).toBe(101)
  })

  it('an upload completing after navigation refreshes the live directory/page', async () => {
    const upload = deferred(); api.post.mockReturnValue(upload.promise)
    state().setCurrentFolder({ id: 1 })
    const result = state().uploadFiles([new File(['fixture'], 'upload.txt')], 1)
    state().setCurrentFolder({ id: 2 }); useStorageStore.setState({ pagination: { page: 2, limit: 50, total: 101, pages: 3 } })
    api.get.mockResolvedValueOnce(response(102, 2)); upload.resolve({ data: { data: { success: [file(102)] } } }); await result
    expect(api.get).toHaveBeenLastCalledWith('/storage/files', { params: { folder_id: 2, page: 2, limit: 50 } })
    expect(state().currentFolder.id).toBe(2); expect(state().pagination.page).toBe(2)
  })

  it('clears invisible selections when refreshing files or folders fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    useStorageStore.setState({ files: [file(1)], folders: [{ id: 10 }], selectedFiles: [1], selectedFolders: [10] })
    api.get.mockRejectedValue(new Error('offline'))
    await state().refreshFiles()
    await expect(state().getFolders()).rejects.toThrow('offline')
    expect(state().selectedFiles).toEqual([])
    expect(state().selectedFolders).toEqual([])
  })

  it('does not misreport a successful upload as failed when its refresh fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    api.post.mockResolvedValueOnce({ data: { data: { success: [file(2)] } } }); api.get.mockRejectedValueOnce(new Error('offline'))
    expect(await state().uploadFiles([new File(['fixture'], 'upload.txt')])).toEqual({ success: [file(2)] })
    expect(state().uploading).toBe(false); expect(state().filesError.key).toBe('storage.getFilesFailed')
  })

  it('preserves failed move items and selection until the page is refreshed', async () => {
    useStorageStore.setState({ files: [file(1), file(2)], selectedFiles: [1, 2] })
    api.put.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('denied'))
    expect(await state().batchMoveFiles([1, 2], 8)).toEqual({ success: 1, failed: 1 })
    expect(state().files.map(f => f.id)).toEqual([2]); expect(state().selectedFiles).toEqual([2])
  })

  it('supports Ctrl-selection updaters, retains visible selection on refresh and clears it on paging', async () => {
    api.get.mockResolvedValueOnce(response(101, 1)).mockResolvedValueOnce(response(101, 1)).mockResolvedValueOnce(response(101, 2))
    await state().getFiles(); state().setSelectedFiles([1]); state().setSelectedFiles(ids => [...ids, 2])
    state().setSelectedFolders([10]); state().setSelectedFolders(ids => [...ids, 11])
    expect(state().selectedFolders).toEqual([10, 11])
    await state().refreshFiles(); expect(state().selectedFiles).toEqual([1, 2])
    await state().getFiles(null, { page: 2 }); expect(state().selectedFiles).toEqual([]); expect(state().selectedFolders).toEqual([])
  })
})

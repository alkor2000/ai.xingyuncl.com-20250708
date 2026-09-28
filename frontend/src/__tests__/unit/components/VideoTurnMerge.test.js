/**
 * 合并这几条的规矩：**同一个 id 两个来源打架时听谁的、没变时别换对象、旧消息不许把终态推回去**。
 *
 * 反例照总控复现的那一组来：同 id 的陈旧历史（还写着排队中）+ 权威的完成快照，
 * 反复跑必须收敛——第 2、3、4 次都应该原样返回同一个 Map。
 */
import { describe, expect, it } from 'vitest'
import { mergeTurnItems } from '../../../pages/video/utils/mergeTurnItems'

const turn = (extra = {}) => new Map([[601, {
  id: 601, task_id: 't-601', prompt: '镜头缓缓推近', status: 'queued', progress: 0, ...extra
}]])
const staleHistory = [{ id: 601, task_id: 't-601', status: 'queued', progress: 0, local_path: null }]
const doneSnapshot = {
  't-601': { taskId: 't-601', generationId: 601, status: 'succeeded', progress: 100,
    local_path: '/v/601.mp4', thumbnail_path: '/v/601.jpg', error_message: null }
}

describe('同一个 id 两个来源打架', () => {
  it('陈旧历史 + 完成快照：听快照的，第一次换新 Map', () => {
    const prev = turn()
    const next = mergeTurnItems(prev, staleHistory, doneSnapshot)
    expect(next).not.toBe(prev)
    expect(next.get(601).status).toBe('succeeded')
    expect(next.get(601).local_path).toBe('/v/601.mp4')
  })

  it('再跑三次必须收敛：内容没变就原样返回同一个 Map（否则 effect 会一直自己叫醒自己）', () => {
    let state = mergeTurnItems(turn(), staleHistory, doneSnapshot)
    for (let i = 0; i < 3; i += 1) {
      const again = mergeTurnItems(state, staleHistory, doneSnapshot)
      expect(again).toBe(state)          // 同一个对象，不是"内容相同的新对象"
      state = again
    }
    expect(state.get(601).status).toBe('succeeded')
  })

  it('晚到的旧历史不能把终态推回排队中', () => {
    const done = mergeTurnItems(turn(), staleHistory, doneSnapshot)
    const after = mergeTurnItems(done, [{ id: 601, task_id: 't-601', status: 'queued', progress: 0 }], {})
    expect(after).toBe(done)
    expect(after.get(601).status).toBe('succeeded')
  })

  it('失败也是终态：晚到的"生成中"推不回去', () => {
    const failed = mergeTurnItems(turn(), [], {
      't-601': { taskId: 't-601', generationId: 601, status: 'failed', progress: 0,
        local_path: null, thumbnail_path: null, error_message: '上游渲染超时' }
    })
    expect(failed.get(601).error_message).toBe('上游渲染超时')
    const after = mergeTurnItems(failed, [{ id: 601, task_id: 't-601', status: 'running', progress: 60 }], {})
    expect(after).toBe(failed)
  })

  it('真的往前走时照样更新：排队中 → 生成中带进度', () => {
    const prev = turn()
    const next = mergeTurnItems(prev, [], {
      't-601': { taskId: 't-601', generationId: 601, status: 'running', progress: 45,
        local_path: null, thumbnail_path: null, error_message: null }
    })
    expect(next).not.toBe(prev)
    expect(next.get(601)).toMatchObject({ status: 'running', progress: 45 })
  })

  it('不认识的 id / 别人的快照一概不进来，也不因此换对象', () => {
    const prev = turn()
    const next = mergeTurnItems(prev,
      [{ id: 77, task_id: 't-77', status: 'succeeded', local_path: '/v/77.mp4' }],
      { 't-999': { taskId: 't-999', generationId: 999, status: 'succeeded', local_path: '/v/999.mp4' } })
    expect(next).toBe(prev)
  })

  it('历史里只有 task_id 对得上（id 变了）也能认出来', () => {
    const prev = turn()
    const next = mergeTurnItems(prev, [{ id: 601, task_id: 't-601', status: 'running', progress: 30 }], {})
    expect(next.get(601).status).toBe('running')
  })

  it('本轮一条都没有时原样返回，不做无谓的工作', () => {
    const empty = new Map()
    expect(mergeTurnItems(empty, staleHistory, doneSnapshot)).toBe(empty)
  })
})

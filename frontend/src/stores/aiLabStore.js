/**
 * AI训练专区状态管理
 *
 * 职责：项目/数据集/样本/模型版本/评测/过程事件的读写，以及浏览器内训练引擎的状态。
 * 非 React 模块，提示文案用 i18n.t()（与其他 store 一致）。
 * 过程事件先进本地队列，2 秒内合并成一次 POST，页面卸载前 flushEvents。
 */
import { create } from 'zustand'
import { message } from 'antd'
import apiClient from '../utils/api'
import i18n from '../utils/i18n'

const EVENT_FLUSH_MS = 2000

const useAiLabStore = create((set, get) => ({
  tasks: [],
  projects: [],
  projectsLoading: false,
  adminProjects: [],
  adminPagination: { page: 1, limit: 20, total: 0 },

  project: null,
  datasets: [],
  models: [],
  samplesByDataset: {},
  events: [],
  projectLoading: false,

  /* 浏览器内训练好的分类器缓存：modelId -> knn 模型对象 */
  liveModels: {},
  extractor: { status: 'idle', progress: 0, error: null },

  eventQueue: [],
  flushTimer: null,

  // ===================== 任务与项目 =====================
  fetchTasks: async () => {
    try {
      const res = await apiClient.get('/ai-lab/tasks')
      if (res.data.success) set({ tasks: res.data.data || [] })
    } catch (error) {
      console.error('Failed to fetch ai-lab tasks:', error)
    }
  },

  fetchProjects: async (params = {}) => {
    set({ projectsLoading: true })
    try {
      const res = await apiClient.get('/ai-lab/projects', { params })
      if (res.data.success) {
        const data = res.data.data
        set({ projects: Array.isArray(data) ? data : (data?.items || data?.list || []) })
      }
    } catch (error) {
      console.error('Failed to fetch ai-lab projects:', error)
      message.error(i18n.t('aiLab.msg.loadProjectsFailed'))
    } finally {
      set({ projectsLoading: false })
    }
  },

  fetchAdminProjects: async (params = {}) => {
    try {
      const res = await apiClient.get('/ai-lab/admin/projects', { params })
      if (res.data.success) {
        const data = res.data.data
        const list = Array.isArray(data) ? data : (data?.items || data?.list || [])
        set({ adminProjects: list, adminPagination: res.data.pagination || get().adminPagination })
      }
    } catch (error) {
      console.error('Failed to fetch group projects:', error)
      message.error(i18n.t('aiLab.msg.loadProjectsFailed'))
    }
  },

  createProject: async (payload) => {
    const res = await apiClient.post('/ai-lab/projects', payload)
    if (!res.data.success) throw new Error(res.data.message)
    return res.data.data
  },

  openProject: async (id) => {
    set({ projectLoading: true, project: null, datasets: [], models: [], samplesByDataset: {}, events: [] })
    try {
      const res = await apiClient.get(`/ai-lab/projects/${id}`)
      if (!res.data.success) throw new Error(res.data.message)
      const { project, datasets, models } = res.data.data
      set({ project, datasets: datasets || [], models: models || [] })
      return res.data.data
    } catch (error) {
      console.error('Failed to open ai-lab project:', error)
      message.error(i18n.t('aiLab.msg.loadProjectFailed'))
      throw error
    } finally {
      set({ projectLoading: false })
    }
  },

  refreshProject: async () => {
    const { project } = get()
    if (!project) return
    const res = await apiClient.get(`/ai-lab/projects/${project.id}`)
    if (res.data.success) {
      const { project: p, datasets, models } = res.data.data
      set({ project: p, datasets: datasets || [], models: models || [] })
    }
  },

  updateProject: async (patch) => {
    const { project } = get()
    const res = await apiClient.patch(`/ai-lab/projects/${project.id}`, patch)
    if (res.data.success) set({ project: { ...project, ...(res.data.data || patch) } })
    return res.data.data
  },

  // ===================== 数据集与样本 =====================
  updateDataset: async (datasetId, patch) => {
    const res = await apiClient.patch(`/ai-lab/datasets/${datasetId}`, patch)
    if (!res.data.success) throw new Error(res.data.message)
    await get().refreshProject()
    return res.data.data
  },

  fetchSamples: async (datasetId, params = {}) => {
    const res = await apiClient.get(`/ai-lab/datasets/${datasetId}/samples`, { params })
    if (!res.data.success) throw new Error(res.data.message)
    const list = res.data.data || []
    if (!params.split && !params.class_key && !params.shift_set) {
      set((state) => ({ samplesByDataset: { ...state.samplesByDataset, [datasetId]: list } }))
    }
    return list
  },

  /**
   * 上传样本；blobs 为 Blob/File 数组，meta = {class_key, split, shift_set, condition_tags, source}
   */
  uploadSamples: async (datasetId, blobs, meta) => {
    const form = new FormData()
    blobs.forEach((b, i) => form.append('files', b, b.name || `capture-${i}.jpg`))
    form.append('class_key', meta.class_key)
    form.append('split', meta.split || 'train')
    if (meta.shift_set) form.append('shift_set', meta.shift_set)
    if (meta.condition_tags) form.append('condition_tags', JSON.stringify(meta.condition_tags))
    form.append('source', meta.source || 'camera')
    const res = await apiClient.post(`/ai-lab/datasets/${datasetId}/samples`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000
    })
    if (!res.data.success) throw new Error(res.data.message)
    const created = res.data.data || []
    set((state) => ({
      samplesByDataset: {
        ...state.samplesByDataset,
        [datasetId]: [...(state.samplesByDataset[datasetId] || []), ...created]
      }
    }))
    await get().refreshProject()
    return created
  },

  deleteSample: async (sample) => {
    const res = await apiClient.delete(`/ai-lab/samples/${sample.id}`)
    if (!res.data.success) throw new Error(res.data.message)
    set((state) => ({
      samplesByDataset: {
        ...state.samplesByDataset,
        [sample.dataset_id]: (state.samplesByDataset[sample.dataset_id] || []).filter((s) => s.id !== sample.id)
      }
    }))
    await get().refreshProject()
  },

  lockSplit: async (datasetId, holdoutRatio = 0.2) => {
    const res = await apiClient.post(`/ai-lab/datasets/${datasetId}/lock`, { holdout_ratio: holdoutRatio })
    if (!res.data.success) throw new Error(res.data.message)
    /* 留出集重新划分后本地样本缓存作废 */
    set((state) => {
      const next = { ...state.samplesByDataset }
      delete next[datasetId]
      return { samplesByDataset: next }
    })
    await get().refreshProject()
    return res.data.data
  },

  // ===================== 预置数据包 / 表格行 / 错标实验 =====================
  presets: [],
  fetchPresets: async (kind) => {
    const res = await apiClient.get('/ai-lab/presets', { params: kind ? { kind } : {} })
    if (!res.data.success) throw new Error(res.data.message)
    set({ presets: res.data.data || [] })
    return res.data.data || []
  },

  /** 从预置包导入样本；payload = {pack_key, per_class?, shift_sets?, include_train?} */
  importPreset: async (datasetId, payload) => {
    const res = await apiClient.post(`/ai-lab/datasets/${datasetId}/import-preset`, payload, { timeout: 180000 })
    if (!res.data.success) throw new Error(res.data.message)
    get().invalidateSamples(datasetId)
    await get().refreshProject()
    return res.data.data
  },

  /** 表格数据集手工加行；rows = [{class_key, payload, split?, shift_set?}] */
  addRows: async (datasetId, rows) => {
    const res = await apiClient.post(`/ai-lab/datasets/${datasetId}/rows`, { rows })
    if (!res.data.success) throw new Error(res.data.message)
    get().invalidateSamples(datasetId)
    await get().refreshProject()
    return res.data.data || []
  },

  /** 混入错标（L3 实验）：服务器按类别分层随机改标签并记住原值 */
  mislabelDataset: async (datasetId, ratio = 0.2, seed) => {
    const res = await apiClient.post(`/ai-lab/datasets/${datasetId}/mislabel`, { ratio, seed })
    if (!res.data.success) throw new Error(res.data.message)
    get().invalidateSamples(datasetId)
    await get().refreshProject()
    return res.data.data
  },

  restoreLabels: async (datasetId) => {
    const res = await apiClient.post(`/ai-lab/datasets/${datasetId}/restore-labels`)
    if (!res.data.success) throw new Error(res.data.message)
    get().invalidateSamples(datasetId)
    await get().refreshProject()
    return res.data.data
  },

  invalidateSamples: (datasetId) => set((state) => {
    const next = { ...state.samplesByDataset }
    delete next[datasetId]
    return { samplesByDataset: next }
  }),

  // ===================== 模型与评测 =====================
  saveModel: async (payload, liveModel) => {
    const { project } = get()
    const res = await apiClient.post(`/ai-lab/projects/${project.id}/models`, payload)
    if (!res.data.success) throw new Error(res.data.message)
    const model = res.data.data
    set((state) => ({ liveModels: liveModel ? { ...state.liveModels, [model.id]: liveModel } : state.liveModels }))
    await get().refreshProject()
    return model
  },

  /** 取回某个版本的分类器：优先内存缓存，否则下载 artifact JSON */
  loadLiveModel: async (modelId, deserialize) => {
    const cached = get().liveModels[modelId]
    if (cached) return cached
    const res = await apiClient.get(`/ai-lab/models/${modelId}`)
    if (!res.data.success) throw new Error(res.data.message)
    const url = res.data.data.artifact_url
    const artifactRes = await fetch(url, { credentials: 'same-origin' })
    if (!artifactRes.ok) throw new Error(`artifact fetch failed: ${artifactRes.status}`)
    const json = await artifactRes.json()
    const live = deserialize(json)
    set((state) => ({ liveModels: { ...state.liveModels, [modelId]: live } }))
    return live
  },

  saveEvaluation: async (modelId, payload) => {
    const res = await apiClient.post(`/ai-lab/models/${modelId}/evaluations`, payload)
    if (!res.data.success) throw new Error(res.data.message)
    await get().refreshProject()
    return res.data.data
  },

  fetchEvaluations: async (modelId) => {
    const res = await apiClient.get(`/ai-lab/models/${modelId}/evaluations`)
    if (!res.data.success) throw new Error(res.data.message)
    return res.data.data || []
  },

  updateModel: async (modelId, patch) => {
    const res = await apiClient.patch(`/ai-lab/models/${modelId}`, patch)
    if (!res.data.success) throw new Error(res.data.message)
    await get().refreshProject()
    return res.data.data
  },

  // ===================== 过程事件 =====================
  recordEvent: (type, payload = {}) => {
    const { project } = get()
    if (!project) return
    const event = { type, payload, client_ts: new Date().toISOString(), project_id: project.id }
    set((state) => ({ eventQueue: [...state.eventQueue, event] }))
    if (!get().flushTimer) {
      const timer = setTimeout(() => get().flushEvents(), EVENT_FLUSH_MS)
      set({ flushTimer: timer })
    }
  },

  flushEvents: async () => {
    const { eventQueue, flushTimer } = get()
    if (flushTimer) clearTimeout(flushTimer)
    set({ eventQueue: [], flushTimer: null })
    if (!eventQueue.length) return
    const byProject = {}
    eventQueue.forEach((e) => {
      byProject[e.project_id] = byProject[e.project_id] || []
      byProject[e.project_id].push({ type: e.type, payload: e.payload, client_ts: e.client_ts })
    })
    await Promise.all(Object.entries(byProject).map(([projectId, events]) =>
      apiClient.post(`/ai-lab/projects/${projectId}/events`, { events }).then(() => {
        /* 上报成功后把事件直接追加到当前项目的时间线，刷新时会被服务器记录替换 */
        const current = get().project
        if (current && String(current.id) === String(projectId)) {
          set((state) => ({
            events: [...state.events, ...events.map((e, i) => ({ ...e, id: `local-${Date.now()}-${i}`, created_at: e.client_ts }))]
          }))
        }
      }).catch((err) => {
        console.error('Failed to flush ai-lab events:', err)
      })
    ))
  },

  fetchEvents: async () => {
    const { project } = get()
    if (!project) return []
    await get().flushEvents()
    const res = await apiClient.get(`/ai-lab/projects/${project.id}/events`, { params: { limit: 500 } })
    if (res.data.success) set({ events: res.data.data || [] })
    return res.data.data || []
  },

  setExtractor: (patch) => set((state) => ({ extractor: { ...state.extractor, ...patch } })),

  reset: () => set({ project: null, datasets: [], models: [], samplesByDataset: {}, events: [], liveModels: {} })
}))

export default useAiLabStore

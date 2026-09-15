/**
 * 公文模板 store：模板列表、上传、贴角色、删除、生成/预览、草稿提取
 * 接口见 backend/src/routes/docTemplateRoutes.js；生成接口返回 .docx 二进制，这里用 blob 接。
 */
import { create } from 'zustand'
import apiClient from '../utils/api'

const unwrap = (res) => {
  if (!res.data?.success) throw new Error(res.data?.message || 'request failed')
  return res.data.data
}

const useDocTemplateStore = create((set, get) => ({
  templates: [],
  loading: false,

  fetchTemplates: async () => {
    set({ loading: true })
    try {
      const list = unwrap(await apiClient.get('/doc-templates'))
      set({ templates: list || [] })
      return list
    } finally {
      set({ loading: false })
    }
  },

  /** 上传样板：返回 {template, blocks} */
  uploadTemplate: async (file, { name, description, scope } = {}) => {
    const form = new FormData()
    form.append('file', file)
    if (name) form.append('name', name)
    if (description) form.append('description', description)
    if (scope) form.append('scope', scope)
    const data = unwrap(await apiClient.post('/doc-templates', form, { headers: { 'Content-Type': 'multipart/form-data' } }))
    set((state) => ({ templates: [data.template, ...state.templates.filter((t) => t.id !== data.template.id)] }))
    return data
  },

  /** 模板详情 + 样板段落（贴角色用） */
  fetchTemplate: async (id) => unwrap(await apiClient.get(`/doc-templates/${id}`)),

  updateTemplate: async (id, patch) => {
    const template = unwrap(await apiClient.patch(`/doc-templates/${id}`, patch))
    set((state) => ({ templates: state.templates.map((t) => (t.id === template.id ? template : t)) }))
    return template
  },

  deleteTemplate: async (id) => {
    unwrap(await apiClient.delete(`/doc-templates/${id}`))
    set((state) => ({ templates: state.templates.filter((t) => t.id !== id) }))
  },

  /** 生成 .docx（Blob） */
  renderDocx: async (id, content, filename) => {
    const res = await apiClient.post(`/doc-templates/${id}/render`, { content, filename }, { responseType: 'blob' })
    if (res.data && res.data.type && res.data.type.includes('json')) {
      const text = await res.data.text()
      let msg = 'render failed'
      try { msg = JSON.parse(text).message || msg } catch (e) { /* ignore */ }
      throw new Error(msg)
    }
    return res.data
  },

  /** 下载样板原件（Blob） */
  downloadOriginal: async (id) => (await apiClient.get(`/doc-templates/${id}/file`, { responseType: 'blob' })).data,

  /** 正文预览 HTML（不含页眉页脚） */
  previewHtml: async (id, content) => unwrap(await apiClient.post(`/doc-templates/${id}/preview`, { content })).html,

  /** 老师自己的草稿：.docx 文件或纯文字 → 内容 */
  extractDraft: async ({ file, text }) => {
    if (file) {
      const form = new FormData()
      form.append('file', file)
      return unwrap(await apiClient.post('/doc-templates/extract-draft', form, { headers: { 'Content-Type': 'multipart/form-data' } })).content
    }
    return unwrap(await apiClient.post('/doc-templates/extract-draft', { text })).content
  },

  templateById: (id) => get().templates.find((t) => t.id === id) || null
}))

export default useDocTemplateStore

// Loopback-only acceptance fixture: real Chat/store/controller/summary/export, synthetic identity/model/data.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import assert from 'node:assert/strict'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const be = createRequire(path.join(root, 'backend/package.json'))
const fe = createRequire(path.join(root, 'frontend/package.json'))
const stub = (file, value) => { const id = be.resolve(file); be.cache[id] = { id, filename: id, loaded: true, exports: value } }
stub('./src/database/connection', { query: () => { throw new Error('Demo must not access a database') } })
stub('./src/utils/logger', { info() {}, warn() {}, error() {}, debug() {} })
const Message = be('./src/models/Message')
const conversationId = 'b0300000-0000-4000-8000-000000000001'
const model = { id: 1, name: 'summary-fixture', display_name: '合成验收模型', credits_per_chat: 1, stream_enabled: false }
const conversation = { id: conversationId, user_id: 101, title: '水循环探究课：讨论整理验收', model_name: model.name,
  context_length: 2, message_count: 44, created_at: '2026-09-19T00:00:00Z', toJSON() { return { ...this } }, updateStats: async () => {}, getTemperature: () => 0.7 }
let balance = 1000, generations = 0, failNext = false, refunds = 0
const user = { id: 101, hasCredits: n => balance >= n, getCredits: () => balance, hasTokenQuota: () => true,
  consumeCredits: async n => { balance -= n; return { balanceAfter: balance } }, consumeTokens: async () => {},
  addCredits: async n => { balance += n; refunds++ } }
const messages = Array.from({ length: 44 }, (_, index) => new Message({
  id: randomUUID(), conversation_id: conversationId, role: index % 2 ? 'assistant' : 'user', status: 'completed',
  content: index === 0 ? '目标：四年级水循环探究。全课只有十五分钟。EARLY_REQUIREMENT'
    : index === 43 ? '<thinking>PRIVATE_THINKING</thinking>已经讨论了目标、实验顺序和记录方式，最后补充：观察结果需要下节课再核对。'
    : index % 2 ? `第 ${index} 条建议：用两杯水比较蒸发，记录观察，不先认定结论。`
    : `第 ${index} 条补充：保留学生观察与讨论时间。`,
  created_at: '2026-09-19T00:00:00Z', sequence_number: index + 1, model_name: model.name
}))
Message.findById = async id => messages.find(m => m.id === id)
Message.getRecentMessages = async (id, limit = 2) => messages.filter(m => m.conversation_id === id && m.status === 'completed').slice(-limit)
Message.create = async data => { const message = new Message({ ...data, id: randomUUID(), created_at: new Date().toISOString() }); messages.push(message); return message }
stub('./src/models/Conversation', { findById: async id => id === conversationId ? conversation : null, checkOwnership: async (id, owner) => id === conversationId && owner === 101 })
stub('./src/models/User', { findById: async () => user })
stub('./src/models/AIModel', { getUserAvailableModels: async () => [model] })
stub('./src/services/cacheService', { getCachedUserModels: async () => [model], deleteDraft: async () => { throw new Error('Summary deleted unsent draft') }, clearConversationCache: async () => {} })
stub('./src/services/statsService', { updateUserDailyStats: async () => {}, recordModelUsage: async () => {} })
stub('./src/services/aiService', { sendMessage: async (name, context) => {
  generations++
  await new Promise(resolve => setTimeout(resolve, 450))
  if (failNext) { failNext = false; throw new Error('合成服务暂不可用，请重试') }
  const serialized = JSON.stringify(context)
  assert(serialized.includes('EARLY_REQUIREMENT'))
  assert(!serialized.includes('PRIVATE_THINKING'))
  return { content: '# 十五分钟水循环探究课（整理草稿）\n\n## 目标与限制\n面向四年级，用十五分钟观察并讨论水的变化。\n\n## 方案与依据\n比较两杯水的蒸发情况，先观察，再记录；为学生保留讨论时间。\n\n## 下一步与待确认项\n下节课核对观察记录，不将预测当成实验结论。\n\n请核对这份草稿，再下载或继续修改。', usage: { completion_tokens: 120 } }
} })
stub('./src/services/aiStreamService', {})
const Controller = be('./src/controllers/ChatControllerRefactored')
const { createSourceAdapter } = be('./src/services/artifactHandoff/source')
const { createRouter } = be('./src/routes/artifactExports')
const { ArtifactExportService } = be('./src/services/artifactExportService')
const express = be('express')
const app = express()
const authenticate = (req, res, next) => { req.user = { id: 101 }; next() }
app.use('/api/artifact-exports', createRouter({ service: new ArtifactExportService(createSourceAdapter({ Message,
  Conversation: { findById: async id => id === conversationId ? conversation : null }, File: { findById: async () => null }, uploadRoot: path.join(root, 'storage/private/p03-summary-validation') })), authenticate }))
app.use(express.json({ limit: '16kb' }))
app.post(`/api/chat/conversations/:id/messages`, authenticate, Controller.sendMessage)
const ok = (res, data) => res.json({ success: true, data })
app.get('/api/chat/conversations', (req, res) => ok(res, [conversation]))
app.get(`/api/chat/conversations/${conversationId}`, (req, res) => ok(res, conversation))
app.get(`/api/chat/conversations/${conversationId}/messages`, (req, res) => ok(res, messages))
app.get('/api/chat/models', (req, res) => ok(res, [model]))
app.get('/api/chat/credits', (req, res) => ok(res, { credits_stats: { remaining: balance, used: 1000 - balance } }))
app.get('/api/chat/system-prompts', (req, res) => ok(res, []))
app.get('/api/chat/module-combinations', (req, res) => ok(res, []))
app.get('/api/knowledge/combinations', (req, res) => ok(res, []))
app.post('/__summary-test/fail-next', (req, res) => { failNext = true; res.json({ ok: true }) })
app.get('/__summary-test/state', (req, res) => res.json({ balance, generations, refunds }))
const api = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)) })
const { createServer } = await import(path.join(path.dirname(fe.resolve('vite/package.json')), 'dist/node/index.js'))
const vite = await createServer({ root: path.join(root, 'frontend'), configFile: path.join(root, 'frontend/vite.config.js'),
  cacheDir: path.join(root, 'storage/private/p03-summary-validation/vite-cache'),
  optimizeDeps: { entries: ['dev/p03-summary.html'] },
  server: { host: '127.0.0.1', port: 3017, strictPort: true, proxy: { '/api': { target: `http://127.0.0.1:${api.address().port}` }, '/__summary-test': { target: `http://127.0.0.1:${api.address().port}` } } } })
await vite.listen()
console.log('Synthetic summary acceptance: http://localhost:3017/dev/p03-summary.html (no real account, model or TE-DNA receiver)')
async function stop() { await vite.close(); api.closeAllConnections(); api.close(); process.exit(0) }
process.on('SIGINT', stop); process.on('SIGTERM', stop)

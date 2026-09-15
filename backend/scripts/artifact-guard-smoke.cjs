/**
 * 产物守卫冒烟测试：起一个假的 OpenAI 兼容上游（只会"写完课件再附赠 python-pptx 脚本"），
 * 经真实 HTTP 走 登录 → 建会话 → 流式发消息(output_format=pptx) → 非流式发消息 → 普通模式对照，
 * 核对：系统提示词与用户消息里带了格式约定和提醒；流式回复在脚本刚开始就被截断、
 * 上游连接被掐断（假上游没发完就收到断开）；落库内容同样是截断后的；普通模式原样透传。
 *
 * 用法：cd backend && node scripts/artifact-guard-smoke.cjs   （复用已在跑的 :4000，否则自起）
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');
const BACKEND_DIR = path.resolve(__dirname, '..');
process.chdir(BACKEND_DIR);
require('dotenv').config({ path: path.join(BACKEND_DIR, '.env') });
const dbConnection = require('../src/database/connection');
const User = require('../src/models/User');
const config = require('../src/config');
const PORT = process.env.PORT || config.app.port || 4000;
const BASE = process.env.GUARD_SMOKE_BASE || `http://127.0.0.1:${PORT}`;
const MOCK_PORT = 4599;
const PASSWORD = 'Guard#Smoke2026';
const STAMP = Date.now().toString(36);
const MODEL_NAME = `guard_mock_${STAMP}`;
let passed = 0; let failed = 0; const failures = [];
const check = (cond, label, detail) => { if (cond) { passed += 1; console.log(`  ✓ ${label}`); } else { failed += 1; failures.push(label); console.log(`  ✗ ${label}`); if (detail !== undefined) console.log('    ', typeof detail === 'string' ? detail.slice(0, 400) : JSON.stringify(detail).slice(0, 400)); } };
const step = (t) => console.log(`\n== ${t}`);

/** 假模型的回复：一份课件 + "方式二" + pip install + 一大段 python-pptx 脚本 */
const DECK = ['为您制作一份 3 页课件。', '', '```pptx', '# 光合作用', '副标题', '', '---', '', '# 过程', '- 光反应', '- 暗反应', '', '---', '', '# 谢谢', '```'].join('\n');
const TAIL = ['', '---', '', '### 方式二：Python 脚本（自动生成 deck.pptx）', '', '#### 步骤 1：安装依赖', '```bash', 'pip install python-pptx', '```', '', '#### 步骤 2：运行', '```python', 'from pptx import Presentation', 'prs = Presentation()', ...Array.from({ length: 300 }, (_, i) => `slide_${i} = prs.slides.add_slide(prs.slide_layouts[6])  # 第 ${i} 页`), 'prs.save("deck.pptx")', '```'].join('\n');
const FULL = DECK + TAIL;

/** 假上游：记录请求、按小块慢慢流式吐出 FULL，并记录客户端是否中途断开 */
const mock = { requests: [], streams: [] };
function startMockUpstream() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const body = JSON.parse(raw || '{}');
        mock.requests.push(body);
        if (!body.stream) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: 'x', choices: [{ index: 0, message: { role: 'assistant', content: FULL }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 100, total_tokens: 110 } }));
          return;
        }
        const record = { sentChars: 0, finished: false, clientClosedEarly: false };
        mock.streams.push(record);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        const chunks = FULL.match(/[\s\S]{1,12}/g);
        let i = 0;
        const timer = setInterval(() => {
          if (i >= chunks.length) {
            clearInterval(timer);
            record.finished = true;
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }
          const delta = chunks[i++];
          record.sentChars += delta.length;
          res.write(`data: ${JSON.stringify({ id: 'x', choices: [{ index: 0, delta: { content: delta } }] })}\n\n`);
        }, 3);
        res.on('close', () => { if (!record.finished) { record.clientClosedEarly = true; clearInterval(timer); } });
      });
    });
    server.listen(MOCK_PORT, '127.0.0.1', () => resolve(server));
  });
}

async function api(method, url, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`${BASE}${url}`, { method, headers, body: payload });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
  return { status: res.status, body: json };
}
/** 读整条 SSE，返回 {events:[{event,data}]} */
async function sse(url, { token, body }) {
  const res = await fetch(`${BASE}${url}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(body) });
  const text = await res.text();
  const events = [];
  for (const block of text.split('\n\n')) {
    const m = block.match(/^event: (\w+)\ndata: (.*)$/s);
    if (m) { try { events.push({ event: m[1], data: JSON.parse(m[2]) }); } catch (e) { /* skip */ } }
  }
  return { status: res.status, events };
}
async function waitForHealth(ms) { const end = Date.now() + ms; while (Date.now() < end) { try { const r = await fetch(`${BASE}/health`); if (r.ok) return true; } catch (e) { /* not yet */ } await new Promise((r) => setTimeout(r, 500)); } return false; }

let serverProcess = null; let mockServer = null;
const created = { userId: null, modelId: null, conversationIds: [] };
async function main() {
  step('假上游与后端实例');
  mockServer = await startMockUpstream();
  console.log(`  假上游 http://127.0.0.1:${MOCK_PORT}`);
  if (await waitForHealth(1500)) console.log(`  复用 ${BASE}`); else {
    const out = fs.openSync(path.join(os.tmpdir(), 'artifact-guard-smoke-server.log'), 'a');
    serverProcess = spawn(process.execPath, ['src/server.js'], { cwd: BACKEND_DIR, env: { ...process.env }, stdio: ['ignore', out, out] });
    if (!(await waitForHealth(40000))) throw new Error('后端未就绪');
  }

  step('临时用户与假模型');
  await dbConnection.initialize();
  const { rows } = await dbConnection.query('SELECT id FROM user_groups ORDER BY id ASC LIMIT 1');
  const groupId = rows[0]?.id || 1;
  const user = await User.create({ email: `guard_smoke_${STAMP}@example.invalid`, username: `guard_smoke_${STAMP}`, password: PASSWORD, role: 'user', group_id: groupId });
  created.userId = user.id;
  const ins = await dbConnection.query(
    `INSERT INTO ai_models (name, display_name, api_key, provider, api_endpoint, stream_enabled, credits_per_chat, is_active, is_public, sort_order)
     VALUES (?, ?, ?, 'openai', ?, 1, 0, 1, 0, 9999)`,
    [MODEL_NAME, '产物守卫假模型', 'mock-key', `http://127.0.0.1:${MOCK_PORT}/v1`]
  );
  created.modelId = ins.rows.insertId;
  await dbConnection.query('INSERT INTO ai_model_groups (model_id, group_id) VALUES (?, ?)', [created.modelId, groupId]);
  const login = await api('POST', '/api/auth/login', { body: { account: user.username, password: PASSWORD } });
  const token = login.body?.data?.token || login.body?.data?.accessToken;
  check(login.status === 200 && token, '登录', login.body);

  step('流式：output_format=pptx');
  const conv = await api('POST', '/api/chat/conversations', { token, body: { title: '守卫冒烟', model_name: MODEL_NAME } });
  const convId = conv.body?.data?.id || conv.body?.data?.conversation?.id;
  check(conv.status === 201 || conv.status === 200, '建会话', conv.body);
  created.conversationIds.push(convId);
  const streamed = await sse(`/api/chat/conversations/${convId}/messages`, { token, body: { content: '做一份光合作用的课件', stream: true, output_format: 'pptx' } });
  const done = streamed.events.find((e) => e.event === 'done');
  const errors = streamed.events.filter((e) => e.event === 'error');
  check(streamed.status === 200 && done && errors.length === 0, 'SSE 正常结束（有 done、无 error）', { status: streamed.status, errors, events: streamed.events.map((e) => e.event).slice(-5) });
  check(done && done.data.content === DECK, 'done 内容 = 课件本身（"方式二"与脚本被截掉）', done && done.data.content.slice(-200));
  const lastMsg = [...streamed.events].reverse().find((e) => e.event === 'message');
  check(lastMsg && lastMsg.data.fullContent === DECK, '最后一条 message 事件的 fullContent 也是截断后的');
  const req1 = mock.requests[0];
  const sys = req1?.messages?.find((m) => m.role === 'system')?.content || '';
  const lastUser = [...(req1?.messages || [])].reverse().find((m) => m.role === 'user');
  const lastUserText = typeof lastUser?.content === 'string' ? lastUser.content : JSON.stringify(lastUser?.content || '');
  check(sys.includes('回答固定为两部分') && sys.includes('```pptx'), '系统提示词带回答骨架与 ```pptx 约定');
  check(lastUserText.includes('【格式提醒】') && lastUserText.startsWith('做一份光合作用的课件'), '当前用户消息末尾追加了格式提醒', lastUserText.slice(0, 120));
  const s1 = mock.streams[0];
  await new Promise((r) => setTimeout(r, 300));
  check(s1 && s1.clientClosedEarly && !s1.finished, '假上游没发完就被后端断开（省下的就是脚本的 token）', s1);
  check(s1 && s1.sentChars < FULL.length * 0.35, `断开时上游只发了 ${s1?.sentChars}/${FULL.length} 字符（脚本大头没生成）`);
  const msgs = await api('GET', `/api/chat/conversations/${convId}/messages`, { token });
  const list = msgs.body?.data?.messages || msgs.body?.data || [];
  const stored = [...list].reverse().find((m) => m.role === 'assistant');
  check(stored && stored.content === DECK && stored.status === 'completed', '落库的助手消息是截断后的内容且状态 completed', stored && { status: stored.status, tail: stored.content.slice(-80) });
  check(!lastMsg || !(list.find((m) => m.role === 'user')?.content || '').includes('【格式提醒】'), '格式提醒没有落库到用户消息');

  step('非流式：output_format=pptx（假上游同样附赠脚本）');
  const nonStream = await api('POST', `/api/chat/conversations/${convId}/messages`, { token, body: { content: '再来一份', stream: false, output_format: 'pptx' } });
  const nsContent = nonStream.body?.data?.assistant_message?.content || nonStream.body?.data?.ai_message?.content || nonStream.body?.data?.message?.content || JSON.stringify(nonStream.body).slice(0, 200);
  check(nonStream.status === 200 && nsContent === DECK, '非流式回复同样截到课件末尾', nonStream.status === 200 ? nsContent.slice(-120) : nonStream.body);

  step('普通模式对照（不带 output_format）');
  const plain = await sse(`/api/chat/conversations/${convId}/messages`, { token, body: { content: '普通问题', stream: true } });
  const plainDone = plain.events.find((e) => e.event === 'done');
  check(plainDone && plainDone.data.content === FULL, '普通模式原样透传（不截断）', plainDone && plainDone.data.content.length);
  const req3 = mock.requests[mock.requests.length - 1];
  const plainSys = req3?.messages?.find((m) => m.role === 'system');
  const plainUser = [...(req3?.messages || [])].reverse().find((m) => m.role === 'user');
  check(!plainSys && plainUser && plainUser.content === '普通问题', '普通模式没有格式指令也没有提醒');
  const s3 = mock.streams[mock.streams.length - 1];
  await new Promise((r) => setTimeout(r, 300));
  check(s3 && s3.finished && !s3.clientClosedEarly, '普通模式上游完整发完');
}

async function cleanup() {
  try {
    if (created.conversationIds.length) {
      await dbConnection.query('DELETE FROM messages WHERE conversation_id IN (?)', [created.conversationIds]);
      await dbConnection.query('DELETE FROM conversations WHERE id IN (?)', [created.conversationIds]);
    }
    if (created.modelId) {
      await dbConnection.query('DELETE FROM ai_model_groups WHERE model_id = ?', [created.modelId]);
      await dbConnection.query('DELETE FROM ai_models WHERE id = ?', [created.modelId]);
    }
    if (created.userId) {
      await dbConnection.query('DELETE FROM users WHERE id = ?', [created.userId]);
    }
  } catch (e) { console.log('  清理出错:', e.message); }
  try { await dbConnection.close?.(); } catch (e) { /* ignore */ }
  if (mockServer) mockServer.close();
  if (serverProcess) serverProcess.kill('SIGTERM');
}

main().then(async () => {
  await cleanup();
  console.log(`\n通过 ${passed}，失败 ${failed}${failed ? '：' + failures.join('；') : ''}`);
  process.exit(failed ? 1 : 0);
}).catch(async (e) => {
  console.error('\n冒烟脚本异常:', e);
  await cleanup();
  process.exit(1);
});

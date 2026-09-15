/**
 * 公文模板冒烟测试：经真实 HTTP 走完 上传样板 → 读段落与猜的角色 → 改角色 → 生成 .docx → 预览 HTML →
 * 草稿(.docx / 文字)提取 → 权限（同组共享 / 他人不可改）→ 删除。
 *
 * 样板 .docx 由脚本自己用 JSZip 拼最小 OOXML 生成（页眉 + 红头 + 标题 + 主送 + 正文 + 落款 + 日期），不依赖前端 docx 库。
 * 用法：cd backend && node scripts/doc-template-smoke.cjs   （复用已在跑的 :4000，否则自起）
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const BACKEND_DIR = path.resolve(__dirname, '..');
process.chdir(BACKEND_DIR);
require('dotenv').config({ path: path.join(BACKEND_DIR, '.env') });
const JSZip = require('jszip');
const dbConnection = require('../src/database/connection');
const User = require('../src/models/User');
const config = require('../src/config');
const { buildSampleDocx } = require('../src/__tests__/helpers/docxFixture');

const PORT = process.env.PORT || config.app.port || 4000;
const BASE = process.env.DOC_TPL_SMOKE_BASE || `http://127.0.0.1:${PORT}`;
const PASSWORD = 'DocTpl#Smoke2026';
const STAMP = Date.now().toString(36);
let passed = 0; let failed = 0; const failures = [];
const check = (cond, label, detail) => { if (cond) { passed += 1; console.log(`  ✓ ${label}`); } else { failed += 1; failures.push(label); console.log(`  ✗ ${label}`); if (detail !== undefined) console.log('    ', typeof detail === 'string' ? detail.slice(0, 300) : JSON.stringify(detail).slice(0, 300)); } };
const step = (t) => console.log(`\n== ${t}`);

async function api(method, url, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form; else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`${BASE}${url}`, { method, headers, body: payload });
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('wordprocessingml')) return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()), headers: res.headers };
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
  return { status: res.status, body: json, headers: res.headers };
}
const fileForm = (buffer, name, extra = {}) => { const f = new FormData(); f.append('file', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), name); Object.entries(extra).forEach(([k, v]) => f.append(k, v)); return f; };
async function waitForHealth(ms) { const end = Date.now() + ms; while (Date.now() < end) { try { const r = await fetch(`${BASE}/health`); if (r.ok) return true; } catch (e) { /* not yet */ } await new Promise((r) => setTimeout(r, 500)); } return false; }
/** 每段的文字（段内 run 拼接），段之间用 | 分隔 */
const docText = async (buffer) => { const zip = await JSZip.loadAsync(buffer); const xml = await zip.file('word/document.xml').async('string'); return xml.split('</w:p>').map((part) => (part.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []).map((m) => m.replace(/<[^>]+>/g, '')).join('')).filter(Boolean).join('|'); };

let serverProcess = null;
const created = { userIds: [], templateIds: [] };
async function main() {
  step('后端实例');
  if (await waitForHealth(1500)) console.log(`  复用 ${BASE}`); else {
    const out = fs.openSync(path.join(os.tmpdir(), 'doc-template-smoke-server.log'), 'a');
    serverProcess = spawn(process.execPath, ['src/server.js'], { cwd: BACKEND_DIR, env: { ...process.env }, stdio: ['ignore', out, out] });
    if (!(await waitForHealth(40000))) throw new Error('后端未就绪');
  }
  step('临时用户（同组两人 + 另一组一人）');
  await dbConnection.initialize();
  const { rows } = await dbConnection.query('SELECT id FROM user_groups ORDER BY id ASC LIMIT 1');
  const g1 = rows[0]?.id || 1; const g2 = null; // 其他组的用户不挂组（某些组的默认到期日已过，登录会被拒）
  const mk = async (suffix, group) => { const u = await User.create({ email: `doctpl_smoke_${STAMP}${suffix}@example.invalid`, username: `doctpl_smoke_${STAMP}${suffix}`, password: PASSWORD, role: 'user', group_id: group }); created.userIds.push(u.id); return u; };
  const owner = await mk('', g1); const mate = await mk('_m', g1); const other = await mk('_o', g2);
  const login = async (u) => { const r = await api('POST', '/api/auth/login', { body: { account: u.username, password: PASSWORD } }); if (!r.body?.data?.accessToken) throw new Error(`登录失败 ${JSON.stringify(r.body).slice(0, 200)}`); return r.body.data.accessToken; };
  const tOwner = await login(owner); const tMate = await login(mate); const tOther = await login(other);

  step('上传样板');
  const sample = await buildSampleDocx();
  let res = await api('POST', '/api/doc-templates', { token: tOwner, form: fileForm(Buffer.from('not a docx'), 'x.docx') });
  check(res.status === 400, '非 docx 内容返回 400', res.body);
  res = await api('POST', '/api/doc-templates', { token: tOwner, form: fileForm(sample, '通知样板.docx', { name: '学校通知', description: '校办公文' }) });
  check(res.status === 201 && res.body.data?.template?.id, '上传样板成功', res.body);
  const tpl = res.body.data.template; created.templateIds.push(tpl.id);
  const blocks = res.body.data.blocks;
  check(Array.isArray(blocks) && blocks.length === tpl.block_count && tpl.block_count >= 8, `返回段落 ${blocks.length} 块，与 block_count 一致`, { n: blocks.length, bc: tpl.block_count });
  const roleOf = (i) => tpl.roles.find((r) => r.index === i)?.role;
  const byText = (s) => blocks.find((b) => (b.text || '').includes(s));
  const byExact = (s) => blocks.find((b) => (b.text || '').trim() === s);
  check(roleOf(byText('关于开展').index) === 'title', '猜到标题', tpl.roles);
  check(roleOf(byText('各年级组').index) === 'recipient', '猜到主送机关');
  check(roleOf(byText('为丰富').index) === 'body' && roleOf(byText('一、活动主题').index) === 'h1', '猜到正文与一级标题');
  check(roleOf(byText('二〇二六年').index) === 'date' && roleOf(byExact('北京市某某中学').index) === 'signer', '猜到日期与落款', tpl.roles);
  check(roleOf(byText('文件').index) === 'fixed' && roleOf(byText('号').index) === 'fixed', '红头与发文字号保持固定');
  check(tpl.summary?.headers?.[0]?.text?.includes('内部文件') && tpl.summary?.page?.width_cm === 21, '摘要含页眉文字与页面尺寸', tpl.summary);
  check(tpl.summary?.roleFormats?.title?.font === '方正小标宋简体' && tpl.summary?.roleFormats?.body?.firstLine === 2, '各角色格式摘要', tpl.summary?.roleFormats);
  check(tpl.file_path === undefined, '对外不暴露文件路径');

  step('读取 / 改角色 / 权限');
  res = await api('GET', `/api/doc-templates/${tpl.id}`, { token: tOwner });
  check(res.status === 200 && res.body.data?.blocks?.length === blocks.length && res.body.data.template.is_owner === true, 'GET 带段落', res.body);
  res = await api('GET', `/api/doc-templates/${tpl.id}`, { token: tMate });
  check(res.status === 403, '私有模板同组不可见', res.status);
  res = await api('PATCH', `/api/doc-templates/${tpl.id}`, { token: tMate, body: { name: 'x' } });
  check(res.status === 403, '他人不能改', res.status);
  res = await api('PATCH', `/api/doc-templates/${tpl.id}`, { token: tOwner, body: { scope: 'group', roles: tpl.roles.map((r) => (r.index === byText('二、工作要求').index ? { ...r, role: 'delete' } : r)) } });
  check(res.status === 200 && res.body.data.scope === 'group' && res.body.data.roles.find((r) => r.index === byText('二、工作要求').index)?.role === 'delete', '改 scope 与角色', res.body);
  res = await api('GET', `/api/doc-templates`, { token: tMate });
  check(res.status === 200 && res.body.data.some((t) => t.id === tpl.id && t.is_owner === false), '共享后同组列表可见');
  res = await api('GET', `/api/doc-templates`, { token: tOther });
  check(res.status === 200 && !res.body.data.some((t) => t.id === tpl.id), '其他组看不见');
  res = await api('PATCH', `/api/doc-templates/${tpl.id}`, { token: tOwner, body: { roles: [{ index: 0, role: 'title' }] } });
  check(res.status === 400, '没有正文角色返回 400', res.body);
  res = await api('PATCH', `/api/doc-templates/${tpl.id}`, { token: tOwner, body: { roles: [{ index: 999, role: 'body' }] } });
  check(res.status === 400, 'index 越界返回 400');

  step('生成与预览');
  const content = { title: '关于举办冬季读书月的通知', recipient: '各年级组、图书馆：', blocks: [{ type: 'paragraph', runs: [{ text: '为营造书香校园，' }, { text: '决定', bold: true }, { text: '举办读书月活动。' }] }, { type: 'heading', level: 1, runs: [{ text: '一、活动安排' }] }, { type: 'list', ordered: true, items: [{ runs: [{ text: '每班推荐三本' }] }] }, { type: 'table', rows: [[{ text: '日期' }, { text: '活动' }], [{ text: '12月1日' }, { text: '启动' }]] }], attachments: ['附件：1. 安排表'], signer: '北京市某某中学', date: '二〇二六年十一月二十日' };
  res = await api('POST', `/api/doc-templates/${tpl.id}/render`, { token: tMate, body: { content, filename: '读书月通知' } });
  check(res.status === 200 && res.buffer && res.buffer.length > 2000, '同组用户可生成 .docx', res.body);
  check(/%E8%AF%BB%E4%B9%A6%E6%9C%88/.test(res.headers.get('content-disposition') || ''), '下载文件名为中文标题');
  const text = res.buffer ? await docText(res.buffer) : '';
  check(text.includes('关于举办冬季读书月的通知') && text.includes('各年级组、图书馆：') && text.includes('一、活动安排') && text.includes('1. 每班推荐三本') && text.includes('12月1日'), '生成内容包含标题/主送/正文/列表/表格', text.slice(0, 400));
  check(text.includes('北京市某某中学文件') && text.includes('某中〔2026〕12 号') && text.includes('抄送'), '红头、发文字号、版记原样保留');
  check(!text.includes('二、工作要求') && !text.includes('为丰富校园'), '样板里的示例正文与 delete 的段落没有残留');
  check(text.includes('北京市某某中学') && text.includes('二〇二六年十一月二十日'), '落款与日期');
  const zip = await JSZip.loadAsync(res.buffer);
  check(!!zip.file('word/header1.xml') && (await zip.file('word/document.xml').async('string')).includes('headerReference'), '页眉文件与引用保留');
  res = await api('POST', `/api/doc-templates/${tpl.id}/preview`, { token: tOwner, body: { content } });
  check(res.status === 200 && typeof res.body.data?.html === 'string' && res.body.data.html.includes('关于举办冬季读书月的通知') && res.body.data.html.includes('<table'), '预览 HTML', res.body);
  res = await api('POST', `/api/doc-templates/${tpl.id}/render`, { token: tOwner, body: { content: { blocks: [] } } });
  check(res.status === 400, '空内容返回 400');
  res = await api('POST', `/api/doc-templates/${tpl.id}/render`, { token: tOther, body: { content } });
  check(res.status === 403, '其他组不能生成');

  step('草稿提取');
  res = await api('POST', '/api/doc-templates/extract-draft', { token: tOwner, form: fileForm(sample, '草稿.docx') });
  const c = res.body?.data?.content;
  check(res.status === 200 && c && c.title.includes('关于开展') && c.recipient === '各年级组、各处室：' && c.date === '二〇二六年九月十五日' && c.signer.includes('北京市某某中学'), '草稿 .docx 拆出标题/主送/落款/日期', c);
  check(c && c.blocks.some((b) => b.type === 'heading' && b.level === 1) && c.blocks.some((b) => b.type === 'paragraph') && c.attachments.length === 1, '草稿正文块与附件', c && { n: c.blocks.length, att: c.attachments });
  res = await api('POST', '/api/doc-templates/extract-draft', { token: tOwner, body: { text: '# 关于放假的通知\n各位同学：\n明天放假。' } });
  check(res.status === 200 && res.body.data.content.blocks.length === 3 && res.body.data.content.blocks[0].type === 'heading', '粘贴文字拆块', res.body);
  res = await api('POST', '/api/doc-templates/extract-draft', { token: tOwner, body: {} });
  check(res.status === 400, '既无文件又无文字返回 400');

  step('下载原件 / 删除');
  res = await api('GET', `/api/doc-templates/${tpl.id}/file`, { token: tMate });
  check(res.status === 200 && res.buffer && res.buffer.length === sample.length, '同组可下载原件');
  res = await api('DELETE', `/api/doc-templates/${tpl.id}`, { token: tMate });
  check(res.status === 403, '他人不能删');
  res = await api('DELETE', `/api/doc-templates/${tpl.id}`, { token: tOwner });
  check(res.status === 200, '所有者删除');
  res = await api('GET', `/api/doc-templates/${tpl.id}`, { token: tOwner });
  check(res.status === 404, '删除后 404');
  created.templateIds = [];
}

async function cleanup() {
  try {
    if (created.templateIds.length) await dbConnection.query(`DELETE FROM doc_templates WHERE id IN (${created.templateIds.map(() => '?').join(',')})`, created.templateIds);
    if (created.userIds.length) await dbConnection.query(`DELETE FROM users WHERE id IN (${created.userIds.map(() => '?').join(',')}) AND username LIKE 'doctpl_smoke_%'`, created.userIds);
  } catch (e) { console.log('清理失败', e.message); }
  if (serverProcess) serverProcess.kill();
  try { await dbConnection.close(); } catch (e) { /* ignore */ }
}
main().then(async () => { await cleanup(); console.log(`\n结果：通过 ${passed}，失败 ${failed}`); if (failed) { console.log('失败项：'); failures.forEach((f) => console.log('  -', f)); } process.exit(failed ? 1 : 0); })
  .catch(async (e) => { console.error('冒烟测试异常:', e); await cleanup(); process.exit(1); });

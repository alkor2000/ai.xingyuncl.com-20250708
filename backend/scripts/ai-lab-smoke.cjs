#!/usr/bin/env node
/**
 * AI训练专区（ai-lab）冒烟测试 —— 用真实 HTTP 走通主流程
 *
 * 用法：cd backend && node scripts/ai-lab-smoke.cjs
 *
 * 流程：
 * 1. 连接本地库，创建两个临时用户（所有者 user + 同组 admin）
 * 2. 若 :4000 已有后端实例则复用，否则自行 spawn `node src/server.js`
 * 3. 登录（account + password）→ 任务模板 → 建项目 → 改类别 → 上传样本（sharp 生成纯色图）
 *    → 查询/改标签/软删除 → lock（两轮，验证旧留出集不变）→ 保存模型 → 下载 artifact
 *    → 评测 holdout + shift（验证 generalization_gap）→ model_card → 事件 → 列表/归档
 *    → 权限（同组 admin 可读不可写、未登录 401）→ 管理端列表
 * 4. 清理：删除临时用户的 ai_lab_* 数据、样本与模型文件目录、临时用户本身；关闭自启的服务
 *
 * 环境变量：AI_LAB_SMOKE_BASE 可覆盖后端地址（默认 http://127.0.0.1:${PORT||4000}）
 * 退出码：全部检查通过 0，否则 1
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const os = require('os');

const BACKEND_DIR = path.resolve(__dirname, '..');
process.chdir(BACKEND_DIR);
require('dotenv').config({ path: path.join(BACKEND_DIR, '.env') });

const sharp = require('sharp');
const dbConnection = require('../src/database/connection');
const User = require('../src/models/User');
const config = require('../src/config');

const PORT = process.env.PORT || config.app.port || 4000;
const BASE = process.env.AI_LAB_SMOKE_BASE || `http://127.0.0.1:${PORT}`;
const STAMP = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
const PASSWORD = `Smoke-${STAMP}-Aa1`;

const results = { passed: 0, failed: 0, failures: [] };
function check(condition, label, detail) {
  if (condition) {
    results.passed += 1;
    console.log(`  [PASS] ${label}`);
  } else {
    results.failed += 1;
    results.failures.push(label);
    console.log(`  [FAIL] ${label}${detail !== undefined ? ' -> ' + JSON.stringify(detail).slice(0, 300) : ''}`);
  }
}
function step(title) {
  console.log(`\n== ${title}`);
}

/* ================================================================
 * HTTP 工具
 * ================================================================ */
async function api(method, url, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${url}`, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
  return { status: res.status, body: json };
}

async function waitForHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return true;
    } catch (e) { /* not ready */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

/** 纯色 JPEG（带少量噪点避免完全相同） */
async function makeImage(r, g, b, width = 640, height = 480) {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    raw[i * 3] = Math.max(0, Math.min(255, r + ((i * 7) % 5) - 2));
    raw[i * 3 + 1] = g;
    raw[i * 3 + 2] = b;
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
}

function buildForm(buffers, fields) {
  const form = new FormData();
  buffers.forEach((buf, i) => form.append('files', new Blob([buf], { type: 'image/jpeg' }), `smoke-${i}.jpg`));
  Object.entries(fields).forEach(([key, value]) => {
    if (value !== undefined && value !== null) form.append(key, typeof value === 'string' ? value : JSON.stringify(value));
  });
  return form;
}

/* ================================================================
 * 主流程
 * ================================================================ */
let serverProcess = null;
const created = { userIds: [], ownerId: null, projectIds: [] };

async function ensureServer() {
  step('后端实例');
  if (await waitForHealth(1500)) {
    console.log(`  复用已在运行的实例 ${BASE}`);
    return;
  }
  const logFile = path.join(os.tmpdir(), 'ai-lab-smoke-server.log');
  const out = fs.openSync(logFile, 'a');
  serverProcess = spawn(process.execPath, ['src/server.js'], {
    cwd: BACKEND_DIR,
    env: { ...process.env },
    stdio: ['ignore', out, out],
    detached: false
  });
  console.log(`  已启动 node src/server.js (pid ${serverProcess.pid})，日志 ${logFile}`);
  const ok = await waitForHealth(40000);
  if (!ok) throw new Error('后端未能在 40 秒内就绪');
  console.log('  /health 就绪');
}

async function createTempUsers() {
  step('创建临时用户');
  const { rows } = await dbConnection.query('SELECT id FROM user_groups ORDER BY id ASC LIMIT 1');
  const groupId = rows.length ? rows[0].id : 1;

  const owner = await User.create({
    email: `ailab_smoke_${STAMP}@example.invalid`,
    username: `ailab_smoke_${STAMP}`,
    password: PASSWORD,
    role: 'user',
    group_id: groupId
  });
  const admin = await User.create({
    email: `ailab_smoke_${STAMP}_admin@example.invalid`,
    username: `ailab_smoke_${STAMP}_adm`,
    password: PASSWORD,
    role: 'admin',
    group_id: groupId
  });
  created.userIds.push(owner.id, admin.id);
  created.ownerId = owner.id;
  console.log(`  owner id=${owner.id} (user, group ${groupId}), admin id=${admin.id} (admin, group ${groupId})`);
  return { owner, admin };
}

async function login(username) {
  const res = await api('POST', '/api/auth/login', { body: { account: username, password: PASSWORD } });
  if (!res.body.success || !res.body.data?.accessToken) {
    throw new Error(`登录失败 ${username}: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  }
  return res.body.data.accessToken;
}

async function runFlow(owner, admin) {
  step('登录');
  const ownerToken = await login(owner.username);
  const adminToken = await login(admin.username);
  check(!!ownerToken && !!adminToken, '两个临时用户均能通过 account+password 登录');

  step('任务模板');
  let res = await api('GET', '/api/ai-lab/tasks', { token: ownerToken });
  check(res.status === 200 && Array.isArray(res.body.data) && res.body.data.length === 3, 'GET /tasks 返回 3 个模板', res.body);
  check(res.body.data?.[0]?.key === 'P1' && res.body.data?.[0]?.default_classes?.length === 4, 'P1 模板含 4 个默认类别');

  res = await api('GET', '/api/ai-lab/tasks');
  check(res.status === 401, '未登录访问返回 401', res.status);

  step('创建项目');
  res = await api('POST', '/api/ai-lab/projects', { token: ownerToken, body: { title: '冒烟测试项目', task_key: 'P1', participation_mode: 'individual', context: { source: 'smoke' } } });
  check(res.status === 201 && res.body.data?.project?.id && res.body.data?.dataset?.id, 'POST /projects 返回 project + dataset', res.body);
  const project = res.body.data.project;
  const dataset = res.body.data.dataset;
  created.projectIds.push(project.id);
  check(dataset.classes.length === 4 && dataset.version === 0 && dataset.sample_count === 0, '默认数据集含 4 类、version=0');
  check(project.task_key === 'P1' && project.summary?.model_count === 0, '项目 task_key=P1 且 summary 已初始化');

  res = await api('POST', '/api/ai-lab/projects', { token: ownerToken, body: { title: '', task_key: 'P1' } });
  check(res.status === 400, '空标题返回 400', res.status);
  res = await api('POST', '/api/ai-lab/projects', { token: ownerToken, body: { title: 'x', task_key: 'NOPE' } });
  check(res.status === 400, '无效 task_key 返回 400', res.status);

  step('数据集类别');
  res = await api('PATCH', `/api/ai-lab/datasets/${dataset.id}`, { token: ownerToken, body: { classes: [...dataset.classes, { key: 'cup', label: '水杯' }] } });
  check(res.status === 200 && res.body.data?.classes?.length === 5, 'PATCH /datasets 新增类别 cup', res.body);
  res = await api('PATCH', `/api/ai-lab/datasets/${dataset.id}`, { token: ownerToken, body: { classes: [{ key: 'Bad Key' }] } });
  check(res.status === 400, '非法类别 key 返回 400', res.status);

  step('上传样本');
  const colors = { class_a: [220, 40, 40], class_b: [40, 200, 60], cup: [40, 60, 220] };
  const trainCounts = { class_a: 8, class_b: 8, cup: 8 };
  for (const [key, n] of Object.entries(trainCounts)) {
    const buffers = [];
    for (let i = 0; i < n; i++) buffers.push(await makeImage(...colors[key]));
    res = await api('POST', `/api/ai-lab/datasets/${dataset.id}/samples`, {
      token: ownerToken,
      form: buildForm(buffers, { class_key: key, split: 'train', source: 'camera', condition_tags: { background: 'desk', light: 'day' } })
    });
    check(res.status === 201 && res.body.data?.length === n, `上传 ${n} 张 train 样本到 ${key}`, res.body);
  }
  const firstSample = (await api('GET', `/api/ai-lab/datasets/${dataset.id}/samples?class_key=class_a`, { token: ownerToken })).body.data[0];
  check(firstSample && firstSample.file_url === '/uploads/' + firstSample.file_path && firstSample.width <= 320 && firstSample.height <= 320, '样本带 file_url 且已缩到最长边 ≤320', firstSample);
  check(firstSample.condition_tags?.background === 'desk' && firstSample.added_version === 0, 'condition_tags 与 added_version=0 正确落库', firstSample);

  const imgRes = await fetch(`${BASE}${firstSample.file_url}`);
  check(imgRes.status === 200 && (imgRes.headers.get('content-type') || '').includes('image/jpeg'), '/uploads 静态服务可读取样本图片', imgRes.status);

  for (const key of ['class_a', 'class_b']) {
    const buffers = [];
    for (let i = 0; i < 3; i++) buffers.push(await makeImage(colors[key][0], colors[key][1], colors[key][2], 320, 240));
    res = await api('POST', `/api/ai-lab/datasets/${dataset.id}/samples`, {
      token: ownerToken,
      form: buildForm(buffers, { class_key: key, split: 'shift', shift_set: 'bg-window', source: 'upload' })
    });
    check(res.status === 201 && res.body.data?.length === 3 && res.body.data[0].shift_set === 'bg-window', `上传 3 张 shift(bg-window) 样本到 ${key}`, res.body);
  }

  res = await api('POST', `/api/ai-lab/datasets/${dataset.id}/samples`, { token: ownerToken, form: buildForm([await makeImage(1, 2, 3)], { class_key: 'nope' }) });
  check(res.status === 400, '未知类别上传返回 400', res.status);
  res = await api('POST', `/api/ai-lab/datasets/${dataset.id}/samples`, { token: ownerToken, form: buildForm([await makeImage(1, 2, 3)], { class_key: 'cup', split: 'shift' }) });
  check(res.status === 400, 'split=shift 缺 shift_set 返回 400', res.status);
  res = await api('POST', `/api/ai-lab/datasets/${dataset.id}/samples`, { token: ownerToken, form: buildForm([Buffer.from('not an image')], { class_key: 'cup' }) });
  check(res.status === 400, '非图片文件返回 400', res.status);

  step('样本查询 / 更新 / 软删除');
  res = await api('GET', `/api/ai-lab/datasets/${dataset.id}/samples`, { token: ownerToken });
  check(res.status === 200 && res.body.data.length === 30, '样本总数 30（24 train + 6 shift）', res.body.data?.length);
  res = await api('GET', `/api/ai-lab/datasets/${dataset.id}/samples?split=shift&shift_set=bg-window`, { token: ownerToken });
  check(res.body.data.length === 6, 'split/shift_set 过滤生效', res.body.data?.length);

  res = await api('PATCH', `/api/ai-lab/samples/${firstSample.id}`, { token: ownerToken, body: { condition_tags: { background: 'window' } } });
  check(res.status === 200 && res.body.data?.condition_tags?.background === 'window', 'PATCH /samples 更新 condition_tags', res.body);
  res = await api('PATCH', `/api/ai-lab/samples/${firstSample.id}`, { token: ownerToken, body: { class_key: 'nope' } });
  check(res.status === 400, 'PATCH 未知类别返回 400', res.status);

  const toDelete = (await api('GET', `/api/ai-lab/datasets/${dataset.id}/samples?class_key=class_a&split=train`, { token: ownerToken })).body.data.slice(-1)[0];
  res = await api('DELETE', `/api/ai-lab/samples/${toDelete.id}`, { token: ownerToken });
  check(res.status === 200 && res.body.data?.removed_version === 0, 'DELETE /samples 软删除记 removed_version=0', res.body);
  res = await api('DELETE', `/api/ai-lab/samples/${toDelete.id}`, { token: ownerToken });
  check(res.status === 404, '重复删除返回 404', res.status);
  res = await api('GET', `/api/ai-lab/datasets/${dataset.id}/samples?include_removed=1&class_key=class_a&split=train`, { token: ownerToken });
  check(res.body.data.some(s => s.id === toDelete.id && s.removed_version === 0), 'include_removed=1 能看到已删样本');
  res = await api('GET', `/api/ai-lab/projects/${project.id}`, { token: ownerToken });
  check(res.body.data?.datasets?.[0]?.sample_count === 29 && res.body.data?.project?.summary?.sample_count === 29, 'dataset.sample_count 与 project.summary.sample_count = 29', res.body.data?.datasets?.[0]);
  check(res.body.data?.datasets?.[0]?.counts?.train?.class_a === 7 && res.body.data?.datasets?.[0]?.counts?.shift?.['bg-window']?.class_b === 3, 'counts 三集结构正确', res.body.data?.datasets?.[0]?.counts);

  step('锁定留出集（两轮）');
  res = await api('POST', `/api/ai-lab/datasets/${dataset.id}/lock`, { token: ownerToken, body: { holdout_ratio: 0.25, seed: 7 } });
  check(res.status === 200 && res.body.data?.dataset?.version === 1 && res.body.data?.dataset?.seed === 7 && res.body.data?.dataset?.holdout_ratio === 0.25, 'lock 后 version=1、seed/ratio 写回', res.body.data?.dataset);
  let counts = res.body.data?.counts || {};
  check(counts.holdout?.class_a === 2 && counts.holdout?.class_b === 2 && counts.holdout?.cup === 2 && counts.train?.class_a === 5, '分层留出：7→2、8→2、8→2', counts);
  check(res.body.data?.holdout_added === 6, 'holdout_added=6');
  const holdoutRound1 = (await api('GET', `/api/ai-lab/datasets/${dataset.id}/samples?split=holdout`, { token: ownerToken })).body.data.map(s => s.id).sort((a, b) => a - b);

  res = await api('PATCH', `/api/ai-lab/samples/${holdoutRound1[0]}`, { token: ownerToken, body: { split: 'train' } });
  check(res.status === 400, 'holdout 样本改 split 返回 400', res.status);

  const moreBuffers = [];
  for (let i = 0; i < 4; i++) moreBuffers.push(await makeImage(200, 60, 60));
  res = await api('POST', `/api/ai-lab/datasets/${dataset.id}/samples`, { token: ownerToken, form: buildForm(moreBuffers, { class_key: 'class_a' }) });
  check(res.status === 201 && res.body.data?.[0]?.added_version === 1, '第二轮新样本 added_version=1', res.body.data?.[0]);
  res = await api('POST', `/api/ai-lab/datasets/${dataset.id}/lock`, { token: ownerToken, body: { holdout_ratio: 0.25, seed: 8 } });
  counts = res.body.data?.counts || {};
  check(res.body.data?.dataset?.version === 2 && res.body.data?.holdout_added === 1 && counts.holdout?.class_a === 3, '第二轮只对新样本划分：4→1，holdout class_a=3', { counts, holdout_added: res.body.data?.holdout_added });
  const holdoutRound2 = (await api('GET', `/api/ai-lab/datasets/${dataset.id}/samples?split=holdout`, { token: ownerToken })).body.data.map(s => s.id).sort((a, b) => a - b);
  check(holdoutRound1.every(id => holdoutRound2.includes(id)) && holdoutRound2.length === 7, '旧留出集不变，新样本补入', { holdoutRound1, holdoutRound2 });
  res = await api('POST', `/api/ai-lab/datasets/${dataset.id}/lock`, { token: ownerToken, body: { holdout_ratio: 1.5 } });
  check(res.status === 400, '非法 holdout_ratio 返回 400', res.status);

  step('保存模型 / 下载 artifact');
  const artifact = { engine: 'image-knn', k: 3, embeddings: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]], labels: ['class_a', 'class_b'] };
  res = await api('POST', `/api/ai-lab/projects/${project.id}/models`, {
    token: ownerToken,
    body: { dataset_id: dataset.id, dataset_version: 2, engine: 'image-knn', feature_extractor: 'mobilenet_v1_050_224', params: { k: 3, metric: 'cosine' }, class_keys: ['class_a', 'class_b', 'cup'], train_sample_count: 22, artifact, note: '第一版' }
  });
  check(res.status === 201 && res.body.data?.version === 1 && res.body.data?.artifact_url?.endsWith(`/models/v1.json`), 'POST /models 分配 version=1 并返回 artifact_url', res.body);
  const model1 = res.body.data;
  const artifactRes = await fetch(`${BASE}${model1.artifact_url}`);
  const artifactJson = artifactRes.ok ? await artifactRes.json() : null;
  check(artifactRes.status === 200 && JSON.stringify(artifactJson) === JSON.stringify(artifact), 'artifact 文件可通过 /uploads 下载且内容一致', artifactRes.status);
  const artifactAbs = path.join(config.storage.paths.uploads, model1.artifact_path);
  check(fs.existsSync(artifactAbs), `artifact 落盘于 uploads/${model1.artifact_path}`);

  res = await api('GET', `/api/ai-lab/models/${model1.id}`, { token: ownerToken });
  check(res.status === 200 && res.body.data?.artifact_url === model1.artifact_url && res.body.data?.params?.k === 3, 'GET /models/:id 返回模型与 artifact_url', res.body);
  res = await api('POST', `/api/ai-lab/projects/${project.id}/models`, { token: ownerToken, body: { dataset_id: dataset.id, engine: 'image-knn', class_keys: ['a'] } });
  check(res.status === 400, '缺 artifact 返回 400', res.status);

  step('评测与指标合并');
  const holdoutMetrics = { accuracy: 0.86, per_class: { class_a: { precision: 1, recall: 0.67, support: 3 } }, confusion: { labels: ['class_a', 'class_b', 'cup'], matrix: [[2, 1, 0], [0, 2, 0], [0, 0, 2]] } };
  res = await api('POST', `/api/ai-lab/models/${model1.id}/evaluations`, { token: ownerToken, body: { split: 'holdout', sample_count: 7, metrics: holdoutMetrics, errors: [{ sample_id: holdoutRound2[0], actual: 'class_a', predicted: 'class_b', confidence: 0.55 }] } });
  check(res.status === 201 && res.body.data?.metrics?.holdout?.accuracy === 0.86 && res.body.data?.metrics?.generalization_gap === null, 'holdout 评测合并进 metrics，gap=null', res.body.data?.metrics);
  res = await api('POST', `/api/ai-lab/models/${model1.id}/evaluations`, { token: ownerToken, body: { split: 'shift', shift_set: 'bg-window', sample_count: 6, metrics: { accuracy: 0.5, per_class: {}, confusion: { labels: [], matrix: [] } } } });
  check(res.status === 201 && res.body.data?.metrics?.shift?.['bg-window']?.accuracy === 0.5 && res.body.data?.metrics?.generalization_gap === 0.36, 'shift 评测合并，generalization_gap=0.36', res.body.data?.metrics);
  res = await api('POST', `/api/ai-lab/models/${model1.id}/evaluations`, { token: ownerToken, body: { split: 'shift', sample_count: 1, metrics: { accuracy: 0.1 } } });
  check(res.status === 400, 'shift 评测缺 shift_set 返回 400', res.status);
  res = await api('GET', `/api/ai-lab/models/${model1.id}/evaluations`, { token: ownerToken });
  check(res.status === 200 && res.body.data?.length === 2 && res.body.data[0].errors?.length === 1, 'GET /evaluations 返回 2 条且 errors 落库', res.body.data?.length);

  res = await api('PATCH', `/api/ai-lab/models/${model1.id}`, { token: ownerToken, body: { model_card: { scope: '桌面上的水杯', not_scope: '窗边逆光', evidence: 'holdout 0.86 / shift 0.5' }, note: '换了 k=3' } });
  check(res.status === 200 && res.body.data?.model_card?.scope === '桌面上的水杯' && res.body.data?.note === '换了 k=3', 'PATCH /models 写 model_card 与 note', res.body.data);

  res = await api('POST', `/api/ai-lab/projects/${project.id}/models`, { token: ownerToken, body: { dataset_id: dataset.id, engine: 'image-knn', class_keys: ['class_a', 'class_b', 'cup'], train_sample_count: 22, artifact: { v: 2 } } });
  check(res.status === 201 && res.body.data?.version === 2, '第二个模型 version=2', res.body.data?.version);

  res = await api('GET', `/api/ai-lab/projects/${project.id}`, { token: ownerToken });
  const summary = res.body.data?.project?.summary;
  check(summary?.sample_count === 33 && summary?.model_count === 2 && summary?.best_holdout_accuracy === 0.86 && summary?.best_shift_accuracy === 0.5 && summary?.generalization_gap === 0.36, 'project.summary 重算正确', summary);
  check(res.body.data?.models?.length === 2 && res.body.data.models[0].artifact_url === undefined && res.body.data.models[0].metrics?.holdout?.accuracy === 0.86, '项目详情 models 不带 artifact 但带 metrics', res.body.data?.models?.[0]);

  step('过程事件');
  res = await api('POST', `/api/ai-lab/projects/${project.id}/events`, { token: ownerToken, body: { events: [
    { type: 'task.open', payload: { step: 'collect' }, client_ts: new Date().toISOString() },
    { type: 'train.run', payload: { model_id: model1.id } },
    { type: 'reflection.write', payload: { text: '换背景后准确率下降' }, client_ts: 'not-a-date' }
  ] } });
  check(res.status === 201 && res.body.data?.inserted === 3, 'POST /events 写入 3 条', res.body);
  res = await api('POST', `/api/ai-lab/projects/${project.id}/events`, { token: ownerToken, body: { events: [{ type: 'hack.me' }] } });
  check(res.status === 400, '未知事件类型返回 400', res.status);
  res = await api('POST', `/api/ai-lab/projects/${project.id}/events`, { token: ownerToken, body: { events: [{ type: 'task.open', payload: { blob: 'x'.repeat(9000) } }] } });
  check(res.status === 400, 'payload > 8KB 返回 400', res.status);
  res = await api('GET', `/api/ai-lab/projects/${project.id}/events?after_id=0&limit=200`, { token: ownerToken });
  check(res.status === 200 && res.body.data?.length === 3 && res.body.data[0].type === 'task.open' && res.body.data[0].payload?.step === 'collect', 'GET /events 按 id 升序返回 3 条', res.body.data);
  const lastEventId = res.body.data[2].id;
  res = await api('GET', `/api/ai-lab/projects/${project.id}/events?after_id=${lastEventId}`, { token: ownerToken });
  check(res.body.data?.length === 0, 'after_id 增量拉取为空');

  step('项目列表 / 归档');
  res = await api('GET', '/api/ai-lab/projects?status=active&page=1&limit=20', { token: ownerToken });
  check(res.status === 200 && res.body.data?.some(p => p.id === project.id) && res.body.pagination?.total >= 1, 'GET /projects 含本项目且带分页', res.body.pagination);
  res = await api('PATCH', `/api/ai-lab/projects/${project.id}`, { token: ownerToken, body: { status: 'archived', title: '冒烟测试项目（已归档）' } });
  check(res.status === 200 && res.body.data?.status === 'archived', 'PATCH /projects 归档', res.body.data);
  res = await api('GET', '/api/ai-lab/projects?status=active', { token: ownerToken });
  check(!res.body.data?.some(p => p.id === project.id), '归档后不在 active 列表');
  res = await api('GET', '/api/ai-lab/projects?status=archived', { token: ownerToken });
  check(res.body.data?.some(p => p.id === project.id), '归档后出现在 archived 列表');

  res = await api('POST', `/api/ai-lab/projects/${project.id}/datasets`, { token: ownerToken, body: { name: '第二个数据集', classes: [{ key: 'x', label: 'X' }] } });
  check(res.status === 201 && res.body.data?.classes?.length === 1, 'POST /projects/:id/datasets 创建第二个数据集', res.body);

  step('权限');
  res = await api('GET', `/api/ai-lab/projects/${project.id}`, { token: adminToken });
  check(res.status === 200, '同组 admin 可读项目', res.status);
  res = await api('POST', `/api/ai-lab/projects/${project.id}/events`, { token: adminToken, body: { events: [{ type: 'task.open' }] } });
  check(res.status === 403, '同组 admin 写事件返回 403', res.status);
  res = await api('POST', `/api/ai-lab/datasets/${dataset.id}/lock`, { token: adminToken, body: {} });
  check(res.status === 403, '同组 admin lock 返回 403', res.status);
  res = await api('GET', `/api/ai-lab/models/${model1.id}`, { token: adminToken });
  check(res.status === 200, '同组 admin 可读模型', res.status);
  res = await api('GET', '/api/ai-lab/projects/999999999', { token: ownerToken });
  check(res.status === 404, '不存在的项目返回 404', res.status);

  step('管理端列表');
  res = await api('GET', `/api/ai-lab/admin/projects?user_id=${owner.id}&page=1&limit=10`, { token: adminToken });
  check(res.status === 200 && res.body.data?.length === 1 && res.body.data[0].user?.username === owner.username, 'admin 按 user_id 查到本组项目并附 username', res.body);
  res = await api('GET', '/api/ai-lab/admin/projects', { token: ownerToken });
  check(res.status === 403, '普通用户访问 /admin/projects 返回 403', res.status);
}

/* ================================================================
 * 清理
 * ================================================================ */
async function cleanup() {
  step('清理临时数据');
  try {
    if (created.projectIds.length) {
      const ids = created.projectIds;
      const ph = ids.map(() => '?').join(',');
      const { rows: datasets } = await dbConnection.query(`SELECT id FROM ai_lab_datasets WHERE project_id IN (${ph})`, ids);
      const { rows: models } = await dbConnection.query(`SELECT id FROM ai_lab_models WHERE project_id IN (${ph})`, ids);
      if (models.length) {
        const mph = models.map(() => '?').join(',');
        await dbConnection.query(`DELETE FROM ai_lab_evaluations WHERE model_id IN (${mph})`, models.map(m => m.id));
      }
      if (datasets.length) {
        const dph = datasets.map(() => '?').join(',');
        await dbConnection.query(`DELETE FROM ai_lab_samples WHERE dataset_id IN (${dph})`, datasets.map(d => d.id));
      }
      await dbConnection.query(`DELETE FROM ai_lab_events WHERE project_id IN (${ph})`, ids);
      await dbConnection.query(`DELETE FROM ai_lab_models WHERE project_id IN (${ph})`, ids);
      await dbConnection.query(`DELETE FROM ai_lab_datasets WHERE project_id IN (${ph})`, ids);
      await dbConnection.query(`DELETE FROM ai_lab_projects WHERE id IN (${ph})`, ids);
      console.log(`  已删除项目 ${ids.join(',')} 及其数据集/样本/模型/评测/事件`);
    }
    if (created.ownerId) {
      const dir = path.join(config.storage.paths.uploads, 'ai-lab', String(created.ownerId));
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`  已删除文件目录 ${dir}`);
    }
    if (created.userIds.length) {
      const ph = created.userIds.map(() => '?').join(',');
      await dbConnection.query(`DELETE FROM users WHERE id IN (${ph}) AND username LIKE 'ailab_smoke_%'`, created.userIds);
      console.log(`  已删除临时用户 ${created.userIds.join(',')}`);
    }
  } catch (error) {
    console.error('  清理失败:', error.message);
    results.failed += 1;
    results.failures.push('cleanup');
  }
}

async function main() {
  console.log(`AI训练专区冒烟测试 BASE=${BASE}`);
  await dbConnection.initialize();
  let users = null;
  try {
    users = await createTempUsers();
    await ensureServer();
    await runFlow(users.owner, users.admin);
  } catch (error) {
    results.failed += 1;
    results.failures.push(`异常: ${error.message}`);
    console.error('\n  [ERROR]', error.stack || error.message);
  } finally {
    await cleanup();
    await dbConnection.close();
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 1500));
      if (!serverProcess.killed) serverProcess.kill('SIGKILL');
      console.log('  已关闭自启的后端实例');
    }
  }
  console.log(`\n结果：通过 ${results.passed}，失败 ${results.failed}`);
  if (results.failures.length) console.log('失败项：\n  - ' + results.failures.join('\n  - '));
  process.exit(results.failed === 0 ? 0 : 1);
}

main();

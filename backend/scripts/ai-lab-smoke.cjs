#!/usr/bin/env node
/**
 * AI训练专区（ai-lab）冒烟测试 —— 用真实 HTTP 走通主流程
 *
 * 用法：cd backend && node scripts/ai-lab-smoke.cjs
 *
 * 流程：
 * 1. 连接本地库，创建两个临时用户（所有者 user + 同组 admin）
 * 2. 若 :4000 已有后端实例则复用，否则自行 spawn `node src/server.js`
 * 3. v1：登录（account + password）→ 任务模板 → 建项目 → 改类别 → 上传样本（sharp 生成纯色图）
 *    → 查询/改标签/软删除 → lock（两轮，验证旧留出集不变）→ 保存模型 → 下载 artifact
 *    → 评测 holdout + shift（验证 generalization_gap）→ model_card → 事件 → 列表/归档
 *    → 权限（同组 admin 可读不可写、未登录 401）→ 管理端列表
 * 4. v2：预置包列表 → 图像包导入（per_class、去重、kind 冲突）→ 混入错标/恢复
 *    → 表格数据集（导入表格包、rows 新增、columns 修改、lock）→ engine=table-rules 模型与评测
 *    → 新事件类型 → P7 文本任务建项目
 *    预置包默认用 shapes（图像）与 penguins（表格）；可用 AI_LAB_SMOKE_IMAGE_PACK / AI_LAB_SMOKE_TABLE_PACK 指定；
 *    两者都不存在时自动在 presets/ai-lab/_smoke-<stamp>-* 生成最小临时包，结束后删除
 * 5. v3：17 个模板 → 音频数据集（node 合成 1 秒正弦波 wav 上传、octet-stream 按扩展名放行、duration_ms、
 *    类型/文件头/大小校验）→ 文本数据集（rows、固定 columns）→ audio-knn / text-nb / table-mlp 模型保存与评测
 *    → kind 不匹配 400 → 20MB artifact → 四个新事件 → 预置包：sounds-synth / campus-messages 存在则各导入一次，
 *    另生成带 durations 的临时音频包验证 duration_ms 映射
 * 6. 清理：删除临时用户的 ai_lab_* 数据、样本与模型文件目录、临时包、临时用户本身；关闭自启的服务
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
const { holdoutCountFor } = require('../src/services/aiLab/splitHoldout');

const PRESETS_ROOT = path.join(BACKEND_DIR, 'presets', 'ai-lab');

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
const created = { userIds: [], ownerId: null, projectIds: [], tempPackDirs: [] };

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
  check(res.status === 200 && Array.isArray(res.body.data) && res.body.data.length === 17, 'GET /tasks 返回 17 个模板', res.body?.data?.length);
  const taskP1 = res.body.data?.find(t => t.key === 'P1');
  check(taskP1 && taskP1.default_classes?.length === 4 && taskP1.kind === 'image' && taskP1.presets?.includes('fruits-varied'), 'P1 模板含 4 个默认类别、kind=image、presets 含 fruits-varied', taskP1);

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

  return { ownerToken, adminToken };
}

/* ================================================================
 * v2：预置包 / 错标 / 表格
 * ================================================================ */

/** 没有可用预置包时生成最小临时包（图像 3 类 × 6 train + 2 shift；表格 3 类 × 12 train + 3 shift） */
async function makeTempPacks() {
  const imageKey = `_smoke-${STAMP}-shapes`;
  const tableKey = `_smoke-${STAMP}-penguins`;
  const imageDir = path.join(PRESETS_ROOT, imageKey);
  const tableDir = path.join(PRESETS_ROOT, tableKey);
  created.tempPackDirs.push(imageDir, tableDir);

  const classes = [{ key: 'circle', label: '圆形' }, { key: 'square', label: '方形' }, { key: 'triangle', label: '三角形' }];
  const colors = { circle: [230, 60, 60], square: [60, 200, 80], triangle: [60, 80, 230] };
  const files = { train: {}, shift: { '深色背景': {} } };
  for (const cls of classes) {
    files.train[cls.key] = [];
    files.shift['深色背景'][cls.key] = [];
    for (let i = 1; i <= 6; i++) {
      const rel = `train/${cls.key}/${String(i).padStart(3, '0')}.jpg`;
      fs.mkdirSync(path.dirname(path.join(imageDir, rel)), { recursive: true });
      fs.writeFileSync(path.join(imageDir, rel), await makeImage(...colors[cls.key], 200, 200));
      files.train[cls.key].push(rel);
    }
    for (let i = 1; i <= 2; i++) {
      const rel = `shift/dark/${cls.key}/${String(i).padStart(3, '0')}.jpg`;
      fs.mkdirSync(path.dirname(path.join(imageDir, rel)), { recursive: true });
      fs.writeFileSync(path.join(imageDir, rel), await makeImage(colors[cls.key][0] / 3, colors[cls.key][1] / 3, colors[cls.key][2] / 3, 200, 200));
      files.shift['深色背景'][cls.key].push(rel);
    }
  }
  fs.writeFileSync(path.join(imageDir, 'manifest.json'), JSON.stringify({
    key: imageKey, kind: 'image', title: '冒烟临时图形包', description: 'smoke', license: 'CC0', source: '', attribution: '',
    grade_bands: ['L'], classes, files,
    condition_tags: { train: { background: '浅色' }, shift: { '深色背景': { background: '深色' } } }
  }, null, 2));

  const tableClasses = [{ key: 'adelie', label: '阿德利' }, { key: 'chinstrap', label: '帽带' }, { key: 'gentoo', label: '巴布亚' }];
  const columns = [
    { key: 'bill_length_mm', label: '喙长', type: 'number', unit: 'mm' },
    { key: 'body_mass_g', label: '体重', type: 'number', unit: 'g' },
    { key: 'island', label: '岛屿', type: 'category' }
  ];
  const row = (cls, i, year) => ({ class_key: cls, payload: { bill_length_mm: 35 + i + (cls === 'gentoo' ? 10 : 0), body_mass_g: 3000 + i * 50 + year, island: i % 2 ? '甲岛' : '乙岛' } });
  const rows = { train: [], shift: { '2009年': [] } };
  tableClasses.forEach(cls => {
    for (let i = 0; i < 12; i++) rows.train.push(row(cls.key, i, 0));
    for (let i = 0; i < 3; i++) rows.shift['2009年'].push(row(cls.key, i, 9));
  });
  fs.mkdirSync(tableDir, { recursive: true });
  fs.writeFileSync(path.join(tableDir, 'manifest.json'), JSON.stringify({
    key: tableKey, kind: 'table', title: '冒烟临时企鹅包', description: 'smoke', license: 'CC0', source: '', attribution: '',
    grade_bands: ['P'], classes: tableClasses, columns, rows
  }, null, 2));
  console.log(`  已生成临时预置包 ${imageKey} / ${tableKey}`);
  return { imageKey, tableKey };
}

const sumValues = (obj) => Object.values(obj || {}).reduce((a, b) => a + Number(b || 0), 0);
const minPerClassSum = (byClass, perClass) => Object.values(byClass || {}).reduce((a, n) => a + Math.min(Number(n || 0), perClass), 0);

async function runV2Flow(owner, { ownerToken, adminToken }) {
  let res;

  step('任务模板 v2');
  res = await api('GET', '/api/ai-lab/tasks', { token: ownerToken });
  const tasks = res.body.data || [];
  const byKey = Object.fromEntries(tasks.map(t => [t.key, t]));
  check(['L1', 'L3', 'L4', 'M1', 'P1', 'P2', 'P3', 'P7', 'free'].every(key => byKey[key]), '模板含 L1/L3/L4/M1/P1/P2/P3/P7/free', Object.keys(byKey));
  check(byKey.P3?.kind === 'table' && byKey.P3?.engine === 'table-tree' && byKey.P3?.config?.max_depth_options?.length === 5 && byKey.P3?.presets?.includes('penguins'), 'P3 为表格任务（table-tree、max_depth_options、presets）', byKey.P3);
  check(byKey.L3?.config?.mislabel_ratio === 0.4 && byKey.L3?.steps?.includes('mislabel') && byKey.L3?.steps?.includes('restore'), 'L3 含 mislabel_ratio 与 mislabel/restore 步骤', byKey.L3);
  check(byKey.L4?.config?.per_class_limits?.join(',') === '3,10,30' && byKey.L1?.default_classes?.length === 2 && byKey.M1?.default_classes?.length === 6 && byKey.M1?.min_train_per_class === 30, 'L4/L1/M1 配置正确', { L4: byKey.L4?.config, L1: byKey.L1?.default_classes, M1: byKey.M1?.min_train_per_class });
  check(byKey.P7?.kind === 'text' && byKey.P7?.engine === 'verify' && byKey.P7?.steps?.join(',') === 'material,claims,verdicts,revise,reflection', 'P7 为文本核验任务', byKey.P7);

  step('预置数据包列表');
  res = await api('GET', '/api/ai-lab/presets', { token: ownerToken });
  check(res.status === 200 && Array.isArray(res.body.data), 'GET /presets 返回数组', res.body);
  let packs = res.body.data || [];
  check(packs.every(p => p.files === undefined && p.rows === undefined && p.dir === undefined && p.counts && p.counts.train && p.counts.shift), '每个包不带 files/rows 且附 counts', packs.map(p => Object.keys(p)));
  res = await api('GET', '/api/ai-lab/presets?kind=table', { token: ownerToken });
  check(res.status === 200 && (res.body.data || []).every(p => p.kind === 'table'), 'kind=table 过滤生效', res.body.data?.map(p => p.key));
  res = await api('GET', '/api/ai-lab/presets?kind=video', { token: ownerToken });
  check(res.status === 400, '非法 kind 返回 400', res.status);

  let imageKey = process.env.AI_LAB_SMOKE_IMAGE_PACK || (packs.some(p => p.key === 'shapes') ? 'shapes' : packs.find(p => p.kind === 'image')?.key);
  let tableKey = process.env.AI_LAB_SMOKE_TABLE_PACK || (packs.some(p => p.key === 'penguins') ? 'penguins' : packs.find(p => p.kind === 'table')?.key);
  if (!imageKey || !tableKey) {
    const temp = await makeTempPacks();
    imageKey = imageKey || temp.imageKey;
    tableKey = tableKey || temp.tableKey;
    packs = (await api('GET', '/api/ai-lab/presets', { token: ownerToken })).body.data || [];
  }
  const imagePack = packs.find(p => p.key === imageKey);
  const tablePack = packs.find(p => p.key === tableKey);
  check(imagePack?.kind === 'image' && tablePack?.kind === 'table', `使用图像包 ${imageKey} 与表格包 ${tableKey}`, { imagePack: imagePack?.kind, tablePack: tablePack?.kind });
  if (!imagePack || !tablePack) throw new Error('缺少可用的预置包');
  const imageShiftSets = Object.keys(imagePack.counts.shift);
  const imageClassCount = imagePack.classes.length;

  step('导入图像预置包：只选部分类别（class_keys）');
  res = await api('POST', '/api/ai-lab/projects', { token: ownerToken, body: { title: '两样东西', task_key: 'L1' } });
  check(res.status === 201 && res.body.data?.dataset?.classes?.length === 2, 'L1 项目带 2 个占位类别', res.body.data?.dataset?.classes);
  const l1Project = res.body.data.project;
  const l1Dataset = res.body.data.dataset;
  created.projectIds.push(l1Project.id);
  const twoKeys = imagePack.classes.slice(0, 2).map(c => c.key);
  res = await api('POST', `/api/ai-lab/datasets/${l1Dataset.id}/import-preset`, { token: ownerToken, body: { pack_key: imageKey, per_class: 2, class_keys: twoKeys, shift_sets: [] } });
  check(res.status === 201 && res.body.data?.imported?.train === 4, 'class_keys 只导入 2 类 × per_class=2 = 4 张', res.body.data?.imported);
  check(res.body.data?.dataset?.classes?.map(c => c.key).join() === twoKeys.join(), '空数据集的占位类别被换成所选的 2 类（不合并占位类别）', res.body.data?.dataset?.classes);
  res = await api('POST', `/api/ai-lab/datasets/${l1Dataset.id}/import-preset`, { token: ownerToken, body: { pack_key: imageKey, class_keys: ['no-such-class'] } });
  check(res.status === 400, 'class_keys 含包里没有的类别返回 400', res.status);
  res = await api('POST', `/api/ai-lab/datasets/${l1Dataset.id}/import-preset`, { token: ownerToken, body: { pack_key: imageKey, class_keys: 'apple' } });
  check(res.status === 400, 'class_keys 不是数组返回 400', res.status);
  res = await api('POST', `/api/ai-lab/datasets/${l1Dataset.id}/import-preset`, { token: ownerToken, body: { pack_key: imageKey, class_keys: [] } });
  check(res.status === 400, 'class_keys 为空数组返回 400', res.status);
  res = await api('POST', `/api/ai-lab/datasets/${l1Dataset.id}/import-preset`, { token: ownerToken, body: { pack_key: imageKey, per_class: 1, class_keys: [imagePack.classes[2].key], shift_sets: [] } });
  check(res.status === 201 && res.body.data?.dataset?.classes?.length === 3, '非空数据集再导入第 3 类：按 key 合并为 3 类', res.body.data?.dataset?.classes);

  step('导入图像预置包（per_class / 去重 / kind 冲突）');
  res = await api('POST', '/api/ai-lab/projects', { token: ownerToken, body: { title: '多少张够用', task_key: 'L4' } });
  check(res.status === 201 && res.body.data?.dataset?.kind === 'image' && res.body.data?.dataset?.classes?.length === 0, 'L4 项目的数据集 kind=image 且无默认类别', res.body.data?.dataset);
  const imgProject = res.body.data.project;
  const imgDataset = res.body.data.dataset;
  created.projectIds.push(imgProject.id);

  res = await api('POST', `/api/ai-lab/datasets/${imgDataset.id}/import-preset`, { token: ownerToken, body: { pack_key: imageKey, per_class: 3 } });
  const expectTrain3 = minPerClassSum(imagePack.counts.train, 3);
  const expectShift3 = Object.fromEntries(imageShiftSets.map(set => [set, minPerClassSum(imagePack.counts.shift[set], 3)]));
  check(res.status === 201 && res.body.data?.imported?.train === expectTrain3, `导入 per_class=3：train ${expectTrain3} 张`, res.body.data?.imported);
  check(imageShiftSets.every(set => res.body.data?.imported?.shift?.[set] === expectShift3[set]), '默认导入全部 shift 集且计数正确', { got: res.body.data?.imported?.shift, expect: expectShift3 });
  let ds = res.body.data?.dataset;
  check(ds?.classes?.length === imageClassCount && imagePack.classes.every(c => ds.classes.some(d => d.key === c.key && d.label === c.label)), '包内类别已合并进数据集', ds?.classes);
  check(ds?.sample_count === expectTrain3 + sumValues(expectShift3) && sumValues(ds?.counts?.train) === expectTrain3, 'sample_count 与 counts 一致', { sample_count: ds?.sample_count, counts: ds?.counts });

  res = await api('GET', `/api/ai-lab/datasets/${imgDataset.id}/samples?split=train`, { token: ownerToken });
  const presetSample = res.body.data?.[0];
  const fileNamePattern = new RegExp(`^ai-lab/${owner.id}/${imgDataset.id}/preset-${imageKey}-\\d+\\.jpg$`);
  check(presetSample?.source === 'preset' && String(presetSample?.origin_ref || '').startsWith(`${imageKey}:`) && fileNamePattern.test(presetSample?.file_path || ''), '预置样本 source=preset、origin_ref、文件名 preset-<pack>-<n>.jpg', presetSample);
  check(presetSample?.width <= 320 && presetSample?.height <= 320 && presetSample?.payload === null && presetSample?.original_class_key === null, '预置图片已规范到 ≤320 且 payload/original_class_key 为 null', presetSample);
  check(JSON.stringify(presetSample?.condition_tags) === JSON.stringify(imagePack.condition_tags?.train ?? null), 'condition_tags 取自 manifest', { got: presetSample?.condition_tags, expect: imagePack.condition_tags?.train });
  const presetImg = await fetch(`${BASE}${presetSample.file_url}`);
  check(presetImg.status === 200 && (presetImg.headers.get('content-type') || '').includes('image/jpeg'), '预置样本图片可通过 /uploads 读取', presetImg.status);
  const trainCountAfter3 = res.body.data.length;

  res = await api('POST', `/api/ai-lab/datasets/${imgDataset.id}/import-preset`, { token: ownerToken, body: { pack_key: imageKey, per_class: 5, shift_sets: [] } });
  const expectTrain5 = minPerClassSum(imagePack.counts.train, 5);
  check(res.status === 201 && res.body.data?.imported?.train === expectTrain5 - expectTrain3 && res.body.data?.skipped?.train === expectTrain3 && sumValues(res.body.data?.imported?.shift) === 0, `再导入 per_class=5 只补 ${expectTrain5 - expectTrain3} 张（去重）且 shift_sets=[] 不导 shift`, res.body.data);
  res = await api('GET', `/api/ai-lab/datasets/${imgDataset.id}/samples?split=train`, { token: ownerToken });
  check(res.body.data.length === expectTrain5 && new Set(res.body.data.map(s => s.origin_ref)).size === expectTrain5, `train 共 ${expectTrain5} 张且 origin_ref 无重复`, res.body.data.length);
  check(trainCountAfter3 === expectTrain3, '首轮导入后 train 数量正确');

  if (imageShiftSets.length > 0) {
    res = await api('POST', `/api/ai-lab/datasets/${imgDataset.id}/import-preset`, { token: ownerToken, body: { pack_key: imageKey, include_train: false, shift_sets: [imageShiftSets[0]] } });
    check(res.status === 201 && res.body.data?.imported?.train === 0 && Object.keys(res.body.data?.imported?.shift || {}).join() === imageShiftSets[0], 'include_train=false 只导指定 shift 集', res.body.data);
  }
  res = await api('POST', `/api/ai-lab/datasets/${imgDataset.id}/import-preset`, { token: ownerToken, body: { pack_key: '../etc' } });
  check(res.status === 400, '非法 pack_key 返回 400', res.status);
  res = await api('POST', `/api/ai-lab/datasets/${imgDataset.id}/import-preset`, { token: ownerToken, body: { pack_key: 'no-such-pack-xyz' } });
  check(res.status === 400, '不存在的包返回 400', res.status);
  res = await api('POST', `/api/ai-lab/datasets/${imgDataset.id}/import-preset`, { token: ownerToken, body: { pack_key: imageKey, shift_sets: ['不存在的集合'] } });
  check(res.status === 400, '不存在的 shift 集返回 400', res.status);
  res = await api('POST', `/api/ai-lab/datasets/${imgDataset.id}/import-preset`, { token: ownerToken, body: { pack_key: imageKey, per_class: 0 } });
  check(res.status === 400, 'per_class=0 返回 400', res.status);
  res = await api('POST', `/api/ai-lab/datasets/${imgDataset.id}/import-preset`, { token: ownerToken, body: { pack_key: tableKey } });
  check(res.status === 400, '非空图像数据集导入表格包返回 400（kind 冲突）', res.status);
  res = await api('POST', `/api/ai-lab/datasets/${imgDataset.id}/import-preset`, { token: adminToken, body: { pack_key: imageKey } });
  check(res.status === 403, '同组 admin 导入返回 403', res.status);

  step('混入错标 / 恢复');
  res = await api('POST', `/api/ai-lab/datasets/${imgDataset.id}/lock`, { token: ownerToken, body: { holdout_ratio: 0.2, seed: 3 } });
  check(res.status === 200 && res.body.data?.dataset?.version === 1, '图像数据集 lock 后 version=1', res.body.data?.dataset);
  res = await api('GET', `/api/ai-lab/datasets/${imgDataset.id}/samples?split=train`, { token: ownerToken });
  const trainBefore = res.body.data;
  const labelsBefore = Object.fromEntries(trainBefore.map(s => [s.id, s.class_key]));
  const perClassTrain = {};
  trainBefore.forEach(s => { perClassTrain[s.class_key] = (perClassTrain[s.class_key] || 0) + 1; });
  const expectChanged = Object.values(perClassTrain).reduce((a, n) => a + holdoutCountFor(n, 0.2), 0);

  res = await api('POST', `/api/ai-lab/datasets/${imgDataset.id}/mislabel`, { token: ownerToken, body: { ratio: 0.2, seed: 5 } });
  check(res.status === 200 && res.body.data?.changed === expectChanged && res.body.data?.sample_ids?.length === expectChanged && res.body.data?.seed === 5, `mislabel 分层改标 ${expectChanged} 个`, res.body.data);
  const changedIds = new Set(res.body.data?.sample_ids || []);
  res = await api('GET', `/api/ai-lab/datasets/${imgDataset.id}/samples?split=train`, { token: ownerToken });
  const mislabeled = res.body.data.filter(s => changedIds.has(s.id));
  check(mislabeled.length === expectChanged && mislabeled.every(s => s.original_class_key === labelsBefore[s.id] && s.class_key !== s.original_class_key && ds.classes.some(c => c.key === s.class_key)), '被改样本 original_class_key=原值、class_key 变为其他类别', mislabeled.slice(0, 3));
  check(res.body.data.filter(s => !changedIds.has(s.id)).every(s => s.original_class_key === null && s.class_key === labelsBefore[s.id]), '未选中样本不受影响');
  res = await api('GET', `/api/ai-lab/projects/${imgProject.id}`, { token: ownerToken });
  check(res.body.data?.datasets?.[0]?.version === 1, 'mislabel 不改变 dataset.version', res.body.data?.datasets?.[0]?.version);

  res = await api('POST', `/api/ai-lab/datasets/${imgDataset.id}/mislabel`, { token: ownerToken, body: { ratio: 0.2, seed: 5 } });
  const changed2 = res.body.data?.changed ?? -1;
  res = await api('GET', `/api/ai-lab/datasets/${imgDataset.id}/samples?split=train`, { token: ownerToken });
  check(changed2 >= 0 && res.body.data.filter(s => s.original_class_key !== null).length === expectChanged + changed2, '二次 mislabel 只作用于未改过的样本', { changed2, total: res.body.data.filter(s => s.original_class_key !== null).length });

  res = await api('POST', `/api/ai-lab/datasets/${imgDataset.id}/mislabel`, { token: ownerToken, body: { ratio: 0 } });
  check(res.status === 400, 'ratio=0 返回 400', res.status);
  res = await api('POST', `/api/ai-lab/datasets/${imgDataset.id}/mislabel`, { token: ownerToken, body: { ratio: 1.5 } });
  check(res.status === 400, 'ratio=1.5 返回 400', res.status);
  res = await api('POST', `/api/ai-lab/datasets/${imgDataset.id}/mislabel`, { token: adminToken, body: {} });
  check(res.status === 403, '同组 admin mislabel 返回 403', res.status);

  res = await api('POST', `/api/ai-lab/datasets/${imgDataset.id}/restore-labels`, { token: ownerToken });
  check(res.status === 200 && res.body.data?.restored === expectChanged + changed2, `restore-labels 恢复 ${expectChanged + changed2} 个`, res.body.data);
  res = await api('GET', `/api/ai-lab/datasets/${imgDataset.id}/samples?split=train`, { token: ownerToken });
  check(res.body.data.every(s => s.original_class_key === null && s.class_key === labelsBefore[s.id]), '恢复后标签与错标前完全一致');
  res = await api('POST', `/api/ai-lab/datasets/${imgDataset.id}/restore-labels`, { token: ownerToken });
  check(res.status === 200 && res.body.data?.restored === 0, '再次恢复 restored=0', res.body.data);

  res = await api('POST', `/api/ai-lab/projects/${imgProject.id}/datasets`, { token: ownerToken, body: { name: '单类', classes: [{ key: 'only', label: '唯一' }] } });
  res = await api('POST', `/api/ai-lab/datasets/${res.body.data.id}/mislabel`, { token: ownerToken, body: {} });
  check(res.status === 400, '不足两个类别的数据集 mislabel 返回 400', res.status);

  step('表格数据集：导入 / rows / columns / lock');
  res = await api('POST', '/api/ai-lab/projects', { token: ownerToken, body: { title: '人工规则 vs 数据规则', task_key: 'P3' } });
  check(res.status === 201 && res.body.data?.dataset?.kind === 'table' && res.body.data?.dataset?.columns === null, 'P3 项目的数据集 kind=table、columns 为空', res.body.data?.dataset);
  const tblProject = res.body.data.project;
  const tblDataset = res.body.data.dataset;
  created.projectIds.push(tblProject.id);

  res = await api('POST', `/api/ai-lab/datasets/${tblDataset.id}/rows`, { token: ownerToken, body: { rows: [{ class_key: 'x', payload: { a: 1 } }] } });
  check(res.status === 400, '未定义 columns 时 rows 返回 400', res.status);
  res = await api('POST', `/api/ai-lab/datasets/${tblDataset.id}/samples`, { token: ownerToken, form: buildForm([await makeImage(1, 2, 3)], { class_key: 'x' }) });
  check(res.status === 400, '表格数据集上传图片返回 400', res.status);

  res = await api('POST', `/api/ai-lab/datasets/${tblDataset.id}/import-preset`, { token: ownerToken, body: { pack_key: tableKey, per_class: 10 } });
  const tableShiftSets = Object.keys(tablePack.counts.shift);
  const expectRows = minPerClassSum(tablePack.counts.train, 10);
  check(res.status === 201 && res.body.data?.imported?.train === expectRows, `导入表格包 per_class=10：train ${expectRows} 行`, res.body.data?.imported);
  ds = res.body.data?.dataset;
  /* MySQL JSON 列会重排对象键序，按字段逐项比较 */
  const sameColumns = Array.isArray(ds?.columns) && ds.columns.length === tablePack.columns.length
    && tablePack.columns.every((c, i) => ['key', 'label', 'type', 'unit'].every(f => (ds.columns[i][f] ?? null) === (c[f] ?? null)));
  check(ds?.kind === 'table' && sameColumns && ds?.classes?.length === tablePack.classes.length, '表格数据集 columns/classes 来自包', { columns: ds?.columns, classes: ds?.classes });
  res = await api('GET', `/api/ai-lab/datasets/${tblDataset.id}/samples?split=train`, { token: ownerToken });
  const rowSample = res.body.data?.[0];
  check(rowSample?.file_path === null && rowSample?.file_url === null && rowSample?.source === 'preset' && String(rowSample?.origin_ref || '').startsWith(`${tableKey}:rows/train/`), '行样本 file_path/file_url=null、origin_ref=<pack>:rows/train/<i>', rowSample);
  check(rowSample && typeof rowSample.payload === 'object' && tablePack.columns.every(c => c.key in rowSample.payload), '行样本 payload 含全部列', rowSample?.payload);
  if (tableShiftSets.length > 0) {
    res = await api('GET', `/api/ai-lab/datasets/${tblDataset.id}/samples?split=shift&shift_set=${encodeURIComponent(tableShiftSets[0])}`, { token: ownerToken });
    check(res.body.data.length === minPerClassSum(tablePack.counts.shift[tableShiftSets[0]], 10), `表格 shift 集 ${tableShiftSets[0]} 行数正确`, res.body.data.length);
  }

  const numberCol = tablePack.columns.find(c => c.type === 'number');
  const categoryCol = tablePack.columns.find(c => c.type === 'category');
  const cls0 = tablePack.classes[0].key;
  const cls1 = tablePack.classes[1].key;
  const validPayload = { [numberCol.key]: '12.5' };
  if (categoryCol) validPayload[categoryCol.key] = ' 手填 ';
  res = await api('POST', `/api/ai-lab/datasets/${tblDataset.id}/rows`, { token: ownerToken, body: { rows: [
    { class_key: cls0, payload: validPayload, condition_tags: { note: '手工' } },
    { class_key: cls1, payload: { [numberCol.key]: 7 }, split: 'shift', shift_set: '自测' }
  ] } });
  check(res.status === 201 && res.body.data?.length === 2 && res.body.data[0].payload?.[numberCol.key] === 12.5 && res.body.data[0].source === 'upload' && res.body.data[0].condition_tags?.note === '手工', 'POST /rows 新增 2 行，number 列转数值', res.body.data);
  check(!categoryCol || res.body.data[0].payload?.[categoryCol.key] === '手填', 'category 列去首尾空白', res.body.data?.[0]?.payload);
  check(res.body.data?.[1]?.split === 'shift' && res.body.data[1].shift_set === '自测' && res.body.data[1].file_url === null, '行样本可进 shift 集', res.body.data?.[1]);
  res = await api('POST', `/api/ai-lab/datasets/${tblDataset.id}/rows`, { token: ownerToken, body: { rows: [{ class_key: cls0, payload: { nope: 1 } }] } });
  check(res.status === 400, 'payload 含未定义列返回 400', res.status);
  res = await api('POST', `/api/ai-lab/datasets/${tblDataset.id}/rows`, { token: ownerToken, body: { rows: [{ class_key: cls0, payload: { [numberCol.key]: 'abc' } }] } });
  check(res.status === 400, 'number 列非数字返回 400', res.status);
  res = await api('POST', `/api/ai-lab/datasets/${tblDataset.id}/rows`, { token: ownerToken, body: { rows: [{ class_key: 'nope', payload: validPayload }] } });
  check(res.status === 400, '未知类别返回 400', res.status);
  res = await api('POST', `/api/ai-lab/datasets/${tblDataset.id}/rows`, { token: ownerToken, body: { rows: Array.from({ length: 201 }, () => ({ class_key: cls0, payload: validPayload })) } });
  check(res.status === 400, '超过 200 行返回 400', res.status);
  res = await api('POST', `/api/ai-lab/datasets/${imgDataset.id}/rows`, { token: ownerToken, body: { rows: [{ class_key: imagePack.classes[0].key, payload: { a: 1 } }] } });
  check(res.status === 400, '图像数据集调用 rows 返回 400', res.status);

  res = await api('PATCH', `/api/ai-lab/datasets/${tblDataset.id}`, { token: ownerToken, body: { columns: [...tablePack.columns, { key: 'extra_col', label: '附加', type: 'number' }] } });
  check(res.status === 200 && res.body.data?.columns?.length === tablePack.columns.length + 1, 'PATCH columns 可新增列', res.body.data?.columns?.map(c => c.key));
  res = await api('PATCH', `/api/ai-lab/datasets/${tblDataset.id}`, { token: ownerToken, body: { columns: tablePack.columns.slice(1) } });
  check(res.status === 400, '已有样本时删除列返回 400', res.status);
  res = await api('PATCH', `/api/ai-lab/datasets/${imgDataset.id}`, { token: ownerToken, body: { columns: [{ key: 'a', type: 'number' }] } });
  check(res.status === 400, '图像数据集设置 columns 返回 400', res.status);

  res = await api('POST', `/api/ai-lab/datasets/${tblDataset.id}/import-preset`, { token: ownerToken, body: { pack_key: imageKey } });
  check(res.status === 400, '非空表格数据集导入图像包返回 400', res.status);

  res = await api('POST', `/api/ai-lab/projects/${tblProject.id}/datasets`, { token: ownerToken, body: { name: '手建表格', kind: 'table', classes: [{ key: 'a' }, { key: 'b' }], columns: [{ key: 'x', type: 'number' }] } });
  check(res.status === 201 && res.body.data?.kind === 'table' && res.body.data?.columns?.[0]?.key === 'x', 'POST /datasets 可指定 kind=table 与 columns', res.body.data);
  const emptyTable = res.body.data;
  res = await api('POST', `/api/ai-lab/datasets/${emptyTable.id}/import-preset`, { token: ownerToken, body: { pack_key: imageKey, per_class: 1, shift_sets: [] } });
  check(res.status === 201 && res.body.data?.dataset?.kind === 'image' && res.body.data?.dataset?.columns === null && res.body.data?.imported?.train === imageClassCount, '空表格数据集导入图像包 → kind 切换为 image、columns 清空', res.body.data?.dataset);

  res = await api('POST', `/api/ai-lab/datasets/${tblDataset.id}/lock`, { token: ownerToken, body: { holdout_ratio: 0.2, seed: 11 } });
  check(res.status === 200 && res.body.data?.dataset?.version === 1 && sumValues(res.body.data?.counts?.holdout) > 0, '表格数据集 lock 分层留出', res.body.data?.counts);

  step('表格模型（table-rules / table-tree）与评测');
  res = await api('POST', `/api/ai-lab/projects/${tblProject.id}/models`, { token: ownerToken, body: { dataset_id: tblDataset.id, dataset_version: 1, engine: 'table-rules', params: { rules: [{ if: `${numberCol.key} < 40`, then: cls0 }] }, class_keys: tablePack.classes.map(c => c.key), train_sample_count: expectRows, artifact: { rules: [{ feature: numberCol.key, op: '<', value: 40, label: cls0 }] }, note: '手写规则' } });
  check(res.status === 201 && res.body.data?.engine === 'table-rules' && res.body.data?.feature_extractor === 'none' && res.body.data?.version === 1, 'POST /models engine=table-rules，feature_extractor 默认 none', res.body.data);
  const rulesModel = res.body.data;
  const rulesArtifact = await fetch(`${BASE}${rulesModel.artifact_url}`);
  check(rulesArtifact.status === 200 && (await rulesArtifact.json())?.rules?.[0]?.feature === numberCol.key, '规则 artifact 可下载', rulesArtifact.status);
  res = await api('POST', `/api/ai-lab/models/${rulesModel.id}/evaluations`, { token: ownerToken, body: { split: 'holdout', sample_count: 6, metrics: { accuracy: 0.67, per_class: {}, confusion: { labels: [], matrix: [] } } } });
  check(res.status === 201 && res.body.data?.metrics?.holdout?.accuracy === 0.67, '规则模型 holdout 评测已记录', res.body.data?.metrics);
  res = await api('POST', `/api/ai-lab/projects/${tblProject.id}/models`, { token: ownerToken, body: { dataset_id: tblDataset.id, engine: 'table-tree', feature_extractor: 'none', params: { max_depth: 2 }, class_keys: tablePack.classes.map(c => c.key), artifact: { tree: {} } } });
  check(res.status === 201 && res.body.data?.engine === 'table-tree' && res.body.data?.version === 2, 'POST /models engine=table-tree version=2', res.body.data);
  res = await api('POST', `/api/ai-lab/projects/${tblProject.id}/models`, { token: ownerToken, body: { dataset_id: tblDataset.id, engine: 'image-knn', class_keys: [cls0], artifact: {} } });
  check(res.status === 400, '表格数据集用 image-knn 返回 400', res.status);
  res = await api('POST', `/api/ai-lab/projects/${imgProject.id}/models`, { token: ownerToken, body: { dataset_id: imgDataset.id, engine: 'table-tree', class_keys: [imagePack.classes[0].key], artifact: {} } });
  check(res.status === 400, '图像数据集用 table-tree 返回 400', res.status);
  res = await api('GET', `/api/ai-lab/projects/${tblProject.id}`, { token: ownerToken });
  check(res.body.data?.project?.summary?.model_count === 2 && res.body.data?.project?.summary?.best_holdout_accuracy === 0.67 && res.body.data?.datasets?.[0]?.kind === 'table', '表格项目 summary 与数据集 kind 正确', res.body.data?.project?.summary);

  step('新事件类型');
  const newTypes = ['preset.import', 'dataset.mislabel', 'dataset.restore', 'rules.write', 'data_card.write', 'claim.write', 'claim.verify', 'claim.revise'];
  res = await api('POST', `/api/ai-lab/projects/${tblProject.id}/events`, { token: ownerToken, body: { events: newTypes.map(type => ({ type, payload: { smoke: true } })) } });
  check(res.status === 201 && res.body.data?.inserted === newTypes.length, `8 种新事件类型均可写入`, res.body);
  res = await api('GET', `/api/ai-lab/projects/${tblProject.id}/events`, { token: ownerToken });
  check(res.body.data?.map(e => e.type).join(',') === newTypes.join(','), 'GET /events 按序返回新事件', res.body.data?.map(e => e.type));

  step('P7 文本任务');
  res = await api('POST', '/api/ai-lab/projects', { token: ownerToken, body: { title: '校园资讯可信吗', task_key: 'P7' } });
  check(res.status === 201 && res.body.data?.project?.task_key === 'P7' && res.body.data?.dataset?.id, 'P7 项目可创建（附默认数据集）', res.body.data?.project);
  if (res.body.data?.project?.id) created.projectIds.push(res.body.data.project.id);
}


/* ================================================================
 * v3：音频 / 文本 / 新引擎 / 新事件
 * ================================================================ */

/** 16bit 单声道 PCM WAV：正弦波（默认 1 秒 440Hz、16kHz） */
function makeWav({ seconds = 1, sampleRate = 16000, freq = 440, amplitude = 0.5 } = {}) {
  const numSamples = Math.floor(seconds * sampleRate);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * amplitude * 32767), 44 + i * 2);
  }
  return buf;
}

function buildAudioForm(buffers, fields, { mime = 'audio/wav', ext = 'wav' } = {}) {
  const form = new FormData();
  buffers.forEach((buf, i) => form.append('files', new Blob([buf], { type: mime }), `clip-${i}.${ext}`));
  Object.entries(fields).forEach(([key, value]) => {
    if (value !== undefined && value !== null) form.append(key, typeof value === 'string' ? value : JSON.stringify(value));
  });
  return form;
}

/** 带 durations 的最小临时音频包（2 类 × 3 train + 1 shift）与最小文本包（3 类 × 4 train + 2 shift） */
function makeTempV3Packs() {
  const audioKey = `_smoke-${STAMP}-sounds`;
  const textKey = `_smoke-${STAMP}-messages`;
  const audioDir = path.join(PRESETS_ROOT, audioKey);
  const textDir = path.join(PRESETS_ROOT, textKey);
  created.tempPackDirs.push(audioDir, textDir);

  const classes = [{ key: 'beep', label: '蜂鸣' }, { key: 'hum', label: '低鸣' }];
  const freqs = { beep: 880, hum: 110 };
  const files = { train: {}, shift: { '换音高': {} } };
  const durations = {};
  classes.forEach(cls => {
    files.train[cls.key] = [];
    files.shift['换音高'][cls.key] = [];
    for (let i = 1; i <= 3; i++) {
      const rel = `train/${cls.key}/${String(i).padStart(3, '0')}.wav`;
      fs.mkdirSync(path.dirname(path.join(audioDir, rel)), { recursive: true });
      fs.writeFileSync(path.join(audioDir, rel), makeWav({ seconds: 0.5 + i * 0.1, freq: freqs[cls.key] }));
      files.train[cls.key].push(rel);
      durations[rel] = 500 + i * 100;
    }
    const rel = `shift/pitch/${cls.key}/001.wav`;
    fs.mkdirSync(path.dirname(path.join(audioDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(audioDir, rel), makeWav({ seconds: 0.5, freq: freqs[cls.key] * 1.5 }));
    files.shift['换音高'][cls.key].push(rel);
    /* shift 文件故意不给 durations → duration_ms 应为 null */
  });
  fs.writeFileSync(path.join(audioDir, 'manifest.json'), JSON.stringify({
    key: audioKey, kind: 'audio', title: '冒烟临时声音包', description: 'smoke', license: 'CC0', source: '', attribution: '',
    grade_bands: ['L'], classes, files, durations,
    condition_tags: { train: { noise: '安静' }, shift: { '换音高': { pitch: '偏高' } } }
  }, null, 2));

  const textClasses = [{ key: 'positive', label: '积极' }, { key: 'negative', label: '消极' }, { key: 'neutral', label: '中性' }];
  const rows = { train: [], shift: { '另一话题': [] } };
  textClasses.forEach(cls => {
    for (let i = 0; i < 4; i++) rows.train.push({ class_key: cls.key, payload: { text: `${cls.label}留言 ${i}：今天的课很有意思。` } });
    for (let i = 0; i < 2; i++) rows.shift['另一话题'].push({ class_key: cls.key, payload: { text: `${cls.label}社团 ${i}：活动安排如下。` } });
  });
  fs.mkdirSync(textDir, { recursive: true });
  fs.writeFileSync(path.join(textDir, 'manifest.json'), JSON.stringify({
    key: textKey, kind: 'text', title: '冒烟临时留言包', description: 'smoke', license: 'CC0', source: '', attribution: '',
    grade_bands: ['M'], classes: textClasses, columns: [{ key: 'text', label: '留言', type: 'text' }], rows
  }, null, 2));
  return { audioKey, textKey };
}

async function runV3Flow(owner, { ownerToken, adminToken }) {
  let res;

  step('任务模板 v3');
  res = await api('GET', '/api/ai-lab/tasks', { token: ownerToken });
  const tasks = res.body.data || [];
  const byKey = Object.fromEntries(tasks.map(t => [t.key, t]));
  check(tasks.map(t => t.key).join(',') === 'L1,L2,L3,L4,L5,L6,M1,M2,M3,M4,M5,P1,P2,P3,P6,P7,free', '模板顺序 L1,L2,L3,L4,L5,L6,M1,M2,M3,M4,M5,P1,P2,P3,P6,P7,free', tasks.map(t => t.key));
  check(byKey.L2?.kind === 'audio' && byKey.L2?.engine === 'audio-knn' && byKey.L2?.default_classes?.map(c => c.key).join() === 'clap,knock,whistle' && byKey.L2?.presets?.includes('sounds-synth'), 'L2 音频模板（audio-knn、3 类、sounds-synth）', byKey.L2);
  check(byKey.P6?.kind === 'audio' && byKey.P6?.default_classes?.length === 5 && byKey.P6?.min_train_per_class === 15 && byKey.M4?.default_classes?.length === 10 && byKey.M4?.suggested_shift_sets?.map(s => s.key).join() === 'speaker,device', 'P6 五类 / M4 十个指令词', { P6: byKey.P6?.default_classes?.length, M4: byKey.M4?.default_classes?.length });
  check(byKey.M5?.kind === 'text' && byKey.M5?.engine === 'text-nb' && byKey.M5?.min_train_per_class === 30 && byKey.M5?.steps?.includes('annotate') && byKey.M5?.steps?.includes('agreement') && byKey.M5?.presets?.includes('campus-messages'), 'M5 文本模板（text-nb、annotate/agreement、campus-messages）', byKey.M5);
  check(byKey.M3?.kind === 'table' && byKey.M3?.steps?.includes('train_mlp') && byKey.M3?.config?.mlp?.hidden === 16 && byKey.M3?.config?.mlp?.epochs === 80 && byKey.M3?.config?.max_depth_options?.length === 5, 'M3 决策树 vs 神经网络（train_mlp、mlp 配置）', byKey.M3?.config);
  check(byKey.L5?.kind === 'text' && byKey.L5?.engine === 'verify' && byKey.L5?.config?.material_set === 'animal' && byKey.L5?.config?.projected_default === true && byKey.L5?.steps?.join() === 'material,claims,verdicts,reflection', 'L5 动物故事核验（material_set=animal、projected_default）', byKey.L5);
  check(byKey.L6?.kind === 'table' && byKey.L6?.engine === 'table-rules' && byKey.L6?.config?.max_depth_options?.join() === '1,2,3' && byKey.L6?.presets?.join() === 'animal-cards,garbage-cards', 'L6 规则是我定的（table-rules、animal-cards/garbage-cards）', byKey.L6);
  check(byKey.M2?.kind === 'image' && byKey.M2?.config?.subgroup_tag === 'collector' && byKey.M2?.steps?.includes('fairness') && byKey.M2?.suggested_shift_sets?.[0]?.key === 'collector' && byKey.M2?.min_train_per_class === 20, 'M2 让分类器更公平（subgroup_tag=collector、fairness 步骤）', byKey.M2);
  check(byKey.P7?.config?.material_set === 'campus', 'P7 config.material_set=campus', byKey.P7?.config);

  step('预置数据包（四种 kind）');
  for (const kind of ['image', 'table', 'audio', 'text']) {
    res = await api('GET', `/api/ai-lab/presets?kind=${kind}`, { token: ownerToken });
    check(res.status === 200 && Array.isArray(res.body.data) && res.body.data.every(p => p.kind === kind), `GET /presets?kind=${kind} 只返回该类型`, res.body.data?.map(p => `${p.key}:${p.kind}`));
  }
  let packs = (await api('GET', '/api/ai-lab/presets', { token: ownerToken })).body.data || [];
  const hasSounds = packs.some(p => p.key === 'sounds-synth' && p.kind === 'audio');
  const hasMessages = packs.some(p => p.key === 'campus-messages' && p.kind === 'text');
  console.log(`  sounds-synth: ${hasSounds ? '存在' : '不存在'}；campus-messages: ${hasMessages ? '存在' : '不存在'}`);
  const temp = makeTempV3Packs();
  packs = (await api('GET', '/api/ai-lab/presets', { token: ownerToken })).body.data || [];
  const tempAudioPack = packs.find(p => p.key === temp.audioKey);
  const tempTextPack = packs.find(p => p.key === temp.textKey);
  check(tempAudioPack?.kind === 'audio' && tempAudioPack.durations === undefined && tempAudioPack.counts?.train?.beep === 3 && tempAudioPack.shift_sets?.join() === '换音高', '临时音频包可列出（不带 durations，counts 正确）', tempAudioPack);
  check(tempTextPack?.kind === 'text' && tempTextPack.columns?.[0]?.type === 'text' && tempTextPack.counts?.train?.positive === 4, '临时文本包可列出（columns 为 text 列）', tempTextPack);

  /* ---------------- 音频 ---------------- */
  step('音频数据集：上传合成 wav');
  res = await api('POST', '/api/ai-lab/projects', { token: ownerToken, body: { title: '声音也能被认出来吗', task_key: 'L2' } });
  check(res.status === 201 && res.body.data?.dataset?.kind === 'audio' && res.body.data?.dataset?.classes?.length === 3 && res.body.data?.dataset?.columns === null, 'L2 项目的数据集 kind=audio、3 类、无 columns', res.body.data?.dataset);
  const audProject = res.body.data.project;
  const audDataset = res.body.data.dataset;
  created.projectIds.push(audProject.id);

  const wavs = [makeWav({ freq: 440 }), makeWav({ freq: 523 }), makeWav({ freq: 659 }), makeWav({ freq: 784 })];
  res = await api('POST', `/api/ai-lab/datasets/${audDataset.id}/samples`, { token: ownerToken, form: buildAudioForm(wavs, { class_key: 'clap', split: 'train', source: 'camera', duration_ms: '1000', condition_tags: { speaker: 'A', noise: 'quiet' } }) });
  check(res.status === 201 && res.body.data?.length === 4, '上传 4 个 wav 到 clap/train', res.body);
  const audSample = res.body.data?.[0];
  check(/^ai-lab\/\d+\/\d+\/[0-9a-f-]{36}\.wav$/.test(audSample?.file_path || '') && audSample?.file_url === '/uploads/' + audSample?.file_path, '音频文件名 <uuid>.wav 且带 file_url', audSample?.file_path);
  check(audSample?.width === null && audSample?.height === null && audSample?.duration_ms === 1000 && audSample?.file_size === wavs[0].length && audSample?.condition_tags?.speaker === 'A', 'width/height=null、duration_ms=1000、file_size 为原始字节数（原样落盘）', audSample);
  const audRes = await fetch(`${BASE}${audSample.file_url}`);
  const audBytes = audRes.ok ? Buffer.from(await audRes.arrayBuffer()) : Buffer.alloc(0);
  check(audRes.status === 200 && (audRes.headers.get('content-type') || '').includes('audio') && audBytes.equals(wavs[0]), '/uploads 可读取音频且字节与上传一致', { status: audRes.status, type: audRes.headers.get('content-type'), bytes: audBytes.length });

  res = await api('POST', `/api/ai-lab/datasets/${audDataset.id}/samples`, { token: ownerToken, form: buildAudioForm([makeWav({ freq: 300 }), makeWav({ freq: 320 })], { class_key: 'knock', duration_ms: [600, 900] }) });
  check(res.status === 201 && res.body.data?.map(s => s.duration_ms).join() === '600,900', 'duration_ms 数组逐文件生效', res.body.data?.map(s => s.duration_ms));
  res = await api('POST', `/api/ai-lab/datasets/${audDataset.id}/samples`, { token: ownerToken, form: buildAudioForm([makeWav({ freq: 350 })], { class_key: 'knock' }, { mime: 'application/octet-stream', ext: 'wav' }) });
  check(res.status === 201 && res.body.data?.[0]?.duration_ms === null && res.body.data?.[0]?.file_path?.endsWith('.wav'), 'application/octet-stream + .wav 按扩展名放行，未传 duration_ms 为 null', res.body);
  res = await api('POST', `/api/ai-lab/datasets/${audDataset.id}/samples`, { token: ownerToken, form: buildAudioForm([makeWav({ freq: 500 }), makeWav({ freq: 520 })], { class_key: 'whistle', split: 'shift', shift_set: 'speaker', source: 'upload' }) });
  check(res.status === 201 && res.body.data?.length === 2 && res.body.data[0].split === 'shift' && res.body.data[0].shift_set === 'speaker', '音频可进 shift(speaker) 集', res.body.data?.[0]);
  res = await api('POST', `/api/ai-lab/datasets/${audDataset.id}/samples`, { token: ownerToken, form: buildAudioForm([makeWav({ freq: 500 })], { class_key: 'whistle' }) });
  check(res.status === 201, '补 1 个 whistle/train', res.status);

  step('音频上传校验');
  res = await api('POST', `/api/ai-lab/datasets/${audDataset.id}/samples`, { token: ownerToken, form: buildAudioForm([makeWav()], { class_key: 'clap', duration_ms: 50 }) });
  check(res.status === 400, 'duration_ms=50 返回 400', res.status);
  res = await api('POST', `/api/ai-lab/datasets/${audDataset.id}/samples`, { token: ownerToken, form: buildAudioForm([makeWav()], { class_key: 'clap', duration_ms: 'abc' }) });
  check(res.status === 400, 'duration_ms 非整数返回 400', res.status);
  res = await api('POST', `/api/ai-lab/datasets/${audDataset.id}/samples`, { token: ownerToken, form: buildAudioForm([makeWav(), makeWav()], { class_key: 'clap', duration_ms: [1000] }) });
  check(res.status === 400, 'duration_ms 数组长度不匹配返回 400', res.status);
  res = await api('POST', `/api/ai-lab/datasets/${audDataset.id}/samples`, { token: ownerToken, form: buildForm([await makeImage(1, 2, 3)], { class_key: 'clap' }) });
  check(res.status === 400 && /音频/.test(res.body.message || ''), '音频数据集上传 jpeg 返回 400', res.body);
  res = await api('POST', `/api/ai-lab/datasets/${audDataset.id}/samples`, { token: ownerToken, form: buildAudioForm([Buffer.from('this is definitely not a wav file, just text padding....')], { class_key: 'clap' }) });
  check(res.status === 400, 'audio/wav 但文件头不对返回 400', res.body);
  res = await api('POST', `/api/ai-lab/datasets/${audDataset.id}/samples`, { token: ownerToken, form: buildAudioForm([makeWav()], { class_key: 'clap' }, { mime: 'application/octet-stream', ext: 'flac' }) });
  check(res.status === 400, 'octet-stream + .flac 返回 400', res.status);
  res = await api('POST', `/api/ai-lab/datasets/${audDataset.id}/samples`, { token: ownerToken, form: buildAudioForm([makeWav({ seconds: 25, sampleRate: 44100 })], { class_key: 'clap' }) });
  check(res.status === 400 && /2MB/.test(res.body.message || ''), '超过 2MB 的音频返回 400', res.body);
  res = await api('POST', `/api/ai-lab/datasets/${audDataset.id}/samples`, { token: ownerToken, form: buildAudioForm([makeWav()], { class_key: 'nope' }) });
  check(res.status === 400, '未知类别返回 400', res.status);
  res = await api('POST', `/api/ai-lab/datasets/${audDataset.id}/samples`, { token: adminToken, form: buildAudioForm([makeWav()], { class_key: 'clap' }) });
  check(res.status === 403, '同组 admin 上传音频返回 403', res.status);
  /* 图像数据集拒收 wav */
  res = await api('POST', '/api/ai-lab/projects', { token: ownerToken, body: { title: '图像对照', task_key: 'L1' } });
  const imgCtl = res.body.data;
  created.projectIds.push(imgCtl.project.id);
  res = await api('POST', `/api/ai-lab/datasets/${imgCtl.dataset.id}/samples`, { token: ownerToken, form: buildAudioForm([makeWav()], { class_key: 'thing_a' }) });
  check(res.status === 400 && /图片/.test(res.body.message || ''), '图像数据集上传 wav 返回 400', res.body);

  step('音频：lock / audio-knn 模型 / 评测 / kind 不匹配');
  res = await api('POST', `/api/ai-lab/datasets/${audDataset.id}/lock`, { token: ownerToken, body: { holdout_ratio: 0.25, seed: 21 } });
  check(res.status === 200 && res.body.data?.dataset?.version === 1 && res.body.data?.counts?.holdout?.clap === 1 && res.body.data?.counts?.holdout?.knock === 1, '音频数据集 lock 分层留出（clap 4→1、knock 3→1）', res.body.data?.counts);
  const audioArtifact = { engine: 'audio-knn', k: 3, dim: 2000, vectors: Array.from({ length: 6 }, (_, i) => ({ label: i < 3 ? 'clap' : 'knock', v: Array.from({ length: 16 }, (_, j) => Math.sin(i + j)) })) };
  res = await api('POST', `/api/ai-lab/projects/${audProject.id}/models`, { token: ownerToken, body: { dataset_id: audDataset.id, dataset_version: 1, params: { k: 3 }, class_keys: ['clap', 'knock', 'whistle'], train_sample_count: 6, artifact: audioArtifact, note: '声音第一版' } });
  check(res.status === 201 && res.body.data?.engine === 'audio-knn' && res.body.data?.feature_extractor === 'speech_commands_18w' && res.body.data?.version === 1, '省略 engine 时音频数据集默认 audio-knn / speech_commands_18w', res.body.data);
  const audModel = res.body.data;
  const audArtifactRes = await fetch(`${BASE}${audModel.artifact_url}`);
  check(audArtifactRes.status === 200 && (await audArtifactRes.json())?.vectors?.length === 6, 'audio-knn artifact 可下载', audArtifactRes.status);
  res = await api('POST', `/api/ai-lab/models/${audModel.id}/evaluations`, { token: ownerToken, body: { split: 'holdout', sample_count: 2, metrics: { accuracy: 1, per_class: {}, confusion: { labels: ['clap', 'knock'], matrix: [[1, 0], [0, 1]] } } } });
  check(res.status === 201 && res.body.data?.metrics?.holdout?.accuracy === 1, 'audio-knn holdout 评测已记录', res.body.data?.metrics);
  res = await api('POST', `/api/ai-lab/models/${audModel.id}/evaluations`, { token: ownerToken, body: { split: 'shift', shift_set: 'speaker', sample_count: 2, metrics: { accuracy: 0.5 } } });
  check(res.status === 201 && res.body.data?.metrics?.generalization_gap === 0.5, 'audio shift 评测，gap=0.5', res.body.data?.metrics);
  res = await api('POST', `/api/ai-lab/projects/${audProject.id}/models`, { token: ownerToken, body: { dataset_id: audDataset.id, engine: 'image-knn', class_keys: ['clap'], artifact: {} } });
  check(res.status === 400, '音频数据集用 image-knn 返回 400', res.status);
  res = await api('POST', `/api/ai-lab/projects/${audProject.id}/models`, { token: ownerToken, body: { dataset_id: audDataset.id, engine: 'text-nb', class_keys: ['clap'], artifact: {} } });
  check(res.status === 400, '音频数据集用 text-nb 返回 400', res.status);
  res = await api('POST', `/api/ai-lab/projects/${imgCtl.project.id}/models`, { token: ownerToken, body: { dataset_id: imgCtl.dataset.id, engine: 'audio-knn', class_keys: ['thing_a'], artifact: {} } });
  check(res.status === 400, '图像数据集用 audio-knn 返回 400', res.status);
  res = await api('POST', `/api/ai-lab/projects/${audProject.id}/models`, { token: ownerToken, body: { dataset_id: audDataset.id, engine: 'audio-mystery', class_keys: ['clap'], artifact: {} } });
  check(res.status === 400, '白名单外引擎返回 400', res.status);

  step('音频预置包导入');
  res = await api('POST', '/api/ai-lab/projects', { token: ownerToken, body: { title: '校园声音地图', task_key: 'P6' } });
  check(res.status === 201 && res.body.data?.dataset?.kind === 'audio' && res.body.data?.dataset?.classes?.length === 5, 'P6 项目的数据集 kind=audio、5 类', res.body.data?.dataset);
  const p6Project = res.body.data.project;
  const p6Dataset = res.body.data.dataset;
  created.projectIds.push(p6Project.id);
  res = await api('POST', `/api/ai-lab/datasets/${p6Dataset.id}/import-preset`, { token: ownerToken, body: { pack_key: temp.audioKey, per_class: 2 } });
  check(res.status === 201 && res.body.data?.imported?.train === 4 && res.body.data?.imported?.shift?.['换音高'] === 2 && res.body.data?.dataset?.classes?.length === 2, '临时音频包导入 per_class=2：train 4 / shift 2，空数据集的占位类别被包里的 2 类替换', res.body.data);
  res = await api('GET', `/api/ai-lab/datasets/${p6Dataset.id}/samples`, { token: ownerToken });
  const presetAudio = res.body.data || [];
  const presetTrain = presetAudio.filter(s => s.split === 'train');
  const presetShift = presetAudio.filter(s => s.split === 'shift');
  check(presetTrain.length === 4 && presetTrain.every(s => s.source === 'preset' && /preset-_smoke-.*-\d+\.wav$/.test(s.file_path) && s.width === null && s.origin_ref.startsWith(`${temp.audioKey}:train/`)), '预置音频样本 source=preset、文件名 preset-<pack>-<n>.wav、origin_ref', presetTrain[0]);
  check(presetTrain.map(s => s.duration_ms).sort().join() === '600,600,700,700' && presetShift.every(s => s.duration_ms === null), 'duration_ms 取自 manifest.durations，未给的为 null', { train: presetTrain.map(s => s.duration_ms), shift: presetShift.map(s => s.duration_ms) });
  const srcRel = presetTrain[0].origin_ref.split(':')[1];
  const srcBytes = fs.readFileSync(path.join(PRESETS_ROOT, temp.audioKey, srcRel));
  const dstBytes = fs.readFileSync(path.join(config.storage.paths.uploads, presetTrain[0].file_path));
  check(srcBytes.equals(dstBytes) && presetTrain[0].file_size === srcBytes.length, '音频预置文件原样复制（字节一致）', { src: srcBytes.length, dst: dstBytes.length });
  check(presetTrain[0].condition_tags?.noise === '安静' && presetShift[0]?.condition_tags?.pitch === '偏高', '音频预置样本 condition_tags 取自 manifest', { train: presetTrain[0].condition_tags, shift: presetShift[0]?.condition_tags });
  res = await api('POST', `/api/ai-lab/datasets/${p6Dataset.id}/import-preset`, { token: ownerToken, body: { pack_key: temp.audioKey, per_class: 2 } });
  check(res.status === 201 && res.body.data?.imported?.train === 0 && res.body.data?.skipped?.train === 4, '重复导入音频包去重', res.body.data);
  res = await api('POST', `/api/ai-lab/datasets/${audDataset.id}/import-preset`, { token: ownerToken, body: { pack_key: temp.textKey } });
  check(res.status === 400, '非空音频数据集导入文本包返回 400（kind 冲突）', res.status);
  if (hasSounds) {
    res = await api('POST', `/api/ai-lab/datasets/${p6Dataset.id}/import-preset`, { token: ownerToken, body: { pack_key: 'sounds-synth', per_class: 2 } });
    const soundsPack = packs.find(p => p.key === 'sounds-synth');
    const expectTrain = minPerClassSum(soundsPack.counts.train, 2);
    check(res.status === 201 && res.body.data?.imported?.train === expectTrain, `导入 sounds-synth per_class=2：train ${expectTrain}`, res.body.data?.imported);
    res = await api('GET', `/api/ai-lab/datasets/${p6Dataset.id}/samples?split=train`, { token: ownerToken });
    const synth = (res.body.data || []).find(s => String(s.origin_ref || '').startsWith('sounds-synth:'));
    const synthSrc = synth ? fs.readFileSync(path.join(PRESETS_ROOT, 'sounds-synth', synth.origin_ref.split(':')[1])) : null;
    check(synth && synth.file_path.endsWith('.wav') && synthSrc && synth.file_size === synthSrc.length && synth.duration_ms === 1000, 'sounds-synth 样本 .wav 原样复制、duration_ms 取 manifest.durations=1000', synth);
  }

  /* ---------------- 文本 ---------------- */
  step('文本数据集：rows / 固定 columns');
  res = await api('POST', '/api/ai-lab/projects', { token: ownerToken, body: { title: '情绪翻译器', task_key: 'M5' } });
  check(res.status === 201 && res.body.data?.dataset?.kind === 'text' && res.body.data?.dataset?.classes?.length === 3, 'M5 项目的数据集 kind=text、3 类', res.body.data?.dataset);
  const txtProject = res.body.data.project;
  const txtDataset = res.body.data.dataset;
  created.projectIds.push(txtProject.id);
  const sameTextColumns = Array.isArray(txtDataset.columns) && txtDataset.columns.length === 1
    && txtDataset.columns[0].key === 'text' && txtDataset.columns[0].label === '文本' && txtDataset.columns[0].type === 'text';
  check(sameTextColumns, "文本数据集 columns 自动固定为 [{key:'text',label:'文本',type:'text'}]", txtDataset.columns);

  res = await api('POST', `/api/ai-lab/datasets/${txtDataset.id}/rows`, { token: ownerToken, body: { rows: [
    { class_key: 'positive', payload: { text: '  今天食堂的番茄炒蛋特别好吃  ' }, condition_tags: { topic: '食堂' } },
    { class_key: 'negative', payload: { text: '作业太多了，写到很晚。' } },
    { class_key: 'neutral', payload: { text: '明天第二节是数学课。' } },
    { class_key: 'positive', payload: { text: '社团活动很有趣' }, split: 'shift', shift_set: 'topic' },
    { class_key: 'negative', payload: { text: 12345 } }
  ] } });
  check(res.status === 201 && res.body.data?.length === 5 && res.body.data[0].payload?.text === '今天食堂的番茄炒蛋特别好吃' && res.body.data[0].file_url === null && res.body.data[0].condition_tags?.topic === '食堂', 'POST /rows 文本行（trim、file_url=null、condition_tags）', res.body.data?.[0]);
  check(res.body.data?.[3]?.split === 'shift' && res.body.data[3].shift_set === 'topic' && res.body.data?.[4]?.payload?.text === '12345', '文本行可进 shift 集；数字转字符串', { s3: res.body.data?.[3], s4: res.body.data?.[4] });
  res = await api('POST', `/api/ai-lab/datasets/${txtDataset.id}/rows`, { token: ownerToken, body: { rows: [{ class_key: 'positive', payload: { text: '   ' } }] } });
  check(res.status === 400 && /不能为空/.test(res.body.message || ''), '空白文本返回 400', res.body);
  res = await api('POST', `/api/ai-lab/datasets/${txtDataset.id}/rows`, { token: ownerToken, body: { rows: [{ class_key: 'positive', payload: { text: '字'.repeat(1001) } }] } });
  check(res.status === 400 && /1000/.test(res.body.message || ''), '1001 字文本返回 400', res.body);
  res = await api('POST', `/api/ai-lab/datasets/${txtDataset.id}/rows`, { token: ownerToken, body: { rows: [{ class_key: 'positive', payload: { text: '字'.repeat(1000) } }] } });
  check(res.status === 201 && res.body.data?.[0]?.payload?.text?.length === 1000, '1000 字文本可写入', res.status);
  res = await api('POST', `/api/ai-lab/datasets/${txtDataset.id}/rows`, { token: ownerToken, body: { rows: [{ class_key: 'positive', payload: { body: 'x' } }] } });
  check(res.status === 400, 'payload 含未定义列返回 400', res.status);
  res = await api('POST', `/api/ai-lab/datasets/${txtDataset.id}/rows`, { token: ownerToken, body: { rows: [{ class_key: 'positive', payload: { text: { a: 1 } } }] } });
  check(res.status === 400, 'text 为对象返回 400', res.status);
  res = await api('POST', `/api/ai-lab/datasets/${txtDataset.id}/samples`, { token: ownerToken, form: buildForm([await makeImage(1, 2, 3)], { class_key: 'positive' }) });
  check(res.status === 400 && /rows/.test(res.body.message || ''), '文本数据集上传文件返回 400', res.body);
  res = await api('PATCH', `/api/ai-lab/datasets/${txtDataset.id}`, { token: ownerToken, body: { columns: [{ key: 'text', type: 'text' }, { key: 'extra', type: 'number' }] } });
  check(res.status === 400, '文本数据集修改 columns 返回 400', res.status);
  res = await api('PATCH', `/api/ai-lab/datasets/${txtDataset.id}`, { token: ownerToken, body: { name: '留言集' } });
  check(res.status === 200 && res.body.data?.name === '留言集', '文本数据集可改名', res.body.data?.name);
  res = await api('POST', `/api/ai-lab/projects/${txtProject.id}/datasets`, { token: ownerToken, body: { name: '手建文本', kind: 'text', classes: [{ key: 'a' }, { key: 'b' }] } });
  check(res.status === 201 && res.body.data?.kind === 'text' && res.body.data?.columns?.[0]?.type === 'text', 'POST /datasets kind=text 自动填固定 columns', res.body.data);
  const emptyText = res.body.data;
  res = await api('POST', `/api/ai-lab/projects/${txtProject.id}/datasets`, { token: ownerToken, body: { name: '手建文本2', kind: 'text', classes: [], columns: [{ key: 'x', type: 'text' }] } });
  check(res.status === 400, 'kind=text 传 columns 返回 400', res.status);
  res = await api('POST', `/api/ai-lab/projects/${txtProject.id}/datasets`, { token: ownerToken, body: { name: '坏类型', kind: 'video', classes: [] } });
  check(res.status === 400, 'kind=video 返回 400', res.status);
  res = await api('POST', `/api/ai-lab/datasets/${emptyText.id}/import-preset`, { token: ownerToken, body: { pack_key: temp.audioKey, per_class: 1, shift_sets: [] } });
  check(res.status === 201 && res.body.data?.dataset?.kind === 'audio' && res.body.data?.dataset?.columns === null && res.body.data?.imported?.train === 2, '空文本数据集导入音频包 → kind 切换为 audio、columns 清空', res.body.data?.dataset);

  step('文本预置包导入 / lock / text-nb 模型');
  res = await api('POST', `/api/ai-lab/datasets/${txtDataset.id}/import-preset`, { token: ownerToken, body: { pack_key: temp.textKey, per_class: 3 } });
  check(res.status === 201 && res.body.data?.imported?.train === 9 && res.body.data?.imported?.shift?.['另一话题'] === 6, '临时文本包导入 per_class=3：train 9 / shift 6', res.body.data?.imported);
  res = await api('GET', `/api/ai-lab/datasets/${txtDataset.id}/samples?split=train`, { token: ownerToken });
  const textPreset = (res.body.data || []).find(s => s.source === 'preset');
  check(textPreset && textPreset.file_path === null && typeof textPreset.payload?.text === 'string' && textPreset.origin_ref.startsWith(`${temp.textKey}:rows/train/`), '文本预置样本 file_path=null、payload.text、origin_ref', textPreset);
  check(res.body.data?.[0]?.columns === undefined && (await api('GET', `/api/ai-lab/projects/${txtProject.id}`, { token: ownerToken })).body.data?.datasets?.[0]?.columns?.length === 1, '导入文本包后 columns 仍为固定的一列', null);
  if (hasMessages) {
    const msgPack = packs.find(p => p.key === 'campus-messages');
    res = await api('POST', `/api/ai-lab/datasets/${txtDataset.id}/import-preset`, { token: ownerToken, body: { pack_key: 'campus-messages', per_class: 5 } });
    const expectTrain = minPerClassSum(msgPack.counts.train, 5);
    check(res.status === 201 && res.body.data?.imported?.train === expectTrain, `导入 campus-messages per_class=5：train ${expectTrain}`, res.body.data?.imported);
    res = await api('GET', `/api/ai-lab/datasets/${txtDataset.id}/samples?split=train`, { token: ownerToken });
    const msg = (res.body.data || []).find(s => String(s.origin_ref || '').startsWith('campus-messages:'));
    check(msg && typeof msg.payload?.text === 'string' && msg.payload.text.length > 0 && msg.file_path === null, 'campus-messages 样本 payload.text 落库', msg?.payload);
  }
  res = await api('POST', `/api/ai-lab/datasets/${txtDataset.id}/lock`, { token: ownerToken, body: { holdout_ratio: 0.2, seed: 31 } });
  check(res.status === 200 && res.body.data?.dataset?.version === 1 && sumValues(res.body.data?.counts?.holdout) > 0, '文本数据集 lock 分层留出', res.body.data?.counts);
  const vocab = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`词${i}`, { positive: i % 3, negative: (i + 1) % 3, neutral: (i + 2) % 3 }]));
  res = await api('POST', `/api/ai-lab/projects/${txtProject.id}/models`, { token: ownerToken, body: { dataset_id: txtDataset.id, dataset_version: 1, params: { alpha: 1, ngram: 2 }, class_keys: ['positive', 'negative', 'neutral'], train_sample_count: 10, artifact: { engine: 'text-nb', vocab, priors: { positive: 0.4, negative: 0.3, neutral: 0.3 } }, note: '文本第一版' } });
  check(res.status === 201 && res.body.data?.engine === 'text-nb' && res.body.data?.feature_extractor === 'char-ngram' && res.body.data?.version === 1, '省略 engine 时文本数据集默认 text-nb / char-ngram', res.body.data);
  const txtModel = res.body.data;
  const txtArtifactRes = await fetch(`${BASE}${txtModel.artifact_url}`);
  check(txtArtifactRes.status === 200 && Object.keys((await txtArtifactRes.json())?.vocab || {}).length === 300, 'text-nb 词表 artifact 可下载', txtArtifactRes.status);
  res = await api('POST', `/api/ai-lab/models/${txtModel.id}/evaluations`, { token: ownerToken, body: { split: 'holdout', sample_count: 3, metrics: { accuracy: 0.67, per_class: {}, confusion: { labels: [], matrix: [] } }, errors: [{ sample_id: textPreset.id, actual: 'positive', predicted: 'neutral', confidence: 0.4 }] } });
  check(res.status === 201 && res.body.data?.metrics?.holdout?.accuracy === 0.67, 'text-nb holdout 评测已记录', res.body.data?.metrics);
  res = await api('POST', `/api/ai-lab/projects/${txtProject.id}/models`, { token: ownerToken, body: { dataset_id: txtDataset.id, engine: 'table-tree', class_keys: ['positive'], artifact: {} } });
  check(res.status === 400, '文本数据集用 table-tree 返回 400', res.status);
  res = await api('POST', `/api/ai-lab/projects/${txtProject.id}/models`, { token: ownerToken, body: { dataset_id: txtDataset.id, engine: 'image-dense', class_keys: ['positive'], artifact: {} } });
  check(res.status === 400, '文本数据集用 image-dense 返回 400', res.status);

  /* ---------------- 表格 table-mlp ---------------- */
  step('table-mlp 模型 / 20MB artifact');
  res = await api('POST', '/api/ai-lab/projects', { token: ownerToken, body: { title: '决策树 vs 神经网络', task_key: 'M3' } });
  check(res.status === 201 && res.body.data?.dataset?.kind === 'table', 'M3 项目的数据集 kind=table', res.body.data?.dataset);
  const mlpProject = res.body.data.project;
  const mlpDataset = res.body.data.dataset;
  created.projectIds.push(mlpProject.id);
  const tablePackKey = packs.some(p => p.key === 'penguins') ? 'penguins' : packs.find(p => p.kind === 'table')?.key;
  res = await api('POST', `/api/ai-lab/datasets/${mlpDataset.id}/import-preset`, { token: ownerToken, body: { pack_key: tablePackKey, per_class: 6 } });
  check(res.status === 201 && res.body.data?.imported?.train > 0, `导入表格包 ${tablePackKey}`, res.body.data?.imported);
  const mlpClasses = res.body.data.dataset.classes.map(c => c.key);
  const weights = { w1: Array.from({ length: 16 }, () => Array.from({ length: 8 }, (_, j) => j / 10)), b1: Array(16).fill(0.01), w2: Array.from({ length: mlpClasses.length }, () => Array(16).fill(0.02)), b2: Array(mlpClasses.length).fill(0) };
  res = await api('POST', `/api/ai-lab/projects/${mlpProject.id}/models`, { token: ownerToken, body: { dataset_id: mlpDataset.id, engine: 'table-mlp', params: { hidden: 16, epochs: 80 }, class_keys: mlpClasses, train_sample_count: 18, artifact: { engine: 'table-mlp', ...weights }, note: '神经网络' } });
  check(res.status === 201 && res.body.data?.engine === 'table-mlp' && res.body.data?.feature_extractor === 'none' && res.body.data?.params?.hidden === 16, 'POST /models engine=table-mlp，feature_extractor 默认 none', res.body.data);
  const mlpModel = res.body.data;
  res = await api('POST', `/api/ai-lab/models/${mlpModel.id}/evaluations`, { token: ownerToken, body: { split: 'holdout', sample_count: 5, metrics: { accuracy: 0.8, per_class: {}, confusion: { labels: [], matrix: [] } } } });
  check(res.status === 201 && res.body.data?.metrics?.holdout?.accuracy === 0.8, 'table-mlp holdout 评测已记录', res.body.data?.metrics);
  res = await api('POST', `/api/ai-lab/projects/${audProject.id}/models`, { token: ownerToken, body: { dataset_id: audDataset.id, engine: 'table-mlp', class_keys: ['clap'], artifact: {} } });
  check(res.status === 400, '音频数据集用 table-mlp 返回 400', res.status);

  const bigArtifact = { engine: 'audio-knn', blob: 'v'.repeat(11 * 1024 * 1024) };
  res = await api('POST', `/api/ai-lab/projects/${mlpProject.id}/models`, { token: ownerToken, body: { dataset_id: mlpDataset.id, engine: 'table-mlp', class_keys: mlpClasses, artifact: bigArtifact, note: '11MB' } });
  const bigOk = res.status === 201 && res.body.data?.artifact_path && fs.statSync(path.join(config.storage.paths.uploads, res.body.data.artifact_path)).size > 11 * 1024 * 1024;
  check(bigOk, '11MB artifact（超过旧的 10MB 上限）可保存并落盘', { status: res.status, message: res.body?.message });

  step('新事件类型 v3');
  const newTypes = ['annotation.write', 'agreement.compute', 'fairness.view', 'audio.play'];
  res = await api('POST', `/api/ai-lab/projects/${txtProject.id}/events`, { token: ownerToken, body: { events: newTypes.map(type => ({ type, payload: { smoke: true } })) } });
  check(res.status === 201 && res.body.data?.inserted === 4, '4 种新事件类型均可写入', res.body);
  res = await api('GET', `/api/ai-lab/projects/${txtProject.id}/events`, { token: ownerToken });
  check(res.body.data?.map(e => e.type).join(',') === newTypes.join(','), 'GET /events 按序返回新事件', res.body.data?.map(e => e.type));

  step('其余新模板可建项目');
  for (const [key, kind] of [['L5', 'text'], ['L6', 'table'], ['M4', 'audio'], ['M2', 'image'], ['P7', 'text']]) {
    res = await api('POST', '/api/ai-lab/projects', { token: ownerToken, body: { title: `模板 ${key}`, task_key: key } });
    if (res.body.data?.project?.id) created.projectIds.push(res.body.data.project.id);
    check(res.status === 201 && res.body.data?.dataset?.kind === kind, `${key} 项目的数据集 kind=${kind}`, res.body.data?.dataset?.kind);
  }
  res = await api('GET', `/api/ai-lab/projects/${audProject.id}`, { token: ownerToken });
  check(res.body.data?.project?.summary?.model_count === 1 && res.body.data?.project?.summary?.generalization_gap === 0.5 && res.body.data?.datasets?.[0]?.kind === 'audio', '音频项目 summary 与数据集 kind 正确', res.body.data?.project?.summary);
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
    for (const dir of created.tempPackDirs) {
      if (dir.startsWith(PRESETS_ROOT + path.sep) && path.basename(dir).startsWith('_smoke-')) {
        fs.rmSync(dir, { recursive: true, force: true });
        console.log(`  已删除临时预置包 ${dir}`);
      }
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
    const tokens = await runFlow(users.owner, users.admin);
    await runV2Flow(users.owner, tokens);
    await runV3Flow(users.owner, tokens);
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

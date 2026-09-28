/**
 * 视频工作台的本地预览：把已构建的前端产物端出来，几个接口用假数据顶上，让人真的能点。
 *
 * 不连数据库、不连生产、不调任何模型、不发一次真实生成；关掉进程就什么都不剩。
 * 端口默认 4401（图像那台 4400 归图像验收，两边互不打扰）。
 *
 * 桩的形状必须照真实源码来——图像那边连栽三次都是形状不对：
 *   /auth/me 回 {data:{user,permissions}}；video/history 回 {data:{data,pagination}}；
 *   /video/generate 回 {taskId, generationId}；/video/task/:id 回 {status,progress,local_path,...}。
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const DIST = path.resolve(__dirname, '../../frontend/dist');
const PORT = Number(process.env.PORT || 4401);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2',
  '.mp4': 'video/mp4' };

/* 海报图就地画：8×8 纯色 PNG，不依赖外网 */
const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
const crc32 = buf => {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function solidPng(id) {
  const size = 8;
  const hue = (id * 53) % 360;
  const rgb = [0, 2, 4].map(k => {
    const v = Math.abs(((hue / 60 + k) % 6) - 3) - 1;
    return Math.round(255 * (0.30 + 0.5 * Math.min(1, Math.max(0, v))));
  });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.concat(Array.from({ length: size }, () => Buffer.concat([
    Buffer.from([0]), ...Array.from({ length: size }, () => Buffer.from(rgb))
  ])));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]);
}

const now = Date.now();
const fake = (id, prompt, extra = {}) => ({
  id, prompt, task_id: `task-${id}`, model_name: '视频模型甲（演示）', status: 'succeeded',
  progress: 100, is_favorite: id % 3 === 0, is_public: false, user_id: 1,
  created_at: new Date(now - id * 6e4).toISOString(), duration: 5, resolution: '720p', ratio: '16:9',
  credits_used: 75, local_path: `/preview-video/${id}.mp4`, thumbnail_path: `/preview-img/${id}.png`,
  ...extra
});
const history = [
  fake(1, '镜头缓缓推近，夕阳下的校园水池'), fake(2, '雨后操场，镜头横移，水洼倒影'),
  fake(3, '清晨教学楼，镜头缓缓上摇'), fake(4, '实验室玻璃器皿，微距缓推'),
  fake(5, '银杏道，镜头跟随落叶')
];

/* 本地演示开关：产品里能不能看到新版，由服务端资格判定说了算 */
let pilotAvailable = process.env.PREVIEW_PILOT === '1';
/* 演示任务：提交后按秒推进 queued → running → succeeded */
const tasks = new Map();

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = url.pathname;

  if (p === '/preview-login') {
    const session = JSON.stringify({ state: { user: { id: 1, username: 'demo', nickname: '演示老师',
        group_id: 1, credits_stats: { total: 8000, used: 200, remaining: 7800 } },
      permissions: ['*'], accessToken: 'preview-token', refreshToken: null,
      tokenExpiresAt: Date.now() + 36e5, isAuthenticated: true }, version: 0 });
    return send(res, 200, `<!doctype html><meta charset="utf-8"><title>视频预览</title>
<body style="font-family:system-ui;padding:24px">正在进入视频生成预览…
<script>localStorage.setItem('auth-storage', ${JSON.stringify(session)});
localStorage.removeItem('video.layoutMode');location.replace('/video');</script></body>`, TYPES['.html']);
  }

  if (p.startsWith('/preview-img/')) {
    const id = Number(p.slice('/preview-img/'.length).replace(/\.png$/, '')) || 1;
    return send(res, 200, solidPng(id), TYPES['.png']);
  }
  if (p.startsWith('/preview-video/')) {
    // 演示用的占位片：没有真正的编码数据，卡片会显示海报图。真实播放不在本演示的证明范围内。
    return send(res, 200, Buffer.alloc(0), TYPES['.mp4']);
  }
  if (p === '/preview-pilot/on' || p === '/preview-pilot/off') {
    pilotAvailable = p.endsWith('/on');
    return send(res, 200, { pilotAvailable });
  }

  if (p.startsWith('/api/')) {
    if (p.endsWith('/studio-pilot/capability')) {
      const capability = url.searchParams.get('capability') || '';
      return send(res, 200, { success: true, data: pilotAvailable
        ? { capability, available: true, reason: null, retryable: false, message: null, batch_ref: 'demo-batch' }
        : { capability, available: false, reason: 'pilot_provider_not_installed', retryable: false,
            message: '这个功能还没有对你所在的学校开放（演示：未装配资格提供方）', batch_ref: null } });
    }
    if (p.endsWith('/video/models')) {
      return send(res, 200, { success: true, data: [{
        id: 1, name: 'demo-video', display_name: '视频模型甲（演示）', provider: 'volcano',
        has_api_key: true, is_active: true, base_price: 50,
        price_config: { resolution_multiplier: { '720p': 1.5, '1080p': 2 }, duration_multiplier: { '5': 1, '10': 2 } },
        supports_text_to_video: true, supports_first_frame: true, supports_last_frame: true,
        resolutions_supported: ['720p', '1080p'], durations_supported: [5, 10], max_prompt_length: 500
      }] });
    }
    if (p.endsWith('/video/history')) {
      return send(res, 200, { success: true, data: { data: history,
        pagination: { page: 1, limit: 20, total: history.length, totalPages: 1 } } });
    }
    if (p.includes('/video/gallery')) {
      return send(res, 200, { success: true, data: { data: history.slice(0, 2),
        pagination: { page: 1, limit: 20, total: 2, totalPages: 1 } } });
    }
    if (p.endsWith('/video/stats')) {
      return send(res, 200, { success: true, data: { total: history.length, favorites: 1, public: 0 } });
    }
    if (p.endsWith('/video/generate')) {
      const id = 100 + history.length + tasks.size;
      const taskId = `task-${id}`;
      const row = fake(id, '（演示）刚刚提交的一条', { status: 'queued', progress: 0, local_path: null });
      row.created_at = new Date().toISOString();
      history.unshift(row);
      tasks.set(taskId, { id, at: Date.now() });
      return send(res, 200, { success: true, data: { taskId, generationId: id, message: '任务已提交' } });
    }
    if (p.includes('/video/task/')) {
      const taskId = p.split('/video/task/')[1];
      const task = tasks.get(taskId);
      if (!task) return send(res, 404, { success: false, message: 'task not found' });
      const age = (Date.now() - task.at) / 1000;
      const row = history.find(item => item.id === task.id);
      let status = 'queued'; let progress = 0;
      if (age > 6) { status = 'succeeded'; progress = 100; }
      else if (age > 2) { status = 'running'; progress = Math.min(90, Math.round(age * 15)); }
      if (row) {
        row.status = status; row.progress = progress;
        row.local_path = status === 'succeeded' ? `/preview-video/${task.id}.mp4` : null;
      }
      return send(res, 200, { success: true, data: { status, progress,
        local_path: status === 'succeeded' ? `/preview-video/${task.id}.mp4` : null,
        thumbnail_path: `/preview-img/${task.id}.png`, error_message: null } });
    }
    if (p.includes('/auth/me') || p.includes('/users/profile')) {
      return send(res, 200, { success: true, data: {
        user: { id: 1, username: 'demo', nickname: '演示老师', group_id: 1, role: 'user',
          credits_stats: { total: 8000, used: 200, remaining: 7800 } },
        permissions: ['*'] } });
    }
    return send(res, 200, { success: true, data: [] });
  }

  const file = path.join(DIST, p === '/' ? 'index.html' : p.replace(/^\/+/, ''));
  if (file.startsWith(DIST) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
  }
  return send(res, 200, fs.readFileSync(path.join(DIST, 'index.html')), TYPES['.html']);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`视频预览在 http://127.0.0.1:${PORT}/preview-login （假接口，随时 Ctrl+C）`);
});

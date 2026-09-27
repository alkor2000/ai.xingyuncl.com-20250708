/**
 * 本地预览：把已构建的前端产物端出来，几个接口用假数据顶上，让人真的能点。
 * 不连数据库、不连生产、不发任何真实请求；关掉进程就什么都不剩。
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const DIST = path.resolve(__dirname, '../../frontend/dist');
const PORT = Number(process.env.PORT || 4399);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };

const now = Date.now();
// 字段照 store 与卡片真正读的那几个来：getImageUrl 只看 local_path/thumbnail_path/image_url，
// isTaskCompleted 认的是 status === 'success'，不是 'completed'。
const fake = (id, prompt) => ({
  id, prompt, model_name: '模型甲（演示）', status: 'success', is_favorite: id % 3 === 0, is_public: false,
  created_at: new Date(now - id * 6e4).toISOString(), user_id: 1, width: 1024, height: 1024,
  credits_used: 6, image_url: `https://picsum.photos/seed/p${id}/640/640`
});
const history = [
  fake(1, '夕阳下的校园水池，暖色调，低角度'), fake(2, '雨后操场，水洼倒影，冷色调'),
  fake(3, '清晨的教学楼，逆光剪影'), fake(4, '实验室里的玻璃器皿，微距'),
  fake(5, '秋天的银杏道，浅景深'), fake(6, '教室窗台上的绿植，晨光')
];

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = url.pathname;

  // 一进来先把假登录塞好，再跳到图像页——省得你自己造 token
  if (p === '/preview-login') {
    const session = JSON.stringify({ state: { user: { id: 1, username: 'demo', nickname: '演示老师', group_id: 1 },
      permissions: ['*'], accessToken: 'preview-token', refreshToken: null,
      tokenExpiresAt: Date.now() + 36e5, isAuthenticated: true }, version: 0 });
    return send(res, 200, `<!doctype html><meta charset="utf-8"><title>预览</title>
<body style="font-family:system-ui;padding:24px">正在进入图像生成预览…
<script>localStorage.setItem('auth-storage', ${JSON.stringify(session)});
localStorage.removeItem('image.layoutMode');location.replace('/image');</script></body>`, TYPES['.html']);
  }

  if (p.startsWith('/api/')) {
    if (p.endsWith('/image/models')) {
      return send(res, 200, { success: true, data: [
        { id: 1, name: 'sd-demo', display_name: '模型甲（演示）', provider: 'openai', credits_per_image: 6,
          has_api_key: true, is_active: true, supports_image_to_image: true },
        { id: 2, name: 'mj-demo', display_name: '模型乙（演示）', provider: 'openai', credits_per_image: 12,
          has_api_key: true, is_active: true, supports_image_to_image: false }] });
    }
    if (p.endsWith('/image/history')) {
      // store 读的是 response.data.data.data 与 .pagination，形状必须一模一样，
      // 否则页面只会说"获取历史记录失败"——这次就是栽在这里。
      return send(res, 200, { success: true, data: { data: history,
        pagination: { page: 1, limit: 20, total: history.length, totalPages: 1 } } });
    }
    if (p.includes('/image/gallery') || p.includes('/image/public')) {
      return send(res, 200, { success: true, data: { data: history.slice(0, 3),
        pagination: { page: 1, limit: 20, total: 3, totalPages: 1 } } });
    }
    if (p.endsWith('/image/stats')) {
      return send(res, 200, { success: true, data: { total: history.length, favorites: 2, public: 0 } });
    }
    if (p.endsWith('/image/generate')) {
      // 演示用的假生成：造一张新图放到历史最前面，让对话区真的长出一条
      const id = 100 + history.length;
      const made = fake(id, '（演示）刚刚生成的一张');
      made.created_at = new Date().toISOString();
      history.unshift(made);
      return send(res, 200, { success: true, data: { id, images: [made], creditsConsumed: 6,
        succeeded: 1, requested: 1 } });
    }
    if (p.endsWith('/prompt-assist')) {
      // 演示用的假候选，不调模型、不扣分
      return send(res, 200, { success: true, data: { candidates: [
        '夕阳下的校园水池，暖金色逆光，睡莲与倒影，低角度特写，柔和景深',
        '傍晚的校园水池，孩子们蹲在池边观察，暖光，纪实风格',
        '校园水池的水面特写，波纹与落叶，微距，清透的冷暖对比'
      ], model: { id: 1, display_name: '模型甲（演示）' }, credits_charged: 3 } });
    }
    if (p.includes('/auth/me') || p.includes('/users/profile')) {
      return send(res, 200, { success: true, data: { id: 1, nickname: '演示老师', group_id: 1, credits: 5000 } });
    }
    return send(res, 200, { success: true, data: [] });
  }

  const file = path.join(DIST, p === '/' ? 'index.html' : p.replace(/^\/+/, ''));
  if (file.startsWith(DIST) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
  }
  return send(res, 200, fs.readFileSync(path.join(DIST, 'index.html')), TYPES['.html']);   // SPA 兜底
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`预览已启动：http://127.0.0.1:${PORT}/preview-login`);
});

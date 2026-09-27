/**
 * 本地预览：把已构建的前端产物端出来，几个接口用假数据顶上，让人真的能点。
 * 不连数据库、不连生产、不发任何真实请求；关掉进程就什么都不剩。
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

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
  credits_used: 6, image_url: `/preview-img/${id}.png`
});
const history = [
  fake(1, '夕阳下的校园水池，暖色调，低角度'), fake(2, '雨后操场，水洼倒影，冷色调'),
  fake(3, '清晨的教学楼，逆光剪影'), fake(4, '实验室里的玻璃器皿，微距'),
  fake(5, '秋天的银杏道，浅景深'), fake(6, '教室窗台上的绿植，晨光')
];

/* 演示图就地画：8×8 的纯色 PNG。原来引外部 picsum，没外网时图片一直加载不出来，
   浏览器用例看不到真正的 <img>——演示件不该有这种外部依赖。 */
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
  const hue = (id * 47) % 360;
  const rgb = [0, 2, 4].map(k => {
    const v = Math.abs(((hue / 60 + k) % 6) - 3) - 1;
    return Math.round(255 * (0.35 + 0.5 * Math.min(1, Math.max(0, v))));
  });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8bit RGB
  const raw = Buffer.concat(Array.from({ length: size }, () => Buffer.concat([
    Buffer.from([0]), ...Array.from({ length: size }, () => Buffer.from(rgb))
  ])));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]);
}

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

/* 只在这个本地演示里存在的开关：产品里能不能用「帮我写」由服务端资格判定说了算 */
let assistAvailable = process.env.PREVIEW_ASSIST === '1';

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = url.pathname;

  // 一进来先把假登录塞好，再跳到图像页——省得你自己造 token
  if (p === '/preview-login') {
    // credits_stats 必须有：useImageGeneration 直接读 user.credits_stats.remaining（真实用户由
    // User.toSafeJSON 一定带上），假身份少了它，点生成会抛 TypeError，页面什么都不发。
    const session = JSON.stringify({ state: { user: { id: 1, username: 'demo', nickname: '演示老师', group_id: 1,
        credits_stats: { total: 5000, used: 120, remaining: 4880 } },
      permissions: ['*'], accessToken: 'preview-token', refreshToken: null,
      tokenExpiresAt: Date.now() + 36e5, isAuthenticated: true }, version: 0 });
    return send(res, 200, `<!doctype html><meta charset="utf-8"><title>预览</title>
<body style="font-family:system-ui;padding:24px">正在进入图像生成预览…
<script>localStorage.setItem('auth-storage', ${JSON.stringify(session)});
localStorage.removeItem('image.layoutMode');location.replace('/image');</script></body>`, TYPES['.html']);
  }

  if (p.startsWith('/preview-img/')) {
    const id = Number(p.slice('/preview-img/'.length).replace(/\.png$/, '')) || 1;
    return send(res, 200, solidPng(id), TYPES['.png']);
  }

  if (p === '/preview-assist/on' || p === '/preview-assist/off') {
    assistAvailable = p.endsWith('/on');
    return send(res, 200, { assistAvailable });
  }

  if (p.startsWith('/api/')) {
    if (p.endsWith('/image/models')) {
      return send(res, 200, { success: true, data: [
        // 价钱字段是 price_per_image（ImageModel 就是这么回的）；写成 credits_per_image
        // 按钮上会显示「生成（0 积分）」——演示里看着像不要钱，验收时会误导人。
        { id: 1, name: 'sd-demo', display_name: '模型甲（演示）', provider: 'openai', price_per_image: 6,
          generation_type: 'sync', has_api_key: true, is_active: true, sizes_supported: ['1024x1024'],
          api_config: { supports_image2image: true } },
        { id: 2, name: 'mj-demo', display_name: '模型乙（演示）', provider: 'openai', price_per_image: 12,
          generation_type: 'sync', has_api_key: true, is_active: true, sizes_supported: ['1024x1024'],
          api_config: { supports_image2image: false } }] });
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
      // 演示用的假生成。形状照真实响应来：单张就是那条记录本身（ImageService.generateImage
      // 回的是 results[0]），多张是 {requested,succeeded,failed,results,errors}——
      // 页面现在按响应登记本轮结果，形状不对就测不出真东西。
      let body = '';
      req.on('data', c => { body += c; });
      return req.on('end', () => {
        let quantity = 1;
        try { quantity = Number(JSON.parse(body || '{}').quantity) || 1; } catch { /* 演示，随它 */ }
        const made = [];
        for (let i = 0; i < quantity; i += 1) {
          const row = fake(100 + history.length + i, '（演示）刚刚生成的一张');
          row.created_at = new Date().toISOString();
          made.push(row);
        }
        made.slice().reverse().forEach(row => history.unshift(row));
        if (quantity === 1) return send(res, 200, { success: true, data: made[0] });
        return send(res, 200, { success: true, data: { success: true, requested: quantity,
          succeeded: made.length, failed: 0, creditsConsumed: 6 * made.length, results: made, errors: [] } });
      });
    }
    if (p.endsWith('/prompt-assist/capability')) {
      // 真实缺省是"没装配资格提供方就一律拒绝"，演示也照这个缺省；
      // 想看开着的样子：访问 /preview-assist/on（仅本地演示用的开关，产品里没有这种东西）
      return send(res, 200, { success: true, data: assistAvailable
        ? { available: true, reason: null, retryable: false, message: null, batch_ref: 'demo-batch' }
        : { available: false, reason: 'pilot_provider_not_installed', retryable: false,
            message: '这个功能还没有对你所在的学校开放（演示：未装配资格提供方）', batch_ref: null } });
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
      // authStore.getCurrentUser 解的是 data.user / data.permissions；
      // 直接把用户对象当 data 回，会把已登录的 user 覆盖成 undefined，
      // 然后 useImageGeneration 读 user.credits_stats 直接抛错、点生成什么都不发。
      return send(res, 200, { success: true, data: {
        user: { id: 1, username: 'demo', nickname: '演示老师', group_id: 1, role: 'user',
          credits_stats: { total: 5000, used: 120, remaining: 4880 } },
        permissions: ['*'] } });
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

/**
 * 只为「看一眼」：把已构建的前端产物跑起来，用打桩接口喂几张假图，
 * 桌面与 390 各截一张新版工作台、再截一张经典视图。不连数据库、不连生产、不发任何真实请求。
 *
 * 当前这台机器跑不起来：两套 chromium 都缺 libnspr4.so，装系统库要 sudo，没装。
 * 另外它的假数据还是 status:'completed' 的老形状，产品代码认的是 'success'——
 * 真要用它截图，先照 server.cjs 的形状把假数据改过来。验收是用 server.cjs 人工点的。
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('node:path');

const BASE = process.env.PREVIEW_URL;
const OUT = process.env.OUT_DIR;
const now = Date.now();
const fake = (id, prompt) => ({
  id, prompt, model_name: '模型甲', status: 'completed', is_favorite: false, is_public: false,
  created_at: new Date(now - id * 60000).toISOString(), user_id: 1,
  images: [{ url: `https://picsum.photos/seed/p${id}/640/640`, width: 640, height: 640 }],
  image_url: `https://picsum.photos/seed/p${id}/640/640`
});
const history = [
  fake(1, '夕阳下的校园水池，暖色调，低角度'),
  fake(2, '雨后操场，水洼倒影，冷色调'),
  fake(3, '清晨的教学楼，逆光剪影'),
  fake(4, '实验室里的玻璃器皿，微距')
];

(async () => {
  // 这台机器上 headless_shell 缺 libnspr4，完整 chromium 是好的，直接指过去。
  const browser = await chromium.launch({
    headless: true, args: ['--no-sandbox'],
    executablePath: process.env.CHROME_PATH || undefined
  });
  for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['narrow', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, locale: 'zh-CN', isMobile: viewport.width < 600 });
    await context.addInitScript(([stored]) => {
      localStorage.setItem('auth-storage', stored);
      localStorage.removeItem('image.layoutMode');          // 新来的默认进工作台
    }, [JSON.stringify({ state: { user: { id: 1, username: 'demo', nickname: '演示老师', group_id: 1 },
      permissions: ['*'], accessToken: 'preview-token', refreshToken: null,
      tokenExpiresAt: Date.now() + 36e5, isAuthenticated: true }, version: 0 })]);

    const page = await context.newPage();
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      const p = url.pathname;
      const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (p.endsWith('/image/models')) {
        return json({ success: true, data: [{ id: 1, name: 'sd', display_name: '模型甲', provider: 'openai',
          credits_per_image: 6, has_api_key: true, is_active: true, supports_image_to_image: true }] });
      }
      if (p.endsWith('/image/history')) {
        return json({ success: true, data: { generations: history, list: history, items: history,
          pagination: { current: 1, pageSize: 12, total: history.length } } });
      }
      if (p.endsWith('/image/stats')) return json({ success: true, data: { total: history.length } });
      if (p.includes('/modules')) return json({ success: true, data: [] });
      if (p.includes('/system-config') || p.includes('/config')) return json({ success: true, data: {} });
      if (p.includes('/auth/me') || p.includes('/users/profile')) {
        return json({ success: true, data: { id: 1, username: 'demo', nickname: '演示老师', group_id: 1, credits: 5000 } });
      }
      return json({ success: true, data: [] });
    });

    await page.goto(`${BASE}/image`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, `image-studio-${label}.png`), animations: 'disabled' });

    // 参数抽屉与「帮我写」各来一张，证明它们确实收在里面
    if (label === 'narrow') {
      await page.getByTestId('studio-params').click().catch(() => {});
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(OUT, 'image-studio-params-drawer.png'), animations: 'disabled' });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      await page.getByTestId('studio-assist').click().catch(() => {});
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(OUT, 'image-studio-assist.png'), animations: 'disabled' });
      await page.keyboard.press('Escape');
    }

    // 切回经典视图
    await page.getByTestId('studio-to-classic').click().catch(() => {});
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, `image-classic-${label}.png`), animations: 'disabled' });
    await context.close();
  }
  await browser.close();
  console.log('shots done');
})();

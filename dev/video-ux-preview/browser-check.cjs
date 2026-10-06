/**
 * 真实 Chromium（**headless、隔离容器**，不是真机）跑一遍视频工作台，桌面 + 两个窄屏。
 *
 * 连的是本机演示服务（假接口、占位片），所以只能证明界面接线与布局，
 * 不证明真实生成、真实扣分、真实播放。浏览器跑在 tedna-ppt-browser-probe 镜像里，
 * 宿主没装任何系统库。
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.PREVIEW_URL || 'http://127.0.0.1:4401';
const OUT = process.env.OUT_DIR || '/out';
const shots = [];
const cases = [];
const noise = [];

const record = (name, ok, detail) => { cases.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
async function shoot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  shots.push({ name, file: path.basename(file), bytes: fs.statSync(file).size });
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => noise.push({ kind: 'pageerror', text: String(e && e.message || e) }));
  page.on('console', m => { if (m.type() === 'error') noise.push({ kind: 'console', text: m.text().slice(0, 300) }); });

  // 1 没资格：留在经典视频页，没有新版、没有入口
  await page.request.get(`${BASE}/preview-pilot/off`);
  await page.goto(`${BASE}/preview-login`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.video-generation-page', { timeout: 20000 });
  const noStudio = await page.locator('[data-testid="video-studio"]').count();
  const noEntry = await page.locator('[data-testid="classic-to-studio"]').count();
  record('缺省没资格：不进新版工作台，也没有切过去的入口', noStudio === 0 && noEntry === 0,
    `studio=${noStudio} 入口=${noEntry}`);
  record('经典视频页照旧在（已公开的功能没被收回）',
    (await page.locator('.generation-container').count()) === 1);
  await shoot(page, '00-classic-when-not-eligible');

  await page.evaluate(() => localStorage.setItem('video.layoutMode', 'studio'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.video-generation-page', { timeout: 20000 });
  record('本机强设 studio，没资格照样进不去',
    (await page.locator('[data-testid="video-studio"]').count()) === 0);

  // 2 有资格才进新版
  await page.request.get(`${BASE}/preview-pilot/on`);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="video-studio"]', { timeout: 20000 });
  record('桌面 1280×900：有资格才打开新版视频工作台', true);
  await shoot(page, '01-studio-desktop');

  // 3 真的提交一轮：先排队，再生成中，最后出片
  await page.fill('[data-testid="studio-prompt"]', '镜头缓缓推近，夕阳下的校园水池，暖色调');
  await page.click('[data-testid="studio-generate"]');
  await page.waitForSelector('[data-testid="studio-turn"]', { timeout: 20000 });
  const queued = await page.locator('[data-testid="studio-turn-pending"]').count();
  record('提交后本轮先显示排队/生成中，不假装已经做好', queued === 1, `pending=${queued}`);
  await shoot(page, '02-studio-turn-queued');

  await page.waitForSelector('[data-testid="studio-turn-video"]', { timeout: 60000 });
  const turnVideos = await page.locator('[data-testid="studio-turn"] video').count();
  record('任务做完后本轮换成视频（按真实任务 id 更新，不是历史前 N 条）', turnVideos === 1,
    `本轮视频数=${turnVideos}`);
  await shoot(page, '03-studio-turn-done');

  // 4 图库抽屉：有数据、能画出卡片、不白屏
  await page.click('[data-testid="studio-open-gallery"]');
  await page.waitForSelector('.studio-gallery .video-card', { timeout: 20000 });
  const cards = await page.locator('.studio-gallery .video-card').count();
  record('图库抽屉带数据打开，真的画出视频卡，不白屏', cards > 0, `卡片数=${cards}`);
  await shoot(page, '04-gallery-drawer');

  // 5 切公开画廊，本轮仍在
  const before = await page.locator('[data-testid="studio-turn"] video').first().getAttribute('src');
  await page.getByText('公开画廊', { exact: false }).first().click();   // 浏览器里跑的是真的语言包
  await page.waitForTimeout(800);
  const after = await page.locator('[data-testid="studio-turn"] video').count();
  const afterSrc = after ? await page.locator('[data-testid="studio-turn"] video').first().getAttribute('src') : null;
  record('切到公开画廊后，本轮的视频还在对话区', after === 1 && afterSrc === before, `切后=${after}`);
  await shoot(page, '05-gallery-public-tab-turn-kept');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // 6 窄屏
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="video-studio"]', { timeout: 20000 });
    const composer = await page.locator('[data-testid="studio-composer"]').isVisible();
    const overflow = await page.evaluate(() => {
      const el = document.scrollingElement || document.documentElement;
      return el.scrollWidth - el.clientWidth;
    });
    record(`${width}px 宽：输入条可见且没有横向溢出`, composer && overflow <= 1, `溢出=${overflow}px`);
    await shoot(page, `06-studio-${width}`);
  }

  // 7 经典视图来回切
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="video-studio"]', { timeout: 20000 });
  await page.click('[data-testid="studio-to-classic"]');
  await page.waitForSelector('[data-testid="classic-to-studio"]', { timeout: 20000 });
  record('切到经典视频页，老样子还在', true);
  await shoot(page, '07-classic-view');
  await page.click('[data-testid="classic-to-studio"]');
  await page.waitForSelector('[data-testid="video-studio"]', { timeout: 20000 });
  record('再切回新版工作台', true);

  // 8 资格撤销后退回经典
  await page.request.get(`${BASE}/preview-pilot/off`);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.video-generation-page', { timeout: 20000 });
  record('资格撤销后再进来：退回经典视频页，不残留新版',
    (await page.locator('[data-testid="video-studio"]').count()) === 0);

  await browser.close();

  const failed = cases.filter(c => !c.ok);
  fs.writeFileSync(path.join(OUT, 'browser-cases.json'), JSON.stringify({
    at: new Date().toISOString(),
    runtime: 'tedna-ppt-browser-probe:local + ~/.cache/ms-playwright（只读挂载），headless 隔离容器，宿主未装系统库',
    target: BASE,
    what_this_proves: '界面接线与布局（假接口、占位片）。不是真机；不证明真实生成、真实扣分、真实播放。',
    cases, screenshots: shots, console_noise: noise,
    result: failed.length === 0 ? 'passed' : 'failed'
  }, null, 2));
  console.log(`\n结果=${failed.length === 0 ? 'passed' : 'failed'}；用例 ${cases.length - failed.length}/${cases.length}；截图 ${shots.length} 张；控制台噪声 ${noise.length} 条`);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch(err => { console.error('RUNNER ERROR', err); process.exit(2); });

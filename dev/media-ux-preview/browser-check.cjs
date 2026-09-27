/**
 * 真实 Chromium 跑一遍这次改过的东西（桌面 + 三个窄屏）。
 *
 * 连的是本机演示服务（假接口），所以这里**只能**证明界面接线与布局，
 * 不证明真实生成、真实扣分。浏览器本身跑在总控给的 tedna-ppt-browser-probe 镜像里，
 * 宿主缺 libnspr4.so 的限制由此绕开——没装任何系统库。
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.PREVIEW_URL || 'http://127.0.0.1:4400';
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

  // 1 进页面
  await page.goto(`${BASE}/preview-login`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="image-studio"]', { timeout: 20000 });
  record('桌面 1280×900 打开新版工作台', true);
  await shoot(page, '01-studio-desktop');

  // 2 新能力的门：缺省不出现
  const assistHidden = await page.locator('[data-testid="studio-assist"]').count();
  record('缺省（未装配资格提供方）时「帮我写」不出现', assistHidden === 0, `按钮数=${assistHidden}`);
  const genVisible = await page.locator('[data-testid="studio-generate"]').isVisible();
  record('同时生图按钮照旧可见（经典能力没被门挡住）', genVisible);

  // 3 真的生成一轮
  await page.fill('[data-testid="studio-prompt"]', '夕阳下的校园水池，暖色调，低角度');
  await page.click('[data-testid="studio-generate"]');
  await page.waitForSelector('[data-testid="studio-turn"] img', { timeout: 20000 });
  const turnImgs = await page.locator('[data-testid="studio-turn"] img').count();
  record('生成后对话区长出一条（提示词 + 这轮的图）', turnImgs === 1, `本轮图数=${turnImgs}`);
  await shoot(page, '02-studio-one-turn');

  // 4 图库抽屉：有图且不白屏（849e7d2 那个回归）
  await page.click('[data-testid="studio-open-gallery"]');
  await page.waitForSelector('.studio-gallery .history-grid', { timeout: 20000 });
  const cards = await page.locator('.studio-gallery .image-card, .studio-gallery .history-grid > *').count();
  const stillStudio = await page.locator('[data-testid="image-studio"]').count();
  record('图库抽屉带数据打开，不白屏', cards > 0 && stillStudio === 1, `卡片数=${cards}`);
  await shoot(page, '03-gallery-drawer');

  // 5 切公开画廊，本轮的图必须还在（9e8f085 那个修复的真机确认）
  const before = await page.locator('[data-testid="studio-turn"] img').first().getAttribute('src');
  await page.getByText('公开画廊', { exact: false }).first().click();
  await page.waitForTimeout(800);
  const after = await page.locator('[data-testid="studio-turn"] img').count();
  const afterSrc = after ? await page.locator('[data-testid="studio-turn"] img').first().getAttribute('src') : null;
  record('切到公开画廊后，本轮的图还在对话区', after === 1 && afterSrc === before, `切后本轮图数=${after}`);
  await shoot(page, '04-gallery-public-tab-turn-kept');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // 6 装配后「帮我写」才出现（演示开关，不是产品里的东西）
  await page.request.get(`${BASE}/preview-assist/on`);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="image-studio"]');
  const shown = await page.locator('[data-testid="studio-assist"]').count();
  record('服务端说可用之后「帮我写」才出现', shown === 1, `按钮数=${shown}`);
  if (shown === 1) {
    await page.click('[data-testid="studio-assist"]');
    await page.waitForSelector('[data-testid="assist-ask"]', { timeout: 10000 });
    await shoot(page, '05-assist-panel');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  await page.request.get(`${BASE}/preview-assist/off`);

  // 7 三个窄屏
  for (const width of [430, 390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="image-studio"]');
    const composer = await page.locator('[data-testid="studio-composer"]').isVisible();
    const overflow = await page.evaluate(() => {
      const el = document.scrollingElement || document.documentElement;
      return el.scrollWidth - el.clientWidth;
    });
    record(`${width}px 宽：输入条可见且没有横向溢出`, composer && overflow <= 1, `溢出=${overflow}px`);
    await shoot(page, `06-studio-${width}`);
  }

  // 8 经典视图来回切
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="image-studio"]');
  await page.click('[data-testid="studio-to-classic"]');
  await page.waitForSelector('[data-testid="classic-to-studio"]', { timeout: 20000 });
  record('切到经典视图，老样子还在', true);
  await shoot(page, '07-classic-view');
  await page.click('[data-testid="classic-to-studio"]');
  await page.waitForSelector('[data-testid="image-studio"]', { timeout: 20000 });
  record('再切回新版工作台', true);

  await browser.close();

  const failed = cases.filter(c => !c.ok);
  const report = {
    at: new Date().toISOString(),
    runtime: 'tedna-ppt-browser-probe:local + ~/.cache/ms-playwright（只读挂载），宿主未装系统库',
    target: BASE,
    what_this_proves: '界面接线与布局（假接口）。不证明真实生成、真实扣分、真实资格提供方。',
    cases, screenshots: shots, console_noise: noise,
    result: failed.length === 0 ? 'passed' : 'failed'
  };
  fs.writeFileSync(path.join(OUT, 'browser-cases.json'), JSON.stringify(report, null, 2));
  console.log(`\n结果=${report.result}；用例 ${cases.length - failed.length}/${cases.length}；截图 ${shots.length} 张；控制台噪声 ${noise.length} 条`);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch(err => { console.error('RUNNER ERROR', err); process.exit(2); });

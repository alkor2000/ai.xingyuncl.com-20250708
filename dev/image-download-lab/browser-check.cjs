/* 隔离浏览器矩阵：对每个场景真点击一次按钮，记录 1) 是否产生下载事件（文件名、字节数、首字节魔数）
 * 2) 页面是否被导航走 3) 是否弹出新窗口 4) 页面脚本抛错 5) 替身 message 收到的提示 6) 被测函数返回值。
 * 只连本机回环实验源；不碰生产、不碰真实用户图片。用法：node browser-check.cjs --base http://127.0.0.1:4411 --helper old|new --out /out/x.json */
const { chromium } = require('playwright');
const fs = require('fs');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1]] : null).filter(Boolean));
const base = args.base, helper = args.helper || 'old', out = args.out;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ headless: true });
  const version = browser.version();
  const context = await browser.newContext({ acceptDownloads: true, ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const results = [];
  await page.goto(`${base}/?helper=${helper}`);
  const scenarios = await page.evaluate(() => Array.from(document.querySelectorAll('button')).map(b => b.id.replace(/^btn-/, '')));
  for (const id of scenarios) {
    await page.goto(`${base}/?helper=${helper}`);
    await page.waitForSelector(`#btn-${id}`);
    const errors = [], navigations = [];
    const onErr = e => errors.push(String(e.message || e)); page.on('pageerror', onErr);
    const onNav = f => { if (f === page.mainFrame()) navigations.push(f.url()); }; page.on('framenavigated', onNav);
    const downloadP = page.waitForEvent('download', { timeout: 2500 }).catch(() => null);
    const popupP = page.waitForEvent('popup', { timeout: 2500 }).catch(() => null);
    const urlBefore = page.url();
    await page.click(`#btn-${id}`);
    const [download, popup] = await Promise.all([downloadP, popupP]);
    await sleep(600);
    let dl = null;
    if (download) {
      let bytes = null, magic = null, failure = null;
      try { failure = await download.failure(); } catch (e) { failure = 'failure(): ' + e.message; }
      try { const p = await download.path(); if (p) { const buf = fs.readFileSync(p); bytes = buf.length; magic = buf.subarray(0, 8).toString('hex'); } } catch (e) { failure = failure || ('path(): ' + e.message); }
      dl = { suggestedFilename: download.suggestedFilename(), url: download.url(), bytes, magic, failure };
    }
    let popupInfo = null;
    if (popup) { try { await popup.waitForLoadState('domcontentloaded', { timeout: 2000 }).catch(() => {}); popupInfo = { url: popup.url(), opener: await popup.evaluate(() => window.opener !== null).catch(() => 'n/a') }; await popup.close(); } catch (e) { popupInfo = { error: e.message }; } }
    const state = await page.evaluate(() => ({ messages: window.__messages || [], results: window.__results || [], bodyClicks: window.__bodyClicks, title: document.title })).catch(e => ({ unreadable: e.message }));
    page.off('pageerror', onErr); page.off('framenavigated', onNav);
    results.push({ id, urlBefore, urlAfter: page.url(), navigatedAway: page.url() !== urlBefore, navigations: navigations.filter(u => u !== urlBefore), download: dl, popup: popupInfo, pageErrors: errors, ...state });
    console.log(JSON.stringify({ id, download: dl && { file: dl.suggestedFilename, bytes: dl.bytes, failure: dl.failure }, navigatedAway: page.url() !== urlBefore, popup: popupInfo && popupInfo.url, messages: state.messages, returned: (state.results || []).map(r => r.returned || r.threw) }));
  }
  await browser.close();
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), chromium: version, helper, base, results }, null, 1));
  console.log(`wrote ${out} (${results.length} scenarios, chromium ${version})`);
})().catch(e => { console.error('HARNESS FAILED', e); process.exit(1); });

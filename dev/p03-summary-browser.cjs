// Actual chat/controller/export against loopback synthetic data. No real model-quality claim.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const JSZip = require('../backend/node_modules/jszip');
const origin = 'http://localhost:3017';
const out = path.resolve(__dirname, '../storage/private/p03-summary-validation');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}), args: ['--no-sandbox'] });
  const checks = [], errors = [];
  let currentPage;
  try {
    for (const [width, height] of [[1280, 900], [390, 844], [360, 740], [844, 390]]) {
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 1024, isMobile: width < 1024, acceptDownloads: true });
      const page = await context.newPage();
      currentPage = page;
      page.on('pageerror', error => errors.push(error.message));
      const requests = [];
      page.on('request', req => { if (/\/messages$/.test(new URL(req.url()).pathname) && req.method() === 'POST') requests.push(req.postDataJSON()); });
      await page.goto(origin + '/dev/p03-summary.html');
      const button = page.getByRole('button', { name: '整理成果', exact: true });
      await button.waitFor({ timeout: 60000 });
      const draft = page.locator('textarea').first();
      await draft.fill('未发送的补充，请保留。');
      const before = await (await page.request.get(origin + '/__summary-test/state')).json();
      await button.click();
      // The real frontend disables the action until the request finishes.
      assert(await button.isDisabled());
      const result = page.getByRole('heading', { name: '十五分钟水循环探究课（整理草稿）', exact: true }).last();
      await result.waitFor();
      await page.waitForFunction(() => !document.querySelector('.discussion-summary .ant-btn')?.disabled);
      assert.equal(await draft.inputValue(), '未发送的补充，请保留。');
      assert.equal(requests.length, 1);
      assert.equal(requests[0].summary_mode, 'discussion');
      assert.deepEqual(requests[0].file_ids, []);
      assert(!requests[0].output_format);
      assert(!JSON.stringify(requests[0]).includes('未发送的补充'));
      const after = await (await page.request.get(origin + '/__summary-test/state')).json();
      assert.equal(after.generations, before.generations + 1);
      assert.equal(after.balance, before.balance - 1);
      await result.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(out, `summary-${width}.png`), animations: 'disabled' });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.getByRole('button', { name: '下载成果', exact: true }).last().click();
      const preview = await page.getByTestId('export-selection').textContent();
      assert(preview.includes('十五分钟'));
      assert(!preview.includes('EARLY_REQUIREMENT') && !preview.includes('PRIVATE_THINKING'));
      const event = page.waitForEvent('download');
      await page.getByRole('button', { name: '下载 ZIP', exact: true }).click();
      const file = path.join(out, `summary-${width}.zip`);
      await (await event).saveAs(file);
      const zip = await JSZip.loadAsync(await fs.readFile(file));
      assert.deepEqual(Object.keys(zip.files).sort(), ['answer.md', 'source.json']);
      assert.equal(await zip.file('answer.md').async('string'), preview);
      const manifest = JSON.parse(await zip.file('source.json').async('string'));
      assert.equal(manifest.source.kind, 'assistant_message');
      assert.equal(manifest.material_status, 'ai_output_unreviewed');
      checks.push(`${width}x${height}: generate, preserve unsent draft, one charge, exact preview/download, no transcript export`);
      if (width === 390) {
        const first = await (await page.request.get(origin + '/__summary-test/state')).json();
        await page.request.post(origin + '/__summary-test/fail-next');
        await button.click();
        await page.locator('.discussion-summary .ant-alert').waitFor();
        const failed = await (await page.request.get(origin + '/__summary-test/state')).json();
        assert.equal(failed.balance, first.balance);
        assert.equal(failed.refunds, first.refunds + 1);
        assert.equal(await draft.inputValue(), '未发送的补充，请保留。');
        await button.click();
        await page.waitForFunction(() => !document.querySelector('.discussion-summary .ant-btn')?.disabled);
        assert.equal(await page.locator('.discussion-summary .ant-alert').count(), 0);
        checks.push('real provider-failure path: one refund, preserved draft, manual retry succeeds');
      }
      await context.close();
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(out, 'browser-result.json'), JSON.stringify({ passed: true, realTeacher: false, realDevice: false, syntheticModel: true, checks, pageErrors: errors }, null, 2));
    console.log(`Summary browser checks passed: ${checks.length} groups`);
  } catch (error) {
    if (currentPage && !currentPage.isClosed()) {
      await currentPage.screenshot({ path: path.join(out, 'browser-failure.png') });
      await fs.writeFile(path.join(out, 'browser-failure.txt'), JSON.stringify({ errors, body: await currentPage.locator('body').innerText() }, null, 2));
    }
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

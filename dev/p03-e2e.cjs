// Run against `node dev/p03-demo.mjs`. Requires Playwright on NODE_PATH or PLAYWRIGHT_MODULE.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs/promises');
const path = require('path');
const assert = require('node:assert/strict');
const root = 'http://localhost:3004';
const output = process.env.P03_EVIDENCE_DIR || '/tmp/ai-platform-p03';

(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
    const errors = [];
    const external = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => { if (!req.url().startsWith(root) && !req.url().startsWith('http://127.0.0.1:3004')) external.push(req.url()); });
    await page.goto(`${root}/dev/p03.html`);
    await page.getByRole('button', { name: '准备成果' }).waitFor();
    assert.equal(await page.getByRole('button', { name: '准备成果' }).count(), 1);
    await page.getByRole('button', { name: '准备成果' }).click();
    await page.getByTestId('handoff-selection').waitFor();
    assert.equal(await page.getByText('开发验证与详情', { exact: true }).count(), 0);
    assert.equal(await page.getByText(/sha256:/).count(), 0);
    assert.equal(await page.getByText(/UTF-16/).count(), 0);
    const theme = await page.evaluate(() => ({
      primary: getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim(),
      button: getComputedStyle(document.querySelector('.ant-modal .ant-btn-primary')).backgroundColor
    }));
    assert.equal(theme.primary, '#8b1f35');
    assert.equal(theme.button, 'rgb(139, 31, 53)');
    await page.screenshot({ path: path.join(output, 'teacher-desktop.png'), fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: path.join(output, 'teacher-mobile.png'), fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 1280, height: 1000 });
    // Explicit test URL retains fault injection, outside the normal teacher flow.
    await page.goto(`${root}/dev/p03.html?p03Debug=1`);
    await page.getByRole('button', { name: '准备成果' }).click();
    assert.equal(await page.locator('details[open]').count(), 0);
    assert.equal(await page.getByRole('textbox', { name: '回答原文' }).count(), 0);
    await page.getByRole('radio', { name: '选择片段' }).click();
    assert(await page.getByRole('button', { name: '确认并准备' }).isDisabled());
    const original = page.getByRole('textbox', { name: '回答原文' });
    await original.waitFor();
    const text = await original.inputValue();
    assert(!text.includes('PRIVATE_THINKING'));
    const chosen = '先观察，再记录两杯水的变化。';
    const start = text.indexOf(chosen);
    await original.click(); // Wait for the modal's opening/focus animation before keyboard selection.
    await original.evaluate((node, range) => node.setSelectionRange(range.start, range.end), { start, end: start + chosen.length });
    await original.dispatchEvent('mouseup'); // React's selection event follows the browser mouse-up.
    await page.waitForFunction(text => document.querySelector('[data-testid="handoff-selection"]')?.textContent === text, chosen);
    await page.getByRole('checkbox', { name: /activity.md/ }).check();
    await page.screenshot({ path: path.join(output, 'desktop-scope.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: '确认并准备' }).click();
    await page.getByText('成果已准备，可下载原文', { exact: true }).waitFor();
    await page.getByText('开发验证与详情', { exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载交接数据 .json' }).click();
    const download = await downloadPromise;
    const filename = path.join(output, 'selected-snapshot.json');
    await download.saveAs(filename);
    const packet = JSON.parse(await fs.readFile(filename, 'utf8'));
    assert.equal(packet.payload.text, chosen);
    assert.equal(packet.payload.attachments.length, 1);
    for (const excluded of ['UNSELECTED_PRIVATE_PROMPT', 'PRIVATE_THINKING', 'example.org', 'file_path']) assert(!JSON.stringify(packet).includes(excluded));
    // Ant Design's labelled combobox and portal options.
    async function choose(label, option) {
      await page.locator('.ant-select').filter({ has: page.getByRole('combobox', { name: label }) }).locator('.ant-select-selector').click();
      await page.locator('.ant-select-dropdown:visible').getByText(option, { exact: true }).click();
    }
    await choose('模拟接收场景', '接收成功但响应丢失');
    await page.getByRole('button', { name: '模拟发送 / 重试' }).click();
    await page.getByText('模拟结果待确认，可以重试', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'response-lost.png'), fullPage: true, animations: 'disabled' });
    // Reload browser, resume the server-side snapshot and reconcile the already accepted operation.
    await page.reload();
    await page.getByRole('button', { name: '准备成果' }).click();
    await page.getByRole('button', { name: '继续上次准备' }).click();
    await page.getByText('开发验证与详情', { exact: true }).click();
    await page.getByText('模拟结果待确认，可以重试', { exact: true }).waitFor();
    await page.getByRole('button', { name: '模拟发送 / 重试' }).click();
    await page.getByText('模拟接收完成，未写入 TE-DNA', { exact: true }).waitFor();
    assert.equal(await page.getByText('已保存到 TE-DNA', { exact: true }).count(), 0);
    await page.getByText('开发验证与详情', { exact: true }).click();
    await page.screenshot({ path: path.join(output, 'desktop-recovered.png'), fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'mobile-recovered.png'), fullPage: true, animations: 'disabled' });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    await fs.writeFile(path.join(output, 'browser-result.json'), JSON.stringify({ passed: true, checks: [
      'assistant-only-entry', 'teacher-flow-hides-diagnostics', 'shared-platform-theme', 'technical-details-collapsed', 'empty-range-blocked', 'exact-selected-text', 'explicit-owned-attachment', 'download-packet-isolation',
      'lost-response', 'reload-resume', 'mock-only-result', 'mobile-no-horizontal-overflow', 'no-external-requests'
    ], viewport: [1280, 390], pageErrors: errors }, null, 2));
    console.log('P03 browser checks passed; evidence: ' + output);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

// Actual export component/routes with synthetic data; no real teacher/device acceptance claim.
// Start `node dev/p03-demo.mjs`; use PLAYWRIGHT_MODULE when Playwright is outside this repo.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const JSZip = require('../backend/node_modules/jszip');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const root = process.env.P03_DEMO_URL || 'http://localhost:3004';
const output = process.env.P03_EVIDENCE_DIR || path.resolve(__dirname, '../storage/private/p03-handoff-validation');
const sha = text => createHash('sha256').update(text).digest('hex');

(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const checks = [], errors = [], external = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (!r.url().startsWith(root)) external.push(r.url()); });
    await page.goto(`${root}/dev/p03.html`);
    async function open() {
      await page.getByRole('button', { name: '下载成果', exact: true }).click();
      await page.getByTestId('export-selection').waitFor();
    }
    async function zipDownload(name) {
      const event = page.waitForEvent('download');
      await page.getByRole('button', { name: '下载 ZIP', exact: true }).click();
      const d = await event;
      const destination = path.join(output, name);
      await d.saveAs(destination);
      return JSZip.loadAsync(await fs.readFile(destination));
    }
    await open();
    const whole = await page.getByTestId('export-selection').textContent();
    assert(!whole.includes('PRIVATE_THINKING'));
    assert.equal(await page.getByRole('checkbox').count(), 1); // Missing/unsupported cannot be selected.
    assert.equal(await page.getByRole('checkbox').isChecked(), false);
    const fullZip = await zipDownload('whole-answer.zip');
    assert.deepEqual(Object.keys(fullZip.files).sort(), ['answer.md', 'source.json']);
    assert.equal(await fullZip.file('answer.md').async('string'), whole);
    checks.push('whole-answer-preview-matches-zip-with-no-default-attachments');

    await open();
    await page.getByRole('radio', { name: '选择片段' }).click();
    assert(await page.getByRole('button', { name: '下载 ZIP', exact: true }).isDisabled());
    const original = page.getByRole('textbox', { name: '回答原文' });
    const chosen = '先观察，再记录两杯水的变化。';
    const start = (await original.inputValue()).indexOf(chosen);
    await original.click();
    await original.evaluate((node, range) => node.setSelectionRange(...range), [start, start + chosen.length]);
    await original.dispatchEvent('mouseup');
    await page.waitForFunction(text => document.querySelector('[data-testid="export-selection"]')?.textContent === text, chosen);
    await page.getByRole('checkbox', { name: 'activity.md' }).check();
    await page.getByText('查看 activity.md', { exact: true }).click();
    const attachmentText = await page.locator('.ant-modal details pre').textContent();
    await page.screenshot({ path: path.join(output, 'download-desktop-selection.png'), fullPage: true, animations: 'disabled' });

    let fault = 'network';
    const requests = [];
    await page.route('**/api/artifact-exports/messages/*/download', async route => {
      requests.push(route.request().postDataJSON());
      if (fault === 'network') { fault = null; return route.abort('connectionfailed'); }
      if (fault === 'version') { fault = null; return route.fulfill({ status: 409, contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { code: 'source_changed' } }) }); }
      return route.continue();
    });
    await page.getByRole('button', { name: '下载 ZIP', exact: true }).click();
    await page.getByText('网络连接中断，请重试下载。', { exact: true }).waitFor();
    assert.equal(await page.getByTestId('export-selection').textContent(), chosen);
    assert(await page.getByRole('checkbox', { name: 'activity.md' }).isChecked());
    const zip = await zipDownload('selected-answer.zip');
    assert.deepEqual(requests[0], requests[1]);
    assert.deepEqual(Object.keys(requests[1]).sort(), ['attachments', 'expected_version', 'schema_version', 'selection']);
    const manifest = JSON.parse(await zip.file('source.json').async('string'));
    const text = await zip.file('answer.md').async('string');
    assert.equal(text, chosen);
    assert.equal(manifest.locator.start, start);
    assert.equal(manifest.locator.end, start + chosen.length);
    assert.equal(manifest.byte_length, Buffer.byteLength(chosen));
    assert.equal(manifest.summary.text, chosen);
    assert.equal(manifest.source.version, requests[1].expected_version);
    assert.equal(manifest.export_schema, 'practice-selected-export/v1');
    const [attachment] = manifest.attachments;
    const bytes = await zip.file(attachment.archive_path).async('string');
    assert.equal(bytes, attachmentText);
    assert.equal(attachment.version, `sha256:${sha(bytes)}`);
    const { archive_path: ignored, ...metadata } = attachment;
    assert.equal(manifest.content_sha256, sha(JSON.stringify({ text, attachments: [{ ...metadata, text: bytes }] })));
    for (const file of Object.values(zip.files)) {
      const value = await file.async('string');
      for (const excluded of ['PRIVATE_THINKING', 'UNSELECTED_PRIVATE_PROMPT', 'example.org', 'file_path']) assert(!value.includes(excluded));
    }
    checks.push('exact-snippet-and-attachment-preview-match-archive-and-hashes', 'network-failure-retains-selection-and-retries-same-request', 'request-has-no-body-text-or-identity');

    await open();
    fault = 'version';
    await page.getByRole('button', { name: '下载 ZIP', exact: true }).click();
    await page.getByText('原文或附件已变化，请重新加载并核对。', { exact: true }).waitFor();
    assert(await page.getByRole('button', { name: '下载 ZIP', exact: true }).isDisabled());
    await page.getByRole('button', { name: '重新读取来源' }).click();
    await page.getByTestId('export-selection').waitFor();
    await zipDownload('reloaded-answer.zip');
    checks.push('injected-version-conflict-requires-explicit-reload');
    await page.close();

    for (const [width, height] of [[390, 844], [320, 568], [844, 390]]) {
      const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, acceptDownloads: true });
      const mobile = await context.newPage();
      mobile.on('pageerror', e => errors.push(e.message));
      await mobile.goto(`${root}/dev/p03.html`);
      await mobile.getByRole('button', { name: '下载成果', exact: true }).tap();
      await mobile.getByTestId('export-selection').waitFor();
      await mobile.getByRole('checkbox', { name: 'activity.md' }).tap();
      await mobile.getByText('查看 activity.md', { exact: true }).tap();
      assert(await mobile.getByRole('checkbox', { name: 'activity.md' }).isChecked());
      assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const button = mobile.getByRole('button', { name: '下载 ZIP', exact: true });
      // Exercise actual input scrolling; locator auto-scroll alone cannot prove operability.
      const wrap = mobile.locator('.ant-modal-wrap');
      await mobile.mouse.move(width - 12, Math.floor(height / 2));
      await mobile.mouse.wheel(0, -2000);
      await mobile.waitForTimeout(250);
      const top = await wrap.evaluate(node => node.scrollTop);
      await mobile.mouse.wheel(0, 2000);
      await mobile.waitForTimeout(250);
      const bottom = await wrap.evaluate(node => node.scrollTop);
      const overflow = await wrap.evaluate(node => node.scrollHeight > node.clientHeight);
      if (overflow) assert(bottom > top, 'modal must respond to wheel input');
      const box = await button.boundingBox();
      assert(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= height);
      await mobile.screenshot({ path: path.join(output, `download-touch-${width}.png`), animations: 'disabled' });
      const event = mobile.waitForEvent('download');
      await button.tap();
      await (await event).saveAs(path.join(output, `touch-${width}.zip`));
      checks.push(`touch-emulation-${width}x${height}-selection-preview-download`);
      await context.close();
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    await fs.writeFile(path.join(output, 'download-browser-result.json'), JSON.stringify({ passed: true,
      mode: 'synthetic-loopback-chromium-touch-emulation-not-real-account-or-device', checks, pageErrors: errors }, null, 2));
    console.log(`P03 download browser checks passed (${checks.length}); evidence: ${output}`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

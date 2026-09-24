// Command-driven Playwright worker for the isolated P03 entry acceptance (dev/p03-triad/entry_scenarios.py drives it).
// It clicks the real frontend served by Vite against the real practice server; every command answers one JSON line.
// Credentials arrive on stdin only. Screenshots and facts go to the evidence directory; nothing else is written.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const readline = require('node:readline');
const path = require('node:path');
const assert = require('node:assert/strict');

const ENTRY = '保存到备课资源库';
const API = '/api/p03/handoffs';
const state = { browser: null, context: null, page: null, web: null, evidence: null, requests: [], external: [], errors: [], conversation: null };

function answer(value) { process.stdout.write(JSON.stringify(value) + '\n'); }
function track(page) {
  page.on('pageerror', e => state.errors.push(String(e.message).slice(0, 200)));
  page.on('request', r => {
    const url = new URL(r.url());
    if (url.origin !== state.web) state.external.push(url.origin);
    if (url.pathname.startsWith(API)) {
      let body = null;
      try { body = r.method() === 'POST' ? r.postDataJSON() : null; } catch { body = r.postData(); }
      state.requests.push({ method: r.method(), path: url.pathname + url.search, body, idempotency_key: r.headers()['idempotency-key'] || null, status: null });
    }
  });
  page.on('response', r => {
    const url = new URL(r.url());
    if (!url.pathname.startsWith(API)) return;
    const entry = [...state.requests].reverse().find(x => x.status === null && x.path === url.pathname + url.search && x.method === r.request().method());
    if (entry) entry.status = r.status();
  });
}
async function fresh(viewport) {
  if (state.context) await state.context.close().catch(() => {});
  state.context = await state.browser.newContext({ viewport, locale: 'zh-CN', isMobile: viewport.width < 600, hasTouch: viewport.width < 600, deviceScaleFactor: viewport.width < 600 ? 2 : 1 });
  state.page = await state.context.newPage();
  track(state.page);
  return state.page;
}
async function shot(name) {
  await state.page.waitForTimeout(400); // let antd's motion (modal fade/zoom) finish so the review image shows the final frame
  await state.page.screenshot({ path: path.join(state.evidence, name + '.png'), fullPage: false, animations: 'disabled' });
}
async function token() {
  return state.page.evaluate(() => { try { return JSON.parse(localStorage.getItem('auth-storage')).state.accessToken; } catch { return null; } });
}
async function api(method, apiPath, body, headers = {}) {
  const t = await token();
  const response = await state.context.request.fetch(state.web + apiPath, { method, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', ...headers }, data: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await response.json(); } catch { json = null; }
  return { status: response.status(), body: json };
}
// The seeded conversation is opened from whatever list the width shows (sidebar on desktop, list view on phones).
async function openConversation() {
  const page = state.page;
  await page.goto(`${state.web}/chat`, { waitUntil: 'domcontentloaded' });
  const title = page.getByText(state.conversation, { exact: true }).first();
  await title.waitFor({ timeout: 30000 });
  await title.click();
  await page.getByRole('button', { name: '下载成果', exact: true }).first().waitFor({ timeout: 30000 });
}
const entries = () => state.page.getByRole('button', { name: ENTRY, exact: true });
async function selectExcerpt(excerpt) {
  const page = state.page;
  await page.getByRole('radio', { name: '选择片段' }).click();
  const original = page.getByRole('textbox', { name: '回答原文' });
  const value = await original.inputValue();
  const start = value.indexOf(excerpt);
  assert(start >= 0, 'excerpt_not_in_answer');
  await original.click();
  await original.evaluate((node, range) => { node.focus(); node.setSelectionRange(...range); node.dispatchEvent(new Event('select', { bubbles: true })); }, [start, start + excerpt.length]);
  await original.dispatchEvent('mouseup');
  await page.waitForFunction(text => document.querySelector('[data-testid="handoff-selection"]')?.textContent === text, excerpt);
  return { start, end: start + excerpt.length };
}
// Bordered antd Descriptions render label/content as th/td pairs in document order.
async function descriptions() {
  return state.page.locator('.ant-modal .ant-descriptions-item-label, .ant-modal .ant-descriptions-item-content').evaluateAll(nodes => {
    const pairs = [];
    for (let i = 0; i + 1 < nodes.length; i += 2) pairs.push([nodes[i].textContent.trim(), nodes[i + 1].textContent.trim()]);
    return pairs;
  });
}
async function statusView() {
  const page = state.page;
  const tag = await page.getByTestId('handoff-status').textContent();
  const cells = await descriptions();
  const error = await page.getByTestId('handoff-error').count() ? await page.getByTestId('handoff-error').locator('.ant-alert-message').textContent() : null;
  return { status: tag, fields: Object.fromEntries(cells), error, retry_visible: await page.getByTestId('handoff-retry').count() > 0, refresh_visible: await page.getByTestId('handoff-refresh').count() > 0 };
}
async function waitStatus(expected, timeout = 60000) {
  await state.page.waitForFunction(list => list.includes(document.querySelector('[data-testid="handoff-status"]')?.textContent), expected, { timeout });
  return statusView();
}
const commands = {
  async start(c) {
    state.web = c.web; state.evidence = c.evidence; state.conversation = c.conversation;
    state.browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    return { ok: true };
  },
  async login(c) {
    const page = await fresh(c.viewport);
    await page.goto(`${state.web}/login`, { waitUntil: 'domcontentloaded' });
    await page.getByPlaceholder('邮箱 / 手机号 / 用户名').fill(c.account);
    await page.getByPlaceholder('请输入密码').fill(c.password);
    await page.getByRole('button', { name: /^登\s*录$/ }).click(); // antd spaces two-character CJK labels
    await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 30000 });
    await page.waitForFunction(() => { try { return !!JSON.parse(localStorage.getItem('auth-storage')).state.accessToken; } catch { return false; } });
    return { ok: true, url: page.url().replace(state.web, '') };
  },
  // A session for an account that cannot use the password form (the SSO shadow account): the laboratory's own
  // access token is placed where the app keeps it; the server still decides everything about that account.
  async session(c) {
    const page = await fresh(c.viewport);
    await page.addInitScript(([storage]) => { if (!localStorage.getItem('auth-storage')) localStorage.setItem('auth-storage', storage); }, [JSON.stringify({ state: { user: { id: c.user_id }, permissions: [], accessToken: c.token, refreshToken: null, tokenExpiresAt: Date.now() + 3600000, isAuthenticated: true }, version: 0 })]);
    await page.goto(`${state.web}/chat`, { waitUntil: 'domcontentloaded' });
    return { ok: true };
  },
  async open(c) {
    state.requests = []; state.errors = [];
    await openConversation();
    if (c.screenshot) await shot(c.screenshot);
    return { ok: true, entries: await entries().count(), downloads: await state.page.getByRole('button', { name: '下载成果', exact: true }).count(), errors: state.errors };
  },
  async probe(c) { return { ok: true, ...(await api(c.method, c.path, c.body, c.headers)) }; },
  // Select -> preview -> explicit confirm on message #index; facts include every request the page made to the entry.
  async handoff(c) {
    const page = state.page;
    state.requests = [];
    await entries().nth(c.index).click();
    await page.getByTestId('handoff-selection').waitFor({ timeout: 30000 });
    if (c.screenshots) await shot(`${c.screenshots}-1-select`);
    const before = state.requests.length;
    let selection = null;
    if (c.excerpt) selection = await selectExcerpt(c.excerpt);
    if (c.attachment) await page.getByRole('checkbox', { name: c.attachment }).check();
    const attachmentsOffered = await page.getByRole('checkbox').count();
    if (c.title !== undefined) { const input = page.getByRole('textbox', { name: '资料标题' }); await input.fill(c.title); }
    await page.getByRole('button', { name: '预览将保存的内容', exact: true }).click();
    await page.getByTestId('handoff-preview').waitFor();
    const preview = await page.getByTestId('handoff-preview').textContent();
    const previewFields = await descriptions();
    if (c.screenshots) await shot(`${c.screenshots}-2-preview`);
    const postsBeforeConfirm = state.requests.slice(before).filter(r => r.method === 'POST').length;
    if (c.stop_before_confirm) { await page.keyboard.press('Escape'); return { ok: true, preview, preview_fields: Object.fromEntries(previewFields), posts_before_confirm: postsBeforeConfirm, requests: state.requests }; }
    const confirm = page.getByTestId('handoff-confirm');
    if (c.confirm === 'double') { await confirm.dispatchEvent('click'); await confirm.dispatchEvent('click'); await confirm.click({ force: true }).catch(() => {}); } else await confirm.click();
    const view = await waitStatus(c.expect_status || ['已保存到备课资源库'], c.timeout || 60000);
    if (c.screenshots) await shot(`${c.screenshots}-3-status`);
    return { ok: true, selection, attachments_offered: attachmentsOffered, preview, preview_fields: Object.fromEntries(previewFields), posts_before_confirm: postsBeforeConfirm, view, requests: state.requests, errors: state.errors };
  },
  // The retry cooldown, as the page really shows it: what the countdown says, whether the three outward
  // buttons are there at all and whether they are disabled, and every entry request the page made while
  // we watched. `watch_ms` keeps looking after the countdown has run out, which is where "zero automatic
  // requests" has to be proved rather than assumed.
  async cooldown(c) {
    const page = state.page;
    if (c.reset_requests !== false) state.requests = [];
    const readButton = async testid => {
      const node = page.getByTestId(testid);
      if (!(await node.count())) return { present: false, disabled: null };
      return { present: true, disabled: await node.first().isDisabled() };
    };
    const read = async () => ({
      cooldown: await page.getByTestId('handoff-cooldown').count()
        ? (await page.getByTestId('handoff-cooldown').textContent()) : null,
      status: await page.getByTestId('handoff-status').count()
        ? (await page.getByTestId('handoff-status').textContent()) : null,
      confirm: await readButton('handoff-confirm'),
      retry: await readButton('handoff-retry'),
      refresh: await readButton('handoff-refresh')
    });
    const during = await read();
    if (c.watch_ms) await page.waitForTimeout(c.watch_ms);
    const after = await read();
    if (c.screenshot) await shot(c.screenshot);
    return { ok: true, during, after, requests: state.requests, errors: state.errors };
  },

  async reopen(c) {
    const page = state.page;
    await page.keyboard.press('Escape').catch(() => {});
    await page.reload({ waitUntil: 'domcontentloaded' });
    state.requests = [];
    await page.getByRole('button', { name: '下载成果', exact: true }).first().waitFor({ timeout: 30000 });
    await entries().nth(c.index).click();
    const view = await waitStatus(c.expect_status, c.timeout || 30000);
    if (c.screenshot) await shot(c.screenshot);
    return { ok: true, view, requests: state.requests };
  },
  async refresh(c) {
    state.requests = [];
    const answered = state.page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/refresh'), { timeout: c.timeout || 30000 });
    await state.page.getByTestId('handoff-refresh').click();
    await answered;
    const view = await waitStatus(c.expect_status, c.timeout || 30000);
    if (c.screenshot) await shot(c.screenshot);
    return { ok: true, view, requests: state.requests };
  },
  async retry(c) {
    state.requests = [];
    const answered = state.page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/save'), { timeout: c.timeout || 60000 });
    await state.page.getByTestId('handoff-retry').click();
    await answered;
    const view = await waitStatus(c.expect_status, c.timeout || 60000);
    if (c.screenshot) await shot(c.screenshot);
    return { ok: true, view, requests: state.requests };
  },
  async entry_error(c) {
    const page = state.page;
    state.requests = [];
    await entries().nth(c.index).click();
    const alert = page.getByTestId('handoff-error');
    await alert.waitFor({ timeout: 30000 });
    const message = await alert.locator('.ant-alert-message').textContent();
    if (c.screenshot) await shot(c.screenshot);
    return { ok: true, message, confirm_visible: await page.getByTestId('handoff-confirm').count() > 0, selection_visible: await page.getByTestId('handoff-selection').count() > 0, requests: state.requests };
  },
  async close_modal() { await state.page.keyboard.press('Escape'); return { ok: true }; },
  async facts() { return { ok: true, external: [...new Set(state.external)], errors: state.errors }; },
  async stop() { await state.browser?.close().catch(() => {}); return { ok: true, external: [...new Set(state.external)] }; }
};
(async () => {
  const rl = readline.createInterface({ input: process.stdin });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let command;
    try { command = JSON.parse(line); } catch { answer({ ok: false, code: 'bad_command' }); continue; }
    try {
      const result = await commands[command.command](command);
      answer(result);
      if (command.command === 'stop') break;
    } catch (error) {
      const code = String(error?.message || 'failed').replace(/[^A-Za-z0-9_ ]/g, '').slice(0, 160);
      await shot('failure-' + command.command).catch(() => {});
      answer({ ok: false, code, errors: state.errors, requests: state.requests });
    }
  }
  process.exit(0);
})();

// Command-driven Playwright worker for the P09 isolated acceptance. It clicks the real frontend served
// by Vite against the real practice backend, and opens the isolated preview origin the way a teacher's
// browser would. Credentials arrive on stdin; nothing is written outside the evidence directory.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const readline = require('node:readline');
const path = require('node:path');

const state = { browser: null, context: null, page: null, web: null, evidence: null, requests: [], external: [], errors: [] };
const answer = value => process.stdout.write(JSON.stringify(value) + '\n');

function track(page) {
  page.on('pageerror', error => state.errors.push(String(error.message).slice(0, 200)));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin !== state.web && !url.origin.startsWith('http://127.0.0.1') && !url.origin.includes('preview')) state.external.push(url.origin);
    if (url.pathname.startsWith('/api/p09')) {
      let body = null;
      try { body = request.method() === 'POST' ? request.postDataJSON() : null; } catch { body = null; }
      state.requests.push({ method: request.method(), path: url.pathname, body,
        task_context: request.headers()['x-p09-task-context'] ? 'present' : null,
        idempotency_key: request.headers()['idempotency-key'] || null, status: null });
    }
  });
  page.on('response', response => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith('/api/p09')) return;
    const entry = [...state.requests].reverse().find(item => item.status === null && item.path === url.pathname && item.method === response.request().method());
    if (entry) entry.status = response.status();
  });
}
async function fresh(viewport) {
  if (state.context) await state.context.close().catch(() => {});
  state.context = await state.browser.newContext({ viewport, locale: 'zh-CN', isMobile: viewport.width < 600,
    hasTouch: viewport.width < 600, deviceScaleFactor: viewport.width < 600 ? 2 : 1 });
  state.page = await state.context.newPage();
  track(state.page);
  return state.page;
}
const shot = async name => {
  await state.page.waitForTimeout(350);
  await state.page.screenshot({ path: path.join(state.evidence, `${name}.png`), fullPage: false, animations: 'disabled' });
};
// A synthetic session for an SSO shadow student: password login is refused for those accounts by
// design, so the laboratory places the token where the app keeps it. The server still decides everything.
async function session(page, token, userId) {
  await page.addInitScript(([stored]) => {
    if (!localStorage.getItem('auth-storage')) localStorage.setItem('auth-storage', stored);
  }, [JSON.stringify({ state: { user: { id: userId }, permissions: [], accessToken: token, refreshToken: null,
    tokenExpiresAt: Date.now() + 3600000, isAuthenticated: true }, version: 0 })]);
}
async function openEditor(projectName, taskContext) {
  const page = state.page;
  // The task context travels in the URL fragment, exactly as edu must hand it over: a fragment never
  // reaches a server, so it cannot appear in an access log or a Referer header.
  const url = `${state.web}/html-editor${taskContext ? `#p09_task=${encodeURIComponent(taskContext)}` : ''}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const compact = (page.viewportSize()?.width || 1280) < 992;
  // Phone widths collapse the project sidebar behind its toggle; open it the way a student would.
  if (compact) {
    await page.getByRole('button', { name: '项目' }).first().click();
    await page.waitForTimeout(700);
  }
  const project = page.getByText(projectName, { exact: true }).first();
  await project.waitFor({ state: 'visible', timeout: 20000 });
  try {
    await project.click({ timeout: 10000 });
  } catch {
    // The compact sidebar animates over the editor; a direct click on the settled node is equivalent.
    await project.evaluate(node => node.click());
  }
  await page.waitForTimeout(700);
}
const panel = () => state.page.locator('.html-editor-task-panel');

const commands = {
  async start(command) {
    state.web = command.web; state.evidence = command.evidence;
    state.browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    return { ok: true };
  },
  async open(command) {
    const page = await fresh(command.viewport);
    await session(page, command.token, command.user_id);
    state.requests = []; state.errors = [];
    await openEditor(command.project, command.task_context || null);
    const visible = await panel().count();
    if (command.screenshot) await shot(command.screenshot);
    return { ok: true, panel_visible: visible > 0,
      url: state.page.url().replace(/p09g\.[A-Za-z0-9_.-]+/, 'p09g.<redacted>'),
      url_has_context: state.page.url().includes('p09_task'),
      link_button: await panel().getByTestId('p09-link').count(),
      no_context_hint: await panel().getByTestId('p09-no-context').count(),
      state: visible ? await panel().getByTestId('p09-state').count() : 0,
      errors: state.errors, requests: state.requests };
  },
  // Select the entry page and confirm the association.
  async link(command) {
    const page = state.page;
    state.requests = [];
    await panel().getByTestId('p09-link').click();
    if (command.entry_label) {
      await page.getByTestId('p09-entry-select').click();
      await page.getByTitle(command.entry_label, { exact: true }).first().click();
    }
    if (command.screenshot) await shot(`${command.screenshot}-confirm`);
    const confirm = page.getByRole('button', { name: /关联$|^关\s*联$|确认关联/ }).last();
    if (command.double) { await confirm.dispatchEvent('click'); await confirm.dispatchEvent('click'); }
    else await confirm.click();
    await page.waitForTimeout(1200);
    const tag = await panel().getByTestId('p09-state').count() ? await panel().getByTestId('p09-state').textContent() : null;
    const error = await panel().getByTestId('p09-error').count() ? await panel().getByTestId('p09-error').textContent() : null;
    if (command.screenshot) await shot(command.screenshot);
    return { ok: true, state: tag, error, requests: state.requests };
  },
  async act(command) {
    state.requests = [];
    const target = panel().getByTestId(command.testid);
    const disabled = await target.isDisabled();
    if (disabled && command.expect_disabled) return { ok: true, disabled: true, requests: [] };
    if (command.double) { await target.dispatchEvent('click'); await target.dispatchEvent('click'); }
    else await target.click();
    if (command.confirm) { await state.page.getByTestId(command.confirm).click(); }
    await state.page.waitForTimeout(command.wait || 1200);
    const tag = await panel().getByTestId('p09-state').count() ? await panel().getByTestId('p09-state').textContent() : null;
    const error = await panel().getByTestId('p09-error').count() ? await panel().getByTestId('p09-error').textContent() : null;
    if (command.screenshot) await shot(command.screenshot);
    return { ok: true, disabled, state: tag, error, requests: state.requests };
  },
  async facts() {
    const rows = await panel().locator('.ant-descriptions-item').evaluateAll(nodes => nodes.map(node => [
      node.querySelector('.ant-descriptions-item-label')?.textContent?.trim(),
      node.querySelector('.ant-descriptions-item-content')?.textContent?.trim()]));
    return { ok: true, fields: Object.fromEntries(rows),
      state: await panel().getByTestId('p09-state').count() ? await panel().getByTestId('p09-state').textContent() : null };
  },
  // A teacher's browser: a fresh context (no student session at all) opening the handoff URL.
  async review(command) {
    const context = await state.browser.newContext({ viewport: command.viewport || { width: 1280, height: 900 }, locale: 'zh-CN' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error.message).slice(0, 200)));
    try {
      const response = await page.goto(command.open_url, { waitUntil: 'domcontentloaded' });
      const body = await page.content();
      const headers = response ? response.headers() : {};
      // Can a script in the student page reach this origin's cookies or storage? It must not.
      const probe = await page.evaluate(() => {
        const result = { cookie: null, storage: null, origin: null };
        try { result.cookie = document.cookie; } catch (error) { result.cookie = `blocked:${error.name}`; }
        try { result.storage = String(!!window.localStorage); } catch (error) { result.storage = `blocked:${error.name}`; }
        try { result.origin = window.origin; } catch (error) { result.origin = `blocked:${error.name}`; }
        return result;
      }).catch(error => ({ probe_failed: String(error.message).slice(0, 120) }));
      if (command.screenshot) {
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(state.evidence, `${command.screenshot}.png`), fullPage: false, animations: 'disabled' });
      }
      const cookies = await context.cookies();
      return { ok: true, status: response ? response.status() : null, url: page.url(),
        contains: (command.contains || []).map(text => body.includes(text)),
        csp: headers['content-security-policy'] || null, nosniff: headers['x-content-type-options'] || null,
        probe, errors, cookie_names: cookies.map(cookie => cookie.name),
        cookie_http_only: cookies.every(cookie => cookie.httpOnly) };
    } finally { await context.close(); }
  },
  async externals() { return { ok: true, external: [...new Set(state.external)], errors: state.errors }; },
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
      const code = String(error?.message || 'failed').replace(/[^A-Za-z0-9_ :]/g, '').slice(0, 160);
      try { await shot(`failure-${command.command}`); } catch { /* the failure itself is the evidence */ }
      answer({ ok: false, code, errors: state.errors, requests: state.requests });
    }
  }
  process.exit(0);
})();

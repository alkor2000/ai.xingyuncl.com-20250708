// Command-driven Playwright worker for the P09 isolated acceptance. It clicks the real frontend served
// by Vite against the real practice backend, and opens the isolated preview origin the way a teacher's
// browser would. Credentials arrive on stdin; nothing is written outside the evidence directory.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const readline = require('node:readline');
const path = require('node:path');

const state = { browser: null, context: null, page: null, web: null, evidence: null, requests: [], external: [], errors: [], intercept: null, console: [] };
const answer = value => process.stdout.write(JSON.stringify(value) + '\n');

function track(page) {
  page.on('pageerror', error => state.errors.push(String(error.message).slice(0, 200)));
  // 只记"有没有把凭据写进控制台"，所以每条截短即可；原值绝不回传。
  page.on('console', message => state.console.push(String(message.text()).slice(0, 300)));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin !== state.web && !url.origin.startsWith('http://127.0.0.1') && !url.origin.includes('preview')) state.external.push(url.origin);
    if (url.pathname.startsWith('/api/p09') || /^\/api\/html-editor\/pages/.test(url.pathname)) {
      let body = null;
      try { body = request.method() === 'POST' ? request.postDataJSON() : null; } catch { body = null; }
      state.requests.push({ method: request.method(), path: url.pathname, body,
        task_context: request.headers()['x-p09-task-context'] ? 'present' : null,
        idempotency_key: request.headers()['idempotency-key'] || null, status: null });
    }
  });
  page.on('response', response => {
    const url = new URL(response.url());
    if (!(url.pathname.startsWith('/api/p09') || /^\/api\/html-editor\/pages/.test(url.pathname))) return;
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

// Select a page in the sidebar and press 保存: the authenticated update the platform charges credits
// for, and the one signal P09 accepts as a student save.
async function savePage(pageTitle) {
  const page = state.page;
  const item = page.getByText(pageTitle, { exact: true }).first();
  await item.waitFor({ state: 'visible', timeout: 20000 });
  try { await item.click({ timeout: 8000 }); } catch { await item.evaluate(node => node.click()); }
  await page.waitForTimeout(900);
  const button = page.getByRole('button', { name: /保存/ }).first();
  await button.waitFor({ state: 'visible', timeout: 15000 });
  await button.click();
  await page.waitForTimeout(1800);
}

const commands = {
  async start(command) {
    state.web = command.web; state.evidence = command.evidence;
    state.browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    return { ok: true };
  },
  // 一次学校登录直接进编辑器：没有任何既有会话，从 edu 给的那条 C05 消费链接开始，
  // 作业上下文照 edu 的原样放在片段里。这里要证明的是"点一次就到了带作业的编辑器"，
  // 以及"凭据没有留在地址栏、存储、请求或控制台里"。
  async enterFromLogin(command) {
    const page = await fresh(command.viewport);
    state.requests = []; state.errors = []; state.console = [];
    const url = `${state.web}/auth/sso/consume?handoff=${encodeURIComponent(command.handoff)}` +
      (command.task_context ? `#p09_task=${encodeURIComponent(command.task_context)}` : '');
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    // 学生只做这一次点击（就是从 edu 点进来的那一次），之后完全不动手。
    await page.waitForURL(u => !u.pathname.startsWith('/auth/sso/consume'), { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const landed = new URL(page.url());
    const compact = (page.viewportSize()?.width || 1280) < 992;
    if (landed.pathname === '/html-editor' && command.project) {
      if (compact) {
        await page.getByRole('button', { name: '项目' }).first().click().catch(() => {});
        await page.waitForTimeout(700);
      }
      const project = page.getByText(command.project, { exact: true }).first();
      await project.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
      try { await project.click({ timeout: 8000 }); } catch { await project.evaluate(node => node.click()).catch(() => {}); }
      await page.waitForTimeout(900);
    }
    const leak = await page.evaluate(() => {
      const scan = store => {
        const hits = [];
        try {
          for (let i = 0; i < store.length; i += 1) {
            const key = store.key(i);
            if (String(store.getItem(key) || '').includes('p09g.')) hits.push(key);
          }
        } catch { hits.push('unreadable'); }
        return hits;
      };
      return { local: scan(window.localStorage), session: scan(window.sessionStorage),
        cookie: document.cookie.includes('p09g.'), hash: window.location.hash, search: window.location.search };
    });
    const visible = await panel().count();
    if (command.screenshot) await shot(command.screenshot);
    return { ok: true, landed_path: landed.pathname,
      url_has_context: page.url().includes('p09_task') || page.url().includes('p09g.'),
      url_has_handoff: page.url().includes('handoff'),
      panel_visible: visible > 0,
      link_button: visible ? await panel().getByTestId('p09-link').count() : 0,
      no_context_hint: visible ? await panel().getByTestId('p09-no-context').count() : 0,
      storage_hits: leak.local.concat(leak.session), cookie_leak: leak.cookie,
      residual_hash: leak.hash, residual_search: leak.search,
      console_leak: state.console.filter(line => line.includes('p09g.') || line.includes('p09_task')).length,
      link_posts: state.requests.filter(r => r.method === 'POST' && /\/links$/.test(r.path)).length,
      submit_posts: state.requests.filter(r => r.method === 'POST' && /\/submissions$/.test(r.path)).length,
      context_in_request_url: state.requests.filter(r => String(r.path).includes('p09g.')).length,
      errors: state.errors, requests: state.requests };
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
  async save(command) {
    state.requests = [];
    await savePage(command.page_title);
    const saves = state.requests.filter(item => item.method === 'PUT');
    return { ok: true, saves, errors: state.errors };
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
  // 交作业：点一次按钮，把面板上真正显示给学生的那段文字读回来。成功、拒绝、未知**分三处**取，
  // 因为这正是本轮要守的边界——只有成功框出现才算"已交"，而没有答复时连"没交上"都不能说。
  // settle 是按完之后再等的一段时间：用来证明这段时间里面板没有自己重发。
  async submit(command) {
    state.requests = [];
    const button = panel().getByTestId('p09-submit');
    if (!(await button.count())) return { ok: true, present: false };
    if (command.double) { await button.dispatchEvent('click'); await button.dispatchEvent('click'); }
    else await button.click();
    await state.page.waitForTimeout(command.wait || 1800);
    const read = async testid => (await panel().getByTestId(testid).count()
      ? (await panel().getByTestId(testid).textContent()) : null);
    const count = () => state.requests.filter(item => String(item.path || '').endsWith('/submissions')).length;
    const at_answer = count();
    if (command.settle) await state.page.waitForTimeout(command.settle);
    if (command.screenshot) await shot(command.screenshot);
    return { ok: true, present: true,
      submitted: await read('p09-submitted'), refusal: await read('p09-submit-refusal'),
      unknown: await read('p09-submit-unknown'), error: await read('p09-error'),
      submit_requests: at_answer, submit_requests_after_settle: count(),
      intercept: state.intercept, requests: state.requests };
  },
  // 最后一跳的反例：让提交**真的**打到后端（转达真的发生、对面真的落库），只把回给页面的答复弄丢。
  // mode=drop 整条答复丢掉；mode=truncate 把 200 的正文截在半路；mode=off 撤掉拦截。
  // 截断位置与后端原本的答复都记下来，这样"对面已经记下了"不是推测。
  async interceptSubmit(command) {
    const pattern = '**/api/p09/website-artifacts/links/*/submissions';
    await state.page.unroute(pattern).catch(() => {});
    state.intercept = null;
    if (command.mode === 'off') return { ok: true, mode: 'off' };
    await state.page.route(pattern, async route => {
      const response = await route.fetch();                 // 真请求、真后端、真转达
      const body = await response.text();
      const cut = Math.max(12, Math.floor(body.length / 3));
      state.intercept = { mode: command.mode, upstream_status: response.status(),
        upstream_body: body.slice(0, 300), upstream_bytes: body.length,
        cut_at: command.mode === 'truncate' ? cut : 0 };
      if (command.mode === 'truncate') {
        await route.fulfill({ status: response.status(), contentType: 'application/json', body: body.slice(0, cut) });
      } else {
        await route.abort('connectionaborted');
      }
    });
    return { ok: true, mode: command.mode };
  },
  // 面板上那几处必须看得见的文字与按钮层级，一次读回来。
  async panelShape() {
    const has = async testid => Boolean(await panel().getByTestId(testid).count());
    const unlink = panel().getByTestId('p09-unlink');
    return { ok: true,
      submit_button: await has('p09-submit'), freeze_button: await has('p09-freeze'),
      save_after_link_hint: await has('p09-save-after-link'),
      unknown_box: await has('p09-submit-unknown'),
      unlink_class: await unlink.count() ? await unlink.getAttribute('class') : null,
      freeze_class: await panel().getByTestId('p09-freeze').count()
        ? await panel().getByTestId('p09-freeze').getAttribute('class') : null };
  },
  async facts() {
    const rows = await panel().locator('.ant-descriptions-item').evaluateAll(nodes => nodes.map(node => [
      node.querySelector('.ant-descriptions-item-label')?.textContent?.trim(),
      node.querySelector('.ant-descriptions-item-content')?.textContent?.trim()]));
    return { ok: true, fields: Object.fromEntries(rows),
      state: await panel().getByTestId('p09-state').count() ? await panel().getByTestId('p09-state').textContent() : null };
  },
  // A teacher's browser: a fresh context (no student session at all). The handoff arrives in the URL
  // fragment, so the page itself exchanges it over POST for the cookie — exactly what a teacher's
  // browser does. `user_agent`/`cookies` let the laboratory replay a stolen entry or a stolen cookie in
  // a different browser, and `direct_url` skips the exchange entirely.
  async review(command) {
    // The isolated origin uses a throwaway certificate in the laboratory; a deployment uses a real one.
    const context = await state.browser.newContext({ viewport: command.viewport || { width: 1280, height: 900 },
      locale: 'zh-CN', ignoreHTTPSErrors: true, ...(command.user_agent ? { userAgent: command.user_agent } : {}) });
    if (command.cookies) await context.addCookies(command.cookies);
    const page = await context.newPage();
    const errors = [];
    const seen = [];
    page.on('pageerror', error => errors.push(String(error.message).slice(0, 200)));
    page.on('response', response => seen.push({ url: response.url(), status: response.status(), headers: response.headers() }));
    const documentOf = () => seen.filter(item => item.url === page.url()).pop() || null;
    try {
      await page.goto(command.direct_url || command.open_url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(command.wait || 1600);
      const exchange = seen.filter(item => item.url.includes('/p09/preview/exchange')).pop() || null;
      // A failed exchange never redirects: the bootstrap page stays and reports the refusal.
      const document = documentOf();
      const status = exchange && exchange.status !== 200 ? exchange.status : (document ? document.status : null);
      let body = await page.content();
      let url = page.url();
      // Follow an intra-project link inside the frozen copy: multi-page navigation must work offline.
      let followed = null;
      if (command.follow_link && status === 200) {
        const link = page.getByRole('link', { name: command.follow_link }).first();
        if (await link.count()) {
          await link.click();
          await page.waitForTimeout(900);
          const followedBody = await page.content();
          followed = { url: page.url().split('/').pop(), status: (documentOf() || {}).status ?? null,
            contains: (command.follow_contains || []).map(text => followedBody.includes(text)) };
          await page.goBack().catch(() => {});
          await page.waitForTimeout(500);
          body = await page.content();
          url = page.url();
        } else { followed = { url: null, status: null, contains: [], missing: true }; }
      }
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
      const headers = (document && document.headers) || {};
      return { ok: true, status, exchange_status: exchange ? exchange.status : null,
        url: url.replace(/p09g\.[A-Za-z0-9_.-]+/, 'p09g.<redacted>'),
        contains: (command.contains || []).map(text => body.includes(text)),
        csp: headers['content-security-policy'] || null, nosniff: headers['x-content-type-options'] || null,
        probe, errors, followed,
        resources: seen.filter(item => /\/(assets|uploads)\//.test(item.url))
          .map(item => ({ file: item.url.split('/').pop().slice(0, 48), status: item.status })),
        cookie_names: cookies.map(cookie => cookie.name), cookies,
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

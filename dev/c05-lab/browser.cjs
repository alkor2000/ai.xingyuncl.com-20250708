// Command-driven Playwright worker for the C05 student-entry acceptance. It drives the real frontend
// served by Vite against the real practice backend: the login page (is the entry there at all?) and the
// consume landing page (does a one-time handoff become an ordinary session, and does anything leak into
// the address bar?). Nothing is written outside the evidence directory.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const readline = require('node:readline');
const path = require('node:path');

const state = { browser: null, context: null, page: null, web: null, evidence: null, requests: [], external: [],
  errors: [], navigations: [] };
const answer = value => process.stdout.write(JSON.stringify(value) + '\n');

function track(page) {
  page.on('pageerror', error => state.errors.push(String(error.message).slice(0, 200)));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin !== state.web && !url.origin.startsWith('http://127.0.0.1')) state.external.push(url.origin);
    if (!url.pathname.startsWith('/api/auth/sso')) return;
    let body = null;
    try { body = request.method() === 'POST' ? request.postDataJSON() : null; } catch { body = null; }
    state.requests.push({ method: request.method(), path: url.pathname,
      // What matters is WHERE the ticket travelled, never the ticket itself.
      query_has_handoff: url.searchParams.has('handoff'),
      body_has_handoff: Boolean(body && body.handoff), status: null });
  });
  page.on('response', response => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith('/api/auth/sso')) return;
    const entry = [...state.requests].reverse()
      .find(item => item.status === null && item.path === url.pathname && item.method === response.request().method());
    if (entry) { entry.status = response.status(); entry.cache_control = response.headers()['cache-control'] || null; }
  });
}

async function fresh(viewport) {
  if (state.context) await state.context.close().catch(() => {});
  state.context = await state.browser.newContext({ viewport, locale: 'zh-CN', isMobile: viewport.width < 600,
    hasTouch: viewport.width < 600, deviceScaleFactor: viewport.width < 600 ? 2 : 1 });
  // React Router changes the route through the history API without a document navigation, and a route
  // the app immediately redirects away from would never be observed by sampling. Recording every
  // pushState/replaceState shows the entry this page routed to AND where the app's own rules sent the
  // student next — without changing how either behaves.
  await state.context.addInitScript(() => {
    window.__c05_routes = [];
    for (const name of ['pushState', 'replaceState']) {
      const original = history[name].bind(history);
      history[name] = (...args) => {
        try { window.__c05_routes.push(new URL(String(args[2] ?? location.href), location.href).pathname); }
        catch { /* never break the page */ }
        return original(...args);
      };
    }
  });
  state.page = await state.context.newPage();
  track(state.page);
  state.requests = []; state.errors = []; state.navigations = [];
  return state.page;
}
const shot = async name => {
  await state.page.waitForTimeout(350);
  await state.page.screenshot({ path: path.join(state.evidence, `${name}.png`), fullPage: false, animations: 'disabled' });
};
const scrub = url => url.replace(/handoff=[A-Za-z0-9_-]+/, 'handoff=<redacted>');

const commands = {
  async start(command) {
    state.web = command.web; state.evidence = command.evidence;
    state.browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    return { ok: true };
  },

  // The login page. With the entry switched off the component renders nothing at all, so "is the button
  // there" is the same question as "did the switch change the product surface".
  async login(command) {
    const page = await fresh(command.viewport);
    await page.goto(`${state.web}/login${command.query || ''}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(command.wait || 1500);
    const entry = page.getByRole('link', { name: /学校学生登录/ });
    const count = await entry.count();
    if (command.screenshot) await shot(command.screenshot);
    return { ok: true, entry_visible: count > 0,
      href: count ? await entry.first().getAttribute('href') : null,
      failure_notice: await page.getByText(/学校账号登录未完成/).count() > 0,
      password_form: await page.getByRole('button', { name: /^登\s*录$|登录$/ }).count() > 0,
      errors: state.errors, requests: state.requests };
  },

  // The landing page a student really arrives at, with the ticket in the query string exactly as edu's
  // redirect would place it.
  async consume(command) {
    const page = await fresh(command.viewport);
    await page.goto(`${state.web}/auth/sso/consume?handoff=${command.handoff}`, { waitUntil: 'domcontentloaded' });
    // React Router changes the route without a document navigation, so the path is sampled: the trail
    // shows the entry this page routed to AND wherever the app's own rules sent the student next.
    await page.waitForTimeout(command.wait || 2600);
    state.navigations = await page.evaluate(() => window.__c05_routes || []).catch(() => []);
    const url = page.url();
    const stored = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('auth-storage');
        if (!raw) return null;
        const parsed = JSON.parse(raw).state || {};
        return { authenticated: Boolean(parsed.isAuthenticated), has_access: Boolean(parsed.accessToken),
          has_refresh: Boolean(parsed.refreshToken), username: parsed.user?.username || null };
      } catch (error) { return { error: String(error.name) }; }
    }).catch(() => null);
    if (command.screenshot) await shot(command.screenshot);
    return { ok: true, url: scrub(url), path: new URL(url).pathname + new URL(url).search,
      navigations: [...new Set(state.navigations)],
      url_has_handoff: new URL(url).searchParams.has('handoff'),
      history_length: await page.evaluate(() => window.history.length),
      failed_notice: await page.getByText(/学校账号登录未完成/).count() > 0,
      session: stored, errors: state.errors, requests: state.requests };
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

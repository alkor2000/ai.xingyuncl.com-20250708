// 评阅侧的浏览器 worker：**一次性 handoff 只兑换一次，之后一直用同一个 context/Cookie**。
//
// 这是对上一版的更正。上一版沿用了 P09 的 `review` 命令：它每次都新建 context 并在 finally 关掉，
// 于是"撤资格后再读一次"实际上是拿**已经用掉的 handoff 再兑换一次**，401 来自票据一次性，
// 与资格判定无关；而且那次没有再取任何图片，resources 为空还被判成了"图片已被拒"。
//
// 现在：open_review 兑换一次并保留 context；refetch 用 context.request 按**真实 URL**重取
// （Cookie 与 context 共用），每个 URL 都有实际 HTTP 状态。
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const readline = require('node:readline');
const path = require('node:path');

const state = { browser: null, evidence: null, held: null };
const answer = value => process.stdout.write(JSON.stringify(value) + '\n');
const scrub = url => String(url).replace(/(handoff=|#)[A-Za-z0-9_.\-]+/g, '$1<redacted>');

const commands = {
  async start(command) {
    state.evidence = command.evidence;
    state.browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    return { ok: true };
  },

  // 兑换一次，然后把这个 context 留着。
  async open_review(command) {
    if (state.held) { await state.held.context.close().catch(() => {}); state.held = null; }
    const context = await state.browser.newContext({ viewport: { width: 1280, height: 900 },
      locale: 'zh-CN', ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const seen = [];
    const errors = [];
    page.on('pageerror', error => errors.push(String(error.message).slice(0, 200)));
    page.on('response', response => seen.push({ url: response.url(), status: response.status() }));
    await page.goto(command.open_url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(command.wait || 1800);
    const body = await page.content();
    // 片段去掉之后的最终地址，就是"这一页"本身；重取时用的就是它。
    const settled = page.url().split('#')[0];
    const documentResponse = seen.filter(item => item.url.split('#')[0] === settled).pop() || null;
    const assets = seen.filter(item => /\/(assets|uploads)\//.test(item.url) && item.status < 400);
    if (command.screenshot) {
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(state.evidence, `${command.screenshot}.png`), animations: 'disabled' });
    }
    state.held = { context, page };
    return { ok: true, status: documentResponse ? documentResponse.status : null,
      settled_url: settled, settled_url_redacted: scrub(settled),
      contains: (command.contains || []).map(text => body.includes(text)),
      assets: assets.map(item => ({ url: item.url, file: item.url.split('/').pop().slice(0, 48), status: item.status })),
      cookies: (await context.cookies()).map(cookie => cookie.name), errors };
  },

  // 同一个 context、同一份 Cookie，按真实 URL 重取。不碰 handoff。
  //
  // 用的是这个 context 里的**真实导航**，不是 APIRequestContext：一来 *.localhost 只有浏览器自己解析得了，
  // 二来固定版本页是 sandbox 且没有 allow-same-origin（学生脚本读不到本域），页内 fetch 拿不到 Cookie。
  // 导航会带上这个域的 Cookie，并且给出真实的 HTTP 状态。
  async refetch(command) {
    if (!state.held) return { ok: false, code: 'no_open_review' };
    const page = state.held.page;
    const results = [];
    for (const url of command.urls || []) {
      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        const type = response ? (response.headers()['content-type'] || '') : '';
        const text = type.startsWith('text/') || type.includes('json') ? (await page.content()).slice(0, 600) : null;
        results.push({ url: scrub(url), status: response ? response.status() : null,
          content_type: type.split(';')[0] || null,
          contains: (command.contains || []).map(needle => (text || '').includes(needle)),
          body_head: command.keep_body ? text : null });
      } catch (error) {
        results.push({ url: scrub(url), status: null, error: String(error.message).slice(0, 160) });
      }
    }
    return { ok: true, results };
  },

  async close_review() {
    if (state.held) { await state.held.context.close().catch(() => {}); state.held = null; }
    return { ok: true };
  },

  async stop() { await state.browser?.close().catch(() => {}); return { ok: true }; }
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
      answer({ ok: false, code: String(error?.message || 'failed').replace(/[^A-Za-z0-9_ :]/g, '').slice(0, 160) });
    }
  }
  process.exit(0);
})();

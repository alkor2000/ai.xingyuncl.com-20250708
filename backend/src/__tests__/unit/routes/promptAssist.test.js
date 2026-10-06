/**
 * 「帮我写提示词」这条路由的钱与权限：全部用隔离替身证明，不发一次真实付费请求。
 *
 * 要守住的四件事：先过试点资格（默认没装配就一律拒绝）、能用的模型由平台既有权限说了算、
 * 成功才扣分、失败一分不扣。
 */
const express = require('express');
const http = require('node:http');

/* 这个仓库没有 supertest，路由测试一贯是起一个真实端口自己发请求——照同一套来 */
const listen = app => new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const close = server => new Promise(resolve => server.close(resolve));
function post(port, path, body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path,
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* 非 JSON 就留 null */ }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    req.write(payload); req.end();
  });
}

function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* 同上 */ }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

jest.mock('../../../middleware/authMiddleware', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 7, group_id: 3 }; next(); }
}));
jest.mock('../../../models/AIModel', () => ({ getUserAvailableModels: jest.fn() }));
jest.mock('../../../models/User', () => ({ findById: jest.fn() }));
jest.mock('../../../services/promptAssistService', () => {
  const real = jest.requireActual('../../../services/promptAssistService');
  return { ...real, writeCandidates: jest.fn() };
});

const AIModel = require('../../../models/AIModel');
const User = require('../../../models/User');
const { writeCandidates } = require('../../../services/promptAssistService');

const cheap = { id: 11, name: 'cheap', display_name: '便宜的', credits_per_chat: 3, has_api_key: true };
const pricey = { id: 12, name: 'pricey', display_name: '贵的', credits_per_chat: 30, has_api_key: true };

/* eligible=null 表示"这台部署根本没装配资格提供方" */
function app(eligible = { eligible: true, batch_ref: 'm0-2026-09' }) {
  const server = express();
  server.use(express.json());
  if (eligible !== null) {
    server.locals.imagePilotEligibility = {
      check: typeof eligible === 'function' ? eligible : async () => eligible
    };
  }
  server.use('/api/prompt-assist', require('../../../routes/promptAssist'));
  return server;
}
/* 一个用例里可能连开两个服务（先查能力、再 POST），全都要收掉，否则 jest 不退出 */
const servers = [];
afterEach(async () => { while (servers.length) await close(servers.pop()); });
async function serve(eligible) {
  const s = await listen(eligible === undefined ? app() : app(eligible));
  servers.push(s);
  return s.address().port;
}
async function call(body, eligible) {
  return post(await serve(eligible), '/api/prompt-assist', body);
}
async function capability(eligible) {
  return get(await serve(eligible), '/api/prompt-assist/capability');
}
function user({ credits = true } = {}) {
  const consumeCredits = jest.fn().mockResolvedValue(true);
  User.findById.mockResolvedValue({ id: 7, hasCredits: () => credits, consumeCredits });
  return consumeCredits;
}

beforeEach(() => {
  jest.clearAllMocks();
  AIModel.getUserAvailableModels.mockResolvedValue([pricey, cheap]);
  writeCandidates.mockResolvedValue(['一句好提示词']);
});

describe('POST /api/prompt-assist', () => {
  test('没指定模型时挑最便宜的那个，并按它的价钱扣一次', async () => {
    const consume = user();
    const res = await call({ target: 'image', draft: '校园' });
    expect(res.status).toBe(200);
    expect(res.body.data.model.id).toBe(cheap.id);
    expect(res.body.data.credits_charged).toBe(3);
    expect(consume).toHaveBeenCalledTimes(1);
    expect(consume.mock.calls[0][0]).toBe(3);
  });

  test('模型没写出来：502，而且一分不扣', async () => {
    const consume = user();
    writeCandidates.mockRejectedValue(new Error('upstream down'));
    const res = await call({ target: 'image', draft: '校园' });
    expect(res.status).toBe(502);
    expect(consume).not.toHaveBeenCalled();
  });

  test('积分不够：402，既不调模型也不扣分', async () => {
    const consume = user({ credits: false });
    const res = await call({ target: 'image', draft: '校园' });
    expect(res.status).toBe(402);
    expect(writeCandidates).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  });

  test('点名一个不在自己可用名单里的模型：403，不放宽平台既有权限', async () => {
    const consume = user();
    const res = await call({ target: 'image', model_id: 999 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('model_not_allowed');
    expect(writeCandidates).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  });

  test('一个模型都没有：403，说清楚去找老师，而不是默默失败', async () => {
    user();
    AIModel.getUserAvailableModels.mockResolvedValue([]);
    const res = await call({ target: 'image' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('no_model_available');
  });

  test('目标只认 image / video，别的按名拒绝', async () => {
    user();
    const res = await call({ target: 'music' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_target');
  });

  test('草稿超长按名拒绝，不截断了硬发', async () => {
    user();
    const res = await call({ target: 'image', draft: 'x'.repeat(2000) });
    expect(res.status).toBe(400);
    expect(writeCandidates).not.toHaveBeenCalled();
  });
});

describe('试点资格：能力查询与真正的调用读同一个判定', () => {
  test('没装配资格提供方：能力查询说不可用，POST 直接拒，不查模型不调模型不扣分', async () => {
    const consume = user();
    const cap = await capability(null);
    expect(cap.status).toBe(200);
    expect(cap.body.data.available).toBe(false);
    expect(cap.body.data.reason).toBe('pilot_provider_not_installed');
    expect(cap.body.data.message).toBeTruthy();          // 给人看的一句话，不暴露内部状态

    const res = await call({ target: 'image', draft: '校园' }, null);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('pilot_provider_not_installed');
    expect(AIModel.getUserAvailableModels).not.toHaveBeenCalled();
    expect(writeCandidates).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  });

  test.each([
    ['school_not_in_pilot'], ['not_registered'], ['suspended'],
    ['identity_expired'], ['batch_changed']
  ])('提供方说 %s：403，照它的理由拒，一分不扣', async (reason) => {
    const consume = user();
    const res = await call({ target: 'image', draft: '校园' }, { eligible: false, reason });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(reason);
    expect(writeCandidates).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  });

  test('提供方查不到（抛错）：503 可重试，绝不因为问不到就放行', async () => {
    const consume = user();
    const res = await call({ target: 'image', draft: '校园' }, () => { throw new Error('对端不通'); });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('pilot_provider_unavailable');
    expect(writeCandidates).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  });

  test('放行但没说是按哪一批：按装配没写完拒绝，不猜批次', async () => {
    const res = await call({ target: 'image', draft: '校园' }, { eligible: true });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('pilot_provider_unavailable');
    expect(writeCandidates).not.toHaveBeenCalled();
  });

  test('放行时能力查询回批次，成功的响应也带着批次，事后能说清按哪一批放的', async () => {
    user();
    const cap = await capability();
    expect(cap.body.data).toMatchObject({ available: true, reason: null, batch_ref: 'm0-2026-09' });
    const res = await call({ target: 'image', draft: '校园' });
    expect(res.status).toBe(200);
    expect(res.body.data.batch_ref).toBe('m0-2026-09');
  });
});

describe('提供方答得不成样子、答得太慢、答得太迟', () => {
  test.each([
    ['空对象 {}', {}],
    ['数组 []', []],
    ["eligible 是字符串 'true'", { eligible: 'true', batch_ref: 'batch-a' }],
    ['eligible 是数字 1', { eligible: 1, batch_ref: 'batch-a' }]
  ])('%s：算装配故障（503 可重试），不算学生没资格', async (_name, verdict) => {
    const consume = user();
    const res = await call({ target: 'image', draft: '校园' }, verdict);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('pilot_provider_unavailable');
    expect(writeCandidates).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  });

  test('一直不回答：到点就拒，模型与扣分都没发生；之后它才回 true 也不续跑', async () => {
    const consume = user();
    let settle;
    const late = new Promise(resolve => { settle = resolve; });
    const res = await call({ target: 'image', draft: '校园' }, () => late);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('pilot_provider_unavailable');

    // 迟到的"有资格"：请求早就回完了，不该再去调模型或扣分
    settle({ eligible: true, batch_ref: 'm0-2026-09' });
    await late;
    await new Promise(r => setImmediate(r));
    expect(writeCandidates).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  }, 15000);
});

/**
 * 「帮我写提示词」这条路由的钱与权限：全部用隔离替身证明，不发一次真实付费请求。
 *
 * 要守住的三件事：能用的模型由平台既有权限说了算、成功才扣分、失败一分不扣。
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

function app() {
  const server = express();
  server.use(express.json());
  server.use('/api/prompt-assist', require('../../../routes/promptAssist'));
  return server;
}
let server;
afterEach(async () => { if (server) { await close(server); server = null; } });
async function call(body) {
  server = await listen(app());
  return post(server.address().port, '/api/prompt-assist', body);
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

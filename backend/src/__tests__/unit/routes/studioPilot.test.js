/**
 * 新体验的试点资格查询：一个能力一个答案。
 *
 * 最要紧的一条：**图像放行不等于视频放行**——只放图像的 provider 被问到视频时必须拒。
 * 全部隔离替身，不连库、不调模型、不发真实请求。
 */
const express = require('express');
const http = require('node:http');

const listen = app => new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const close = server => new Promise(resolve => server.close(resolve));
function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* 非 JSON 就留 null */ }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

jest.mock('../../../middleware/authMiddleware', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 7, group_id: 3, role: 'user' }; next(); }
}));

/* 只把图像放出去的 provider——视频从来没被批准过 */
const imageOnly = {
  check: jest.fn(async ({ capability }) => (capability === 'image_studio'
    ? { eligible: true, batch_ref: 'm0-2026-09', capability: 'image_studio' }
    : { eligible: false, reason: 'not_registered' }))
};

const servers = [];
afterEach(async () => { while (servers.length) await close(servers.pop()); });

function app(provider) {
  const server = express();
  server.use(express.json());
  if (provider) server.locals.imagePilotEligibility = provider;
  server.use('/api/studio-pilot', require('../../../routes/studioPilot'));
  return server;
}
async function ask(capability, provider) {
  const s = await listen(app(provider));
  servers.push(s);
  return get(s.address().port, `/api/studio-pilot/capability?capability=${encodeURIComponent(capability)}`);
}

beforeEach(() => jest.clearAllMocks());

describe('GET /api/studio-pilot/capability', () => {
  test('没装配 provider：视频也一样不可用，并且说得出是哪个能力', async () => {
    const res = await ask('video_studio', null);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      capability: 'video_studio', available: false, reason: 'pilot_provider_not_installed'
    });
    expect(res.body.data.message).toBeTruthy();
  });

  test('只放了图像的 provider：问视频照样拒——图像的成员资格不是视频的批准', async () => {
    const image = await ask('image_studio', imageOnly);
    expect(image.body.data.available).toBe(true);

    const video = await ask('video_studio', imageOnly);
    expect(video.body.data.available).toBe(false);
    expect(video.body.data.reason).toBe('not_registered');
    expect(imageOnly.check).toHaveBeenCalledWith(expect.objectContaining({ capability: 'video_studio' }));
  });

  test('provider 回答里写错了能力名：按没资格处理，不把别的能力的放行挪过来', async () => {
    const crossGrant = { check: async () => ({ eligible: true, batch_ref: 'b-1', capability: 'image_studio' }) };
    const res = await ask('video_studio', crossGrant);
    expect(res.body.data.available).toBe(false);
    expect(res.body.data.reason).toBe('not_eligible');
  });

  test('放行视频时带上批次，事后说得清按哪一批放的', async () => {
    const videoOk = { check: async () => ({ eligible: true, batch_ref: 'm0-video-01', capability: 'video_studio' }) };
    const res = await ask('video_studio', videoOk);
    expect(res.body.data).toMatchObject({ available: true, batch_ref: 'm0-video-01' });
  });

  test('能力名不在白名单：400，不去问 provider', async () => {
    const spy = { check: jest.fn() };
    const res = await ask('whatever_studio', spy);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_capability');
    expect(spy.check).not.toHaveBeenCalled();
  });

  test('provider 查不到：503 那套口径照旧，绝不因为问不到就放行', async () => {
    const broken = { check: async () => { throw new Error('对端不通'); } };
    const res = await ask('video_studio', broken);
    expect(res.body.data).toMatchObject({ available: false, reason: 'pilot_provider_unavailable', retryable: true });
  });
});

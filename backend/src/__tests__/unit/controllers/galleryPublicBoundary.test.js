// Executes real controllers/models in a VM with a closed dependency allowlist.
// No application bootstrap, network, DB driver, credentials or real media.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const src = path.resolve(__dirname, '../../..');
const logger = { info() {}, warn() {}, error() {}, debug() {} };
function load(file, dependencies = {}) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(src, file), 'utf8'), {
    module, exports: module.exports,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    }
  }, { filename: file, timeout: 1000 });
  return module.exports;
}
const response = load('utils/response.js');
const privateFields = ['first_frame_image', 'last_frame_image', 'reference_images', 'raw_response', 'task_id', 'email', 'future_private_field'];
function fixture(kind, overrides = {}) {
  return {
    id: 11, user_id: 1, status: kind === 'Image' ? 'success' : 'succeeded',
    is_public: 0, is_favorite: 0, prompt: 'synthetic classroom example',
    local_path: `/synthetic/result.${kind === 'Image' ? 'png' : 'mp4'}`,
    thumbnail_path: '/synthetic/thumb.png', ratio: '9:16', resolution: '720p', duration: 5,
    size: '1024x1024', model_name: 'Synthetic model', provider: 'volcano', username: 'Synthetic author',
    created_at: '2026-11-06T00:00:00Z', credits_consumed: 2,
    error_message: 'synthetic failure', ...Object.fromEntries(privateFields.map(key => [key, `private:${key}`])),
    ...overrides
  };
}
function setup(kind, overrides) {
  const state = { row: fixture(kind, overrides), queries: [], views: 0, publishes: [], projected: [] };
  const safety = {
    get: async () => ({ state: 'pass', gallery_state: 'approved', file_key: 'safe', gallery_reviewer_id: 9, reviewer_id: 9 }),
    project: async value => { state.projected.push(value); return value; },
    publish: async (id, userId) => { state.publishes.push([id, userId]); return { is_public: 0, gallery_status: 'pending' }; }
  };
  // Storage reads remain local; the controller must delegate publication to the teacher-review service.
  const db = { async query(sql, params = []) {
    state.queries.push({ sql, params: [...params] });
    if (/UPDATE .*view_count/s.test(sql)) { state.views++; return { rows: { affectedRows: 1 } }; }
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ total: state.row ? 1 : 0 }] };
    if (/SELECT/.test(sql)) return { rows: state.row ? [{ ...state.row }] : [] };
    throw new Error(`Unexpected query: ${sql}`);
  }};
  const Model = load(`models/${kind}Generation.js`, { '../database/connection': db, '../utils/logger': logger });
  const deps = {
    [`../services/${kind.toLowerCase()}SafetyService`]: safety,
    [`../models/${kind}Generation`]: Model, [`../models/${kind}Model`]: {},
    [`../services/${kind.toLowerCase()}Service`]: {}, '../utils/response': response, '../utils/logger': logger
  };
  if (kind === 'Image') Object.assign(deps, { '../services/midjourneyService': {}, '../services/ossService': {}, crypto: {} });
  const Controller = load(`controllers/${kind.toLowerCase()}Controller.js`, deps)[`${kind}Controller`];
  async function call(method, userId = 1, role = 'user') {
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await Controller[method]({ params: { id: 11 }, user: { id: userId, role } }, res);
    return res;
  }
  return { state, Model, call, safety };
}
for (const kind of ['Image', 'Video']) {
  describe(`${kind} public boundary`, () => {
    test('owner requests teacher review and never writes public directly', async () => {
      const h = setup(kind); const res = await h.call('togglePublic');
      expect(res.code).toBe(200); expect(h.state.row.is_public).toBe(0);
      expect(h.state.publishes).toEqual([[11, 1]]);
      expect(res.body.data).toEqual({ is_public: 0, gallery_status: 'pending' });
      expect(h.state.queries.some(q => /SET is_public/i.test(q.sql))).toBe(false);
    });
    for (const status of ['failed', 'pending', 'running', 'generating', 'submitted', 'queued', 'unknown']) {
      test(`public ${status} detail denied to nonowner; owner retains complete detail`, async () => {
        const h = setup(kind, { status, is_public: 1 });
        expect((await h.call('getGeneration', 2)).code).toBe(403); expect(h.state.views).toBe(0);
        const owner = await h.call('getGeneration'); expect(owner.code).toBe(200);
        expect(owner.body.data).toEqual(h.state.row); expect(h.state.views).toBe(0);
      });
    }
    test('private detail and nonowner/superadmin mutation denied', async () => {
      const h = setup(kind);
      expect((await h.call('getGeneration', 2)).code).toBe(403);
      for (const role of ['user', 'super_admin']) expect((await h.call('togglePublic', 2, role)).code).toBe(403);
      expect(h.state.publishes).toHaveLength(0); expect(h.state.views).toBe(0);
    });
    test('public successful detail strips private/new fields and preserves output', async () => {
      const h = setup(kind, { is_public: 1 }); const res = await h.call('getGeneration', 2);
      expect(res.code).toBe(200); expect(h.state.views).toBe(1);
      expect(res.body.data.local_path).toBe(h.state.row.local_path);
      expect(res.body.data.status).toBe(h.state.row.status);
      for (const key of [...privateFields, 'error_message']) expect(res.body.data).not.toHaveProperty(key);
      expect((await h.call('getGeneration')).body.data).toEqual(h.state.row);
    });
    test('missing detail/publication remains 404', async () => {
      const h = setup(kind); h.state.row = null;
      expect((await h.call('getGeneration')).code).toBe(404);
      expect((await h.call('togglePublic')).code).toBe(404);
    });
    test('review service conflict is returned without direct public write', async () => {
      const h = setup(kind);
      h.safety.publish = async () => { throw Object.assign(new Error('review changed'), { statusCode: 409 }); };
      expect((await h.call('togglePublic')).code).toBe(409);
      expect(h.state.row.is_public).toBe(0);
    });
    test('review service failure is not reported as successful publication', async () => {
      const h = setup(kind); h.safety.publish = async () => { throw new Error('synthetic DB error'); };
      expect((await h.call('togglePublic')).code).toBe(500);
      expect(h.state.row.is_public).toBe(0);
    });

  });
}
test('video gallery uses SQL and response allowlists, keeps filters/pagination and username fallback', async () => {
  const h = setup('Video', { is_public: 1, username: '' });
  const gallery = await h.Model.getPublicGallery({ page: 2, limit: 5, model_id: 7, keyword: '50%_' });
  expect(gallery.pagination).toEqual({ page: 2, limit: 5, total: 1, totalPages: 1 });
  expect(gallery.data[0].username).toBe('Anonymous');
  for (const field of privateFields) expect(gallery.data[0]).not.toHaveProperty(field);
  const query = h.state.queries.find(q => q.sql.includes('ORDER BY'));
  expect(query.sql).not.toMatch(/vg\.\*/);
  for (const field of privateFields) expect(query.sql).not.toContain(`vg.${field}`);
  expect(query.sql).toContain('vg.is_public = 1'); expect(query.sql).toContain('vg.status = "succeeded"');
  expect(query.sql).toContain('LIMIT 5 OFFSET 5'); expect(query.params).toEqual([7, ...Array(4).fill('%50\\%\\_%')]);
  expect(Object.keys(gallery.data[0]).sort()).toEqual(Object.keys(h.Model.toPublic(h.state.row)).sort());
});

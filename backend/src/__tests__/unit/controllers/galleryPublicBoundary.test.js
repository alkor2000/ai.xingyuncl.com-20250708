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
  const state = { row: fixture(kind, overrides), queries: [], writes: 0, views: 0, beforeUpdate: null };
  // This adapter evaluates the WHERE predicates emitted by the actual model.
  // It does not assume the desired ownership/publication/status policy.
  const db = { async query(sql, params = []) {
    state.queries.push({ sql, params: [...params] });
    if (/SET is_public = \?/i.test(sql)) {
      if (state.beforeUpdate) { const hook = state.beforeUpdate; state.beforeUpdate = null; hook(state); }
      const where = sql.split(/\bWHERE\b/i)[1];
      let index = 1;
      const matches = where.trim().split(/\s+AND\s+/i).every(clause => {
        const match = clause.trim().match(/^(\w+) = \?$/);
        if (!match) throw new Error(`Unsupported test predicate: ${clause}`);
        return state.row && state.row[match[1]] === params[index++];
      });
      if (matches) { state.row.is_public = params[0]; state.writes++; }
      return { rows: { affectedRows: matches ? 1 : 0 } };
    }
    if (/UPDATE .*view_count/s.test(sql)) { state.views++; return { rows: { affectedRows: 1 } }; }
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ total: state.row ? 1 : 0 }] };
    if (/SELECT/.test(sql)) return { rows: state.row ? [{ ...state.row }] : [] };
    throw new Error(`Unexpected query: ${sql}`);
  }};
  const Model = load(`models/${kind}Generation.js`, { '../database/connection': db, '../utils/logger': logger });
  const deps = {
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
  return { state, Model, call };
}
for (const kind of ['Image', 'Video']) {
  describe(`${kind} public boundary`, () => {
    test('owner may publish a completed work; existing response contract is preserved', async () => {
      const h = setup(kind); const res = await h.call('togglePublic');
      expect(res.code).toBe(200); expect(h.state.row.is_public).toBe(1);
      expect(res.body.data).toEqual(kind === 'Image' ? null : { is_public: true });
    });
    for (const status of ['failed', 'pending', 'running', 'generating', 'submitted', 'queued', 'unknown']) {
      test(`reject publishing ${status}, allow withdrawing ${status}`, async () => {
        const h = setup(kind, { status });
        expect((await h.call('togglePublic')).code).toBe(400); expect(h.state.writes).toBe(0);
        h.state.row.is_public = 1;
        expect((await h.call('togglePublic')).code).toBe(200); expect(h.state.row.is_public).toBe(0);
      });
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
      expect(h.state.writes).toBe(0); expect(h.state.views).toBe(0);
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
    test('status failing after initial read blocks the publication write', async () => {
      const h = setup(kind); h.state.beforeUpdate = ({ row }) => { row.status = 'failed'; };
      expect((await h.call('togglePublic')).code).toBe(409); expect(h.state.row.is_public).toBe(0);
    });
    test('owner changing after read blocks write', async () => {
      const h = setup(kind); h.state.beforeUpdate = ({ row }) => { row.user_id = 2; };
      expect((await h.call('togglePublic')).code).toBe(409); expect(h.state.writes).toBe(0);
    });
    test('withdrawal still succeeds when generation status changes after read', async () => {
      const h = setup(kind, { is_public: 1 }); h.state.beforeUpdate = ({ row }) => { row.status = 'failed'; };
      expect((await h.call('togglePublic')).code).toBe(200); expect(h.state.row.is_public).toBe(0);
      expect(h.state.queries.find(q => /SET is_public/.test(q.sql)).sql).not.toMatch(/AND status/);
    });
    for (const initial of [0, 1]) {
      test(`overlapping toggles from ${initial} have one success and one conflict`, async () => {
        const h = setup(kind, { is_public: initial });
        const results = await Promise.all([h.call('togglePublic'), h.call('togglePublic')]);
        expect(results.map(r => r.code).sort()).toEqual([200, 409]);
        expect(h.state.writes).toBe(1); expect(h.state.row.is_public).toBe(initial ? 0 : 1);
      });
    }
    test('public state changing after read does not overwrite the competing write', async () => {
      const h = setup(kind, { is_public: 1 });
      h.state.beforeUpdate = ({ row }) => { row.is_public = 0; };
      expect((await h.call('togglePublic')).code).toBe(409); expect(h.state.row.is_public).toBe(0);
      expect(h.state.writes).toBe(0);
    });
    test('DB failure returns 500 without reporting success', async () => {
      const h = setup(kind); h.state.beforeUpdate = () => { throw new Error('synthetic DB error'); };
      expect((await h.call('togglePublic')).code).toBe(500); expect(h.state.writes).toBe(0);
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

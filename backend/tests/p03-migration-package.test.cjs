'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const pkg = require('../scripts/p03-migration-package.cjs');
const repo = path.resolve(__dirname, '../..');
const code = expected => error => error.code === expected;

test('default is reproducible dry-run; no staging directory, migration promotion or switch change', () => {
  const before = fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('p03-migration-package-')).sort();
  const env = process.env.P03_HANDOFF_ENABLED;
  const first = pkg.assemble(), second = pkg.assemble();
  assert.deepEqual(first, second);
  assert.equal(first.mode, 'dry-run');
  assert.equal(first.production_authorized, false);
  assert.equal(first.runtime_enabled, false);
  assert.equal(first.target_instance, 'pku-ai-platform-prod');
  assert.deepEqual(fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('p03-migration-package-')).sort(), before);
  assert.equal(fs.existsSync(path.join(repo, pkg.MIGRATION)), false);
  assert.equal(process.env.P03_HANDOFF_ENABLED, env);
});

test('real release layout loads; original and assembled candidate replay identical SCHEMA and down order', async t => {
  const one = pkg.assemble({ writeStaging: true }), two = pkg.assemble({ writeStaging: true });
  t.after(() => { for (const p of [one, two]) fs.rmSync(p.staging_directory, { recursive: true, force: true }); });
  assert.equal(one.manifest_sha256, two.manifest_sha256);
  for (const file of [...Object.keys(one.output_sha256), 'manifest.json']) {
    assert.deepEqual(fs.readFileSync(path.join(one.staging_directory, file)), fs.readFileSync(path.join(two.staging_directory, file)));
  }
  const original = require(path.join(repo, pkg.CANDIDATE));
  const assembled = require(path.join(one.staging_directory, pkg.MIGRATION));
  const store = require(path.join(one.staging_directory, pkg.STORE));
  assert.deepEqual(store.SCHEMA, require('../src/services/artifactHandoff/mysqlStore').SCHEMA);
  for (const method of ['up', 'down']) {
    const runs = [];
    for (const migration of [original, assembled]) {
      const statements = [];
      await migration[method]({ raw: async sql => { statements.push(sql); } });
      runs.push(statements);
    }
    assert.deepEqual(runs[0], runs[1]);
    if (method === 'up') assert.deepEqual(runs[0], store.SCHEMA);
    else assert.deepEqual(runs[0], ['keys', 'snapshots', 'operations', 'owners'].map(k => `DROP TABLE IF EXISTS \`${store.TABLES[k]}\``));
  }
});

test('wrong input commit, target and source layout fail before output', () => {
  assert.throws(() => pkg.assemble({ inputCommit: 'HEAD' }), code('p03_package_input_commit_mismatch'));
  assert.throws(() => pkg.assemble({ targetInstance: 'xingyun-ai-platform-prod' }), code('p03_package_target_not_allowed'));
  assert.throws(() => pkg.assemble({ repo: path.join(repo, 'backend') }), code('p03_package_source_layout_invalid'));
  assert.throws(() => pkg.verifyStaging(path.join(repo, 'storage/private/missing-stage')), code('p03_package_staging_layout_invalid'));
});

test('changed source or lock and already-promoted candidate are rejected in an owned sparse clone', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p03-package-preimage-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fixture = path.join(dir, 'source');
  const git = args => execFileSync('git', args, { stdio: 'ignore' });
  git(['clone', '--shared', '--no-checkout', '--quiet', repo, fixture]);
  git(['-C', fixture, 'checkout', pkg.INPUT_COMMIT, '--', ...Object.keys(pkg.INPUTS)]);
  for (const file of [pkg.CANDIDATE, pkg.STORE, 'backend/package-lock.json']) {
    const target = path.join(fixture, file), original = fs.readFileSync(target);
    fs.appendFileSync(target, '\n');
    assert.throws(() => pkg.assemble({ repo: fixture, writeStaging: true }), code('p03_package_preimage_mismatch'));
    fs.writeFileSync(target, original);
  }
  fs.mkdirSync(path.dirname(path.join(fixture, pkg.MIGRATION)), { recursive: true });
  fs.copyFileSync(path.join(fixture, pkg.CANDIDATE), path.join(fixture, pkg.MIGRATION));
  assert.throws(() => pkg.assemble({ repo: fixture }), code('p03_package_already_promoted'));
});

test('staging verification rejects changed migration, wrong layout, injected file, and symlink', t => {
  const result = pkg.assemble({ writeStaging: true }), dir = result.staging_directory;
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, pkg.MIGRATION), original = fs.readFileSync(file);
  fs.appendFileSync(file, '\n');
  assert.throws(() => pkg.verifyStaging(dir), code('p03_package_staging_preimage_mismatch'));
  fs.writeFileSync(file, original);
  fs.renameSync(file, file + '.wrong');
  assert.throws(() => pkg.verifyStaging(dir), code('p03_package_staging_layout_invalid'));
  fs.renameSync(file + '.wrong', file);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  assert.throws(() => pkg.verifyStaging(dir), code('p03_package_staging_layout_invalid'));
  fs.unlinkSync(path.join(dir, 'package.json'));
  fs.unlinkSync(file); fs.symlinkSync(path.join(repo, pkg.CANDIDATE), file);
  assert.throws(() => pkg.verifyStaging(dir), code('p03_package_staging_layout_invalid'));
});

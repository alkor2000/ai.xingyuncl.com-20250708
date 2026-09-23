#!/usr/bin/env node
'use strict';
// Offline assembly only. No dotenv, database connection, DDL, credential or runtime enablement.
// Default: validate the fixed source and print the reproducible plan without writing anything.
// --write-staging creates a NEW OS temporary directory; it cannot promote a repository migration.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const INPUT_COMMIT = '77a9ccfe2cab8cc7911e6637c249ee6ff192b92f';
const TARGET = 'pku-ai-platform-prod';
const ROOT = path.resolve(__dirname, '../..');
const CANDIDATE = 'backend/migrations-candidates/p03/20260921_001_p03_handoff_ledger.js';
const MIGRATION = 'backend/migrations/20260921_001_p03_handoff_ledger.js';
const STORE = 'backend/src/services/artifactHandoff/mysqlStore.js';
const SOURCE = 'backend/src/services/artifactHandoff/source.js';
const INPUTS = Object.freeze({
  [CANDIDATE]: '2720c8ac9893cc8ba9e48ffe31905b4cfb417d6bfee29b91795937d25b6778eb',
  [STORE]: '065beb58ac682af4e755da8ff5a2e2676c1e0a3b1bd1c9b425a02b54e49b80c3',
  [SOURCE]: '625a8702ddb1bdcc92266962d347b722c6795fe87846e6e187de128d4865e0d7',
  'backend/package.json': 'ba1f66b4a92216e12848532217f6e178ef8674cdacc1abf6a5cfafad0ad7117c',
  'backend/package-lock.json': '6b5c6fbecc22f6bc591cc3aa1c07fd48a8b619822851290ea091c87b6c878b3c',
  'frontend/package.json': '91eb5a2a47be0b511738019841b6a4507dd934d5930448154cdbaaaad07e952d',
  'frontend/package-lock.json': '89bbc4e643cff24c6e50eeca8226617b7dc0945c2a7cb53474e668c68aed7d67'
});
const sha = data => createHash('sha256').update(data).digest('hex');
function fail(code) { throw Object.assign(new Error(code), { code }); }
function regularFile(root, relative, code) {
  try {
    let current = root;
    const parts = relative.split('/');
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i]);
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !(i === parts.length - 1 ? stat.isFile() : stat.isDirectory())) fail(code);
    }
    return fs.readFileSync(current);
  } catch { fail(code); }
}
function plan({ repo = ROOT, inputCommit = INPUT_COMMIT, targetInstance = TARGET } = {}) {
  if (inputCommit !== INPUT_COMMIT) fail('p03_package_input_commit_mismatch');
  if (targetInstance !== TARGET) fail('p03_package_target_not_allowed');
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (fs.realpathSync(top) !== fs.realpathSync(repo)) fail('p03_package_source_layout_invalid');
  } catch { fail('p03_package_source_layout_invalid'); }
  const inputs = {};
  for (const [name, expected] of Object.entries(INPUTS)) {
    let committed;
    try { committed = execFileSync('git', ['show', `${inputCommit}:${name}`], { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch { fail('p03_package_input_commit_unavailable'); }
    const current = regularFile(repo, name, 'p03_package_source_layout_invalid');
    if (sha(committed) !== expected || sha(current) !== expected) fail('p03_package_preimage_mismatch');
    inputs[name] = committed;
  }
  if (fs.existsSync(path.join(repo, MIGRATION))) fail('p03_package_already_promoted');
  const before = "require('../../src/services/artifactHandoff/mysqlStore')";
  const after = "require('../src/services/artifactHandoff/mysqlStore')";
  const original = inputs[CANDIDATE].toString('utf8');
  if (original.split(before).length !== 2) fail('p03_package_preimage_mismatch');
  const files = {
    [MIGRATION]: Buffer.from('// Generated for temporary release-layout rehearsal only. Not a production promotion.\n' + original.replace(before, after)),
    [STORE]: inputs[STORE], [SOURCE]: inputs[SOURCE]
  };
  const manifest = {
    schema_version: 1, kind: 'p03-migration-staging', input_commit: inputCommit,
    target_instance: targetInstance, production_authorized: false, runtime_enabled: false,
    input_sha256: INPUTS,
    output_sha256: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, sha(bytes)])),
    transform: { file: MIGRATION, from: before, to: after },
    layout: 'backend/migrations + backend/src/services/artifactHandoff; only these three files; no package.json or automatic runner'
  };
  return { manifest, files };
}
function verifyStaging(directory, options) {
  const expected = plan(options);
  const root = path.resolve(directory);
  try { if (root !== fs.realpathSync(root) || !fs.lstatSync(root).isDirectory()) fail('p03_package_staging_layout_invalid'); }
  catch { fail('p03_package_staging_layout_invalid'); }
  const expectedNames = [...Object.keys(expected.files), 'manifest.json'].sort();
  const actual = [];
  function walk(folder, prefix = '') {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isSymbolicLink()) fail('p03_package_staging_layout_invalid');
      if (entry.isDirectory()) walk(path.join(folder, entry.name), name + '/');
      else if (entry.isFile()) actual.push(name);
      else fail('p03_package_staging_layout_invalid');
    }
  }
  try { walk(root); } catch (error) { if (error.code?.startsWith('p03_')) throw error; fail('p03_package_staging_layout_invalid'); }
  if (JSON.stringify(actual.sort()) !== JSON.stringify(expectedNames)) fail('p03_package_staging_layout_invalid');
  const manifestBytes = Buffer.from(JSON.stringify(expected.manifest, null, 2) + '\n');
  if (!regularFile(root, 'manifest.json', 'p03_package_staging_layout_invalid').equals(manifestBytes)) fail('p03_package_staging_preimage_mismatch');
  for (const [name, bytes] of Object.entries(expected.files)) {
    if (!regularFile(root, name, 'p03_package_staging_layout_invalid').equals(bytes)) fail('p03_package_staging_preimage_mismatch');
  }
  return { verified: true, manifest_sha256: sha(manifestBytes), ...expected.manifest };
}
function assemble({ writeStaging = false, ...options } = {}) {
  const { manifest, files } = plan(options);
  if (!writeStaging) return { mode: 'dry-run', ...manifest };
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'p03-migration-package-'));
  try {
    fs.chmodSync(stage, 0o700);
    for (const [name, bytes] of Object.entries(files)) {
      const dest = path.join(stage, name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, bytes, { flag: 'wx', mode: 0o600 });
    }
    fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return { mode: 'staging-only', staging_directory: stage, ...verifyStaging(stage, options) };
  } catch (error) { fs.rmSync(stage, { recursive: true, force: true }); throw error; }
}
function main(args) {
  const options = {};
  let verify;
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (seen.has(key)) fail('p03_package_invalid_arguments');
    seen.add(key);
    if (key === '--write-staging') options.writeStaging = true;
    else if (['--source-commit', '--target-instance', '--verify-staging'].includes(key)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) fail('p03_package_invalid_arguments');
      if (key === '--verify-staging') verify = value;
      else options[key === '--source-commit' ? 'inputCommit' : 'targetInstance'] = value;
    } else fail('p03_package_invalid_arguments');
  }
  if (verify && options.writeStaging) fail('p03_package_invalid_arguments');
  return verify ? verifyStaging(verify, options) : assemble(options);
}
if (require.main === module) {
  try { console.log(JSON.stringify(main(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(JSON.stringify({ ready: false, code: error.code?.startsWith('p03_') ? error.code : 'p03_package_unavailable' })); process.exitCode = 1; }
}
module.exports = { assemble, plan, verifyStaging, INPUT_COMMIT, INPUTS, CANDIDATE, MIGRATION, STORE, SOURCE, TARGET };

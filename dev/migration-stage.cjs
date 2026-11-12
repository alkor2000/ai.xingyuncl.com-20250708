'use strict';
// Native release staging only. Never approves publication or rolls back MySQL DDL.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const plans = require('./gallery-migration-plan.json');
const names = plans.profiles['teacher-review'];
const paths = names.map(n => `backend/migrations/${n}`);
function selectedNames(profile = 'teacher-review') {
  assert(['teacher-review', 'gallery-review'].includes(profile), 'unknown_migration_profile');
  return plans.profiles[profile];
}
function selectedPaths(profile) { return selectedNames(profile).map(n => `backend/migrations/${n}`); }
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
function assert(ok, reason) { if (!ok) throw new Error(reason); }
function git(repo, args) { return cp.execFileSync('git', ['-C', repo, ...args], {stdio: ['ignore', 'pipe', 'pipe']}); }
function syncDir(dir) { const fd = fs.openSync(dir, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function exclusive(dir, name, value) {
  const fd = fs.openSync(path.join(dir, name), 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  syncDir(dir);
}
function identity(repo, target, dir) {
  assert(/^[0-9a-f]{40}$/.test(target), 'invalid_target');
  assert(fs.realpathSync(repo) === repo, 'repository_symlink');
  assert(fs.realpathSync(dir) === dir, 'stage_symlink');
  const s = fs.statSync(dir);
  assert(s.isDirectory() && (s.mode & 0o777) === 0o700 && s.uid === process.getuid(), 'stage_not_private');
  assert(path.basename(dir) === `migration-${target}`, 'stage_target_mismatch');
}
function prepare(repo, target, dir, expectedParent, profile = 'teacher-review') {
  const paths = selectedPaths(profile);
  identity(repo, target, dir);
  assert(git(repo, ['status', '--porcelain']).toString() === '', 'dirty_preimage');
  const parent = git(repo, ['rev-parse', 'HEAD']).toString().trim();
  if (expectedParent !== undefined) assert(parent === expectedParent, 'preview_parent_changed');
  git(repo, ['merge-base', '--is-ancestor', parent, target]);
  const diff = git(repo, ['diff', '--no-renames', '--name-status', parent, target, '--', 'backend/migrations']).toString().trim().split('\n').sort();
  assert(JSON.stringify(diff) === JSON.stringify(paths.map(p => `A\t${p}`).sort()), 'migration_delta_not_exact_profile_additions');
  assert(fs.realpathSync(path.join(repo, 'backend/migrations')) === path.join(repo, 'backend/migrations'), 'migration_directory_symlink');
  const sources = {};
  for (const p of paths) {
    assert(!fs.existsSync(path.join(repo, p)), 'migration_already_present');
    sources[p] = hash(git(repo, ['show', `${target}:${p}`]));
    assert(sources[p] === plans.migrations.find(m => m.name === path.basename(p)).sha256, 'unreviewed_migration_bytes');
  }
  const record = {version: 2, profile, repo, parent, target, sources};
  exclusive(dir, 'INTENT.json', record);
  // HEAD and running application stay at parent; only these additions enter the index.
  git(repo, ['checkout', target, '--', ...paths]);
  verifyFiles(repo, record);
  exclusive(dir, 'PREPARED.json', record);
  return record;
}
function verifyFiles(repo, record) {
  const paths = selectedPaths(record.profile);
  assert(git(repo, ['rev-parse', 'HEAD']).toString().trim() === record.parent, 'runtime_parent_changed');
  const status = git(repo, ['status', '--porcelain', '--untracked-files=all']).toString().trimEnd().split('\n').sort();
  assert(JSON.stringify(status) === JSON.stringify(paths.map(p => `A  ${p}`).sort()), 'staged_tree_changed');
  for (const p of paths) {
    const s = fs.lstatSync(path.join(repo, p));
    assert(s.isFile() && !s.isSymbolicLink(), 'migration_not_regular');
    assert(hash(fs.readFileSync(path.join(repo, p))) === record.sources[p], 'migration_worktree_changed');
    assert(hash(git(repo, ['show', `:${p}`])) === record.sources[p], 'migration_index_changed');
    assert(hash(git(repo, ['show', `${record.target}:${p}`])) === record.sources[p], 'migration_target_changed');
  }
}
function verify(repo, target, dir, completed = false) {
  identity(repo, target, dir);
  const record = JSON.parse(fs.readFileSync(path.join(dir, 'PREPARED.json'), 'utf8'));
  const paths = selectedPaths(record.profile);
  assert(record.version === 2, 'old_receipt_requires_original_tool');
  assert(record.repo === repo && record.target === target, 'receipt_identity_changed');
  assert(JSON.stringify(Object.keys(record.sources).sort()) === JSON.stringify([...paths].sort()), 'receipt_scope_changed');
  verifyFiles(repo, record);
  assert(!fs.existsSync(path.join(dir, 'FAILED.json')), 'prior_migration_failed');
  if (completed) {
    assert(fs.statSync(path.join(dir, 'COMPLETE')).isDirectory(), 'missing_durable_complete_marker');
    const done = JSON.parse(fs.readFileSync(path.join(dir, 'MIGRATED.json'), 'utf8'));
    assert(JSON.stringify(done) === JSON.stringify(record), 'migration_receipt_changed');
  }
  return record;
}
async function pendingNames(repo) {
  const old = process.cwd();
  process.chdir(path.join(repo, 'backend'));
  let knex;
  try {
    const configs = require(path.join(repo, 'backend/knexfile.js'));
    const config = configs[process.env.NODE_ENV || 'development'];
    assert(config, 'unknown_knex_environment');
    knex = require(path.join(repo, 'backend/node_modules/knex'))(config);
    const [, pending] = await knex.migrate.list();
    return pending.map(p => typeof p === 'string' ? p : p.file).sort();
  } finally { if (knex) await knex.destroy(); process.chdir(old); }
}
async function galleryPrerequisites(repo, record, probe = false) {
  if (record.profile !== 'gallery-review') return;
  const config = require(path.join(repo, 'backend/knexfile.js'))[process.env.NODE_ENV || 'development'];
  const knex = require(path.join(repo, 'backend/node_modules/knex'))(config);
  try {
    const check = require('./gallery-migrate.cjs');await check.supported(knex);
    const [rows] = await knex.raw("SELECT CONSTRAINT_NAME,ENFORCED FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME IN ('gallery_requires_teacher','video_gallery_requires_teacher')");
    assert(rows.length === 2 && rows.every(r => r.ENFORCED === 'YES'), 'prior_teacher_checks_missing');
    const prior = await knex('knex_migrations').whereIn('name', plans.profiles['teacher-review']).select('name');
    assert(prior.length === 3, 'prior_teacher_migrations_missing');
    if (probe) await check.checkEnforcement(knex);
  } finally { await knex.destroy(); }
}
async function verifyGalleryDatabase(repo, record) {
  if (record.profile !== 'gallery-review') return;
  const config = require(path.join(repo, 'backend/knexfile.js'))[process.env.NODE_ENV || 'development'];
  const knex = require(path.join(repo, 'backend/node_modules/knex'))(config);
  try {
    const check = require('./gallery-migrate.cjs');
    await check.verifyInstalled(knex);
    await check.checkEnforcement(knex);
  } finally { await knex.destroy(); }
}
function attempt(repo, target, dir, token) {
  assert(/^[A-Za-z0-9._-]{1,180}$/.test(token || ''), 'invalid_attempt_token');
  const running = JSON.parse(fs.readFileSync(path.join(dir, 'RUNNING.json'), 'utf8'));
  assert(running.repo === repo && running.target === target && running.attempt_token === token, 'attempt_identity_changed');
}
function terminal(repo, target, dir, token) {
  attempt(repo, target, dir, token);
  const done = JSON.parse(fs.readFileSync(path.join(dir, 'TERMINAL.json'), 'utf8'));
  assert(done.repo === repo && done.target === target && done.attempt_token === token && Number.isInteger(done.exit), 'remote_terminal_unknown');
  return done;
}
async function nativeMigration(repo, target, dir, token) {
  const record = verify(repo, target, dir);
  const selected = selectedNames(record.profile);
  attempt(repo, target, dir, token);
  assert(!fs.existsSync(path.join(dir, 'TERMINAL.json')), 'native_attempt_already_finished');
  exclusive(dir, 'NATIVE-RUNNING.json', {repo, target, attempt_token: token});
  const commands = [
    ['backup', 'bash', [path.join(repo, 'backend/scripts/db_backup.sh')]],
    ...selected.map(name => [name, process.execPath, [path.join(repo, 'backend/node_modules/knex/bin/cli.js'), 'migrate:up', name]]),
    ['status', process.execPath, [path.join(repo, 'backend/node_modules/knex/bin/cli.js'), 'migrate:status']]
  ];
  let migrated = 0;
  for (const [phase, command, args] of commands) {
    verify(repo, target, dir);
    assert(JSON.stringify(await pendingNames(repo)) === JSON.stringify(selected.slice(migrated).sort()), 'pending_migrations_drift');
    const child = cp.spawnSync(command, args, {
      cwd: path.join(repo, 'backend'), stdio: ['ignore', 'inherit', 'inherit'],
      env: {...process.env, APP_DIR: repo, BACKUP_RETENTION: 'skip'}
    });
    // No trap, timeout or signal handler fabricates completion. A signalled/unknown
    // child leaves RUNNING without TERMINAL, so the original lock must remain.
    assert(!child.error && !child.signal && Number.isInteger(child.status), 'child_terminal_unknown');
    if (child.status !== 0 || phase === 'status') {
      exclusive(dir, 'TERMINAL.json', {repo, target, attempt_token: token, phase, exit: child.status});
      assert(child.status === 0, 'native_command_failed');
    }
    if (selected.includes(phase)) migrated += 1;
    if (phase === 'backup') { verify(repo, target, dir); await galleryPrerequisites(repo, record, true); }
  }
}
async function run(action, repo, target, dir, expectedParent, profile) {
  if (action === 'prepare') {
    assert(/^[0-9a-f]{40}$/.test(expectedParent || ''), 'missing_expected_parent');
    return prepare(repo, target, dir, expectedParent, profile);
  }
  const record = verify(repo, target, dir, action === 'verify-completed');
  if (action === 'verify-terminal') return terminal(repo, target, dir, expectedParent);
  if (action === 'native') return nativeMigration(repo, target, dir, expectedParent);
  if (action === 'verify' || action === 'verify-completed') {
    if (action === 'verify-completed') {
      if (record.recovery) await require('./gallery-recovery.cjs').verifyRecoveredDatabase(repo, target, dir, record);
      await verifyGalleryDatabase(repo, record);
    }
    return record;
  }
  if (action === 'begin') {
    assert(/^[A-Za-z0-9._-]{1,180}$/.test(expectedParent || ''), 'invalid_attempt_token');
    assert(!fs.existsSync(path.join(dir, 'RUNNING.json')) && !fs.existsSync(path.join(dir, 'MIGRATED.json')), 'attempt_already_started');
    assert(JSON.stringify(await pendingNames(repo)) === JSON.stringify([...selectedNames(record.profile)].sort()), 'pending_migrations_not_exact_profile');
    await galleryPrerequisites(repo, record);
    exclusive(dir, 'RUNNING.json', {...record, attempt_token: expectedParent});
  } else if (action === 'complete') {
    assert(terminal(repo, target, dir, expectedParent).exit === 0, 'native_success_not_confirmed');
    assert((await pendingNames(repo)).length === 0, 'migrations_still_pending');
    await verifyGalleryDatabase(repo, record);
    try {
      exclusive(dir, 'MIGRATED.json', record);
      fs.mkdirSync(path.join(dir, 'COMPLETE'), {mode: 0o700});
      syncDir(dir);
    } catch (error) {
      try { exclusive(dir, 'FAILED.json', {target, status: 'COMPLETION_DURABILITY_UNKNOWN'}); } catch (_) { /* preserve evidence */ }
      throw error;
    }
  } else if (action === 'fail') {
    exclusive(dir, 'FAILED.json', {target, status: 'UNKNOWN_OR_FAILED_DO_NOT_RETRY', ddl_may_have_committed: true});
  } else throw new Error('unknown_action');
  return record;
}
module.exports = {prepare, verify, verifyFiles, run, names, paths, selectedNames};
if (require.main === module) {
  const [action, repo, target, dir, expectedParent, profile] = process.argv.slice(2);
  run(action, repo, target, dir, expectedParent, profile).then(() => console.log(`migration_stage_${action}: OK`)).catch(() => {
    // Database errors may contain operational details; retain state and report a fixed code.
    console.error('MIGRATION_STAGE_STOP: preserve stage and inspect with original owner; no automatic retry or rollback');
    process.exitCode = 1;
  });
}

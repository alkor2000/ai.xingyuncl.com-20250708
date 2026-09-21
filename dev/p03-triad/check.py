"""Same-version triad: P03 MySQL source + native Identity provider + unmodified T11 cmd/t11-lab.

Disposable PG18 (Identity), PG16 (target: sanitized S05b post-schema + 20260921_03 migration) and MySQL 8
containers on loopback-published ports. Identity's own current-triad Go overlay (provider_test.go.txt) and
error_probe.cjs are used unchanged from their repository; only this repository's scenarios.py drives the
cases. Inputs are pinned by candidate.json (manifest, closure, schema, provider commit); `--rehearsal`
only exercises the driver against whatever the release tree currently holds and never counts as evidence
for the candidate. No production configuration, no peer repository writes, no image pulls; sanitized
evidence only.
"""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
# `--candidate=<file>` selects another pinned candidate (e.g. candidate-formal.json for the formal wire); the
# candidate file names the overlay, driver and Go test that run it.
PIN = json.loads((HERE / next((a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--candidate=')), 'candidate.json')).read_text())
IDENTITY = Path(os.environ.get('P03_IDENTITY_ROOT', '/home/hanying/pkuailab-id')).resolve()
RELEASE = Path(PIN['release']).resolve()
T11 = RELEASE / 'source'
CASES = PIN['cases']
OVERLAY_SOURCE = (IDENTITY if PIN.get('overlay_owner', 'identity') == 'identity' else ROOT) / PIN.get('overlay', 'dev/i03/current-triad/provider_test.go.txt')
PROBE_SOURCE = IDENTITY / 'dev/i03/current-triad/error_probe.cjs'
DRIVER = HERE / PIN.get('driver', 'scenarios.py')
TEST_NAME = PIN.get('test_name', 'TestCurrentP03T11Main')
SCHEMA = RELEASE / 'post-s05b-expected-schema.sql'
MIGRATION = T11 / 'backend/migrations' / PIN['migration']
# The sanitized schema dump carries neither owners nor privileges. The S05b immutable-snapshot privilege facts
# that the T11 verify script asserts are replayed verbatim from the target's own migration
# (20260918_01_resource_references.up.sql:34-35), exactly as Identity's current-triad driver does.
TARGET_PREIMAGE_PRIVILEGES = ['REVOKE UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON resource_versions FROM tedna_user',
                              'GRANT SELECT,INSERT ON resource_versions TO tedna_user']
LOCK_PRIMITIVE = 'public.teacher_artifact_lock_actor(uuid)'
# Target runtime role models for the single-process t11-lab (one DSN serves receiver and reference services):
# split  = Identity's current-triad roles.sql, app + ordinary-application grants united on one login role; the
#          guard role alone may touch users (SELECT(id,status,role), UPDATE(id)) through the SECURITY DEFINER
#          row-lock primitive; the login role gets INSERT on users only because t11-lab seeds its two synthetic
#          accounts itself. No UPDATE on users, no ownership, no DDL.
# broad  = one login role with DML on every public table (functional rehearsal only; not a role-model claim).
ROLE_MODELS = {
    'split': ['GRANT SELECT(id,status,role),UPDATE(id) ON users TO tedna_t11_guard_triad',
              'GRANT SELECT,INSERT,UPDATE,DELETE ON teacher_artifact_imports,teacher_artifact_resources,teacher_artifact_nonces,teacher_artifact_requests TO tedna_t11_lab',
              'GRANT INSERT ON resource_versions TO tedna_t11_lab', 'GRANT SELECT(owner_id,resource_id),DELETE ON resource_search_cache TO tedna_t11_lab',
              'GRANT SELECT ON ALL TABLES IN SCHEMA public TO tedna_t11_lab',
              'GRANT INSERT,UPDATE,DELETE ON resource_contexts,resource_references,resource_reference_requests,resource_search_cache TO tedna_t11_lab',
              'GRANT UPDATE ON courseware_assembly_runs,coursewares TO tedna_t11_lab', 'GRANT INSERT ON users TO tedna_t11_lab'],
    'broad': ['GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO tedna_t11_lab',
              'GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO tedna_t11_lab', 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO tedna_t11_lab']}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(args, **kwargs):
    kwargs.setdefault('timeout', 120)
    p = subprocess.run(args, text=True, capture_output=True, **kwargs)
    if p.returncode:
        raise RuntimeError(f'{Path(args[0]).name}_failed_{p.returncode}')
    return p.stdout.strip()


def fingerprints():
    files = [*(T11 / 'backend').rglob('*.go'), *(T11 / 'backend/migrations').glob('*.sql'), T11 / 'backend/go.mod', T11 / 'backend/go.sum',
             RELEASE / 'source-manifest.json', RELEASE / 'closure.json', SCHEMA,
             *(IDENTITY / 'internal/artifacthandoff').glob('*.go'), IDENTITY / 'dev/i03/native/schema.sql', IDENTITY / 'dev/i03/fixtures.json',
             OVERLAY_SOURCE, PROBE_SOURCE, IDENTITY / 'go.mod', IDENTITY / 'go.sum',
             *(ROOT / 'backend/src/services/artifactHandoff').glob('*.js'), ROOT / 'dev/p03-mysql-worker.cjs', ROOT / 'dev/p03-mysql-fixture.cjs',
             HERE / 'check.py', DRIVER, OVERLAY_SOURCE, *(HERE.glob('candidate*.json'))]
    return {str(p): sha(p) for p in sorted(set(files)) if p.is_file()}


def verify_inputs(rehearsal):
    manifest = json.loads((RELEASE / 'source-manifest.json').read_text())
    drift = [f['path'] for f in manifest['files'] if not (T11 / f['path']).is_file() or sha(T11 / f['path']) != f['sha256']]
    pinned = (manifest['parent'] == PIN['target_parent'] and sha(RELEASE / 'source-manifest.json') == PIN['manifest_sha256']
              and sha(RELEASE / 'closure.json') == PIN['closure_sha256'] and sha(SCHEMA) == PIN['schema_input_sha256'] and not drift)
    if not rehearsal:
        assert manifest['parent'] == PIN['target_parent'], 'target_parent_mismatch'
        assert sha(RELEASE / 'source-manifest.json') == PIN['manifest_sha256'], 'manifest_sha_mismatch'
        assert sha(RELEASE / 'closure.json') == PIN['closure_sha256'], 'closure_sha_mismatch'
        assert sha(SCHEMA) == PIN['schema_input_sha256'], 'schema_input_sha_mismatch'
        assert not drift, 'candidate_files_changed'
    provider = PIN['identity_provider_commit']
    subprocess.run(['git', 'merge-base', '--is-ancestor', provider, 'HEAD'], cwd=IDENTITY, check=True)
    assert run(['git', 'diff', '--stat', provider, 'HEAD', '--', *PIN['identity_paths']], cwd=IDENTITY) == '', 'identity_provider_paths_changed'
    assert run(['git', 'status', '--porcelain', '--', *PIN['identity_paths']], cwd=IDENTITY) == '', 'identity_provider_paths_dirty'
    return manifest, pinned, drift


def main():
    rehearsal = '--rehearsal' in sys.argv[1:]
    role_model = 'broad' if '--target-role=broad' in sys.argv[1:] else 'split'
    os.umask(0o077)
    evidence = ROOT / 'storage/private/p03-handoff-validation' / (('triad-rehearsal' + PIN.get('evidence_suffix', '') if rehearsal else 'triad-' + PIN['candidate']) + ('-broad' if role_model == 'broad' else ''))
    evidence.mkdir(parents=True, exist_ok=True)
    manifest, pinned, drift = verify_inputs(rehearsal)
    before = fingerprints()
    names = {k: 'p03-triad-' + k + '-' + uuid.uuid4().hex[:12] for k in ['identity', 'target', 'mysql']}
    images = {'identity': 'postgres:18', 'target': 'postgres:16', 'mysql': 'mysql:8.0'}
    passwords = {k: secrets.token_urlsafe(32) for k in names}
    for image in images.values():
        run(['docker', 'image', 'inspect', image], timeout=10)
    result = {'status': 'failed', 'stage': 'setup', 'mode': 'rehearsal_unpinned' if rehearsal else 'pinned_candidate', 'candidate': PIN['candidate'],
              'candidate_pinned': pinned, 'candidate_drift': drift, 'wire': PIN['wire'], 'cases': CASES, 'target_parent': manifest['parent'],
              'manifest_sha256': sha(RELEASE / 'source-manifest.json'), 'closure_sha256': sha(RELEASE / 'closure.json'), 'schema_input_sha256': sha(SCHEMA),
              'target_migration': PIN['migration'], 'identity_head': run(['git', 'rev-parse', 'HEAD'], cwd=IDENTITY), 'identity_provider_commit': PIN['identity_provider_commit'],
              'source_head': run(['git', 'rev-parse', 'HEAD'], cwd=ROOT), 'source_dirty': run(['git', 'status', '--porcelain', '--', 'backend/src/services/artifactHandoff', 'dev'], cwd=ROOT) != '',
              'source': PIN.get('source_description', 'P03 MySQL 8 durable candidate under the restricted lab role, native draft profile, wall clock'),
              'identity': PIN.get('identity_description', 'real Go/PG18 provider (internal/artifacthandoff) through its own current-triad overlay, synthetic facts, draft policy; not the complete Identity main'),
              'target': 'unmodified T11 cmd/t11-lab (real store/handlers) on PG16: sanitized S05b post-schema + ' + PIN['migration'] + ' up/verify in one transaction',
              'target_role_model': role_model, 'target_role_grants': ROLE_MODELS[role_model], 'target_preimage_privileges': TARGET_PREIMAGE_PRIVILEGES,
              'clocks': PIN.get('clocks', 'source and Identity on wall time; t11-lab clock pinned to each case start second (its own design)'),
              'network': 'containers on loopback-published ports; databases disposable; no namespace isolation',
              'real_teacher_authority': False, 'identity_full_main': False, 'input_sha256': before}
    env = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1', 'GOFLAGS': '-mod=mod'}
    ok = False
    try:
        def start(kind):
            if kind == 'mysql':
                envs, port = {'MYSQL_ROOT_PASSWORD': passwords[kind]}, '3306'
            else:
                envs, port = {'POSTGRES_PASSWORD': passwords[kind], 'POSTGRES_DB': 'i03_native' if kind == 'identity' else 'postgres'}, '5432'
            args = ['docker', 'run', '-d', '--pull=never', '--name', names[kind], '--label', 'pkuailab.task=p03-triad', '-p', '127.0.0.1::' + port]
            for key in envs:
                args += ['-e', key]
            run(args + [images[kind]], env={**os.environ, **envs}, timeout=30)
            deadline = time.monotonic() + 120
            while time.monotonic() < deadline:
                probe = ['docker', 'exec', names[kind]] + (['mysqladmin', '--host=127.0.0.1', 'ping', '--silent'] if kind == 'mysql' else ['pg_isready', '-U', 'postgres'])
                if subprocess.run(probe, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5).returncode == 0:
                    time.sleep(1.5)  # the image entrypoint restarts the server once after initialization
                    if subprocess.run(probe, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5).returncode == 0:
                        break
                time.sleep(.3)
            else:
                raise RuntimeError('database_start_timeout')
            return int(run(['docker', 'port', names[kind], port + '/tcp'], timeout=10).rsplit(':', 1)[1])
        with concurrent.futures.ThreadPoolExecutor(3) as ex:
            ports = dict(zip(names, ex.map(start, names)))
        result['stage'] = 'target_fixture'
        target_db = 'tedna_t11_' + uuid.uuid4().hex[:12]
        lab_password = secrets.token_urlsafe(24)

        def psql(query, database='postgres'):
            p = subprocess.run(['docker', 'exec', '-i', names['target'], 'psql', '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database],
                               input=query, text=True, capture_output=True, timeout=300)
            if p.returncode:
                raise RuntimeError('target_fixture_sql_failed')
            return p.stdout.strip()
        psql('CREATE ROLE tedna_user NOLOGIN; CREATE ROLE tedna_t11_guard_triad NOLOGIN NOINHERIT;')
        psql(f"CREATE ROLE tedna_t11_lab LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '{lab_password}';")
        psql(f'CREATE DATABASE {target_db}; REVOKE ALL ON DATABASE {target_db} FROM PUBLIC; GRANT CONNECT ON DATABASE {target_db} TO tedna_t11_lab;')
        psql(SCHEMA.read_text(), target_db)
        psql(';'.join(TARGET_PREIMAGE_PRIVILEGES) + ';', target_db)
        psql('BEGIN;' + Path(str(MIGRATION) + '.up.sql').read_text() + Path(str(MIGRATION) + '.verify.sql').read_text() + 'COMMIT;', target_db)
        primitive = psql(f"SELECT to_regprocedure('{LOCK_PRIMITIVE}') IS NOT NULL", target_db) == 't'
        grants = ['REVOKE CREATE ON SCHEMA public FROM PUBLIC', 'GRANT USAGE ON SCHEMA public TO tedna_t11_guard_triad,tedna_t11_lab', *ROLE_MODELS[role_model]]
        if primitive and role_model == 'split':
            grants += [f'ALTER FUNCTION {LOCK_PRIMITIVE} OWNER TO tedna_t11_guard_triad', f'GRANT EXECUTE ON FUNCTION {LOCK_PRIMITIVE} TO tedna_t11_lab']
        psql(';'.join(grants) + ';', target_db)
        assert psql("SELECT rolsuper FROM pg_roles WHERE rolname='tedna_t11_lab'", target_db) == 'f'
        assert psql("SELECT has_table_privilege('tedna_t11_lab','resource_versions','DELETE')", target_db) == 'f'
        assert psql("SELECT has_table_privilege('tedna_t11_lab','teacher_artifact_resources','SELECT,INSERT,UPDATE,DELETE')", target_db) == 't'
        # The receiving role must not be able to lock identity rows directly; only the guard primitive may (Identity role model).
        probe = subprocess.run(['docker', 'exec', '-i', names['target'], 'psql', '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', target_db], text=True, capture_output=True, timeout=60,
                               input="SET ROLE tedna_t11_lab; SELECT status,role FROM users WHERE id='00000000-0000-4000-8000-000000000000' FOR UPDATE;")
        result['target_facts'] = {'lock_primitive_present': primitive, 'users_update_granted': psql("SELECT has_table_privilege('tedna_t11_lab','users','UPDATE')", target_db) == 't',
                                  'users_for_update_denied_for_login_role': probe.returncode != 0 and 'permission denied' in probe.stderr}
        print('Isolated databases ready (identity PG18, target PG16 with S05b schema + T11 migration/verify, MySQL 8).', flush=True)
        result['stage'] = 'build'
        with tempfile.TemporaryDirectory(prefix='p03-triad-') as temp:
            tmp = Path(temp)
            receiver = tmp / 't11-lab'
            run(['go', 'build', '-race', '-o', str(receiver), './cmd/t11-lab'], cwd=T11 / 'backend', env=env, timeout=600)
            driver = tmp / 'driver'
            driver.mkdir()
            shutil.copy(DRIVER, driver / 'scenarios.py')  # the overlay always invokes <driver dir>/scenarios.py
            shutil.copy(PROBE_SOURCE, driver / 'error_probe.cjs')
            overlay = tmp / 'overlay.json'
            overlay.write_text(json.dumps({'Replace': {str(IDENTITY / 'internal/artifacthandoff/p03_triad_overlay_test.go'): str(OVERLAY_SOURCE)}}))
            result['binary_sha256'] = {'t11_lab': sha(receiver)}
            print('Unmodified T11 cmd/t11-lab built with -race; overlay ' + str(OVERLAY_SOURCE.name) + ' and Identity error probe in place.', flush=True)
            config = {'cases': CASES, 'practice_root': str(ROOT), 'receiver': str(receiver), 'evidence': str(evidence),
                      'target': {'container': names['target'], 'database': target_db,
                                 'dsn': f"postgres://tedna_t11_lab:{lab_password}@127.0.0.1:{ports['target']}/{target_db}?sslmode=disable"},
                      'mysql': {'host': '127.0.0.1', 'port': ports['mysql'], 'user': 'root', 'password': passwords['mysql']}}
            go_env = {**env, 'I03_NATIVE_DATABASE_URL': f"postgres://postgres:{passwords['identity']}@127.0.0.1:{ports['identity']}/i03_native?sslmode=disable",
                      'I03_NATIVE_ISOLATED': '1', 'I03_CURRENT_CONFIG': json.dumps(config), 'I03_TRIAD_DRIVER': str(driver), 'I03_TRIAD_EVIDENCE': str(evidence)}
            result['stage'] = 'triad'
            proc = subprocess.run(['go', 'test', '-race', '-count=1', '-json', '-overlay', str(overlay), '-run', '^' + TEST_NAME + '$', './internal/artifacthandoff'],
                                  cwd=IDENTITY, env=go_env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=1500)
            events = []
            for line in proc.stdout.splitlines():
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
            output = ''.join(e.get('Output', '') for e in events)
            for secret in [*passwords.values(), lab_password]:
                assert secret not in output and secret not in proc.stderr
            (evidence / 'go-tests.log').write_text(output)
            if proc.stderr.strip():
                (evidence / 'go-stderr.log').write_text(proc.stderr)
            passed = [e['Test'] for e in events if e.get('Action') == 'pass' and 'Test' in e]
            failed = [e.get('Test', 'package') for e in events if e.get('Action') == 'fail']
            skipped = [e.get('Test', 'package') for e in events if e.get('Action') == 'skip']
            result.update(passed=passed, failed=failed, skipped=skipped, returncode=proc.returncode, race=True)
            print(json.dumps({'returncode': proc.returncode, 'passed': passed, 'failed': failed, 'skipped': skipped}, ensure_ascii=False), flush=True)
            expected = {TEST_NAME, *(TEST_NAME + '/' + c for c in CASES)}
            ok = proc.returncode == 0 and not failed and not skipped and set(passed) == expected
        after = fingerprints()
        result['inputs_unchanged'] = before == after
        result['images'] = {k: json.loads(run(['docker', 'image', 'inspect', image, '--format', '{{json .Id}}'], timeout=10)) for k, image in images.items()}
        ok = ok and before == after
        result['status'] = ('rehearsal_passed' if ok else 'rehearsal_failed') if rehearsal else ('passed' if ok and pinned else 'failed')
        result['stage'] = 'complete' if ok else 'triad'
    except Exception as error:
        result['failure_type'] = type(error).__name__
        if isinstance(error, (RuntimeError, AssertionError)):
            result['failure_label'] = str(error)
        print('Triad stopped at ' + result['stage'] + ' (' + type(error).__name__ + ')', flush=True)
    finally:
        for name in names.values():
            subprocess.run(['docker', 'rm', '--force', '--volumes', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
        result['containers_removed'] = True
        result['checked_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        (evidence / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        print('Owned laboratory containers and volumes removed; result at ' + str(evidence / 'result.json'), flush=True)
    return 0 if result['status'] in ('passed', 'rehearsal_passed') else 1


if __name__ == '__main__':
    sys.exit(main())

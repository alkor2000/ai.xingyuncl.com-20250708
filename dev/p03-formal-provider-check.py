"""V10-V13 against the REAL Identity rc2 provider candidate (Go/PG18, formal wire enabled in the lab),
with the P03 MySQL-backed source and a synthetic target that redeems at that provider.

Disposable MySQL8/PG18 containers, no .env, no existing databases, no Identity writes, no image pulls.
Only sanitized results and input hashes are kept in storage/private.
"""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
IDENTITY = Path(sys.argv[1] if len(sys.argv) > 1 else '/home/hanying/pkuailab-id').resolve()
EVIDENCE = ROOT / 'storage/private/p03-handoff-validation/formal-provider'
PROVIDER_COMMIT = '14b9852035d908bc27af9ce3691ef613fdd1b062'  # Identity rc3 candidate (pairs allow-list); rc2 provider 25b5ff1 retained underneath
# The rc3 review document moves without provider code changes (.3 idempotent replay wording, .4 user decision J3);
# it is pinned to the consumed revision instead of "unchanged since the fixed commit".
RC3_REVIEW_SHA256 = '8126f53909211a7c82725c913a784b903c2c6e6bf6edae34555a741d4fb4afdf'  # i03-review-20260921.4
CASES = ['formal_success', 'v10_lost_first_issue', 'v10_first_issue_in_flight', 'v11_recovery_window', 'v12a_write_ticket_cut',
         'v12b_status_ticket_cut', 'v13_local_deadline', 'v13_success_survives_local_deadline', 'reconciliation_exit']


def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs).stdout.strip()


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def fingerprints():
    files = [*(IDENTITY / 'internal/artifacthandoff').glob('*.go'), IDENTITY / 'dev/i03/native/schema.sql', IDENTITY / 'dev/i03/fixtures.json',
             IDENTITY / 'dev/i03/review/profile-v1-rc2.md', IDENTITY / 'dev/i03/review/profile-v1-rc1.md', IDENTITY / 'dev/i03/review/profile-v1-rc3.md',
             IDENTITY / 'dev/i03/review/profile-v1-rc2-provider-candidate.md', IDENTITY / 'dev/i03/rc2-provider-candidate/verification.json',
             IDENTITY / 'dev/i03/rc3-candidate/verification.json', IDENTITY / 'go.mod', IDENTITY / 'go.sum']
    files += list((ROOT / 'backend/src/services/artifactHandoff').glob('*.js'))
    files += [ROOT / 'dev' / name for name in ['p03-formal-provider-check.py', 'p03-formal-scenarios.py', 'p03-formal-provider-overlay.go',
                                              'p03-formal-target.cjs', 'p03-mysql-worker.cjs', 'p03-mysql-fixture.cjs']]
    return {str(p): sha(p) for p in files if p.is_file()}


def main():
    os.umask(0o077)
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    identity_head = run(['git', 'rev-parse', 'HEAD'], cwd=IDENTITY)
    # The fixed package must be an ancestor and the provider/candidate paths unchanged since it.
    subprocess.run(['git', 'merge-base', '--is-ancestor', PROVIDER_COMMIT, 'HEAD'], cwd=IDENTITY, check=True)
    provider_paths = ['internal/artifacthandoff', 'dev/i03/native', 'dev/i03/review/profile-v1-rc1.md', 'dev/i03/review/profile-v1-rc2.md',
                      'dev/i03/review/profile-v1-rc2-provider-candidate.md', 'dev/i03/fixtures.json',
                      'dev/i03/rc2-provider-candidate/verification.json', 'go.mod', 'go.sum']
    # rc3 review text is pinned to the consumed revision; its verification record accrues consumption entries and is only recorded.
    assert sha(IDENTITY / 'dev/i03/review/profile-v1-rc3.md') == RC3_REVIEW_SHA256, 'rc3_review_revision_unknown'
    assert run(['git', 'diff', '--stat', PROVIDER_COMMIT, 'HEAD', '--', *provider_paths], cwd=IDENTITY) == '', 'provider_paths_changed_since_fixed_package'
    assert run(['git', 'status', '--porcelain', '--', *provider_paths], cwd=IDENTITY) == '', 'provider_paths_dirty'
    before = fingerprints()
    names = {kind: 'p03-formal-' + kind + '-' + uuid.uuid4().hex[:12] for kind in ['mysql', 'postgres']}
    images = {'mysql': 'mysql:8.0', 'postgres': 'postgres:18'}
    passwords = {kind: secrets.token_urlsafe(32) for kind in names}
    for image in images.values():
        run(['docker', 'image', 'inspect', image], timeout=10)
    result_path = EVIDENCE / 'result.json'
    try:
        def start(kind):
            if kind == 'mysql':
                envs, port = {'MYSQL_ROOT_PASSWORD': passwords[kind]}, '3306'
            else:
                envs, port = {'POSTGRES_PASSWORD': passwords[kind], 'POSTGRES_DB': 'i03_native'}, '5432'
            args = ['docker', 'run', '-d', '--pull=never', '--name', names[kind], '--label', 'pkuailab.task=p03-formal-provider', '-p', '127.0.0.1::' + port]
            for key in envs:
                args += ['-e', key]
            run(args + [images[kind]], env={**os.environ, **envs}, timeout=20)
            deadline = time.monotonic() + 90
            while time.monotonic() < deadline:
                probe = ['docker', 'exec', names[kind]] + (['mysqladmin', '--host=127.0.0.1', 'ping', '--silent'] if kind == 'mysql'
                                                          else ['pg_isready', '-U', 'postgres', '-d', 'i03_native'])
                if subprocess.run(probe, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5).returncode == 0:
                    break
                time.sleep(.3)
            else:
                raise RuntimeError('database_start_timeout')
            return int(run(['docker', 'port', names[kind], port + '/tcp'], timeout=5).rsplit(':', 1)[1])
        with concurrent.futures.ThreadPoolExecutor(2) as ex:
            ports = dict(zip(names, ex.map(start, names)))
        print('Isolated MySQL/PG ready; running real-provider formal scenarios.', flush=True)
        with tempfile.TemporaryDirectory(prefix='p03-formal-overlay-') as temp:
            overlay = Path(temp) / 'overlay.json'
            overlay.write_text(json.dumps({'Replace': {str(IDENTITY / 'internal/artifacthandoff/p03_formal_provider_test.go'): str(ROOT / 'dev/p03-formal-provider-overlay.go')}}))
            env = {**os.environ, 'I03_NATIVE_DATABASE_URL': f"postgres://postgres:{passwords['postgres']}@127.0.0.1:{ports['postgres']}/i03_native?sslmode=disable",
                   'I03_NATIVE_ISOLATED': '1', 'I03_P03_ROOT': str(ROOT), 'P03_FORMAL_EVIDENCE': str(EVIDENCE), 'PYTHONDONTWRITEBYTECODE': '1',
                   'P03_MYSQL_LAB': json.dumps({'host': '127.0.0.1', 'port': ports['mysql'], 'user': 'root', 'password': passwords['mysql']})}
            proc = subprocess.run(['go', 'test', '-race', '-count=1', '-json', '-overlay', str(overlay), '-run', '^TestP03FormalProvider$', './internal/artifacthandoff'],
                                  cwd=IDENTITY, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=900)
            events = []
            for line in proc.stdout.splitlines():
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
            safe_output = ''.join(e.get('Output', '') for e in events)
            for secret in passwords.values():
                assert secret not in safe_output
            (EVIDENCE / 'go-tests.log').write_text(safe_output)
            passed = [e['Test'] for e in events if e.get('Action') == 'pass' and 'Test' in e]
            failed = [e.get('Test', 'package') for e in events if e.get('Action') == 'fail']
            skipped = [e.get('Test', 'package') for e in events if e.get('Action') == 'skip']
            print(json.dumps({'returncode': proc.returncode, 'passed': passed, 'failed': failed, 'skipped': skipped}), flush=True)
            ok = proc.returncode == 0 and not failed and not skipped and set(passed) == {'TestP03FormalProvider', *('TestP03FormalProvider/' + c for c in CASES)}
        after = fingerprints()
        evidence = {'draft_only': False, 'formal_wire': 'teacher-artifact-handoff/1', 'status': 'passed' if ok and before == after else 'failed',
                    'identity': 'real Go/PG18 provider (internal/artifacthandoff) with EnableFormalCandidate and formal policy row; injected lab clock',
                    'identity_commit': identity_head, 'fixed_package_commit': PROVIDER_COMMIT, 'provider_paths_unchanged_since_fixed_package': True, 'rc3_review_sha256': RC3_REVIEW_SHA256, 'rc3_verification_record_sha256': sha(IDENTITY / 'dev/i03/rc3-candidate/verification.json'),
                    'source': 'P03 MySQL8 worker under the restricted lab role, formal wire',
                    'target': 'synthetic Node target redeeming tickets at the real provider (not T11)',
                    'time_source': 'injected: provider lab clock, worker command clock, target control clock (not wall time)',
                    'cases': CASES, 'passed': passed, 'failed': failed, 'skipped': skipped, 'race': True,
                    'input_sha256': before, 'inputs_unchanged': before == after, 'source_head': run(['git', 'rev-parse', 'HEAD'], cwd=ROOT),
                    'images': {kind: json.loads(run(['docker', 'image', 'inspect', image, '--format', '{{json .Id}}'])) for kind, image in images.items()},
                    'not_proven': ['T11 receiving side W persistence and lock-then-check (target here is synthetic)', 'formal profile approval or production enablement',
                                   'real teacher/attachment facts', 'wall-clock behaviour (all three clocks injected)']}
        result_path.write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + '\n')
        assert ok, 'formal_provider_scenarios_failed'
        assert before == after, 'inputs_changed_during_validation'
    finally:
        for name in names.values():
            subprocess.run(['docker', 'rm', '--force', '--volumes', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
        print('Owned laboratory containers and volumes removed.', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('P03_FORMAL_PROVIDER_CHECK_FAILED:' + (str(error) if isinstance(error, AssertionError) else type(error).__name__), file=sys.stderr)
        sys.exit(1)

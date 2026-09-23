"""Owned disposable MySQL rehearsal. No .env, production copy, app startup, Go or peer process."""
import datetime
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]


def main():
    os.umask(0o077)
    run_id = uuid.uuid4().hex[:12]
    name = 'p03-package-' + run_id
    output = ROOT / 'storage/private/p03-migration-package' / ('db-' + run_id)
    output.mkdir(parents=True)
    password = secrets.token_urlsafe(32)
    result = {'status': 'failed', 'stage': 'container', 'container': name, 'production_connected': False}
    started = False
    try:
        image = subprocess.run(['docker', 'image', 'inspect', 'mysql:8.0', '--format', '{{.Id}}'], text=True, capture_output=True, check=True, timeout=10)
        result['mysql_image'] = image.stdout.strip()
        subprocess.run(['docker', 'run', '-d', '--pull=never', '--name', name, '--label', 'pkuailab.task=p03-migration-package',
                        '-p', '127.0.0.1::3306', '-e', 'MYSQL_ROOT_PASSWORD', 'mysql:8.0'],
                       env={**os.environ, 'MYSQL_ROOT_PASSWORD': password}, capture_output=True, check=True, timeout=30)
        started = True
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            ready = subprocess.run(['docker', 'exec', '-e', 'MYSQL_PWD', name, 'mysql', '-uroot', '--host=127.0.0.1', '-N', '-e', 'SELECT 1'],
                                   env={**os.environ, 'MYSQL_PWD': password}, capture_output=True, timeout=5)
            if ready.returncode == 0:
                break
            time.sleep(.5)
        else:
            raise RuntimeError('p03_package_mysql_start_timeout')
        binding = subprocess.run(['docker', 'port', name, '3306/tcp'], text=True, capture_output=True, check=True, timeout=10).stdout.strip()
        if not binding.startswith('127.0.0.1:') or '\n' in binding:
            raise RuntimeError('p03_package_non_loopback_binding')
        result['stage'] = 'migration_rehearsal'
        config = {'host': '127.0.0.1', 'port': int(binding.rsplit(':', 1)[1]), 'password': password, 'database': 'p03_pkg_' + run_id}
        p = subprocess.run(['node', str(ROOT / 'dev/p03-migration-package-db.cjs')], input=json.dumps(config), text=True,
                           capture_output=True, cwd=ROOT, env={**os.environ, 'NODE_ENV': 'test'}, timeout=180)
        # Worker emits only synthetic evidence/fixed error codes; never driver messages or config.
        (output / 'worker.log').write_text(p.stdout + p.stderr)
        lines = [line for line in p.stdout.splitlines() if line.startswith('{')]
        result['worker'] = json.loads(lines[-1]) if lines else None
        if p.returncode or not result['worker'] or result['worker']['status'] != 'passed':
            raise RuntimeError('p03_package_worker_failed')
        result.update(status='passed', stage='complete')
    except (OSError, subprocess.SubprocessError, RuntimeError, ValueError) as error:
        result['failure'] = str(error) if isinstance(error, RuntimeError) else type(error).__name__
    finally:
        if started:
            removed = subprocess.run(['docker', 'rm', '--force', '--volumes', name], capture_output=True, timeout=30)
            result['container_removed'] = removed.returncode == 0
            if removed.returncode:
                result['status'] = 'failed'
                result['failure'] = 'p03_package_container_cleanup_failed'
        result['checked_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        (output / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({'status': result['status'], 'stage': result['stage'], 'evidence': str(output / 'result.json')}), flush=True)
    return 0 if result['status'] == 'passed' else 1


if __name__ == '__main__':
    sys.exit(main())

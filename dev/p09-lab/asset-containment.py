"""Path containment and object correspondence for the frozen-asset resolver.

A disposable MySQL holds the real ownership tables (taken from the local schema structure, no rows), a
temporary tree holds every file this run touches, and the real resolver is asked to resolve each kind of
reference. Nothing here reads another person's data or a host file: "outside the upload root" is a
sibling temporary directory created by the run itself.
"""
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / 'storage/private/p09-validation' / time.strftime('containment-%Y%m%dT%H%M%SZ', time.gmtime())
MYSQL_IMAGE = 'mysql:8.0'
TABLES = ['files', 'user_files', 'html_resources', 'image_generations', 'forum_attachments']
LOCAL_ENV = Path(os.environ.get('P09_LOCAL_ENV', '')) if os.environ.get('P09_LOCAL_ENV') else (
    ROOT / 'backend/.env' if (ROOT / 'backend/.env').exists() else Path('/home/hanying/ai-platform/backend/.env'))
NODE_SQL = """const mysql=require('./backend/node_modules/mysql2/promise');let s='';
process.stdin.on('data',b=>s+=b).on('end',async()=>{const c=JSON.parse(s);
const db=await mysql.createConnection({host:c.host,port:c.port,user:c.user,password:c.password,database:c.database||undefined,multipleStatements:true,charset:'utf8mb4'});
const out=[];try{for(const q of c.queries){const [rows]=await db.query(q.sql,q.params||[]);out.push(Array.isArray(rows)?rows:{affected:rows.affectedRows});}}
finally{await db.end();}process.stdout.write(JSON.stringify(out));});"""


def need(condition, label):
    if not condition:
        raise RuntimeError(label)


def dotenv(path):
    values = {}
    for line in Path(path).read_text().splitlines():
        if '=' in line and not line.strip().startswith('#'):
            key, _, value = line.partition('=')
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def node(script_or_file, payload, timeout=180, redact=(), is_file=False):
    command = ['node', script_or_file] if is_file else ['node', '-e', script_or_file]
    process = subprocess.run(command, cwd=ROOT, input=json.dumps(payload), text=True, capture_output=True, timeout=timeout)
    if process.returncode:
        lines = [line.strip() for line in process.stderr.strip().splitlines() if line.strip()]
        for value in redact:
            if value:
                lines = [line.replace(value, '<redacted>') for line in lines]
        picked = (next((line for line in lines if re.search(r"\bcode: ?'", line)), None)
                  or next((line for line in lines if re.match(r'[A-Za-z]*Error: ', line)), None)
                  or (lines[-1] if lines else 'unknown'))
        try:
            EVIDENCE.mkdir(parents=True, exist_ok=True)
            (EVIDENCE / 'node-failure.log').write_text('\n'.join(lines[-20:]) + '\n')
        except Exception:
            pass
        raise RuntimeError('node_failed_' + re.sub(r'[^A-Za-z0-9_]', '', picked)[:60])
    text = process.stdout.strip()
    start = min([i for i in (text.find('{'), text.find('[')) if i >= 0], default=-1)
    return json.loads(text[start:]) if start >= 0 else text


def main():
    os.umask(0o077)
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    report = {'status': 'failed', 'stage': 'setup',
              'real': ['mysql:8.0 with the real ownership tables (structure only)', 'the real asset resolver',
                       'real files and real symlinks in a temporary tree'],
              'synthetic': ['the ownership rows', 'every file and link (created by this run, removed after)'],
              'never_touched': ['another person\'s data', 'any host file outside the temporary tree']}
    container = 'p09-containment-' + uuid.uuid4().hex[:8]
    root_password = secrets.token_urlsafe(24)
    scratch = tempfile.mkdtemp(prefix='p09-containment-')
    try:
        report['stage'] = 'database'
        subprocess.run(['docker', 'image', 'inspect', MYSQL_IMAGE], check=True, stdout=subprocess.DEVNULL, timeout=15)
        subprocess.run(['docker', 'run', '-d', '--pull=never', '--name', container, '--label', 'pkuailab.task=p09-containment',
                        '-p', '127.0.0.1::3306', '-e', 'MYSQL_ROOT_PASSWORD', MYSQL_IMAGE],
                       env={**os.environ, 'MYSQL_ROOT_PASSWORD': root_password}, check=True, stdout=subprocess.DEVNULL, timeout=60)
        # The image starts a temporary init server first, so the real one is the SECOND "ready for
        # connections"; even then the listener needs a moment, hence the retried probe below.
        deadline = time.monotonic() + 240
        while time.monotonic() < deadline:
            logs = subprocess.run(['docker', 'logs', container], capture_output=True, text=True)
            if (logs.stdout + logs.stderr).count('ready for connections') >= 2:
                time.sleep(3)
                break
            time.sleep(2)
        else:
            need(False, 'database_start_timeout')
        port = int(subprocess.run(['docker', 'port', container, '3306/tcp'], text=True, capture_output=True).stdout.strip().rsplit(':', 1)[1])
        mysql = {'host': '127.0.0.1', 'port': port, 'user': 'root', 'password': root_password}
        database = 'p09_containment_' + secrets.token_hex(3)

        local = dotenv(LOCAL_ENV)
        dump = subprocess.run(['docker', 'exec', '-e', 'MYSQL_PWD=' + local['DB_PASSWORD'], 'practice-mysql', 'mysqldump',
                               '-u' + local['DB_USER'], '--skip-triggers', '--set-gtid-purged=OFF', '--no-data',
                               '--skip-add-drop-table', local['DB_NAME'], *TABLES], capture_output=True, timeout=120)
        need(dump.returncode == 0, 'ownership_table_dump_failed')
        structure = re.sub(rb'-- (Dump completed on|Host:|Server version|MySQL dump).*', b'',
                           re.sub(rb'AUTO_INCREMENT=\d+ ', b'', dump.stdout)).decode()
        def sql(queries, db=None, attempts=8):
            payload = dict(mysql, database=db, queries=[q if isinstance(q, dict) else {'sql': q} for q in queries])
            for attempt in range(attempts):
                try:
                    return node(NODE_SQL, payload, redact=[root_password])
                except RuntimeError:
                    if attempt == attempts - 1:
                        raise
                    time.sleep(2)
        sql([f'CREATE DATABASE `{database}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'])
        sql(['SET FOREIGN_KEY_CHECKS=0', structure], db=database)
        present = sql([f"SELECT table_name AS t FROM information_schema.tables WHERE table_schema='{database}'"], db=database)[0]
        need(sorted(row['t'] for row in present) == sorted(TABLES), 'ownership_tables_' + str(len(present)))
        report['ownership_tables'] = sorted(row['t'] for row in present)

        report['stage'] = 'resolve'
        result = node('dev/p09-lab/asset-containment.cjs',
                      {'connection': {'host': '127.0.0.1', 'port': port, 'user': 'root', 'password': root_password,
                                      'database': database}},
                      redact=[root_password], is_file=True)
        report['cases'] = result['cases']
        report['outside_bytes'] = result['outside_bytes']

        # What the run means, stated as flags so the verdict is not a reading exercise.
        cases = result['cases']
        outside = result['outside_bytes']
        report['verdict'] = {
            'own_regular_file_served': 'returned_bytes' in cases['own_regular_file'],
            'own_absolute_url_served': 'returned_bytes' in cases['own_absolute_url'],
            'another_students_file_refused': cases['another_students_file'].get('refused') == 'ownership_unproven',
            'final_symlink_refused': 'refused' in cases['final_component_symlink'],
            'parent_symlink_escaped': cases['parent_directory_symlink'].get('returned_bytes') == outside['owned'],
            'multi_level_symlink_escaped': cases['multi_level_symlink'].get('returned_bytes') == outside['deeper'],
            'wildcard_matched_another_object': cases['like_wildcard_key'].get('returned_bytes') == outside['axb'],
            'offsite_left_external': cases['offsite_url'].get('classified') == 'external',
            'scheduled_swap_returned_outside_bytes': cases['scheduled_parent_swap'].get('returned_outside_bytes') is True,
            'scheduled_swap_refused': 'refused' in cases['scheduled_parent_swap'],
            'unknown_bytes_never_returned': cases['scheduled_parent_swap'].get('returned_unknown_bytes') is False
        }
        report['status'] = 'recorded'
        report['stage'] = 'complete'
    except Exception as error:
        safe = str(error) if isinstance(error, RuntimeError) and re.fullmatch(r'[\x20-\x7e]+', str(error)) else type(error).__name__
        report['failure'] = {'stage': report['stage'], 'code': safe[:200]}
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
        subprocess.run(['docker', 'rm', '--force', '--volumes', container], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        report['checked_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        report['source_head'] = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True, capture_output=True).stdout.strip()
        report['source_dirty'] = subprocess.run(['git', 'status', '--porcelain'], cwd=ROOT, text=True, capture_output=True).stdout.strip() != ''
        report['evidence_dir'] = str(EVIDENCE)
        (EVIDENCE / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({'status': report['status'], 'failure': report.get('failure'),
                          'verdict': report.get('verdict'), 'evidence': str(EVIDENCE)}, ensure_ascii=False))
    return 0 if report['status'] == 'recorded' else 1


if __name__ == '__main__':
    sys.exit(main())

"""Reconciliation-ordering barriers for P09, against a real MySQL ledger.

A disposable mysql:8.0 holds the real P09 ledger (built by the candidate migrations through knex, with
the restricted-role grants applied as in the full acceptance). The barriers themselves run in
dev/p09-lab/reconcile-order.cjs: the real store, the real service and the real snapshot reader, with a
synthetic source project — the race under test is in the ledger and the reconciliation order.

Also runs the upgrade isolation drill for the candidate column addition: an emulated older install is
migrated forward and must keep its rows. Nothing is promoted; migrations stay in migrations-candidates.
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
EVIDENCE = ROOT / 'storage/private/p09-validation' / time.strftime('order-%Y%m%dT%H%M%SZ', time.gmtime())
MYSQL_IMAGE = 'mysql:8.0'
CANDIDATES = ROOT / 'backend/migrations-candidates/p09'
NODE_SQL = """const mysql=require('./backend/node_modules/mysql2/promise');let s='';
process.stdin.on('data',b=>s+=b).on('end',async()=>{const c=JSON.parse(s);
const db=await mysql.createConnection({host:c.host,port:c.port,user:c.user,password:c.password,database:c.database||undefined,multipleStatements:true,charset:'utf8mb4'});
const out=[];try{for(const q of c.queries){const [rows]=await db.query(q.sql,q.params||[]);out.push(Array.isArray(rows)?rows:{affected:rows.affectedRows});}}
finally{await db.end();}process.stdout.write(JSON.stringify(out));});"""
NODE_KNEX = """const c=JSON.parse(require('fs').readFileSync(0,'utf8'));
const knex=require('./backend/node_modules/knex')({client:'mysql2',connection:{host:'127.0.0.1',port:c.port,user:c.user,password:c.password,database:c.database,charset:'utf8mb4'},
migrations:{directory:c.directory,tableName:'knex_migrations'}});
(async()=>{try{const r=c.one?await knex.migrate.up():await knex.migrate.latest();
process.stdout.write(JSON.stringify({files:(r[1]||[]).map(f=>require('path').basename(f))}));}
catch(e){process.stdout.write(JSON.stringify({error:String(e.code||e.message).slice(0,160)}));process.exitCode=1;}finally{await knex.destroy();}})();"""


def need(condition, label):
    if not condition:
        raise RuntimeError(label)


def node(script, payload, timeout=180, redact=()):
    process = subprocess.run(['node', '-e', script], cwd=ROOT, input=json.dumps(payload), text=True,
                             capture_output=True, timeout=timeout)
    if process.returncode:
        lines = [line.strip() for line in process.stderr.strip().splitlines() if line.strip()]
        for value in redact:
            if value:
                lines = [line.replace(value, '<redacted>') for line in lines]
        raise RuntimeError('node_failed_' + re.sub(r'[^A-Za-z0-9_]', '', lines[-1] if lines else 'unknown')[:60])
    text = process.stdout.strip()
    start = min([i for i in (text.find('{'), text.find('[')) if i >= 0], default=-1)
    return json.loads(text[start:]) if start >= 0 else text


def main():
    os.umask(0o077)
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    report = {'status': 'failed', 'stage': 'setup',
              'real': ['mysql:8.0 (disposable container, random port, random database and account)',
                       'P09 candidate migrations applied by knex', 'the real WebsiteArtifactStore/service/snapshot reader'],
              'synthetic': ['the source project and its pages (in-memory fixture)', 'the user record',
                            'the scheduling barriers (a gate around the source read, and a save injected inside the read)'],
              'barriers': [], 'upgrade_drill': None}
    container = 'p09-order-' + uuid.uuid4().hex[:8]
    root_password = secrets.token_urlsafe(24)
    scratch = tempfile.mkdtemp(prefix='p09-order-')
    try:
        report['stage'] = 'database'
        subprocess.run(['docker', 'image', 'inspect', MYSQL_IMAGE], check=True, stdout=subprocess.DEVNULL, timeout=15)
        subprocess.run(['docker', 'run', '-d', '--pull=never', '--name', container, '--label', 'pkuailab.task=p09-order',
                        '-p', '127.0.0.1::3306', '-e', 'MYSQL_ROOT_PASSWORD', MYSQL_IMAGE],
                       env={**os.environ, 'MYSQL_ROOT_PASSWORD': root_password}, check=True, stdout=subprocess.DEVNULL, timeout=60)
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            probe = subprocess.run(['docker', 'exec', container, 'mysqladmin', '--host=127.0.0.1', 'ping', '--silent'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if probe.returncode == 0:
                time.sleep(1.5)
                if subprocess.run(['docker', 'exec', container, 'mysqladmin', '--host=127.0.0.1', 'ping', '--silent'],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                    break
            time.sleep(.4)
        else:
            need(False, 'database_start_timeout')
        port = int(subprocess.run(['docker', 'port', container, '3306/tcp'], text=True, capture_output=True).stdout.strip().rsplit(':', 1)[1])
        mysql = {'host': '127.0.0.1', 'port': port, 'user': 'root', 'password': root_password}
        app_user = 'p09_ord_' + secrets.token_hex(3)
        app_password = secrets.token_urlsafe(24)

        def sql(queries, database=None, user=None, password=None):
            return node(NODE_SQL, dict(mysql, database=database, user=user or mysql['user'],
                                       password=password or mysql['password'],
                                       queries=[q if isinstance(q, dict) else {'sql': q} for q in queries]),
                        redact=[root_password, app_password])

        migrations = Path(scratch) / 'migrations'
        migrations.mkdir()
        for candidate in sorted(CANDIDATES.glob('*.js')):
            portable = candidate.read_text().replace(
                "require('../../src/services/websiteArtifact/store')",
                'require(' + json.dumps(str(ROOT / 'backend/src/services/websiteArtifact/store')) + ')')
            (migrations / candidate.name).write_text(portable)
        report['migration_files'] = [p.name for p in sorted(migrations.glob('*.js'))]

        def build(database):
            sql([f'CREATE DATABASE `{database}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'])
            sql([f"CREATE USER IF NOT EXISTS '{app_user}'@'%' IDENTIFIED BY '{app_password}'",
                 f"GRANT ALL PRIVILEGES ON `{database}`.* TO '{app_user}'@'%'"])

        # ---- the ledger the barriers run against -------------------------------------------------
        database = 'p09_order_' + secrets.token_hex(3)
        build(database)
        applied = node(NODE_KNEX, {'port': port, 'user': app_user, 'password': app_password,
                                   'database': database, 'directory': str(migrations)})
        need(applied.get('files') == report['migration_files'], 'migrations_not_applied_' + json.dumps(applied))
        tables = sql([f"SELECT table_name AS t FROM information_schema.tables WHERE table_schema='{database}' AND table_name LIKE 'p09\\\\_%'"], database=database)[0]
        need(len(tables) == 8, 'ledger_tables_' + str(len(tables)))

        # ---- upgrade isolation drill: an emulated older install keeps its rows -------------------
        report['stage'] = 'upgrade_drill'
        if len(report['migration_files']) > 1:
            older = 'p09_upgrade_' + secrets.token_hex(3)
            build(older)
            first = node(NODE_KNEX, {'port': port, 'user': app_user, 'password': app_password,
                                     'database': older, 'directory': str(migrations), 'one': True})
            need(first.get('files') == report['migration_files'][:1], 'first_migration_' + json.dumps(first))
            columns = sql(["SELECT column_name AS c FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='p09_links'"], database=older)[0]
            added = [c['c'] for c in columns if c['c'] in ('write_seq', 'applied_write_seq')]
            # Emulate the deployed v2 shape: drop what the (now newer) first migration already creates.
            for column in added:
                sql([f'ALTER TABLE p09_links DROP COLUMN {column}'], database=older)
            sql([{'sql': """INSERT INTO p09_links(id,source_instance,artifact_ref,project_ref,entry_ref,owner_user_id,student_uuid,
                    project_id,entry_page_id,assignment_ref,school_ref,issuer_key,grant_id,state,work_state,created_at,updated_at)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                  'params': [str(uuid.uuid4()), 'practice-upgrade', str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4()),
                             101, 'edu-uuid-0001', 3, 7, 'assign-upgrade', 'school-1', 'edu:k1', str(uuid.uuid4()),
                             'active', 'linked', 1790000000000, 1790000000000]}], database=older)
            second = node(NODE_KNEX, {'port': port, 'user': app_user, 'password': app_password,
                                      'database': older, 'directory': str(migrations), 'one': True})
            need(second.get('files') == report['migration_files'][1:2], 'second_migration_' + json.dumps(second))
            after = sql(["SELECT column_name AS c, column_default AS d FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='p09_links' AND column_name IN ('write_seq','applied_write_seq')",
                         "SELECT id, write_seq, applied_write_seq, state FROM p09_links"], database=older)
            report['upgrade_drill'] = {'emulated_columns_dropped': added,
                                       'columns_after_upgrade': [row['c'] for row in after[0]],
                                       'rows_preserved': len(after[1]),
                                       'defaults': {row['c']: row['d'] for row in after[0]},
                                       'row_values': [{k: (int(v) if isinstance(v, (int, float)) else v) for k, v in row.items() if k != 'id'} for row in after[1]]}
            need(sorted(report['upgrade_drill']['columns_after_upgrade']) == ['applied_write_seq', 'write_seq'], 'upgrade_columns_missing')
            need(report['upgrade_drill']['rows_preserved'] == 1, 'upgrade_lost_rows')

        # ---- the barriers -------------------------------------------------------------------------
        report['stage'] = 'barriers'
        connection = {'host': '127.0.0.1', 'port': port, 'user': app_user, 'password': app_password, 'database': database}
        process = subprocess.run(['node', 'dev/p09-lab/reconcile-order.cjs'], cwd=ROOT, text=True, capture_output=True,
                                 input=json.dumps({'connection': connection}), timeout=600)
        stderr = process.stderr.replace(app_password, '<redacted>').replace(root_password, '<redacted>')
        (EVIDENCE / 'barriers.log').write_text(stderr[-20000:])
        need(process.returncode == 0, 'barrier_script_failed')
        report['barriers'] = json.loads(process.stdout[process.stdout.find('['):])
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
        print(json.dumps({'status': report['status'], 'failure': report.get('failure'), 'evidence': str(EVIDENCE)}, ensure_ascii=False))
    return 0 if report['status'] == 'recorded' else 1


if __name__ == '__main__':
    sys.exit(main())

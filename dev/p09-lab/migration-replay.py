"""Replay checks for the P09 candidate migration 002, on a real MySQL ledger.

A migration may be run again — after a rollback, after a lost migration record, or by hand. It must then
add what is missing and touch nothing else: the difference between `write_seq` and `applied_write_seq`
is a work's outstanding reconciliation, and only business reconciliation may close it. These cases run
the real migration function against real databases:

  fresh            001 creates the columns; 002 is a no-op and stays one when it runs again
  missing_both     an older ledger gains both columns in one statement; rows, counters and markers stay
  backlog_replay   columns already there with 7/3 and a marker — a replay must still read 7/3
  half_write_only  only write_seq exists (an interrupted DDL): the new column starts outstanding
  half_applied_only only applied_write_seq exists: nothing may be claimed, everything is re-verified
  interrupted      an interrupted run followed by a second one: nothing lost, still conservative
  swept            the outstanding work a conservative migration leaves is cleared by the real service

Nothing here promotes the migration; everything runs in a disposable container.
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
EVIDENCE = ROOT / 'storage/private/p09-validation' / time.strftime('migration-%Y%m%dT%H%M%SZ', time.gmtime())
MYSQL_IMAGE = 'mysql:8.0'
CANDIDATES = ROOT / 'backend/migrations-candidates/p09'
COLUMNS = ('write_seq', 'applied_write_seq')
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
    report = {'status': 'failed', 'stage': 'setup', 'cases': [],
              'real': ['mysql:8.0 (disposable container)', 'the candidate migrations through knex',
                       'the real migration function (up/down) and, for the last case, the real service sweep'],
              'synthetic': ['the ledger rows (written by this script or by one real link through the service)',
                            'the source project of the swept case (in-memory fixture)']}
    container = 'p09-migration-' + uuid.uuid4().hex[:8]
    root_password = secrets.token_urlsafe(24)
    scratch = tempfile.mkdtemp(prefix='p09-migration-')
    try:
        report['stage'] = 'database'
        subprocess.run(['docker', 'image', 'inspect', MYSQL_IMAGE], check=True, stdout=subprocess.DEVNULL, timeout=15)
        subprocess.run(['docker', 'run', '-d', '--pull=never', '--name', container, '--label', 'pkuailab.task=p09-migration',
                        '-p', '127.0.0.1::3306', '-e', 'MYSQL_ROOT_PASSWORD', MYSQL_IMAGE],
                       env={**os.environ, 'MYSQL_ROOT_PASSWORD': root_password}, check=True, stdout=subprocess.DEVNULL, timeout=60)
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            if subprocess.run(['docker', 'exec', container, 'mysqladmin', '--host=127.0.0.1', 'ping', '--silent'],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                time.sleep(1.5)
                break
            time.sleep(.4)
        else:
            need(False, 'database_start_timeout')
        port = int(subprocess.run(['docker', 'port', container, '3306/tcp'], text=True, capture_output=True).stdout.strip().rsplit(':', 1)[1])
        mysql_root = {'host': '127.0.0.1', 'port': port, 'user': 'root', 'password': root_password}
        app_user = 'p09_mig_' + secrets.token_hex(3)
        app_password = secrets.token_urlsafe(24)

        def sql(queries, database=None, redact_extra=()):
            return node(NODE_SQL, dict(mysql_root, database=database,
                                       queries=[q if isinstance(q, dict) else {'sql': q} for q in queries]),
                        redact=[root_password, app_password, *redact_extra])

        migrations = Path(scratch) / 'migrations'
        migrations.mkdir()
        for candidate in sorted(CANDIDATES.glob('*.js')):
            (migrations / candidate.name).write_text(candidate.read_text().replace(
                "require('../../src/services/websiteArtifact/store')",
                'require(' + json.dumps(str(ROOT / 'backend/src/services/websiteArtifact/store')) + ')'))
        files = [p.name for p in sorted(migrations.glob('*.js'))]
        report['migration_files'] = files
        sql([f"CREATE USER '{app_user}'@'%' IDENTIFIED BY '{app_password}'"])

        def database_for(name):
            database = f'p09_{name}_' + secrets.token_hex(3)
            sql([f'CREATE DATABASE `{database}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
                 f"GRANT ALL PRIVILEGES ON `{database}`.* TO '{app_user}'@'%'"])
            return database

        def knex_migrate(database, one=False):
            return node(NODE_KNEX, {'port': port, 'user': app_user, 'password': app_password,
                                    'database': database, 'directory': str(migrations), 'one': one})

        def helper(op, database, work=None):
            return node('dev/p09-lab/migration-replay.cjs',
                        {'op': op, 'connection': {'host': '127.0.0.1', 'port': port, 'user': app_user,
                                                  'password': app_password, 'database': database}, 'work': work},
                        redact=[app_password, root_password], is_file=True)

        def columns(database):
            rows = sql(["SELECT column_name AS c, column_default AS d FROM information_schema.columns "
                        "WHERE table_schema=DATABASE() AND table_name='p09_links' AND column_name IN ('write_seq','applied_write_seq') ORDER BY 1"],
                       database=database)[0]
            return {row['c']: row['d'] for row in rows}

        def links(database):
            # A half state has one of the two columns missing, so ask for what is actually there.
            present = columns(database)
            selected = ', '.join(['id', 'sync_pending_at', 'state', 'real_save_count', *present])
            rows = sql([f'SELECT {selected} FROM p09_links ORDER BY created_at'], database=database)[0]
            return [{'write_seq': int(r['write_seq']) if r.get('write_seq') is not None else None,
                     'applied_write_seq': int(r['applied_write_seq']) if r.get('applied_write_seq') is not None else None,
                     'marker': None if r['sync_pending_at'] is None else int(r['sync_pending_at']),
                     'state': r['state'], 'real_save_count': int(r['real_save_count'])} for r in rows]

        def seed_row(database, assignment, write_seq=None, applied=None, marker=None, project_id=3):
            row_id = str(uuid.uuid4())
            base = """INSERT INTO p09_links(id,source_instance,artifact_ref,project_ref,entry_ref,owner_user_id,student_uuid,
                project_id,entry_page_id,assignment_ref,school_ref,issuer_key,grant_id,state,work_state,created_at,updated_at,
                real_save_count,sync_pending_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"""
            sql([{'sql': base, 'params': [row_id, 'practice-migration', str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4()),
                                          101, 'edu-uuid-0001', project_id, 7, assignment, 'school-1', 'edu:k1', str(uuid.uuid4()),
                                          'active', 'linked', 1790000000000, 1790000000000, 2, marker]}], database=database)
            updates = []
            if write_seq is not None:
                updates.append(f'write_seq={int(write_seq)}')
            if applied is not None:
                updates.append(f'applied_write_seq={int(applied)}')
            if updates:
                sql([f"UPDATE p09_links SET {','.join(updates)} WHERE id='{row_id}'"], database=database)
            return row_id

        # ---- 1. a fresh ledger: 001 already has the columns, 002 changes nothing, twice ------------
        report['stage'] = 'fresh'
        fresh = database_for('fresh')
        need(knex_migrate(fresh).get('files') == files, 'fresh_migrations')
        seed_row(fresh, 'assign-fresh', write_seq=4, applied=1, marker=1790000001000)
        before = links(fresh)
        first = helper('up', fresh)
        again = helper('up', fresh)
        after = links(fresh)
        report['cases'].append({'case': 'fresh_then_replay', 'columns': columns(fresh), 'before': before, 'after': after,
                                'migration': [first, again],
                                'difference_preserved': before == after})

        # ---- 2. an older ledger missing both columns ----------------------------------------------
        report['stage'] = 'missing_both'
        older = database_for('older')
        need(knex_migrate(older, one=True).get('files') == files[:1], 'older_first_migration')
        for column in COLUMNS:
            sql([f'ALTER TABLE p09_links DROP COLUMN {column}'], database=older)
        seed_row(older, 'assign-older', marker=1790000002000)
        ran = helper('up', older)
        report['cases'].append({'case': 'missing_both_columns', 'columns': columns(older), 'rows': links(older),
                                'migration': ran})

        # ---- 3. columns already there, with an outstanding backlog and a marker --------------------
        report['stage'] = 'backlog_replay'
        backlog = database_for('backlog')
        need(knex_migrate(backlog).get('files') == files, 'backlog_migrations')
        seed_row(backlog, 'assign-backlog', write_seq=7, applied=3, marker=None)
        seed_row(backlog, 'assign-marked', write_seq=9, applied=9, marker=1790000003000, project_id=4)
        before = links(backlog)
        ran = helper('up', backlog)
        after = links(backlog)
        report['cases'].append({'case': 'backlog_replay', 'before': before, 'after': after, 'migration': ran,
                                'difference_preserved': before == after,
                                'erased_backlog': any(b['applied_write_seq'] != a['applied_write_seq'] for b, a in zip(before, after))})

        # ---- 4./5. half states: an interrupted DDL left one column behind --------------------------
        for case, dropped in (('half_write_only', 'applied_write_seq'), ('half_applied_only', 'write_seq')):
            report['stage'] = case
            database = database_for(case)
            need(knex_migrate(database).get('files') == files, case + '_migrations')
            seed_row(database, 'assign-' + case, write_seq=5, applied=5, marker=1790000004000)
            # A second work with no marker at all: in the applied-only half state the migration has to
            # mark it for reconciliation rather than leave an unverifiable claim standing.
            seed_row(database, 'assign-' + case + '-unmarked', write_seq=5, applied=5, marker=None, project_id=4)
            sql([f'ALTER TABLE p09_links DROP COLUMN {dropped}'], database=database)
            before = links(database)
            ran = helper('up', database)
            after = links(database)
            second = helper('up', database)
            report['cases'].append({'case': case, 'dropped': dropped, 'before': before, 'after': after,
                                    'after_second_up': links(database), 'migration': [ran, second],
                                    'columns': columns(database)})

        # ---- 6. the outstanding work a conservative migration leaves is cleared by the service -----
        report['stage'] = 'swept'
        swept = database_for('swept')
        need(knex_migrate(swept).get('files') == files, 'swept_migrations')
        work = {'sourceInstance': 'practice-migration', 'schoolRef': 'school-1', 'ownerUserId': 101,
                'projectId': 3, 'entryPageId': 7, 'html': '<h1>作品</h1><p>真实服务扫一遍</p>', 'assignmentRef': 'assign-swept'}
        helper('seed', swept, work)
        sql(["UPDATE p09_links SET applied_write_seq=0, sync_pending_at=NULL"], database=swept)
        before = links(swept)
        ran = helper('up', swept)
        after_migration = links(swept)
        swept_result = helper('sweep', swept, work)
        report['cases'].append({'case': 'outstanding_cleared_by_service', 'before': before,
                                'after_migration': after_migration, 'migration': ran,
                                'after_sweep': links(swept), 'service': swept_result})
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

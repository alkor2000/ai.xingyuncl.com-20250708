"""Isolated rehearsal of the P03 ledger migration candidate and the restricted role on a disposable mysql:8.0.

Pre-image: the schema (no data) plus the knex_migrations rows of the local production copy (practice-mysql),
so knex sees exactly what production would: every recorded migration present, only the candidate pending.
Steps: migrate up -> post-image, byte equality with mysqlStore.SCHEMA applied directly, idempotent re-run,
restricted role passes the runtime readiness probe while ALL PRIVILEGES / partial / wrong-database / missing
table are refused, backup -> down -> restore -> ready again, partial pre-existing table, failing migrator.
Credentials stay in environment/stdin; evidence holds only SHAs, counts and fixed codes.
"""
import hashlib
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

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / 'backend'
CANDIDATE = BACKEND / 'migrations-candidates/p03/20260921_001_p03_handoff_ledger.js'
EVIDENCE = ROOT / 'storage/private/p03-handoff-validation/ledger-migration'
TABLES = ['p03_handoff_owners', 'p03_handoff_operations', 'p03_handoff_snapshots', 'p03_handoff_keys']
LOCAL = {'container': 'practice-mysql'}


def sha(data):
    return hashlib.sha256(data if isinstance(data, bytes) else data.encode()).hexdigest()


def dotenv():
    values = {}
    for line in (BACKEND / '.env').read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            values[k.strip()] = v.strip().strip('"').strip("'")
    return values


def main():
    os.umask(0o077)
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    local = dotenv()
    for key in ['DB_USER', 'DB_PASSWORD', 'DB_NAME']:
        assert local.get(key), 'local_env_incomplete'
    name = 'p03-ledger-' + uuid.uuid4().hex[:12]
    root_password = secrets.token_urlsafe(32)
    result = {'status': 'failed', 'stage': 'setup', 'candidate_sha256': sha(CANDIDATE.read_bytes()), 'candidate_path': str(CANDIDATE.relative_to(ROOT)),
              'mysqlstore_sha256': sha((BACKEND / 'src/services/artifactHandoff/mysqlStore.js').read_bytes()),
              'source_head': subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True, capture_output=True).stdout.strip(), 'steps': []}
    steps = result['steps']

    def step(label, **facts):
        steps.append({'step': label, **facts})
        print(label, json.dumps(facts, ensure_ascii=False)[:200], flush=True)

    def mysql(sql, database=None, user='root', password=None, ok=True):
        args = ['docker', 'exec', '-i', '-e', 'MYSQL_PWD=' + (password if password is not None else root_password), name, 'mysql', '-N', '-B', '-u' + user]
        if database:
            args.append(database)
        p = subprocess.run(args, input=sql, text=True, capture_output=True, timeout=120)
        if ok and p.returncode:
            raise RuntimeError('lab_sql_failed')
        return p

    try:
        subprocess.run(['docker', 'image', 'inspect', 'mysql:8.0'], check=True, stdout=subprocess.DEVNULL, timeout=10)
        subprocess.run(['docker', 'run', '-d', '--pull=never', '--name', name, '--label', 'pkuailab.task=p03-ledger', '-p', '127.0.0.1::3306', '-e', 'MYSQL_ROOT_PASSWORD',
                        'mysql:8.0'], env={**os.environ, 'MYSQL_ROOT_PASSWORD': root_password}, check=True, stdout=subprocess.DEVNULL, timeout=30)
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            if subprocess.run(['docker', 'exec', name, 'mysqladmin', '--host=127.0.0.1', 'ping', '--silent'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5).returncode == 0:
                time.sleep(1.5)
                if subprocess.run(['docker', 'exec', name, 'mysqladmin', '--host=127.0.0.1', 'ping', '--silent'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5).returncode == 0:
                    break
            time.sleep(.3)
        else:
            raise RuntimeError('database_start_timeout')
        port = int(subprocess.run(['docker', 'port', name, '3306/tcp'], text=True, capture_output=True, timeout=10).stdout.strip().rsplit(':', 1)[1])
        result['stage'] = 'preimage'
        # Schema-only pre-image (no rows) plus the knex_migrations bookkeeping rows from the local production copy.
        dump = subprocess.run(['docker', 'exec', '-e', 'MYSQL_PWD=' + local['DB_PASSWORD'], LOCAL['container'], 'mysqldump', '-u' + local['DB_USER'], '--no-data',
                               '--skip-triggers', '--skip-add-drop-table', '--set-gtid-purged=OFF', local['DB_NAME']], capture_output=True, timeout=300)
        if dump.returncode:
            raise RuntimeError('local_schema_dump_failed')
        rows = subprocess.run(['docker', 'exec', '-e', 'MYSQL_PWD=' + local['DB_PASSWORD'], LOCAL['container'], 'mysqldump', '-u' + local['DB_USER'], '--no-create-info',
                               '--skip-triggers', '--set-gtid-purged=OFF', local['DB_NAME'], 'knex_migrations', 'knex_migrations_lock'], capture_output=True, timeout=120)
        if rows.returncode:
            raise RuntimeError('local_knex_rows_dump_failed')
        preimage = re.sub(rb'-- (Dump completed on|Host:|Server version|MySQL dump).*', b'', re.sub(rb'AUTO_INCREMENT=\d+ ', b'', dump.stdout))  # stable, address-free pre-image
        assert not any(t.encode() in preimage for t in TABLES), 'preimage_already_has_ledger_tables'
        db = 'ai_platform_lab'
        mysql(f'CREATE DATABASE `{db}` CHARACTER SET utf8mb4;')
        mysql(preimage.decode(), db)
        mysql(rows.stdout.decode(), db)
        tables_before = mysql(f"SELECT table_name FROM information_schema.tables WHERE table_schema='{db}' ORDER BY 1", db).stdout
        recorded = mysql('SELECT COUNT(*) FROM knex_migrations', db).stdout.strip()
        step('preimage_loaded', tables=len(tables_before.split()), knex_recorded_migrations=int(recorded), preimage_sha256=sha(preimage), knex_rows_sha256=sha(rows.stdout))
        result['stage'] = 'migrate_up'
        with tempfile.TemporaryDirectory(prefix='p03-ledger-') as temp:
            tmp = Path(temp)
            migrations = tmp / 'migrations'
            shutil.copytree(BACKEND / 'migrations', migrations)  # every recorded file present, as in production
            # The candidate requires mysqlStore relative to backend/migrations-candidates/p03; point the copies at the same module.
            portable = CANDIDATE.read_text().replace("require('../../src/services/artifactHandoff/mysqlStore')", f"require({json.dumps(str(BACKEND / 'src/services/artifactHandoff/mysqlStore'))})")
            (migrations / CANDIDATE.name).write_text(portable)
            only = tmp / 'candidate-only'  # for side databases without the production pre-image
            only.mkdir()
            (only / CANDIDATE.name).write_text(portable)
            # knex is driven programmatically (same library the CLI uses) with the connection on stdin, never in argv.
            connection = {'user': 'root', 'password': root_password, 'database': db, 'directory': str(migrations)}

            def write_knexfile(user, password, database=db, directory=None):
                connection.update(user=user, password=password, database=database, directory=str(directory or migrations))
            KNEX_JS = ("const c=JSON.parse(require('fs').readFileSync(0,'utf8'));const knex=require('knex')({client:'mysql2',connection:{host:'127.0.0.1',port:c.port,user:c.user,password:c.password,database:c.database,charset:'utf8mb4'},"
                       "migrations:{directory:c.directory,tableName:'knex_migrations'}});(async()=>{try{let out;"
                       "if(c.command==='list'){const [done,pending]=await knex.migrate.list();out={completed:done.map(x=>x.name||x),pending:pending.map(x=>x.file||x.name||x)};}"
                       "else if(c.command==='latest'){const [batch,files]=await knex.migrate.latest();out={batch,applied:files};}"
                       "else if(c.command==='rollback'){const [batch,files]=await knex.migrate.rollback();out={batch,rolled_back:files};}"
                       "console.log(JSON.stringify(out));}catch(e){console.log(JSON.stringify({error:(e.code||e.name||'error')}));process.exitCode=1;}finally{await knex.destroy();}})();")

            def knex(command, ok=True):
                p = subprocess.run(['node', '-e', KNEX_JS], cwd=BACKEND, text=True, capture_output=True, timeout=300, input=json.dumps({**connection, 'port': port, 'command': command}),
                                   env={**os.environ, 'NODE_ENV': 'development'})
                out = json.loads(p.stdout.strip().splitlines()[-1]) if p.stdout.strip() else {'error': 'no_output'}
                if ok and (p.returncode or 'error' in out):
                    result['knex_failure_hint'] = str(out.get('error', ''))[:120]
                    raise RuntimeError('knex_failed_' + command)
                return out
            listing = knex('list')
            assert [Path(x).name for x in listing['pending']] == [CANDIDATE.name] and len(listing['completed']) == int(recorded), 'unexpected_pending_set'
            up = knex('latest')
            assert [Path(x).name for x in up['applied']] == [CANDIDATE.name], 'candidate_not_applied'
            def create(database=db):
                return '\n'.join(mysql(f'SHOW CREATE TABLE `{t}`', database).stdout.split('\t', 1)[-1] for t in TABLES)
            postimage = create()
            tables_after = mysql(f"SELECT table_name FROM information_schema.tables WHERE table_schema='{db}' ORDER BY 1", db).stdout
            assert set(tables_after.split()) - set(tables_before.split()) == set(TABLES), 'unexpected_table_delta'
            step('migrate_up', applied=CANDIDATE.name, new_tables=TABLES, postimage_sha256=sha(postimage), other_tables_unchanged=True,
                 knex_recorded_migrations=int(mysql('SELECT COUNT(*) FROM knex_migrations', db).stdout.strip()))
            # Byte equality with the store's own DDL applied directly.
            mysql('CREATE DATABASE `equiv` CHARACTER SET utf8mb4;')
            node = subprocess.run(['node', '-e', "const {SCHEMA}=require('./src/services/artifactHandoff/mysqlStore');process.stdout.write(JSON.stringify(SCHEMA));"], cwd=BACKEND, text=True, capture_output=True, check=True)
            for statement in json.loads(node.stdout):
                mysql(statement + ';', 'equiv')
            assert create('equiv') == postimage, 'schema_differs_from_store_ddl'
            step('schema_equivalence', equal_to_mysqlstore_schema=True)
            again = knex('latest')
            assert again['applied'] == [], 'not_idempotent'
            node_up = subprocess.run(['node', '-e', f"const knex=require('knex')({json.dumps({'client': 'mysql2', 'connection': {'host': '127.0.0.1', 'port': port, 'user': 'root', 'password': root_password, 'database': db}})});"
                                      f"require({json.dumps(str(migrations / CANDIDATE.name))}).up(knex).then(()=>knex.destroy());"], cwd=BACKEND, text=True, capture_output=True, timeout=60)
            assert node_up.returncode == 0 and create() == postimage, 'direct_up_not_idempotent'
            step('idempotent', knex_rerun='Already up to date', direct_up_rerun='no change')
            result['stage'] = 'roles'
            grants = subprocess.run(['node', '-e', "const {restrictedRoleGrants}=require('./src/services/artifactHandoff/mysqlStore');process.stdout.write(JSON.stringify(restrictedRoleGrants({database:'" + db + "',user:'p03_handoff_lab',host:'%'})));"],
                                    cwd=BACKEND, text=True, capture_output=True, check=True)
            passwords = {u: secrets.token_urlsafe(24) for u in ['p03_handoff_lab', 'app_like', 'partial_role']}
            mysql(f"CREATE USER 'p03_handoff_lab'@'%' IDENTIFIED BY '{passwords['p03_handoff_lab']}';")
            for statement in json.loads(grants.stdout):
                mysql(statement + ';')
            mysql(f"CREATE USER 'app_like'@'%' IDENTIFIED BY '{passwords['app_like']}'; GRANT ALL PRIVILEGES ON `{db}`.* TO 'app_like'@'%';")
            mysql(f"CREATE USER 'partial_role'@'%' IDENTIFIED BY '{passwords['partial_role']}';")
            for statement in json.loads(grants.stdout)[:-1]:
                mysql(statement.replace('p03_handoff_lab', 'partial_role') + ';')

            def probe(user, database=db, expected_database=None):
                script = ("const {probeLedger}=require('./src/services/artifactHandoff/formalRuntime');const c=JSON.parse(require('fs').readFileSync(0,'utf8'));"
                          "const pool=require('mysql2/promise').createPool({host:'127.0.0.1',port:c.port,user:c.user,password:c.password,database:c.database,connectionLimit:2});"
                          "probeLedger(pool,c.expected).then(f=>{console.log(JSON.stringify({ready:true,grant_count:f.grant_count}));return pool.end();})"
                          ".catch(e=>{console.log(JSON.stringify({ready:false,code:e.code||'unclassified'}));return pool.end();});")
                p = subprocess.run(['node', '-e', script], cwd=BACKEND, text=True, capture_output=True, timeout=60,
                                   input=json.dumps({'port': port, 'user': user, 'password': passwords.get(user, root_password), 'database': database, 'expected': expected_database or database}))
                return json.loads(p.stdout.strip().splitlines()[-1])
            outcomes = {'restricted_role': probe('p03_handoff_lab'), 'all_privileges_account': probe('app_like'), 'partial_role': probe('partial_role'),
                        'root_account': probe('root'), 'wrong_expected_database': probe('p03_handoff_lab', expected_database='other_db')}
            assert outcomes['restricted_role'] == {'ready': True, 'grant_count': 5}, 'restricted_role_not_ready'
            assert outcomes['all_privileges_account']['code'] == 'handoff_ledger_role_too_broad', 'broad_role_accepted'
            assert outcomes['partial_role']['code'] == 'handoff_ledger_role_missing', 'partial_role_accepted'
            assert outcomes['root_account']['code'] == 'handoff_ledger_role_too_broad', 'root_accepted'
            assert outcomes['wrong_expected_database']['code'] == 'handoff_ledger_database_mismatch', 'wrong_database_accepted'
            # The restricted role cannot alter the ledger or read anything else.
            denied = {}
            for label, sql in {'drop_table': f'DROP TABLE `{TABLES[3]}`', 'create_table': 'CREATE TABLE p03_probe(id INT)', 'read_users': 'SELECT COUNT(*) FROM users',
                               'alter_table': f'ALTER TABLE `{TABLES[0]}` ADD COLUMN probe INT', 'grant_self': 'GRANT ALL ON *.* TO CURRENT_USER()'}.items():
                p = mysql(sql + ';', db, user='p03_handoff_lab', password=passwords['p03_handoff_lab'], ok=False)
                denied[label] = p.returncode != 0 and ('denied' in p.stderr or 'access' in p.stderr.lower())
            assert all(denied.values()), 'restricted_role_not_restricted'
            step('roles', **{k: v for k, v in outcomes.items()}, privilege_probes_denied=denied)
            result['stage'] = 'missing_table_and_restore'
            backup = subprocess.run(['docker', 'exec', '-e', 'MYSQL_PWD=' + root_password, name, 'mysqldump', '-uroot', '--set-gtid-purged=OFF', db, *TABLES], capture_output=True, timeout=120)
            assert backup.returncode == 0, 'backup_failed'
            mysql(f'DROP TABLE `{TABLES[3]}`;', db)
            missing = probe('p03_handoff_lab')
            assert missing['code'] == 'handoff_ledger_table_missing', 'missing_table_accepted'
            rollback = knex('rollback')
            assert [Path(x).name for x in rollback['rolled_back']] == [CANDIDATE.name], 'rollback_set_unexpected'
            assert not set(TABLES) & set(mysql(f"SELECT table_name FROM information_schema.tables WHERE table_schema='{db}'", db).stdout.split()), 'down_left_tables'
            assert set(mysql(f"SELECT table_name FROM information_schema.tables WHERE table_schema='{db}' ORDER BY 1", db).stdout.split()) == set(tables_before.split()), 'down_touched_other_tables'
            mysql(backup.stdout.decode(), db)  # restore the four tables from the backup taken before the drop
            restored = create()
            assert restored == postimage and probe('p03_handoff_lab')['ready'] is True, 'restore_not_equivalent'
            relist = knex('list')
            assert [Path(x).name for x in relist['pending']] == [CANDIDATE.name], 'knex_state_after_restore_unexpected'
            reup = knex('latest')
            assert [Path(x).name for x in reup['applied']] == [CANDIDATE.name] and create() == postimage, 'reup_after_restore_changed_schema'
            step('missing_table_then_backup_down_restore', missing_table_code=missing['code'], down_removed_only_ledger_tables=True, restore_equals_postimage=True,
                 knex_pending_after_manual_restore=1, reup_noop=True)
            result['stage'] = 'partial_and_failing_migrator'
            mysql('CREATE DATABASE `partial` CHARACTER SET utf8mb4;')
            mysql(json.loads(node.stdout)[0] + ';', 'partial')  # only the owners table pre-exists
            write_knexfile('root', root_password, 'partial', only)
            partial_up = knex('latest')
            assert [Path(x).name for x in partial_up['applied']] == [CANDIDATE.name] and create('partial') == postimage, 'partial_state_not_completed'
            mysql('CREATE DATABASE `nocreate` CHARACTER SET utf8mb4;')
            mysql(f"CREATE USER 'migrator_weak'@'%' IDENTIFIED BY '{passwords['app_like']}'; GRANT SELECT, INSERT, UPDATE, DELETE ON `nocreate`.* TO 'migrator_weak'@'%';")
            write_knexfile('migrator_weak', passwords['app_like'], 'nocreate', only)
            weak = knex('latest', ok=False)
            assert 'error' in weak, 'weak_migrator_succeeded'
            write_knexfile('root', root_password, 'nocreate', only)
            recovered = knex('latest')
            assert [Path(x).name for x in recovered['applied']] == [CANDIDATE.name] and create('nocreate') == postimage, 'recovery_after_failed_migrator'
            step('partial_and_failing_migrator', partial_preexisting_owners_completed=True, weak_migrator_failed=weak.get('error'), root_rerun_completed=True)
        result['status'] = 'passed'
        result['stage'] = 'complete'
        result['auto_execution_facts'] = {
            'knexfile_directory': './migrations', 'candidate_directory': 'backend/migrations-candidates/p03 (not scanned by knex)',
            'docker_site': 'make deploy-docker runs knex migrate:latest before switching containers; a file in backend/migrations executes at the next deploy',
            'pm2_site': 'make migrate (manual, backup gate)', 'container_entrypoint': 'run-migrations.sh runs database/migrations/*.sql only'}
    except Exception as error:
        result['failure'] = {'type': type(error).__name__, 'label': str(error) if isinstance(error, (AssertionError, RuntimeError)) else ''}
        print('stopped at ' + result['stage'] + ': ' + type(error).__name__, flush=True)
    finally:
        subprocess.run(['docker', 'rm', '--force', '--volumes', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
        result['container_removed'] = True
        result['checked_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        (EVIDENCE / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({'status': result['status'], 'stage': result['stage']}), flush=True)
    return 0 if result['status'] == 'passed' else 1


if __name__ == '__main__':
    sys.exit(main())

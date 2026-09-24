"""候选迁移怎么执行才不污染正式迁移账本：先复现问题，再证明修法。

真实件：一次性 mysql:8.0、本机镜像库导出的**当前已发布 schema 与正式 knex_migrations 行**、
本仓自己的 knex 与 knexfile 形态、四个候选迁移文件本身。
合成件：库名与账号。

四问四答：
  1 基线：默认账本 + 正式目录 → 无待执行、正式行 10 条。
  2 反例：默认账本 + 只含四个候选的目录 → knex 应当报 "migration directory is corrupt"（正式行没有对应文件）。
  3 修法：**独立候选账本** `knex_migrations_candidates` + 候选目录 → 四个都执行，对象齐。
  4 收口：再跑一次候选 → 不重复记录；回到默认账本 + 正式目录 → 仍然"无待执行"，正式行仍是 10 条。
"""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / 'storage/private/candidate-ledger' / time.strftime('run-%Y%m%dT%H%M%SZ', time.gmtime())

import importlib.util                                                    # noqa: E402


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


c05lab = load('c05lab', ROOT / 'dev/c05-lab/check.py')
need, node, dotenv = c05lab.need, c05lab.node, c05lab.dotenv
CANDIDATE_TABLE = 'knex_migrations_candidates'

KNEX = """
const knex = require('./backend/node_modules/knex');
let s=''; process.stdin.on('data', b => s += b).on('end', async () => {
  const c = JSON.parse(s);
  const db = knex({ client: 'mysql2',
    connection: { host: '127.0.0.1', port: c.port, user: c.user, password: c.password, database: c.database, charset: 'utf8mb4' },
    migrations: { directory: c.directory, tableName: c.tableName } });
  const out = { command: c.command, directory: c.directory, tableName: c.tableName };
  try {
    if (c.command === 'status') {
      const [completed, pending] = await db.migrate.list();
      out.completed = completed.length; out.pending = pending.map(p => p.file || p);
    } else {
      const [batch, files] = await db.migrate.latest();
      out.batch = batch; out.applied = files.map(f => f.split('/').pop());
    }
    out.ok = true;
  } catch (error) { out.ok = false; out.error = String(error.message).slice(0, 200); }
  await db.destroy();
  process.stdout.write(JSON.stringify(out));
});
"""


def main():
    report = {'started_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'real': ['一次性 mysql:8.0', '本机镜像库导出的当前已发布 schema 与正式 knex_migrations 行',
                       '本仓的 knex 与 knexfile 形态', '四个候选迁移文件本身'],
              'synthetic': ['库名与账号'], 'stage': 'start', 'checks': {}, 'verdicts': {}, 'passed': False}
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    c05lab.EVIDENCE = EVIDENCE
    scratch = tempfile.mkdtemp(prefix='candidate-ledger-')
    lab = None
    verdict = lambda name, ok, detail=None: report['verdicts'].__setitem__(name, {'ok': bool(ok), 'detail': detail})

    try:
        lab = c05lab.Lab(scratch)
        lab.start_containers()
        local = dotenv(c05lab.LOCAL_ENV)
        dump = ['docker', 'exec', '-e', 'MYSQL_PWD=' + local['DB_PASSWORD'], 'practice-mysql', 'mysqldump',
                '-u' + local['DB_USER'], '--skip-triggers', '--set-gtid-purged=OFF']
        structure = subprocess.run(dump + ['--no-data', '--skip-add-drop-table', local['DB_NAME']],
                                   capture_output=True, timeout=300)
        rows = subprocess.run(dump + ['--no-create-info', local['DB_NAME'], 'knex_migrations',
                                      'knex_migrations_lock'], capture_output=True, timeout=120)
        need(structure.returncode == 0 and rows.returncode == 0, 'schema_dump_failed')
        preimage = structure.stdout.decode()
        need('p09_' not in preimage and 'c05_sessions' not in preimage, 'released_schema_already_has_candidates')
        lab.build_database(preimage, rows.stdout.decode())
        conn = {'port': lab.mysql['port'], 'user': lab.app_user, 'password': lab.app_password,
                'database': lab.database}
        formal_rows = lambda: int(lab.sql(['SELECT COUNT(*) AS n FROM knex_migrations'])[0][0]['n'])

        # 候选目录：只放四个候选，模块引用改成绝对路径（迁移文件本身一字不改地复制）
        candidates = Path(scratch) / 'candidates'
        candidates.mkdir()
        taken = []
        for family in ('p09', 'c05'):
            for path in sorted((ROOT / f'backend/migrations-candidates/{family}').glob('*.js')):
                text = path.read_text()
                for module in ('websiteArtifact/store', 'studentEntry/sessionContext'):
                    text = text.replace(f"require('../../src/services/{module}')",
                                        'require(' + json.dumps(str(ROOT / f'backend/src/services/{module}')) + ')')
                (candidates / path.name).write_text(text)
                taken.append(f'{family}/{path.name}')
        report['checks']['candidate_directory'] = {'files': taken, 'count': len(taken)}
        formal_dir = str(ROOT / 'backend/migrations')

        # ---- 1 基线 -------------------------------------------------------------------------
        report['stage'] = 'baseline'
        base = node(KNEX, {**conn, 'command': 'status', 'directory': formal_dir, 'tableName': 'knex_migrations'})
        report['checks']['baseline'] = {**base, 'formal_rows': formal_rows()}
        verdict('the_formal_ledger_starts_clean_and_complete',
                base['ok'] and base['pending'] == [] and base['completed'] == formal_rows() == 10)

        # ---- 2 反例：默认账本 + 候选目录 -------------------------------------------------------
        report['stage'] = 'counter_example'
        broken = node(KNEX, {**conn, 'command': 'latest', 'directory': str(candidates), 'tableName': 'knex_migrations'})
        report['checks']['default_ledger_with_candidate_directory'] = broken
        verdict('pointing_the_default_ledger_at_the_candidate_directory_is_refused',
                not broken['ok'] and 'corrupt' in (broken.get('error') or ''),
                '正式行在候选目录里找不到文件，Migrator.validateMigrationList 直接拒绝——这就是清单里必须写清的坑')
        need(formal_rows() == 10, 'counter_example_touched_the_formal_ledger')

        # ---- 3 修法：独立候选账本 --------------------------------------------------------------
        report['stage'] = 'isolated_candidate_ledger'
        applied = node(KNEX, {**conn, 'command': 'latest', 'directory': str(candidates), 'tableName': CANDIDATE_TABLE})
        objects = lab.sql([
            "SELECT table_name AS n FROM information_schema.tables "
            "WHERE table_schema=DATABASE() AND (table_name LIKE 'p09\\\\_%' OR table_name='c05_sessions')",
            "SELECT column_name AS c FROM information_schema.columns WHERE table_schema=DATABASE() "
            "AND table_name='user_groups' AND column_name IN ('edu_school_id','cohort')"])
        report['checks']['isolated_ledger_apply'] = {
            **applied, 'tables': sorted(row['n'] for row in objects[0]),
            'user_groups_columns': sorted(row['c'] for row in objects[1]),
            'candidate_rows': int(lab.sql([f'SELECT COUNT(*) AS n FROM {CANDIDATE_TABLE}'])[0][0]['n']),
            'formal_rows': formal_rows()}
        verdict('an_isolated_candidate_ledger_applies_all_four',
                applied['ok'] and len(applied['applied']) == 4
                and len(report['checks']['isolated_ledger_apply']['tables']) == 9
                and report['checks']['isolated_ledger_apply']['user_groups_columns'] == ['cohort', 'edu_school_id'],
                '8 张 P09 表 + c05_sessions + user_groups 两列')

        # ---- 4 重复执行与正式扫描 --------------------------------------------------------------
        report['stage'] = 'replay_and_formal_scan'
        replay = node(KNEX, {**conn, 'command': 'latest', 'directory': str(candidates), 'tableName': CANDIDATE_TABLE})
        after = node(KNEX, {**conn, 'command': 'status', 'directory': formal_dir, 'tableName': 'knex_migrations'})
        report['checks']['replay'] = {**replay,
                                      'candidate_rows': int(lab.sql([f'SELECT COUNT(*) AS n FROM {CANDIDATE_TABLE}'])[0][0]['n'])}
        report['checks']['formal_scan_after'] = {**after, 'formal_rows': formal_rows()}
        verdict('a_second_run_records_nothing_new',
                replay['ok'] and replay['applied'] == [] and report['checks']['replay']['candidate_rows'] == 4)
        verdict('the_next_ordinary_migration_scan_is_unaffected',
                after['ok'] and after['pending'] == [] and after['completed'] == 10 and formal_rows() == 10,
                '正式账本一行没动，下一次 make migrate 既不会认为目录损坏，也没有多出待执行项')

        report['passed'] = all(item['ok'] for item in report['verdicts'].values())
        report['stage'] = 'done'
    except Exception as error:
        report['failure'] = f'{type(error).__name__}: {error}'
        raise
    finally:
        report['finished_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        text = json.dumps(report, ensure_ascii=False, indent=2)
        for value in (lab.secrets() if lab else []):
            if value:
                text = text.replace(value, '<redacted>')
        (EVIDENCE / 'report.json').write_text(text + '\n')
        if lab:
            lab.stop()
            for container in (lab.mysql_container, lab.redis_container):
                if container:
                    subprocess.run(['docker', 'rm', '-f', container], capture_output=True, timeout=120)
        shutil.rmtree(scratch, ignore_errors=True)
        failed = sorted(name for name, item in report['verdicts'].items() if not item['ok'])
        print(json.dumps({'passed': report['passed'], 'stage': report['stage'], 'failed_verdicts': failed,
                          'evidence': str(EVIDENCE)}, ensure_ascii=False))


if __name__ == '__main__':
    main()

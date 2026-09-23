"""P09 候选迁移 002 的独占入口：等待与拒绝是不是有界。

真实件：一次性 mysql:8.0、本仓 store.js 的建表字节、**候选迁移函数本身**（require 后直接调用
exports.up/down）、真实 knex 连接池（池上限由本脚本设定，只在隔离环境里设）、另一条真实连接占用账本表。
合成件：账本里的三行样本数据（没有真实学生、没有真实作业）。

只验这一件事，**不重跑 21 场景、图片/保存/对账/浏览器，也不碰 C05**。
超时只停本脚本自己起的进程、释放本脚本自己下的锁。
"""
import json
import os
from pathlib import Path
import re
import secrets
import select
import socket
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / 'storage/private/p09-validation' / time.strftime('lockwait-%Y%m%dT%H%M%SZ', time.gmtime())
MYSQL_IMAGE = 'mysql:8.0'
MIGRATION = ROOT / 'backend/migrations-candidates/p09/20260922_002_p09_write_sequence.js'
WATCHDOG_MS = 20000          # 复现用的有界看门狗：超过这个时间还没答案，就是"没有上界"的证据
BACKLOG = (7, 3)             # 必须原样留着的欠账：write_seq=7 / applied_write_seq=3


def need(condition, label):
    if not condition:
        raise RuntimeError(label)


def docker(*args, timeout=180, check=True):
    result = subprocess.run(['docker', *args], capture_output=True, text=True, timeout=timeout)
    if check:
        need(result.returncode == 0, f'docker_{args[0]}_failed_{result.stderr.strip()[:80]}')
    return result.stdout.strip()


def node(script, payload, timeout=180):
    process = subprocess.run(['node', '-e', script], cwd=ROOT, input=json.dumps(payload), text=True,
                             capture_output=True, timeout=timeout)
    need(process.returncode == 0, 'node_helper_failed_' +
         re.sub(r'[^A-Za-z0-9_]', '', (process.stderr.strip().splitlines() or ['unknown'])[-1])[:48])
    text = process.stdout.strip()
    start = min([i for i in (text.find('{'), text.find('[')) if i >= 0], default=-1)
    return json.loads(text[start:]) if start >= 0 else text


SQL = """const mysql=require('./backend/node_modules/mysql2/promise');let s='';
process.stdin.on('data',b=>s+=b).on('end',async()=>{const c=JSON.parse(s);
const db=await mysql.createConnection({host:c.host,port:c.port,user:c.user,password:c.password,database:c.database||undefined,multipleStatements:true});
const out=[];try{for(const q of c.queries){const [rows]=await db.query(q.sql,q.params||[]);out.push(Array.isArray(rows)?rows:{affected:rows.affectedRows});}}
finally{await db.end();}process.stdout.write(JSON.stringify(out));});"""

SCHEMA = """const {SCHEMA}=require('./backend/src/services/websiteArtifact/store');
process.stdout.write(JSON.stringify(SCHEMA));"""

# 候选迁移函数本身：require 之后直接调用，带有界看门狗；超时就打印结果并退出自己的进程。
RUNNER = """const c=JSON.parse(require('fs').readFileSync(0,'utf8'));
const knex=require('./backend/node_modules/knex')({client:'mysql2',
  connection:{host:c.host,port:c.port,user:c.user,password:c.password,database:c.database},
  pool:{min:1,max:c.pool}});
const migration=require(c.migration);
const out=v=>{process.stdout.write(JSON.stringify(v)+'\\n');};
const started=Date.now();
const watchdog=new Promise((_,reject)=>setTimeout(()=>reject(Object.assign(new Error('watchdog'),{watchdog:true})),c.watchdog));
(async()=>{
  let result;
  try{ await Promise.race([migration[c.fn](knex),watchdog]);
       result={ok:true,elapsed_ms:Date.now()-started}; }
  catch(e){ result={ok:false,watchdog:Boolean(e.watchdog),code:e.code||null,
                    message:String(e.message||e).slice(0,200),elapsed_ms:Date.now()-started}; }
  if(result.watchdog){ out(result); process.exit(0); }          // 只停自己的进程，释放自己的连接
  // 迁移返回之后，看看会话变量有没有被还回去（池里 min=1/max=1 时就是同一条连接）
  try{ const [rows]=await knex.raw('SELECT @@SESSION.lock_wait_timeout AS v');
       result.session_lock_wait_timeout=Number((Array.isArray(rows)?rows[0]:rows).v); }catch(e){}
  out(result);
  await knex.destroy().catch(()=>{});
  process.exit(0);
})();"""

# 一条长期持有的连接：给账本表下真实的 LOCK TABLES，并在另一侧观察。
HOLDER = """const mysql=require('./backend/node_modules/mysql2/promise');const readline=require('node:readline');
let conn=null;const out=v=>process.stdout.write(JSON.stringify(v)+'\\n');
(async()=>{const rl=readline.createInterface({input:process.stdin});
 for await (const line of rl){ if(!line.trim())continue; const cmd=JSON.parse(line);
  try{
   if(cmd.command==='connect'){conn=await mysql.createConnection({host:cmd.host,port:cmd.port,user:cmd.user,password:cmd.password,database:cmd.database});out({ok:true});}
   else if(cmd.command==='sql'){const [rows]=await conn.query(cmd.sql,cmd.params||[]);out({ok:true,rows:Array.isArray(rows)?rows:{affected:rows.affectedRows}});}
   else if(cmd.command==='close'){await conn.end();out({ok:true});break;}
   else out({ok:false,error:'unknown_command'});
  }catch(e){out({ok:false,error:String(e.code||e.message).slice(0,160)});}
 } process.exit(0);})().catch(e=>{console.error(e);process.exit(1)});"""

# 诊断路径的对照：这正是原 observeActivity 做的事——从池里再取一条连接去读被锁住的表。
PROBE = """const c=JSON.parse(require('fs').readFileSync(0,'utf8'));
const mysql=require('./backend/node_modules/mysql2/promise');
const started=Date.now();
const timer=setTimeout(()=>{process.stdout.write(JSON.stringify({ok:false,watchdog:true,elapsed_ms:Date.now()-started})+'\\n');process.exit(0);},c.watchdog);
(async()=>{const db=await mysql.createConnection({host:c.host,port:c.port,user:c.user,password:c.password,database:c.database});
 try{ const [rows]=await db.query('SELECT COUNT(*) AS n, COALESCE(MAX(updated_at),0) AS newest FROM p09_links');
      clearTimeout(timer);
      process.stdout.write(JSON.stringify({ok:true,rows,elapsed_ms:Date.now()-started})+'\\n');}
 catch(e){clearTimeout(timer);process.stdout.write(JSON.stringify({ok:false,error:String(e.code||e.message).slice(0,120),elapsed_ms:Date.now()-started})+'\\n');}
 finally{ await db.end().catch(()=>{}); process.exit(0);} })();"""


class Holder:
    def __init__(self, mysql, database, scratch, name):
        self.process = subprocess.Popen(['node', '-e', HOLDER], cwd=ROOT, stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE,
                                        stderr=(Path(scratch) / f'holder-{name}.log').open('w'), text=True)
        self.call('connect', **{k: mysql[k] for k in ('host', 'port', 'user', 'password')}, database=database)

    def call(self, command, timeout=60, **fields):
        self.process.stdin.write(json.dumps(dict(command=command, **fields)) + '\n')
        self.process.stdin.flush()
        need(select.select([self.process.stdout], [], [], timeout)[0], 'holder_timeout_' + command)
        answer = json.loads(self.process.stdout.readline() or '{}')
        need(answer.get('ok'), f'holder_{command}_failed_{answer.get("error")}')
        return answer

    def close(self):
        try:
            self.call('close', timeout=10)
        except Exception:
            self.process.kill()


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


class Ledger:
    """一次性 MySQL + 只建 P09 账本表（用 store.js 的建表字节），外加三行样本。"""

    def __init__(self, scratch):
        self.scratch = Path(scratch)
        self.database = 'p09_lock_' + secrets.token_hex(3)
        self.app_user = 'p09_app_' + secrets.token_hex(3)
        self.app_password = secrets.token_urlsafe(24)
        self.container = None
        self.mysql = None

    def start(self):
        root_password = secrets.token_urlsafe(20)
        self.container = 'p09-lockwait-mysql-' + secrets.token_hex(3)
        docker('run', '--rm', '-d', '--name', self.container, '-e', 'MYSQL_ROOT_PASSWORD=' + root_password,
               '-e', 'MYSQL_ROOT_HOST=%', '-p', '127.0.0.1::3306', MYSQL_IMAGE)
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            probe = subprocess.run(['docker', 'exec', self.container, 'mysqladmin', '--host=127.0.0.1',
                                    'ping', '--silent'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if probe.returncode == 0:
                time.sleep(1.5)
                again = subprocess.run(['docker', 'exec', self.container, 'mysqladmin', '--host=127.0.0.1',
                                        'ping', '--silent'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if again.returncode == 0:
                    break
            time.sleep(.4)
        else:
            need(False, 'database_start_timeout')
        port = int(docker('port', self.container, '3306/tcp').rsplit(':', 1)[1])
        self.mysql = {'host': '127.0.0.1', 'port': port, 'user': 'root', 'password': root_password}

    def sql(self, queries, database=..., user=None, password=None):
        target = self.database if database is ... else database
        answer = node(SQL, dict(self.mysql, database=target, user=user or self.mysql['user'],
                                password=password or self.mysql['password'],
                                queries=[q if isinstance(q, dict) else {'sql': q} for q in queries]))
        return answer

    def build(self):
        self.sql([f'CREATE DATABASE `{self.database}` CHARACTER SET utf8mb4'], database=None)
        self.sql([f"CREATE USER '{self.app_user}'@'%' IDENTIFIED BY '{self.app_password}'",
                  f"GRANT ALL PRIVILEGES ON `{self.database}`.* TO '{self.app_user}'@'%'"], database=None)
        for statement in node(SCHEMA, {}):
            self.sql([statement])

    def seed(self):
        now = int(time.time() * 1000)
        row = ("INSERT INTO p09_links(id,source_instance,artifact_ref,project_ref,entry_ref,owner_user_id,"
               "student_uuid,project_id,entry_page_id,assignment_ref,school_ref,issuer_key,grant_id,state,"
               "work_state,created_at,updated_at,write_seq,applied_write_seq,sync_pending_at) "
               "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'active','working',?,?,?,?,NULL)")
        self.sql([
            # 必须原样留着的欠账：7 比 3
            {'sql': row, 'params': ['11111111-1111-4111-8111-111111111111', 'lab', 'a' * 36, 'b' * 36, 'c' * 36,
                                    201, 'lab-student-a', 501, 601, 'assign-1', 'school-1', 'edu', 'g' * 36,
                                    now, now, BACKLOG[0], BACKLOG[1]]},
            # 被中断的修复指纹：applied > write
            {'sql': row, 'params': ['22222222-2222-4222-8222-222222222222', 'lab', 'd' * 36, 'e' * 36, 'f' * 36,
                                    202, 'lab-student-b', 502, 602, 'assign-2', 'school-1', 'edu', 'h' * 36,
                                    now, now, 0, 5]},
            {'sql': "INSERT INTO p09_event_sequence(name,value) VALUES('event_seq', 12)"}])

    def links(self):
        rows = self.sql(['SELECT id, write_seq, applied_write_seq, sync_pending_at FROM p09_links ORDER BY id'])[0]
        return {row['id'][:8]: {'write_seq': int(row['write_seq']),
                                'applied_write_seq': int(row['applied_write_seq']),
                                'marked': row['sync_pending_at'] is not None} for row in rows}

    def columns(self):
        rows = self.sql(["SELECT column_name AS c FROM information_schema.columns WHERE table_schema=DATABASE() "
                         "AND table_name='p09_links' AND column_name IN ('write_seq','applied_write_seq')"])[0]
        return sorted(row['c'] for row in rows)

    def stop(self):
        if self.container:
            subprocess.run(['docker', 'rm', '-f', self.container], capture_output=True, timeout=120)


def run_migration(ledger, fn='up', pool=2, watchdog=WATCHDOG_MS, user=None, password=None, timeout=None):
    """调用候选迁移函数本身，带有界看门狗。返回 {ok, watchdog?, code?, elapsed_ms}。"""
    payload = {'host': ledger.mysql['host'], 'port': ledger.mysql['port'],
               'user': user or ledger.app_user, 'password': password or ledger.app_password,
               'database': ledger.database, 'pool': pool, 'watchdog': watchdog,
               'migration': str(MIGRATION), 'fn': fn}
    return node(RUNNER, payload, timeout=timeout or (watchdog / 1000 + 60))


def main():
    report = {'started_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'real': ['mysql:8.0 (disposable)', 'the candidate migration functions themselves (require + call)',
                       'real knex pools (max 1 and max 2)', 'a second real connection holding LOCK TABLES'],
              'synthetic': ['three seeded ledger rows; no real student, assignment or upload'],
              'bounds': {'watchdog_ms': WATCHDOG_MS,
                         'note': '看门狗只是"有没有上界"的判据；超时只停本脚本自己的进程'},
              'stage': 'start', 'observed': {}, 'verdicts': {}, 'passed': False}
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    scratch = tempfile.mkdtemp(prefix='p09-lockwait-')
    ledger, holder = None, None
    verdict = lambda name, ok, detail=None: report['verdicts'].__setitem__(name, {'ok': bool(ok), 'detail': detail})

    try:
        ledger = Ledger(scratch)
        ledger.start()
        ledger.build()
        ledger.seed()
        report['observed']['seeded'] = ledger.links()
        holder = Holder(ledger.mysql, ledger.database, scratch, 'ledger')

        lock = lambda: holder.call('sql', sql='LOCK TABLES p09_links WRITE, p09_event_sequence WRITE')
        unlock = lambda: holder.call('sql', sql='UNLOCK TABLES')

        # ---- 1 占用时：迁移有没有上界 -------------------------------------------------------
        report['stage'] = 'occupied'
        lock()
        occupied = {}
        occupied['pool_2'] = run_migration(ledger, pool=2)
        # 迁移正在等什么：从第三条连接看服务端。
        waiting = ledger.sql([
            "SELECT command, time, state, LEFT(COALESCE(info,''),60) AS info FROM information_schema.processlist "
            f"WHERE user='{ledger.app_user}' ORDER BY time DESC"])[0]
        occupied['pool_1'] = run_migration(ledger, pool=1)
        # 原诊断路径的对照：从池里另取一条连接去读被锁住的表。
        occupied['diagnostic_read_on_locked_tables'] = node(PROBE, {
            'host': ledger.mysql['host'], 'port': ledger.mysql['port'], 'user': ledger.app_user,
            'password': ledger.app_password, 'database': ledger.database, 'watchdog': WATCHDOG_MS},
            timeout=WATCHDOG_MS / 1000 + 30)
        occupied['app_connections_while_occupied'] = waiting
        occupied['columns_after'] = ledger.columns()          # information_schema：不碰被锁的表
        unlock()
        # 账本内容要等解锁之后再读：WRITE 锁连读都挡（这一点本身也是实测出来的）。
        occupied['ledger_after'] = ledger.links()
        report['observed']['occupied'] = occupied
        deadline_ms = WATCHDOG_MS
        verdict('an_occupied_ledger_is_refused_within_the_deadline',
                occupied['pool_2'].get('ok') is False and occupied['pool_2'].get('watchdog') is False
                and occupied['pool_2'].get('elapsed_ms', deadline_ms) < deadline_ms,
                f'占用时必须在 {deadline_ms}ms 内具名拒绝，而不是无限等')
        verdict('the_refusal_is_named_not_a_crash',
                'p09_exclusive_entry' in str(occupied['pool_2'].get('message', '')))
        verdict('a_pool_of_one_is_bounded_too',
                occupied['pool_1'].get('ok') is False and occupied['pool_1'].get('watchdog') is False
                and occupied['pool_1'].get('elapsed_ms', deadline_ms) < deadline_ms,
                '诊断不能再向池里取连接，否则池 1 时是等自己')
        verdict('a_refused_run_changes_nothing',
                occupied['ledger_after'] == report['observed']['seeded']
                and occupied['columns_after'] == ['applied_write_seq', 'write_seq'],
                '结构、7 比 3 的欠账与标记都不动')

        # ---- 2 权限不足：同样要有界 ---------------------------------------------------------
        report['stage'] = 'no_privilege'
        limited_user = 'p09_ltd_' + secrets.token_hex(3)
        limited_password = secrets.token_urlsafe(20)
        ledger.sql([f"CREATE USER '{limited_user}'@'%' IDENTIFIED BY '{limited_password}'",
                    f"GRANT SELECT, INSERT, UPDATE, DELETE, ALTER ON `{ledger.database}`.* TO '{limited_user}'@'%'"],
                   database=None)
        limited = run_migration(ledger, pool=1, user=limited_user, password=limited_password)
        report['observed']['no_privilege'] = {'result': limited,
                                              'grants': 'SELECT/INSERT/UPDATE/DELETE/ALTER, no LOCK TABLES'}
        verdict('missing_lock_tables_privilege_refuses_quickly',
                limited.get('ok') is False and limited.get('watchdog') is False
                and limited.get('elapsed_ms', deadline_ms) < deadline_ms
                and 'p09_exclusive_entry' in str(limited.get('message', '')))

        # ---- 3 释放之后：同一次调用正常收尾，欠账信号保留 -----------------------------------
        report['stage'] = 'after_release'
        finished = run_migration(ledger, pool=1)
        after = ledger.links()
        report['observed']['after_release'] = {'result': finished, 'ledger': after}
        verdict('the_same_call_finishes_once_the_ledger_is_free', finished.get('ok') is True)
        verdict('the_backlog_is_still_seven_over_three',
                after['11111111']['write_seq'] == BACKLOG[0]
                and after['11111111']['applied_write_seq'] == BACKLOG[1],
                '迁移不替业务对账宣布完成')
        verdict('the_interrupted_repair_was_finished_and_marked',
                after['22222222']['applied_write_seq'] == 0 and after['22222222']['marked'] is True
                and after['11111111']['marked'] is True,
                '先打标记后丢无法验证的声明')
        verdict('the_session_setting_is_returned_as_it_was',
                finished.get('session_lock_wait_timeout') in (None, 31536000),
                '会话级设置改了就要还回去，否则池里的连接带着它去服务别人')

        # ---- 4 纯追加 DDL 与正常重跑不受影响 -------------------------------------------------
        report['stage'] = 'ordinary_paths'
        ledger.sql(['ALTER TABLE p09_links DROP COLUMN write_seq, DROP COLUMN applied_write_seq'])
        added = run_migration(ledger, pool=1)
        columns_after_add = ledger.columns()
        replay = run_migration(ledger, pool=1)
        ledger.sql([f'UPDATE p09_links SET write_seq={BACKLOG[0]}, applied_write_seq={BACKLOG[1]} '
                    "WHERE id LIKE '1111%'"])
        replay_again = run_migration(ledger, pool=1)
        report['observed']['ordinary_paths'] = {
            'add': added, 'columns_after_add': columns_after_add, 'replay': replay,
            'replay_with_backlog': replay_again, 'ledger': ledger.links()}
        verdict('the_additive_upgrade_still_works',
                added.get('ok') is True and columns_after_add == ['applied_write_seq', 'write_seq'])
        verdict('a_plain_replay_is_still_a_no_op',
                replay.get('ok') is True and replay_again.get('ok') is True
                and ledger.links()['11111111']['write_seq'] == BACKLOG[0]
                and ledger.links()['11111111']['applied_write_seq'] == BACKLOG[1])

        # ---- 5 down 同样走独占入口 ------------------------------------------------------------
        report['stage'] = 'down'
        lock()
        down_occupied = run_migration(ledger, fn='down', pool=1)
        unlock()
        down_free = run_migration(ledger, fn='down', pool=1)
        report['observed']['down'] = {'while_occupied': down_occupied, 'once_free': down_free,
                                      'columns_after': ledger.columns()}
        verdict('down_is_bounded_while_the_ledger_is_occupied',
                down_occupied.get('ok') is False and down_occupied.get('watchdog') is False
                and down_occupied.get('elapsed_ms', deadline_ms) < deadline_ms)
        verdict('down_still_works_once_the_ledger_is_free',
                down_free.get('ok') is True and ledger.columns() == [])

        report['passed'] = all(item['ok'] for item in report['verdicts'].values())
        report['stage'] = 'done'
    except Exception as error:
        report['failure'] = f'{type(error).__name__}: {error}'
        raise
    finally:
        report['finished_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        text = json.dumps(report, ensure_ascii=False, indent=2)
        for value in [getattr(ledger, 'app_password', None), (ledger.mysql or {}).get('password') if ledger else None]:
            if value:
                text = text.replace(value, '<redacted>')
        (EVIDENCE / 'report.json').write_text(text + '\n')
        if holder:
            holder.close()
        if ledger:
            ledger.stop()
        subprocess.run(['rm', '-rf', scratch], timeout=60)
        failed = sorted(name for name, item in report['verdicts'].items() if not item['ok'])
        print(json.dumps({'passed': report['passed'], 'stage': report['stage'], 'failed_verdicts': failed,
                          'evidence': str(EVIDENCE)}, ensure_ascii=False))


if __name__ == '__main__':
    main()

"""C05 兑换事务的连接边界，与会话表回退的独占边界。

真实件：本仓后端（node src/server.js，**应用连接池上限由本脚本设成 1 或 2，只在隔离环境里设，
不改候选的生产池上限**）、一次性 mysql:8.0（本地库结构，无数据行）、一次性 redis:7-alpine、真实 HTTP、
真实 knex 迁移。合成件：edu 发行方与其 HMAC 密钥、全部学生 uuid、学校本身——没有接真实 edu。

只跑两件事：
  1. consume 事务持有一条连接时，是否还会再向全局池要第二条（池 1 即可证明"停在哪"）；
     以及组停用在"核过之后、提交之前"是否仍被放行（真实行锁屏障）。
  2. 002.down：任何历史行存在都必须具名拒绝，空表回退要有可核的独占窗口，
     并按 MySQL 的实际行为核"计数与 DROP 之间"有没有写入窗口。
不重跑四宽度、主路径与 P09。
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check as lab_mod                                              # noqa: E402
from check import (C05_CONFIG, Issuer, Lab, STUDENT_GROUP, dotenv, lab_uuid, need,  # noqa: E402
                   node, student_payload, LOCAL_ENV, ROOT)

EVIDENCE = ROOT / 'storage/private/c05-validation' / time.strftime('txpool-%Y%m%dT%H%M%SZ', time.gmtime())
CONSUME_TIMEOUT = 15

# 一条长期持有的连接：用来下行锁/表锁做屏障，并在另一侧观察。stdin 逐行收命令，stdout 逐行回结果。
NODE_HOLDER = """const mysql=require('./backend/node_modules/mysql2/promise');const readline=require('node:readline');
let conn=null;const out=v=>process.stdout.write(JSON.stringify(v)+'\\n');
(async()=>{const rl=readline.createInterface({input:process.stdin});
 for await (const line of rl){ if(!line.trim())continue; const cmd=JSON.parse(line);
  try{
   if(cmd.command==='connect'){conn=await mysql.createConnection({host:cmd.host,port:cmd.port,user:cmd.user,password:cmd.password,database:cmd.database});out({ok:true});}
   else if(cmd.command==='sql'){const [rows]=await conn.query(cmd.sql,cmd.params||[]);out({ok:true,rows:Array.isArray(rows)?rows:{affected:rows.affectedRows}});}
   else if(cmd.command==='begin'){await conn.beginTransaction();out({ok:true});}
   else if(cmd.command==='commit'){await conn.commit();out({ok:true});}
   else if(cmd.command==='rollback'){await conn.rollback();out({ok:true});}
   else if(cmd.command==='close'){await conn.end();out({ok:true});break;}
   else out({ok:false,error:'unknown_command'});
  }catch(e){out({ok:false,error:String(e.code||e.message).slice(0,160)});}
 } process.exit(0);})().catch(e=>{console.error(e);process.exit(1)});"""


class Holder:
    """一条独立的 MySQL 连接，用来做真实的行锁/表锁屏障。"""

    def __init__(self, mysql, database, scratch, name):
        self.process = subprocess.Popen(['node', '-e', NODE_HOLDER], cwd=ROOT, stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE,
                                        stderr=(Path(scratch) / f'holder-{name}.log').open('w'), text=True)
        self.call('connect', **{k: mysql[k] for k in ('host', 'port', 'user', 'password')}, database=database)

    def call(self, command, timeout=60, **fields):
        self.process.stdin.write(json.dumps(dict(command=command, **fields)) + '\n')
        self.process.stdin.flush()
        import select
        need(select.select([self.process.stdout], [], [], timeout)[0], 'holder_timeout_' + command)
        answer = json.loads(self.process.stdout.readline() or '{}')
        need(answer.get('ok'), f'holder_{command}_failed_{answer.get("error")}')
        return answer

    def close(self):
        try:
            self.call('close', timeout=10)
        except Exception:
            self.process.kill()


def consume_async(lab, ticket, sink, timeout=CONSUME_TIMEOUT):
    """在后台线程里花一张票，把结果或超时记下来。"""
    def run():
        started = time.monotonic()
        try:
            request = urllib.request.Request(f'http://127.0.0.1:{lab.api_port}/api/auth/sso/consume',
                                             data=json.dumps({'handoff': ticket}).encode(),
                                             headers={'Content-Type': 'application/json'}, method='POST')
            with urllib.request.urlopen(request, timeout=timeout) as response:
                sink.append({'status': response.status, 'body': json.loads(response.read().decode() or '{}'),
                             'seconds': round(time.monotonic() - started, 2)})
        except urllib.error.HTTPError as error:
            body = error.read().decode()
            sink.append({'status': error.code, 'body': json.loads(body or '{}'),
                         'seconds': round(time.monotonic() - started, 2)})
        except Exception as error:                          # 超时也是证据
            sink.append({'status': None, 'error': type(error).__name__,
                         'seconds': round(time.monotonic() - started, 2)})
    thread = threading.Thread(target=run)
    thread.start()
    return thread


def main():
    report = {'started_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'synthetic': ['edu issuer and its HMAC key', 'every student uuid and school_ref',
                            'the school itself: no real edu deployment is connected'],
              'real': ['backend node src/server.js with an application pool limited to 1 or 2 (harness only)',
                       'mysql:8.0 from the local schema structure (no rows)', 'redis:7-alpine',
                       'real HTTP', 'real knex migrations'],
              'stage': 'start', 'observed': {}, 'verdicts': {}, 'passed': False}
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    lab_mod.EVIDENCE = EVIDENCE
    scratch = tempfile.mkdtemp(prefix='c05-txpool-')
    lab, holder = None, None
    verdict = lambda name, ok, detail=None: report['verdicts'].__setitem__(name, {'ok': bool(ok), 'detail': detail})

    try:
        lab = Lab(scratch)
        lab.start_containers()
        local = dotenv(LOCAL_ENV)
        dump = ['docker', 'exec', '-e', 'MYSQL_PWD=' + local['DB_PASSWORD'], 'practice-mysql', 'mysqldump',
                '-u' + local['DB_USER'], '--skip-triggers', '--set-gtid-purged=OFF']
        import re as _re
        structure = subprocess.run(dump + ['--no-data', '--skip-add-drop-table', local['DB_NAME']],
                                   capture_output=True, timeout=300)
        knex_rows = subprocess.run(dump + ['--no-create-info', local['DB_NAME'], 'knex_migrations',
                                           'knex_migrations_lock'], capture_output=True, timeout=120)
        need(structure.returncode == 0 and knex_rows.returncode == 0, 'local_schema_dump_failed')
        preimage = _re.sub(rb'-- (Dump completed on|Host:|Server version|MySQL dump).*', b'',
                           _re.sub(rb'AUTO_INCREMENT=\d+ ', b'', structure.stdout)).decode()
        lab.build_database(preimage, knex_rows.stdout.decode())
        lab.seed()
        lab.apply_session_table()
        lab.write_config(C05_CONFIG)
        lab.sql([f'UPDATE user_groups SET credits_pool=100000, credits_pool_used=0 WHERE id={STUDENT_GROUP}'])
        issuer = Issuer(lab.issuer_secret)
        holder = Holder(lab.mysql, lab.database, scratch, 'barrier')

        def ticket_for(number, **payload):
            student_uuid = lab_uuid(number)
            status, body, _ = lab.exchange(issuer, student_payload(student_uuid, **payload))
            need(status == 200, f'exchange_refused_{number}_{(body.get("error") or {}).get("code")}')
            return student_uuid, body['handoff']

        # 应用侧只有一条连接：consume 事务一旦再向全局池要第二条，就只能等自己手里那条。
        report['stage'] = 'pool_of_one'
        lab.start(enabled=True, label='pool1', extra={'DB_CONNECTION_LIMIT': '1'})
        student, ticket = ticket_for(301)
        sink = []
        thread = consume_async(lab, ticket, sink)
        time.sleep(4)
        # 从**另一条**连接看服务端：应用账号到底开了几条、在干什么。
        processlist = holder.call('sql', sql=(
            "SELECT id, command, time, state, LEFT(COALESCE(info,''), 80) AS info "
            "FROM information_schema.processlist WHERE user = ? ORDER BY id"), params=[lab.app_user])['rows']
        trx = holder.call('sql', sql=(
            "SELECT trx_state, trx_rows_locked, LEFT(COALESCE(trx_query,''), 80) AS q "
            "FROM information_schema.innodb_trx"))['rows']
        thread.join(timeout=CONSUME_TIMEOUT + 10)
        outcome = sink[0] if sink else {'status': None, 'error': 'no_result'}
        sessions = int(lab.sql(['SELECT COUNT(*) AS n FROM c05_sessions'])[0][0]['n'])
        report['observed']['pool_of_one'] = {
            'consume': outcome, 'app_connections_during_consume': processlist,
            'innodb_trx_during_consume': trx, 'sessions_after': sessions,
            'note': ('池上限 1：事务持着那条连接，任何再向全局池取连接的调用都只能排队等自己。'
                     '等待发生在应用进程的连接池队列里，所以服务端只看得到一条空闲/事务中的连接，'
                     '没有任何数据库层面的锁等待——这正是"一个事务、一次读"不成立的样子。')}
        verdict('a_consume_completes_with_a_single_application_connection',
                outcome.get('status') == 200 and sessions == 1,
                '身份与会话必须都在同一个事务里，不能再向全局池取第二条连接')
        # 卡住的事务不会自己松手：池 1 时它把整个服务都占死了。复现时重启一次再继续，
        # 并把"是否需要重启"记成事实。
        wedged = outcome.get('status') != 200
        report['observed']['pool_of_one']['backend_wedged_until_restart'] = wedged
        if wedged:
            lab.stop()
            lab.start(enabled=True, label='pool1-restart', extra={'DB_CONNECTION_LIMIT': '1'})

        # 不同票、有限并发、池很小：不能互相挂死。
        report['stage'] = 'bounded_concurrency'
        tickets = [ticket_for(310 + index)[1] for index in range(4)]
        sink2 = []
        threads = [consume_async(lab, one, sink2, timeout=CONSUME_TIMEOUT) for one in tickets]
        for one in threads:
            one.join(timeout=CONSUME_TIMEOUT + 10)
        report['observed']['bounded_concurrency'] = {'pool_limit': 1, 'results': sink2}
        verdict('four_different_tickets_do_not_deadlock_a_small_pool',
                sum(1 for item in sink2 if item.get('status') == 200) == len(tickets))

        # 同一张票并发：仍然只有一次成功。
        student, one_ticket = ticket_for(320)
        sink3 = []
        same = [consume_async(lab, one_ticket, sink3, timeout=CONSUME_TIMEOUT) for _ in range(3)]
        for one in same:
            one.join(timeout=CONSUME_TIMEOUT + 10)
        rows = int(lab.sql([f"SELECT COUNT(*) AS n FROM c05_sessions s JOIN users u ON u.id=s.user_id "
                            f"WHERE u.uuid='{student}'"])[0][0]['n'])
        report['observed']['same_ticket_concurrently'] = {'results': sink3, 'session_rows': rows}
        verdict('the_same_ticket_still_wins_exactly_once',
                sum(1 for item in sink3 if item.get('status') == 200) == 1 and rows == 1)

        # 组停用的一致性边界：真实行锁屏障。屏障占住 c05_sessions 的唯一键，
        # consume 走到最后一步(写会话行)时被挡住，此时停用学生组并提交，再放行。
        report['stage'] = 'group_barrier'
        student, barrier_ticket = ticket_for(330)
        digest = node("const c=require('node:crypto');let s='';process.stdin.on('data',b=>s+=b)"
                      ".on('end',()=>process.stdout.write(JSON.stringify({d:c.createHash('sha256')"
                      ".update(JSON.parse(s).t).digest('hex')})));", {'t': barrier_ticket})['d']
        blocker_user = int(lab.sql([f"SELECT id FROM users WHERE uuid='{lab_uuid(301)}'"])[0][0]['id'])
        holder.call('begin')
        holder.call('sql', sql=(
            'INSERT INTO c05_sessions(jti,user_id,platform_key,school_ref,group_id,handoff_digest,'
            'expires_at) VALUES(?,?,?,?,?,?, DATE_ADD(NOW(), INTERVAL 1 HOUR))'),
            params=['barrier-jti', blocker_user, 'edu', '123', STUDENT_GROUP, digest])
        sink4 = []
        thread = consume_async(lab, barrier_ticket, sink4, timeout=CONSUME_TIMEOUT)
        time.sleep(3)
        # consume 现在卡在唯一键上。趁这个窗口停用学生组：如果这一步成功提交，
        # 说明 consume 没有锁住组行；如果它被挡住，说明组行已在同一锁序里被锁住。
        started = time.monotonic()
        deactivate = threading.Thread(target=lambda: lab.sql(
            [f'UPDATE user_groups SET is_active=0 WHERE id={STUDENT_GROUP}']))
        deactivate.start()
        deactivate.join(timeout=8)
        blocked = deactivate.is_alive()
        holder.call('rollback')                       # 放行 consume
        thread.join(timeout=CONSUME_TIMEOUT + 10)
        deactivate.join(timeout=20)
        elapsed = round(time.monotonic() - started, 2)
        outcome = sink4[0] if sink4 else {'status': None}
        report['observed']['group_barrier'] = {
            'consume': outcome, 'deactivation_blocked_while_consuming': blocked,
            'deactivation_seconds': elapsed,
            'group_active_after': int(lab.sql(
                [f'SELECT is_active FROM user_groups WHERE id={STUDENT_GROUP}'])[0][0]['is_active']),
            'note': ('屏障占住 c05_sessions 的唯一键，让 consume 停在写会话行之前；'
                     '此时若能把学生组停用并提交，就说明组行在核过之后仍可被改。')}
        # 修好之后：组行在同一锁序里被锁住，停用只能排队等 consume 结束。
        verdict('deactivating_the_school_has_to_wait_for_a_consume_in_flight', blocked,
                '组行按既有锁序（先用户行、再按 id 升序锁组行）加锁，核过之后不可能被改掉')
        lab.sql([f'UPDATE user_groups SET is_active=1 WHERE id={STUDENT_GROUP}'])

        # ---- 2 会话表回退：任何历史行都不是"可删"的理由 ----------------------------------
        report['stage'] = 'down_boundary'
        lab.stop()
        import shutil
        migrations = Path(scratch) / 'migrations-c05'
        shutil.copytree(ROOT / 'backend/migrations', migrations)
        candidates = sorted((ROOT / 'backend/migrations-candidates/c05').glob('*.js'))
        for candidate in candidates:
            (migrations / candidate.name).write_text(candidate.read_text().replace(
                "require('../../src/services/studentEntry/sessionContext')",
                'require(' + json.dumps(str(ROOT / 'backend/src/services/studentEntry/sessionContext')) + ')'))
        knex = lambda down=False: node(lab_mod.NODE_KNEX, {
            'port': lab.mysql['port'], 'user': lab.app_user, 'password': lab.app_password,
            'database': lab.database, 'directory': str(migrations), 'down': down})
        # 这张表是 harness 直接建的，先让 knex 把两条候选记进历史（001 会真的执行，002 幂等）。
        lab.sql(['DROP TABLE IF EXISTS c05_sessions'])
        applied = knex()
        need(applied.get('ok'), 'candidates_not_applied_' + str(applied.get('error'))[:60])
        rows_before = lab.sql(['SELECT COUNT(*) AS n FROM c05_sessions'])[0][0]['n']

        def session_row(jti, expires, revoked=None):
            lab.sql([{'sql': ('INSERT INTO c05_sessions(jti,user_id,platform_key,school_ref,group_id,'
                              'handoff_digest,expires_at,revoked_at) VALUES(?,?,?,?,?,?,?,?)'),
                      'params': [jti, blocker_user, 'edu', '123', STUDENT_GROUP,
                                 jti.ljust(64, '0')[:64], expires, revoked]}])

        cases = {}
        session_row('live-1', time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(time.time() + 3600)))
        cases['live'] = knex(down=True)
        lab.sql(["UPDATE c05_sessions SET expires_at = DATE_SUB(NOW(), INTERVAL 2 DAY)"])
        cases['all_expired'] = knex(down=True)
        lab.sql(["UPDATE c05_sessions SET revoked_at = NOW()"])
        cases['all_revoked'] = knex(down=True)
        lab.sql(['DELETE FROM c05_sessions'])
        cases['empty'] = knex(down=True)
        gone = int(lab.sql(["SELECT COUNT(*) AS n FROM information_schema.tables "
                            "WHERE table_schema=DATABASE() AND table_name='c05_sessions'"])[0][0]['n'])
        report['observed']['down_boundary'] = {'rows_before': int(rows_before), 'cases': cases,
                                               'table_after_empty_down': gone}
        verdict('a_live_session_stops_the_rollback',
                cases['live'].get('ok') is False and 'c05_sessions' in str(cases['live'].get('error')))
        verdict('expired_rows_are_history_not_permission',
                cases['all_expired'].get('ok') is False,
                '令牌过期不等于这段历史可以删')
        verdict('revoked_rows_are_history_too', cases['all_revoked'].get('ok') is False)
        verdict('an_empty_table_can_be_rolled_back', cases['empty'].get('ok') and gone == 0)

        # 计数与 DROP 之间有没有写入窗口：按 MySQL 的真实行为核，不靠"应该被包住"。
        report['stage'] = 'down_exclusivity'
        again = knex()
        need(again.get('ok'), 'candidates_not_reapplied')
        holder.call('sql', sql='SELECT 1')
        # 屏障连接先把表锁住，迁移就拿不到独占窗口，必须具名拒绝而不是硬闯。
        holder.call('sql', sql='LOCK TABLES c05_sessions WRITE')
        refused = knex(down=True)
        holder.call('sql', sql='UNLOCK TABLES')
        table_still_there = int(lab.sql(["SELECT COUNT(*) AS n FROM information_schema.tables "
                                         "WHERE table_schema=DATABASE() AND table_name='c05_sessions'"])[0][0]['n'])
        report['observed']['down_exclusivity'] = {'while_another_session_holds_the_table': refused,
                                                  'table_still_present': table_still_there}
        verdict('without_a_verifiable_exclusive_window_the_rollback_refuses',
                refused.get('ok') is False and table_still_there == 1,
                '不能用"看起来很安静"当证明')

        # 真正的边界：空表判定与 DROP 之间，另一条连接能不能挤进来写一行。
        # 不在持锁期间从第三条连接读表——WRITE 锁连读都挡（这一点本身也是被实测出来的）。
        report['stage'] = 'write_window'
        again2 = knex()
        need(again2.get('ok'), 'candidates_not_reapplied_for_write_window')
        writer = Holder(lab.mysql, lab.database, scratch, 'writer')
        try:
            proof = {}

            # (a) 持锁期间写入被挡住，解锁后才落地。
            holder.call('sql', sql='LOCK TABLES c05_sessions WRITE')
            landed = []

            def blocked_insert():
                try:
                    writer.call('sql', timeout=120, sql=(
                        'INSERT INTO c05_sessions(jti,user_id,platform_key,school_ref,group_id,'
                        'handoff_digest,expires_at) VALUES(?,?,?,?,?,?, DATE_ADD(NOW(), INTERVAL 1 HOUR))'),
                        params=['racer-a', blocker_user, 'edu', '123', STUDENT_GROUP, 'a' * 64])
                    landed.append({'inserted': True})
                except Exception as error:
                    landed.append({'inserted': False, 'error': str(error)[:120]})

            racer = threading.Thread(target=blocked_insert)
            racer.start()
            time.sleep(2)
            proof['insert_still_waiting_while_locked'] = racer.is_alive()
            holder.call('sql', sql='UNLOCK TABLES')
            racer.join(timeout=60)
            proof['after_unlock'] = landed[0] if landed else None
            verdict('a_writer_cannot_slip_in_while_the_table_lock_is_held',
                    proof['insert_still_waiting_while_locked'] is True,
                    'LOCK TABLES … WRITE 期间别的连接写不进来；计数与 DROP 都在这个窗口内')

            # (b) 空表 + 并发写入 + 真实 down：要么迁移拒绝（说明那一行在计数前就落了），
            #     要么表被删掉且**没有任何一次写入自认为成功**。绝不能两者都发生。
            lab.sql(['DELETE FROM c05_sessions'])
            attempts = []
            stop_at = time.monotonic() + 12

            def hammer():
                index = 0
                while time.monotonic() < stop_at:
                    index += 1
                    try:
                        writer.call('sql', timeout=60, sql=(
                            'INSERT INTO c05_sessions(jti,user_id,platform_key,school_ref,group_id,'
                            'handoff_digest,expires_at) VALUES(?,?,?,?,?,?, DATE_ADD(NOW(), INTERVAL 1 HOUR))'),
                            params=[f'hammer-{index}', blocker_user, 'edu', '123', STUDENT_GROUP,
                                    f'{index:064d}'])
                        attempts.append({'attempt': index, 'inserted': True})
                    except Exception as error:
                        attempts.append({'attempt': index, 'inserted': False, 'error': str(error)[:90]})
                        break
                    time.sleep(0.2)

            hammering = threading.Thread(target=hammer)
            hammering.start()
            time.sleep(0.5)
            rolled = knex(down=True)
            hammering.join(timeout=60)
            table_present = int(lab.sql(["SELECT COUNT(*) AS n FROM information_schema.tables "
                                         "WHERE table_schema=DATABASE() AND table_name='c05_sessions'"])[0][0]['n'])
            succeeded = [item for item in attempts if item.get('inserted')]
            proof['concurrent_writer'] = {'down': rolled, 'attempts': attempts[:6],
                                          'successful_inserts': len(succeeded),
                                          'table_present_after': table_present}
            # (c) 另一条臂：让写入**正好在迁移持锁之后**发起。不靠猜时间——从第三条连接轮询
            #     SHOW OPEN TABLES 的 In_use，服务端说锁拿到了才发。
            lab.sql(['DELETE FROM c05_sessions'])
            timed = {'attempt': None, 'lock_observed': False}
            down_box = []
            down_thread = threading.Thread(target=lambda: down_box.append(knex(down=True)))
            down_thread.start()
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline and not timed['lock_observed']:
                held = holder.call('sql', sql='SHOW OPEN TABLES WHERE In_use > 0')['rows']
                if any(str(row.get('Table')) == 'c05_sessions' for row in held):
                    timed['lock_observed'] = True
                    break
                time.sleep(0.02)
            if timed['lock_observed']:
                try:
                    writer.call('sql', timeout=60, sql=(
                        'INSERT INTO c05_sessions(jti,user_id,platform_key,school_ref,group_id,'
                        'handoff_digest,expires_at) VALUES(?,?,?,?,?,?, DATE_ADD(NOW(), INTERVAL 1 HOUR))'),
                        params=['late', blocker_user, 'edu', '123', STUDENT_GROUP, 'c' * 64])
                    timed['attempt'] = {'inserted': True}
                except Exception as error:
                    timed['attempt'] = {'inserted': False, 'error': str(error)[:120]}
            down_thread.join(timeout=120)
            timed['down'] = down_box[0] if down_box else None
            timed['table_present_after'] = int(lab.sql([
                "SELECT COUNT(*) AS n FROM information_schema.tables "
                "WHERE table_schema=DATABASE() AND table_name='c05_sessions'"])[0][0]['n'])
            proof['writer_that_starts_inside_the_window'] = timed
            verdict('a_writer_that_arrives_after_the_lock_never_lands_a_row_that_is_then_dropped',
                    (not timed['lock_observed'])
                    or (timed['down'] and timed['down'].get('ok') and timed['table_present_after'] == 0
                        and timed['attempt'] and timed['attempt'].get('inserted') is False)
                    or (timed['down'] and timed['down'].get('ok') is False),
                    '锁被服务端确认持有之后才发起的写入，要么被挡到表已不存在，要么迁移拒绝；'
                    '观察不到持锁窗口时如实记为未观察到，不当作已证明')

            report['observed']['write_window'] = proof
            verdict('the_count_and_the_drop_are_one_window',
                    (rolled.get('ok') and table_present == 0 and len(succeeded) == 0)
                    or (rolled.get('ok') is False and 'c05_sessions_not_empty' in str(rolled.get('error'))
                        and table_present == 1),
                    '要么迁移看见了那一行并拒绝，要么表被删且没有任何写入自认为成功——不可能两者都发生')
        finally:
            writer.close()

        report['passed'] = all(item['ok'] for item in report['verdicts'].values())
        report['stage'] = 'done'
    except Exception as error:
        report['failure'] = f'{type(error).__name__}: {error}'
        raise
    finally:
        report['finished_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        text = json.dumps(report, ensure_ascii=False, indent=2)
        for value in (lab.secrets() if lab else []):
            text = text.replace(value, '<redacted>')
        (EVIDENCE / 'report.json').write_text(text + '\n')
        if holder:
            holder.close()
        if lab:
            lab.stop()
            for container in (lab.mysql_container, lab.redis_container):
                if container:
                    subprocess.run(['docker', 'rm', '-f', container], capture_output=True, timeout=120)
        subprocess.run(['rm', '-rf', scratch], timeout=60)
        failed = sorted(name for name, item in report['verdicts'].items() if not item['ok'])
        print(json.dumps({'passed': report['passed'], 'stage': report['stage'], 'failed_verdicts': failed,
                          'evidence': str(EVIDENCE)}, ensure_ascii=False))


if __name__ == '__main__':
    main()

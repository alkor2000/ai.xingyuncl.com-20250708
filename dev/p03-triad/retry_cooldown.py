"""P03 重试等待：一组有限的真实入口浏览器检查。

**范围**：只核这一组新增 UI 行为——等待时不能保存/重试/刷新、倒计时结束零自动请求、重开恢复既有等待、
R 到期无对外操作。**不重复旧三端矩阵**，**不运行被拒的外仓 Go**（Identity provider / T11 目标都不在本轮）。

真实件：本候选树的真实前端（Vite 生产同源构建源码）、真实后端 `node src/server.js`（P03 开启、mysql 账本）、
一次性 mysql:8.0（本地库结构前像 + knex 应用账本候选迁移 + 受限角色）、真实 Chromium、真实 HTTP。
模拟件（逐项列在报告里）：三名合成账号与一段合成对话；**等待状态是直接写进本地账本的 fixture**
（`retry_at` / `recovery_until` / 失败态），因为产生同样状态的另一条路要连外仓目标，而那条在审批 HOLD。
没有真实教师、没有真机、没有生产读取。
"""
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import time
import uuid as uuidlib

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / 'storage/private/p03-rc-validation' / time.strftime('run-%Y%m%dT%H%M%SZ', time.gmtime())
sys.path.insert(0, str(ROOT / 'dev/p03-triad'))

import importlib.util                                                    # noqa: E402


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


entry = load('entry_scenarios', ROOT / 'dev/p03-triad/entry_scenarios.py')
PracticeLab, need, free_port = entry.PracticeLab, entry.need, entry.free_port
EXCERPT = entry.EXCERPT if hasattr(entry, 'EXCERPT') else '先观察，再记录'


def docker(*args, timeout=180, check=True):
    result = subprocess.run(['docker', *args], capture_output=True, text=True, timeout=timeout)
    if check:
        need(result.returncode == 0, f'docker_{args[0]}_failed_{result.stderr.strip()[:80]}')
    return result.stdout.strip()


def start_mysql():
    password = secrets.token_urlsafe(20)
    name = 'p03-rc-mysql-' + secrets.token_hex(3)
    docker('run', '--rm', '-d', '--name', name, '-e', 'MYSQL_ROOT_PASSWORD=' + password,
           '-e', 'MYSQL_ROOT_HOST=%', '-p', '127.0.0.1::3306', 'mysql:8.0')
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        probe = subprocess.run(['docker', 'exec', name, 'mysqladmin', '--host=127.0.0.1', 'ping', '--silent'],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if probe.returncode == 0:
            time.sleep(1.5)
            again = subprocess.run(['docker', 'exec', name, 'mysqladmin', '--host=127.0.0.1', 'ping', '--silent'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if again.returncode == 0:
                break
        time.sleep(.4)
    else:
        need(False, 'database_start_timeout')
    port = int(docker('port', name, '3306/tcp').rsplit(':', 1)[1])
    return name, {'host': '127.0.0.1', 'port': port, 'user': 'root', 'password': password}


def main():
    report = {'started_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'scope': 'one bounded browser check of the retry cooldown UI only',
              'real': ['this candidate tree\'s frontend through Vite', 'node src/server.js with P03 on and the '
                       'mysql ledger', 'disposable mysql:8.0 built from the local schema pre-image plus the '
                       'ledger candidate migration and the restricted role', 'Chromium', 'real HTTP'],
              'simulated': ['three synthetic accounts and one synthetic conversation',
                            'the waiting state itself is written straight into the local ledger '
                            '(retry_at / recovery_until / a failed status): producing it the other way needs the '
                            'foreign target, and that build is on approval hold'],
              'not_run': ['the Identity Go provider and the T11 target (cross-repository Go, approval hold)',
                          'the old three-party matrix and the four-width sweep'],
              'stage': 'start', 'checks': {}, 'verdicts': {}, 'passed': False}
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    scratch = tempfile.mkdtemp(prefix='p03-rc-')
    container = lab = None
    verdict = lambda name, ok, detail=None: report['verdicts'].__setitem__(name, {'ok': bool(ok), 'detail': detail})

    try:
        container, mysql = start_mysql()
        lab = PracticeLab({'practice_root': str(ROOT), 'mysql': mysql, 'source_secret': ''}, scratch)
        facts = {}
        lab.build_database(facts)
        report['database'] = facts
        # 目标与 Identity 本轮都不起：这组检查不发任何对外请求，lab.json 只是运行时要的形状。
        ca = Path(scratch) / 'lab-ca.pem'
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
                        '-subj', '/CN=p03-rc-lab', '-keyout', str(Path(scratch) / 'lab-ca.key'),
                        '-out', str(ca)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       timeout=60)
        lab_json = Path(scratch) / 'lab.json'
        lab_json.write_text(json.dumps({'ca': str(ca), 'ports': {'identity': free_port(), 'target': free_port()},
                                        'source_instance': entry.SOURCE_INSTANCE,
                                        'target_instance': entry.TARGET_INSTANCE}))
        # 这一步会撞上产品自己的准入门：P03 正式运行时在启动时就要 Identity 事实，
        # 而 Identity provider 是外仓 Go，本会话的构建/运行处于审批 HOLD。**不绕过**：
        # 记下真实的启动拒绝码，把这组浏览器检查如实标成被挡住。
        try:
            lab.start_backend(enabled=True, lab_json=str(lab_json))
        except Exception as error:
            log = (Path(scratch) / 'backend-on.log')
            reason = None
            if log.exists():
                for line in log.read_text(errors='replace').splitlines():
                    if '服务器启动失败' in line or 'handoff_' in line:
                        reason = line.split('{')[0].strip()[:120]
                        for code in ('handoff_identity_not_ready', 'handoff_target_not_ready',
                                     'handoff_ledger_not_ready'):
                            if code in line:
                                reason = code
                        break
            report['blocked'] = {
                'stage': 'enabled_start', 'error': str(error)[:80], 'refusal_code': reason,
                'why': ('P03 正式运行时启动即要求 Identity 事实（formalRuntime.identityFacts），'
                        'Identity provider 是外仓 Go；本会话构建/运行外仓 Go 被审核拒绝且处于 HOLD。'
                        '这是产品自身的 fail-closed 准入门，不是 harness 缺陷，也没有被绕过。'),
                'what_is_still_needed': ('放行外仓 Go 之后，本文件按原样再跑一次即可；四组判定与新增的 '
                                         'cooldown 观察命令都已就绪。')}
            report['stage'] = 'blocked_by_admission_gate'
            return report
        lab.start_web()
        lab.start_worker(EVIDENCE)
        desktop = {'width': 1280, 'height': 900}
        lab.browser('login', account=lab.accounts['teacher']['username'],
                    password=lab.accounts['teacher']['password'], viewport=desktop)
        lab.browser('open', screenshot='rc-0-conversation')
        report['stage'] = 'freeze'
        frozen = lab.browser('handoff', index=0, excerpt=EXCERPT, title='蒸发观察活动（两杯水）',
                             stop_before_confirm=True, screenshots='rc-1')
        need(frozen['posts_before_confirm'] == 0, 'the_preview_alone_sent_something')

        # 真实冻结一次（只到 ready，不保存：保存要连外仓目标，本轮不跑）
        confirmed = lab.browser('handoff', index=0, excerpt=EXCERPT, title='蒸发观察活动（两杯水）',
                                expect_status=[entry.TEXT['ready']], timeout=60000,
                                screenshots='rc-2')
        rows = lab.sql(["SELECT id, status, record FROM p03_handoff_operations ORDER BY id LIMIT 5"],
                       database=lab.database)[0]
        need(rows, 'no_operation_landed_in_the_ledger')
        op_id = rows[0]['id']
        report['checks']['frozen'] = {'operations_in_ledger': len(rows), 'status': rows[0]['status'],
                                      'confirmed_status': confirmed['view']['status']}

        def set_record(**changes):
            """把等待状态写进本地账本（fixture）：与运行时持久化的是同一条记录。"""
            row = lab.sql([f"SELECT record FROM p03_handoff_operations WHERE id='{op_id}'"],
                          database=lab.database)[0][0]['record']
            record = json.loads(row) if isinstance(row, str) else row
            record.update(changes)
            lab.sql([{'sql': "UPDATE p03_handoff_operations SET record=?, status=?, recovery_until=? WHERE id=?",
                      'params': [json.dumps(record, ensure_ascii=False), record.get('status', 'ready'),
                                 record.get('recovery_until'), op_id]}], database=lab.database)
            return record

        # ---- 1 等待中：三个对外按钮都不能按，倒计时看得见 ------------------------------------
        report['stage'] = 'waiting'
        now_ms = int(time.time() * 1000)
        set_record(status='unknown', retry_at=now_ms + 9000, recovery_until=now_ms + 600000)
        lab.browser('open')
        opened = lab.browser('cooldown', screenshot='rc-3-waiting')
        report['checks']['waiting'] = opened['during']
        verdict('the_countdown_is_visible_while_waiting', bool(opened['during']['cooldown']),
                '等待中页面确实显示倒计时')
        verdict('save_retry_and_refresh_are_all_unusable_while_waiting',
                all(opened['during'][name]['present'] is False or opened['during'][name]['disabled'] is True
                    for name in ('confirm', 'retry', 'refresh')),
                '三个对外按钮要么不在，要么按不动')

        # ---- 2 倒计时结束：只恢复按钮，零自动请求 ---------------------------------------------
        report['stage'] = 'countdown_ends'
        ended = lab.browser('cooldown', watch_ms=12000, screenshot='rc-4-after-countdown', timeout=120)
        outward = [item for item in ended['requests'] if item['method'] != 'GET']
        report['checks']['countdown_ends'] = {'before': ended['during'], 'after': ended['after'],
                                              'requests_while_watching': ended['requests'],
                                              'outward_requests': outward}
        verdict('the_countdown_runs_out_and_the_buttons_come_back',
                ended['after']['cooldown'] is None
                and any(ended['after'][name]['present'] and ended['after'][name]['disabled'] is False
                        for name in ('retry', 'refresh')))
        verdict('nothing_is_sent_by_itself_when_the_countdown_ends', outward == [],
                '倒计时结束只恢复按钮，不替老师发任何请求')

        # ---- 3 重开：既有等待被恢复，不是重新开始 ---------------------------------------------
        report['stage'] = 'reopen_restores_the_wait'
        now_ms = int(time.time() * 1000)
        set_record(status='unknown', retry_at=now_ms + 20000, recovery_until=now_ms + 600000)
        lab.browser('open')
        restored = lab.browser('cooldown', screenshot='rc-5-reopened')
        report['checks']['reopen_restores_the_wait'] = {'view': restored['during'],
                                                        'requests': restored['requests']}
        verdict('reopening_restores_the_wait_that_was_already_running',
                bool(restored['during']['cooldown'])
                and all(restored['during'][name]['present'] is False or restored['during'][name]['disabled'] is True
                        for name in ('retry', 'refresh')),
                '等待写在账本里，刷新页面之后仍然在等')

        # ---- 4 R 到期：没有对外操作可点 --------------------------------------------------------
        report['stage'] = 'past_R'
        now_ms = int(time.time() * 1000)
        set_record(status='unknown', retry_at=None, recovery_until=now_ms - 1000)
        lab.browser('open')
        past = lab.browser('cooldown', watch_ms=4000, screenshot='rc-6-past-R')
        outward = [item for item in past['requests'] if item['method'] != 'GET']
        report['checks']['past_R'] = {'view': past['during'], 'after': past['after'],
                                      'requests': past['requests'], 'outward_requests': outward}
        verdict('after_R_there_is_no_outward_operation_left',
                past['during']['refresh']['present'] is False and outward == [],
                'R 之后刷新/重试不再出现，也没有任何对外请求')

        report['passed'] = all(item['ok'] for item in report['verdicts'].values())
        report['stage'] = 'done'
        return report
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
            try:
                lab.close()
            except Exception:
                pass
        if container:
            subprocess.run(['docker', 'rm', '-f', container], capture_output=True, timeout=120)
        subprocess.run(['rm', '-rf', scratch], timeout=60)
        failed = sorted(name for name, item in report['verdicts'].items() if not item['ok'])
        print(json.dumps({'passed': report['passed'], 'stage': report['stage'], 'failed_verdicts': failed,
                          'blocked': report.get('blocked', {}).get('refusal_code'),
                          'evidence': str(EVIDENCE)}, ensure_ascii=False))


if __name__ == '__main__':
    main()

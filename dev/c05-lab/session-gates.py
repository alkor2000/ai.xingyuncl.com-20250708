"""C05 收口验证：额度规则、兑换时资格、会话上下文与令牌期限。

真实件：本仓后端（node src/server.js）、一次性 mysql:8.0（本地库结构，无数据行）、一次性 redis:7-alpine、
真实 HTTP。合成件：edu 发行方与其 HMAC 密钥、全部学生 uuid、学校本身——**没有接真实 edu**。

用法：
  python3 dev/c05-lab/session-gates.py            # 记录并按"修复后应有的样子"判定
报告写在 storage/private/c05-validation/gates-*/report.json；未通过的判定逐条列在 verdicts 里，
失败不删证据。本脚本只跑本包的四项，不重跑首包 36 条/四宽度/P09。
"""
import json
import os
from pathlib import Path
import sys
import threading
import time
import uuid as uuidlib

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check as lab_mod                                     # noqa: E402  复用首包的容器/数据库/后端装配
from check import (C05_CONFIG, Issuer, Lab, STUDENT_GROUP, OTHER_SCHOOL_GROUP,  # noqa: E402
                   dotenv, docker, lab_uuid, need, node, student_payload, LOCAL_ENV, ROOT,
                   NODE_SQL)

EVIDENCE = ROOT / 'storage/private/c05-validation' / time.strftime('gates-%Y%m%dT%H%M%SZ', time.gmtime())
THIRD_GROUP = 11
AMOUNT = 100


def decode(token):
    """读 JWT 的载荷（只为核对 exp/role/ssoUser，不做验签——验签是服务端的事）。"""
    import base64
    body = token.split('.')[1]
    return json.loads(base64.urlsafe_b64decode(body + '=' * (-len(body) % 4)))


def main():
    report = {'started_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'synthetic': ['edu issuer and its HMAC key', 'every student uuid and school_ref',
                            'the school itself: no real edu deployment is connected'],
              'real': ['backend node src/server.js', 'mysql:8.0 from the local schema structure (no rows)',
                       'redis:7-alpine', 'real HTTP'],
              'stage': 'start', 'observed': {}, 'verdicts': {}, 'passed': False}
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    lab_mod.EVIDENCE = EVIDENCE
    import tempfile
    scratch = tempfile.mkdtemp(prefix='c05-gates-')
    lab = None
    verdict = lambda name, ok, detail=None: report['verdicts'].__setitem__(name, {'ok': bool(ok), 'detail': detail})

    try:
        lab = Lab(scratch)
        lab.start_containers()
        local = dotenv(LOCAL_ENV)
        dump = ['docker', 'exec', '-e', 'MYSQL_PWD=' + local['DB_PASSWORD'], 'practice-mysql', 'mysqldump',
                '-u' + local['DB_USER'], '--skip-triggers', '--set-gtid-purged=OFF']
        import re as _re
        import subprocess
        structure = subprocess.run(dump + ['--no-data', '--skip-add-drop-table', local['DB_NAME']],
                                   capture_output=True, timeout=300)
        knex_rows = subprocess.run(dump + ['--no-create-info', local['DB_NAME'], 'knex_migrations',
                                           'knex_migrations_lock'], capture_output=True, timeout=120)
        need(structure.returncode == 0 and knex_rows.returncode == 0, 'local_schema_dump_failed')
        preimage = _re.sub(rb'-- (Dump completed on|Host:|Server version|MySQL dump).*', b'',
                           _re.sub(rb'AUTO_INCREMENT=\d+ ', b'', structure.stdout)).decode()
        lab.build_database(preimage, knex_rows.stdout.decode())
        lab.seed()
        # Both C05 candidates, applied by knex for real (the entry refuses to run without the session
        # context table, so this is also the "did the deployment apply it" gate being exercised).
        import shutil
        migrations = Path(scratch) / 'migrations-c05'
        shutil.copytree(ROOT / 'backend/migrations', migrations)
        candidates = sorted((ROOT / 'backend/migrations-candidates/c05').glob('*.js'))
        for candidate in candidates:
            (migrations / candidate.name).write_text(candidate.read_text().replace(
                "require('../../src/services/studentEntry/sessionContext')",
                'require(' + json.dumps(str(ROOT / 'backend/src/services/studentEntry/sessionContext')) + ')'))
        applied = node(lab_mod.NODE_KNEX, {'port': lab.mysql['port'], 'user': lab.app_user,
                                           'password': lab.app_password, 'database': lab.database,
                                           'directory': str(migrations)})
        need(applied.get('ok') and len(applied['result']['files']) == len(candidates),
             'c05_candidate_migrations_not_applied')
        report['observed']['migrations'] = {'applied': applied['result']['files']}
        # 第三个组：额度场景各自用独立的组，互不干扰。
        lab.sql([{'sql': '''INSERT INTO user_groups(id,name,description,credits_pool,credits_pool_used,
                            user_limit,is_active) VALUES(?,?,?,?,?,0,1)''',
                  'params': [THIRD_GROUP, '额度实验组', 'C05 gates', 150, 0]}])
        config = {**C05_CONFIG, 'school_groups': {'123': STUDENT_GROUP, '456': OTHER_SCHOOL_GROUP,
                                                  '777': THIRD_GROUP}}
        lab.write_config(config)
        issuer = Issuer(lab.issuer_secret)
        lab.start(enabled=True, label='gates')

        pool_of = lambda group: {k: int(v) for k, v in lab.sql(
            [f'SELECT credits_pool, credits_pool_used FROM user_groups WHERE id={group}'])[0][0].items()}
        user_of = lambda student: (lab.sql([f"SELECT id,role,status,group_id,credits_quota,used_credits,expire_at "
                                            f"FROM users WHERE uuid='{student}'"])[0] or [None])[0]

        # ---- 1 额度：契约 §4 说"不足则 0"，不是按剩余部分发 --------------------------------
        report['stage'] = 'issuance'
        issuance = {}

        # 1a 剩 30 而策略要 100
        lab.sql([f'UPDATE user_groups SET credits_pool=100, credits_pool_used=70 WHERE id={STUDENT_GROUP}'])
        before = pool_of(STUDENT_GROUP)
        student = lab_uuid(101)
        status, body, _ = lab.exchange(issuer, student_payload(student))
        after = pool_of(STUDENT_GROUP)
        row = user_of(student)
        issuance['shortfall'] = {'status': status, 'pool_before': before, 'pool_after': after,
                                 'account_created': bool(row),
                                 'granted': int(row['credits_quota']) if row else None}
        verdict('shortfall_grants_zero', status == 200 and row and int(row['credits_quota']) == 0,
                '契约 §4：池不足则发 0，且不扣池')
        verdict('shortfall_leaves_pool_alone', after['credits_pool_used'] == before['credits_pool_used'])

        # 1b 恰好够
        lab.sql([f'UPDATE user_groups SET credits_pool=100, credits_pool_used=0 WHERE id={STUDENT_GROUP}'])
        student = lab_uuid(102)
        status, body, _ = lab.exchange(issuer, student_payload(student))
        row = user_of(student)
        issuance['exact'] = {'status': status, 'granted': int(row['credits_quota']) if row else None,
                             'pool_after': pool_of(STUDENT_GROUP)}
        verdict('exact_amount_is_granted', status == 200 and row and int(row['credits_quota']) == AMOUNT)

        # 1c 两个学生同时抢一份半的池子：只有一个拿得到整份，另一个是 0，池子只动一次
        lab.sql([f'UPDATE user_groups SET credits_pool=150, credits_pool_used=0 WHERE id={THIRD_GROUP}'])
        racers = [lab_uuid(103), lab_uuid(104)]
        results, lock = [], threading.Lock()

        def first_login(student_uuid):
            outcome = lab.exchange(issuer, student_payload(student_uuid, org={'school_ref': '777'}))
            with lock:
                results.append((student_uuid, outcome[0], (outcome[1].get('error') or {}).get('code')))

        threads = [threading.Thread(target=first_login, args=(one,)) for one in racers]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=90)
        granted = {one: (int(user_of(one)['credits_quota']) if user_of(one) else None) for one in racers}
        issuance['race'] = {'results': results, 'granted': granted, 'pool_after': pool_of(THIRD_GROUP)}
        verdict('race_gives_one_full_share', sorted(v for v in granted.values() if v is not None) == [0, AMOUNT],
                '一份半的池子只够一个整份')
        verdict('race_charges_the_pool_once', pool_of(THIRD_GROUP)['credits_pool_used'] == AMOUNT)

        # 1d 事务中途真失败：把标签关系表改名，让同一事务里的写入真的报错
        lab.sql([f'UPDATE user_groups SET credits_pool=1000, credits_pool_used=0 WHERE id={STUDENT_GROUP}'])
        before = pool_of(STUDENT_GROUP)
        student = lab_uuid(105)
        lab.sql(['RENAME TABLE user_tag_relations TO user_tag_relations_hidden'])
        try:
            status, body, _ = lab.exchange(issuer, student_payload(student))
        finally:
            lab.sql(['RENAME TABLE user_tag_relations_hidden TO user_tag_relations'])
        row = user_of(student)
        issuance['rollback'] = {'status': status, 'code': (body.get('error') or {}).get('code'),
                                'account_created': bool(row), 'pool_before': before,
                                'pool_after': pool_of(STUDENT_GROUP)}
        verdict('failed_transaction_creates_nothing', status >= 400 and row is None)
        verdict('failed_transaction_charges_nothing',
                pool_of(STUDENT_GROUP)['credits_pool_used'] == before['credits_pool_used'])

        # 1e 再次登录不重复扣款
        student = lab_uuid(106)
        lab.exchange(issuer, student_payload(student))
        after_first = pool_of(STUDENT_GROUP)
        lab.exchange(issuer, student_payload(student))
        issuance['repeat_login'] = {'pool_after_first': after_first, 'pool_after_second': pool_of(STUDENT_GROUP),
                                    'granted': int(user_of(student)['credits_quota'])}
        verdict('repeat_login_does_not_charge_again',
                pool_of(STUDENT_GROUP)['credits_pool_used'] == after_first['credits_pool_used'])
        report['observed']['issuance'] = issuance

        # ---- 2 兑换时必须仍是学生、仍是同一张映射 ------------------------------------------
        report['stage'] = 'consume_gates'
        gates = {}
        lab.sql([f'UPDATE user_groups SET credits_pool=100000, credits_pool_used=0 WHERE id={STUDENT_GROUP}'])
        lab.sql([f'UPDATE user_groups SET is_active=1 WHERE id={STUDENT_GROUP}'])

        def ticket_for(number, **payload):
            student_uuid = lab_uuid(number)
            status, body, _ = lab.exchange(issuer, student_payload(student_uuid, **payload))
            need(status == 200, f'exchange_refused_for_{number}_{(body.get("error") or {}).get("code")}')
            return student_uuid, body['handoff']

        def gate(name, number, mutate, payload=None):
            student_uuid, handoff = ticket_for(number, **(payload or {}))
            mutate(student_uuid)
            status, body, _ = lab.consume(handoff)
            token = body.get('accessToken')
            gates[name] = {'status': status, 'code': (body.get('error') or {}).get('code'),
                           'issued_session': bool(token),
                           'token_role': decode(token).get('role') if token else None}
            return gates[name]

        result = gate('role_escalated_between_exchange_and_consume', 201,
                      lambda student: lab.sql([f"UPDATE users SET role='admin' WHERE uuid='{student}'"]))
        verdict('escalated_role_cannot_spend_the_ticket',
                result['issued_session'] is False and result['status'] >= 400,
                '交换时是学生不代表 60 秒后还是学生')

        result = gate('account_disabled', 202,
                      lambda student: lab.sql([f"UPDATE users SET status='inactive' WHERE uuid='{student}'"]))
        verdict('disabled_account_cannot_spend_the_ticket', result['issued_session'] is False)

        result = gate('account_expired', 203, lambda student: lab.sql(
            [f"UPDATE users SET expire_at = DATE_SUB(NOW(), INTERVAL 2 DAY) WHERE uuid='{student}'"]))
        verdict('expired_account_cannot_spend_the_ticket', result['issued_session'] is False,
                '与 authMiddleware 对过期账号的处理一致')

        result = gate('group_switched_off', 204, lambda student: lab.sql(
            [f'UPDATE user_groups SET is_active=0 WHERE id={STUDENT_GROUP}']))
        lab.sql([f'UPDATE user_groups SET is_active=1 WHERE id={STUDENT_GROUP}'])
        verdict('closed_school_cannot_spend_the_ticket', result['issued_session'] is False)

        def withdraw_mapping(_student):
            lab.write_config({**config, 'school_groups': {'456': OTHER_SCHOOL_GROUP}})
        result = gate('mapping_withdrawn', 205, withdraw_mapping)
        lab.write_config(config)
        verdict('withdrawn_school_cannot_spend_the_ticket', result['issued_session'] is False)

        def repoint_mapping(_student):
            lab.write_config({**config, 'school_groups': {'123': OTHER_SCHOOL_GROUP}})
        result = gate('mapping_repointed_to_another_group', 206, repoint_mapping)
        lab.write_config(config)
        verdict('repointed_school_cannot_spend_the_old_ticket', result['issued_session'] is False,
                '旧学校的作业线索不能套到新组')

        result = gate('student_moved_to_another_group', 207, lambda student: lab.sql(
            [f"UPDATE users SET group_id={OTHER_SCHOOL_GROUP} WHERE uuid='{student}'"]))
        verdict('moved_student_cannot_spend_the_old_ticket', result['issued_session'] is False)

        # 正常路径仍然通：门是门，不是墙
        student_uuid, handoff = ticket_for(208, context={'lesson_id': '456', 'assignment_id': '77'})
        status, session, _ = lab.consume(handoff)
        payload = decode(session['accessToken']) if session.get('accessToken') else {}
        lifetime = (payload.get('exp', 0) - payload.get('iat', 0)) if payload else None
        gates['clean_path'] = {'status': status, 'issued_session': bool(session.get('accessToken')),
                               'token_role': payload.get('role'), 'sso_flag': payload.get('ssoUser'),
                               'token_lifetime_seconds': lifetime,
                               'has_refresh': 'refreshToken' in session,
                               'context': session.get('context')}
        verdict('a_clean_ticket_still_works', status == 200 and bool(session.get('accessToken')))
        verdict('access_token_is_not_longer_than_12h', bool(lifetime) and lifetime <= 12 * 3600,
                f'实际 exp-iat = {lifetime} 秒（契约 §5 的 12h 上限，核的是真实 JWT 不是文档）')
        verdict('no_refresh_token_by_default', 'refreshToken' not in session)
        report['observed']['consume_gates'] = gates

        # ---- 3 会话上下文：刷新/新标签页可重读，别人读不到 ---------------------------------
        report['stage'] = 'session_context'
        token = session.get('accessToken')
        context = {}
        auth = {'Authorization': 'Bearer ' + token} if token else {}
        status, body, _ = lab.call('GET', '/api/auth/sso/context', headers=auth)
        context['own'] = {'status': status, 'body': body if status == 200 else
                          {'code': (body.get('error') or {}).get('code')}}
        verdict('the_session_can_read_its_own_trusted_context',
                status == 200 and (body.get('context') or {}).get('assignment_id') == '77',
                '契约 §4：context 要进会话，不只是回一次给浏览器')
        verdict('the_context_names_the_school_group_it_was_issued_for',
                status == 200 and int((body.get('scope') or {}).get('group_id') or 0) == STUDENT_GROUP)

        other_uuid, other_handoff = ticket_for(209)
        status_other, other_session, _ = lab.consume(other_handoff)
        other_token = other_session.get('accessToken')
        status, body, _ = lab.call('GET', '/api/auth/sso/context',
                                   headers={'Authorization': 'Bearer ' + other_token} if other_token else {})
        context['another_account'] = {'status': status,
                                      'assignment_id': ((body.get('context') or {}).get('assignment_id')
                                                        if status == 200 else None)}
        verdict('another_account_cannot_read_this_context',
                status != 200 or (body.get('context') or {}).get('assignment_id') != '77')

        status, _, _ = lab.call('GET', '/api/auth/sso/context')
        context['no_token'] = {'status': status}
        verdict('an_anonymous_request_gets_nothing', status == 401)

        logout_status, _, _ = lab.call('POST', '/api/auth/logout', body={}, headers=auth)
        status, body, _ = lab.call('GET', '/api/auth/sso/context', headers=auth)
        context['after_logout'] = {'logout_status': logout_status, 'status': status}
        verdict('an_invalidated_session_gets_nothing', status == 401)
        report['observed']['session_context'] = context

        # ---- 4 可选 refresh：要么受 24h 限制，要么具名拒绝 ---------------------------------
        report['stage'] = 'refresh_option'
        lab.stop()
        lab.write_config({**config, 'issue_refresh': True})
        lab.start(enabled=True, label='refresh')
        status, body, _ = lab.exchange(issuer, student_payload(lab_uuid(210)))
        refresh = {'exchange_status': status, 'code': (body.get('error') or {}).get('code')}
        if status == 200:
            status, session, _ = lab.consume(body['handoff'])
            refresh.update({'consume_status': status, 'has_refresh': 'refreshToken' in session})
            if session.get('refreshToken'):
                payload = decode(session['refreshToken'])
                refresh['refresh_lifetime_seconds'] = payload.get('exp', 0) - payload.get('iat', 0)
        report['observed']['refresh_option'] = refresh
        verdict('optional_refresh_is_either_capped_or_refused_by_name',
                refresh.get('code') is not None or refresh.get('has_refresh') is False
                or (refresh.get('refresh_lifetime_seconds') or 10 ** 9) <= 24 * 3600,
                '不能原样交出普通 14d 的 refresh')
        lab.stop()
        lab.write_config(config)

        # ---- 5 会话表候选迁移：有活会话时 down 具名拒绝 -------------------------------------
        report['stage'] = 'session_table_migration'
        live = int(lab.sql(['SELECT COUNT(*) AS n FROM c05_sessions WHERE expires_at > NOW()'])[0][0]['n'])
        refused = node(lab_mod.NODE_KNEX, {'port': lab.mysql['port'], 'user': lab.app_user,
                                           'password': lab.app_password, 'database': lab.database,
                                           'directory': str(migrations), 'down': True})
        lab.sql(['UPDATE c05_sessions SET expires_at = DATE_SUB(NOW(), INTERVAL 1 DAY)'])
        rolled = node(lab_mod.NODE_KNEX, {'port': lab.mysql['port'], 'user': lab.app_user,
                                          'password': lab.app_password, 'database': lab.database,
                                          'directory': str(migrations), 'down': True})
        gone = int(lab.sql(["SELECT COUNT(*) AS n FROM information_schema.tables "
                            "WHERE table_schema=DATABASE() AND table_name='c05_sessions'"])[0][0]['n'])
        report['observed']['session_table_migration'] = {
            'live_sessions': live, 'down_while_live': refused, 'down_after_expiry': rolled.get('result'),
            'table_after_down': gone}
        verdict('down_refuses_while_a_session_still_has_its_context',
                live > 0 and refused.get('ok') is False and 'c05_sessions_in_use' in refused.get('error', ''))
        verdict('down_removes_the_table_once_nothing_is_live', rolled.get('ok') and gone == 0)

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
        if lab:
            lab.stop()
            for container in (lab.mysql_container, lab.redis_container):
                if container:
                    import subprocess
                    subprocess.run(['docker', 'rm', '-f', container], capture_output=True, timeout=120)
        import subprocess
        subprocess.run(['rm', '-rf', scratch], timeout=60)
        failed = sorted(name for name, item in report['verdicts'].items() if not item['ok'])
        print(json.dumps({'passed': report['passed'], 'stage': report['stage'], 'failed_verdicts': failed,
                          'evidence': str(EVIDENCE)}, ensure_ascii=False))


if __name__ == '__main__':
    main()

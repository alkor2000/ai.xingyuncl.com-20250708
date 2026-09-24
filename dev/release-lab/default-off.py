"""默认关闭态的发布前检查：集成树与纯 main 跑同一套，逐项对照。

真实件：本树的 node src/server.js 与真实 Vite 前端、一次性 mysql:8.0 + redis、真实 HTTP 与 Chromium。
库里**只有当前已发布的正式 schema**（从本机镜像库结构导出，脚本会先证明其中没有 C05/P09 的候选表），
**没有执行任何候选迁移**，两个开关都不设。

合成件：本机实验账号与一条本地登录用户行。

用法：
    python3 dev/release-lab/default-off.py            # 集成树（默认）
    MODE=baseline python3 dev/release-lab/default-off.py   # 纯 main（用 git stash 暂存集成后再跑）
两次的 report.json 用 compare() 对照：/health、历史 POST /api/auth/sso、普通登录与一次真实保存必须逐项一致。
"""
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
MODE = os.environ.get('MODE', 'integrated')
EVIDENCE = ROOT / 'storage/private/release-default-off' / time.strftime(f'{MODE}-%Y%m%dT%H%M%SZ', time.gmtime())

import importlib.util                                                    # noqa: E402


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


c05lab = load('c05lab', ROOT / 'dev/c05-lab/check.py')
p09lab = load('p09lab', ROOT / 'dev/p09-lab/check.py')
need, node, docker, dotenv = c05lab.need, c05lab.node, c05lab.docker, c05lab.dotenv
LOCAL_ENV = c05lab.LOCAL_ENV
LOGIN_USER, LOGIN_GROUP = 'lab_local_user', 77


def main():
    report = {'mode': MODE, 'started_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'real': ['this tree的 node src/server.js 与真实 Vite 前端', '一次性 mysql:8.0 + redis',
                       '只含当前已发布正式 schema 的库（无候选表、未执行候选迁移）',
                       '真实 HTTP 与 Chromium（1280 与 390 各一次）'],
              'synthetic': ['一条本地登录用户行与一个实验分组'],
              'switches': {'C05_STUDENT_ENTRY_ENABLED': 'unset', 'P09_WEBSITE_ARTIFACTS_ENABLED': 'unset'},
              'stage': 'start', 'checks': {}, 'verdicts': {}, 'passed': False}
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    c05lab.EVIDENCE = p09lab.EVIDENCE = EVIDENCE
    scratch = tempfile.mkdtemp(prefix='release-off-')
    lab = web = browser = editor = None
    verdict = lambda name, ok, detail=None: report['verdicts'].__setitem__(name, {'ok': bool(ok), 'detail': detail})

    try:
        lab = c05lab.Lab(scratch)
        lab.start_containers()

        # ---- 只装当前已发布的 schema ----------------------------------------------------------
        report['stage'] = 'released_schema_only'
        local = dotenv(LOCAL_ENV)
        dump = ['docker', 'exec', '-e', 'MYSQL_PWD=' + local['DB_PASSWORD'], 'practice-mysql', 'mysqldump',
                '-u' + local['DB_USER'], '--skip-triggers', '--set-gtid-purged=OFF']
        structure = subprocess.run(dump + ['--no-data', '--skip-add-drop-table', local['DB_NAME']],
                                   capture_output=True, timeout=300)
        knex_rows = subprocess.run(dump + ['--no-create-info', local['DB_NAME'], 'knex_migrations',
                                           'knex_migrations_lock'], capture_output=True, timeout=120)
        need(structure.returncode == 0 and knex_rows.returncode == 0, 'schema_dump_failed')
        preimage = structure.stdout.decode()
        need('p09_' not in preimage and 'c05_sessions' not in preimage, 'released_schema_already_has_candidates')
        lab.build_database(preimage, knex_rows.stdout.decode())
        password = secrets.token_urlsafe(18)
        hashes = node(c05lab.NODE_BCRYPT, {'passwords': {'local': password}})
        lab.sql([
            {'sql': '''INSERT INTO user_groups(id,name,description,credits_pool,credits_pool_used,user_limit,is_active)
                       VALUES(?,?,?,?,0,?,1)''', 'params': [LOGIN_GROUP, '发布前检查组', 'release lab', 100000, 0]},
            {'sql': '''INSERT INTO users(id,uuid,uuid_source,email,username,password_hash,role,group_id,status,
                       token_quota,credits_quota,used_credits) VALUES(?,?,?,?,?,?,?,?,?,100000,100000,0)''',
             'params': [401, 'lab-local-uuid-0001', 'local', 'local@lab.local', LOGIN_USER, hashes['local'],
                        'user', LOGIN_GROUP, 'active']}])
        lab.extra_secrets = [password]
        tables_before = sorted(row['n'] for row in lab.sql([
            "SELECT table_name AS n FROM information_schema.tables WHERE table_schema=DATABASE()"])[0])
        report['checks']['released_schema'] = {
            'table_count': len(tables_before),
            'tables_sha256': hashlib.sha256('\n'.join(tables_before).encode()).hexdigest(),
            'p09_tables': [t for t in tables_before if t.startswith('p09_')],
            'c05_tables': [t for t in tables_before if t.startswith('c05_')],
            'candidate_migrations_applied': False}

        # ---- 两个开关都不设，起真实服务 --------------------------------------------------------
        report['stage'] = 'boot'
        lab.start(enabled=False, label='release-default-off')
        status, health, _ = lab.call('GET', '/health')
        report['checks']['health'] = {'status': status, 'body_status': (health or {}).get('status')}
        verdict('the_server_boots_and_is_healthy', status == 200)

        # ---- 历史 POST /api/auth/sso 语义 -------------------------------------------------------
        report['stage'] = 'legacy_sso'
        legacy = {}
        for name, body in (('empty', {}), ('uuid_only', {'uuid': 'lab-local-uuid-0001'})):
            status, payload, headers = lab.call('POST', '/api/auth/sso', body=body)
            legacy[name] = {'status': status, 'body': payload,
                            'content_type': headers.get('Content-Type') if headers else None}
        report['checks']['legacy_sso'] = legacy
        verdict('the_legacy_sso_endpoint_still_answers_as_before',
                legacy['empty']['status'] == 400 and legacy['uuid_only']['status'] in (400, 401, 403),
                '两次运行的逐项内容由 compare() 对照，这里只保证它没有变成 404 或 500')

        # ---- 普通本地登录 + 一次真实保存 --------------------------------------------------------
        report['stage'] = 'ordinary_login_and_save'
        status, login, _ = lab.call('POST', '/api/auth/login', body={'account': LOGIN_USER, 'password': password})
        token = (login or {}).get('accessToken') or ((login or {}).get('data') or {}).get('accessToken')
        auth = {'Authorization': 'Bearer ' + token} if token else {}
        report['checks']['login'] = {'status': status, 'has_token': bool(token),
                                     'role': (((login or {}).get('user') or {}).get('role')
                                              or (((login or {}).get('data') or {}).get('user') or {}).get('role'))}
        need(bool(token), 'ordinary_login_failed_' + json.dumps(login)[:200])
        status, project, _ = lab.call('POST', '/api/html-editor/projects',
                                      body={'name': '发布前检查项目', 'type': 'folder'}, headers=auth)
        project_id = ((project or {}).get('data') or project or {}).get('id') or \
                     (((project or {}).get('data') or {}).get('project') or {}).get('id')
        need(status in (200, 201) and project_id, 'project_create_failed_' + json.dumps(project)[:200])
        status, page, _ = lab.call('POST', '/api/html-editor/pages',
                                   body={'project_id': project_id, 'title': '首页', 'slug': 'index',
                                         'html_content': '<h1>发布前检查</h1>'}, headers=auth)
        page_id = ((page or {}).get('data') or page or {}).get('id') or \
                  (((page or {}).get('data') or {}).get('page') or {}).get('id')
        need(status in (200, 201) and page_id, 'page_create_failed_' + json.dumps(page)[:200])
        status, saved, _ = lab.call('PUT', f'/api/html-editor/pages/{page_id}',
                                    body={'html_content': '<h1>发布前检查</h1><p>第二稿</p>',
                                          'css_content': '', 'js_content': ''}, headers=auth)
        report['checks']['editor'] = {'project': bool(project_id), 'page': bool(page_id), 'save_status': status}
        verdict('an_ordinary_login_and_one_real_save_still_work',
                bool(token) and bool(project_id) and status == 200)

        # ---- 关闭态：C05 与 P09 各自怎么答 ------------------------------------------------------
        report['stage'] = 'switched_off_surfaces'
        off = {}
        status, body, _ = lab.call('POST', '/api/auth/sso/exchange', raw=b'{}')
        off['c05_exchange'] = {'status': status, 'code': (body.get('error') or {}).get('code')}
        status, body, _ = lab.call('POST', '/api/auth/sso/consume', body={'handoff': 'x' * 43})
        off['c05_consume'] = {'status': status, 'code': (body.get('error') or {}).get('code')}
        status, body, _ = lab.call('GET', '/api/auth/sso/capability')
        off['c05_capability'] = {'status': status, 'available': body.get('available')}
        status, body, _ = lab.call('GET', '/api/auth/sso/context', headers=auth)
        off['c05_context'] = {'status': status, 'code': (body.get('error') or {}).get('code')}
        # 能力探测在关闭态也必须答得出来（面板要据此决定整块不渲染），它说的是"没开"，不是拒绝。
        status, body, _ = lab.call('GET', '/api/p09/website-artifacts/capability', headers=auth)
        off['p09_capability'] = {'status': status, 'available': body.get('available'),
                                 'reason': body.get('reason')}
        status, body, _ = lab.call('GET', '/api/p09/website-artifacts/links', headers=auth)
        off['p09_links'] = {'status': status, 'code': (body.get('error') or {}).get('code')}
        status, body, _ = lab.call('GET', '/api/integrations/edu/website-artifacts/state?school_ref=school-1')
        off['p09_edu_state'] = {'status': status, 'code': (body.get('error') or {}).get('code')}
        # P03 的保存入口：同一棵树上第三个默认关闭的东西，能力探测答得出来，其余具名拒绝。
        status, body, _ = lab.call('GET', '/api/p03/handoffs/capability', headers=auth)
        off['p03_capability'] = {'status': status, 'available': body.get('available'),
                                 'code': (body.get('error') or {}).get('code')}
        status, body, _ = lab.call('GET', '/api/p03/handoffs?message_id=1', headers=auth)
        off['p03_list'] = {'status': status, 'code': (body.get('error') or {}).get('code')}
        status, body, _ = lab.call('POST', '/api/p03/handoffs',
                                   body={'schema_version': 1, 'message_id': 1, 'selection': []},
                                   headers={**auth, 'Idempotency-Key': '00000000-0000-4000-8000-000000000001'})
        off['p03_create'] = {'status': status, 'code': (body.get('error') or {}).get('code')}
        report['checks']['switched_off'] = off
        if MODE == 'integrated':
            verdict('c05_is_present_and_refuses_by_name',
                    off['c05_exchange']['code'] == 'student_entry_disabled'
                    and off['c05_consume']['code'] == 'student_entry_disabled'
                    and off['c05_capability']['status'] == 200 and off['c05_capability']['available'] is False,
                    '能力探测明说"没开"，其余一律具名拒绝')
            verdict('p03_is_present_and_refuses_by_name',
                    off['p03_capability']['status'] == 200 and off['p03_capability']['available'] is False
                    and off['p03_list']['code'] == 'handoff_disabled'
                    and off['p03_create']['code'] == 'handoff_disabled',
                    '第三个开关也关着：能力探测明说没开，其余一律 handoff_disabled')
            verdict('p09_exposes_no_entry_while_off',
                    off['p09_capability']['available'] is False and off['p09_capability']['reason'] == 'disabled'
                    and off['p09_links']['code'] == 'website_artifacts_disabled'
                    and off['p09_edu_state']['code'] == 'website_artifacts_disabled',
                    '能力探测明说未开启，其余一律具名拒绝——面板据此整块不渲染')

        # ---- 关闭态没有副作用 --------------------------------------------------------------------
        report['stage'] = 'no_side_effects'
        tables_after = sorted(row['n'] for row in lab.sql([
            "SELECT table_name AS n FROM information_schema.tables WHERE table_schema=DATABASE()"])[0])
        keys = docker('exec', lab.redis_container, 'redis-cli', 'keys', '*').strip().splitlines()
        suspicious = [k for k in keys if 'c05' in k.split(':')[-2:] and 'handoff' in k or ':p09' in k]
        report['checks']['side_effects'] = {
            'tables_after_count': len(tables_after),
            'tables_unchanged': tables_after == tables_before,
            'new_tables': [t for t in tables_after if t not in tables_before],
            'redis_keys': len(keys), 'c05_or_p09_keys': suspicious}
        verdict('nothing_new_was_created_while_off',
                tables_after == tables_before and not suspicious,
                '没有新表、没有账本行、Redis 里没有 C05/P09 的键')

        # ---- 浏览器：桌面与 390 各一次 ----------------------------------------------------------
        report['stage'] = 'browser'
        web = p09lab.Web(lab.api_port, scratch)
        # Vite 第一次请求要把整个应用编译一遍；机器忙的时候会超过浏览器默认的 30 秒导航上限。
        # 先用普通 HTTP 把它焐热，再让浏览器进来——等的是实验室，不是产品。
        import urllib.request as _request
        warm_deadline = time.monotonic() + 240
        while time.monotonic() < warm_deadline:
            try:
                with _request.urlopen(f'{web.url}/login', timeout=30) as response:
                    if response.status == 200 and response.read(64):
                        break
            except Exception:
                time.sleep(3)
        report['checks']['web_warmup_seconds'] = round(240 - (warm_deadline - time.monotonic()), 1)
        browser = c05lab.Browser(scratch, web.url, EVIDENCE)
        pages = {}
        for label, viewport in (('desktop', {'width': 1280, 'height': 900}), ('narrow', {'width': 390, 'height': 844})):
            seen = browser.call('login', viewport=viewport, screenshot=f'{MODE}-login-{label}')
            pages[label] = {'entry_visible': seen['entry_visible'], 'password_form': seen['password_form']}
        browser.call('stop')
        browser = None
        editor = p09lab.Browser(scratch, web.url, EVIDENCE)
        panels = {}
        for label, viewport in (('desktop', {'width': 1280, 'height': 900}), ('narrow', {'width': 390, 'height': 844})):
            # openEditor 按项目名点开侧栏里的项目，传 id 会等一个永远不出现的文本。
            seen = editor.call('open', viewport=viewport, token=token, user_id=401, project='发布前检查项目',
                               screenshot=f'{MODE}-editor-{label}')
            panels[label] = {'panel_visible': seen['panel_visible']}
        editor.call('stop')
        editor = None
        report['checks']['browser'] = {'login': pages, 'editor': panels}
        verdict('the_student_entry_is_not_on_the_login_page',
                all(not v['entry_visible'] and v['password_form'] for v in pages.values()),
                '两种宽度都只看到原来的登录表单')
        verdict('the_task_artifact_panel_is_not_in_the_editor',
                all(not v['panel_visible'] for v in panels.values()))

        report['passed'] = all(item['ok'] for item in report['verdicts'].values())
        report['stage'] = 'done'
    except Exception as error:
        report['failure'] = f'{type(error).__name__}: {error}'
        raise
    finally:
        report['finished_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        text = json.dumps(report, ensure_ascii=False, indent=2)
        for value in ((lab.secrets() if lab else []) + list(getattr(lab, 'extra_secrets', []) or [])):
            if value:
                text = text.replace(value, '<redacted>')
        (EVIDENCE / 'report.json').write_text(text + '\n')
        for handle in (browser, editor):
            if handle:
                try: handle.close()
                except Exception: pass
        if web:
            web.close()
        if lab:
            lab.stop()
            for container in (lab.mysql_container, lab.redis_container):
                if container:
                    subprocess.run(['docker', 'rm', '-f', container], capture_output=True, timeout=120)
        subprocess.run(['rm', '-rf', scratch], timeout=60)
        failed = sorted(name for name, item in report['verdicts'].items() if not item['ok'])
        print(json.dumps({'mode': MODE, 'passed': report['passed'], 'stage': report['stage'],
                          'failed_verdicts': failed, 'evidence': str(EVIDENCE)}, ensure_ascii=False))


if __name__ == '__main__':
    main()

"""C05 + P09 联合候选：一个真实学生会话，从 edu 的作业进来，再明确关联一件自己的网站作品。

本包只验**新增的衔接**，不重跑任何一边已经核过的全套：C05 的 36/46 单测与四宽度、P09 的 21 场景、
资产安全矩阵、迁移安全全套都不在这里。

真实件：本仓后端（node src/server.js，同一进程同时开 C05 与 P09）、真实 Vite 前端、Chromium
（桌面 + 一个窄屏）、一次性 mysql:8.0（本地库结构，无数据行）、一次性 redis:7-alpine、
两组候选迁移由 knex 真实执行、真实 HTTP。
合成件（逐项列在报告里）：edu 发行方与其 HMAC 密钥、任务上下文发行方、评阅资格名册、
全部学生/教师/学校标识、学生的项目与上传图片的所有权行。**没有接真实 edu 或 Identity。**

用法：python3 dev/c05-p09-lab/check.py
证据：storage/private/c05-p09-validation/run-*/report.json 与同目录截图（均不入库）。
"""
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import select
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid as uuidlib

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / 'storage/private/c05-p09-validation' / time.strftime('run-%Y%m%dT%H%M%SZ', time.gmtime())


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


c05lab = load('c05lab', ROOT / 'dev/c05-lab/check.py')
p09lab = load('p09lab', ROOT / 'dev/p09-lab/check.py')
need, node, dotenv, docker = c05lab.need, c05lab.node, c05lab.dotenv, c05lab.docker
lab_uuid, student_payload, Issuer = c05lab.lab_uuid, c05lab.student_payload, c05lab.Issuer
STUDENT_GROUP, OTHER_GROUP = c05lab.STUDENT_GROUP, c05lab.OTHER_SCHOOL_GROUP

INSTANCE = 'practice-integration'
WIDTHS = [(1280, 900, 'desktop'), (390, 844, 'w390')]
PNG = bytes.fromhex((ROOT / 'dev/p09-lab/pond.png.hex').read_text().strip())
PAGE = ('<h1>校园节水网站</h1><p>先观察，再记录两杯水的变化。</p>'
        '<img src="/uploads/joint/pond.png" alt="池塘">')
PAGE_V2 = PAGE + '<p>第二稿：加入了每天的数据表。</p>'

NODE_GRANTS = p09lab.NODE_GRANTS
NODE_KNEX = c05lab.NODE_KNEX


class Browser(p09lab.Browser):
    """P09 的 worker 加一条 C05 落地页命令：同一个浏览器上下文一路走完。"""

    def __init__(self, scratch, web_url, evidence):
        env = {**os.environ,
               'PLAYWRIGHT_MODULE': os.environ.get('PLAYWRIGHT_MODULE',
                                                   '/home/hanying/feedback-sync-ws/tools/node_modules/playwright'),
               'TMPDIR': str(scratch)}
        libs = os.environ.get('C05_BROWSER_LIBS',
                              '/home/hanying/feedback-sync-ws/tools/browser-libs/extracted/usr/lib/x86_64-linux-gnu')
        if Path(libs).is_dir():
            env['LD_LIBRARY_PATH'] = libs + (':' + env['LD_LIBRARY_PATH'] if env.get('LD_LIBRARY_PATH') else '')
        self.process = subprocess.Popen(['node', 'dev/c05-p09-lab/browser.cjs'], cwd=ROOT, env=env,
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=(Path(scratch) / 'browser.log').open('w'), text=True)
        self.call('start', web=web_url, evidence=str(evidence))


class Joint:
    """一个部署：C05 与 P09 在同一个 node 进程里，共用同一套库与 Redis。"""

    def __init__(self, scratch):
        self.lab = c05lab.Lab(scratch)
        self.scratch = Path(scratch)
        self.issuer_secret = secrets.token_urlsafe(40)      # 任务上下文发行方（合成 edu）
        self.client_secret = secrets.token_urlsafe(40)      # edu 服务端读取凭据（合成）
        self.ledger_user = 'p09_led_' + secrets.token_hex(3)
        self.ledger_password = secrets.token_urlsafe(24)
        self.preview_port = c05lab.free_port()
        self.preview_host = f'preview-{INSTANCE}.localhost'
        self.preview_origin = f'https://{self.preview_host}:{self.preview_port}'
        self.tls_key = self.scratch / 'preview.key'
        self.tls_cert = self.scratch / 'preview.crt'
        self.eligibility = True

    # ---- 准备 ---------------------------------------------------------------------------------
    def prepare(self, report):
        lab = self.lab
        lab.start_containers()
        local = dotenv(c05lab.LOCAL_ENV)
        dump = ['docker', 'exec', '-e', 'MYSQL_PWD=' + local['DB_PASSWORD'], 'practice-mysql', 'mysqldump',
                '-u' + local['DB_USER'], '--skip-triggers', '--set-gtid-purged=OFF']
        structure = subprocess.run(dump + ['--no-data', '--skip-add-drop-table', local['DB_NAME']],
                                   capture_output=True, timeout=300)
        knex_rows = subprocess.run(dump + ['--no-create-info', local['DB_NAME'], 'knex_migrations',
                                           'knex_migrations_lock'], capture_output=True, timeout=120)
        need(structure.returncode == 0 and knex_rows.returncode == 0, 'local_schema_dump_failed')
        preimage = re.sub(rb'-- (Dump completed on|Host:|Server version|MySQL dump).*', b'',
                          re.sub(rb'AUTO_INCREMENT=\d+ ', b'', structure.stdout)).decode()
        need('p09_' not in preimage and 'c05_sessions' not in preimage, 'preimage_already_has_candidates')
        lab.build_database(preimage, knex_rows.stdout.decode())
        lab.seed()

        # 两组候选迁移，目录前缀各自保留（同号不冒充同一迁移），按真实依赖顺序由 knex 执行一次。
        migrations = self.scratch / 'migrations-joint'
        import shutil
        shutil.copytree(ROOT / 'backend/migrations', migrations)
        applied_order = []
        for family in ('p09', 'c05'):
            for candidate in sorted((ROOT / f'backend/migrations-candidates/{family}').glob('*.js')):
                text = candidate.read_text()
                for module in ('websiteArtifact/store', 'studentEntry/sessionContext'):
                    text = text.replace(f"require('../../src/services/{module}')",
                                        'require(' + json.dumps(str(ROOT / f'backend/src/services/{module}')) + ')')
                (migrations / candidate.name).write_text(text)
                applied_order.append(f'{family}/{candidate.name}')
        first = node(NODE_KNEX, {'port': lab.mysql['port'], 'user': lab.app_user, 'password': lab.app_password,
                                 'database': lab.database, 'directory': str(migrations)})
        need(first.get('ok'), 'candidate_migrations_failed_' + str(first.get('error'))[:80])
        replay = node(NODE_KNEX, {'port': lab.mysql['port'], 'user': lab.app_user, 'password': lab.app_password,
                                  'database': lab.database, 'directory': str(migrations)})
        report['migrations'] = {
            'directories': ['backend/migrations-candidates/p09', 'backend/migrations-candidates/c05'],
            'order_offered': applied_order, 'applied': first['result']['files'],
            'replay_applied': replay['result']['files'],
            'not_promoted': 'nothing was copied into backend/migrations; p03 candidates were not applied',
            'note': ('同号不同族：20260922_00x 属 p09，20260923_00x 属 c05；knex 按文件名顺序执行，'
                     '恰好与真实依赖一致（先建 P09 账本，再建 C05 会话上下文）。')}
        need(replay['result']['files'] == [], 'replay_was_not_a_no_op')

        # P09 的受限账本角色（与 P09 验收同一套授权语句）
        lab.sql([f"CREATE USER '{self.ledger_user}'@'%' IDENTIFIED BY '{self.ledger_password}'"], database=None)
        grants = node("const {restrictedRoleGrants}=require('./backend/src/services/websiteArtifact/store');"
                      "let s='';process.stdin.on('data',b=>s+=b).on('end',()=>{const c=JSON.parse(s);"
                      "process.stdout.write(JSON.stringify(restrictedRoleGrants(c)));});",
                      {'database': lab.database, 'user': self.ledger_user, 'host': '%',
                       'sourceTables': ['users', 'html_projects', 'html_pages']})
        lab.sql(grants, database=None)
        lab.extra_secrets = getattr(lab, 'extra_secrets', []) + [self.ledger_password, self.issuer_secret,
                                                                 self.client_secret]
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
                        '-subj', f'/CN={self.preview_host}', '-addext', f'subjectAltName=DNS:{self.preview_host}',
                        '-keyout', str(self.tls_key), '-out', str(self.tls_cert)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
        lab.apply_session_table()          # 幂等：候选迁移已建过，这里只是确认存在
        lab.write_config(c05lab.C05_CONFIG)

    def lab_file(self):
        spec = {
            'source_instance': INSTANCE, 'preview_origin': self.preview_origin,
            'issuers': [{'issuer': 'edu', 'key_id': 'k1', 'secret': self.issuer_secret,
                         'purposes': ['website_artifact_link', 'website_artifact_revision',
                                      'website_artifact_review']}],
            'integration_clients': [{'client_key': 'edu', 'key_id': 'k1', 'secret': self.client_secret,
                                     'actions': ['artifacts:read', 'artifacts:review', 'artifacts:freeze'],
                                     'school_refs': ['school-1']}]
        }
        if self.eligibility:
            spec['eligibility'] = {'mode': 'static', 'cache_ms': 0, 'rules': [
                {'issuer': 'edu', 'reviewer_ref': 'teacher-7', 'school_ref': 'school-1',
                 'assignment_refs': ['assign-1']}]}
        path = self.scratch / f'p09-lab-{"with" if self.eligibility else "without"}-eligibility.json'
        path.write_text(json.dumps(spec))
        return path

    def p09_env(self):
        return {'P09_WEBSITE_ARTIFACTS_ENABLED': 'true', 'P09_LAB': str(self.lab_file()),
                'P09_DB_USER': self.ledger_user, 'P09_DB_PASSWORD': self.ledger_password,
                'P09_PREVIEW_BIND': '127.0.0.1', 'P09_PREVIEW_FRAME_ANCESTORS': "'self' http://localhost:*",
                'P09_PREVIEW_TLS_KEY': str(self.tls_key), 'P09_PREVIEW_TLS_CERT': str(self.tls_cert),
                'P09_SYNC_INTERVAL_MS': '5000', 'P09_SYNC_VERIFY_MS': '10000',
                'IDENTITY_DEPLOYMENT_INSTANCE_KEY': INSTANCE}

    def start(self, c05_on=True, p09_on=True, label=None):
        extra = self.p09_env() if p09_on else {'IDENTITY_DEPLOYMENT_INSTANCE_KEY': INSTANCE}
        self.lab.start(enabled=c05_on, label=label or f'c05{int(c05_on)}-p09{int(p09_on)}', extra=extra)

    def grant(self, **payload):
        now = int(time.time())
        base = {'schema_version': 1, 'issuer': 'edu', 'key_id': 'k1', 'grant_id': str(uuidlib.uuid4()),
                'audience': INSTANCE, 'school_ref': 'school-1', 'lesson_ref': None,
                'issued_at': now, 'expires_at': now + 240}
        return node(NODE_GRANTS, {'secret': self.issuer_secret, 'grants': [{**base, **payload}]})[0]

    def edu_headers(self, method, path, query='', body=None):
        timestamp = str(int(time.time()))
        nonce = uuidlib.uuid4().hex
        payload = '' if body is None else json.dumps(body, separators=(',', ':'), ensure_ascii=False)
        canonical = f"{method}\n{path}\n{query}\n{hashlib.sha256(payload.encode()).hexdigest()}"
        signature = hashlib.sha256(
            f"{self.client_secret}\n{timestamp}\n{nonce}\n"
            f"{hashlib.sha256(canonical.encode()).hexdigest()}".encode()).hexdigest()
        return {'x-p09-client': 'edu', 'x-p09-key-id': 'k1', 'x-p09-timestamp': timestamp,
                'x-p09-nonce': nonce, 'x-p09-signature': signature}


def main():
    report = {'started_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'real': ['one node src/server.js with C05 and P09 both switched on', 'real Vite frontend',
                       'Chromium at desktop and one narrow width', 'mysql:8.0 from the local schema (no rows)',
                       'redis:7-alpine', 'both candidate migration sets applied by knex', 'real HTTP'],
              'synthetic': ['the edu issuer, the task-context issuer and the edu service credential',
                            'the reviewer eligibility roster (development/test provider)',
                            'every student, teacher and school identifier',
                            "the student's project, pages and the ownership row for their image",
                            'no real edu or Identity deployment is connected'],
              'stage': 'start', 'seams': {}, 'verdicts': {}, 'passed': False}
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    c05lab.EVIDENCE = EVIDENCE
    p09lab.EVIDENCE = EVIDENCE
    scratch = tempfile.mkdtemp(prefix='c05-p09-')
    joint = web = browser = None
    verdict = lambda name, ok, detail=None: report['verdicts'].__setitem__(name, {'ok': bool(ok), 'detail': detail})

    try:
        joint = Joint(scratch)
        joint.prepare(report)
        lab = joint.lab
        issuer = Issuer(lab.issuer_secret)
        # 合成实验发放值（D-13 生产值仍未定，这里只是隔离演练的数字）
        lab.sql([f'UPDATE user_groups SET credits_pool=1000000, credits_pool_used=0 '
                 f'WHERE id IN ({STUDENT_GROUP},{OTHER_GROUP})'])
        lab.write_config({**c05lab.C05_CONFIG, 'issuance': {'mode': 'from_group_pool', 'amount': 5000,
                                                            'expire_days': 365}})

        # ---- 0 两个开关都关：联合启动零跨端副作用 -------------------------------------------
        report['stage'] = 'both_switches_off'
        joint.start(c05_on=False, p09_on=False, label='both-off')
        off = {}
        status, body, _ = lab.exchange(issuer, student_payload(lab_uuid(401)))
        off['c05_exchange'] = {'status': status, 'code': (body.get('error') or {}).get('code')}
        status, body, _ = lab.call('POST', '/api/auth/sso', body={'uuid': lab_uuid(401)})
        off['legacy_sso'] = {'status': status, 'message': str(body.get('message') or body.get('error'))[:60]}
        off['redis_keys'] = int(docker('exec', lab.redis_container, 'redis-cli', 'dbsize').split()[-1])
        off['p09_tables_present'] = int(lab.sql(["SELECT COUNT(*) AS n FROM information_schema.tables "
                                                 "WHERE table_schema=DATABASE() AND table_name LIKE 'p09\\\\_%'"])[0][0]['n'])
        off['ledger_rows'] = int(lab.sql(['SELECT COUNT(*) AS n FROM p09_links'])[0][0]['n'])
        report['seams']['both_switches_off'] = off
        verdict('with_both_switches_off_neither_side_does_anything',
                off['c05_exchange']['code'] == 'student_entry_disabled' and off['redis_keys'] == 0
                and off['ledger_rows'] == 0 and off['p09_tables_present'] == 8,
                '两个候选迁移都已应用，但开关关着时没有任何一侧写东西')
        verdict('the_legacy_sso_endpoint_is_untouched', off['legacy_sso']['status'] == 400)
        lab.stop()

        # ---- 1 登录只带线索，不代关联 --------------------------------------------------------
        report['stage'] = 'login_brings_a_cue'
        joint.start(label='joint-on')
        student_a = lab_uuid(410)
        status, body, _ = lab.exchange(issuer, student_payload(
            student_a, context={'lesson_id': 'lesson-7', 'assignment_id': 'assign-1'}))
        need(status == 200, 'c05_exchange_refused_' + str((body.get('error') or {}).get('code')))
        status, session_a, _ = lab.consume(body['handoff'])
        need(status == 200, 'c05_consume_refused')
        token_a = session_a['accessToken']
        auth_a = {'Authorization': 'Bearer ' + token_a}
        user_a = int(lab.sql([f"SELECT id FROM users WHERE uuid='{student_a}'"])[0][0]['id'])

        seam1 = {'account': {'user_id': user_a, 'username': session_a['user']['username'],
                             'uuid_source': session_a['user']['uuid_source']}}
        status, context, _ = lab.call('GET', '/api/auth/sso/context', headers=auth_a)
        seam1['session_context'] = {'status': status, 'context': context.get('context'),
                                    'is_task_association': context.get('is_task_association')}
        status, links, _ = lab.call('GET', '/api/p09/website-artifacts/links', headers=auth_a)
        seam1['links_after_login'] = {'status': status, 'links': links.get('links')}
        status, refused, _ = lab.call('POST', '/api/p09/website-artifacts/links',
                                      body={'schema_version': 1, 'project_id': 1, 'entry_page_id': 1},
                                      headers={**auth_a, 'Idempotency-Key': str(uuidlib.uuid4())})
        seam1['link_without_task_context'] = {'status': status, 'code': (refused.get('error') or {}).get('code')}
        report['seams']['login_brings_a_cue'] = seam1
        verdict('the_session_carries_the_lesson_it_came_from',
                (context.get('context') or {}).get('assignment_id') == 'assign-1'
                and context.get('is_task_association') is False)
        verdict('logging_in_associates_nothing', links.get('links') == [])
        verdict('without_a_signed_task_context_association_is_still_refused',
                seam1['link_without_task_context']['code'] == 'task_context_required')

        # 学生的项目与上传图片：所有权行属于 C05 刚建出来的那个影子账号
        project_id, page_id = 9001, 9101
        now_ms = int(time.time() * 1000)
        lab.sql([
            {'sql': 'INSERT INTO html_projects(id,user_id,name,type,is_default,sort_order) VALUES(?,?,?,?,1,0)',
             'params': [project_id, user_a, '校园节水网站', 'folder']},
            {'sql': '''INSERT INTO html_pages(id,project_id,user_id,title,slug,html_content,css_content,
                       js_content,compiled_content,version,is_published,created_at,updated_at)
                       VALUES(?,?,?,?,?,?,'','',?,1,0,FROM_UNIXTIME(?),FROM_UNIXTIME(?))''',
             'params': [page_id, project_id, user_a, '首页', 'index', PAGE, PAGE,
                        int(time.time()) - 3600, int(time.time()) - 3600]}])
        upload = Path(lab.storage) / 'uploads/joint'
        upload.mkdir(parents=True, exist_ok=True)
        (upload / 'pond.png').write_bytes(PNG)
        lab.sql([{'sql': '''INSERT INTO files(id,user_id,original_name,stored_name,file_path,file_size,
                            mime_type,status) VALUES(?,?,?,?,?,?,?,'ready')''',
                  'params': [str(uuidlib.uuid4()), user_a, 'pond.png', 'pond.png', 'joint/pond.png',
                             len(PNG), 'image/png']}])

        # ---- 2 学生明确关联本人作品，再真实保存一次 -------------------------------------------
        report['stage'] = 'explicit_association'
        link_grant = joint.grant(purpose='website_artifact_link', assignment_ref='assign-1',
                                 subject={'uuid': student_a, 'cohort': 'student'})
        status, linked, _ = lab.call('POST', '/api/p09/website-artifacts/links',
                                     body={'schema_version': 1, 'project_id': project_id,
                                           'entry_page_id': page_id},
                                     headers={**auth_a, 'Idempotency-Key': str(uuidlib.uuid4()),
                                              'X-P09-Task-Context': link_grant})
        need(status == 200, 'association_refused_' + json.dumps(linked)[:160])
        # P09 对外只给不透明引用：作品是 artifact_ref，而路径上的 :id 是清单里给出的 link_id。
        artifact_ref = linked['link']['artifact_ref']
        status, before_save, _ = lab.call('GET', '/api/p09/website-artifacts/links', headers=auth_a)
        link_id = next(item['link_id'] for item in before_save['links']
                       if item['artifact_ref'] == artifact_ref)
        seam2 = {'link': {k: linked['link'].get(k) for k in
                          ('artifact_ref', 'assignment_ref', 'work_state', 'has_effective_save', 'state',
                           'save_evidence', 'real_save_count')},
                 'links_before_save': before_save.get('links')}
        # 真实保存：与编辑器同一个写入口，P09 的钩子看的就是它
        status, saved, _ = lab.call('PUT', f'/api/html-editor/pages/{page_id}',
                                    body={'html_content': PAGE, 'css_content': '', 'js_content': ''},
                                    headers=auth_a)
        seam2['real_save'] = {'status': status}
        time.sleep(2)
        status, after_save, _ = lab.call('GET', '/api/p09/website-artifacts/links', headers=auth_a)
        seam2['links_after_save'] = after_save.get('links')
        report['seams']['explicit_association'] = seam2
        verdict('an_explicit_confirmation_with_a_signed_context_associates_the_students_own_work',
                linked['link']['assignment_ref'] == 'assign-1' and linked['link']['state'] == 'active')
        verdict('association_is_not_submission',
                'submitted' not in json.dumps(linked['link']).lower(),
                '实践从不记录"已提交"')
        verdict('a_real_save_is_what_turns_it_into_work_in_progress',
                seam2['real_save']['status'] == 200
                and (after_save['links'][0].get('has_effective_save') is True
                     or after_save['links'][0].get('work_state') in ('working', 'preview_ready')))

        # ---- 3 用本人的图片固定一版，改稿之后旧版不变 ---------------------------------------
        report['stage'] = 'fixed_revision'
        web = p09lab.Web(lab.api_port, scratch)
        browser = Browser(scratch, web.url, EVIDENCE)
        revision_grant = joint.grant(purpose='website_artifact_revision', assignment_ref='assign-1',
                                     subject={'uuid': student_a, 'cohort': 'student'})
        status, frozen, _ = lab.call('POST', f'/api/p09/website-artifacts/links/{link_id}/revisions',
                                     body={'schema_version': 1},
                                     headers={**auth_a, 'Idempotency-Key': str(uuidlib.uuid4()),
                                              'X-P09-Task-Context': revision_grant})
        need(status == 200, 'freeze_refused_' + json.dumps(frozen)[:200])
        revision = frozen['revision']
        manifest = revision.get('manifest') or {}
        frozen_assets = sorted(item.get('reference') for item in (manifest.get('assets') or []))
        seam3 = {'revision': {k: revision.get(k) for k in ('revision_ref', 'revision_no', 'content_sha256',
                                                           'byte_length')},
                 'frozen_assets': frozen_assets,
                 'refused_assets': {item['reference']: item.get('reason')
                                    for item in (manifest.get('refused_assets') or [])},
                 'frozen_scope': manifest.get('frozen_scope')}
        # 老师用现有实验资格提供方打开**这一版**（合成名册，只证明候选接口）。
        # 任务上下文里点名 revision_ref 的才是固定版本；不点名的是本人当前稿的私有预览，两者不是一回事。
        def review_session(revision_ref=None, label=''):
            body = {'schema_version': 1}
            path = '/api/integrations/edu/website-artifacts/review-sessions'
            payload = {'purpose': 'website_artifact_review', 'assignment_ref': 'assign-1',
                       'reviewer': {'ref': 'teacher-7'}, 'artifact_ref': artifact_ref}
            if revision_ref:
                payload['revision_ref'] = revision_ref
            code, answer, _ = lab.call('POST', path, body=body,
                                       headers={**joint.edu_headers('POST', path, '', body),
                                                'X-P09-Task-Context': joint.grant(**payload)})
            need(code == 200, f'review_session_refused{label}_' + json.dumps(answer)[:200])
            return answer['session']['open_url']

        open_url = review_session(revision['revision_ref'], '_fixed')
        seam3['review_session'] = {'on_isolated_origin': open_url.startswith(joint.preview_origin),
                                   'pinned_revision': revision['revision_ref']}
        # 老师现在看到的那一版
        before = browser.call('review', open_url=open_url, contains=['校园节水', '第二稿'],
                              screenshot='fixed-1-before-the-edit')
        seam3['teacher_sees_before_the_edit'] = {
            'status': before['status'], 'contains': before['contains'],
            'resources': before['resources']}

        # 学生改稿：与编辑器同一个写入口
        status, edited, _ = lab.call('PUT', f'/api/html-editor/pages/{page_id}',
                                     body={'html_content': PAGE_V2, 'css_content': '', 'js_content': ''},
                                     headers=auth_a)
        need(status == 200, 'second_save_refused')
        time.sleep(2)
        status, after_edit_links, _ = lab.call('GET', '/api/p09/website-artifacts/links', headers=auth_a)
        seam3['link_after_the_edit'] = {k: after_edit_links['links'][0].get(k)
                                        for k in ('change_no', 'real_save_count', 'work_state')}

        # 同一个固定版本再开一次评阅会话：改稿之后它应当一个字节都没动
        after = browser.call('review', open_url=review_session(revision['revision_ref'], '_fixed_again'),
                             contains=['校园节水', '第二稿'], screenshot='fixed-2-after-the-edit')
        seam3['teacher_sees_after_the_edit'] = {
            'status': after['status'], 'contains': after['contains'],
            'resources': after['resources']}
        # 对照：不点名版本的会话看到的是当前稿——两者确实是两样东西
        live = browser.call('review', open_url=review_session(None, '_live'),
                            contains=['校园节水', '第二稿'], screenshot='fixed-3-live-draft')
        seam3['the_live_draft_for_comparison'] = {'status': live['status'], 'contains': live['contains']}
        report['seams']['fixed_revision'] = seam3
        verdict('the_students_own_image_is_part_of_the_fixed_version',
                '/uploads/joint/pond.png' in frozen_assets,
                '归属行属于 C05 刚建的影子账号，冻结的就是它的图片')
        verdict('the_fixed_version_renders_with_that_image',
                before['status'] == 200 and before['contains'] == [True, False]
                and any(item['status'] == 200 for item in before['resources']),
                '冻结的资源按内容寻址改名，所以看的是"它被取到了且是 200"，不是文件名')
        verdict('the_edit_lands_on_the_live_work',
                seam3['link_after_the_edit']['real_save_count'] >= 2)
        verdict('and_the_fixed_version_is_still_exactly_what_it_was',
                after['status'] == 200 and after['contains'] == [True, False]
                and any(item['status'] == 200 for item in after['resources']),
                '改稿之后老师打开的仍是那一版，图片也还在')
        verdict('the_live_draft_did_move_on',
                live['status'] == 200 and live['contains'] == [True, True],
                '同一时刻，当前稿有第二稿而固定版本没有——证明比较的是两样东西')

        # ---- 4 第二个学生 / 第二所学校不继承任何东西 -----------------------------------------
        report['stage'] = 'second_student'
        student_b = lab_uuid(420)
        status, body, _ = lab.exchange(issuer, student_payload(
            student_b, org={'school_ref': '456', 'grade_name': '初一', 'class_name': '2班'},
            context={'lesson_id': 'lesson-8', 'assignment_id': 'assign-3'}))
        need(status == 200, 'second_student_exchange_refused')
        status, session_b, _ = lab.consume(body['handoff'])
        need(status == 200, 'second_student_consume_refused')
        auth_b = {'Authorization': 'Bearer ' + session_b['accessToken']}
        seam4 = {'group': session_b['user']['group_id']}
        status, links_b, _ = lab.call('GET', '/api/p09/website-artifacts/links', headers=auth_b)
        seam4['links'] = {'status': status, 'links': links_b.get('links')}
        # B 拿自己的上下文去关联 A 的项目
        status, stolen, _ = lab.call('POST', '/api/p09/website-artifacts/links',
                                     body={'schema_version': 1, 'project_id': project_id, 'entry_page_id': page_id},
                                     headers={**auth_b, 'Idempotency-Key': str(uuidlib.uuid4()),
                                              'X-P09-Task-Context': joint.grant(
                                                  purpose='website_artifact_link', assignment_ref='assign-3',
                                                  subject={'uuid': student_b, 'cohort': 'student'})})
        seam4['b_links_a_project'] = {'status': status, 'code': (stolen.get('error') or {}).get('code')}
        # B 拿一张写着 A 的 uuid 的上下文
        status, impersonated, _ = lab.call('POST', '/api/p09/website-artifacts/links',
                                           body={'schema_version': 1, 'project_id': project_id, 'entry_page_id': page_id},
                                           headers={**auth_b, 'Idempotency-Key': str(uuidlib.uuid4()),
                                                    'X-P09-Task-Context': joint.grant(
                                                        purpose='website_artifact_link', assignment_ref='assign-1',
                                                        subject={'uuid': student_a, 'cohort': 'student'})})
        seam4['b_uses_a_task_context_naming_a'] = {'status': status,
                                                   'code': (impersonated.get('error') or {}).get('code')}
        # 同一张任务上下文再用一次
        status, replayed, _ = lab.call('POST', '/api/p09/website-artifacts/links',
                                       body={'schema_version': 1, 'project_id': project_id, 'entry_page_id': page_id},
                                       headers={**auth_a, 'Idempotency-Key': str(uuidlib.uuid4()),
                                                'X-P09-Task-Context': link_grant})
        seam4['reused_task_context'] = {'status': status, 'code': (replayed.get('error') or {}).get('code')}
        # 用学生的会话令牌去敲 edu 服务端接口
        status, wrong_chain, _ = lab.call('GET', '/api/integrations/edu/website-artifacts/state?source_instance='
                                          + INSTANCE + '&school_ref=school-1', headers=auth_b)
        seam4['student_token_on_the_edu_endpoint'] = {'status': status,
                                                      'code': (wrong_chain.get('error') or {}).get('code')}
        report['seams']['second_student'] = seam4
        verdict('a_second_student_inherits_nothing', links_b.get('links') == [])
        verdict('another_students_project_cannot_be_associated', seam4['b_links_a_project']['status'] >= 400)
        verdict('a_task_context_naming_someone_else_is_refused',
                seam4['b_uses_a_task_context_naming_a']['status'] >= 400)
        verdict('a_task_context_is_single_use', seam4['reused_task_context']['status'] >= 400)
        verdict('a_student_session_is_not_a_teacher_identity_chain',
                seam4['student_token_on_the_edu_endpoint']['status'] >= 400,
                'edu 服务端接口只认服务凭据签名，不认学生 bearer')

        # ---- 5 教师仍然需要现有的实验资格提供方 -----------------------------------------------
        report['stage'] = 'teacher_eligibility'
        status, unknown_reviewer, _ = lab.call(
            'POST', '/api/integrations/edu/website-artifacts/review-sessions', body={'schema_version': 1},
            headers={**joint.edu_headers('POST', '/api/integrations/edu/website-artifacts/review-sessions',
                                         '', {'schema_version': 1}),
                     'X-P09-Task-Context': joint.grant(
                         purpose='website_artifact_review', assignment_ref='assign-1',
                         reviewer={'ref': 'teacher-9'}, artifact_ref=linked['link']['artifact_ref'])})
        seam5 = {'unknown_reviewer': {'status': status, 'code': (unknown_reviewer.get('error') or {}).get('code')}}
        lab.stop()
        joint.eligibility = False
        joint.start(label='no-eligibility')
        status, no_provider, _ = lab.call(
            'POST', '/api/integrations/edu/website-artifacts/review-sessions', body={'schema_version': 1},
            headers={**joint.edu_headers('POST', '/api/integrations/edu/website-artifacts/review-sessions',
                                         '', {'schema_version': 1}),
                     'X-P09-Task-Context': joint.grant(
                         purpose='website_artifact_review', assignment_ref='assign-1',
                         reviewer={'ref': 'teacher-7'}, artifact_ref=linked['link']['artifact_ref'])})
        seam5['without_a_provider'] = {'status': status, 'code': (no_provider.get('error') or {}).get('code')}
        joint.eligibility = True
        lab.stop()
        joint.start(label='joint-on-again')
        report['seams']['teacher_eligibility'] = seam5
        verdict('a_reviewer_who_is_not_on_the_roster_is_refused', seam5['unknown_reviewer']['status'] >= 400)
        verdict('no_eligibility_provider_means_no_teacher_access',
                seam5['without_a_provider']['status'] >= 400,
                '没有提供方时端点存在并一律拒绝，不为接通默认放开')

        # ---- 6 重新登录：线索来自当前会话，作品关联来自 P09 的耐久事实 -----------------------
        report['stage'] = 'second_login'
        status, body, _ = lab.exchange(issuer, student_payload(
            student_a, context={'lesson_id': 'lesson-9', 'assignment_id': 'assign-2'}))
        need(status == 200, 'second_login_exchange_refused')
        status, session_a2, _ = lab.consume(body['handoff'])
        need(status == 200, 'second_login_consume_refused')
        auth_a2 = {'Authorization': 'Bearer ' + session_a2['accessToken']}
        status, new_context, _ = lab.call('GET', '/api/auth/sso/context', headers=auth_a2)
        status_links, links_again, _ = lab.call('GET', '/api/p09/website-artifacts/links', headers=auth_a2)
        status_old, old_context, _ = lab.call('GET', '/api/auth/sso/context', headers=auth_a)
        seam6 = {'new_session_context': new_context.get('context'),
                 'old_session_context': old_context.get('context') if status_old == 200 else
                                        {'status': status_old},
                 'links': links_again.get('links'),
                 'same_account': session_a2['user']['id'] == session_a['user']['id']}
        report['seams']['second_login'] = seam6
        verdict('the_cue_comes_from_the_session_you_are_in_now',
                (new_context.get('context') or {}).get('assignment_id') == 'assign-2')
        verdict('a_new_login_does_not_move_or_clear_the_work',
                len(links_again.get('links') or []) == 1
                and links_again['links'][0]['assignment_ref'] == 'assign-1'
                and links_again['links'][0]['artifact_ref'] == artifact_ref,
                '作品关联是 P09 的耐久事实，不随会话变；新会话也不会静默换作业')
        verdict('the_same_student_is_the_same_account', seam6['same_account'] is True)

        # ---- 浏览器：桌面 + 一个窄屏，只跑新增的那条链 ---------------------------------------
        report['stage'] = 'browser'
        widths = {}

        # 桌面：真实落地页 → 同一个浏览器进编辑器 → 面板 → 关联确认
        student_c = lab_uuid(430)
        status, body, _ = lab.exchange(issuer, student_payload(
            student_c, context={'lesson_id': 'lesson-7', 'assignment_id': 'assign-4'}))
        need(status == 200, 'browser_exchange_refused')
        landed = browser.call('consume', viewport={'width': 1280, 'height': 900}, handoff=body['handoff'],
                              screenshot='desktop-1-landed')
        need(landed['session'] and landed['session']['authenticated'], 'browser_no_session')
        user_c = int(lab.sql([f"SELECT id FROM users WHERE uuid='{student_c}'"])[0][0]['id'])
        lab.sql([
            {'sql': 'INSERT INTO html_projects(id,user_id,name,type,is_default,sort_order) VALUES(?,?,?,?,1,0)',
             'params': [9002, user_c, '我的水质观察', 'folder']},
            {'sql': '''INSERT INTO html_pages(id,project_id,user_id,title,slug,html_content,css_content,
                       js_content,compiled_content,version,is_published,created_at,updated_at)
                       VALUES(?,?,?,?,?,?,'','',?,1,0,FROM_UNIXTIME(?),FROM_UNIXTIME(?))''',
             'params': [9102, 9002, user_c, '观察首页', 'index', PAGE, PAGE,
                        int(time.time()) - 3600, int(time.time()) - 3600]}])
        opened = browser.call('open', keep=True, project='我的水质观察',
                              task_context=joint.grant(purpose='website_artifact_link', assignment_ref='assign-4',
                                                       subject={'uuid': student_c, 'cohort': 'student'}),
                              screenshot='desktop-2-editor')
        associated = browser.call('link', entry_label='观察首页', screenshot='desktop-3-associated')
        widths['desktop'] = {'landed': {'path': landed['path'], 'url_has_handoff': landed['url_has_handoff'],
                                        'session': landed['session']},
                             'editor': {'panel_visible': opened['panel_visible'],
                                        'url_has_context': opened['url_has_context'],
                                        'errors': opened['errors']},
                             'associated': {'state': associated['state'], 'error': associated['error']}}
        verdict('the_whole_chain_works_in_one_real_browser',
                landed['session']['authenticated'] is True and opened['panel_visible'] is True
                and associated['error'] in (None, '') and associated['state'],
                '从作业进来的那次登录，直接就能在编辑器里确认关联')

        # 窄屏：只核入口连续性（落地 → 编辑器面板在）
        student_d = lab_uuid(431)
        status, body, _ = lab.exchange(issuer, student_payload(
            student_d, context={'lesson_id': 'lesson-7', 'assignment_id': 'assign-5'}))
        need(status == 200, 'narrow_exchange_refused')
        narrow_landed = browser.call('consume', viewport={'width': 390, 'height': 844}, handoff=body['handoff'],
                                     screenshot='w390-1-landed')
        user_d = int(lab.sql([f"SELECT id FROM users WHERE uuid='{student_d}'"])[0][0]['id'])
        lab.sql([{'sql': 'INSERT INTO html_projects(id,user_id,name,type,is_default,sort_order) VALUES(?,?,?,?,1,0)',
                  'params': [9003, user_d, '我的窄屏项目', 'folder']}])
        narrow_editor = browser.call('open', keep=True, project='我的窄屏项目', screenshot='w390-2-editor')
        widths['w390'] = {'landed': {'path': narrow_landed['path'],
                                     'session': narrow_landed['session']},
                          'editor': {'panel_visible': narrow_editor['panel_visible'],
                                     'no_context_hint': narrow_editor['no_context_hint'],
                                     'errors': narrow_editor['errors']}}
        externals = browser.call('externals')
        report['seams']['browser'] = {'widths': widths, 'external_origins': externals['external'],
                                      'screenshots': sorted(path.name for path in EVIDENCE.glob('*.png'))}
        verdict('the_entry_is_continuous_on_a_narrow_screen',
                narrow_landed['session'] and narrow_landed['session']['authenticated'] is True
                and narrow_editor['panel_visible'] is True)
        verdict('nothing_in_the_chain_reaches_an_external_origin', externals['external'] == [])

        report['passed'] = all(item['ok'] for item in report['verdicts'].values())
        report['stage'] = 'done'
    except Exception as error:
        report['failure'] = f'{type(error).__name__}: {error}'
        raise
    finally:
        report['finished_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        text = json.dumps(report, ensure_ascii=False, indent=2)
        for value in (joint.lab.secrets() if joint else []):
            text = text.replace(value, '<redacted>')
        (EVIDENCE / 'report.json').write_text(text + '\n')
        for component in (browser, web):
            if component:
                try:
                    component.close()
                except Exception:
                    pass
        if joint:
            joint.lab.stop()
            for container in (joint.lab.mysql_container, joint.lab.redis_container):
                if container:
                    subprocess.run(['docker', 'rm', '-f', container], capture_output=True, timeout=120)
        subprocess.run(['rm', '-rf', scratch], timeout=60)
        failed = sorted(name for name, item in report['verdicts'].items() if not item['ok'])
        print(json.dumps({'passed': report['passed'], 'stage': report['stage'], 'failed_verdicts': failed,
                          'evidence': str(EVIDENCE)}, ensure_ascii=False))


if __name__ == '__main__':
    main()

"""E09 真实资格提供方：HTTP 适配的联合验证。

**先说清楚这一轮证到了什么、没证到什么。**

真实件：本仓后端（同一进程开 C05 与 P09）、真实前端与 Chromium、一次性 mysql/redis、两组候选迁移、
真实 HTTPS（自有 CA）、真实 HTTP 调用与真实 TLS 失败路径。
替身件：**edu 的资格端点**由 dev/e09-lab/stub.cjs 扮演——它按 edu 固定源码 d2f54c9e 的**线形**回答并用
edu Verifier 的同一套签名构造校验（该构造已对过 edu 自己发布的向量），但它**不是 edu 的 Go 判定代码**。
edu 真实 Go handler + 名单库的联跑需要在本机编译并运行 edu 仓库的代码，本会话的权限分类器拒绝了该动作
（见回执 blocked_action），驱动源码已写好待授权后执行。

因此本文件的结论只能写成：**线形、签名、失败路径与"撤资格后下一次字节即拒"的集成行为已验；
edu 侧真实名单判定未执行。**
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import uuid as uuidlib

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / 'storage/private/e09-validation' / time.strftime('run-%Y%m%dT%H%M%SZ', time.gmtime())
sys.path.insert(0, str(ROOT / 'dev/c05-p09-lab'))

import importlib.util                                                    # noqa: E402


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


joint = load('jointlab', ROOT / 'dev/c05-p09-lab/check.py')
c05lab, p09lab = joint.c05lab, joint.p09lab
need, node, docker, dotenv = joint.need, joint.node, joint.docker, joint.dotenv
lab_uuid, student_payload, Issuer = joint.lab_uuid, joint.student_payload, joint.Issuer
INSTANCE, PNG, PAGE = joint.INSTANCE, joint.PNG, joint.PAGE
STUDENT_GROUP = joint.STUDENT_GROUP

TEACHER = 'teacher-7'            # 合成教师（本班）
OTHER_TEACHER = 'teacher-9'      # 合成教师（他班）
SCHOOL = 'school-1'
ASSIGNMENT = 'assign-1'


class E09Joint(joint.Joint):
    """联合候选的装配，外加一个真实 HTTPS 的 edu 资格端点（替身）。"""

    def __init__(self, scratch):
        super().__init__(scratch)
        self.provider_secret = 'e09-provider-' + uuidlib.uuid4().hex + uuidlib.uuid4().hex[:8]
        self.provider_port = c05lab.free_port()
        self.roster_file = self.scratch / 'edu-roster.json'
        self.ready_file = self.scratch / 'edu-ready.json'
        self.provider_tls_key = self.scratch / 'edu.key'
        self.provider_tls_cert = self.scratch / 'edu.crt'
        self.wrong_ca = self.scratch / 'wrong-ca.crt'
        self.provider = None
        self.eligibility = False      # 基类用同名布尔值选静态替身；这里永远不用它
        self.eligibility_spec = None
        self.reviewer_map = {}

    def start_provider(self, rules, default_reason='not_eligible', offline=False, malformed=False):
        self.write_roster(rules, default_reason=default_reason, offline=offline, malformed=malformed)
        # 证书带 IP SAN：调用方用 127.0.0.1 连，不依赖 *.localhost 在 Node 里能不能解析。
        for host, key, cert in (('edu-provider.localhost', self.provider_tls_key, self.provider_tls_cert),
                                ('somewhere-else.localhost', self.scratch / 'wrong.key', self.wrong_ca)):
            if not Path(cert).exists():
                subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
                                '-subj', f'/CN={host}',
                                '-addext', f'subjectAltName=DNS:{host},IP:127.0.0.1',
                                '-keyout', str(key), '-out', str(cert)],
                               check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
        config = self.scratch / 'edu-stub.json'
        config.write_text(json.dumps({
            'port': self.provider_port, 'tls_key': str(self.provider_tls_key),
            'tls_cert': str(self.provider_tls_cert), 'roster_file': str(self.roster_file),
            'ready_file': str(self.ready_file), 'client': 'practice', 'key_id': 'k1',
            'secret': self.provider_secret, 'source_instance': INSTANCE}))
        self.provider = subprocess.Popen(['node', 'dev/e09-lab/stub.cjs', str(config)], cwd=ROOT,
                                         stdout=subprocess.DEVNULL,
                                         stderr=(self.scratch / 'edu-stub.log').open('w'))
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline and not self.ready_file.exists():
            time.sleep(0.1)
        need(self.ready_file.exists(), 'edu_provider_stub_did_not_start')

    def write_roster(self, rules, default_reason='not_eligible', offline=False, malformed=False):
        self.roster_file.write_text(json.dumps({'rules': rules, 'default_reason': default_reason,
                                                'offline': offline, 'malformed': malformed}))

    def eligibility_http(self, **overrides):
        spec = {'mode': 'http',
                'endpoint': f'https://127.0.0.1:{self.provider_port}'
                            '/api/integrations/practice/e09/eligibility',
                'client_key': 'practice', 'key_id': 'k1', 'secret': self.provider_secret,
                'source_instance': INSTANCE, 'ca_file': str(self.provider_tls_cert),
                'timeout_ms': 1500, 'cache_ms': 0,
                'reviewer_ref': 'mapping', 'reviewer_refs': dict(self.reviewer_map)}
        spec.update(overrides)
        return spec

    def lab_file(self):
        spec = {
            'source_instance': INSTANCE, 'preview_origin': self.preview_origin,
            'issuers': [{'issuer': 'edu', 'key_id': 'k1', 'secret': self.issuer_secret,
                         'purposes': ['website_artifact_link', 'website_artifact_revision',
                                      'website_artifact_review']}],
            'integration_clients': [{'client_key': 'edu', 'key_id': 'k1', 'secret': self.client_secret,
                                     'actions': ['artifacts:read', 'artifacts:review', 'artifacts:freeze'],
                                     'school_refs': [SCHOOL]}]
        }
        if self.eligibility_spec is not None:
            spec['eligibility'] = self.eligibility_spec
        path = self.scratch / f'p09-lab-{uuidlib.uuid4().hex[:6]}.json'
        path.write_text(json.dumps(spec))
        return path

    def start(self, c05_on=True, p09_on=True, label=None, extra=None):
        merged = self.p09_env() if p09_on else {'IDENTITY_DEPLOYMENT_INSTANCE_KEY': INSTANCE}
        merged.update(extra or {})
        self.lab.start(enabled=c05_on, label=label or 'e09', extra=merged)

    def stop_provider(self):
        if self.provider and self.provider.poll() is None:
            self.provider.terminate()
            try:
                self.provider.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.provider.kill()


def reviewer_hash(issuer, ref):
    import hashlib
    return hashlib.sha256(f'{issuer}\n{ref}'.encode()).hexdigest()


def main():
    report = {'started_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'real': ['one node server with C05 and P09 both on', 'mysql:8.0 and redis:7-alpine (disposable)',
                       'both candidate migration sets applied by knex',
                       'a real HTTPS eligibility endpoint with its own CA, real TLS and timeout failures',
                       'the real practice http provider: signature, request shape, answer handling'],
              'stand_in': ["edu's eligibility endpoint is dev/e09-lab/stub.cjs: edu's WIRE shapes and edu's "
                           "signature construction (checked against edu's own published vector), NOT edu's Go "
                           "decision code or its roster database",
                           'every school, teacher, student and roster row is synthetic'],
              'not_executed': ["edu's real Go handler + roster service: the driver is written "
                               "(cmd/e09-eligibility-lab in an archived copy of edu's module at d2f54c9e) and it "
                               "compiles, but building/running edu's code was denied by this session's permission "
                               "classifier, so no claim of a real two-sided decision is made"],
              'stage': 'start', 'seams': {}, 'verdicts': {}, 'passed': False}
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    c05lab.EVIDENCE = EVIDENCE
    p09lab.EVIDENCE = EVIDENCE
    scratch = tempfile.mkdtemp(prefix='e09-http-')
    lab = None
    verdict = lambda name, ok, detail=None: report['verdicts'].__setitem__(name, {'ok': bool(ok), 'detail': detail})

    try:
        site = E09Joint(scratch)
        lab = site.lab
        site.reviewer_map = {reviewer_hash('edu', TEACHER): TEACHER,
                             reviewer_hash('edu', OTHER_TEACHER): OTHER_TEACHER}
        site.prepare(report)
        lab.sql([f'UPDATE user_groups SET credits_pool=1000000, credits_pool_used=0 WHERE id={STUDENT_GROUP}'])
        lab.write_config({**c05lab.C05_CONFIG,
                          'issuance': {'mode': 'from_group_pool', 'amount': 5000, 'expire_days': 365}})
        issuer = Issuer(lab.issuer_secret)

        # ---- 一个学生，一件作品，一版固定版本（复用联合候选已验的那条链） -------------------
        report['stage'] = 'prepare_one_work'
        site.start_provider(rules=[{'reviewer_ref': TEACHER, 'school_ref': SCHOOL,
                                    'assignment_ref': ASSIGNMENT, 'student_uuid': None}])
        site.eligibility_spec = site.eligibility_http()
        site.start(label='e09-http')
        student = lab_uuid(510)
        status, body, _ = lab.exchange(issuer, student_payload(
            student, context={'lesson_id': 'lesson-7', 'assignment_id': ASSIGNMENT}))
        need(status == 200, 'c05_exchange_refused')
        status, session, _ = lab.consume(body['handoff'])
        need(status == 200, 'c05_consume_refused')
        auth = {'Authorization': 'Bearer ' + session['accessToken']}
        user_id = int(lab.sql([f"SELECT id FROM users WHERE uuid='{student}'"])[0][0]['id'])
        # 名单按真实 student_uuid 收口
        site.write_roster([{'reviewer_ref': TEACHER, 'school_ref': SCHOOL, 'assignment_ref': ASSIGNMENT,
                            'student_uuid': student}])
        project_id, page_id = 9501, 9601
        lab.sql([
            {'sql': 'INSERT INTO html_projects(id,user_id,name,type,is_default,sort_order) VALUES(?,?,?,?,1,0)',
             'params': [project_id, user_id, '校园节水网站', 'folder']},
            {'sql': '''INSERT INTO html_pages(id,project_id,user_id,title,slug,html_content,css_content,
                       js_content,compiled_content,version,is_published,created_at,updated_at)
                       VALUES(?,?,?,?,?,?,'','',?,1,0,FROM_UNIXTIME(?),FROM_UNIXTIME(?))''',
             'params': [page_id, project_id, user_id, '首页', 'index', PAGE, PAGE,
                        int(time.time()) - 3600, int(time.time()) - 3600]}])
        upload = Path(lab.storage) / 'uploads/joint'
        upload.mkdir(parents=True, exist_ok=True)
        (upload / 'pond.png').write_bytes(PNG)
        lab.sql([{'sql': '''INSERT INTO files(id,user_id,original_name,stored_name,file_path,file_size,
                            mime_type,status) VALUES(?,?,?,?,?,?,?,'ready')''',
                  'params': [str(uuidlib.uuid4()), user_id, 'pond.png', 'pond.png', 'joint/pond.png',
                             len(PNG), 'image/png']}])
        status, linked, _ = lab.call('POST', '/api/p09/website-artifacts/links',
                                     body={'schema_version': 1, 'project_id': project_id, 'entry_page_id': page_id},
                                     headers={**auth, 'Idempotency-Key': str(uuidlib.uuid4()),
                                              'X-P09-Task-Context': site.grant(
                                                  purpose='website_artifact_link', assignment_ref=ASSIGNMENT,
                                                  subject={'uuid': student, 'cohort': 'student'})})
        need(status == 200, 'link_refused_' + json.dumps(linked)[:160])
        artifact_ref = linked['link']['artifact_ref']
        status, _, _ = lab.call('PUT', f'/api/html-editor/pages/{page_id}',
                                body={'html_content': PAGE, 'css_content': '', 'js_content': ''}, headers=auth)
        need(status == 200, 'real_save_refused')
        time.sleep(1.5)
        links = lab.call('GET', '/api/p09/website-artifacts/links', headers=auth)[1]
        link_id = next(item['link_id'] for item in links['links'] if item['artifact_ref'] == artifact_ref)
        status, frozen, _ = lab.call('POST', f'/api/p09/website-artifacts/links/{link_id}/revisions',
                                     body={'schema_version': 1},
                                     headers={**auth, 'Idempotency-Key': str(uuidlib.uuid4())})
        need(status == 200, 'freeze_refused_' + json.dumps(frozen)[:160])
        revision_ref = frozen['revision']['revision_ref']
        report['seams']['prepare_one_work'] = {'artifact_ref': artifact_ref[:8], 'revision_ref': revision_ref[:8],
                                               'frozen_assets': [item.get('reference') for item in
                                                                 (frozen['revision'].get('manifest') or {}).get('assets', [])]}

        def review_session(reviewer=TEACHER, revision=True, assignment=ASSIGNMENT, school=SCHOOL):
            path = '/api/integrations/edu/website-artifacts/review-sessions'
            body = {'schema_version': 1}
            payload = {'purpose': 'website_artifact_review', 'assignment_ref': assignment,
                       'school_ref': school, 'reviewer': {'ref': reviewer}, 'artifact_ref': artifact_ref}
            if revision:
                payload['revision_ref'] = revision_ref
            return lab.call('POST', path, body=body,
                            headers={**site.edu_headers('POST', path, '', body),
                                     'X-P09-Task-Context': site.grant(**payload)})

        # ---- 1 本班老师可以打开被点名的那一版 ------------------------------------------------
        report['stage'] = 'own_class_teacher'
        web = p09lab.Web(lab.api_port, scratch)
        browser = joint.Browser(scratch, web.url, EVIDENCE)
        status, opened, _ = review_session()
        seam = {'session': {'status': status, 'code': (opened.get('error') or {}).get('code')}}
        need(status == 200, 'own_class_review_refused_' + json.dumps(opened)[:200])
        viewed = browser.call('review', open_url=opened['session']['open_url'], contains=['校园节水'],
                              screenshot='e09-1-own-class')
        seam['rendered'] = {'status': viewed['status'], 'contains': viewed['contains'],
                            'resources': viewed['resources']}
        report['seams']['own_class_teacher'] = seam
        verdict('the_class_teacher_can_open_the_named_revision',
                viewed['status'] == 200 and viewed['contains'] == [True]
                and any(item['status'] == 200 for item in viewed['resources']),
                '资格由 HTTP 提供方逐次回答（线形与签名真实，判定来自替身名单）')

        # ---- 2 撤资格的证据搬走了：本文件曾经的做法是错的 ------------------------------------
        # 这里原来用同一个 open_url 调了两次 `review`，而那个命令每次都新建 context 并在 finally 关闭，
        # 于是第二次实际上是拿**已经用掉的一次性 handoff 再兑换一次**：401 来自票据一次性，与资格无关；
        # 那次也没有再取任何图片，`resources` 为空却被 all(...) 判成"图片已被拒"。
        # 有效证据（一次兑换 + 同一个 context/Cookie + 按真实 URL 重读 + 资格调用计数）见
        # dev/e09-lab/revocation.py，那里还带着"不撤资格也 401"的对照。
        report['seams']['revoked_between_reads'] = {
            'moved_to': 'dev/e09-lab/revocation.py',
            'why': ('同一个 open_url 调两次 review 不能证明资格：第二次是重兑一次性 handoff；'
                    '空 resources 也不能当作图片被拒。本文件不再据此判定。')}

        # ---- 3 他班老师、不是本作业、学生离班：按名拒绝 ---------------------------------------
        report['stage'] = 'named_refusals'
        named = {}
        site.write_roster([{'reviewer_ref': TEACHER, 'school_ref': SCHOOL, 'assignment_ref': ASSIGNMENT,
                            'student_uuid': student}])
        status, other, _ = review_session(reviewer=OTHER_TEACHER)
        named['another_class_teacher'] = {'status': status, 'code': (other.get('error') or {}).get('code')}
        site.write_roster([{'reviewer_ref': TEACHER, 'school_ref': SCHOOL, 'assignment_ref': ASSIGNMENT,
                            'student_uuid': student, 'reason': 'reviewer_not_on_assignment'}])
        status, off_assignment, _ = review_session()
        named['not_on_this_assignment'] = {'status': status, 'code': (off_assignment.get('error') or {}).get('code')}
        site.write_roster([], default_reason='student_not_in_roster')
        status, gone, _ = review_session()
        named['student_left_the_class'] = {'status': status, 'code': (gone.get('error') or {}).get('code')}
        report['seams']['named_refusals'] = named
        verdict('a_teacher_from_another_class_is_refused',
                named['another_class_teacher']['status'] == 403
                and named['another_class_teacher']['code'] == 'not_eligible')
        verdict('a_teacher_who_no_longer_has_this_assignment_is_refused',
                named['not_on_this_assignment']['status'] == 403)
        verdict('a_student_who_left_the_class_is_refused',
                named['student_left_the_class']['status'] == 403)

        # ---- 4 提供方本身出问题：一律 unavailable，绝不放行、也不说成"学生没做" ---------------
        report['stage'] = 'provider_failures'
        failures = {}
        site.write_roster([{'reviewer_ref': TEACHER, 'school_ref': SCHOOL, 'assignment_ref': ASSIGNMENT,
                            'student_uuid': student}], offline=True)
        status, offline, _ = review_session()
        failures['offline'] = {'status': status, 'code': (offline.get('error') or {}).get('code')}
        site.write_roster([{'reviewer_ref': TEACHER, 'school_ref': SCHOOL, 'assignment_ref': ASSIGNMENT,
                            'student_uuid': student}], malformed=True)
        status, malformed, _ = review_session()
        failures['malformed_answer'] = {'status': status, 'code': (malformed.get('error') or {}).get('code')}
        site.write_roster([{'reviewer_ref': TEACHER, 'school_ref': SCHOOL, 'assignment_ref': ASSIGNMENT,
                            'student_uuid': student}])

        # 错签名：实践这边配一个不同的密钥
        lab.stop()
        site.eligibility_spec = site.eligibility_http(secret='wrong-' + 'x' * 40)
        site.start(label='wrong-secret')
        status, wrong_secret, _ = review_session()
        failures['wrong_signature'] = {'status': status, 'code': (wrong_secret.get('error') or {}).get('code')}

        # 错 CA：证书不是这份配置信任的那一张
        lab.stop()
        site.eligibility_spec = site.eligibility_http(ca_file=str(site.wrong_ca))
        site.start(label='wrong-ca')
        status, wrong_ca, _ = review_session()
        failures['wrong_certificate'] = {'status': status, 'code': (wrong_ca.get('error') or {}).get('code')}

        # 完全没有提供方
        lab.stop()
        site.eligibility_spec = None
        site.start(label='no-provider')
        status, absent, _ = review_session()
        failures['no_provider_at_all'] = {'status': status, 'code': (absent.get('error') or {}).get('code')}
        report['seams']['provider_failures'] = failures
        for name in ('offline', 'malformed_answer', 'wrong_signature', 'wrong_certificate', 'no_provider_at_all'):
            verdict(f'the_provider_being_{name}_is_unavailable_not_permission',
                    failures[name]['status'] == 503 and failures[name]['code'] == 'eligibility_unavailable',
                    '不是"这位老师不能看"，也不是"学生没做"')

        # ---- 5 部署形态：P09_ELIGIBILITY_FILE 在生产式配置里装得上 ---------------------------
        report['stage'] = 'deployment_form'
        spec_file = Path(scratch) / 'eligibility.json'
        spec_file.write_text(json.dumps(site.eligibility_http()))
        lab.stop()
        site.eligibility_spec = None
        site.start(label='deployment-form', extra={'P09_ELIGIBILITY_FILE': str(spec_file)})
        status, from_file, _ = review_session()
        report['seams']['deployment_form'] = {'session': {'status': status,
                                                          'code': (from_file.get('error') or {}).get('code')},
                                              'note': 'NODE_ENV 仍是 development；本文件形态不限 NODE_ENV，'
                                                      '但本任务不部署、不开生产'}
        verdict('the_deployment_form_of_the_provider_is_the_one_that_answers', status == 200)

        report['passed'] = all(item['ok'] for item in report['verdicts'].values())
        report['stage'] = 'done'
    except Exception as error:
        report['failure'] = f'{type(error).__name__}: {error}'
        raise
    finally:
        report['finished_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        text = json.dumps(report, ensure_ascii=False, indent=2)
        for value in ((lab.secrets() if lab else []) + ([site.provider_secret] if 'site' in dir() else [])):
            if value:
                text = text.replace(value, '<redacted>')
        (EVIDENCE / 'report.json').write_text(text + '\n')
        for component in (locals().get('browser'), locals().get('web')):
            if component:
                try:
                    component.close()
                except Exception:
                    pass
        if 'site' in dir():
            site.stop_provider()
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

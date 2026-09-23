"""撤资格证据的更正：同一个会话、同一份 Cookie、按真实 URL 重读。

上一版（f9cc1b5 的 dev/e09-lab/check.py:265/267）用同一个 open_url 调了两次 `review`，
而继承来的 worker 每次都新建 context 并在 finally 关闭——所以第二次实际上是**拿已经用掉的
一次性 handoff 再兑换一次**，401 来自票据一次性，与资格判定无关；那次也没有再取任何图片，
`resources` 为空还被判成"图片已被拒"。本文件先用**原程序**做对照复现这一点，再给出有效证据。

真实件：本仓后端（C05+P09 同进程）、真实前端资源链、Chromium、一次性 mysql/redis、
真实 HTTPS 资格端点（自有 CA）与真实 HTTP 调用。
替身件：edu 的资格端点仍是 dev/e09-lab/stub.cjs——线形与签名构造真实，**判定与名单是替身**；
**edu 真实 Go handler 本轮仍未执行**（跨仓构建/运行处于审批 HOLD，不重试、不绕过）。
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
EVIDENCE = ROOT / 'storage/private/e09-validation' / time.strftime('revocation-%Y%m%dT%H%M%SZ', time.gmtime())

import importlib.util                                                     # noqa: E402


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


e09 = load('e09lab', ROOT / 'dev/e09-lab/check.py')
joint, c05lab, p09lab = e09.joint, e09.c05lab, e09.p09lab
need, node = e09.need, e09.node
lab_uuid, student_payload, Issuer = e09.lab_uuid, e09.student_payload, e09.Issuer
INSTANCE, PNG, PAGE, STUDENT_GROUP = e09.INSTANCE, e09.PNG, e09.PAGE, e09.STUDENT_GROUP
TEACHER, SCHOOL, ASSIGNMENT = e09.TEACHER, e09.SCHOOL, e09.ASSIGNMENT


class Reviewer:
    """本包自己的 worker：兑换一次就把 context 留着，之后按真实 URL 重取。"""

    def __init__(self, scratch, evidence):
        env = {**os.environ,
               'PLAYWRIGHT_MODULE': os.environ.get('PLAYWRIGHT_MODULE',
                                                   '/home/hanying/feedback-sync-ws/tools/node_modules/playwright'),
               'TMPDIR': str(scratch)}
        libs = os.environ.get('C05_BROWSER_LIBS',
                              '/home/hanying/feedback-sync-ws/tools/browser-libs/extracted/usr/lib/x86_64-linux-gnu')
        if Path(libs).is_dir():
            env['LD_LIBRARY_PATH'] = libs + (':' + env['LD_LIBRARY_PATH'] if env.get('LD_LIBRARY_PATH') else '')
        self.process = subprocess.Popen(['node', 'dev/e09-lab/browser.cjs'], cwd=ROOT, env=env,
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=(Path(scratch) / 'reviewer.log').open('w'), text=True)
        self.call('start', evidence=str(evidence))

    def call(self, command, timeout=120, **fields):
        import select
        self.process.stdin.write(json.dumps(dict(command=command, **fields)) + '\n')
        self.process.stdin.flush()
        need(select.select([self.process.stdout], [], [], timeout)[0], 'reviewer_timeout_' + command)
        answer = json.loads(self.process.stdout.readline() or '{}')
        need(answer.get('ok'), f'reviewer_{command}_failed_{answer.get("code")}')
        return answer

    def close(self):
        try:
            self.call('stop', timeout=30)
        except Exception:
            self.process.kill()


def main():
    report = {'started_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'corrects': 'f9cc1b5 dev/e09-lab/check.py:265,267 (revoked_between_reads)',
              'real': ['one node server with C05 and P09 on', 'real frontend asset chain', 'Chromium',
                       'disposable mysql/redis', 'a real HTTPS eligibility endpoint with its own CA'],
              'stand_in': ["edu's endpoint is dev/e09-lab/stub.cjs: edu's wire shapes and signature "
                           "construction, NOT edu's decision code or roster"],
              'not_executed': ["edu's real Go handler: cross-repository build/run is on approval HOLD; "
                               "not retried and not routed around"],
              'stage': 'start', 'checks': {}, 'verdicts': {}, 'passed': False}
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    c05lab.EVIDENCE = EVIDENCE
    p09lab.EVIDENCE = EVIDENCE
    scratch = tempfile.mkdtemp(prefix='e09-revocation-')
    lab = site = reviewer = old_browser = web = None
    verdict = lambda name, ok, detail=None: report['verdicts'].__setitem__(name, {'ok': bool(ok), 'detail': detail})

    try:
        site = e09.E09Joint(scratch)
        lab = site.lab
        site.reviewer_map = {e09.reviewer_hash('edu', TEACHER): TEACHER}
        call_log = Path(scratch) / 'edu-calls.jsonl'
        site.prepare(report)
        lab.sql([f'UPDATE user_groups SET credits_pool=1000000, credits_pool_used=0 WHERE id={STUDENT_GROUP}'])
        lab.write_config({**c05lab.C05_CONFIG,
                          'issuance': {'mode': 'from_group_pool', 'amount': 5000, 'expire_days': 365}})
        issuer = Issuer(lab.issuer_secret)
        site.start_provider(rules=[])
        # 让替身把每次通过凭据校验的询问记一行
        config = Path(scratch) / 'edu-stub.json'
        spec = json.loads(config.read_text())
        spec['call_log'] = str(call_log)
        config.write_text(json.dumps(spec))
        site.stop_provider()
        site.provider = subprocess.Popen(['node', 'dev/e09-lab/stub.cjs', str(config)], cwd=ROOT,
                                         stdout=subprocess.DEVNULL,
                                         stderr=(Path(scratch) / 'edu-stub.log').open('w'))
        time.sleep(1.5)
        site.eligibility_spec = site.eligibility_http()
        site.start(label='revocation')

        # ---- 一个学生、一件作品、一版固定版本 --------------------------------------------------
        report['stage'] = 'prepare'
        student = lab_uuid(610)
        status, body, _ = lab.exchange(issuer, student_payload(
            student, context={'lesson_id': 'lesson-7', 'assignment_id': ASSIGNMENT}))
        need(status == 200, 'exchange_refused')
        status, session, _ = lab.consume(body['handoff'])
        need(status == 200, 'consume_refused')
        auth = {'Authorization': 'Bearer ' + session['accessToken']}
        user_id = int(lab.sql([f"SELECT id FROM users WHERE uuid='{student}'"])[0][0]['id'])
        site.write_roster([{'reviewer_ref': TEACHER, 'school_ref': SCHOOL, 'assignment_ref': ASSIGNMENT,
                            'student_uuid': student}])
        project_id, page_id = 9701, 9801
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
        need(status == 200, 'link_refused')
        artifact_ref = linked['link']['artifact_ref']
        need(lab.call('PUT', f'/api/html-editor/pages/{page_id}',
                      body={'html_content': PAGE, 'css_content': '', 'js_content': ''}, headers=auth)[0] == 200,
             'save_refused')
        time.sleep(1.5)
        links = lab.call('GET', '/api/p09/website-artifacts/links', headers=auth)[1]
        link_id = next(item['link_id'] for item in links['links'] if item['artifact_ref'] == artifact_ref)
        status, frozen, _ = lab.call('POST', f'/api/p09/website-artifacts/links/{link_id}/revisions',
                                     body={'schema_version': 1},
                                     headers={**auth, 'Idempotency-Key': str(uuidlib.uuid4())})
        need(status == 200, 'freeze_refused')
        revision_ref = frozen['revision']['revision_ref']

        def review_session():
            path = '/api/integrations/edu/website-artifacts/review-sessions'
            body = {'schema_version': 1}
            return lab.call('POST', path, body=body,
                            headers={**site.edu_headers('POST', path, '', body),
                                     'X-P09-Task-Context': site.grant(
                                         purpose='website_artifact_review', assignment_ref=ASSIGNMENT,
                                         school_ref=SCHOOL, reviewer={'ref': TEACHER},
                                         artifact_ref=artifact_ref, revision_ref=revision_ref)})

        calls = lambda: len(call_log.read_text().splitlines()) if call_log.exists() else 0

        # ---- 1 对照：原程序的那种读法，**不撤资格**也是 401 -----------------------------------
        report['stage'] = 'control_with_the_old_shape'
        web = p09lab.Web(lab.api_port, scratch)
        old_browser = joint.Browser(scratch, web.url, EVIDENCE)
        status, opened, _ = review_session()
        need(status == 200, 'control_session_refused')
        open_url = opened['session']['open_url']
        before_calls = calls()
        first = old_browser.call('review', open_url=open_url, contains=['校园节水'],
                                 screenshot='control-1-first-read')
        # 名单一个字都不改——资格仍然通过
        second = old_browser.call('review', open_url=open_url, contains=['校园节水'],
                                  screenshot='control-2-second-read')
        report['checks']['control_with_the_old_shape'] = {
            'roster_changed': False,
            'first': {'status': first['status'], 'contains': first['contains'],
                      'resources': first['resources']},
            'second': {'status': second['status'], 'contains': second['contains'],
                       'resources': second['resources']},
            'eligibility_calls_delta': calls() - before_calls,
            'why': ('继承的 review 每次新建 context，第二次是拿已经用掉的一次性 handoff 再兑换；'
                    '401 来自票据一次性，与资格无关。resources 为空也不能当作"图片被拒"。')}
        verdict('the_old_shape_gives_401_even_without_revoking',
                first['status'] == 200 and second['status'] == 401,
                '原 12/12 报告里的 revoked_between_reads 因此不成立，本次出具更正')
        verdict('the_old_shape_never_refetched_an_image',
                second['resources'] == [],
                'all(空列表) 恒真，当时的"图片没被放出"没有证据')
        old_browser.close()
        old_browser = None

        # ---- 2 有效证据：一次兑换，同一个 context/Cookie，按真实 URL 重读 --------------------
        report['stage'] = 'same_session_refetch'
        status, opened, _ = review_session()
        need(status == 200, 'evidence_session_refused')
        reviewer = Reviewer(scratch, EVIDENCE)
        held = reviewer.call('open_review', open_url=opened['session']['open_url'],
                             contains=['校园节水'], screenshot='evidence-1-opened')
        need(held['status'] == 200 and held['contains'] == [True], 'fixed_page_did_not_render')
        need(held['assets'], 'no_image_was_loaded_so_there_is_nothing_to_re_read')
        page_url = held['settled_url']
        image_url = held['assets'][0]['url']

        # 2a 什么都不改，同一份 Cookie 重读：都应当是 200，并且资格端点确实又被问过
        before_calls = calls()
        unchanged = reviewer.call('refetch', urls=[page_url, image_url], contains=['校园节水'])
        unchanged_calls = calls() - before_calls
        report['checks']['unchanged_refetch'] = {
            'page': unchanged['results'][0], 'image': unchanged['results'][1],
            'eligibility_calls_delta': unchanged_calls, 'cookies': held['cookies'],
            'settled_url': held['settled_url_redacted'],
            'image_file': held['assets'][0]['file']}
        verdict('the_same_cookie_can_re_read_the_fixed_page_and_its_image',
                unchanged['results'][0]['status'] == 200 and unchanged['results'][1]['status'] == 200
                and unchanged['results'][0]['contains'] == [True],
                '不重兑 handoff，走的是真实 URL')
        verdict('every_re_read_really_asks_the_provider_again', unchanged_calls >= 2,
                'cache_ms=0：一页一图各问一次')

        # 2b 只改替身名单（会话既未过期也未撤销），立刻重读同样两个 URL
        site.write_roster([])
        before_calls = calls()
        revoked = reviewer.call('refetch', urls=[page_url, image_url], contains=['校园节水'], keep_body=True)
        revoked_calls = calls() - before_calls
        session_row = lab.sql([f"SELECT expires_at, consumed_at FROM p09_review_sessions "
                               f"ORDER BY issued_at DESC LIMIT 1"])[0]
        report['checks']['after_revoking_only_the_roster'] = {
            'page': revoked['results'][0], 'image': revoked['results'][1],
            'eligibility_calls_delta': revoked_calls,
            'session_row': session_row[0] if session_row else None,
            'cache_ms': 0}
        verdict('the_fixed_page_is_refused_at_the_next_read',
                revoked['results'][0]['status'] >= 400,
                '同一个会话、同一份 Cookie、真实 URL，不是重兑票据')
        verdict('the_image_that_was_200_is_refused_too',
                revoked['results'][1]['status'] >= 400,
                '这次是真的又取了一次图片，而不是"没取所以算拒"')
        verdict('the_refusal_came_from_asking_the_provider_again', revoked_calls >= 1)
        verdict('a_refusal_never_reads_as_the_student_not_having_done_it',
                not any(word in (revoked['results'][0].get('body_head') or '')
                        for word in ('未做', '未开始', '没有作品')),
                'UI 文案不得把"问不到/不能看"写成"学生没做"')

        # 2c 未知提供方 / 错签名 与 not_eligible 必须分得开
        report['stage'] = 'unavailable_is_not_not_eligible'
        site.write_roster([{'reviewer_ref': TEACHER, 'school_ref': SCHOOL, 'assignment_ref': ASSIGNMENT,
                            'student_uuid': student}], offline=True)
        offline = reviewer.call('refetch', urls=[page_url], contains=['校园节水'], keep_body=True)
        site.write_roster([{'reviewer_ref': TEACHER, 'school_ref': SCHOOL, 'assignment_ref': ASSIGNMENT,
                            'student_uuid': student}])
        restored = reviewer.call('refetch', urls=[page_url, image_url], contains=['校园节水'])
        report['checks']['unavailable_is_not_not_eligible'] = {
            'provider_offline': offline['results'][0],
            'after_restore': {'page': restored['results'][0], 'image': restored['results'][1]}}
        verdict('an_unavailable_provider_reads_differently_from_a_refusal',
                offline['results'][0]['status'] != revoked['results'][0]['status'],
                '503 eligibility_unavailable 与 403 not_eligible 是两件事')
        verdict('putting_the_teacher_back_lets_the_same_session_read_again',
                restored['results'][0]['status'] == 200 and restored['results'][1]['status'] == 200,
                '证明前面的拒绝确实是资格判定，而不是会话坏了')
        reviewer.call('close_review')

        report['passed'] = all(item['ok'] for item in report['verdicts'].values())
        report['stage'] = 'done'
    except Exception as error:
        report['failure'] = f'{type(error).__name__}: {error}'
        raise
    finally:
        report['finished_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        text = json.dumps(report, ensure_ascii=False, indent=2)
        for value in ((lab.secrets() if lab else []) + ([site.provider_secret] if site else [])):
            if value:
                text = text.replace(value, '<redacted>')
        (EVIDENCE / 'report.json').write_text(text + '\n')
        for component in (reviewer, old_browser, web):
            if component:
                try:
                    component.close()
                except Exception:
                    pass
        if site:
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

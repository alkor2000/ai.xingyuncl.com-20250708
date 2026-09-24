"""带着新作业 B 的入口，打开的却是关联着旧作业 A 的项目：真实浏览器，桌面与 390 各一次。

真实件：本候选树的 node 后端（C05 与 P09 同开）、真实 Vite 前端、真实 Chromium、一次性 mysql:8.0 与 redis、
两组候选迁移、实践自己的真实 C05 消费路径、后端对签名任务上下文的真实校验（关联与本次只读确认同一把尺子）。
替身件：发链接的 edu 由本实验的合成签发夹具扮演（handoff 由真实 exchange 换出，任务上下文按 taskGrant 线形签出），
交作业的对端由 dev/e09-lab/stub.cjs 扮演——**线形与签名真实，但不是 edu 的判定代码**；学校、作业、师生 uuid 全为合成。
未执行：edu 的 Go（跨仓审核 HOLD）、生产、任何演示资源。

结论口径：**实践这一侧"不会把这次作业误交到上一次"已验；真实两端的新交点由原 edu 后继补验。**
"""
import json
from pathlib import Path
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / 'storage/private/e09-active-assignment' / time.strftime('run-%Y%m%dT%H%M%SZ', time.gmtime())

import importlib.util                                                    # noqa: E402


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


e09 = load('e09lab', ROOT / 'dev/e09-lab/check.py')
submitlab = load('e09submitlab', ROOT / 'dev/e09-submit-lab/check.py')
joint, c05lab, p09lab = e09.joint, e09.c05lab, e09.p09lab
need, lab_uuid, student_payload, Issuer = joint.need, joint.lab_uuid, joint.student_payload, joint.Issuer
INSTANCE, PAGE, STUDENT_GROUP = joint.INSTANCE, joint.PAGE, joint.STUDENT_GROUP
SCHOOL = e09.SCHOOL
DESKTOP, NARROW = {'width': 1280, 'height': 900}, {'width': 390, 'height': 844}
OLD_WORK, NEW_WORK = '上一次的作品', '这一次的新作品'
ASSIGN_A, ASSIGN_B = 'assign-old-1', 'assign-new-2'


def main():
    report = {'started_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'real': ['本候选树的后端与真实 Vite 前端', '真实 Chromium：1280 与 390 各一次',
                       '一次性 mysql:8.0 + redis、两组候选迁移',
                       '实践自己的真实 C05 消费路径与后端对签名任务上下文的真实校验'],
              'synthetic': ['发链接的 edu 与交作业对端都由本实验的合成夹具/替身扮演（线形与签名真实，不是 edu 的判定代码）',
                            '学校、作业、师生 uuid 全为合成'],
              'not_executed': ['edu 的 Go（跨仓审核 HOLD）', '生产', '任何演示资源'],
              'stage': 'start', 'checks': {}, 'verdicts': {}, 'passed': False}
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    c05lab.EVIDENCE = p09lab.EVIDENCE = EVIDENCE
    scratch = tempfile.mkdtemp(prefix='e09-active-assignment-')
    site = lab = web = browser = None
    verdict = lambda name, ok, detail=None: report['verdicts'].__setitem__(name, {'ok': bool(ok), 'detail': detail})

    try:
        site = submitlab.SubmitLab(scratch)          # 交作业替身同一套：这一包要数的正是"有没有误发出去"
        lab = site.lab
        site.reviewer_map = {}
        site.prepare(report)
        lab.sql([f'UPDATE user_groups SET credits_pool=1000000, credits_pool_used=0 WHERE id={STUDENT_GROUP}'])
        lab.write_config({**c05lab.C05_CONFIG,
                          'issuance': {'mode': 'from_group_pool', 'amount': 5000, 'expire_days': 365}})
        site.start_provider(rules=[{'reviewer_ref': e09.TEACHER, 'school_ref': SCHOOL,
                                    'assignment_ref': ASSIGN_A, 'student_uuid': None}])
        eligibility = site.eligibility_http(reviewer_ref='audience_hash')
        eligibility.pop('reviewer_refs', None)
        site.eligibility_spec = eligibility
        site.plan(mode='ok', revision_no=1)
        site.start(label='e09-active-assignment')
        issuer = Issuer(lab.issuer_secret)
        student = lab_uuid(920)

        report['stage'] = 'student_has_two_works'
        status, body, _ = lab.exchange(issuer, student_payload(
            student, landing={'entry': 'html'}, context={'lesson_id': 'lesson-7', 'assignment_id': ASSIGN_A}))
        need(status == 200, 'c05_exchange_refused')
        status, _, _ = lab.consume(body['handoff'])
        need(status == 200, 'c05_consume_refused')
        user_id = int(lab.sql([f"SELECT id FROM users WHERE uuid='{student}'"])[0][0]['id'])
        statements = []
        for index, (project_id, page_id, name) in enumerate(((9801, 9901, OLD_WORK), (9802, 9902, NEW_WORK))):
            statements += [
                {'sql': 'INSERT INTO html_projects(id,user_id,name,type,is_default,sort_order) VALUES(?,?,?,?,?,?)',
                 'params': [project_id, user_id, name, 'folder', 1 if index == 0 else 0, index]},
                {'sql': '''INSERT INTO html_pages(id,project_id,user_id,title,slug,html_content,css_content,
                           js_content,compiled_content,version,is_published,created_at,updated_at)
                           VALUES(?,?,?,?,?,?,'','',?,1,0,FROM_UNIXTIME(?),FROM_UNIXTIME(?))''',
                 'params': [page_id, project_id, user_id, '首页', f'index{index}', PAGE, PAGE,
                            int(time.time()) - 3600, int(time.time()) - 3600]}]
        lab.sql(statements)

        web = p09lab.Web(lab.api_port, scratch)
        import urllib.request as _request
        warm = time.monotonic() + 240
        while time.monotonic() < warm:
            try:
                with _request.urlopen(f'{web.url}/login', timeout=30) as response:
                    if response.status == 200 and response.read(64):
                        break
            except Exception:
                time.sleep(3)
        browser = p09lab.Browser(scratch, web.url, EVIDENCE)

        def arrive(assignment, viewport, project, screenshot=None):
            """edu 那一侧发的那条链接：一次性 handoff + 这一次作业的签名上下文。"""
            status, issued, _ = lab.exchange(issuer, student_payload(
                student, landing={'entry': 'html'},
                context={'lesson_id': 'lesson-7', 'assignment_id': assignment}))
            need(status == 200, 'c05_exchange_refused')
            grant = site.grant(purpose='website_artifact_link', assignment_ref=assignment,
                               subject={'uuid': student, 'cohort': 'student'})
            return browser.call('enterFromLogin', viewport=viewport, handoff=issued['handoff'],
                                task_context=grant, project=project, screenshot=screenshot, timeout=420)

        # ---- 先把"上一次的作业"真的关联到旧项目上 -------------------------------------------------
        report['stage'] = 'old_assignment_linked'
        arrive(ASSIGN_A, DESKTOP, OLD_WORK, screenshot='active-1-old-arrival')
        linked = browser.call('link', entry_label='首页', screenshot='active-2-old-linked')
        need(not linked.get('error'), 'old_link_failed')
        rows = lab.sql([f"SELECT assignment_ref, project_id FROM p09_links WHERE owner_user_id={user_id}"])[0]
        report['checks']['fixture'] = {'links': rows}
        verdict('the_fixture_really_has_an_old_assignment_on_the_old_project',
                len(rows) == 1 and rows[0]['assignment_ref'] == ASSIGN_A and int(rows[0]['project_id']) == 9801,
                f'旧项目 9801 关联的是 {ASSIGN_A}，下面带进来的是另一份 {ASSIGN_B}，两者确实不同')

        # ---- 带新作业 B 进来，打开的却是旧项目：两种宽度各证一次 -----------------------------------
        for label, viewport in (('desktop', DESKTOP), ('narrow', NARROW)):
            report['stage'] = f'{label}_new_arrival_on_old_project'
            arrive(ASSIGN_B, viewport, OLD_WORK, screenshot=f'active-3-{label}-new-on-old')
            view = browser.call('assignmentView', screenshot=f'active-4-{label}-notice')
            before_calls = site.edu_calls()
            pressed = browser.call('submit', screenshot=f'active-5-{label}-pressed', wait=2500)
            check = {'panel_assignment': view['fields'].get('作业'), 'notice': (view['notice'] or '')[:120],
                     'submit_present': view['submit_present'], 'submit_disabled': view['submit_disabled'],
                     'pressed': {k: pressed.get(k) for k in ('present', 'disabled', 'submitted', 'refusal',
                                                             'unknown', 'submit_requests')},
                     'edu_calls': site.edu_calls() - before_calls}
            report['checks'][f'{label}_new_arrival_on_old_project'] = check
            verdict(f'{label}_the_student_is_told_this_project_is_another_assignment',
                    bool(view['notice']) and ASSIGN_A in (view['notice'] or '') + str(view['fields'])
                    and view['submit_disabled'] is True,
                    '面板明说这个项目关联的是另一次作业，普通「交作业」按不动')
            verdict(f'{label}_no_submission_is_sent_to_the_old_assignment',
                    pressed['disabled'] is True and pressed['submit_requests'] == 0
                    and check['edu_calls'] == 0 and not pressed['submitted'],
                    '误交那一下：按钮按不动，真去按也是浏览器 0 条 /submissions、替身 0 次被叫，成功框不出现')

        # ---- 同一份作业照旧能交 ---------------------------------------------------------------------
        report['stage'] = 'same_assignment_still_works'
        arrive(ASSIGN_A, DESKTOP, OLD_WORK, screenshot='active-6-same-arrival')
        browser.call('save', page_title='首页')          # 交之前先有一次真实保存
        time.sleep(2)
        arrive(ASSIGN_A, DESKTOP, OLD_WORK)
        same = browser.call('assignmentView')
        before_calls = site.edu_calls()
        pressed = browser.call('submit', screenshot='active-7-same-submitted', wait=2500)
        report['checks']['same_assignment'] = {'notice': same['notice'], 'submit_disabled': same['submit_disabled'],
                                               'submitted': (pressed.get('submitted') or '')[:40],
                                               'submit_requests': pressed.get('submit_requests'),
                                               'edu_calls': site.edu_calls() - before_calls}
        verdict('the_same_assignment_keeps_the_ordinary_button',
                same['notice'] is None and same['submit_disabled'] is False
                and bool(pressed['submitted']) and pressed['submit_requests'] == 1
                and (site.edu_calls() - before_calls) == 1,
                '同一份作业：没有提示，按钮照常，一次按压一次转达')

        # ---- 新作业选一个没关联过的项目，学生自己关联 ----------------------------------------------
        report['stage'] = 'new_assignment_on_free_project'
        arrive(ASSIGN_B, DESKTOP, NEW_WORK, screenshot='active-8-new-on-free')
        free = browser.call('assignmentView')
        linked_new = browser.call('link', entry_label='首页', screenshot='active-9-new-linked')
        rows = lab.sql([f"SELECT assignment_ref, project_id FROM p09_links WHERE owner_user_id={user_id} AND state='active'"])[0]
        report['checks']['new_assignment_on_free_project'] = {
            'notice': free['notice'], 'link_button': free['link_button'],
            'state': linked_new.get('state'), 'error': linked_new.get('error'),
            'links': rows}
        verdict('the_new_assignment_can_be_linked_to_a_project_of_its_own',
                free['notice'] is None and free['link_button'] is True and not linked_new.get('error')
                and any(r['assignment_ref'] == ASSIGN_B and int(r['project_id']) == 9802 for r in rows)
                and any(r['assignment_ref'] == ASSIGN_A and int(r['project_id']) == 9801 for r in rows),
                '这次作业落到自己的项目上，旧作业那条关联原样还在')

        report['passed'] = all(item['ok'] for item in report['verdicts'].values())
        report['stage'] = 'done'
    except Exception as error:
        report['failure'] = f'{type(error).__name__}: {error}'
        raise
    finally:
        report['finished_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        text = json.dumps(report, ensure_ascii=False, indent=2, default=str)
        for value in ((lab.secrets() if lab else []) + ([site.provider_secret] if site else [])):
            if value:
                text = text.replace(value, '<redacted>')
        (EVIDENCE / 'report.json').write_text(text + '\n')
        if browser:
            try: browser.close()
            except Exception: pass
        if web:
            web.close()
        if site:
            if getattr(site, 'provider', None):
                site.provider.terminate()
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

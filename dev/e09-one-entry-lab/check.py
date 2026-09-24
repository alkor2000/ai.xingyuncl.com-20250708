"""一次学校登录，直接落在带本次作业上下文的网页编辑器：真实浏览器，桌面与 390 各一次。

真实件：本候选树的 node 后端（C05 与 P09 同开）、真实 Vite 前端、真实 Chromium、一次性 mysql:8.0 与
redis、两组候选迁移、**实践自己的真实 C05 消费路径**（浏览器直接访问 /auth/sso/consume）、
后端对签名任务上下文的真实校验（关联那一次真的过了签名、学校、学生、作业与时效）。
替身件：发链接的 edu 由本实验的合成签发夹具扮演——一次性 handoff 由真实 /api/auth/sso/exchange 换出，
任务上下文由同一套实验室签发密钥按 taskGrant 线形签出；学校、作业、师生 uuid 全为合成。
未执行：edu 的 Go（跨仓审核 HOLD 未解除）、生产、任何 18191/18192/18194 的资源。

因此结论只能写成：**实践这一侧"一次进入"的接收半边已验；edu 的发送半边与真实两端闭环未验。**
"""
import json
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / 'storage/private/e09-one-entry' / time.strftime('run-%Y%m%dT%H%M%SZ', time.gmtime())

import importlib.util                                                    # noqa: E402


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


e09 = load('e09lab', ROOT / 'dev/e09-lab/check.py')
joint, c05lab, p09lab = e09.joint, e09.c05lab, e09.p09lab
need, lab_uuid, student_payload, Issuer = joint.need, joint.lab_uuid, joint.student_payload, joint.Issuer
INSTANCE, PAGE, STUDENT_GROUP = joint.INSTANCE, joint.PAGE, joint.STUDENT_GROUP
SCHOOL, ASSIGNMENT = e09.SCHOOL, e09.ASSIGNMENT
DESKTOP, NARROW = {'width': 1280, 'height': 900}, {'width': 390, 'height': 844}
PROJECT = '校园节水网站'


def main():
    report = {'started_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'real': ['本候选树的后端与真实 Vite 前端', '真实 Chromium：1280 与 390 各一次',
                       '一次性 mysql:8.0 + redis、两组候选迁移',
                       '实践自己的真实 C05 消费路径（浏览器访问 /auth/sso/consume）',
                       '后端对签名任务上下文的真实校验（关联那一次真的验了签名与归属）'],
              'synthetic': ['发链接的 edu 由本实验的合成签发夹具扮演：handoff 由真实 exchange 换出，'
                            '任务上下文用同一套实验室密钥按 taskGrant 线形签出（p09g.<base64url 载荷>.<base64url 签名>）',
                            '学校、作业、师生 uuid 全为合成'],
              'not_executed': ['edu 的 Go（跨仓审核 HOLD）', '生产', 'edu 正在跑的演示资源 18191/18192/18194'],
              'stage': 'start', 'checks': {}, 'verdicts': {}, 'passed': False}
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    c05lab.EVIDENCE = p09lab.EVIDENCE = EVIDENCE
    import tempfile
    scratch = tempfile.mkdtemp(prefix='e09-one-entry-')
    site = lab = web = browser = None
    verdict = lambda name, ok, detail=None: report['verdicts'].__setitem__(name, {'ok': bool(ok), 'detail': detail})

    try:
        site = e09.E09Joint(scratch)
        lab = site.lab
        site.eligibility_spec = None        # 本实验不碰教师审阅：一次进入只关心学生这一段
        site.prepare(report)
        lab.sql([f'UPDATE user_groups SET credits_pool=1000000, credits_pool_used=0 WHERE id={STUDENT_GROUP}'])
        lab.write_config({**c05lab.C05_CONFIG,
                          'issuance': {'mode': 'from_group_pool', 'amount': 5000, 'expire_days': 365}})
        site.start()
        issuer = Issuer(lab.issuer_secret)
        student = lab_uuid(910)

        # 学生此前已经用过本平台，有一个自己的项目——这一步只是把人和作品准备好，
        # 浏览器那一侧待会儿仍然从"没有任何会话"开始。
        report['stage'] = 'student_has_a_work'
        status, body, _ = lab.exchange(issuer, student_payload(
            student, landing={'entry': 'html'}, context={'lesson_id': 'lesson-7', 'assignment_id': ASSIGNMENT}))
        need(status == 200, 'c05_exchange_refused')
        status, session, _ = lab.consume(body['handoff'])
        need(status == 200, 'c05_consume_refused')
        user_id = int(lab.sql([f"SELECT id FROM users WHERE uuid='{student}'"])[0][0]['id'])
        project_id, page_id = 9601, 9701
        lab.sql([
            {'sql': 'INSERT INTO html_projects(id,user_id,name,type,is_default,sort_order) VALUES(?,?,?,?,1,0)',
             'params': [project_id, user_id, PROJECT, 'folder']},
            {'sql': '''INSERT INTO html_pages(id,project_id,user_id,title,slug,html_content,css_content,
                       js_content,compiled_content,version,is_published,created_at,updated_at)
                       VALUES(?,?,?,?,?,?,'','',?,1,0,FROM_UNIXTIME(?),FROM_UNIXTIME(?))''',
             'params': [page_id, project_id, user_id, '首页', 'index', PAGE, PAGE,
                        int(time.time()) - 3600, int(time.time()) - 3600]}])

        web = p09lab.Web(lab.api_port, scratch)
        import urllib.request as _request
        warm = time.monotonic() + 240
        while time.monotonic() < warm:                      # 先把 Vite 热一遍：实验室等待，不是产品超时
            try:
                with _request.urlopen(f'{web.url}/login', timeout=30) as response:
                    if response.status == 200 and response.read(64):
                        break
            except Exception:
                time.sleep(3)
        browser = p09lab.Browser(scratch, web.url, EVIDENCE)

        def fresh_link(with_context=True, fragment=None):
            """edu 那一侧要组合的东西：一次性 handoff + 自己签的任务上下文（放在片段里）。"""
            status, issued, _ = lab.exchange(issuer, student_payload(
                student, landing={'entry': 'html'},
                context={'lesson_id': 'lesson-7', 'assignment_id': ASSIGNMENT}))
            need(status == 200, 'c05_exchange_refused')
            grant = site.grant(purpose='website_artifact_link', assignment_ref=ASSIGNMENT,
                               subject={'uuid': student, 'cohort': 'student'}) if with_context else None
            return issued['handoff'], (fragment if fragment is not None else grant)

        # ---- 一次进入：桌面与 390 各一次 -----------------------------------------------------------
        for label, viewport in (('desktop', DESKTOP), ('narrow', NARROW)):
            report['stage'] = f'{label}_one_entry'
            handoff, context = fresh_link()
            entered = browser.call('enterFromLogin', viewport=viewport, handoff=handoff, task_context=context,
                                   project=PROJECT, screenshot=f'one-entry-{label}-1-landed', timeout=420)
            report['checks'][f'{label}_one_entry'] = {k: entered.get(k) for k in (
                'landed_path', 'panel_visible', 'link_button', 'no_context_hint', 'url_has_context',
                'url_has_handoff', 'storage_hits', 'cookie_leak', 'residual_hash', 'residual_search',
                'console_leak', 'link_posts', 'submit_posts', 'context_in_request_url')}
            verdict(f'{label}_one_click_lands_in_the_editor_with_the_assignment',
                    entered['landed_path'] == '/html-editor' and entered['panel_visible']
                    and entered['link_button'] == 1 and entered['no_context_hint'] == 0,
                    '一次学校登录后直接在编辑器里看到"关联到本次教学任务"，不必回 edu 补第二次')
            verdict(f'{label}_nothing_happens_without_the_student_asking',
                    entered['link_posts'] == 0 and entered['submit_posts'] == 0,
                    '进来这一下没有替学生关联，也没有替他提交')
            verdict(f'{label}_the_credential_is_not_left_anywhere',
                    not entered['url_has_context'] and not entered['url_has_handoff']
                    and entered['storage_hits'] == [] and not entered['cookie_leak']
                    and entered['residual_hash'] == '' and entered['console_leak'] == 0
                    and entered['context_in_request_url'] == 0,
                    '地址栏、localStorage/sessionStorage、cookie、控制台与请求 URL 里都没有上下文或票据')


        # ---- 负例：片段是坏的，登录照常，但什么都不带进来 -------------------------------------------
        report['stage'] = 'broken_fragment'
        handoff, _ = fresh_link(with_context=False)
        broken = browser.call('enterFromLogin', viewport=DESKTOP, handoff=handoff,
                              task_context='https://elsewhere.example/steal', project=PROJECT,
                              screenshot='one-entry-broken-fragment', timeout=420)
        report['checks']['broken_fragment'] = {k: broken.get(k) for k in (
            'landed_path', 'panel_visible', 'link_button', 'no_context_hint', 'link_posts')}
        verdict('a_foreign_fragment_logs_in_but_carries_nothing',
                broken['landed_path'] == '/html-editor' and broken['panel_visible']
                and broken['no_context_hint'] == 1 and broken['link_button'] == 0
                and broken['link_posts'] == 0,
                '登录照旧成功，但面板明说没有作业上下文，没有任何东西被偷偷带进来')

        # ---- 学生自己点一次关联：后端在这里真的校验那份签名上下文，过了才会有账本行 -------------------
        # 放在最后做，因为关联之后这个项目就不是"还能关联"的状态了，前面几格要的正是那个状态。
        report['stage'] = 'explicit_link'
        handoff, context = fresh_link()
        browser.call('enterFromLogin', viewport=DESKTOP, handoff=handoff, task_context=context,
                     project=PROJECT, screenshot='one-entry-desktop-2-relanded', timeout=420)
        linked = browser.call('link', entry_label='首页', screenshot='one-entry-desktop-3-linked')
        report['checks']['explicit_link'] = {'state': linked.get('state'), 'error': linked.get('error')}
        verdict('the_relayed_context_is_accepted_by_the_server_on_an_explicit_click',
                not linked.get('error') and '已关联' in (linked.get('state') or ''),
                '带过来的上下文是真的：学生点一次，后端验签通过并建立了关联')

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

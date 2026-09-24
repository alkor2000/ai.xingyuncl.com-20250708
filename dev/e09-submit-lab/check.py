"""学生在编辑器里按「交作业」：真实浏览器、桌面与 390 各一次。

真实件：本候选树的 node 后端（C05 与 P09 同开）、真实 Vite 前端、真实 Chromium、一次性 mysql:8.0 与 redis、
两组候选迁移、真实 HTTPS 与真实服务凭据签名、真实的按钮点击与页面文字。
替身件：**edu 的提交端点由 dev/e09-lab/stub.cjs 扮演**——线形与签名构造按 edu 固定导出 134d1d8
（SUBMIT-WHERE-THEY-WORK.md §3、homework_website_inbound.go）实现，**它不是 edu 的判定代码**；
学校、作业、师生 uuid 全是合成的。
未执行：edu 的 Go（跨仓审核 HOLD 未解除）、生产、任何 18191/18192/18194 的资源。

因此本文件的结论只能写成：**实践这一侧的按钮、转达、显示与拒绝路径已验；真实两端提交未验。**
"""
import json
from pathlib import Path
import subprocess
import tempfile
import time
import uuid as uuidlib

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / 'storage/private/e09-submit' / time.strftime('run-%Y%m%dT%H%M%SZ', time.gmtime())

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


class SubmitLab(e09.E09Joint):
    """E09 实验室加一条：同一套凭据、同一条签名通道上的 submit 端点。"""

    def start_provider(self, *args, **kwargs):
        super().start_provider(*args, **kwargs)
        # 父类起完之后，替身已经在跑；本实验要的是一份调用流水，所以带 call_log 重起一次。
        self.call_log = self.scratch / 'edu-calls.jsonl'
        if getattr(self, 'provider', None):
            self.provider.terminate()
            try: self.provider.wait(timeout=10)
            except Exception: pass
        self.ready_file.unlink(missing_ok=True)
        config = self.scratch / 'edu-stub-submit.json'
        config.write_text(json.dumps({
            'port': self.provider_port, 'tls_key': str(self.provider_tls_key),
            'tls_cert': str(self.provider_tls_cert), 'roster_file': str(self.roster_file),
            'ready_file': str(self.ready_file), 'client': 'practice', 'key_id': 'k1',
            'secret': self.provider_secret, 'source_instance': INSTANCE, 'call_log': str(self.call_log)}))
        self.provider = subprocess.Popen(['node', 'dev/e09-lab/stub.cjs', str(config)], cwd=ROOT,
                                         stdout=subprocess.DEVNULL,
                                         stderr=(self.scratch / 'edu-stub.log').open('a'))
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline and not self.ready_file.exists():
            time.sleep(0.1)
        need(self.ready_file.exists(), 'edu_provider_stub_did_not_restart')

    def lab_file(self):
        path = super().lab_file()
        spec = json.loads(path.read_text())
        spec['submit'] = {
            'endpoint': f'https://127.0.0.1:{self.provider_port}/api/integrations/practice/e09/submit',
            'client_key': 'practice', 'key_id': 'k1', 'secret': self.provider_secret,
            'source_instance': INSTANCE, 'ca_file': str(self.provider_tls_cert), 'timeout_ms': 4000}
        path.write_text(json.dumps(spec))
        return path

    def edu_calls(self):
        """替身收到过多少次通过凭据校验的 submit —— 用来证明"只叫了一次"不是空断言。"""
        if not self.call_log.exists():
            return 0
        return sum(1 for line in self.call_log.read_text().splitlines()
                   if line.strip() and '"route":"submit"' in line.replace(' ', ''))

    def plan(self, **submit):
        """改替身这一次怎么答（ok / refuse+code / unknown / fake）。"""
        roster = json.loads(self.roster_file.read_text())
        roster['submit'] = submit
        self.roster_file.write_text(json.dumps(roster))


def main():
    report = {'started_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'real': ['本候选树的后端与真实 Vite 前端', '真实 Chromium：1280 与 390 各一次',
                       '一次性 mysql:8.0 + redis、两组候选迁移', '真实 HTTPS 与真实服务凭据签名'],
              'synthetic': ["edu 的提交端点是 dev/e09-lab/stub.cjs（线形与签名真实，**不是 edu 的判定代码**）",
                            '学校、作业、师生 uuid 全为合成',
                            '"已落库但答复丢失"由替身按剧本造出，真实 edu 的落库时机未验',
                            '实践→浏览器那一跳的丢答复/截断由 Playwright 路由拦截造出（真请求真后端，只丢答复）'],
              'not_executed': ["edu 的 Go（跨仓审核 HOLD）", '生产', 'edu 正在跑的演示资源 18191/18192/18194'],
              'stage': 'start', 'checks': {}, 'verdicts': {}, 'passed': False}
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    c05lab.EVIDENCE = p09lab.EVIDENCE = EVIDENCE
    scratch = tempfile.mkdtemp(prefix='e09-submit-')
    site = lab = web = browser = None
    verdict = lambda name, ok, detail=None: report['verdicts'].__setitem__(name, {'ok': bool(ok), 'detail': detail})

    try:
        site = SubmitLab(scratch)
        lab = site.lab
        site.reviewer_map = {}
        site.prepare(report)
        lab.sql([f'UPDATE user_groups SET credits_pool=1000000, credits_pool_used=0 WHERE id={STUDENT_GROUP}'])
        lab.write_config({**c05lab.C05_CONFIG,
                          'issuance': {'mode': 'from_group_pool', 'amount': 5000, 'expire_days': 365}})
        issuer = Issuer(lab.issuer_secret)

        report['stage'] = 'one_student_one_work'
        site.start_provider(rules=[{'reviewer_ref': e09.TEACHER, 'school_ref': SCHOOL,
                                    'assignment_ref': ASSIGNMENT, 'student_uuid': None}])
        # 本实验不走教师审阅，所以资格提供方按正式候选形态（audience_hash）配置，不带实验室映射；
        # 提交与它同一对凭据、同一条签名通道，这正是真实部署的样子。
        eligibility = site.eligibility_http(reviewer_ref='audience_hash')
        eligibility.pop('reviewer_refs', None)
        site.eligibility_spec = eligibility
        site.plan(mode='ok', revision_no=1)
        site.start(label='e09-submit')
        student = lab_uuid(810)
        status, body, _ = lab.exchange(issuer, student_payload(
            student, context={'lesson_id': 'lesson-7', 'assignment_id': ASSIGNMENT}))
        need(status == 200, 'c05_exchange_refused')
        status, session, _ = lab.consume(body['handoff'])
        need(status == 200, 'c05_consume_refused')
        token = session['accessToken']
        user_id = int(lab.sql([f"SELECT id FROM users WHERE uuid='{student}'"])[0][0]['id'])
        project_id, page_id = 9301, 9401
        lab.sql([
            {'sql': 'INSERT INTO html_projects(id,user_id,name,type,is_default,sort_order) VALUES(?,?,?,?,1,0)',
             'params': [project_id, user_id, '校园节水网站', 'folder']},
            {'sql': '''INSERT INTO html_pages(id,project_id,user_id,title,slug,html_content,css_content,
                       js_content,compiled_content,version,is_published,created_at,updated_at)
                       VALUES(?,?,?,?,?,?,'','',?,1,0,FROM_UNIXTIME(?),FROM_UNIXTIME(?))''',
             'params': [page_id, project_id, user_id, '首页', 'index', PAGE, PAGE,
                        int(time.time()) - 3600, int(time.time()) - 3600]}])
        grant = site.grant(purpose='website_artifact_link', assignment_ref=ASSIGNMENT,
                           subject={'uuid': student, 'cohort': 'student'})

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

        for label, viewport in (('desktop', DESKTOP), ('narrow', NARROW)):
            report['stage'] = f'{label}_press'
            step = {}
            opened = browser.call('open', viewport=viewport, token=token, user_id=user_id,
                                  project='校园节水网站', task_context=grant if label == 'desktop' else None,
                                  screenshot=f'submit-{label}-1-open', timeout=420)
            step['opened'] = {'panel': opened['panel_visible'], 'link_button': opened['link_button']}
            if label == 'desktop':
                linked = browser.call('link', entry_label='首页', screenshot=f'submit-{label}-2-linked')
                step['linked'] = {'state': linked['state'], 'error': linked['error']}
                # 先保存后关联不算数：关联之后再真实保存一次，才有可交的版本。
                shape_before = browser.call('panelShape')
                step['before_save'] = shape_before
                browser.call('save', page_title='首页')
                time.sleep(2)
                browser.call('open', viewport=viewport, token=token, user_id=user_id, project='校园节水网站',
                             screenshot=f'submit-{label}-3-saved', timeout=420)
            shape = browser.call('panelShape')
            step['shape'] = shape
            before_calls = site.edu_calls()
            pressed = browser.call('submit', screenshot=f'submit-{label}-4-pressed')
            step['pressed'] = {k: pressed.get(k) for k in ('present', 'submitted', 'refusal', 'error', 'submit_requests')}
            step['pressed']['edu_calls'] = site.edu_calls() - before_calls
            report['checks'][f'{label}_press'] = step
            verdict(f'{label}_one_press_is_one_request_and_one_edu_call',
                    pressed['submit_requests'] == 1 and step['pressed']['edu_calls'] == 1,
                    '一次按压：浏览器发一条 /submissions，替身收一次 submit')
            verdict(f'{label}_student_presses_and_sees_the_fixed_version',
                    pressed['present'] is True and pressed['submitted'] and '已交' in pressed['submitted']
                    and not pressed['refusal'],
                    '按钮在学生做作品的同一处，成功框里写的是 edu 定的那一版')
            verdict(f'{label}_unlink_is_secondary',
                    'ant-btn-text' in (shape.get('unlink_class') or '') and 'ant-btn-dangerous' in (shape.get('unlink_class') or ''),
                    '取消关联降级为次要危险操作，不再是面板上最像重来的按钮')

        # ---- 拒绝、未知、伪成功：都不能显示成已交 ----------------------------------------------
        for name, plan, expect, wait in (
            ('refusal', {'mode': 'refuse', 'code': 'submission_limit', 'message': '提交次数已用完'}, '提交次数已用完', 1800),
            ('overdue', {'mode': 'refuse', 'code': 'deadline_passed', 'message': '已过截止时间，本次不收'}, '已过截止时间，本次不收', 1800),
            ('unknown', {'mode': 'unknown'}, None, 1800),
            ('timeout', {'mode': 'stall'}, None, 9000),   # 替身挂住不答：走到本侧 4s 绝对截止
            ('fake_success', {'mode': 'fake'}, None, 1800)
        ):
            is_refusal = plan['mode'] == 'refuse'
            report['stage'] = name
            site.plan(**plan)
            browser.call('open', viewport=DESKTOP, token=token, user_id=user_id, project='校园节水网站',
                         screenshot=f'submit-{name}-open', timeout=420)
            before_calls = site.edu_calls()
            pressed = browser.call('submit', screenshot=f'submit-{name}-pressed', wait=wait,
                                   timeout=60 + wait // 1000)
            report['checks'][name] = {k: pressed.get(k) for k in
                                      ('present', 'submitted', 'refusal', 'unknown', 'submit_requests')}
            report['checks'][name]['edu_calls'] = site.edu_calls() - before_calls
            shown = pressed['refusal'] if is_refusal else pressed['unknown']
            verdict(f'a_{name}_never_shows_as_handed_in',
                    not pressed['submitted'] and bool(shown)
                    and report['checks'][name]['edu_calls'] == 1
                    and (expect is None or expect in shown)
                    # 没有答复时，"没有交上"这句本身就是越界断言。
                    and (is_refusal or ('暂时无法确认' in shown and '没有交上' not in shown)),
                    'edu 的原句在拒绝框里；没有答复时只说暂时无法确认，成功框与"没有交上"都不出现')

        # ---- 反例：对面已经落库，答复却丢了 ---------------------------------------------------------
        # 这一格才证明"未知不等于没交上"：替身这边确实记下了一次提交，学生那边什么答复都没收到。
        report['stage'] = 'committed_then_answer_lost'
        site.plan(mode='record_then_lose', revision_no=7, delay_ms=5000)   # 拖过本侧 4s 绝对预算再断
        browser.call('open', viewport=DESKTOP, token=token, user_id=user_id, project='校园节水网站', timeout=420)
        before_calls = site.edu_calls()
        lost = browser.call('submit', screenshot='submit-committed-then-lost', wait=9000, settle=6000, timeout=90)
        committed = sum(1 for line in site.call_log.read_text().splitlines()
                        if '"committed":true' in line.replace(' ', ''))
        report['checks']['committed_then_answer_lost'] = {
            **{k: lost.get(k) for k in ('submitted', 'refusal', 'unknown',
                                        'submit_requests', 'submit_requests_after_settle')},
            'edu_calls': site.edu_calls() - before_calls, 'edu_committed_rows': committed}
        verdict('a_lost_answer_is_shown_as_unknown_not_as_not_submitted',
                committed == 1 and not lost['submitted'] and not lost['refusal']
                and bool(lost['unknown']) and '暂时无法确认' in lost['unknown']
                and '没有交上' not in lost['unknown'] and 'edu' in lost['unknown'],
                '对面已落一条提交，本侧只说暂时无法确认并指向去 edu 作业页核对，不说没交上、也不说已交')
        verdict('a_lost_answer_never_retries_by_itself',
                lost['submit_requests'] == 1 and lost['submit_requests_after_settle'] == 1
                and (site.edu_calls() - before_calls) == 1,
                '答复丢了以后再等 6 秒：没有第二条 /submissions，替身也没有被第二次叫')

        # ---- 反例二：提交已经走完本侧、对面也记下了，答复却没能回到浏览器 ----------------------------
        # 与上一格的区别在**断点位置**：上一格断在 edu→实践，这一格断在实践→浏览器。
        # 纯离线（请求根本没发出去）不算，所以这里让请求真的打到后端，只把回给页面的答复丢掉或截断。
        report['stage'] = 'answer_lost_to_browser'
        site.plan(mode='ok', revision_no=9)
        browser.call('open', viewport=DESKTOP, token=token, user_id=user_id, project='校园节水网站', timeout=420)
        for label, mode in (('dropped', 'drop'), ('truncated', 'truncate')):
            browser.call('interceptSubmit', mode=mode)
            before_calls = site.edu_calls()
            pressed = browser.call('submit', screenshot=f'submit-browser-{label}', wait=4000, settle=6000, timeout=90)
            intercept = pressed.get('intercept') or {}
            check = {**{k: pressed.get(k) for k in ('submitted', 'refusal', 'unknown',
                                                    'submit_requests', 'submit_requests_after_settle')},
                     'edu_calls': site.edu_calls() - before_calls,
                     'upstream_status': intercept.get('upstream_status'),
                     'upstream_bytes': intercept.get('upstream_bytes'),
                     'cut_at': intercept.get('cut_at'),
                     'upstream_said_submitted': '"submitted":true' in (intercept.get('upstream_body') or ''),
                     'upstream_body': (intercept.get('upstream_body') or '')[:160]}
            report['checks'][f'answer_lost_to_browser_{label}'] = check
            verdict(f'a_{label}_answer_to_the_browser_is_unknown_not_a_network_error',
                    check['upstream_said_submitted'] and check['edu_calls'] == 1
                    and not pressed['submitted'] and not pressed['refusal']
                    and bool(pressed['unknown']) and '暂时无法确认' in pressed['unknown']
                    and '没有交上' not in pressed['unknown'] and not pressed['error'],
                    '后端确实答了 submitted:true（对面已记下），页面却没收到：只显示未知，不显示已交、拒绝或"连接中断"')
            verdict(f'a_{label}_answer_to_the_browser_never_retries_by_itself',
                    pressed['submit_requests'] == 1 and pressed['submit_requests_after_settle'] == 1
                    and (site.edu_calls() - before_calls) == 1,
                    '再等 6 秒：浏览器仍只发过一条 /submissions，替身也只被叫一次')
        browser.call('interceptSubmit', mode='off')

        # ---- 双击只提交一次 ----------------------------------------------------------------------
        report['stage'] = 'double_click'
        site.plan(mode='ok', revision_no=2)
        browser.call('open', viewport=DESKTOP, token=token, user_id=user_id, project='校园节水网站', timeout=420)
        before_calls = site.edu_calls()
        double = browser.call('submit', double=True, screenshot='submit-double')
        report['checks']['double_click'] = {k: double.get(k) for k in ('submitted', 'refusal', 'submit_requests')}
        report['checks']['double_click']['edu_calls'] = site.edu_calls() - before_calls
        verdict('a_double_click_sends_one_submission',
                double['submit_requests'] == 1 and report['checks']['double_click']['edu_calls'] == 1
                and bool(double['submitted']),
                '面板自己上锁：两次点击只产生一次转达，替身只被叫一次')

        # ---- 关闭态：面板不出现，替身一次都没被叫 -------------------------------------------------
        report['stage'] = 'switched_off'
        log = site.call_log
        before = log.read_text() if log.exists() else ''
        browser.call('stop')
        browser = None
        lab.stop()
        site.eligibility_spec = None
        lab.start(enabled=False, label='p09-off')
        status, capability, _ = lab.call('GET', '/api/p09/website-artifacts/capability',
                                         headers={'Authorization': 'Bearer ' + token})
        after = log.read_text() if log.exists() else ''
        report['checks']['switched_off'] = {'capability_status': status,
                                            'available': capability.get('available'),
                                            'stub_calls_unchanged': before == after}
        verdict('with_the_switch_off_the_editor_offers_nothing_and_calls_nobody',
                capability.get('available') is False and before == after)

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
        for handle in (browser,):
            if handle:
                try: handle.close()
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

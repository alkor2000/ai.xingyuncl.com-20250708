"""给 edu E09 的单一固定实践输入：两支候选合在同一个运行实例上的新增交集。

两支各自的验收不在这里重跑（E09 资格见 dev/e09-lab/check.py 与 revocation.py，作品名见 dev/p09-lab/state-title.py，
本包在同一棵合并树上把那两份原样又跑了一遍）。这里只证明**合起来才出现的那几件事**：

1 两个开关都关时，合并后的程序仍然什么都不做；
2 同一个实例里，HTTP 资格能放行本班老师打开被点名的那一版，而 /state 同时给出这件作品的名字；
3 改名跟随读取，但不造保存/提交事实（计数器、状态、事件都不动）；
4 受限账本角色**真的**缺 html_projects 的 SELECT 时，/state 不退步：仍 200、其它字段照旧、名字为 null；补回授权后名字回来；
5 来源问不到（资格提供方下线）时仍 eligibility_unavailable，而作品名照样给——两个特性互不影响；
6 正式配置只接受不透明评阅人 ref：合并树的 eligibility.js 在 production 下拒绝明文 mapping/reviewer_refs。

真实件：合并树的后端（C05+P09 同开）、真实前端与 Chromium、一次性 mysql:8.0 + redis、两组候选迁移、
受限账本角色、真实 HTTPS 与真实服务凭据签名。
替身件：**edu 的资格端点**由 dev/e09-lab/stub.cjs 扮演——线形与签名构造真实，但它不是 edu 的 Go 判定代码。
未执行：edu 真实 Go handler（跨仓执行仍在审批 HOLD），P09 的 21 场景、C05 全套、浏览器四宽度全套。
"""
import json
from pathlib import Path
import subprocess
import tempfile
import time
import uuid as uuidlib

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / 'storage/private/e09-consolidated' / time.strftime('run-%Y%m%dT%H%M%SZ', time.gmtime())

import importlib.util                                                    # noqa: E402


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


e09 = load('e09lab', ROOT / 'dev/e09-lab/check.py')
joint, c05lab, p09lab = e09.joint, e09.c05lab, e09.p09lab
need, node, docker = joint.need, joint.node, joint.docker
lab_uuid, student_payload, Issuer = joint.lab_uuid, joint.student_payload, joint.Issuer
INSTANCE, PNG, PAGE, STUDENT_GROUP = joint.INSTANCE, joint.PNG, joint.PAGE, joint.STUDENT_GROUP
TEACHER, SCHOOL, ASSIGNMENT = e09.TEACHER, e09.SCHOOL, e09.ASSIGNMENT
reviewer_hash = e09.reviewer_hash

STATE_PATH = '/api/integrations/edu/website-artifacts/state'
FIELDS = ['state', 'work_state', 'save_evidence', 'has_effective_save', 'real_save_count',
          'change_no', 'observed_writes', 'preview_available']


def main():
    report = {'started_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'merged_inputs': {'e09_http_eligibility': '07dd196', 'p09_state_title': '60e6b99',
                                'common_ancestor': 'ca534dc'},
              'real': ['the merged tree with C05 and P09 both on', 'real frontend and Chromium',
                       'disposable mysql:8.0 and redis', 'both candidate migration sets',
                       'the restricted ledger role actually used by the server (P09_DB_USER)',
                       'real HTTPS and real service-credential signatures'],
              'synthetic': ["edu's eligibility endpoint is dev/e09-lab/stub.cjs — real shape and real "
                            "signature construction, NOT edu's Go decision code",
                            'every school, teacher, student and roster row is synthetic'],
              'not_executed': ["edu's real Go handler (cross-repository execution remains on approval hold)",
                               'the P09 21-scenario matrix, the whole C05 suite, the four-width browser sweep'],
              'stage': 'start', 'seams': {}, 'verdicts': {}, 'passed': False}
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    c05lab.EVIDENCE = p09lab.EVIDENCE = EVIDENCE
    scratch = tempfile.mkdtemp(prefix='e09-consolidated-')
    site = lab = None
    verdict = lambda name, ok, detail=None: report['verdicts'].__setitem__(name, {'ok': bool(ok), 'detail': detail})

    try:
        site = e09.E09Joint(scratch)
        lab = site.lab
        site.reviewer_map = {reviewer_hash('edu', TEACHER): TEACHER}
        site.prepare(report)
        lab.sql([f'UPDATE user_groups SET credits_pool=1000000, credits_pool_used=0 WHERE id={STUDENT_GROUP}'])
        lab.write_config({**c05lab.C05_CONFIG,
                          'issuance': {'mode': 'from_group_pool', 'amount': 5000, 'expire_days': 365}})
        issuer = Issuer(lab.issuer_secret)

        # ---- 0 两个开关都关 -------------------------------------------------------------------
        report['stage'] = 'both_switches_off'
        site.start(c05_on=False, p09_on=False, label='consolidated-both-off')
        off = {}
        status, body, _ = lab.exchange(issuer, student_payload(lab_uuid(601)))
        off['c05_exchange'] = {'status': status, 'code': (body.get('error') or {}).get('code')}
        off['p09_student_surface'] = lab.call('GET', '/api/p09/website-artifacts/capability')[0]
        off['edu_state'] = lab.call('GET', f'{STATE_PATH}?school_ref={SCHOOL}',
                                    headers=site.edu_headers('GET', STATE_PATH, f'school_ref={SCHOOL}'))[0]
        off['redis_keys'] = int(docker('exec', lab.redis_container, 'redis-cli', 'dbsize').split()[-1])
        off['ledger_rows'] = int(lab.sql(['SELECT COUNT(*) AS n FROM p09_links'])[0][0]['n'])
        report['seams']['both_switches_off'] = off
        verdict('with_both_switches_off_the_merged_program_does_nothing',
                off['c05_exchange']['code'] == 'student_entry_disabled' and off['p09_student_surface'] >= 400
                and off['edu_state'] >= 400 and off['redis_keys'] == 0 and off['ledger_rows'] == 0,
                '合并没有把任何一侧默认打开')
        lab.stop()

        # ---- 一个学生、一件作品、一版固定版本 -------------------------------------------------
        report['stage'] = 'one_work'
        site.start_provider(rules=[{'reviewer_ref': TEACHER, 'school_ref': SCHOOL,
                                    'assignment_ref': ASSIGNMENT, 'student_uuid': None}])
        site.eligibility_spec = site.eligibility_http()
        site.start(label='consolidated-on')
        student = lab_uuid(610)
        status, body, _ = lab.exchange(issuer, student_payload(
            student, context={'lesson_id': 'lesson-7', 'assignment_id': ASSIGNMENT}))
        need(status == 200, 'c05_exchange_refused')
        status, session, _ = lab.consume(body['handoff'])
        need(status == 200, 'c05_consume_refused')
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
        need(status == 200, 'link_refused_' + json.dumps(linked)[:160])
        artifact_ref = linked['link']['artifact_ref']
        need(lab.call('PUT', f'/api/html-editor/pages/{page_id}',
                      body={'html_content': PAGE, 'css_content': '', 'js_content': ''}, headers=auth)[0] == 200,
             'real_save_refused')
        time.sleep(1.5)
        links = lab.call('GET', '/api/p09/website-artifacts/links', headers=auth)[1]
        link_id = next(item['link_id'] for item in links['links'] if item['artifact_ref'] == artifact_ref)
        status, frozen, _ = lab.call('POST', f'/api/p09/website-artifacts/links/{link_id}/revisions',
                                     body={'schema_version': 1},
                                     headers={**auth, 'Idempotency-Key': str(uuidlib.uuid4())})
        need(status == 200, 'freeze_refused_' + json.dumps(frozen)[:160])
        revision_ref = frozen['revision']['revision_ref']

        def edu_state(school=SCHOOL):
            query = f'school_ref={school}'
            status, payload, _ = lab.call('GET', f'{STATE_PATH}?{query}',
                                          headers=site.edu_headers('GET', STATE_PATH, query))
            item = next((row for row in payload.get('items', []) if row['artifact_ref'] == artifact_ref), None)
            return status, payload, item

        def edu_events():
            # 增量读的字段名是 facts（不是 events），不带 cursor 就是从头读；cursor 是签名过的不透明值，
            # 不能自己拼 0。前一版这两点都踩了，于是拿到空表、前后比较等于什么都没证明。
            path = '/api/integrations/edu/website-artifacts/events'
            query = f'school_ref={SCHOOL}'
            status, payload, _ = lab.call('GET', f'{path}?{query}',
                                          headers=site.edu_headers('GET', path, query))
            need(status == 200, 'edu_events_refused_' + json.dumps(payload)[:160])
            return status, payload.get('facts', [])

        def review_session(reviewer=TEACHER):
            path = '/api/integrations/edu/website-artifacts/review-sessions'
            body = {'schema_version': 1}
            payload = {'purpose': 'website_artifact_review', 'assignment_ref': ASSIGNMENT, 'school_ref': SCHOOL,
                       'reviewer': {'ref': reviewer}, 'artifact_ref': artifact_ref, 'revision_ref': revision_ref}
            return lab.call('POST', path, body=body,
                            headers={**site.edu_headers('POST', path, '', body),
                                     'X-P09-Task-Context': site.grant(**payload)})

        # ---- 1 同一个实例：资格放行 + /state 给名字 -------------------------------------------
        report['stage'] = 'eligibility_and_name_together'
        web = p09lab.Web(lab.api_port, scratch)
        browser = joint.Browser(scratch, web.url, EVIDENCE)
        status, opened, _ = review_session()
        need(status == 200, 'own_class_review_refused_' + json.dumps(opened)[:200])
        # 这台机器上同时跑着别的会话，浏览器工人偶尔在答复前被挤住（截图已经落盘却超时）。
        # 放宽的是实验室的等待，不是产品里的任何超时。
        viewed = browser.call('review', open_url=opened['session']['open_url'], contains=['校园节水'],
                              screenshot='consolidated-1-teacher-opens', timeout=420)
        state_status, payload, item = edu_state()
        first = {'status': state_status, 'title': item and item.get('title'),
                 'complete': payload.get('complete'), 'truncated': payload.get('truncated'),
                 'sweep_incomplete': payload.get('sweep_incomplete'),
                 'scope_pending_reconcile': payload.get('scope_pending_reconcile')}
        # `complete:false` 只描述那一份快照（这次清扫没扫完），不是缺陷；按 edu 的读法有界重读即可。
        deadline = time.monotonic() + 30
        while payload.get('complete') is not True and time.monotonic() < deadline:
            time.sleep(2)
            state_status, payload, item = edu_state()
        before = {field: item.get(field) for field in FIELDS}
        report['seams']['eligibility_and_name_together'] = {
            'review_session': status, 'rendered': {'status': viewed['status'], 'contains': viewed['contains'],
                                                   'resources': viewed['resources']},
            'state_first_read': first,
            'state': {'status': state_status, 'title': item.get('title'), 'complete': payload.get('complete'),
                      'pending_reconcile': payload.get('pending_reconcile'),
                      'watermark_present': 'watermark' in payload}, 'item_before': before}
        verdict('one_instance_answers_both_questions',
                viewed['status'] == 200 and viewed['contains'] == [True]
                and any(res['status'] == 200 for res in viewed['resources'])
                and state_status == 200 and item.get('title') == '校园节水网站'
                and payload.get('complete') is True and payload.get('pending_reconcile') == 0,
                '资格由 HTTP 提供方逐次回答（判定来自替身名单）；作品名来自服务端可核来源')

        # ---- 2 改名跟随读取，但不造保存/提交事实 ---------------------------------------------
        report['stage'] = 'a_rename_is_not_a_save'
        _, events_before = edu_events()
        lab.sql([{'sql': 'UPDATE html_projects SET name=? WHERE id=?',
                  'params': ['校园节水网站（第二稿）', project_id]}])
        time.sleep(1.0)
        status, payload, renamed = edu_state()
        _, events_after = edu_events()
        after = {field: renamed.get(field) for field in FIELDS}
        report['seams']['a_rename_is_not_a_save'] = {
            'title': renamed.get('title'), 'item_after': after,
            'events_before': len(events_before), 'events_after': len(events_after),
            'event_types': [fact.get('type') for fact in events_after],
            'event_titles': [(fact.get('artifact') or {}).get('title') for fact in events_after]}
        verdict('a_rename_follows_the_read_and_makes_no_fact',
                renamed.get('title') == '校园节水网站（第二稿）' and after == before
                and len(events_before) >= 2 and len(events_after) == len(events_before)
                and all(title == '校园节水网站' for title in
                        report['seams']['a_rename_is_not_a_save']['event_titles'] if title is not None),
                '计数器/状态/事件一个都没动；事件仍带各自发生时的名字')

        # ---- 3 受限账本角色真的缺 html_projects 的 SELECT ------------------------------------
        report['stage'] = 'the_restricted_role_without_the_source_grant'
        lab.sql([f"REVOKE SELECT ON `{lab.database}`.`html_projects` FROM '{site.ledger_user}'@'%'"], database=None)
        status_revoked, payload_revoked, item_revoked = edu_state()
        lab.sql([f"GRANT SELECT ON `{lab.database}`.`html_projects` TO '{site.ledger_user}'@'%'"], database=None)
        status_back, _, item_back = edu_state()
        report['seams']['the_restricted_role_without_the_source_grant'] = {
            'revoked': {'status': status_revoked, 'title': item_revoked and item_revoked.get('title'),
                        'complete': payload_revoked.get('complete'),
                        'fields': {field: item_revoked.get(field) for field in FIELDS} if item_revoked else None},
            'granted_again': {'status': status_back, 'title': item_back and item_back.get('title')}}
        verdict('without_the_source_grant_the_read_does_not_regress',
                status_revoked == 200 and item_revoked is not None and item_revoked.get('title') is None
                and {field: item_revoked.get(field) for field in FIELDS} == after
                and payload_revoked.get('complete') is True,
                '名字读不到就是 null，账本这一侧照旧；运维少给一条 GRANT 不会让整次读取失败')
        verdict('putting_the_grant_back_brings_the_name_back',
                status_back == 200 and item_back.get('title') == '校园节水网站（第二稿）')

        # ---- 4 来源问不到：仍 fail-closed，而作品名照样给 -------------------------------------
        report['stage'] = 'provider_offline'
        site.write_roster([{'reviewer_ref': TEACHER, 'school_ref': SCHOOL, 'assignment_ref': ASSIGNMENT,
                            'student_uuid': student}], offline=True)
        status_offline, refused, _ = review_session()
        status_state, payload_state, item_state = edu_state()
        report['seams']['provider_offline'] = {
            'review_session': {'status': status_offline, 'code': (refused.get('error') or {}).get('code'),
                               'reason': (refused.get('error') or {}).get('reason')},
            'state': {'status': status_state, 'title': item_state and item_state.get('title')}}
        verdict('a_source_that_cannot_be_asked_is_still_refused',
                status_offline >= 400 and json.dumps(refused).find('eligibility_unavailable') >= 0,
                '超时/下线不放行')
        verdict('the_name_is_still_given_while_eligibility_is_unavailable',
                status_state == 200 and item_state.get('title') == '校园节水网站（第二稿）',
                '两个特性互不影响：问不到老师的资格，不等于读不到作品名')

        # ---- 5 正式配置只接受不透明评阅人 ref -------------------------------------------------
        report['stage'] = 'production_only_takes_opaque_refs'
        # 用的就是运行时读配置的那个入口（createEligibilityProvider），不是另写一个判断。
        gate = node("const {createEligibilityProvider}="
                    "require('./backend/src/services/websiteArtifact/eligibility');"
                    "let s='';process.stdin.on('data',b=>s+=b).on('end',()=>{const {spec}=JSON.parse(s);"
                    "const out={};for (const [name,candidate] of Object.entries(spec)){"
                    "try{createEligibilityProvider(candidate,{env:{NODE_ENV:'production'}});out[name]='accepted';}"
                    "catch(e){out[name]='refused:'+(e.code||e.message);}}"
                    "process.stdout.write(JSON.stringify(out));});",
                    {'spec': {'plaintext_mapping': site.eligibility_http(),
                              'plaintext_reviewer_refs': {**site.eligibility_http(), 'reviewer_ref': 'opaque',
                                                          'reviewer_refs': {'a': 'teacher-7'}},
                              'opaque_only': {k: v for k, v in site.eligibility_http().items()
                                              if k not in ('reviewer_ref', 'reviewer_refs')}}})
        report['seams']['production_only_takes_opaque_refs'] = gate
        verdict('production_refuses_plaintext_reviewer_names',
                gate['plaintext_mapping'].startswith('refused')
                and gate['plaintext_reviewer_refs'].startswith('refused')
                and gate['opaque_only'] == 'accepted',
                '正式部署只能收不透明 ref；明文名单只在实验室配置里')

        report['passed'] = all(entry['ok'] for entry in report['verdicts'].values())
        report['stage'] = 'done'
    except Exception as error:
        report['failure'] = f'{type(error).__name__}: {error}'
        raise
    finally:
        report['finished_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        text = json.dumps(report, ensure_ascii=False, indent=2)
        for value in ((lab.secrets() if lab else []) + (getattr(site, 'provider_secret', None) and
                                                        [site.provider_secret] or [])):
            if value:
                text = text.replace(value, '<redacted>')
        (EVIDENCE / 'report.json').write_text(text + '\n')
        if site:
            if getattr(site, 'provider', None):
                site.provider.terminate()
            lab.stop()
            for container in (lab.mysql_container, lab.redis_container):
                if container:
                    subprocess.run(['docker', 'rm', '-f', container], capture_output=True, timeout=120)
        subprocess.run(['rm', '-rf', scratch], timeout=60)
        failed = sorted(name for name, entry in report['verdicts'].items() if not entry['ok'])
        print(json.dumps({'passed': report['passed'], 'stage': report['stage'], 'failed_verdicts': failed,
                          'evidence': str(EVIDENCE)}, ensure_ascii=False))


if __name__ == '__main__':
    main()

"""P09 /state 的作品名：一次真实的、两端都能消费的形状检查。

真实件：本候选树的后端（同一进程开 C05 与 P09）、一次性 mysql:8.0（本地库结构、无数据行）+ redis、
两组候选迁移由 knex 应用、真实 HTTP 与真实服务凭据签名（edu 侧读取用的就是这条路）。
合成件：edu 发行方与其密钥、学生/学校标识、学生的项目行。
**没有执行 edu 的 Go**（跨仓调用仍在审批 HOLD），也没有重跑 P09 的 21 场景。

只核一件事：`/state` 的每件作品带不带可信的作品名，以及改名、删除、跨校时它是什么。
"""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import uuid as uuidlib

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / 'storage/private/p09-title-validation' / time.strftime('run-%Y%m%dT%H%M%SZ', time.gmtime())

import importlib.util                                                    # noqa: E402


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


joint = load('jointlab', ROOT / 'dev/c05-p09-lab/check.py')
c05lab = joint.c05lab
need, lab_uuid, student_payload, Issuer = joint.need, joint.lab_uuid, joint.student_payload, joint.Issuer
INSTANCE, PAGE, STUDENT_GROUP = joint.INSTANCE, joint.PAGE, joint.STUDENT_GROUP
SCHOOL = 'school-1'


def main():
    report = {'started_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'real': ['one node server with C05 and P09 on', 'disposable mysql:8.0 and redis',
                       'both candidate migration sets applied by knex',
                       'the real edu-facing read with a real service-credential signature'],
              'synthetic': ['the edu issuer and its keys', 'the student, school and assignment identifiers',
                            "the student's project row"],
              'not_run': ["edu's Go (cross-repository, approval hold)", 'the P09 21-scenario matrix'],
              'stage': 'start', 'checks': {}, 'verdicts': {}, 'passed': False}
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    c05lab.EVIDENCE = EVIDENCE
    scratch = tempfile.mkdtemp(prefix='p09-title-')
    site = lab = None
    verdict = lambda name, ok, detail=None: report['verdicts'].__setitem__(name, {'ok': bool(ok), 'detail': detail})

    try:
        site = joint.Joint(scratch)
        lab = site.lab
        site.prepare(report)
        lab.sql([f'UPDATE user_groups SET credits_pool=1000000, credits_pool_used=0 WHERE id={STUDENT_GROUP}'])
        lab.write_config({**c05lab.C05_CONFIG,
                          'issuance': {'mode': 'from_group_pool', 'amount': 5000, 'expire_days': 365}})
        issuer = Issuer(lab.issuer_secret)
        site.start(label='state-title')

        # 一个真实学生、一件真实作品
        report['stage'] = 'one_real_work'
        student = lab_uuid(710)
        status, body, _ = lab.exchange(issuer, student_payload(
            student, context={'lesson_id': 'lesson-7', 'assignment_id': 'assign-1'}))
        need(status == 200, 'exchange_refused')
        status, session, _ = lab.consume(body['handoff'])
        need(status == 200, 'consume_refused')
        auth = {'Authorization': 'Bearer ' + session['accessToken']}
        user_id = int(lab.sql([f"SELECT id FROM users WHERE uuid='{student}'"])[0][0]['id'])
        project_id, page_id = 9901, 9911
        lab.sql([
            {'sql': 'INSERT INTO html_projects(id,user_id,name,type,is_default,sort_order) VALUES(?,?,?,?,1,0)',
             'params': [project_id, user_id, '校园节水网站', 'folder']},
            {'sql': '''INSERT INTO html_pages(id,project_id,user_id,title,slug,html_content,css_content,
                       js_content,compiled_content,version,is_published,created_at,updated_at)
                       VALUES(?,?,?,?,?,?,'','',?,1,0,FROM_UNIXTIME(?),FROM_UNIXTIME(?))''',
             'params': [page_id, project_id, user_id, '首页', 'index', PAGE, PAGE,
                        int(time.time()) - 3600, int(time.time()) - 3600]}])
        status, linked, _ = lab.call('POST', '/api/p09/website-artifacts/links',
                                     body={'schema_version': 1, 'project_id': project_id, 'entry_page_id': page_id},
                                     headers={**auth, 'Idempotency-Key': str(uuidlib.uuid4()),
                                              'X-P09-Task-Context': site.grant(
                                                  purpose='website_artifact_link', assignment_ref='assign-1',
                                                  subject={'uuid': student, 'cohort': 'student'})})
        need(status == 200, 'link_refused_' + json.dumps(linked)[:160])
        artifact_ref = linked['link']['artifact_ref']
        need(lab.call('PUT', f'/api/html-editor/pages/{page_id}',
                      body={'html_content': PAGE, 'css_content': '', 'js_content': ''}, headers=auth)[0] == 200,
             'save_refused')
        time.sleep(1.5)

        def edu_state(school=SCHOOL):
            # 路由只收 school_ref / assignment_ref / student_uuid，多一个参数就是 invalid_request；
            # 签名覆盖排序后的 query，所以两边用同一个串。
            path = '/api/integrations/edu/website-artifacts/state'
            query = f'school_ref={school}'
            status, payload, _ = lab.call('GET', f'{path}?{query}',
                                          headers=site.edu_headers('GET', path, query))
            return status, payload

        def item_of(payload):
            return next((item for item in payload.get('items', []) if item['artifact_ref'] == artifact_ref), None)

        # ---- 1 关联并真实保存之后：名字在 /state 里 -------------------------------------------
        report['stage'] = 'named'
        status, payload = edu_state()
        need(status == 200, 'edu_state_refused_' + json.dumps(payload)[:160])
        item = item_of(payload)
        report['checks']['named'] = {'status': status, 'title': item and item.get('title'),
                                     'link_response_title': linked['link'].get('title'),
                                     'complete': payload.get('complete'),
                                     'pending_reconcile': payload.get('pending_reconcile'),
                                     'watermark_present': 'watermark' in payload}
        verdict('a_school_read_names_the_work', item is not None and item.get('title') == '校园节水网站',
                'edu 的两个列表因此不必再写"未命名作品"')
        verdict('the_snapshot_did_not_regress',
                payload.get('complete') is True and payload.get('pending_reconcile') == 0
                and 'watermark' in payload and 'scope_pending_reconcile' in payload)

        # ---- 2 学生改了作品名：下一次读就是新名字（当前名，不是关联时名） --------------------
        report['stage'] = 'renamed'
        lab.sql([{'sql': 'UPDATE html_projects SET name=? WHERE id=?',
                  'params': ['校园节水网站（第二稿）', project_id]}])
        status, payload = edu_state()
        renamed = item_of(payload)
        report['checks']['renamed'] = {'title': renamed and renamed.get('title'),
                                       'complete': payload.get('complete')}
        verdict('a_rename_shows_up_on_the_next_read',
                renamed is not None and renamed.get('title') == '校园节水网站（第二稿）',
                '字段语义是"当前名"；事件里留的是各自发生时的名字')

        # ---- 3 跨校：另一所学校读不到这件作品，也读不到它的名字 ------------------------------
        report['stage'] = 'other_school'
        status, other = edu_state(school='school-2')
        report['checks']['other_school'] = {'status': status,
                                            'code': (other.get('error') or {}).get('code'),
                                            'items': len(other.get('items', [])) if status == 200 else None}
        verdict('another_school_sees_neither_the_work_nor_its_name',
                status != 200 or item_of(other) is None)

        # ---- 4 来源被删：返回 null，不拿旧名字凑 ---------------------------------------------
        report['stage'] = 'source_deleted'
        lab.sql([f'DELETE FROM html_pages WHERE project_id={project_id}',
                 f'DELETE FROM html_projects WHERE id={project_id}'])
        # 让运行时按自己的路径发现来源没了（与平时的对账同一条路）
        lab.call('POST', '/api/p09/website-artifacts/links', body={'schema_version': 1, 'project_id': project_id,
                                                                   'entry_page_id': page_id},
                 headers={**auth, 'Idempotency-Key': str(uuidlib.uuid4()),
                          'X-P09-Task-Context': site.grant(purpose='website_artifact_link',
                                                           assignment_ref='assign-1',
                                                           subject={'uuid': student, 'cohort': 'student'})})
        deadline = time.monotonic() + 40
        gone = None
        while time.monotonic() < deadline:
            status, payload = edu_state()
            gone = item_of(payload)
            if gone and gone.get('state') != 'active':
                break
            time.sleep(2)
        report['checks']['source_deleted'] = {'title': gone and gone.get('title'),
                                              'state': gone and gone.get('state'),
                                              'work_state': gone and gone.get('work_state')}
        verdict('a_deleted_source_has_no_name_to_show',
                gone is not None and gone.get('title') is None,
                '不猜、不拿旧事件里的名字冒充现在')

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
        if site:
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

"""Real image ownership, end to end: a real upload over HTTP, a real page, a real fixed revision.

The web editor has no upload of its own — a student writes HTML and references a URL the platform gave
them somewhere else — so this run uses the platform's own upload endpoint (POST /api/chat/upload-image,
a base permission of every user) and the AI image module's ownership row, and then asks the frozen
revision what it did with each reference. Real here: the backend, MySQL built from the local schema
pre-image, the upload over HTTP, the editor's save endpoint, the P09 student and edu endpoints, and a
browser opening the isolated preview. Synthetic: the accounts, the edu issuer/eligibility, and the
image-generation ROW plus its file (generating one would be a paid model call, which this never makes).

Not covered here on purpose: the 21-scenario suite, which this package does not re-run.
"""
import base64
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
spec = importlib.util.spec_from_file_location('p09check', HERE / 'check.py')
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)                       # reuse the proven Instance/Web/Browser machinery
need, node = check.need, check.node
EVIDENCE = ROOT / 'storage/private/p09-validation' / time.strftime('assets-%Y%m%dT%H%M%SZ', time.gmtime())
PNG = bytes.fromhex((HERE / 'pond.png.hex').read_text().strip())
# A second, visibly different image: two frozen files must stay two files (the bundle is content
# addressed, so identical bytes would collapse into one and prove nothing).
PNG_SMALL = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478'
                          '9c6360000002000154a24f5e0000000049454e44ae426082')
EXTERNAL = 'https://cdn.example.com/not-ours.png'


def multipart(url, token, field, filename, content, mime='image/png'):
    """One real multipart upload, exactly as a browser posts it."""
    boundary = '----p09' + secrets.token_hex(8)
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"; filename="{filename}"\r\n'
            f'Content-Type: {mime}\r\n\r\n').encode() + content + f'\r\n--{boundary}--\r\n'.encode()
    request = urllib.request.Request(url, data=body, method='POST', headers={
        'Content-Type': f'multipart/form-data; boundary={boundary}', 'Authorization': 'Bearer ' + token})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read().decode() or '{}')
    except urllib.error.HTTPError as error:
        raw = error.read().decode()
        try:
            return error.code, json.loads(raw or '{}')
        except json.JSONDecodeError:
            return error.code, {'raw': raw[:200]}


def main():
    os.umask(0o077)
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    report = {'status': 'failed', 'stage': 'setup', 'checks': [], 'cases': [],
              'real': ['backend node src/server.js with the P09 runtime', 'mysql:8.0 from the local schema pre-image',
                       'a real multipart upload over HTTP (POST /api/chat/upload-image)',
                       "the editor's own save endpoint", 'the P09 student and edu endpoints', 'Chromium via Playwright'],
              'synthetic': ['two student accounts (no real student)', 'the edu issuer and eligibility roster',
                            'the image-generation ROW and its file (no paid model call is ever made)'],
              'not_covered': ['the 21-scenario suite (deliberately not re-run)', 'real teacher device acceptance']}
    container = 'p09-assets-' + uuid.uuid4().hex[:8]
    root_password = secrets.token_urlsafe(24)
    scratch = tempfile.mkdtemp(prefix='p09-assets-')
    instance = web = browser = None
    try:
        # ---- database (same shape as the full acceptance; kept local to avoid touching that file) ----
        report['stage'] = 'database'
        subprocess.run(['docker', 'image', 'inspect', check.MYSQL_IMAGE], check=True, stdout=subprocess.DEVNULL, timeout=15)
        subprocess.run(['docker', 'run', '-d', '--pull=never', '--name', container, '--label', 'pkuailab.task=p09-assets',
                        '-p', '127.0.0.1::3306', '-e', 'MYSQL_ROOT_PASSWORD', check.MYSQL_IMAGE],
                       env={**os.environ, 'MYSQL_ROOT_PASSWORD': root_password}, check=True, stdout=subprocess.DEVNULL, timeout=60)
        # The image runs a temporary init server first, so the real one is the SECOND "ready for
        # connections" — and even then the listener needs a moment, hence the retried probe below.
        deadline = time.monotonic() + 240
        while time.monotonic() < deadline:
            logs = subprocess.run(['docker', 'logs', container], capture_output=True, text=True)
            if (logs.stdout + logs.stderr).count('ready for connections') >= 2:
                time.sleep(3)
                break
            time.sleep(2)
        else:
            need(False, 'database_start_timeout')
        port = int(subprocess.run(['docker', 'port', container, '3306/tcp'], text=True, capture_output=True).stdout.strip().rsplit(':', 1)[1])
        mysql = {'host': '127.0.0.1', 'port': port, 'user': 'root', 'password': root_password}
        probe = """const mysql=require('./backend/node_modules/mysql2/promise');let s='';
process.stdin.on('data',b=>s+=b).on('end',async()=>{const c=JSON.parse(s);const db=await mysql.createConnection(c);
const [r]=await db.query('SELECT 1 AS ok');await db.end();process.stdout.write(JSON.stringify(r));});"""
        for attempt in range(15):
            try:
                node(probe, mysql, redact=[root_password])
                break
            except RuntimeError:
                need(attempt < 14, 'database_never_accepted_connections')
                time.sleep(2)

        local = check.dotenv(check.LOCAL_ENV)
        dump = ['docker', 'exec', '-e', 'MYSQL_PWD=' + local['DB_PASSWORD'], 'practice-mysql', 'mysqldump',
                '-u' + local['DB_USER'], '--skip-triggers', '--set-gtid-purged=OFF']
        structure = subprocess.run(dump + ['--no-data', '--skip-add-drop-table', local['DB_NAME']], capture_output=True, timeout=300)
        rows = subprocess.run(dump + ['--no-create-info', local['DB_NAME'], 'knex_migrations', 'knex_migrations_lock'],
                              capture_output=True, timeout=120)
        need(structure.returncode == 0 and rows.returncode == 0, 'local_schema_dump_failed')
        preimage = re.sub(rb'-- (Dump completed on|Host:|Server version|MySQL dump).*', b'',
                          re.sub(rb'AUTO_INCREMENT=\d+ ', b'', structure.stdout)).decode()

        facts = {}
        # The laboratory gets its own app domain, so no production hostname is baked into the evidence
        # and the absolute upload URLs the platform builds belong to this run.
        app_domain = 'practice-assets.localhost'
        os.environ['APP_DOMAIN'] = app_domain
        instance = check.Instance('practice-assets', mysql, scratch, secrets.token_urlsafe(40),
                                  secrets.token_urlsafe(40), secrets.token_urlsafe(48))
        # The same laboratory file the full acceptance writes, plus this deployment's own hostnames.
        original_lab_file = instance.lab_file
        def lab_file_with_hosts(**options):
            path = original_lab_file(**options)
            spec = json.loads(path.read_text())
            spec['app_hosts'] = [app_domain]
            path.write_text(json.dumps(spec))
            return path
        instance.lab_file = lab_file_with_hosts
        instance.build_database(preimage, rows.stdout.decode(), facts)
        instance.seed(check.accounts_for('edua'), check.projects_for())
        report['databases'] = facts
        instance.start(enabled=True)
        api = f'http://127.0.0.1:{instance.api_port}'
        token_a = instance.token('student_a')
        token_b = instance.token('student_b')

        # ---- 1. two real uploads over HTTP, one per student ---------------------------------------
        report['stage'] = 'real_upload'
        status, mine = multipart(f'{api}/api/chat/upload-image', token_a, 'image', 'pond.png', PNG)
        need(status == 200 and mine.get('data'), 'upload_failed_' + str(status) + json.dumps(mine)[:120])
        status, theirs = multipart(f'{api}/api/chat/upload-image', token_b, 'image', 'their-pond.png', PNG)
        need(status == 200 and theirs.get('data'), 'second_upload_failed_' + str(status))
        # The seeded fixtures also live in `files`; these two are the ones this run just uploaded.
        stored = instance.sql(["SELECT id,user_id,file_path,status FROM files WHERE file_path LIKE '%chat-images%' ORDER BY created_at"])[0]
        need(len(stored) == 2 and {int(row['user_id']) for row in stored} == {201, 202}, 'upload_rows_' + json.dumps(stored)[:200])
        # What the platform serves for such a file: /uploads + whatever follows the storage root. The
        # returned `url` also carries the app domain (File._buildUrl), which is why an absolute URL on
        # this deployment has to resolve to the same object.
        public = lambda row: '/uploads/' + str(row['file_path']).split('/uploads/', 1)[1]
        mine_row = next(row for row in stored if int(row['user_id']) == 201)
        theirs_row = next(row for row in stored if int(row['user_id']) == 202)
        mine_url, theirs_url = public(mine_row), public(theirs_row)
        report['cases'].append({'case': 'real_upload', 'status': status, 'owner_url': mine_url,
                                'other_student_url': theirs_url, 'returned_url_shape': mine['data'][0]['url'].replace(scratch, '<scratch>'),
                                'ownership_rows': len(stored), 'owners': sorted(int(row['user_id']) for row in stored),
                                'status_recorded': mine_row['status']})
        report['checks'].append('a real multipart upload over the platform\'s own endpoint records the owner in `files` and answers with the /uploads URL a student can paste')

        # ---- 2. the AI image module's row: ownership without a paid call --------------------------
        report['stage'] = 'generation_row'
        generated_key = 'generations/2026-09/p09-generated.png'
        (instance.storage / 'uploads' / generated_key).parent.mkdir(parents=True, exist_ok=True)
        (instance.storage / 'uploads' / generated_key).write_bytes(PNG_SMALL)
        app_host = app_domain
        generated_url = f'http://{app_host}/uploads/{generated_key}'      # exactly what ossService hands out
        orphan_key = 'generations/2026-09/p09-orphan.png'                 # a row whose file is not there
        instance.sql([
            {'sql': """INSERT INTO image_generations(user_id,model_id,prompt,size,status,local_path,file_size,credits_consumed)
                       VALUES(?,?,?,?,?,?,?,0)""",
             'params': [201, None, 'a pond', '1024x1024', 'success', generated_url, len(PNG_SMALL)]},
            {'sql': """INSERT INTO image_generations(user_id,model_id,prompt,size,status,local_path,file_size,credits_consumed)
                       VALUES(?,?,?,?,?,?,?,0)""",
             'params': [201, None, 'a missing pond', '1024x1024', 'success', f'http://{app_host}/uploads/{orphan_key}', len(PNG)]}])
        unowned_key = 'chat-images/2026-09/nobody-owns-this.png'
        (instance.storage / 'uploads' / unowned_key).parent.mkdir(parents=True, exist_ok=True)
        (instance.storage / 'uploads' / unowned_key).write_bytes(PNG)
        report['checks'].append('the AI image module already records the owner (image_generations.user_id + local_path): no new table and no new editor upload path is invented')

        # ---- 3. the student writes the page through the editor's own save endpoint -----------------
        report['stage'] = 'page'
        page_html = (f'<h1>我的池塘</h1><p>这是我上传的图片。</p><img src="{mine_url}" alt="我上传的">'
                     f'<img src="{generated_url}" alt="我生成的">'
                     f'<img src="{theirs_url}" alt="同学的图">'
                     f'<img src="/uploads/{unowned_key}" alt="没有归属行的图">'
                     f'<img src="http://{app_host}/uploads/{orphan_key}" alt="行在文件不在">'
                     f'<img src="{EXTERNAL}" alt="站外图">')
        status, _ = instance.call('PUT', '/api/html-editor/pages/7',
                                  body={'html_content': page_html, 'css_content': '', 'js_content': ''},
                                  headers={'Authorization': 'Bearer ' + token_a})
        need(status == 200, 'page_save_failed_' + str(status))

        # ---- 4. link and freeze through the real student endpoints --------------------------------
        report['stage'] = 'freeze'
        status, linked = instance.call('POST', '/api/p09/website-artifacts/links',
                                       body={'schema_version': 1, 'project_id': 3, 'entry_page_id': 7},
                                       headers={'Authorization': 'Bearer ' + token_a, 'Idempotency-Key': str(uuid.uuid4()),
                                                'X-P09-Task-Context': instance.grant(
                                                    purpose='website_artifact_link', assignment_ref='assign-1',
                                                    subject={'uuid': 'edua-uuid-a', 'cohort': 'student'})})
        need(status == 200, 'link_failed_' + str(status) + json.dumps(linked)[:160])
        artifact_ref = linked['link']['artifact_ref']
        status, links_of = instance.call('GET', '/api/p09/website-artifacts/links', headers={'Authorization': 'Bearer ' + token_a})
        link_id = links_of['links'][0]['link_id']
        status, fixed = instance.call('POST', f'/api/p09/website-artifacts/links/{link_id}/revisions',
                                      body={'schema_version': 1},
                                      headers={'Authorization': 'Bearer ' + token_a, 'Idempotency-Key': str(uuid.uuid4())})
        need(status == 200, 'freeze_failed_' + str(status) + json.dumps(fixed)[:160])
        manifest = fixed['revision']['manifest']
        frozen = {asset['reference']: asset['owned_by'] for asset in manifest['assets']}
        refused = {item['reference']: item['reason'] for item in manifest['refused_assets']}
        need(sorted(frozen.values()) == ['files', 'image_generations'], 'frozen_sources_' + json.dumps(frozen))
        need(refused.get(f'/uploads/{unowned_key}') == 'ownership_unproven', 'unowned_not_refused_' + json.dumps(refused))
        need(refused.get(f'/uploads/{orphan_key}') == 'file_missing', 'orphan_not_refused_' + json.dumps(refused))
        need(any(reason == 'ownership_unproven' and reference != f'/uploads/{unowned_key}' for reference, reason in refused.items()),
             'other_students_image_not_refused_' + json.dumps(refused))
        need([dep['url'] for dep in manifest['external_dependencies']] == [EXTERNAL], 'external_not_listed')
        report['cases'].append({'case': 'ownership_decides_what_is_frozen', 'frozen': frozen, 'refused': refused,
                                'external': [dep['url'] for dep in manifest['external_dependencies']],
                                'assets': [{k: asset[k] for k in ('path', 'byte_length', 'media_type', 'sha256', 'owned_by')}
                                           for asset in manifest['assets']]})
        report['checks'].append("a fixed revision freezes exactly the files the platform can prove belong to this student (chat upload and AI generation, including the absolute URL form the platform hands out), and refuses by name: another student's image and a file with no ownership row are ownership_unproven, a row whose file is gone is file_missing, an off-site URL stays external and is never fetched")

        # ---- 5. the browser opens the fixed revision, before and after the source is destroyed -----
        report['stage'] = 'browser'
        web = check.Web(instance.api_port, scratch)
        browser = check.Browser(scratch, web.url, EVIDENCE)
        def review(label):
            status, session = instance.edu_post('/review-sessions', {'schema_version': 1},
                                                headers={'X-P09-Task-Context': instance.grant(
                                                    purpose='website_artifact_review', assignment_ref='assign-1',
                                                    reviewer={'ref': 'teacher-7'}, artifact_ref=artifact_ref,
                                                    revision_ref=fixed['revision']['revision_ref'])})
            need(status == 200, 'review_session_' + str(status) + json.dumps(session)[:120])
            return browser.call('review', open_url=session['session']['open_url'],
                                contains=['我的池塘', '改稿之后'], screenshot=label)
        before = review('assets-1-frozen')
        assets_before = {item['file']: item['status'] for item in before['resources']}
        need(before['status'] == 200 and before['contains'] == [True, False], 'frozen_page_' + str(before['status']))
        need(len([1 for name, code in assets_before.items() if code == 200]) == 2, 'frozen_assets_' + json.dumps(assets_before))

        # The student rewrites the page and both original files are deleted from disk.
        status, _ = instance.call('PUT', '/api/html-editor/pages/7',
                                  body={'html_content': '<h1>改稿之后</h1><p>图片都删了。</p>', 'css_content': '', 'js_content': ''},
                                  headers={'Authorization': 'Bearer ' + token_a})
        need(status == 200, 'rewrite_failed')
        uploaded_disk = instance.storage / 'uploads' / mine_url.split('/uploads/', 1)[1]
        uploaded_disk.unlink()
        (instance.storage / 'uploads' / generated_key).unlink()
        time.sleep(1.0)
        after = review('assets-2-frozen-after-delete')
        assets_after = {item['file']: item['status'] for item in after['resources']}
        need(after['status'] == 200 and after['contains'] == [True, False], 'frozen_page_after_' + str(after['status']))
        need(len([1 for name, code in assets_after.items() if code == 200]) == 2, 'frozen_assets_after_' + json.dumps(assets_after))
        report['cases'].append({'case': 'fixed_revision_survives_the_source', 'before': assets_before,
                                'after_source_deleted': assets_after, 'shows_new_draft': after['contains'][1]})
        report['checks'].append('the fixed revision still shows its own bytes in a real browser after the page was rewritten and both original files were deleted from disk')

        # ---- 6. another student cannot claim the same file -----------------------------------------
        report['stage'] = 'cross_student'
        status, _ = instance.call('PUT', '/api/html-editor/pages/10',
                                  body={'html_content': f'<h1>同学乙</h1><img src="{mine_url}" alt="别人的图">',
                                        'css_content': '', 'js_content': ''},
                                  headers={'Authorization': 'Bearer ' + token_b})
        need(status == 200, 'b_page_save_' + str(status))
        status, b_link = instance.call('POST', '/api/p09/website-artifacts/links',
                                       body={'schema_version': 1, 'project_id': 6, 'entry_page_id': 10},
                                       headers={'Authorization': 'Bearer ' + token_b, 'Idempotency-Key': str(uuid.uuid4()),
                                                'X-P09-Task-Context': instance.grant(
                                                    purpose='website_artifact_link', assignment_ref='assign-2',
                                                    subject={'uuid': 'edua-uuid-b', 'cohort': 'student'})})
        need(status == 200, 'b_link_' + str(status) + json.dumps(b_link)[:120])
        status, b_links = instance.call('GET', '/api/p09/website-artifacts/links', headers={'Authorization': 'Bearer ' + token_b})
        b_link_id = b_links['links'][0]['link_id']
        status, b_fixed = instance.call('POST', f'/api/p09/website-artifacts/links/{b_link_id}/revisions',
                                        body={'schema_version': 1},
                                        headers={'Authorization': 'Bearer ' + token_b, 'Idempotency-Key': str(uuid.uuid4())})
        need(status == 200, 'b_freeze_' + str(status))
        b_refused = {item['reference']: item['reason'] for item in b_fixed['revision']['manifest']['refused_assets']}
        need(b_fixed['revision']['manifest']['assets'] == [], 'b_froze_someone_elses_file_' + json.dumps(b_fixed['revision']['manifest']['assets']))
        need(list(b_refused.values()) == ['ownership_unproven'], 'b_refusal_' + json.dumps(b_refused))
        report['cases'].append({'case': 'another_student_cannot_claim_it', 'frozen': b_fixed['revision']['manifest']['assets'],
                                'refused': b_refused})
        report['checks'].append("a second student referencing the first student's uploaded image freezes nothing: the row says whose it is, and the reference is refused by name")

        externals = browser.call('externals')
        need(not externals['external'], 'browser_left_the_laboratory_' + str(externals['external']))
        report['status'] = 'passed'
        report['stage'] = 'complete'
    except Exception as error:
        safe = str(error) if isinstance(error, RuntimeError) and re.fullmatch(r'[\x20-\x7e]+', str(error)) else type(error).__name__
        report['failure'] = {'stage': report['stage'], 'code': safe[:300]}
    finally:
        if browser:
            browser.close()
        if web:
            web.close()
        if instance:
            instance.stop()
            try:
                seen = [value for value in instance.secrets() if value] + [root_password]
                for log in sorted(Path(scratch).glob('*.log')):
                    text = log.read_text(errors='replace')
                    for value in seen:
                        text = text.replace(value, '<redacted>')
                    (EVIDENCE / log.name).write_text(text[-200000:])
            except Exception:
                pass
        shutil.rmtree(scratch, ignore_errors=True)
        subprocess.run(['docker', 'rm', '--force', '--volumes', container], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        report['checked_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        report['source_head'] = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True, capture_output=True).stdout.strip()
        report['source_dirty'] = subprocess.run(['git', 'status', '--porcelain'], cwd=ROOT, text=True, capture_output=True).stdout.strip() != ''
        report['evidence_dir'] = str(EVIDENCE)
        (EVIDENCE / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({'status': report['status'], 'failure': report.get('failure'), 'evidence': str(EVIDENCE)}, ensure_ascii=False))
    return 0 if report['status'] == 'passed' else 1


if __name__ == '__main__':
    sys.exit(main())

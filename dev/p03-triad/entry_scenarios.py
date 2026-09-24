"""Browser acceptance of the practice save entry ("保存到备课资源库") against the real chain, one process per case.

Invoked by dev/p03-triad/entry_overlay.go through I03_TRIAD_DRIVER (check.py --candidate=candidate-entry.json).
Practice side: an isolated MySQL 8 database built from the local schema copy (no rows) with the ledger migration
candidate applied by knex as the application account, the restricted ledger role, synthetic accounts and one
seeded conversation; the REAL backend (src/server.js) with the formal runtime enabled through P03_HANDOFF_LAB; the
real frontend on a Vite dev server; Playwright (dev/p03-entry-e2e.cjs) clicking through at desktop and 360/390/430
widths. Peers: the real Identity provider from the overlay (wall clock, TLS front) and the unmodified T11 cmd/t11-lab
behind the laboratory TLS relay of formal_scenarios.py. Nothing here touches production, the peer repositories or
the local development database; credentials arrive on stdin and never enter argv, logs or evidence.

`--smoke` runs only the default-off phase against a disposable MySQL container this script starts itself.
"""
import base64
import json
import os
from pathlib import Path
import re
import secrets
import select
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))
from formal_scenarios import Receiver, Relay, need  # noqa: E402

WIRE = 'teacher-artifact-handoff/1'
DAY = 86400
SOURCE_INSTANCE, TARGET_INSTANCE = 'practice-synthetic', 'tedna-synthetic'
IDENTITY_ORIGIN, SOURCE_ORIGIN, TARGET_ORIGIN = 'https://id.pkuailab.com', 'https://ai.pkuailab.com', 'https://workflow.pkuailab.com'
TEXT = {
    'entry': '保存到备课资源库', 'succeeded': '已保存到备课资源库', 'unknown': '结果待确认', 'recycled': '已在目标回收站', 'deleted': '目标已清除', 'ready': '已选定，尚未发送',
    'target_unavailable': '备课资源库暂不可用，请稍后重试；同一操作不会重复保存。', 'subject_not_eligible': '当前账号不能发起保存（学生/影子账号或未满足资格）。',
    'source_link_unavailable': '账号尚未与统一身份关联，请先完成关联再保存。'}
CONVERSATION = 'P03 备课讨论（合成）'
EXCERPT = '先观察，再记录两杯水的变化。'
ANSWERS = [
    '## 观察活动设计\n\n' + EXCERPT + '\n\n然后让学生用自己的话描述蒸发的过程，教师只追问“你看到了什么”。\n\n附件里的活动单可以直接打印。',
    '分数的初步认识可以从“平均分”开始：先分实物，再分图形，最后才引入符号 1/2。',
    '课堂提问的三个层次：复述事实、解释原因、迁移到新情境。每节课至少安排一个迁移层次的问题。',
    '小组合作的分工卡：记录员、发言人、计时员、材料员，四人一组轮换，两周换一次。',
    '作业反馈不必逐题批改，可以只圈出一处最值得改进的地方，并写一句下一步建议。']
ATTACHMENT = '# 活动单\n\n1. 两杯水，一杯盖盖子，一杯敞开。\n2. 每天同一时间量水位。\n3. 记录一周。\n'


class Clocks:
    """Wall clock on every side: Identity follows it in the overlay, t11-lab through a ticker thread here."""

    def __init__(self):
        self.now, self.receiver, self.paused, self.stop = int(time.time()), None, False, threading.Event()

    def target(self, t):
        need(self.receiver.call('clock', now=t).get('ok') is True, 'target_clock_rejected')

    def run(self):
        while not self.stop.wait(1):
            if not self.paused and self.receiver and self.receiver.process:
                try:
                    self.target(int(time.time()))
                except Exception:
                    pass
            self.now = int(time.time())


class LockedReceiver(Receiver):
    def __init__(self, *args, **kwargs):
        self.lock = threading.RLock()
        super().__init__(*args, **kwargs)

    def call(self, command, **fields):
        with self.lock:
            return super().call(command, **fields)


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def dotenv(path):
    values = {}
    for line in Path(path).read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            values[k.strip()] = v.strip().strip('"').strip("'")
    return values


NODE_SQL = """const mysql=require('./backend/node_modules/mysql2/promise');let s='';
process.stdin.on('data',b=>s+=b).on('end',async()=>{const c=JSON.parse(s);
const db=await mysql.createConnection({host:c.host,port:c.port,user:c.user,password:c.password,database:c.database||undefined,multipleStatements:true,charset:'utf8mb4'});
const out=[];try{for(const q of c.queries){const [rows]=await db.query(q.sql,q.params||[]);out.push(Array.isArray(rows)?rows:{affected:rows.affectedRows});}}
finally{await db.end();}process.stdout.write(JSON.stringify(out));});"""
NODE_KNEX = """const c=JSON.parse(require('fs').readFileSync(0,'utf8'));
const knex=require('./backend/node_modules/knex')({client:'mysql2',connection:{host:'127.0.0.1',port:c.port,user:c.user,password:c.password,database:c.database,charset:'utf8mb4'},
migrations:{directory:c.directory,tableName:'knex_migrations'}});
(async()=>{try{const [batch,files]=await knex.migrate.latest();process.stdout.write(JSON.stringify({batch,files:files.map(f=>require('path').basename(f))}));}
catch(e){process.stdout.write(JSON.stringify({error:String(e.code||e.message).slice(0,80)}));process.exitCode=1;}finally{await knex.destroy();}})();"""
NODE_SEED = """const bcrypt=require('./backend/node_modules/bcryptjs');let s='';
process.stdin.on('data',b=>s+=b).on('end',()=>{const c=JSON.parse(s);
process.stdout.write(JSON.stringify(Object.fromEntries(Object.entries(c.passwords).map(([k,v])=>[k,bcrypt.hashSync(v,10)]))));});"""
NODE_JWT = """const jwt=require('./backend/node_modules/jsonwebtoken');let s='';
process.stdin.on('data',b=>s+=b).on('end',()=>{const c=JSON.parse(s);
process.stdout.write(jwt.sign({userId:c.userId,email:null,username:c.username,role:'user',type:'access',jti:c.jti},c.secret,{expiresIn:'2h',issuer:'ai-platform',audience:'ai-platform-users'}));});"""


class PracticeLab:
    """Isolated practice database + storage + processes (backend, Vite, Playwright worker)."""

    def __init__(self, c, scratch):
        self.c, self.root, self.scratch = c, Path(c['practice_root']), Path(scratch)
        self.mysql = c['mysql']
        self.database = 'ai_platform_lab_' + secrets.token_hex(4)
        self.app_user, self.app_password = 'p03_app_' + secrets.token_hex(4), secrets.token_urlsafe(24)
        self.ledger_user, self.ledger_password = 'p03_ledger_' + secrets.token_hex(4), secrets.token_urlsafe(24)
        self.jwt_secret, self.jwt_refresh = secrets.token_urlsafe(48), secrets.token_urlsafe(48)
        self.accounts = {'teacher': {'id': 101, 'username': 'p03-teacher', 'password': secrets.token_urlsafe(12)},
                         'shadow': {'id': 102, 'username': 'p03-shadow-student', 'password': None},
                         'unlinked': {'id': 103, 'username': 'p03-unlinked-teacher', 'password': secrets.token_urlsafe(12)}}
        self.storage = self.scratch / 'storage'
        (self.storage / 'uploads/documents').mkdir(parents=True)
        self.backend = self.web = self.worker = None
        self.api_port, self.web_port = free_port(), free_port()
        self.backend_log = None
        self.messages = []

    def node(self, script, payload, timeout=120):
        p = subprocess.run(['node', '-e', script], cwd=self.root, input=json.dumps(payload), text=True, capture_output=True, timeout=timeout)
        need(p.returncode == 0, 'node_helper_failed_' + re.sub(r'[^a-z_]', '', (p.stderr.strip().splitlines() or ['unknown'])[-1].lower())[:40])
        text = p.stdout.strip()
        start = min([i for i in (text.find('{'), text.find('[')) if i >= 0], default=-1)
        return json.loads(text[start:]) if start >= 0 else text

    def sql(self, queries, database=None, user=None, password=None):
        return self.node(NODE_SQL, dict(self.mysql, database=database, user=user or self.mysql['user'], password=password or self.mysql['password'],
                                        queries=[q if isinstance(q, dict) else {'sql': q} for q in queries]))

    def build_database(self, facts):
        # Schema-only pre-image of the local production copy plus its knex bookkeeping rows: knex sees every recorded
        # migration present and only the ledger candidate pending, exactly as a deployment would.
        local = dotenv(self.root / 'backend/.env')
        for key in ['DB_USER', 'DB_PASSWORD', 'DB_NAME']:
            need(local.get(key), 'local_env_incomplete')
        mysqldump = ['docker', 'exec', '-e', 'MYSQL_PWD=' + local['DB_PASSWORD'], 'practice-mysql', 'mysqldump', '-u' + local['DB_USER'], '--skip-triggers', '--set-gtid-purged=OFF']
        dump = subprocess.run(mysqldump + ['--no-data', '--skip-add-drop-table', local['DB_NAME']], capture_output=True, timeout=300)
        rows = subprocess.run(mysqldump + ['--no-create-info', local['DB_NAME'], 'knex_migrations', 'knex_migrations_lock'], capture_output=True, timeout=120)
        need(dump.returncode == 0 and rows.returncode == 0, 'local_schema_dump_failed')
        preimage = re.sub(rb'-- (Dump completed on|Host:|Server version|MySQL dump).*', b'', re.sub(rb'AUTO_INCREMENT=\d+ ', b'', dump.stdout)).decode()
        need('p03_handoff_' not in preimage, 'preimage_already_has_ledger_tables')
        db = self.database
        self.sql([f'CREATE DATABASE `{db}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'])
        self.sql([preimage, rows.stdout.decode()], database=db)
        grants = self.node("const {restrictedRoleGrants}=require('./backend/src/services/artifactHandoff/mysqlStore');let s='';process.stdin.on('data',b=>s+=b).on('end',()=>{const c=JSON.parse(s);process.stdout.write(JSON.stringify(restrictedRoleGrants(c)));});",
                           {'database': db, 'user': self.ledger_user, 'host': '%'})
        self.sql([f"CREATE USER '{self.app_user}'@'%' IDENTIFIED BY '{self.app_password}'", f"GRANT ALL PRIVILEGES ON `{db}`.* TO '{self.app_user}'@'%'",
                  f"CREATE USER '{self.ledger_user}'@'%' IDENTIFIED BY '{self.ledger_password}'"])
        # The ledger candidate is applied by knex as the application account (the deployment's migrator), then the
        # restricted role receives exactly the four-table DML grants of mysqlStore.restrictedRoleGrants.
        migrations = self.scratch / 'migrations'
        shutil.copytree(self.root / 'backend/migrations', migrations)
        candidate = self.root / 'backend/migrations-candidates/p03/20260921_001_p03_handoff_ledger.js'
        (migrations / candidate.name).write_text(candidate.read_text().replace("require('../../src/services/artifactHandoff/mysqlStore')", 'require(' + json.dumps(str(self.root / 'backend/src/services/artifactHandoff/mysqlStore')) + ')'))
        migrated = self.node(NODE_KNEX, {'port': self.mysql['port'], 'user': self.app_user, 'password': self.app_password, 'database': db, 'directory': str(migrations)})
        need(migrated.get('files') == [candidate.name], 'ledger_candidate_not_applied')
        self.sql(grants)
        tables = self.sql([f"SELECT table_name AS t FROM information_schema.tables WHERE table_schema='{db}' AND table_name LIKE 'p03_handoff_%' ORDER BY 1"])[0]
        need([t['t'] for t in tables] == ['p03_handoff_keys', 'p03_handoff_operations', 'p03_handoff_owners', 'p03_handoff_snapshots'], 'ledger_tables_missing')
        facts.update(database_tables=int(self.sql([f"SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema='{db}'"])[0][0]['n']),
                     knex_recorded=int(self.sql(['SELECT COUNT(*) AS n FROM knex_migrations'], database=db)[0][0]['n']), ledger_migration=candidate.name,
                     restricted_role_grants=len(grants), migrator='application account (ALL PRIVILEGES on the isolated database)')
        self.seed()

    def seed(self):
        hashes = self.node(NODE_SEED, {'passwords': {k: v['password'] for k, v in self.accounts.items() if v['password']}})
        rows = []
        for key, a in self.accounts.items():
            rows.append({'sql': 'INSERT INTO users(id,uuid,uuid_source,username,password_hash,role,status,email_verified) VALUES(?,?,?,?,?,?,?,1)',
                         'params': [a['id'], str(uuid.uuid4()), 'sso' if key == 'shadow' else 'system', a['username'], hashes.get(key, 'not-a-password'), 'user', 'active']})
        file_id = str(uuid.uuid4())
        stored = 'p03-lab-' + secrets.token_hex(6) + '.md'
        (self.storage / 'uploads/documents' / stored).write_text(ATTACHMENT, encoding='utf-8')
        for key, a in self.accounts.items():
            conversation = str(uuid.uuid4())
            rows.append({'sql': 'INSERT INTO conversations(id,user_id,title,model_name,message_count) VALUES(?,?,?,?,?)', 'params': [conversation, a['id'], CONVERSATION, 'lab-model', 2 * len(ANSWERS)]})
            if key == 'teacher':
                rows.append({'sql': 'INSERT INTO files(id,user_id,conversation_id,original_name,stored_name,file_path,file_size,mime_type,status) VALUES(?,?,?,?,?,?,?,?,?)',
                             'params': [file_id, a['id'], conversation, 'activity.md', stored, 'storage/uploads/documents/' + stored, len(ATTACHMENT.encode()), 'text/markdown', 'ready']})
            for i, answer in enumerate(ANSWERS):
                base = time.time() - 3600 + i * 120
                question = str(uuid.uuid4())
                rows.append({'sql': 'INSERT INTO messages(id,conversation_id,sequence_number,role,content,status,created_at) VALUES(?,?,?,?,?,?,FROM_UNIXTIME(?))',
                             'params': [question, conversation, 2 * i + 1, 'user', f'第 {i + 1} 个问题：请给一个可以直接用的教学建议。', 'completed', int(base)]})
                message = str(uuid.uuid4())
                rows.append({'sql': 'INSERT INTO messages(id,conversation_id,sequence_number,role,content,status,model_name,file_ids,created_at) VALUES(?,?,?,?,?,?,?,?,FROM_UNIXTIME(?))',
                             'params': [message, conversation, 2 * i + 2, 'assistant', answer, 'completed', 'lab-model', json.dumps([file_id]) if key == 'teacher' and i == 0 else None, int(base) + 30]})
                if key == 'teacher':
                    self.messages.append(message)
        self.sql(rows, database=self.database)
        self.file_id = file_id

    def backend_env(self, enabled, lab_json=None):
        env = {**os.environ, 'NODE_ENV': 'development', 'PORT': str(self.api_port), 'DB_HOST': '127.0.0.1', 'DB_PORT': str(self.mysql['port']), 'DB_USER': self.app_user,
               'DB_PASSWORD': self.app_password, 'DB_NAME': self.database, 'REDIS_HOST': '127.0.0.1', 'REDIS_PORT': str(free_port()), 'REDIS_PASSWORD': '',
               'JWT_ACCESS_SECRET': self.jwt_secret, 'JWT_REFRESH_SECRET': self.jwt_refresh, 'STORAGE_PATH': str(self.storage), 'CORS_ORIGIN': f'http://127.0.0.1:{self.web_port}',
               'IDENTITY_ENABLED': 'true', 'IDENTITY_ISSUER': IDENTITY_ORIGIN, 'IDENTITY_PUBLIC_ORIGIN': SOURCE_ORIGIN, 'IDENTITY_CLIENT_ID': 'ai-platform-client',
               'IDENTITY_CLIENT_SECRET': self.c.get('source_secret', ''), 'IDENTITY_DEPLOYMENT_INSTANCE_KEY': SOURCE_INSTANCE, 'IDENTITY_CREDENTIALS_FILE': '',
               'IDENTITY_TOKEN_AUTH_METHOD': 'client_secret_post'}
        for key in [k for k in env if k.startswith('P03_')]:
            del env[key]
        # dotenv fills every key the process environment leaves unset: blank out the local .env's other Identity
        # values (callback/backchannel overrides, TTLs) so the deployment contract derives from the values above.
        for key in dotenv(self.root / 'backend/.env'):
            if key.startswith('IDENTITY_') and key not in env:
                env[key] = ''
        if enabled:
            env.update({'P03_HANDOFF_ENABLED': 'true', 'P03_HANDOFF_STORE': 'mysql', 'P03_HANDOFF_WIRE_VERSION': WIRE, 'P03_HANDOFF_SOURCE_INSTANCE': SOURCE_INSTANCE,
                        'P03_HANDOFF_TARGET_INSTANCE': TARGET_INSTANCE, 'P03_HANDOFF_IDENTITY_ORIGIN': IDENTITY_ORIGIN, 'P03_HANDOFF_TARGET_ORIGIN': TARGET_ORIGIN,
                        'P03_HANDOFF_DB_USER': self.ledger_user, 'P03_HANDOFF_DB_PASSWORD': self.ledger_password, 'P03_HANDOFF_LAB': lab_json, 'P03_HANDOFF_TIMEOUT_MS': '8000'})
        return env

    def start_backend(self, enabled, lab_json=None):
        log = self.scratch / ('backend-' + ('on' if enabled else 'off') + '.log')
        self.backend_log = log.open('a')
        self.backend = subprocess.Popen(['node', 'src/server.js'], cwd=self.root / 'backend', env=self.backend_env(enabled, lab_json), stdin=subprocess.DEVNULL,
                                        stdout=self.backend_log, stderr=subprocess.STDOUT)
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            if self.backend.poll() is not None:
                self.backend_log.close()
                tail = log.read_text(errors='replace').splitlines()[-12:]
                for word in self.secrets():
                    tail = [line.replace(word, '<redacted>') for line in tail]
                sys.stderr.write('\n'.join(tail) + '\n')
                need(False, 'backend_exited_' + str(self.backend.returncode))
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{self.api_port}/health', timeout=3) as r:
                    if r.status == 200:
                        return
            except Exception:
                time.sleep(.5)
        need(False, 'backend_start_timeout')

    def stop_backend(self):
        if self.backend and self.backend.poll() is None:
            self.backend.terminate()
            try:
                self.backend.wait(timeout=20)
            except subprocess.TimeoutExpired:
                self.backend.kill()
                self.backend.wait(timeout=5)
        if self.backend_log:
            self.backend_log.close()
        self.backend = None

    def start_web(self):
        self.web = subprocess.Popen(['node', 'dev/p03-entry-web.mjs'], cwd=self.root, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=(self.scratch / 'web.log').open('w'), text=True)
        self.web.stdin.write(json.dumps({'port': self.web_port, 'api': f'http://127.0.0.1:{self.api_port}'}) + '\n')
        self.web.stdin.flush()
        need(select.select([self.web.stdout], [], [], 120)[0], 'web_start_timeout')
        ready = json.loads(self.web.stdout.readline() or '{}')
        need(ready.get('ready') is True, 'web_not_ready')
        self.web_url = ready['url']

    def start_worker(self, evidence):
        # Chromium needs a writable, roomy temp directory (a full /tmp kills the launch) and, on this WSL host without
        # root, the user-space copies of its shared libraries (P03_BROWSER_LIBS); both are laboratory facts, not code.
        env = {**os.environ, 'PLAYWRIGHT_MODULE': os.environ.get('PLAYWRIGHT_MODULE', '/home/hanying/feedback-sync-ws/tools/node_modules/playwright'), 'TMPDIR': str(self.scratch)}
        libs = os.environ.get('P03_BROWSER_LIBS', '/home/hanying/feedback-sync-ws/tools/browser-libs/extracted/usr/lib/x86_64-linux-gnu')
        if Path(libs).is_dir():
            env['LD_LIBRARY_PATH'] = libs + (':' + env['LD_LIBRARY_PATH'] if env.get('LD_LIBRARY_PATH') else '')
        self.worker = subprocess.Popen(['node', 'dev/p03-entry-e2e.cjs'], cwd=self.root, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=(self.scratch / 'worker.log').open('w'), text=True)
        self.browser('start', web=self.web_url, evidence=str(evidence), conversation=CONVERSATION)

    def browser(self, command, timeout=180, **fields):
        self.worker.stdin.write(json.dumps(dict(command=command, **fields)) + '\n')
        self.worker.stdin.flush()
        need(select.select([self.worker.stdout], [], [], timeout)[0], 'browser_timeout_' + command)
        line = self.worker.stdout.readline()
        need(line, 'browser_worker_stopped')
        response = json.loads(line)
        if not response.get('ok'):
            code = re.sub(r'[^A-Za-z0-9_]', '_', str(response.get('code', 'failed')))[:80]
            sys.stderr.write(json.dumps({'browser_failure': command, 'code': code, 'requests': response.get('requests'), 'errors': response.get('errors')}, ensure_ascii=False)[:2000] + '\n')
            need(False, 'browser_' + command + '_' + code)
        return response

    def token_for(self, key):
        a = self.accounts[key]
        return self.node(NODE_JWT, {'userId': a['id'], 'username': a['username'], 'jti': uuid.uuid4().hex, 'secret': self.jwt_secret})

    def ledger(self):
        return self.sql(['SELECT id, status, owner FROM p03_handoff_operations ORDER BY id'], database=self.database, user=self.ledger_user, password=self.ledger_password)[0]

    def secrets(self):
        return [x for x in [self.app_password, self.ledger_password, self.jwt_secret, self.jwt_refresh, self.c.get('source_secret'), self.c.get('target_secret'), self.c.get('source_auth'),
                            self.accounts['teacher']['password'], self.accounts['unlinked']['password'], self.mysql.get('password')] if x]

    def check_logs(self):
        for name in ['backend-off.log', 'backend-on.log', 'web.log', 'worker.log']:
            path = self.scratch / name
            if path.exists():
                raw = path.read_text(errors='replace')
                need(not any(x in raw for x in self.secrets()), 'secret_in_' + name.split('.')[0].replace('-', '_') + '_log')

    def close(self):
        for process in [self.worker, self.web]:
            if process and process.poll() is None:
                try:
                    process.stdin.close()
                    process.wait(timeout=15)
                except Exception:
                    process.kill()
        self.stop_backend()


def posts(requests):
    return [(r['path'], r['status']) for r in requests if r['method'] == 'POST']


def run_case(c, evidence, smoke=False):
    report = {'case': c['case'], 'passed': False, 'wire': WIRE, 'widths': [1280, 360, 390, 430], 'scenarios': [], 'operations': 0,
              'practice': 'REAL backend src/server.js (formal runtime via P03_HANDOFF_ENABLED=true + P03_HANDOFF_LAB) on an isolated MySQL 8 built from the local schema copy; ledger candidate migration by knex; restricted ledger role; real frontend on Vite; Playwright chromium',
              'identity': 'real Go/PG18 provider through entry_overlay.go: formal candidate, formal policy + pairs, wall clock, TLS front for id.pkuailab.com',
              'target': 'unmodified T11 cmd/t11-lab (formal:true) behind the laboratory TLS relay for workflow.pkuailab.com; clock follows wall time',
              'accounts': 'synthetic: teacher (linked), shadow student (uuid_source=sso, unlinked), unlinked teacher; none real',
              'isolated_ca': 'ephemeral per run; replaces system roots for the practice transport only'}
    checks, stage = [], 'setup'
    clocks, receiver, relay, lab = Clocks(), None, None, None
    ticker = threading.Thread(target=clocks.run, daemon=True)
    with tempfile.TemporaryDirectory(prefix='p03-entry-') as directory:
        c['scratch'] = directory
        try:
            lab = PracticeLab(c, directory)
            facts = {}
            lab.build_database(facts)
            report['practice_database'] = facts
            stage = 'default_off'
            # Phase A: the very same server with the switch unset — the entry is absent and every call answers handoff_disabled.
            lab.start_backend(enabled=False)
            lab.start_web()
            lab.start_worker(evidence)
            desktop = {'width': 1280, 'height': 900}
            lab.browser('login', account=lab.accounts['teacher']['username'], password=lab.accounts['teacher']['password'], viewport=desktop)
            opened = lab.browser('open', screenshot='default-off-desktop')
            need(opened['entries'] == 0 and opened['downloads'] == len(ANSWERS), 'entry_visible_while_disabled')
            capability = lab.browser('probe', method='GET', path='/api/p03/handoffs/capability')
            need(capability['status'] == 200 and capability['body'].get('available') is False, 'capability_not_closed')
            freeze = lab.browser('probe', method='POST', path='/api/p03/handoffs', headers={'Idempotency-Key': str(uuid.uuid4())},
                                 body={'schema_version': 1, 'message_id': lab.messages[0], 'expected_version': 'sha256:x', 'selection': {'start': 0, 'end': 1}, 'attachments': [], 'purpose': 'reference', 'title': 't'})
            need(freeze['status'] == 503 and freeze['body']['error']['code'] == 'handoff_disabled', 'freeze_not_refused_while_disabled')
            report['scenarios'].append({'name': 'default_off', 'width': 1280, 'entries_rendered': 0, 'download_entries': opened['downloads'], 'capability': capability['body'], 'freeze_status': freeze['status']})
            checks.append('default-off: same server without the switch renders no entry, capability available:false, direct freeze 503 handoff_disabled; no pool, credential or peer')
            lab.stop_backend()
            if smoke:
                report['smoke_only'] = True
                report['passed'] = True
                return report
            stage = 'peers'
            receiver = LockedReceiver(c, clocks, formal=True)
            ticker.start()
            relay = Relay(receiver, 'observe', tls=c['tls'])
            lab_json = Path(directory) / 'lab.json'
            lab_json.write_text(json.dumps({'ca': c['tls']['ca'], 'ports': {'identity': int(c['identity_tls_url'].rsplit(':', 1)[1]), 'target': int(relay.url.rsplit(':', 1)[1])},
                                            'source_instance': SOURCE_INSTANCE, 'target_instance': TARGET_INSTANCE}))
            stage = 'enabled_start'
            lab.start_backend(enabled=True, lab_json=str(lab_json))
            operations = []

            def freeze_and_save(requests, extra_saves=0):
                p = posts(requests)
                need(len(p) == 2 + extra_saves and p[0] == ('/api/p03/handoffs', 200) and all(path.endswith('/save') and status == 200 for path, status in p[1:]), 'unexpected_posts_' + str(len(p)))
                op = p[1][0].split('/')[-2]
                need(re.fullmatch(r'[0-9a-f-]{36}', op), 'operation_id_shape')
                operations.append(op)
                return op

            # Desktop: explicit selection (range + one attachment), preview, confirm; nothing sent before confirm.
            stage = 'desktop_save'
            lab.browser('login', account=lab.accounts['teacher']['username'], password=lab.accounts['teacher']['password'], viewport=desktop)
            opened = lab.browser('open', screenshot='desktop-0-conversation')
            need(opened['entries'] == len(ANSWERS), 'entry_count_' + str(opened['entries']))
            result = lab.browser('handoff', index=0, excerpt=EXCERPT, attachment='activity.md', title='蒸发观察活动（两杯水）', screenshots='desktop')
            need(result['posts_before_confirm'] == 0, 'sent_before_confirm')
            need(result['preview'] == EXCERPT and result['attachments_offered'] == 1, 'preview_mismatch')
            need(result['preview_fields'].get('保存到') == 'TE-DNA 备课资源库 · 我的资料（北大实例）' and result['preview_fields'].get('资料标题') == '蒸发观察活动（两杯水）', 'preview_fields')
            body = next(r['body'] for r in result['requests'] if r['method'] == 'POST' and r['path'] == '/api/p03/handoffs')
            need(sorted(body) == ['attachments', 'expected_version', 'message_id', 'purpose', 'schema_version', 'selection', 'title'], 'freeze_body_keys')
            need(body['selection'] == result['selection'] and body['attachments'] == [{'source_id': lab.file_id, 'expected_version': body['attachments'][0]['expected_version']}] and body['message_id'] == lab.messages[0], 'freeze_body')
            op = freeze_and_save(result['requests'])
            need(result['view']['status'] == TEXT['succeeded'] and result['view']['fields'].get('资料编号'), 'desktop_status')
            packet = receiver.call('packet', operation_id=op)
            need(packet.get('ok') is True, 'target_packet_missing')
            # The package the target stored: manifest (base64 JSON) + blobs (base64 bytes); exactly the excerpt and the chosen file.
            manifest = json.loads(base64.b64decode(packet['package']['manifest_b64']))
            blobs = {b['blob_id']: base64.b64decode(b['data_b64']).decode('utf-8') for b in packet['package']['blobs']}
            need(blobs.get('answer') == EXCERPT and [b['name'] for b in manifest['blobs']] == ['answer.md', 'activity.md'] and blobs.get(lab.file_id) == ATTACHMENT, 'target_package_scope')
            need(manifest['locator'] == {'basis': 'answer_without_thinking_utf16', **result['selection']} and manifest['title'] == '蒸发观察活动（两杯水）' and manifest['visibility'] == 'private', 'target_manifest')
            need(not any(other[:12] in ''.join(blobs.values()) for other in ANSWERS[1:]) and 'conversation_id' in manifest['source'], 'other_answers_leaked')
            need(receiver.count() == 1, 'target_resource_count')
            report['scenarios'].append({'name': 'desktop_save', 'width': 1280, 'operation': op, 'selection': result['selection'], 'posts': posts(result['requests']), 'status': result['view']['status'],
                                        'target_package': {'blobs': [b['name'] for b in manifest['blobs']], 'answer_bytes': len(EXCERPT.encode()), 'locator': manifest['locator'], 'purpose': manifest['purpose']}})
            checks.append('desktop: range + one attachment chosen, preview shows content/title/source/target, zero POST before confirm, one freeze + one save, target package holds exactly the excerpt and the chosen attachment')
            # Reload recovery: the status view comes back from the local ledger; no preview, no peer call.
            stage = 'reload_recovery'
            again = lab.browser('reopen', index=0, expect_status=[TEXT['succeeded']], screenshot='desktop-4-after-reload')
            need(not any(r['method'] == 'POST' for r in again['requests']) and not any('/messages/' in r['path'] for r in again['requests']), 'reload_recovery_called_peer_or_preview')
            need(any(r['path'].startswith('/api/p03/handoffs?message_id=') for r in again['requests']), 'reload_recovery_without_list')
            refreshed = lab.browser('refresh', expect_status=[TEXT['succeeded']])
            need(posts(refreshed['requests']) == [(f'/api/p03/handoffs/{op}/refresh', 200)], 'refresh_posts')
            report['scenarios'].append({'name': 'reload_recovery', 'width': 1280, 'operation': op, 'requests_after_reload': [(r['method'], r['path'].split('?')[0]) for r in again['requests']], 'status': again['view']['status']})
            checks.append('reload: the operation is recovered from the local list without preview or peer traffic; explicit refresh queries status once and keeps succeeded')
            lab.browser('close_modal')
            # 360: duplicate click on confirm — one freeze, one save, one operation.
            stage = 'duplicate_click'
            lab.browser('login', account=lab.accounts['teacher']['username'], password=lab.accounts['teacher']['password'], viewport={'width': 360, 'height': 740})
            need(lab.browser('open', screenshot='w360-0-conversation')['entries'] == len(ANSWERS), 'entries_360')
            result = lab.browser('handoff', index=1, title='分数的初步认识', confirm='double', screenshots='w360')
            need(result['posts_before_confirm'] == 0, 'sent_before_confirm_360')
            op = freeze_and_save(result['requests'])
            need(result['view']['status'] == TEXT['succeeded'] and receiver.count() == 2, 'duplicate_click_result')
            report['scenarios'].append({'name': 'duplicate_click', 'width': 360, 'operation': op, 'posts': posts(result['requests']), 'status': result['view']['status']})
            checks.append('360: a double click on confirm produces one freeze and one save; the target holds one more private copy, not two')
            lab.browser('close_modal')
            # 390: first commit lost at the target (relay answers 503 target_unavailable) -> unknown + retry -> succeeded.
            stage = 'failure_recovery'
            relay.mode, relay.failed_once = 'fail_first_commit', False
            lab.browser('login', account=lab.accounts['teacher']['username'], password=lab.accounts['teacher']['password'], viewport={'width': 390, 'height': 844})
            lab.browser('open')
            result = lab.browser('handoff', index=2, title='课堂提问的三个层次', expect_status=[TEXT['unknown']], screenshots='w390')
            need(result['view']['error'] == TEXT['target_unavailable'] and result['view']['retry_visible'], 'failure_not_shown')
            p = posts(result['requests'])
            need(len(p) == 2 and p[0] == ('/api/p03/handoffs', 200) and p[1][0].endswith('/save') and p[1][1] == 503, 'failure_posts_' + str(p))
            op = p[1][0].split('/')[-2]
            relay.mode = 'observe'
            time.sleep(2.5)  # the source honours the target's Retry-After (1 s) with 429 retry_later; a teacher retries later than that
            retried = lab.browser('retry', expect_status=[TEXT['succeeded']], screenshot='w390-4-retried')
            need(posts(retried['requests']) == [(f'/api/p03/handoffs/{op}/save', 200)], 'retry_posts')
            operations.append(op)
            need(receiver.count() == 3, 'retry_duplicated_resource')
            report['scenarios'].append({'name': 'failure_recovery', 'width': 390, 'operation': op, 'first_save_status': 503, 'error_shown': result['view']['error'], 'after_retry': retried['view']['status'],
                                        'relay_events': [e for e in relay.events if e.get('synthetic')]})
            checks.append('390: a commit refused by the target (503 target_unavailable) leaves the operation unknown with a retry; retry resumes the same operation and succeeds with one copy')
            lab.browser('close_modal')
            # 430: target-side delete -> recycled; restore -> succeeded; delete + purge (target clock alone moved) -> deleted.
            stage = 'recycle_states'
            lab.browser('login', account=lab.accounts['teacher']['username'], password=lab.accounts['teacher']['password'], viewport={'width': 430, 'height': 932})
            lab.browser('open')
            result = lab.browser('handoff', index=3, title='小组合作分工卡', screenshots='w430')
            op = freeze_and_save(result['requests'])
            need(receiver.call('delete', operation_id=op).get('ok') is True, 'target_delete_failed')
            recycled = lab.browser('refresh', expect_status=[TEXT['recycled']], screenshot='w430-4-recycled')
            need('回收站保留至' in recycled['view']['fields'] and not recycled['view']['retry_visible'], 'recycled_view')
            need(receiver.call('restore', operation_id=op).get('ok') is True, 'target_restore_failed')
            restored = lab.browser('refresh', expect_status=[TEXT['succeeded']])
            need(receiver.call('delete', operation_id=op).get('ok') is True, 'second_delete_failed')
            lab.browser('refresh', expect_status=[TEXT['recycled']])
            clocks.paused = True
            clocks.target(int(time.time()) + 31 * DAY)  # only the target is moved so its own recycle window ends; the purge is its own action
            purged = receiver.call('purge')
            clocks.target(int(time.time()))
            clocks.paused = False
            need(purged.get('ok') is True and purged.get('purged') == 1, 'purge_failed')
            gone = lab.browser('refresh', expect_status=[TEXT['deleted']], screenshot='w430-5-deleted')
            need(not gone['view']['retry_visible'] and gone['view']['refresh_visible'], 'deleted_view')
            report['scenarios'].append({'name': 'recycle_states', 'width': 430, 'operation': op, 'sequence': ['succeeded', 'recycled', 'succeeded', 'recycled', 'deleted'],
                                        'recycled_fields': list(recycled['view']['fields']), 'skew': 'target moved 31 days ahead only for its purge, then back to wall time'})
            checks.append('430: target delete -> recycled (recycle_until shown, no retry); restore -> succeeded; delete + purge -> deleted tombstone; the source never writes or re-sends')
            lab.browser('close_modal')
            # Eligibility: the shadow account is refused by the practice server before anything is selected or sent.
            stage = 'eligibility_shadow'
            lab.browser('session', token=lab.token_for('shadow'), user_id=lab.accounts['shadow']['id'], viewport={'width': 360, 'height': 740})
            shadow = lab.browser('open', screenshot='w360-eligibility-0-conversation')
            need(shadow['entries'] == len(ANSWERS), 'shadow_entries')
            refused = lab.browser('entry_error', index=0, screenshot='w360-eligibility-1-refused')
            need(refused['message'] == TEXT['subject_not_eligible'] and not refused['confirm_visible'] and not refused['selection_visible'] and not posts(refused['requests']), 'shadow_not_refused')
            report['scenarios'].append({'name': 'eligibility_shadow', 'width': 360, 'message': refused['message'], 'posts': []})
            checks.append('shadow account (uuid_source=sso): the entry refuses before selection (subject_not_eligible); nothing is sent')
            # Eligibility: a practice teacher without an Identity link is refused by Identity at issue; no operation exists there.
            stage = 'eligibility_unlinked'
            lab.browser('login', account=lab.accounts['unlinked']['username'], password=lab.accounts['unlinked']['password'], viewport={'width': 390, 'height': 844})
            lab.browser('open')
            result = lab.browser('handoff', index=0, title='未关联账号的尝试', expect_status=[TEXT['unknown']], screenshots='w390-unlinked')
            need(result['view']['error'] == TEXT['source_link_unavailable'], 'unlinked_error_' + str(result['view']['error']))
            p = posts(result['requests'])
            need(len(p) == 2 and p[1][1] in (403, 409), 'unlinked_posts_' + str(p))  # Identity's own status for the refusal is passed through unchanged
            need(receiver.count() == 4 and receiver.count(active=True) == 3, 'unlinked_reached_target')  # 4 copies so far, one purged tombstone
            report['scenarios'].append({'name': 'eligibility_unlinked', 'width': 390, 'error_shown': result['view']['error'], 'save_status': p[1][1]})
            checks.append('unlinked teacher: Identity refuses the issue (source_link_unavailable); the target never sees it; the local operation stays unknown with the fixed code')
            lab.browser('close_modal')
            stage = 'ledger'
            rows = lab.ledger()
            by_status = {}
            for row in rows:
                by_status[row['status']] = by_status.get(row['status'], 0) + 1
            need(len(rows) == 5 and by_status.get('succeeded') == 3 and by_status.get('deleted') == 1 and by_status.get('unknown') == 1, 'ledger_' + json.dumps(by_status))
            need(all(row['owner'] in ('101', '103') for row in rows), 'ledger_owner')
            report['ledger'] = {'operations': len(rows), 'by_status': by_status, 'owners': sorted({row['owner'] for row in rows})}
            report['operations'] = len(operations)
            facts = lab.browser('facts')
            need(not facts['external'] or set(facts['external']) <= {lab.web_url}, 'browser_left_loopback')
            need(relay.error is None, 'relay_error')
            report['page_errors'] = facts['errors']
            report['passed'] = True
        except Exception as e:
            safe = str(e) if isinstance(e, RuntimeError) and re.fullmatch(r'[A-Za-z0-9_\[\]" ,:{}]+', str(e)) else type(e).__name__
            report['failure'] = {'stage': stage, 'code': safe[:160]}
            if os.environ.get('P03_ENTRY_DEBUG'):
                import traceback
                traceback.print_exc()  # laboratory diagnostics only; the overlay copies stderr into go-tests.log
        finally:
            clocks.stop.set()
            if lab:
                try:
                    lab.browser('stop', timeout=30)
                except Exception:
                    pass
                lab.close()
            if relay:
                relay.close()
                report['transport_events'] = relay.events
            if receiver:
                try:
                    receiver.stop()
                    receiver.check_logs()
                except Exception:
                    report['passed'] = False
                    report['cleanup_or_log_check_failed'] = True
            if lab:
                try:
                    lab.check_logs()
                except Exception as e:
                    report['passed'] = False
                    report['log_check_failed'] = str(e)
            report['checks'] = checks
            Path(evidence, c['case'] + '.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    return report


def smoke():
    """Default-off phase only against a disposable MySQL container started here; no peers."""
    root = Path(__file__).resolve().parents[2]
    name = 'p03-entry-smoke-' + uuid.uuid4().hex[:8]
    password = secrets.token_urlsafe(24)
    evidence = root / 'storage/private/p03-handoff-validation/entry-smoke'
    evidence.mkdir(parents=True, exist_ok=True)
    subprocess.run(['docker', 'run', '-d', '--pull=never', '--name', name, '--label', 'pkuailab.task=p03-entry', '-p', '127.0.0.1::3306', '-e', 'MYSQL_ROOT_PASSWORD', 'mysql:8.0'],
                   env={**os.environ, 'MYSQL_ROOT_PASSWORD': password}, check=True, stdout=subprocess.DEVNULL)
    try:
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            if subprocess.run(['docker', 'exec', name, 'mysqladmin', '--host=127.0.0.1', 'ping', '--silent'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                time.sleep(1.5)
                if subprocess.run(['docker', 'exec', name, 'mysqladmin', '--host=127.0.0.1', 'ping', '--silent'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                    break
            time.sleep(.3)
        port = int(subprocess.run(['docker', 'port', name, '3306/tcp'], text=True, capture_output=True).stdout.strip().rsplit(':', 1)[1])
        c = {'case': 'smoke', 'practice_root': str(root), 'mysql': {'host': '127.0.0.1', 'port': port, 'user': 'root', 'password': password}}
        report = run_case(c, evidence, smoke=True)
        print(json.dumps({'case': 'smoke', 'passed': report['passed'], 'failure': report.get('failure')}, ensure_ascii=False))
        return 0 if report['passed'] else 1
    finally:
        subprocess.run(['docker', 'rm', '--force', '--volumes', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main():
    if '--smoke' in sys.argv[1:]:
        return smoke()
    c = json.load(sys.stdin)
    report = run_case(c, Path(c['evidence']))
    print(json.dumps({'case': c['case'], 'passed': report['passed'], 'operations': report.get('operations', 0)}))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    sys.exit(main())

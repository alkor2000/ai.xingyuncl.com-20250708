"""Isolated acceptance for the P09 website-artifact source side.

Real components: this repository's backend (node src/server.js) and frontend (Vite), a disposable
mysql:8.0 built from the local schema copy (structure only) plus the P09 migration candidate applied by
knex, the restricted ledger role, and Chromium through dev/p09-lab/browser.cjs at desktop and three
phone widths. Synthetic components, listed separately in the evidence: the class (three accounts, none
real), the edu issuer and service client (laboratory HMAC keys), and the student session token — SSO
shadow accounts cannot password-log-in by design.

Two instances run side by side (separate databases, separate instance names, separate ports) so the
"same numeric project id on two practice sites" and "a grant of the other instance" cases are real.

No production data, credentials or network are touched. Everything the run creates is removed at the end.
"""
import base64
import hashlib
import hmac
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
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]
# The local development .env is not in git, so an isolated worktree has none: fall back to the main
# working copy's file. Only DB_USER/DB_PASSWORD/DB_NAME are read, and only to dump the local schema
# structure (no rows) from the practice-mysql container.
LOCAL_ENV = Path(os.environ.get('P09_LOCAL_ENV', '')) if os.environ.get('P09_LOCAL_ENV') else (
    ROOT / 'backend/.env' if (ROOT / 'backend/.env').exists() else Path('/home/hanying/ai-platform/backend/.env'))
EVIDENCE = ROOT / 'storage/private/p09-validation' / time.strftime('run-%Y%m%dT%H%M%SZ', time.gmtime())
MYSQL_IMAGE = 'mysql:8.0'
CONTENT = '<h1>校园节水网站</h1><p>先观察，再记录两杯水的变化。</p><p>每天同一时间量水位，记录一周。</p>'
CONTENT_V2 = CONTENT + '<p>第二稿：加入了每天的数据表。</p>'
WIDTHS = [(1280, 900, 'desktop'), (360, 740, 'w360'), (390, 844, 'w390'), (430, 932, 'w430')]
OWN = object()   # sentinel: "this instance's database" 


def need(condition, label):
    if not condition:
        raise RuntimeError(label)


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def dotenv(path):
    values = {}
    for line in Path(path).read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
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
catch(e){process.stdout.write(JSON.stringify({error:String(e.code||e.message).slice(0,120)}));process.exitCode=1;}finally{await knex.destroy();}})();"""
NODE_SEED = """const bcrypt=require('./backend/node_modules/bcryptjs');let s='';
process.stdin.on('data',b=>s+=b).on('end',()=>{const c=JSON.parse(s);
process.stdout.write(JSON.stringify(Object.fromEntries(Object.entries(c.passwords).map(([k,v])=>[k,bcrypt.hashSync(v,10)]))));});"""
NODE_JWT = """const jwt=require('./backend/node_modules/jsonwebtoken');let s='';
process.stdin.on('data',b=>s+=b).on('end',()=>{const c=JSON.parse(s);
process.stdout.write(jwt.sign({userId:c.userId,email:null,username:c.username,role:'user',type:'access',jti:c.jti},c.secret,{expiresIn:'2h',issuer:'ai-platform',audience:'ai-platform-users'}));});"""
NODE_GRANTS = """const {signGrant}=require('./backend/src/services/websiteArtifact/taskGrant');let s='';
process.stdin.on('data',b=>s+=b).on('end',()=>{const c=JSON.parse(s);
process.stdout.write(JSON.stringify(c.grants.map(g=>signGrant({secret:c.secret,...g}))));});"""


def node(script, payload, timeout=180):
    process = subprocess.run(['node', '-e', script], cwd=ROOT, input=json.dumps(payload), text=True,
                             capture_output=True, timeout=timeout)
    if process.returncode:
        # Pick the informative line (an error code or message), not Node's trailing version banner.
        lines = [line.strip() for line in process.stderr.strip().splitlines() if line.strip()]
        picked = next((line for line in lines if re.search(r"code:|Error|error", line)), lines[-1] if lines else 'unknown')
        if os.environ.get('P09_LAB_DEBUG'):
            sys.stderr.write('\n'.join(lines[-12:]) + '\n')
        raise RuntimeError('node_helper_failed_' + re.sub(r'[^A-Za-z0-9_]', '', picked)[:48])
    text = process.stdout.strip()
    start = min([i for i in (text.find('{'), text.find('[')) if i >= 0], default=-1)
    return json.loads(text[start:]) if start >= 0 else text


class Instance:
    """One practice deployment: its own database, instance name, backend process and preview listener."""

    def __init__(self, name, mysql, scratch, issuer_secret, client_secret, jwt_secret):
        self.name = name
        self.mysql = mysql
        self.scratch = Path(scratch)
        self.database = 'p09_' + name.replace('-', '_') + '_' + secrets.token_hex(3)
        self.app_user = 'p09_app_' + secrets.token_hex(3)
        self.app_password = secrets.token_urlsafe(24)
        self.ledger_user = 'p09_led_' + secrets.token_hex(3)
        self.ledger_password = secrets.token_urlsafe(24)
        self.issuer_secret = issuer_secret
        self.client_secret = client_secret
        self.jwt_secret = jwt_secret
        self.api_port = free_port()
        self.preview_port = free_port()
        self.preview_origin = f'http://preview-{name}.localhost:{self.preview_port}'
        self.storage = self.scratch / f'storage-{name}'
        (self.storage / 'uploads').mkdir(parents=True, exist_ok=True)
        self.process = None
        self.log_handle = None
        self.accounts = {}
        self.projects = {}

    # ---- database -------------------------------------------------------------------------------
    # `database` omitted selects this instance's database; database=None connects to the server itself
    # (used to create the database and the roles before it exists).
    def sql(self, queries, database=OWN, user=None, password=None):
        return node(NODE_SQL, dict(self.mysql, database=self.database if database is OWN else database,
                                   user=user or self.mysql['user'], password=password or self.mysql['password'],
                                   queries=[q if isinstance(q, dict) else {'sql': q} for q in queries]))

    def build_database(self, preimage, knex_rows, facts):
        self.sql([f'CREATE DATABASE `{self.database}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'], database=None)
        self.sql([preimage, knex_rows])
        self.sql([f"CREATE USER '{self.app_user}'@'%' IDENTIFIED BY '{self.app_password}'",
                  f"GRANT ALL PRIVILEGES ON `{self.database}`.* TO '{self.app_user}'@'%'",
                  f"CREATE USER '{self.ledger_user}'@'%' IDENTIFIED BY '{self.ledger_password}'"], database=None)
        migrations = self.scratch / f'migrations-{self.name}'
        shutil.copytree(ROOT / 'backend/migrations', migrations)
        candidate = ROOT / 'backend/migrations-candidates/p09/20260922_001_p09_website_artifacts.js'
        portable = candidate.read_text().replace(
            "require('../../src/services/websiteArtifact/store')",
            'require(' + json.dumps(str(ROOT / 'backend/src/services/websiteArtifact/store')) + ')')
        (migrations / candidate.name).write_text(portable)
        applied = node(NODE_KNEX, {'port': self.mysql['port'], 'user': self.app_user, 'password': self.app_password,
                                   'database': self.database, 'directory': str(migrations)})
        need(applied.get('files') == [candidate.name], 'ledger_candidate_not_applied')
        grants = node("const {restrictedRoleGrants}=require('./backend/src/services/websiteArtifact/store');"
                      "let s='';process.stdin.on('data',b=>s+=b).on('end',()=>{const c=JSON.parse(s);"
                      "process.stdout.write(JSON.stringify(restrictedRoleGrants(c)));});",
                      {'database': self.database, 'user': self.ledger_user, 'host': '%',
                       'sourceTables': ['users', 'html_projects', 'html_pages']})
        self.sql(grants, database=None)
        tables = self.sql([f"SELECT table_name AS t FROM information_schema.tables WHERE table_schema='{self.database}' AND table_name LIKE 'p09\\\\_%' ORDER BY 1"])[0]
        need(len(tables) == 8, 'ledger_tables_missing')
        facts[self.name] = {'database_tables': len(self.sql([f"SELECT table_name FROM information_schema.tables WHERE table_schema='{self.database}'"])[0]),
                            'p09_tables': [row['t'] for row in tables], 'ledger_grants': len(grants),
                            'migration': candidate.name, 'migrator': 'application account (ALL PRIVILEGES on the isolated database)'}

    def seed(self, accounts, projects):
        hashes = node(NODE_SEED, {'passwords': {key: value['password'] for key, value in accounts.items() if value.get('password')}})
        rows = []
        for key, account in accounts.items():
            rows.append({'sql': 'INSERT INTO users(id,uuid,uuid_source,username,password_hash,role,status,email_verified) VALUES(?,?,?,?,?,?,?,1)',
                         'params': [account['id'], account['uuid'], account['uuid_source'], account['username'],
                                    hashes.get(key, 'not-a-password'), 'user', 'active']})
        for project in projects:
            rows.append({'sql': 'INSERT INTO html_projects(id,user_id,name,type,is_default,sort_order) VALUES(?,?,?,?,?,0)',
                         'params': [project['id'], project['user_id'], project['name'], 'folder', 1 if project.get('default') else 0]})
            for page in project.get('pages', []):
                rows.append({'sql': '''INSERT INTO html_pages(id,project_id,user_id,title,slug,html_content,css_content,js_content,
                             compiled_content,version,is_published,created_at,updated_at) VALUES(?,?,?,?,?,?,'','',?,1,?,FROM_UNIXTIME(?),FROM_UNIXTIME(?))''',
                             'params': [page['id'], project['id'], project['user_id'], page['title'], page['slug'],
                                        page['html'], page['html'], 1 if page.get('published') else 0,
                                        page.get('created', page.get('at', int(time.time()) - 3600)),
                                        page.get('at', int(time.time()) - 3600)]})
        self.sql(rows)
        self.accounts = accounts
        self.projects = {project['id']: project for project in projects}

    # ---- processes ------------------------------------------------------------------------------
    def lab_file(self, enabled=True):
        path = self.scratch / f'lab-{self.name}.json'
        path.write_text(json.dumps({
            'source_instance': self.name,
            'preview_origin': self.preview_origin,
            'issuers': [{'issuer': 'edu', 'key_id': 'k1', 'secret': self.issuer_secret,
                         'purposes': ['website_artifact_link', 'website_artifact_revision', 'website_artifact_review']}],
            'integration_clients': [{'client_key': 'edu', 'key_id': 'k1', 'secret': self.client_secret,
                                     'actions': ['artifacts:read', 'artifacts:review', 'artifacts:freeze'],
                                     'school_refs': ['school-1']}]
        }))
        return path

    def env(self, enabled):
        env = {**os.environ, 'NODE_ENV': 'development', 'PORT': str(self.api_port),
               'DB_HOST': '127.0.0.1', 'DB_PORT': str(self.mysql['port']), 'DB_USER': self.app_user,
               'DB_PASSWORD': self.app_password, 'DB_NAME': self.database,
               'REDIS_HOST': '127.0.0.1', 'REDIS_PORT': str(free_port()), 'REDIS_PASSWORD': '',
               'JWT_ACCESS_SECRET': self.jwt_secret, 'JWT_REFRESH_SECRET': secrets.token_urlsafe(48),
               'STORAGE_PATH': str(self.storage), 'IDENTITY_ENABLED': 'false'}
        for key in [k for k in env if k.startswith('P09_')]:
            del env[key]
        for key in dotenv(LOCAL_ENV):
            if key.startswith('IDENTITY_') and key not in env:
                env[key] = ''
        if enabled:
            env.update({'P09_WEBSITE_ARTIFACTS_ENABLED': 'true', 'P09_LAB': str(self.lab_file()),
                        'P09_DB_USER': self.ledger_user, 'P09_DB_PASSWORD': self.ledger_password,
                        'P09_PREVIEW_BIND': '127.0.0.1', 'P09_PREVIEW_FRAME_ANCESTORS': "'self' http://localhost:*"})
        return env

    def start(self, enabled):
        log = self.scratch / f'backend-{self.name}-{"on" if enabled else "off"}.log'
        self.log_handle = log.open('a')
        self.process = subprocess.Popen(['node', 'src/server.js'], cwd=ROOT / 'backend', env=self.env(enabled),
                                        stdin=subprocess.DEVNULL, stdout=self.log_handle, stderr=subprocess.STDOUT)
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                self.log_handle.close()
                tail = log.read_text(errors='replace').splitlines()[-10:]
                for word in self.secrets():
                    tail = [line.replace(word, '<redacted>') for line in tail]
                sys.stderr.write('\n'.join(tail) + '\n')
                need(False, f'backend_{self.name}_exited_{self.process.returncode}')
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{self.api_port}/health', timeout=3) as response:
                    if response.status == 200:
                        return
            except Exception:
                time.sleep(.5)
        need(False, f'backend_{self.name}_start_timeout')

    def stop(self):
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        if self.log_handle:
            self.log_handle.close()
        self.process = None

    def secrets(self):
        return [value for value in [self.app_password, self.ledger_password, self.issuer_secret, self.client_secret,
                                    self.jwt_secret, self.mysql.get('password')] if value]

    # ---- HTTP -----------------------------------------------------------------------------------
    def call(self, method, path, body=None, headers=None, port=None):
        url = f'http://127.0.0.1:{port or self.api_port}{path}'
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(url, data=data, method=method,
                                         headers={**({'Content-Type': 'application/json'} if data else {}), **(headers or {})})
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                return response.status, json.loads(response.read().decode() or '{}')
        except urllib.error.HTTPError as error:
            raw = error.read().decode()
            try:
                return error.code, json.loads(raw or '{}')
            except json.JSONDecodeError:
                return error.code, {'raw': raw[:200]}

    def grant(self, **payload):
        now = int(time.time())
        base = {'schema_version': 1, 'issuer': 'edu', 'key_id': 'k1', 'grant_id': str(uuid.uuid4()),
                'audience': self.name, 'school_ref': 'school-1', 'lesson_ref': None,
                'issued_at': now, 'expires_at': now + 240}
        return node(NODE_GRANTS, {'secret': self.issuer_secret, 'grants': [{**base, **payload}]})[0]

    # edu signs its server-side reads exactly as the provider verifies them.
    def client_headers(self, method, path, query='', body=None):
        timestamp = str(int(time.time()))
        nonce = uuid.uuid4().hex
        # The provider re-serialises the parsed body with JSON.stringify: no spaces, insertion order.
        payload = '' if body is None else json.dumps(body, separators=(',', ':'), ensure_ascii=False)
        canonical = f"{method}\n{path}\n{query}\n{hashlib.sha256(payload.encode()).hexdigest()}"
        signature = hashlib.sha256(
            f"{self.client_secret}\n{timestamp}\n{nonce}\n{hashlib.sha256(canonical.encode()).hexdigest()}".encode()).hexdigest()
        return {'x-p09-client': 'edu', 'x-p09-key-id': 'k1', 'x-p09-timestamp': timestamp,
                'x-p09-nonce': nonce, 'x-p09-signature': signature}

    def edu_get(self, path, query=''):
        full = f'/api/integrations/edu/website-artifacts{path}'
        # The provider signs over the query sorted by name, so the signature does not depend on the
        # order a client happens to send the parameters in.
        canonical_query = '&'.join(sorted(part for part in query.split('&') if part))
        return self.call('GET', f'{full}?{query}' if query else full,
                         headers=self.client_headers('GET', full, canonical_query))

    def edu_post(self, path, body, headers=None):
        full = f'/api/integrations/edu/website-artifacts{path}'
        return self.call('POST', full, body=body,
                         headers={**self.client_headers('POST', full, '', body), **(headers or {})})

    def token(self, key):
        account = self.accounts[key]
        return node(NODE_JWT, {'userId': account['id'], 'username': account['username'],
                               'jti': uuid.uuid4().hex, 'secret': self.jwt_secret})


class Web:
    """The real frontend on a Vite dev server proxied to one instance (reuses dev/p03-entry-web.mjs)."""

    def __init__(self, api_port, scratch):
        self.port = free_port()
        self.process = subprocess.Popen(['node', 'dev/p03-entry-web.mjs'], cwd=ROOT, stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=(Path(scratch) / 'web.log').open('w'), text=True)
        self.process.stdin.write(json.dumps({'port': self.port, 'api': f'http://127.0.0.1:{api_port}'}) + '\n')
        self.process.stdin.flush()
        need(select.select([self.process.stdout], [], [], 180)[0], 'web_start_timeout')
        ready = json.loads(self.process.stdout.readline() or '{}')
        need(ready.get('ready') is True, 'web_not_ready')
        self.url = ready['url']

    def close(self):
        if self.process and self.process.poll() is None:
            try:
                self.process.stdin.close()
                self.process.wait(timeout=20)
            except Exception:
                self.process.kill()


class Browser:
    def __init__(self, scratch, web_url, evidence):
        env = {**os.environ,
               'PLAYWRIGHT_MODULE': os.environ.get('PLAYWRIGHT_MODULE', '/home/hanying/feedback-sync-ws/tools/node_modules/playwright'),
               'TMPDIR': str(scratch)}
        libs = os.environ.get('P09_BROWSER_LIBS', '/home/hanying/feedback-sync-ws/tools/browser-libs/extracted/usr/lib/x86_64-linux-gnu')
        if Path(libs).is_dir():
            env['LD_LIBRARY_PATH'] = libs + (':' + env['LD_LIBRARY_PATH'] if env.get('LD_LIBRARY_PATH') else '')
        self.process = subprocess.Popen(['node', 'dev/p09-lab/browser.cjs'], cwd=ROOT, env=env, stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=(Path(scratch) / 'browser.log').open('w'), text=True)
        self.call('start', web=web_url, evidence=str(evidence))

    def call(self, command, timeout=180, **fields):
        self.process.stdin.write(json.dumps(dict(command=command, **fields)) + '\n')
        self.process.stdin.flush()
        need(select.select([self.process.stdout], [], [], timeout)[0], 'browser_timeout_' + command)
        line = self.process.stdout.readline()
        need(line, 'browser_worker_stopped')
        response = json.loads(line)
        if not response.get('ok'):
            code = re.sub(r'[^A-Za-z0-9_]', '_', str(response.get('code', 'failed')))[:90]
            sys.stderr.write(json.dumps({'browser_failure': command, 'code': code,
                                         'requests': response.get('requests')}, ensure_ascii=False)[:1500] + '\n')
            need(False, 'browser_' + command + '_' + code)
        return response

    def close(self):
        if self.process and self.process.poll() is None:
            try:
                self.call('stop', timeout=30)
            except Exception:
                pass
            try:
                self.process.stdin.close()
                self.process.wait(timeout=15)
            except Exception:
                self.process.kill()


def accounts_for(prefix):
    return {
        'student_a': {'id': 201, 'uuid': f'{prefix}-uuid-a', 'uuid_source': 'sso', 'username': f'{prefix}_s_a', 'password': None},
        'student_b': {'id': 202, 'uuid': f'{prefix}-uuid-b', 'uuid_source': 'sso', 'username': f'{prefix}_s_b', 'password': None},
        'local_user': {'id': 203, 'uuid': str(uuid.uuid4()), 'uuid_source': 'system', 'username': f'{prefix}_local',
                       'password': secrets.token_urlsafe(12)}
    }


def projects_for():
    at = int(time.time()) - 7200
    # Pages carry a creation time and a later save time: that pair is what an effective save means on
    # the source side, and it is exactly what the editor's auto-created starter page does not have.
    return [
        {'id': 3, 'user_id': 201, 'name': '校园节水网站', 'pages': [
            {'id': 7, 'title': '首页', 'slug': 'home', 'html': CONTENT, 'created': at - 600, 'at': at},
            {'id': 8, 'title': '数据页', 'slug': 'data', 'html': CONTENT, 'created': at - 600, 'at': at}]},
        {'id': 4, 'user_id': 201, 'name': '我的默认项目', 'default': True, 'pages': []},
        {'id': 5, 'user_id': 201, 'name': '去年的家乡介绍', 'pages': [
            {'id': 9, 'title': '家乡', 'slug': 'hometown', 'html': CONTENT, 'created': at - 86400 * 200 - 600,
             'at': at - 86400 * 200}]},
        {'id': 6, 'user_id': 202, 'name': '同学乙的作品', 'pages': [
            {'id': 10, 'title': '首页', 'slug': 'home', 'html': CONTENT, 'created': at - 600, 'at': at}]},
        {'id': 7, 'user_id': 201, 'name': '从未打开过的空项目', 'pages': []}
    ]


def main():
    os.umask(0o077)
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    report = {'status': 'failed', 'stage': 'setup', 'checks': [], 'scenarios': [], 'widths': [w[2] for w in WIDTHS],
              'real': ['backend node src/server.js (P09 runtime)', 'frontend Vite dev server', 'mysql:8.0 with the local schema pre-image',
                       'knex-applied P09 migration candidate + restricted ledger role', 'Chromium via Playwright'],
              'synthetic': ['three accounts (two SSO shadow students, one local account) — no real student',
                            'edu task-context issuer and service client (laboratory HMAC keys)',
                            'student session token (SSO accounts cannot password-log-in by design)',
                            'two practice instances in one MySQL container, separate databases and instance names'],
              'not_covered': ['real teacher device acceptance', 'real edu implementation', 'production TLS, hostnames and deployment configuration']}
    container = 'p09-lab-' + uuid.uuid4().hex[:8]
    root_password = secrets.token_urlsafe(24)
    instances, web, browser = [], None, None
    # The scratch directory holds the laboratory configuration (issuer keys, database passwords) and the
    # process logs. It is removed in the same finally block, after the logs are copied out sanitized.
    scratch = tempfile.mkdtemp(prefix='p09-lab-')
    try:
        if True:
            report['stage'] = 'database'
            subprocess.run(['docker', 'image', 'inspect', MYSQL_IMAGE], check=True, stdout=subprocess.DEVNULL, timeout=15)
            subprocess.run(['docker', 'run', '-d', '--pull=never', '--name', container, '--label', 'pkuailab.task=p09-lab',
                            '-p', '127.0.0.1::3306', '-e', 'MYSQL_ROOT_PASSWORD', MYSQL_IMAGE],
                           env={**os.environ, 'MYSQL_ROOT_PASSWORD': root_password}, check=True, stdout=subprocess.DEVNULL, timeout=60)
            deadline = time.monotonic() + 180
            while time.monotonic() < deadline:
                probe = subprocess.run(['docker', 'exec', container, 'mysqladmin', '--host=127.0.0.1', 'ping', '--silent'],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if probe.returncode == 0:
                    time.sleep(1.5)
                    if subprocess.run(['docker', 'exec', container, 'mysqladmin', '--host=127.0.0.1', 'ping', '--silent'],
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                        break
                time.sleep(.4)
            else:
                need(False, 'database_start_timeout')
            port = int(subprocess.run(['docker', 'port', container, '3306/tcp'], text=True, capture_output=True).stdout.strip().rsplit(':', 1)[1])
            mysql = {'host': '127.0.0.1', 'port': port, 'user': 'root', 'password': root_password}

            local = dotenv(LOCAL_ENV)
            dump = ['docker', 'exec', '-e', 'MYSQL_PWD=' + local['DB_PASSWORD'], 'practice-mysql', 'mysqldump',
                    '-u' + local['DB_USER'], '--skip-triggers', '--set-gtid-purged=OFF']
            structure = subprocess.run(dump + ['--no-data', '--skip-add-drop-table', local['DB_NAME']], capture_output=True, timeout=300)
            rows = subprocess.run(dump + ['--no-create-info', local['DB_NAME'], 'knex_migrations', 'knex_migrations_lock'],
                                  capture_output=True, timeout=120)
            need(structure.returncode == 0 and rows.returncode == 0, 'local_schema_dump_failed')
            preimage = re.sub(rb'-- (Dump completed on|Host:|Server version|MySQL dump).*', b'',
                              re.sub(rb'AUTO_INCREMENT=\d+ ', b'', structure.stdout)).decode()
            need('p09_' not in preimage, 'preimage_already_has_p09_tables')

            issuer_secret = secrets.token_urlsafe(40)
            client_secret = secrets.token_urlsafe(40)
            facts = {}
            for name in ('practice-lab-a', 'practice-lab-b'):
                instance = Instance(name, mysql, scratch, issuer_secret, client_secret, secrets.token_urlsafe(48))
                instance.build_database(preimage, rows.stdout.decode(), facts)
                instance.seed(accounts_for(name.replace('practice-lab-', 'edu')), projects_for())
                instances.append(instance)
            report['databases'] = facts
            primary, secondary = instances

            # ---- phase A: the same server with the switch unset ------------------------------------
            report['stage'] = 'default_off'
            primary.start(enabled=False)
            status, capability = primary.call('GET', '/api/p09/website-artifacts/capability',
                                              headers={'Authorization': 'Bearer ' + primary.token('student_a')})
            need(status == 200 and capability.get('available') is False, 'capability_not_closed')
            status, refused = primary.call('POST', '/api/p09/website-artifacts/links',
                                           body={'schema_version': 1, 'project_id': 3, 'entry_page_id': 7},
                                           headers={'Authorization': 'Bearer ' + primary.token('student_a'),
                                                    'Idempotency-Key': str(uuid.uuid4())})
            need(status == 503 and refused['error']['code'] == 'website_artifacts_disabled', 'link_not_refused_while_disabled')
            status, edu_refused = primary.edu_get('/state', 'school_ref=school-1')
            need(status == 503 and edu_refused['error']['code'] == 'website_artifacts_disabled', 'edu_read_not_refused_while_disabled')
            ledger_rows = primary.sql(["SELECT COUNT(*) AS n FROM p09_links"])[0][0]['n']
            need(int(ledger_rows) == 0, 'ledger_touched_while_disabled')
            report['scenarios'].append({'name': 'default_off', 'capability': capability, 'link_status': 503,
                                        'edu_read_status': 503, 'ledger_rows': 0})
            report['checks'].append('default-off: the same server answers website_artifacts_disabled on both surfaces and never touches the ledger')
            primary.stop()

            # ---- phase B: enabled, real browser ---------------------------------------------------
            report['stage'] = 'enabled'
            for instance in instances:
                instance.start(enabled=True)
            web = Web(primary.api_port, scratch)
            browser = Browser(scratch, web.url, EVIDENCE)

            token_a = primary.token('student_a')
            token_local = primary.token('local_user')

            # 1. desktop: link the current project, entry page chosen explicitly
            report['stage'] = 'link_desktop'
            width, height, label = WIDTHS[0]
            opened = browser.call('open', viewport={'width': width, 'height': height}, token=token_a, user_id=201,
                                  project='校园节水网站', task_context=primary.grant(
                                      purpose='website_artifact_link', assignment_ref='assign-1',
                                      subject={'uuid': 'edua-uuid-a', 'cohort': 'student'}),
                                  screenshot=f'{label}-0-editor')
            # The context must be gone from the address bar (and it never was in the query string).
            need(opened['panel_visible'] and not opened['url_has_context'],
                 'panel_or_url_context_' + json.dumps({k: opened.get(k) for k in
                  ['panel_visible', 'url', 'link_button', 'no_context_hint']}, ensure_ascii=False))
            linked = browser.call('link', entry_label='首页', screenshot=f'{label}-1-linked')
            need(linked['error'] is None and '可预览' in (linked['state'] or ''), 'link_failed_' + str(linked['error']))
            posts = [(item['path'], item['status'], item['task_context']) for item in linked['requests'] if item['method'] == 'POST']
            need(len(posts) == 1 and posts[0][1] == 200 and posts[0][2] == 'present', 'unexpected_link_posts_' + str(posts))
            body = next(item['body'] for item in linked['requests'] if item['method'] == 'POST')
            need(sorted(body) == ['entry_page_id', 'project_id', 'schema_version'], 'link_body_keys_' + str(sorted(body)))
            report['scenarios'].append({'name': 'link_current_project', 'width': width, 'state': linked['state'],
                                        'posts': posts, 'body_keys': sorted(body)})
            report['checks'].append('desktop: the student links their own project with an explicitly chosen entry page; the request carries no assignment or student id, only the signed context header')

            # 2. edu reads the state it will project onto the class list
            report['stage'] = 'edu_state'
            status, state = primary.edu_get('/state', 'school_ref=school-1')
            need(status == 200 and len(state['items']) == 1, 'state_not_visible')
            item = state['items'][0]
            need(item['work_state'] == 'preview_ready' and item['has_effective_save'] and item['student_uuid'] == 'edua-uuid-a', 'state_shape')
            need(state['complete'] is True and state['watermark'] >= 2, 'state_completeness')
            need('校园节水</h1>' not in json.dumps(state, ensure_ascii=False), 'state_leaked_content')
            artifact_ref = item['artifact_ref']
            status, other_school = primary.edu_get('/state', 'school_ref=school-9')
            need(status == 404 and other_school['error']['code'] == 'school_not_provisioned', 'school_scope_not_enforced')
            report['scenarios'].append({'name': 'edu_state', 'items': len(state['items']), 'work_state': item['work_state'],
                                        'complete': state['complete'], 'watermark': state['watermark'],
                                        'other_school_status': 404})
            report['checks'].append('edu reads the current state for its own school only, with completeness and a watermark, and no page content')

            # 3. a teacher opens the private preview through a one-time handoff on the isolated origin
            report['stage'] = 'private_preview'
            status, session = primary.edu_post('/review-sessions', {'schema_version': 1},
                                               headers={'X-P09-Task-Context': primary.grant(
                                                   purpose='website_artifact_review', assignment_ref='assign-1',
                                                   reviewer={'ref': 'teacher-7'}, artifact_ref=artifact_ref)})
            need(status == 200, 'review_session_refused_' + json.dumps(session)[:120])
            # Opened at the real isolated hostname (*.localhost resolves to the loopback in the browser),
            # so the origin gate and the cookie scope are exercised exactly as deployed.
            open_url = session['session']['open_url']
            need(open_url.startswith(primary.preview_origin), 'preview_not_on_isolated_origin')
            reviewed = browser.call('review', open_url=open_url, contains=['校园节水'], screenshot='teacher-1-private-preview')
            need(reviewed['status'] == 200 and reviewed['contains'] == [True], 'preview_not_rendered')
            need('sandbox allow-scripts' in (reviewed['csp'] or ''), 'preview_not_sandboxed')
            need(reviewed['probe'].get('cookie') in ('', None) or 'blocked' in str(reviewed['probe'].get('cookie')), 'student_script_read_cookie')
            forwarded = browser.call('review', open_url=open_url, contains=['校园节水'])
            need(forwarded['status'] != 200 and forwarded['contains'] == [False], 'forwarded_link_still_worked')
            report['scenarios'].append({'name': 'private_preview', 'status': reviewed['status'], 'csp': reviewed['csp'],
                                        'script_cookie_probe': reviewed['probe'], 'forwarded_status': forwarded['status'],
                                        'origin': primary.preview_origin})
            report['checks'].append('an approved teacher opens the unpublished work through a one-time handoff on the isolated origin (sandboxed, no cookie access); the forwarded link is inert')

            # 4. 360: freeze a fixed review version, twice with one click each — idempotent per key
            report['stage'] = 'freeze'
            width, height, label = WIDTHS[1]
            browser.call('open', viewport={'width': width, 'height': height}, token=token_a, user_id=201,
                         project='校园节水网站', screenshot=f'{label}-0-editor')
            frozen = browser.call('act', testid='p09-freeze', double=True, screenshot=f'{label}-1-frozen')
            need(frozen['error'] is None, 'freeze_failed_' + str(frozen['error']))
            revisions = primary.sql(['SELECT revision_no FROM p09_revisions ORDER BY revision_no'])[0]
            need(len(revisions) == 1, 'double_click_created_' + str(len(revisions)))
            facts_after = browser.call('facts')
            report['scenarios'].append({'name': 'freeze_double_click', 'width': width, 'revisions': len(revisions),
                                        'fields': facts_after['fields']})
            report['checks'].append('360: a double click on 生成评阅版本 produces exactly one fixed revision')

            # 5. the fixed revision keeps its bytes while the student rewrites the page
            report['stage'] = 'revision_immutable'
            status, revision_state = primary.edu_get('/state', 'school_ref=school-1')
            revision_ref = revision_state['items'][0]['revisions'][0]['revision_ref']
            primary.sql([{'sql': 'UPDATE html_pages SET html_content=?, compiled_content=?, updated_at=NOW() WHERE id=7',
                          'params': [CONTENT_V2, CONTENT_V2]}])
            width, height, label = WIDTHS[2]
            browser.call('open', viewport={'width': width, 'height': height}, token=token_a, user_id=201, project='校园节水网站')
            browser.call('act', testid='p09-freeze', screenshot=f'{label}-1-second-revision')
            status, fixed_session = primary.edu_post('/review-sessions', {'schema_version': 1},
                                                     headers={'X-P09-Task-Context': primary.grant(
                                                         purpose='website_artifact_review', assignment_ref='assign-1',
                                                         reviewer={'ref': 'teacher-7'}, artifact_ref=artifact_ref,
                                                         revision_ref=revision_ref)})
            need(status == 200, 'fixed_review_session_refused')
            fixed_url = fixed_session['session']['open_url']
            old_view = browser.call('review', open_url=fixed_url, contains=['第二稿', '校园节水'], screenshot='teacher-2-fixed-revision')
            need(old_view['contains'] == [False, True], 'fixed_revision_changed')
            report['scenarios'].append({'name': 'revision_immutable', 'revision_ref_prefix': revision_ref[:8],
                                        'shows_new_draft': old_view['contains'][0], 'shows_frozen_bytes': old_view['contains'][1]})
            report['checks'].append('the first fixed revision still renders its own bytes after the student rewrote the page; a second revision is separate')

            # 6. back-linking an old project is refused while another work holds the assignment,
            #    and works for a second assignment
            report['stage'] = 'back_link'
            width, height, label = WIDTHS[3]
            browser.call('open', viewport={'width': width, 'height': height}, token=token_a, user_id=201,
                         project='去年的家乡介绍', task_context=primary.grant(
                             purpose='website_artifact_link', assignment_ref='assign-1',
                             subject={'uuid': 'edua-uuid-a', 'cohort': 'student'}), screenshot=f'{label}-0-old-project')
            clash = browser.call('link', entry_label='家乡', screenshot=f'{label}-1-refused')
            need(clash['error'] is not None, 'second_work_for_one_assignment_accepted')
            browser.call('open', viewport={'width': width, 'height': height}, token=token_a, user_id=201,
                         project='去年的家乡介绍', task_context=primary.grant(
                             purpose='website_artifact_link', assignment_ref='assign-2',
                             subject={'uuid': 'edua-uuid-a', 'cohort': 'student'}))
            back = browser.call('link', entry_label='家乡', screenshot=f'{label}-2-back-linked')
            need(back['error'] is None, 'back_link_failed_' + str(back['error']))
            report['scenarios'].append({'name': 'back_link_old_project', 'width': width,
                                        'same_assignment_refused': clash['error'], 'other_assignment_linked': back['state']})
            report['checks'].append('430: an older project can be back-linked to another assignment; a second work for the same assignment is refused')

            # 7. neither an untouched empty project nor the editor's auto-created starter page counts as work
            report['stage'] = 'empty_default'
            status, untouched = primary.call('POST', '/api/p09/website-artifacts/links',
                                             body={'schema_version': 1, 'project_id': 7, 'entry_page_id': 1},
                                             headers={'Authorization': 'Bearer ' + token_a, 'Idempotency-Key': str(uuid.uuid4()),
                                                      'X-P09-Task-Context': primary.grant(
                                                          purpose='website_artifact_link', assignment_ref='assign-7',
                                                          subject={'uuid': 'edua-uuid-a', 'cohort': 'student'})})
            need(status == 409 and untouched.get('error', {}).get('code') == 'project_not_ready',
                 'untouched_project_linked_' + str(status) + '_' + str(untouched.get('error', {}).get('code')))
            # The default project was opened by the editor during this run, so it now holds exactly the
            # blank starter page the platform writes by itself.
            starter = primary.sql(['SELECT id, created_at, updated_at, CHAR_LENGTH(html_content) AS n FROM html_pages WHERE project_id=4'])[0]
            need(len(starter) >= 1, 'starter_page_missing')
            status, default_link = primary.call('POST', '/api/p09/website-artifacts/links',
                                                body={'schema_version': 1, 'project_id': 4, 'entry_page_id': int(starter[0]['id'])},
                                                headers={'Authorization': 'Bearer ' + token_a, 'Idempotency-Key': str(uuid.uuid4()),
                                                         'X-P09-Task-Context': primary.grant(
                                                             purpose='website_artifact_link', assignment_ref='assign-3',
                                                             subject={'uuid': 'edua-uuid-a', 'cohort': 'student'})})
            need(status == 200, 'default_project_link_' + str(status))
            need(default_link['link']['work_state'] == 'linked' and default_link['link']['has_effective_save'] is False,
                 'starter_page_counted_as_started_' + str(default_link['link']['work_state']))
            need(default_link['link']['saved_at'] is None, 'starter_page_reported_a_save')
            report['scenarios'].append({'name': 'empty_default_project', 'untouched_status': status and 409,
                                        'untouched_code': untouched['error']['code'],
                                        'starter_pages': len(starter), 'starter_page_state': default_link['link']['work_state'],
                                        'starter_has_effective_save': default_link['link']['has_effective_save']})
            report['checks'].append('a never-opened empty project cannot be linked at all, and the blank starter page the editor writes on open links but stays 未开始 (has_effective_save=false)')

            # 8. refusals: another student's project, a non-SSO account, a forged and a foreign-instance context
            report['stage'] = 'refusals'
            refusals = {}
            status, other_project = primary.call('POST', '/api/p09/website-artifacts/links',
                                                 body={'schema_version': 1, 'project_id': 6, 'entry_page_id': 10},
                                                 headers={'Authorization': 'Bearer ' + token_a, 'Idempotency-Key': str(uuid.uuid4()),
                                                          'X-P09-Task-Context': primary.grant(
                                                              purpose='website_artifact_link', assignment_ref='assign-4',
                                                              subject={'uuid': 'edua-uuid-a', 'cohort': 'student'})})
            refusals['another_students_project'] = (status, other_project['error']['code'])
            status, local_refusal = primary.call('POST', '/api/p09/website-artifacts/links',
                                                 body={'schema_version': 1, 'project_id': 3, 'entry_page_id': 7},
                                                 headers={'Authorization': 'Bearer ' + token_local, 'Idempotency-Key': str(uuid.uuid4()),
                                                          'X-P09-Task-Context': primary.grant(
                                                              purpose='website_artifact_link', assignment_ref='assign-5',
                                                              subject={'uuid': primary.accounts['local_user']['uuid'], 'cohort': 'student'})})
            refusals['non_sso_account'] = (status, local_refusal['error']['code'])
            forged = primary.grant(purpose='website_artifact_link', assignment_ref='assign-6',
                                   subject={'uuid': 'edua-uuid-a', 'cohort': 'student'})
            forged = forged[:-4] + ('aaaa' if not forged.endswith('aaaa') else 'bbbb')
            status, forged_refusal = primary.call('POST', '/api/p09/website-artifacts/links',
                                                  body={'schema_version': 1, 'project_id': 5, 'entry_page_id': 9},
                                                  headers={'Authorization': 'Bearer ' + token_a, 'Idempotency-Key': str(uuid.uuid4()),
                                                           'X-P09-Task-Context': forged})
            refusals['forged_signature'] = (status, forged_refusal['error']['code'])
            # A context minted for the other instance, presented here.
            status, cross = primary.call('POST', '/api/p09/website-artifacts/links',
                                         body={'schema_version': 1, 'project_id': 3, 'entry_page_id': 7},
                                         headers={'Authorization': 'Bearer ' + token_a, 'Idempotency-Key': str(uuid.uuid4()),
                                                  'X-P09-Task-Context': secondary.grant(
                                                      purpose='website_artifact_link', assignment_ref='assign-1',
                                                      subject={'uuid': 'edub-uuid-a', 'cohort': 'student'})})
            refusals['other_instance_context'] = (status, cross['error']['code'])
            need(all(code for _, code in refusals.values()), 'refusal_missing')
            report['scenarios'].append({'name': 'refusals', **{key: list(value) for key, value in refusals.items()}})
            report['checks'].append('refused: another student\'s project, a non-SSO account, a tampered signature, and a context signed for the other instance')

            # 9. two instances, same numeric project id and same student number: references never collide
            report['stage'] = 'cross_instance'
            status, second_link = secondary.call('POST', '/api/p09/website-artifacts/links',
                                                 body={'schema_version': 1, 'project_id': 3, 'entry_page_id': 7},
                                                 headers={'Authorization': 'Bearer ' + secondary.token('student_a'),
                                                          'Idempotency-Key': str(uuid.uuid4()),
                                                          'X-P09-Task-Context': secondary.grant(
                                                              purpose='website_artifact_link', assignment_ref='assign-1',
                                                              subject={'uuid': 'edub-uuid-a', 'cohort': 'student'})})
            need(status == 200, 'second_instance_link_failed')
            status, second_state = secondary.edu_get('/state', 'school_ref=school-1')
            need(status == 200 and len(second_state['items']) == 1, 'second_instance_state')
            first_refs = {item['artifact_ref'], item['project_ref']}
            second_refs = {second_state['items'][0]['artifact_ref'], second_state['items'][0]['project_ref']}
            need(not (first_refs & second_refs), 'refs_collided_across_instances')
            need(second_state['items'][0]['source_instance'] == 'practice-lab-b', 'instance_not_bound')
            report['scenarios'].append({'name': 'cross_instance', 'same_local_project_id': 3,
                                        'distinct_refs': True, 'instances': ['practice-lab-a', 'practice-lab-b']})
            report['checks'].append('two instances holding the same numeric project id for the same student number produce disjoint references bound to their instance')

            # 10. incremental read: cursor resume, retry, out-of-order safety
            report['stage'] = 'incremental'
            status, first_page = primary.edu_get('/events', 'school_ref=school-1&limit=2')
            need(status == 200 and len(first_page['facts']) == 2, 'events_first_page')
            status, second_page = primary.edu_get('/events', f"school_ref=school-1&cursor={first_page['next_cursor']}&limit=50")
            status, retry_page = primary.edu_get('/events', f"school_ref=school-1&cursor={first_page['next_cursor']}&limit=50")
            need(second_page['facts'] == retry_page['facts'], 'retry_changed_facts')
            sequences = [fact['event_sequence'] for fact in first_page['facts'] + second_page['facts']]
            need(sequences == sorted(sequences) and len(set(sequences)) == len(sequences), 'sequence_not_monotonic')
            need(all('校园节水</h1>' not in json.dumps(fact, ensure_ascii=False) for fact in second_page['facts']), 'event_leaked_content')
            status, bad_cursor = primary.edu_get('/events', 'school_ref=school-1&cursor=not-a-cursor')
            need(status == 400 and bad_cursor['error']['code'] == 'cursor_invalid', 'cursor_not_validated')
            types = [fact['type'] for fact in first_page['facts'] + second_page['facts']]
            report['scenarios'].append({'name': 'incremental_read', 'types': types, 'sequences': sequences,
                                        'retry_identical': True, 'watermark': second_page['watermark']})
            report['checks'].append('incremental read: a cursor resumes in commit order, a retried page returns identical immutable facts, an invalid cursor is refused, and no page content is ever in a fact')

            # 11. unlink and source deletion stop access and are visible to edu
            report['stage'] = 'revocation'
            width, height, label = WIDTHS[0]
            browser.call('open', viewport={'width': width, 'height': height}, token=token_a, user_id=201, project='校园节水网站')
            unlinked = browser.call('act', testid='p09-unlink', confirm='p09-unlink-ok', screenshot='desktop-2-unlinked')
            need(unlinked['error'] is None, 'unlink_failed_' + str(unlinked['error']))
            status, denied = primary.edu_post('/review-sessions', {'schema_version': 1},
                                              headers={'X-P09-Task-Context': primary.grant(
                                                  purpose='website_artifact_review', assignment_ref='assign-1',
                                                  reviewer={'ref': 'teacher-7'}, artifact_ref=artifact_ref)})
            need(status in (409, 410) and denied['error']['code'] in ('link_revoked', 'source_deleted'), 'review_after_unlink')
            status, after_state = primary.edu_get('/state', 'school_ref=school-1')
            unlinked_item = next(item for item in after_state['items'] if item['artifact_ref'] == artifact_ref)
            need(unlinked_item['work_state'] == 'unavailable' and unlinked_item['state'] == 'revoked', 'unlink_projection')
            # Deleting the source of the back-linked work the way the platform allows it: the entry page
            # first (a folder project refuses to be deleted while it still holds pages), then the project.
            status, page_deleted = primary.call('DELETE', '/api/html-editor/pages/9',
                                                headers={'Authorization': 'Bearer ' + token_a})
            need(status == 200, 'page_delete_failed_' + str(status))
            time.sleep(1.0)
            status, deleted = primary.call('DELETE', '/api/html-editor/projects/5',
                                           headers={'Authorization': 'Bearer ' + token_a})
            need(status == 200, 'project_delete_failed_' + str(status))
            time.sleep(1.0)
            status, final_state = primary.edu_get('/state', 'school_ref=school-1')
            deleted_item = next((item for item in final_state['items'] if item['assignment_ref'] == 'assign-2'), None)
            need(deleted_item and deleted_item['state'] == 'deleted', 'deletion_not_projected')
            report['scenarios'].append({'name': 'revocation', 'unlink_state': unlinked_item['work_state'],
                                        'review_after_unlink': denied['error']['code'],
                                        'source_deleted_state': deleted_item['state']})
            report['checks'].append('unlinking and deleting the source stop new review access immediately and are projected to edu as unavailable/deleted')

            # 12. one student, several pages and several revisions still counts as one row
            report['stage'] = 'counting'
            rows = primary.sql(['SELECT student_uuid, COUNT(*) AS n FROM p09_links GROUP BY student_uuid'])[0]
            per_student = {row['student_uuid']: int(row['n']) for row in rows}
            status, count_state = primary.edu_get('/state', 'school_ref=school-1')
            need(len({item['student_uuid'] for item in count_state['items']}) == 1, 'student_rows_multiplied')
            report['scenarios'].append({'name': 'counting', 'links_per_student': per_student,
                                        'distinct_students_in_state': 1})
            report['checks'].append('several pages, several revisions and two assignments for one student still resolve to one student in the projection')

            externals = browser.call('externals')
            need(not externals['external'], 'browser_left_the_laboratory_' + str(externals['external']))
            report['page_errors'] = externals['errors']
            report['status'] = 'passed'
            report['stage'] = 'complete'
    except Exception as error:
        safe = str(error) if isinstance(error, RuntimeError) and re.fullmatch(r'[A-Za-z0-9_\[\]" ,:{}()-]+', str(error)) else type(error).__name__
        report['failure'] = {'stage': report['stage'], 'code': safe[:200]}
        if os.environ.get('P09_LAB_DEBUG'):
            import traceback
            traceback.print_exc()
    finally:
        if browser:
            browser.close()
        if web:
            web.close()
        for instance in instances:
            instance.stop()
        # Keep the process logs with the evidence, with every laboratory secret replaced first.
        try:
            seen = [value for instance in instances for value in instance.secrets()] + [root_password]
            for log in sorted(Path(scratch).glob('*.log')):
                text = log.read_text(errors='replace')
                for value in seen:
                    if value:
                        text = text.replace(value, '<redacted>')
                (EVIDENCE / log.name).write_text(text[-200000:])
        except Exception:
            pass
        shutil.rmtree(scratch, ignore_errors=True)
        subprocess.run(['docker', 'rm', '--force', '--volumes', container], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        report['containers_removed'] = True
        report['checked_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        report['source_head'] = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True, capture_output=True).stdout.strip()
        report['source_dirty'] = subprocess.run(['git', 'status', '--porcelain'], cwd=ROOT, text=True, capture_output=True).stdout.strip() != ''
        report['evidence_dir'] = str(EVIDENCE)
        (EVIDENCE / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({'status': report['status'], 'failure': report.get('failure'), 'evidence': str(EVIDENCE)}, ensure_ascii=False))
    return 0 if report['status'] == 'passed' else 1


if __name__ == '__main__':
    sys.exit(main())

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
# A tiny real PNG (1x1) and a stylesheet, written under each instance's own storage root.
PNG = bytes.fromhex(Path(__file__).with_name('pond.png.hex').read_text().strip())
UPLOADS = [
    {'key': 'p09/pond.png', 'bytes': PNG, 'mime': 'image/png', 'owner': 201},
    {'key': 'p09/site.css', 'bytes': b'h1{color:#0b6}', 'mime': 'text/css', 'owner': 201},
    # On disk but owned by nobody the platform can name: it must be refused by name, never copied.
    {'key': 'p09/not-mine.png', 'bytes': PNG, 'mime': 'image/png', 'owner': None}
]
ASSET_PAGE = ('<h1>带图片的作品</h1><link rel="stylesheet" href="/uploads/p09/site.css">'
              '<p>这是我拍的池塘。</p><img src="/uploads/p09/pond.png" alt="池塘">'
              '<img src="/uploads/p09/not-mine.png" alt="不属于我的图">'
              '<img src="https://cdn.example.com/logo.png" alt="外部图">'
              '<p><a href="/pages/201/notes">观察记录</a></p>')
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


def node(script, payload, timeout=180, redact=()):
    process = subprocess.run(['node', '-e', script], cwd=ROOT, input=json.dumps(payload), text=True,
                             capture_output=True, timeout=timeout)
    if process.returncode:
        lines = [line.strip() for line in process.stderr.strip().splitlines() if line.strip()]
        for value in redact:
            if value:
                lines = [line.replace(value, '<redacted>') for line in lines]
        # Prefer the driver's own error code, then a real "Error: ..." line, never the echoed source.
        picked = (next((line for line in lines if re.search(r"\bcode: ?'", line)), None)
                  or next((line for line in lines if re.match(r'[A-Za-z]*Error: ', line)), None)
                  or (lines[-1] if lines else 'unknown'))
        try:                                   # the failure itself is evidence
            EVIDENCE.mkdir(parents=True, exist_ok=True)
            (EVIDENCE / 'node-helper-failure.log').write_text('\n'.join(lines[-20:]) + '\n')
        except Exception:
            pass
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
        self.preview_host = f'preview-{name}.localhost'
        # https with a throwaway certificate: a sandboxed document has an opaque origin, and only a
        # SameSite=None + Secure cookie is sent with its own images and stylesheet. An http laboratory
        # would have to fall back to Lax and would prove less than a deployment does.
        self.preview_origin = f'https://{self.preview_host}:{self.preview_port}'
        self.tls_key = self.scratch / f'preview-{name}.key'
        self.tls_cert = self.scratch / f'preview-{name}.crt'
        self.storage = self.scratch / f'storage-{name}'
        (self.storage / 'uploads').mkdir(parents=True, exist_ok=True)
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
                        '-subj', f'/CN={self.preview_host}', '-addext', f'subjectAltName=DNS:{self.preview_host}',
                        '-keyout', str(self.tls_key), '-out', str(self.tls_cert)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
        self.process = None
        self.log_handle = None
        self.accounts = {}
        self.projects = {}
        self.lab_options = {}

    # ---- database -------------------------------------------------------------------------------
    # `database` omitted selects this instance's database; database=None connects to the server itself
    # (used to create the database and the roles before it exists).
    def sql(self, queries, database=OWN, user=None, password=None):
        return node(NODE_SQL, dict(self.mysql, database=self.database if database is OWN else database,
                                   user=user or self.mysql['user'], password=password or self.mysql['password'],
                                   queries=[q if isinstance(q, dict) else {'sql': q} for q in queries]),
                    redact=self.secrets())

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
            # Credits: the editor charges for a real save, and a real save is exactly what this run needs
            # to observe. Without a quota the save would be refused before it ever reached the hook.
            rows.append({'sql': 'INSERT INTO users(id,uuid,uuid_source,username,password_hash,role,status,email_verified,credits_quota) VALUES(?,?,?,?,?,?,?,1,?)',
                         'params': [account['id'], account['uuid'], account['uuid_source'], account['username'],
                                    hashes.get(key, 'not-a-password'), 'user', 'active', 5000]})
        for project in projects:
            rows.append({'sql': 'INSERT INTO html_projects(id,user_id,name,type,is_default,sort_order) VALUES(?,?,?,?,?,0)',
                         'params': [project['id'], project['user_id'], project['name'], 'folder', 1 if project.get('default') else 0]})
            for page in project.get('pages', []):
                # `version` is what HtmlPage.update increments, so version=1 with created==updated is a
                # row nothing has ever written to: the state a starter page is really in.
                rows.append({'sql': '''INSERT INTO html_pages(id,project_id,user_id,title,slug,html_content,css_content,js_content,
                             compiled_content,version,is_published,created_at,updated_at) VALUES(?,?,?,?,?,?,'','',?,?,?,FROM_UNIXTIME(?),FROM_UNIXTIME(?))''',
                             'params': [page['id'], project['id'], project['user_id'], page['title'], page['slug'],
                                        page['html'], page['html'], page.get('version', 1),
                                        1 if page.get('published') else 0,
                                        page.get('created', page.get('at', int(time.time()) - 3600)),
                                        page.get('at', int(time.time()) - 3600)]})
        self.sql(rows)
        # Uploads: real bytes under this instance's storage root, with the ownership row the platform
        # would have written. A file without its row is the "cannot prove it is yours" counter-example.
        for upload in UPLOADS:
            target = self.storage / 'uploads' / upload['key']
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(upload['bytes'])
            if upload.get('owner'):
                self.sql([{'sql': '''INSERT INTO files(id,user_id,original_name,stored_name,file_path,file_size,mime_type,status)
                           VALUES(?,?,?,?,?,?,?,'ready')''',
                           'params': [str(uuid.uuid4()), upload['owner'], Path(upload['key']).name, Path(upload['key']).name,
                                      upload['key'], len(upload['bytes']), upload['mime']]}])
        self.accounts = accounts
        self.projects = {project['id']: project for project in projects}

    # ---- processes ------------------------------------------------------------------------------
    def lab_file(self, eligibility=True, revoked=False, key_id='k1'):
        path = self.scratch / f'lab-{self.name}.json'
        # The eligibility provider is the laboratory stand-in for edu's future endpoint (dev/test only).
        # Instance B deliberately has none, so the strict refusal is exercised on the real chain too.
        rules = [{'issuer': 'edu', 'reviewer_ref': 'teacher-7', 'school_ref': 'school-1',
                  'assignment_refs': ['assign-1', 'assign-2', 'assign-3', 'assign-8'], 'revoked': revoked},
                 {'issuer': 'edu', 'reviewer_ref': 'teacher-9', 'school_ref': 'school-1',
                  'assignment_refs': ['assign-9']}]
        spec = {
            'source_instance': self.name,
            'preview_origin': self.preview_origin,
            'issuers': [{'issuer': 'edu', 'key_id': key_id, 'secret': self.issuer_secret,
                         'purposes': ['website_artifact_link', 'website_artifact_revision', 'website_artifact_review']}],
            'integration_clients': [{'client_key': 'edu', 'key_id': 'k1', 'secret': self.client_secret,
                                     'actions': ['artifacts:read', 'artifacts:review', 'artifacts:freeze'],
                                     'school_refs': ['school-1']}]
        }
        if eligibility:
            spec['eligibility'] = {'mode': 'static', 'cache_ms': 0, 'rules': rules}
        path.write_text(json.dumps(spec))
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
            env.update({'P09_WEBSITE_ARTIFACTS_ENABLED': 'true',
                        'P09_LAB': str(self.lab_file(**(self.lab_options or {}))),
                        'P09_DB_USER': self.ledger_user, 'P09_DB_PASSWORD': self.ledger_password,
                        'P09_PREVIEW_BIND': '127.0.0.1', 'P09_PREVIEW_FRAME_ANCESTORS': "'self' http://localhost:*",
                        'P09_PREVIEW_TLS_KEY': str(self.tls_key), 'P09_PREVIEW_TLS_CERT': str(self.tls_cert),
                        # Bounded catch-up, fast enough to be observed inside one run.
                        'P09_SYNC_INTERVAL_MS': '5000', 'P09_SYNC_VERIFY_MS': '10000'})
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
    # `version`/`created==at` is the difference between a row the editor has written to and one it has
    # not. Nothing here fakes a save: the run produces its saves through the real editor.
    return [
        # The current work: pages exist but nothing has ever been written to them, so P09 must report
        # 未开始 until this run really saves through the editor.
        {'id': 3, 'user_id': 201, 'name': '校园节水网站', 'pages': [
            {'id': 7, 'title': '首页', 'slug': 'home', 'html': CONTENT, 'created': at, 'at': at, 'version': 1},
            {'id': 8, 'title': '数据页', 'slug': 'data', 'html': CONTENT, 'created': at, 'at': at, 'version': 1}]},
        {'id': 4, 'user_id': 201, 'name': '我的默认项目', 'default': True, 'pages': []},
        # Written long before P09 watched it (version 3): its 制作事实 can only be 未知.
        {'id': 5, 'user_id': 201, 'name': '去年的家乡介绍', 'pages': [
            {'id': 9, 'title': '家乡', 'slug': 'hometown', 'html': CONTENT, 'created': at - 86400 * 200 - 600,
             'at': at - 86400 * 200, 'version': 3}]},
        {'id': 6, 'user_id': 202, 'name': '同学乙的作品', 'pages': [
            {'id': 10, 'title': '首页', 'slug': 'home', 'html': CONTENT, 'created': at - 600, 'at': at, 'version': 2}]},
        {'id': 7, 'user_id': 201, 'name': '从未打开过的空项目', 'pages': []},
        # The work whose fixed version must re-open completely: two pages, own upload, one file whose
        # ownership cannot be proven, and an external URL that stays unfrozen.
        {'id': 8, 'user_id': 201, 'name': '带图片的作品', 'pages': [
            {'id': 11, 'title': '图片首页', 'slug': 'photos', 'html': ASSET_PAGE, 'created': at, 'at': at, 'version': 1},
            {'id': 12, 'title': '观察记录', 'slug': 'notes', 'html': '<h1>观察记录</h1><p>第一周的记录。</p>',
             'created': at, 'at': at, 'version': 1}]}
    ]


def student_save(instance, token, page_id, html):
    """A real save through the editor's own authenticated endpoint (what the 保存 button calls)."""
    status, _ = instance.call('PUT', f'/api/html-editor/pages/{page_id}',
                              body={'html_content': html, 'css_content': '', 'js_content': ''},
                              headers={'Authorization': 'Bearer ' + token})
    need(status == 200, f'save_failed_{page_id}_{status}')


def student_link(instance, token, project_id, entry_page_id, assignment_ref, uuid_value):
    status, payload = instance.call('POST', '/api/p09/website-artifacts/links',
                                    body={'schema_version': 1, 'project_id': project_id, 'entry_page_id': entry_page_id},
                                    headers={'Authorization': 'Bearer ' + token, 'Idempotency-Key': str(uuid.uuid4()),
                                             'X-P09-Task-Context': instance.grant(
                                                 purpose='website_artifact_link', assignment_ref=assignment_ref,
                                                 subject={'uuid': uuid_value, 'cohort': 'student'})})
    return status, payload


def main():
    os.umask(0o077)
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    report = {'status': 'failed', 'stage': 'setup', 'checks': [], 'scenarios': [], 'widths': [w[2] for w in WIDTHS],
              'real': ['backend node src/server.js (P09 runtime)', 'frontend Vite dev server', 'mysql:8.0 with the local schema pre-image',
                       'knex-applied P09 migration candidate + restricted ledger role', 'Chromium via Playwright'],
              'synthetic': ['three accounts (two SSO shadow students, one local account) — no real student',
                            'edu task-context issuer and service client (laboratory HMAC keys)',
                            'reviewer eligibility provider (experimental static roster; instance B deliberately has none)',
                            'student session token (SSO accounts cannot password-log-in by design)',
                            'uploads: real bytes and real ownership rows written by the harness, not a real upload flow',
                            'two practice instances in one MySQL container, separate databases and instance names'],
              'not_covered': ['real teacher device acceptance', 'real edu implementation and its eligibility endpoint',
                              'production TLS, hostnames and deployment configuration',
                              'object-storage deployments (remote bytes are refused by name, not fetched)']}
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
            # Instance B is configured the way a deployment is today: no reviewer-eligibility provider,
            # so every teacher review it is asked for must be refused rather than guessed.
            secondary.lab_options = {'eligibility': False}
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
            # Nothing has ever been written to these pages, so the association alone must not claim work.
            need(linked['error'] is None and '还没有有效保存' in (linked['state'] or ''),
                 'link_state_' + str(linked['state']) + '_' + str(linked['error']))
            posts = [(item['path'], item['status'], item['task_context']) for item in linked['requests'] if item['method'] == 'POST']
            need(len(posts) == 1 and posts[0][1] == 200 and posts[0][2] == 'present', 'unexpected_link_posts_' + str(posts))
            body = next(item['body'] for item in linked['requests'] if item['method'] == 'POST')
            need(sorted(body) == ['entry_page_id', 'project_id', 'schema_version'], 'link_body_keys_' + str(sorted(body)))
            status, before_save = primary.edu_get('/state', 'school_ref=school-1')
            need(before_save['items'][0]['save_evidence'] == 'none' and before_save['items'][0]['has_effective_save'] is False,
                 'evidence_before_save_' + str(before_save['items'][0]['save_evidence']))
            # The one thing that makes it 制作中: the student presses 保存 in the real editor.
            saved = browser.call('save', page_title='首页')
            need([item['status'] for item in saved['saves']] == [200], 'ui_save_' + json.dumps(saved['saves'])[:160])
            reopened = browser.call('open', viewport={'width': width, 'height': height}, token=token_a, user_id=201,
                                    project='校园节水网站', screenshot=f'{label}-2-saved')
            need(reopened['panel_visible'], 'panel_gone_after_reload')
            after = browser.call('facts')
            need('可预览' in (after['state'] or ''), 'state_after_save_' + str(after['state']))
            report['scenarios'].append({'name': 'link_current_project', 'width': width, 'state_after_link': linked['state'],
                                        'posts': posts, 'body_keys': sorted(body),
                                        'evidence_before_save': before_save['items'][0]['save_evidence'],
                                        'ui_save_requests': saved['saves'], 'state_after_save': after['state'],
                                        'fields_after_save': after['fields']})
            report['checks'].append('desktop: the student links their own project with an explicitly chosen entry page (request carries no assignment or student id, only the signed context header), and the work only becomes 制作中 after a real 保存 in the editor')

            # 2. edu reads the state it will project onto the class list
            report['stage'] = 'edu_state'
            status, state = primary.edu_get('/state', 'school_ref=school-1')
            need(status == 200 and len(state['items']) == 1, 'state_not_visible')
            item = state['items'][0]
            need(item['work_state'] == 'preview_ready' and item['has_effective_save'] is True and
                 item['save_evidence'] == 'observed' and item['real_save_count'] >= 1 and
                 item['student_uuid'] == 'edua-uuid-a', 'state_shape_' + json.dumps(
                     {k: item.get(k) for k in ['work_state', 'has_effective_save', 'save_evidence', 'real_save_count']}))
            need(item['pending_reconcile'] is False, 'state_left_pending')
            need(state['complete'] is True and state['watermark'] >= 2, 'state_completeness')
            need('校园节水</h1>' not in json.dumps(state, ensure_ascii=False), 'state_leaked_content')
            artifact_ref = item['artifact_ref']
            status, other_school = primary.edu_get('/state', 'school_ref=school-9')
            need(status == 404 and other_school['error']['code'] == 'school_not_provisioned', 'school_scope_not_enforced')
            report['scenarios'].append({'name': 'edu_state', 'items': len(state['items']), 'work_state': item['work_state'],
                                        'save_evidence': item['save_evidence'], 'real_save_count': item['real_save_count'],
                                        'complete': state['complete'], 'pending_reconcile': state['pending_reconcile'],
                                        'watermark': state['watermark'], 'other_school_status': 404})
            report['checks'].append('edu reads the current state for its own school only, with completeness, a watermark, the save evidence behind 制作中, and no page content')

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
            status, rewritten = primary.call('PUT', '/api/html-editor/pages/7',
                                             body={'html_content': CONTENT_V2, 'css_content': '', 'js_content': ''},
                                             headers={'Authorization': 'Bearer ' + token_a})
            need(status == 200, 'rewrite_failed_' + str(status))
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
            # Its rows were written long before P09 watched them: 未知 with a reason, never 未开始.
            need('未知' in (back['state'] or ''), 'old_project_state_' + str(back['state']))
            status, back_state = primary.edu_get('/state', 'school_ref=school-1')
            old_item = next(item for item in back_state['items'] if item['assignment_ref'] == 'assign-2')
            need(old_item['work_state'] == 'unknown' and old_item['has_effective_save'] is None and
                 old_item['save_evidence_reason'] == 'history_before_observation',
                 'old_project_evidence_' + json.dumps({k: old_item.get(k) for k in
                  ['work_state', 'has_effective_save', 'save_evidence_reason']}))
            report['scenarios'].append({'name': 'back_link_old_project', 'width': width,
                                        'same_assignment_refused': clash['error'], 'other_assignment_linked': back['state'],
                                        'work_state': old_item['work_state'], 'has_effective_save': old_item['has_effective_save'],
                                        'reason': old_item['save_evidence_reason']})
            report['checks'].append('430: an older project can be back-linked to another assignment (a second work for the same assignment is refused), and its 制作事实 is reported as 未知 with the reason 历史早于观测 — never as 未开始')

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

            # 13. 制作事实 counter-examples: a rename is not a save, and a very short page saved a
            #     second after it was created is one. The old 64-byte + 1-second guess failed both.
            report['stage'] = 'save_evidence'
            starter_id = int(primary.sql(['SELECT id FROM html_pages WHERE project_id=4 ORDER BY id LIMIT 1'])[0][0]['id'])
            status, renamed = primary.call('PUT', f'/api/html-editor/pages/{starter_id}', body={'title': '我的首页'},
                                           headers={'Authorization': 'Bearer ' + token_a})
            need(status == 200, 'rename_failed_' + str(status))
            time.sleep(1.0)
            status, after_rename = primary.edu_get('/state', 'school_ref=school-1')
            default_item = next(item for item in after_rename['items'] if item['assignment_ref'] == 'assign-3')
            need(default_item['work_state'] == 'linked' and default_item['real_save_count'] == 0 and
                 default_item['has_effective_save'] is False,
                 'rename_counted_as_save_' + json.dumps({k: default_item.get(k) for k in
                  ['work_state', 'real_save_count', 'has_effective_save']}))
            student_save(primary, token_a, starter_id, '<p>我做的是节水网站</p>')   # 23 bytes, saved at once
            time.sleep(1.0)
            status, after_short = primary.edu_get('/state', 'school_ref=school-1')
            short_item = next(item for item in after_short['items'] if item['assignment_ref'] == 'assign-3')
            need(short_item['work_state'] == 'preview_ready' and short_item['save_evidence'] == 'observed' and
                 short_item['real_save_count'] == 1,
                 'short_save_not_counted_' + json.dumps({k: short_item.get(k) for k in
                  ['work_state', 'save_evidence', 'real_save_count']}))
            report['scenarios'].append({'name': 'save_evidence', 'after_rename': {k: default_item.get(k) for k in
                                        ['work_state', 'real_save_count', 'has_effective_save']},
                                        'after_short_save': {k: short_item.get(k) for k in
                                        ['work_state', 'save_evidence', 'real_save_count']},
                                        'short_save_bytes': len('<p>我做的是节水网站</p>'.encode())})
            report['checks'].append('制作事实 comes from the observed save: renaming a page counts for nothing, while a 23-byte page saved one second after it was created counts — both were wrong under the old size/time guess')

            # 14. change identity: A→B→A is three changes, a retried identical save is none
            report['stage'] = 'change_identity'
            default_ref = short_item['artifact_ref']
            def updated_facts(instance, artifact_ref):
                facts, cursor = [], None
                while True:
                    query = 'school_ref=school-1&limit=200' + (f'&cursor={cursor}' if cursor else '')
                    code, page_of = instance.edu_get('/events', query)
                    need(code == 200, 'events_read_' + str(code))
                    facts += [fact for fact in page_of['facts']
                              if fact['type'] == 'artifact.updated' and fact['artifact']['artifact_ref'] == artifact_ref]
                    cursor = page_of['next_cursor']
                    if not cursor:
                        return facts
            for html in ['<p>A 版本</p>', '<p>B 版本</p>', '<p>A 版本</p>']:
                student_save(primary, token_a, starter_id, html)
                time.sleep(.8)
            changes = updated_facts(primary, default_ref)
            change_numbers = [fact['progress']['change_no'] for fact in changes]
            need(change_numbers == sorted(set(change_numbers)) and len(change_numbers) >= 4,
                 'change_identity_' + str(change_numbers))
            need(len({fact['fact_id'] for fact in changes}) == len(changes), 'duplicate_change_facts')
            before_retry = len(changes)
            student_save(primary, token_a, starter_id, '<p>A 版本</p>')      # identical bytes again
            time.sleep(1.0)
            need(len(updated_facts(primary, default_ref)) == before_retry, 'retry_appended_a_fact')
            report['scenarios'].append({'name': 'change_identity', 'change_numbers': change_numbers,
                                        'facts_after_identical_retry': before_retry})
            report['checks'].append('A→B→A produces three separate monotonic change facts (content alone would have deduplicated the return to A), while saving identical bytes again appends nothing')

            # 15. a crash after a successful save, and a marker that was itself lost
            report['stage'] = 'crash_recovery'
            crashed_html = '<p>崩溃前保存的内容</p>'
            primary.stop()
            # What the editor's request had already committed when the process died: the page row and
            # the durable marker (phase 1). The projection (phase 2) never ran.
            primary.sql([{'sql': 'UPDATE html_pages SET html_content=?, compiled_content=?, version=version+1 WHERE id=?',
                          'params': [crashed_html, crashed_html, starter_id]},
                         {'sql': "UPDATE p09_links SET sync_pending_at=ROUND(UNIX_TIMESTAMP(NOW(3))*1000), real_save_count=real_save_count+1, save_evidence='observed' WHERE assignment_ref='assign-3'"}])
            primary.start(enabled=True)
            status, recovered = primary.edu_get('/state', 'school_ref=school-1')
            crashed_item = next(item for item in recovered['items'] if item['assignment_ref'] == 'assign-3')
            need(crashed_item['pending_reconcile'] is False and recovered['complete'] is True,
                 'crash_not_reconciled_' + json.dumps({k: crashed_item.get(k) for k in ['pending_reconcile']}))
            after_crash = updated_facts(primary, default_ref)
            need(len(after_crash) == before_retry + 1, 'crash_change_not_recorded_' + str(len(after_crash)))
            # Now the harder case: the marker itself was lost, so only the source and the projection
            # disagree. The self-healing pass has to notice on its own.
            lost_html = '<p>标记丢失的那次保存</p>'
            primary.sql([{'sql': 'UPDATE html_pages SET html_content=?, compiled_content=?, version=version+1 WHERE id=?',
                          'params': [lost_html, lost_html, starter_id]}])
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                time.sleep(3)
                if len(updated_facts(primary, default_ref)) > len(after_crash):
                    break
            healed = updated_facts(primary, default_ref)
            need(len(healed) == len(after_crash) + 1, 'lost_marker_not_recovered_' + str(len(healed)))
            need(healed[-1]['progress']['save_evidence'] in ('observed', 'legacy_unknown'), 'healed_evidence')
            report['scenarios'].append({'name': 'crash_recovery', 'facts_after_restart': len(after_crash),
                                        'facts_after_self_heal': len(healed),
                                        'complete_after_restart': recovered['complete'],
                                        'sync_verify_ms': 10000})
            report['checks'].append('a crash between the save and the projection is finished from the durable marker after restart, and a change whose marker was lost entirely is still recovered by the bounded self-healing pass')

            # 16. concurrent saves: order never goes backwards and no fact is duplicated
            report['stage'] = 'concurrency'
            import threading
            errors_seen = []
            def concurrent_save(index):
                try:
                    student_save(primary, token_a, starter_id, f'<p>并发保存 {index}</p>')
                except Exception as error:                      # collected, never swallowed
                    errors_seen.append(str(error))
            threads = [threading.Thread(target=concurrent_save, args=(index,)) for index in range(4)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
            need(not errors_seen, 'concurrent_save_failed_' + str(errors_seen[:1]))
            time.sleep(1.5)
            student_save(primary, token_a, starter_id, '<p>并发之后的最终稿</p>')
            time.sleep(1.5)
            concurrent = updated_facts(primary, default_ref)
            sequence = [fact['event_sequence'] for fact in concurrent]
            numbers = [fact['progress']['change_no'] for fact in concurrent]
            need(sequence == sorted(sequence) and len(set(sequence)) == len(sequence), 'concurrent_sequence_' + str(sequence[-6:]))
            need(numbers == sorted(numbers) and numbers[-1] == max(numbers), 'concurrent_change_no_' + str(numbers[-6:]))
            status, concurrent_state = primary.edu_get('/state', 'school_ref=school-1')
            final_item = next(item for item in concurrent_state['items'] if item['assignment_ref'] == 'assign-3')
            need(final_item['change_no'] == numbers[-1] and final_item['pending_reconcile'] is False,
                 'concurrent_projection_' + str(final_item['change_no']) + '_' + str(numbers[-1]))
            report['scenarios'].append({'name': 'concurrent_saves', 'threads': 4, 'change_numbers': numbers[-6:],
                                        'sequences_monotonic': True, 'final_change_no': final_item['change_no']})
            report['checks'].append('four concurrent saves plus a final one leave a strictly increasing sequence, no duplicated fact and a projection that matches the last change')

            # 17. full read and incremental read hand over without a gap, and limits are enforced
            report['stage'] = 'watermark_handoff'
            status, too_big = primary.edu_get('/events', 'school_ref=school-1&limit=600')
            need(status == 400 and too_big['error']['code'] == 'range_too_large', 'limit_not_enforced')
            cursor, pages_read = None, 0
            while True:
                query = 'school_ref=school-1&limit=2' + (f'&cursor={cursor}' if cursor else '')
                status, page_of = primary.edu_get('/events', query)
                pages_read += 1
                if not page_of['next_cursor']:
                    break
                cursor = page_of['next_cursor']
                need(pages_read < 100, 'pagination_runaway')
            tail_cursor = page_of['cursor']
            status, full = primary.edu_get('/state', 'school_ref=school-1')
            need(full['complete'] is True and full['watermark'] == page_of['watermark'],
                 'watermark_handoff_' + str(full['watermark']) + '_' + str(page_of['watermark']))
            student_save(primary, token_a, starter_id, '<p>水位交接之后的保存</p>')
            time.sleep(1.2)
            status, resumed = primary.edu_get('/events', f'school_ref=school-1&cursor={tail_cursor}&limit=50')
            need(status == 200 and len(resumed['facts']) >= 1, 'resume_after_watermark')
            need(all(fact['event_sequence'] > full['watermark'] for fact in resumed['facts']), 'resume_replayed_old_facts')
            report['scenarios'].append({'name': 'watermark_handoff', 'pages_read': pages_read,
                                        'limit_refused': 'range_too_large', 'watermark': full['watermark'],
                                        'facts_after_handoff': len(resumed['facts'])})
            report['checks'].append('a full read and the incremental read agree on the watermark, an oversized page is refused, and resuming from the handoff cursor returns only what committed afterwards')

            # 18. a fixed version that re-opens completely: own assets frozen, links rewritten
            report['stage'] = 'frozen_assets'
            status, asset_link = student_link(primary, token_a, 8, 11, 'assign-8', 'edua-uuid-a')
            need(status == 200, 'asset_project_link_' + str(status))
            student_save(primary, token_a, 11, ASSET_PAGE)
            time.sleep(1.0)
            asset_link_id = asset_link['link']['artifact_ref']
            links_of = primary.call('GET', '/api/p09/website-artifacts/links', headers={'Authorization': 'Bearer ' + token_a})[1]
            asset_row = next(item for item in links_of['links'] if item['artifact_ref'] == asset_link_id)
            status, fixed = primary.call('POST', f"/api/p09/website-artifacts/links/{asset_row['link_id']}/revisions",
                                         body={'schema_version': 1},
                                         headers={'Authorization': 'Bearer ' + token_a, 'Idempotency-Key': str(uuid.uuid4())})
            need(status == 200, 'asset_freeze_' + str(status))
            manifest = fixed['revision']['manifest']
            frozen_names = sorted(asset['reference'] for asset in manifest['assets'])
            refused = {item['reference']: item['reason'] for item in manifest['refused_assets']}
            need(frozen_names == ['/uploads/p09/pond.png', '/uploads/p09/site.css'], 'frozen_assets_' + str(frozen_names))
            need(refused.get('/uploads/p09/not-mine.png') == 'ownership_unproven', 'unproven_not_refused_' + str(refused))
            need([dep['url'] for dep in manifest['external_dependencies']] == ['https://cdn.example.com/logo.png'],
                 'external_dependency_missing')
            need(manifest['frozen_scope'] == 'pages_and_owned_local_assets', 'frozen_scope_' + str(manifest['frozen_scope']))
            need(all(asset['sha256'] and asset['byte_length'] > 0 and asset['owned_by'] for asset in manifest['assets']),
                 'asset_facts_incomplete')
            status, asset_session = primary.edu_post('/review-sessions', {'schema_version': 1},
                                                     headers={'X-P09-Task-Context': primary.grant(
                                                         purpose='website_artifact_review', assignment_ref='assign-8',
                                                         reviewer={'ref': 'teacher-7'}, artifact_ref=asset_link_id,
                                                         revision_ref=fixed['revision']['revision_ref'])})
            need(status == 200, 'asset_review_session_' + str(status))
            width, height, label = WIDTHS[2]
            opened_fixed = browser.call('review', open_url=asset_session['session']['open_url'],
                                        viewport={'width': width, 'height': height},
                                        contains=['这是我拍的池塘'], follow_link='观察记录',
                                        follow_contains=['第一周的记录'], screenshot='teacher-3-frozen-assets')
            need(opened_fixed['status'] == 200 and opened_fixed['contains'] == [True], 'frozen_page_not_rendered')
            asset_statuses = {item['file']: item['status'] for item in opened_fixed['resources']}
            frozen_files = {asset['path'].split('/')[-1] for asset in manifest['assets']}
            need(frozen_files and all(asset_statuses.get(name) == 200 for name in frozen_files),
                 'frozen_assets_not_served_' + json.dumps(asset_statuses))
            # The refused file keeps its original reference and is simply not there: a reviewer sees a
            # missing image and the manifest says by name why it was never part of the work.
            need(asset_statuses.get('not-mine.png') == 404, 'unproven_asset_served_' + json.dumps(asset_statuses))
            need(opened_fixed['followed'] and opened_fixed['followed']['contains'] == [True],
                 'frozen_navigation_' + json.dumps(opened_fixed['followed']))
            # The student now rewrites the page and the original upload disappears from disk.
            student_save(primary, token_a, 11, '<h1>改稿之后</h1><p>图片都删掉了。</p>')
            (primary.storage / 'uploads' / 'p09/pond.png').unlink()
            time.sleep(1.0)
            status, again_session = primary.edu_post('/review-sessions', {'schema_version': 1},
                                                     headers={'X-P09-Task-Context': primary.grant(
                                                         purpose='website_artifact_review', assignment_ref='assign-8',
                                                         reviewer={'ref': 'teacher-7'}, artifact_ref=asset_link_id,
                                                         revision_ref=fixed['revision']['revision_ref'])})
            need(status == 200, 'second_asset_session_' + str(status))
            still = browser.call('review', open_url=again_session['session']['open_url'],
                                 viewport={'width': width, 'height': height},
                                 contains=['这是我拍的池塘', '改稿之后'], follow_link='观察记录',
                                 follow_contains=['第一周的记录'], screenshot='teacher-4-frozen-after-delete')
            need(still['status'] == 200 and still['contains'] == [True, False], 'frozen_version_changed_' + str(still['contains']))
            still_assets = {item['file']: item['status'] for item in still['resources']}
            need(frozen_files and all(still_assets.get(name) == 200 for name in frozen_files),
                 'frozen_assets_lost_after_delete_' + json.dumps(still_assets))
            report['scenarios'].append({'name': 'frozen_assets', 'width': width, 'frozen': frozen_names,
                                        'refused': refused, 'external': [dep['url'] for dep in manifest['external_dependencies']],
                                        'asset_requests': asset_statuses, 'navigation': opened_fixed['followed'],
                                        'refused_asset_request': asset_statuses.get('not-mine.png'),
                                        'after_source_deleted': {'contains_frozen_text': still['contains'][0],
                                                                 'shows_new_draft': still['contains'][1],
                                                                 'asset_requests': still_assets}})
            report['checks'].append('390: a fixed version carries the student\'s own uploads (bytes, type, digest, owning model), rewrites page links and asset references, refuses by name every file whose ownership cannot be proven, leaves external URLs unfrozen (the refused file stays a visibly missing image, named in the manifest), and still opens whole — images, stylesheet and multi-page navigation — after the page was rewritten and the original upload deleted')

            # 19. who may open a private review: no provider refuses, a wrong reviewer is refused, a
            #     stolen entry is burned, and a stolen cookie does not work in another browser
            report['stage'] = 'review_audience'
            status, second_state_now = secondary.edu_get('/state', 'school_ref=school-1')
            secondary_ref = second_state_now['items'][0]['artifact_ref']
            status, no_provider = secondary.edu_post('/review-sessions', {'schema_version': 1},
                                                     headers={'X-P09-Task-Context': secondary.grant(
                                                         purpose='website_artifact_review', assignment_ref='assign-1',
                                                         reviewer={'ref': 'teacher-7'}, artifact_ref=secondary_ref)})
            need(status == 503 and no_provider['error']['code'] == 'eligibility_unavailable',
                 'no_provider_not_refused_' + str(status) + '_' + json.dumps(no_provider)[:80])
            status, wrong_reviewer = primary.edu_post('/review-sessions', {'schema_version': 1},
                                                      headers={'X-P09-Task-Context': primary.grant(
                                                          purpose='website_artifact_review', assignment_ref='assign-8',
                                                          reviewer={'ref': 'teacher-9'}, artifact_ref=asset_link_id)})
            need(status == 403 and wrong_reviewer['error']['code'] == 'not_eligible',
                 'wrong_reviewer_' + str(status) + '_' + json.dumps(wrong_reviewer)[:80])
            status, stolen = primary.edu_post('/review-sessions', {'schema_version': 1},
                                              headers={'X-P09-Task-Context': primary.grant(
                                                  purpose='website_artifact_review', assignment_ref='assign-8',
                                                  reviewer={'ref': 'teacher-7'}, artifact_ref=asset_link_id,
                                                  revision_ref=fixed['revision']['revision_ref'])})
            need(status == 200, 'stolen_case_session_' + str(status))
            thief = browser.call('review', open_url=stolen['session']['open_url'], user_agent='ThiefBrowser/1.0',
                                 contains=['这是我拍的池塘'], screenshot='teacher-5-stolen-first-use')
            need(thief['status'] == 200, 'thief_blocked_before_binding')       # first use wins, whoever it is
            legitimate = browser.call('review', open_url=stolen['session']['open_url'], contains=['这是我拍的池塘'])
            need(legitimate['status'] in (401, 403) and legitimate['contains'] == [False],
                 'burned_entry_still_opened_' + str(legitimate['status']))
            session_url = f"{primary.preview_origin}/p09/preview/{stolen['session']['session_id']}/index.html"
            replayed = browser.call('review', direct_url=session_url, cookies=thief['cookies'],
                                    user_agent='YetAnotherBrowser/2.0', contains=['这是我拍的池塘'])
            need(replayed['status'] == 403 and replayed['contains'] == [False],
                 'stolen_cookie_worked_' + str(replayed['status']))
            same_browser = browser.call('review', direct_url=session_url, cookies=thief['cookies'],
                                        user_agent='ThiefBrowser/1.0', contains=['这是我拍的池塘'])
            need(same_browser['status'] == 200, 'binding_broke_the_same_browser_' + str(same_browser['status']))
            report['scenarios'].append({'name': 'review_audience', 'no_provider_status': 503,
                                        'wrong_reviewer_status': 403, 'first_use_status': thief['status'],
                                        'burned_entry_status': legitimate['status'],
                                        'stolen_cookie_status': replayed['status'],
                                        'same_browser_status': same_browser['status']})
            report['checks'].append('an instance without an eligibility provider refuses every teacher review; a grant for a teacher who is not on the task is refused; the one-time entry is burned by whoever uses it first; and the cookie it produced is refused in any other browser while still working in the one that redeemed it')

            # 20. what stops an open review: a withdrawn issuer key and a disabled owner
            report['stage'] = 'review_revocation'
            status, live = primary.edu_post('/review-sessions', {'schema_version': 1},
                                            headers={'X-P09-Task-Context': primary.grant(
                                                purpose='website_artifact_review', assignment_ref='assign-8',
                                                reviewer={'ref': 'teacher-7'}, artifact_ref=asset_link_id,
                                                revision_ref=fixed['revision']['revision_ref'])})
            need(status == 200, 'revocation_session_' + str(status))
            opened_live = browser.call('review', open_url=live['session']['open_url'], user_agent='TeacherBrowser/3.0',
                                       contains=['这是我拍的池塘'])
            need(opened_live['status'] == 200, 'revocation_session_not_open')
            live_url = f"{primary.preview_origin}/p09/preview/{live['session']['session_id']}/index.html"
            # The issuer's key is withdrawn from this deployment: a session it signed stops rendering.
            primary.stop()
            primary.lab_options = {'key_id': 'k2'}
            primary.start(enabled=True)
            after_key = browser.call('review', direct_url=live_url, cookies=opened_live['cookies'],
                                     user_agent='TeacherBrowser/3.0', contains=['这是我拍的池塘'])
            need(after_key['status'] == 403 and after_key['contains'] == [False],
                 'issuer_revocation_ignored_' + str(after_key['status']))
            primary.stop()
            primary.lab_options = {}
            primary.start(enabled=True)
            back_again = browser.call('review', direct_url=live_url, cookies=opened_live['cookies'],
                                      user_agent='TeacherBrowser/3.0', contains=['这是我拍的池塘'])
            need(back_again['status'] == 200, 'session_did_not_survive_restart_' + str(back_again['status']))
            # The student's account is disabled: the work stops being viewable at once.
            primary.sql(["UPDATE users SET status='inactive' WHERE id=201"])   # users.status is enum('active','inactive')
            disabled = browser.call('review', direct_url=live_url, cookies=opened_live['cookies'],
                                    user_agent='TeacherBrowser/3.0', contains=['这是我拍的池塘'],
                                    screenshot='teacher-6-owner-disabled')
            need(disabled['status'] == 403 and disabled['contains'] == [False],
                 'disabled_owner_still_served_' + str(disabled['status']))
            revoked_rows = int(primary.sql(["SELECT COUNT(*) AS n FROM p09_review_sessions WHERE revoked_reason='owner_unavailable'"])[0][0]['n'])
            need(revoked_rows >= 1, 'owner_sessions_not_revoked')
            primary.sql(["UPDATE users SET status='active' WHERE id=201"])
            report['scenarios'].append({'name': 'review_revocation', 'issuer_withdrawn_status': after_key['status'],
                                        'restored_status': back_again['status'], 'owner_disabled_status': disabled['status'],
                                        'sessions_revoked_on_owner_disable': revoked_rows})
            report['checks'].append('an open review stops when the issuer key that signed it is withdrawn and when the student account is disabled (and the sessions are revoked), while an unaffected restart does not break it')

            externals = browser.call('externals')
            need(not externals['external'], 'browser_left_the_laboratory_' + str(externals['external']))
            report['page_errors'] = externals['errors']
            report['status'] = 'passed'
            report['stage'] = 'complete'
    except Exception as error:
        safe = str(error) if isinstance(error, RuntimeError) and re.fullmatch(r'[\x20-\x7e]+', str(error)) else type(error).__name__
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

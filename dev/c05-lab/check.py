"""Isolated acceptance for the C05 student entry (edu → practice), provider side.

Real components: this repository's backend (node src/server.js) and frontend (Vite), a disposable
mysql:8.0 built from the local schema copy (structure only, no rows), a disposable redis:7-alpine, the
candidate migration applied by knex, and Chromium through dev/c05-lab/browser.cjs at desktop and three
phone widths. Synthetic components, listed separately in the evidence: the edu issuer (a laboratory HMAC
key), every student uuid, and the school itself. No real edu deployment is involved and no claim is made
that one has been connected.

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
import threading
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]
LOCAL_ENV = Path(os.environ.get('C05_LOCAL_ENV', '')) if os.environ.get('C05_LOCAL_ENV') else (
    ROOT / 'backend/.env' if (ROOT / 'backend/.env').exists() else Path('/home/hanying/ai-platform/backend/.env'))
EVIDENCE = ROOT / 'storage/private/c05-validation' / time.strftime('run-%Y%m%dT%H%M%SZ', time.gmtime())
MYSQL_IMAGE = 'mysql:8.0'
REDIS_IMAGE = 'redis:7-alpine'
WIDTHS = [(1280, 900, 'desktop'), (360, 740, 'w360'), (390, 844, 'w390'), (430, 932, 'w430')]
STUDENT_GROUP = 7
OTHER_SCHOOL_GROUP = 8

NODE_SQL = """const mysql=require('./backend/node_modules/mysql2/promise');let s='';
process.stdin.on('data',b=>s+=b).on('end',async()=>{const c=JSON.parse(s);
const db=await mysql.createConnection({host:c.host,port:c.port,user:c.user,password:c.password,database:c.database||undefined,multipleStatements:true,charset:'utf8mb4'});
const out=[];try{for(const q of c.queries){const [rows]=await db.query(q.sql,q.params||[]);out.push(Array.isArray(rows)?rows:{affected:rows.affectedRows});}}
finally{await db.end();}process.stdout.write(JSON.stringify(out));});"""
NODE_KNEX = """const c=JSON.parse(require('fs').readFileSync(0,'utf8'));
const knex=require('./backend/node_modules/knex')({client:'mysql2',connection:{host:'127.0.0.1',port:c.port,user:c.user,password:c.password,database:c.database,charset:'utf8mb4'},
migrations:{directory:c.directory,tableName:'knex_migrations'}});
(async()=>{try{const r=c.down?await knex.migrate.down():await knex.migrate.latest();
process.stdout.write(JSON.stringify({ok:true,result:Array.isArray(r)?{batch:r[0],files:r[1].map(f=>require('path').basename(f))}:r}));}
catch(e){process.stdout.write(JSON.stringify({ok:false,error:String(e.message).slice(0,160)}));}finally{await knex.destroy();}})();"""
NODE_BCRYPT = """const bcrypt=require('./backend/node_modules/bcryptjs');let s='';
process.stdin.on('data',b=>s+=b).on('end',()=>{const c=JSON.parse(s);
process.stdout.write(JSON.stringify(Object.fromEntries(Object.entries(c.passwords).map(([k,v])=>[k,bcrypt.hashSync(v,10)]))));});"""


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


def node(script, payload, timeout=180, redact=()):
    process = subprocess.run(['node', '-e', script], cwd=ROOT, input=json.dumps(payload), text=True,
                             capture_output=True, timeout=timeout)
    if process.returncode:
        lines = [line.strip() for line in process.stderr.strip().splitlines() if line.strip()]
        for value in redact:
            if value:
                lines = [line.replace(value, '<redacted>') for line in lines]
        picked = (next((line for line in lines if re.search(r"\bcode: ?'", line)), None)
                  or next((line for line in lines if re.match(r'[A-Za-z]*Error: ', line)), None)
                  or (lines[-1] if lines else 'unknown'))
        EVIDENCE.mkdir(parents=True, exist_ok=True)
        (EVIDENCE / 'node-helper-failure.log').write_text('\n'.join(lines[-20:]) + '\n')
        raise RuntimeError('node_helper_failed_' + re.sub(r'[^A-Za-z0-9_]', '', picked)[:48])
    text = process.stdout.strip()
    start = min([i for i in (text.find('{'), text.find('[')) if i >= 0], default=-1)
    return json.loads(text[start:]) if start >= 0 else text


def docker(*args, timeout=120, check=True):
    result = subprocess.run(['docker', *args], capture_output=True, text=True, timeout=timeout)
    if check:
        need(result.returncode == 0, 'docker_' + args[0] + '_failed')
    return result.stdout.strip()


class Issuer:
    """The synthetic edu server: it signs exactly what contract C05 §2 says, and nothing else."""

    def __init__(self, secret, platform_key='edu'):
        self.secret = secret
        self.platform_key = platform_key

    def sign(self, payload, timestamp=None, nonce=None, secret=None, body=None):
        raw = body if body is not None else json.dumps(
            {'schema_version': 1, 'platform_key': self.platform_key, **payload},
            ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        stamp = int(time.time()) if timestamp is None else timestamp
        used_nonce = nonce or base64.urlsafe_b64encode(os.urandom(18)).decode().rstrip('=')
        digest = hashlib.sha256(raw).hexdigest()
        signature = hmac.new((secret or self.secret).encode(), f'{stamp}\n{used_nonce}\n{digest}'.encode(),
                             hashlib.sha256).hexdigest()
        return raw, {'X-Edu-Timestamp': str(stamp), 'X-Edu-Nonce': used_nonce, 'X-Edu-Signature': signature,
                     'Content-Type': 'application/json'}


class Lab:
    def __init__(self, scratch):
        self.scratch = Path(scratch)
        self.database = 'c05_lab_' + secrets.token_hex(3)
        self.app_user = 'c05_app_' + secrets.token_hex(3)
        self.app_password = secrets.token_urlsafe(24)
        self.jwt_secret = secrets.token_urlsafe(48)
        self.issuer_secret = secrets.token_urlsafe(40)
        self.api_port = free_port()
        self.mysql = None
        self.redis_port = None
        self.redis_container = None
        self.mysql_container = None
        self.storage = self.scratch / 'storage'
        (self.storage / 'uploads').mkdir(parents=True, exist_ok=True)
        self.process = None
        self.log = None
        self.log_handle = None
        self.extra_secrets = []

    # ---- containers -----------------------------------------------------------------------------
    def start_containers(self):
        root_password = secrets.token_urlsafe(20)
        self.mysql_container = 'c05-lab-mysql-' + secrets.token_hex(3)
        docker('run', '--rm', '-d', '--name', self.mysql_container, '-e', 'MYSQL_ROOT_PASSWORD=' + root_password,
               '-e', 'MYSQL_ROOT_HOST=%', '-p', '127.0.0.1::3306', MYSQL_IMAGE)
        # No --rm: this container is stopped and started again to reproduce "Redis went away".
        self.redis_container = 'c05-lab-redis-' + secrets.token_hex(3)
        docker('run', '-d', '--name', self.redis_container, '-p', '127.0.0.1::6379', REDIS_IMAGE)
        self.redis_port = int(docker('port', self.redis_container, '6379/tcp').rsplit(':', 1)[1])
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            probe = subprocess.run(['docker', 'exec', self.mysql_container, 'mysqladmin', '--host=127.0.0.1',
                                    'ping', '--silent'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if probe.returncode == 0:
                time.sleep(1.5)
                again = subprocess.run(['docker', 'exec', self.mysql_container, 'mysqladmin', '--host=127.0.0.1',
                                        'ping', '--silent'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if again.returncode == 0:
                    break
            time.sleep(.4)
        else:
            need(False, 'database_start_timeout')
        port = int(docker('port', self.mysql_container, '3306/tcp').rsplit(':', 1)[1])
        self.mysql = {'host': '127.0.0.1', 'port': port, 'user': 'root', 'password': root_password}

    def redis_stop(self):
        # A real stop, not a pause: a paused container keeps the socket open and the client would hang
        # instead of noticing, which would prove nothing about how the entry behaves without Redis.
        docker('stop', '-t', '2', self.redis_container, timeout=60)

    def redis_start(self):
        docker('start', self.redis_container)
        # Docker hands out a new ephemeral host port on restart, so the mapping is read again.
        self.redis_port = int(docker('port', self.redis_container, '6379/tcp').rsplit(':', 1)[1])
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            probe = subprocess.run(['docker', 'exec', self.redis_container, 'redis-cli', 'ping'],
                                   capture_output=True, text=True)
            if 'PONG' in probe.stdout:
                return
            time.sleep(.3)
        need(False, 'redis_restart_timeout')

    # ---- database -------------------------------------------------------------------------------
    def sql(self, queries, database=..., user=None, password=None):
        target = self.database if database is ... else database
        return node(NODE_SQL, dict(self.mysql, database=target, user=user or self.mysql['user'],
                                   password=password or self.mysql['password'],
                                   queries=[q if isinstance(q, dict) else {'sql': q} for q in queries]),
                    redact=self.secrets())

    def build_database(self, preimage, knex_rows):
        self.sql([f'CREATE DATABASE `{self.database}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'], database=None)
        self.sql([preimage, knex_rows])
        self.sql([f"CREATE USER '{self.app_user}'@'%' IDENTIFIED BY '{self.app_password}'",
                  f"GRANT ALL PRIVILEGES ON `{self.database}`.* TO '{self.app_user}'@'%'"], database=None)

    def seed(self):
        hashes = node(NODE_BCRYPT, {'passwords': {'teacher': secrets.token_urlsafe(18)}})
        rows = [
            {'sql': '''INSERT INTO user_groups(id,name,description,credits_pool,credits_pool_used,user_limit,is_active)
                       VALUES(?,?,?,?,0,?,1)''',
             'params': [STUDENT_GROUP, '实验学校学生组', 'C05 lab', 5000, 0]},
            {'sql': '''INSERT INTO user_groups(id,name,description,credits_pool,credits_pool_used,user_limit,is_active)
                       VALUES(?,?,?,?,0,?,1)''',
             'params': [OTHER_SCHOOL_GROUP, '第二实验学校学生组', 'C05 lab', 5000, 0]},
            {'sql': '''INSERT INTO user_groups(id,name,description,credits_pool,credits_pool_used,user_limit,is_active)
                       VALUES(?,?,?,?,0,?,0)''',
             'params': [9, '未开通学校组', 'C05 lab', 0, 0]},
            # A teacher who happens to carry the uuid a student assertion will claim later.
            {'sql': '''INSERT INTO users(id,uuid,uuid_source,email,username,password_hash,role,group_id,status,
                       token_quota,credits_quota,used_credits) VALUES(?,?,?,?,?,?,?,?,?,10000,1000,0)''',
             'params': [301, 'lab-teacher-uuid-0001', 'sso', 'teacher@lab.local', 'lab_teacher',
                        hashes['teacher'], 'admin', STUDENT_GROUP, 'active']},
            # An SSO student an administrator has switched off (`users.status` is enum(active,inactive)).
            {'sql': '''INSERT INTO users(id,uuid,uuid_source,email,username,password_hash,role,group_id,status,
                       token_quota,credits_quota,used_credits) VALUES(?,?,?,?,?,?,?,?,?,10000,100,0)''',
             'params': [302, 'lab-blocked-uuid-0001', 'sso', 'blocked@sso.local', 'lab_blocked',
                        'not-a-password', 'user', STUDENT_GROUP, 'inactive']}
        ]
        self.sql(rows)

    def write_config(self, c05):
        value = json.dumps({
            'enabled': True, 'signature_valid_minutes': 5,
            'platforms': [{'platform_key': 'edu', 'secret': self.issuer_secret, 'algorithm': 'sha256',
                           'enabled': True, 'ip_whitelist_enabled': True, 'allowed_ips': '127.0.0.1',
                           'c05': c05}]
        }, ensure_ascii=False)
        self.sql([{'sql': '''INSERT INTO system_settings(setting_key,setting_value,setting_type,description)
                             VALUES('sso_config',?, 'json','C05 lab')
                             ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value), setting_type='json' ''',
                   'params': [value]}])

    # ---- server ---------------------------------------------------------------------------------
    def env(self, enabled, extra=None):
        env = {**os.environ, 'NODE_ENV': 'development', 'PORT': str(self.api_port),
               'DB_HOST': '127.0.0.1', 'DB_PORT': str(self.mysql['port']), 'DB_USER': self.app_user,
               'DB_PASSWORD': self.app_password, 'DB_NAME': self.database,
               'REDIS_HOST': '127.0.0.1', 'REDIS_PORT': str(self.redis_port), 'REDIS_PASSWORD': '',
               'REDIS_KEY_PREFIX': 'c05lab:',
               'JWT_ACCESS_SECRET': self.jwt_secret, 'JWT_REFRESH_SECRET': secrets.token_urlsafe(48),
               'STORAGE_PATH': str(self.storage), 'IDENTITY_ENABLED': 'false'}
        for key in [k for k in env if k.startswith('C05_') or k.startswith('P09_')]:
            del env[key]
        for key in dotenv(LOCAL_ENV):
            if key.startswith('IDENTITY_') and key not in env:
                env[key] = ''
        if enabled:
            env['C05_STUDENT_ENTRY_ENABLED'] = 'true'
        env.update(extra or {})
        return env

    def start(self, enabled, label=None, extra=None):
        self.log = self.scratch / f'backend-{label or ("on" if enabled else "off")}.log'
        self.log_handle = self.log.open('a')
        self.process = subprocess.Popen(['node', 'src/server.js'], cwd=ROOT / 'backend', env=self.env(enabled, extra),
                                        stdin=subprocess.DEVNULL, stdout=self.log_handle, stderr=subprocess.STDOUT)
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                self.log_handle.close()
                tail = self.log.read_text(errors='replace').splitlines()[-12:]
                for word in self.secrets():
                    tail = [line.replace(word, '<redacted>') for line in tail]
                sys.stderr.write('\n'.join(tail) + '\n')
                need(False, f'backend_exited_{self.process.returncode}')
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{self.api_port}/health', timeout=3) as response:
                    if response.status == 200:
                        return
            except Exception:
                time.sleep(.5)
        need(False, 'backend_start_timeout')

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
        return [value for value in [self.app_password, self.jwt_secret, self.issuer_secret,
                                    (self.mysql or {}).get('password'), *self.extra_secrets] if value]

    # ---- HTTP -----------------------------------------------------------------------------------
    def call(self, method, path, body=None, headers=None, raw=None):
        url = f'http://127.0.0.1:{self.api_port}{path}'
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        request = urllib.request.Request(url, data=data, method=method,
                                         headers={**({'Content-Type': 'application/json'} if data is not None else {}),
                                                  **(headers or {})})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                text = response.read().decode() or '{}'
                return response.status, json.loads(text) if text.strip().startswith(('{', '[')) else text, dict(response.headers)
        except urllib.error.HTTPError as error:
            text = error.read().decode()
            try:
                payload = json.loads(text or '{}')
            except Exception:
                payload = {'raw': text[:200]}
            return error.code, payload, dict(error.headers)

    def exchange(self, issuer, payload, **signing):
        raw, headers = issuer.sign(payload, **signing)
        return self.call('POST', '/api/auth/sso/exchange', raw=raw, headers=headers)

    def consume(self, ticket):
        return self.call('POST', '/api/auth/sso/consume', body={'handoff': ticket})


class Web:
    """The real frontend on a Vite dev server proxied to the isolated practice server."""

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
        libs = os.environ.get('C05_BROWSER_LIBS', '/home/hanying/feedback-sync-ws/tools/browser-libs/extracted/usr/lib/x86_64-linux-gnu')
        if Path(libs).is_dir():
            env['LD_LIBRARY_PATH'] = libs + (':' + env['LD_LIBRARY_PATH'] if env.get('LD_LIBRARY_PATH') else '')
        self.process = subprocess.Popen(['node', 'dev/c05-lab/browser.cjs'], cwd=ROOT, env=env, stdin=subprocess.PIPE,
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
            sys.stderr.write(json.dumps({'browser_failure': command, 'code': code}, ensure_ascii=False)[:800] + '\n')
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


def lab_uuid(number):
    """A synthetic student uuid shaped like a real one.

    Contract §4 derives the username from the first 16 characters of the uuid with hyphens removed, so
    laboratory uuids must differ there too — otherwise every case would collide on the username and the
    run would be measuring the retry path instead of the case it names.
    """
    return f'{number:08d}-0000-4000-8000-{number:012d}'


def student_payload(student_uuid, **overrides):
    payload = {
        'subject': {'uuid': student_uuid, 'cohort': 'student', 'status': 'active'},
        'profile': {'display_name': '王小明', 'username_hint': '20230101'},
        'org': {'school_ref': '123', 'grade_ref': '7', 'grade_name': '初一', 'class_ref': '701', 'class_name': '1班'},
        'landing': {'entry': 'chat'},
        'context': {'lesson_id': '456', 'assignment_id': None},
        'issued_at': int(time.time()), 'expires_at': int(time.time()) + 300
    }
    payload.update(overrides)
    return payload


C05_CONFIG = {
    'enabled': True, 'school_source': 'config',
    'school_groups': {'123': STUDENT_GROUP, '456': OTHER_SCHOOL_GROUP, '789': 9},
    'issuance': {'mode': 'from_group_pool', 'amount': 100, 'expire_days': 365},
    'launch_url': 'https://edu.invalid.example/sso/practice/launch?entry=dashboard',
    'trusted_proxy_hops': 0
}


def main():
    report = {'started_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'stage': 'start',
              'synthetic': ['edu issuer and its HMAC key', 'every student uuid and school_ref',
                            'the school itself: no real edu deployment is connected'],
              'real': ['backend node src/server.js', 'frontend Vite build of this worktree',
                       'mysql:8.0 built from the local schema structure (no rows)', 'redis:7-alpine',
                       'knex applying the candidate migration', 'Chromium at four widths'],
              'stages': {}, 'passed': False}
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    lab = web = browser = None
    scratch = tempfile.mkdtemp(prefix='c05-lab-')
    try:
        lab = Lab(scratch)
        lab.start_containers()
        local = dotenv(LOCAL_ENV)
        dump = ['docker', 'exec', '-e', 'MYSQL_PWD=' + local['DB_PASSWORD'], 'practice-mysql', 'mysqldump',
                '-u' + local['DB_USER'], '--skip-triggers', '--set-gtid-purged=OFF']
        structure = subprocess.run(dump + ['--no-data', '--skip-add-drop-table', local['DB_NAME']],
                                   capture_output=True, timeout=300)
        knex_rows = subprocess.run(dump + ['--no-create-info', local['DB_NAME'], 'knex_migrations', 'knex_migrations_lock'],
                                   capture_output=True, timeout=120)
        need(structure.returncode == 0 and knex_rows.returncode == 0, 'local_schema_dump_failed')
        preimage = re.sub(rb'-- (Dump completed on|Host:|Server version|MySQL dump).*', b'',
                          re.sub(rb'AUTO_INCREMENT=\d+ ', b'', structure.stdout)).decode()
        need('edu_school_id' not in preimage, 'preimage_already_has_candidate_columns')
        lab.build_database(preimage, knex_rows.stdout.decode())
        lab.seed()
        lab.write_config(C05_CONFIG)
        issuer = Issuer(lab.issuer_secret)
        report['database'] = {'tables': len(lab.sql([
            f"SELECT table_name FROM information_schema.tables WHERE table_schema='{lab.database}'"])[0]),
            'source': 'structure-only dump of the local development database (no rows)'}

        # ---- stage A: the switch unset -------------------------------------------------------
        report['stage'] = 'default_off'
        lab.start(enabled=False)
        off = {}
        status, body, headers = lab.call('GET', '/api/auth/sso/capability')
        off['capability'] = {'status': status, 'available': body.get('available'),
                             'cache_control': headers.get('Cache-Control')}
        status, body, _ = lab.exchange(issuer, student_payload('lab-uuid-off-0001'))
        off['exchange'] = {'status': status, 'code': (body.get('error') or {}).get('code')}
        status, body, _ = lab.consume('a' * 43)
        off['consume'] = {'status': status, 'code': (body.get('error') or {}).get('code')}
        # The legacy endpoint must behave exactly as it did before this branch existed.
        status, body, _ = lab.call('POST', '/api/auth/sso', body={'uuid': 'lab-uuid-off-0001'})
        off['legacy_sso'] = {'status': status, 'message': str(body.get('message') or body.get('error'))[:60]}
        off['redis_keys'] = int(docker('exec', lab.redis_container, 'redis-cli', 'dbsize').split()[-1])
        report['stages']['default_off'] = off
        need(off['capability']['available'] is False, 'capability_open_while_off')
        need(off['exchange']['code'] == 'student_entry_disabled' and off['exchange']['status'] == 503, 'exchange_open_while_off')
        need(off['consume']['code'] == 'student_entry_disabled', 'consume_open_while_off')
        need(off['redis_keys'] == 0, 'redis_touched_while_off')
        lab.stop()

        # ---- stage B: switched on, the ordinary path ------------------------------------------
        report['stage'] = 'happy_path'
        lab.start(enabled=True)
        first_uuid = lab_uuid(1)
        status, body, headers = lab.exchange(issuer, student_payload(first_uuid))
        need(status == 200, 'exchange_refused_' + str((body.get('error') or {}).get('code')))
        ticket = body['handoff']
        users = lab.sql(["SELECT id,username,uuid,role,uuid_source,group_id,credits_quota,status,remark,tag_count "
                         "FROM users WHERE uuid='" + first_uuid + "'"])[0]
        tags = lab.sql(["SELECT t.name FROM user_tag_relations r JOIN user_tags t ON t.id=r.tag_id "
                        "JOIN users u ON u.id=r.user_id WHERE u.uuid='" + first_uuid + "' ORDER BY t.name"])[0]
        pool = lab.sql([f'SELECT credits_pool,credits_pool_used FROM user_groups WHERE id={STUDENT_GROUP}'])[0][0]
        status, session, session_headers = lab.consume(ticket)
        need(status == 200, 'consume_refused')
        second_status, second_body, _ = lab.consume(ticket)
        happy = {
            'exchange': {'status': 200, 'handoff_shape': bool(re.fullmatch(r'[A-Za-z0-9_-]{43}', ticket)),
                         'cache_control': headers.get('Cache-Control'),
                         'body_keys': sorted(body.keys()),
                         'carries_uuid': first_uuid in json.dumps(body),
                         'carries_token': 'accessToken' in json.dumps(body)},
            'account': {**users[0], 'tags': [row['name'] for row in tags]},
            'pool': pool,
            'consume': {'status': status, 'has_access_token': bool(session.get('accessToken')),
                        'has_refresh_token': 'refreshToken' in session,
                        'landing': session.get('landing'), 'context': session.get('context'),
                        'cache_control': session_headers.get('Cache-Control'),
                        'username': (session.get('user') or {}).get('username'),
                        'permissions': len(session.get('permissions') or [])},
            'second_consume': {'status': second_status, 'code': (second_body.get('error') or {}).get('code')}
        }
        report['stages']['happy_path'] = happy
        need(happy['account']['credits_quota'] == 100 and pool['credits_pool_used'] == 100, 'issuance_not_from_pool')
        need(happy['account']['tags'] == ['年级:初一', '班级:1班'], 'tags_not_written')
        need(happy['consume']['has_refresh_token'] is False, 'refresh_token_issued_by_default')
        need(happy['consume']['landing'] == {'entry': 'ai-practice.chat'}, 'landing_not_returned')
        need(happy['consume']['context'] == {'lesson_id': '456', 'assignment_id': None}, 'context_lost')
        need(happy['second_consume']['code'] == 'handoff_invalid', 'handoff_reusable')
        need(happy['exchange']['carries_uuid'] is False and happy['exchange']['carries_token'] is False,
             'exchange_leaks_identity')
        student_token = session['accessToken']

        # ---- stage C: every refusal, on the real chain ----------------------------------------
        report['stage'] = 'refusals'
        raw, good = issuer.sign(student_payload(lab_uuid(2)))
        cases = {}

        def record(name, status, body, expect):
            code = (body.get('error') or {}).get('code') if isinstance(body, dict) else None
            cases[name] = {'status': status, 'code': code}
            need(code == expect, f'{name}_expected_{expect}_got_{code}')

        status, body, _ = lab.call('POST', '/api/auth/sso/exchange', raw=raw,
                                   headers={**good, 'X-Edu-Signature': 'a' * 64})
        record('wrong_signature', status, body, 'invalid_signature')
        status, body, _ = lab.exchange(issuer, student_payload(lab_uuid(2)),
                                       timestamp=int(time.time()) - 1200)
        record('stale_timestamp', status, body, 'stale_timestamp')
        replay_nonce = base64.urlsafe_b64encode(os.urandom(18)).decode().rstrip('=')
        status, body, _ = lab.exchange(issuer, student_payload(lab_uuid(3)), nonce=replay_nonce)
        need(status == 200, 'first_use_of_nonce_refused')
        status, body, _ = lab.exchange(issuer, student_payload(lab_uuid(3)), nonce=replay_nonce)
        record('replayed_nonce', status, body, 'replay_detected')
        status, body, _ = lab.exchange(issuer, student_payload(lab_uuid(4)),
                                       secret=secrets.token_urlsafe(40))
        record('wrong_secret', status, body, 'invalid_signature')
        status, body, _ = lab.exchange(issuer, student_payload(
            lab_uuid(5), landing={'entry': 'admin'}))
        record('entry_not_allowed', status, body, 'entry_not_allowed')
        status, body, _ = lab.exchange(issuer, student_payload(
            lab_uuid(6), subject={'uuid': lab_uuid(6), 'cohort': 'teacher', 'status': 'active'}))
        record('teacher_cohort', status, body, 'cohort_not_supported')
        status, body, _ = lab.exchange(issuer, student_payload(
            lab_uuid(7), subject={'uuid': lab_uuid(7), 'cohort': 'student', 'status': 'suspended'}))
        record('subject_not_active', status, body, 'subject_disabled')
        status, body, _ = lab.exchange(issuer, student_payload(lab_uuid(8), org={'school_ref': '999'}))
        record('school_not_mapped', status, body, 'school_not_provisioned')
        status, body, _ = lab.exchange(issuer, student_payload(lab_uuid(9), org={'school_ref': '789'}))
        record('school_group_inactive', status, body, 'school_not_provisioned')
        status, body, _ = lab.exchange(issuer, student_payload('lab-teacher-uuid-0001'))
        record('teacher_account_claimed', status, body, 'subject_not_student')
        status, body, _ = lab.exchange(issuer, student_payload('lab-blocked-uuid-0001'))
        record('disabled_account', status, body, 'subject_disabled')
        extra = json.dumps({'schema_version': 1, 'platform_key': 'edu', 'extra_field': 'x',
                            **student_payload(lab_uuid(10))}, ensure_ascii=False,
                           separators=(',', ':')).encode()
        raw_extra, headers_extra = issuer.sign({}, body=extra)
        status, body, _ = lab.call('POST', '/api/auth/sso/exchange', raw=raw_extra, headers=headers_extra)
        record('unknown_field', status, body, 'invalid_request')
        status, body, _ = lab.consume('not-a-ticket')
        record('bad_ticket_shape', status, body, 'handoff_invalid')
        status, body, _ = lab.consume('b' * 43)
        record('unknown_ticket', status, body, 'handoff_invalid')
        # Nothing above may have created an account.
        leftovers = lab.sql([f"SELECT COUNT(*) AS n FROM users WHERE uuid LIKE '0000%' "
                             f"AND uuid NOT IN ('{lab_uuid(1)}','{lab_uuid(3)}')"])[0][0]['n']
        need(int(leftovers) == 0, 'refusal_created_account')
        cases['accounts_created_by_refusals'] = int(leftovers)
        report['stages']['refusals'] = cases

        # ---- stage D: the source address boundary ---------------------------------------------
        report['stage'] = 'source_boundary'
        lab.stop()
        lab.write_config({**C05_CONFIG, 'school_groups': {'123': STUDENT_GROUP}, 'trusted_proxy_hops': 0})
        lab.start(enabled=True, label='ip')
        # A forwarded header from an unlisted client cannot move the source address: the socket is
        # 127.0.0.1 (allowed) and stays 127.0.0.1, so a spoofed header changes nothing.
        raw, headers = issuer.sign(student_payload(lab_uuid(20)))
        status, body, _ = lab.call('POST', '/api/auth/sso/exchange', raw=raw,
                                   headers={**headers, 'X-Forwarded-For': '203.0.113.9'})
        spoofed = {'status': status, 'code': (body.get('error') or {}).get('code') if status != 200 else None}
        need(status == 200, 'forwarded_header_changed_the_source')
        lab.stop()
        # With the loopback address removed from the whitelist, the same request is refused: the check
        # is real, not a formality that happens to pass.
        lab.write_config({**C05_CONFIG, 'school_groups': {'123': STUDENT_GROUP}})
        lab.sql([{'sql': "UPDATE system_settings SET setting_value = REPLACE(setting_value, '127.0.0.1', '10.0.0.7') "
                         "WHERE setting_key='sso_config'"}])
        lab.start(enabled=True, label='ip-denied')
        status, body, _ = lab.exchange(issuer, student_payload(lab_uuid(21)))
        denied = {'status': status, 'code': (body.get('error') or {}).get('code')}
        need(denied['code'] == 'ip_not_allowed', 'whitelist_not_enforced')
        report['stages']['source_boundary'] = {'spoofed_forwarded_header': spoofed, 'not_whitelisted': denied}
        lab.stop()

        # ---- stage E: Redis loss ----------------------------------------------------------------
        report['stage'] = 'storage_loss'
        lab.write_config(C05_CONFIG)
        lab.start(enabled=True, label='redis')
        status, body, _ = lab.exchange(issuer, student_payload(lab_uuid(30)))
        need(status == 200, 'baseline_exchange_refused')
        live_ticket = body['handoff']
        lab.redis_stop()
        time.sleep(3)
        status, body, _ = lab.exchange(issuer, student_payload(lab_uuid(31)))
        lost_exchange = {'status': status, 'code': (body.get('error') or {}).get('code')}
        status, body, _ = lab.consume(live_ticket)
        lost_consume = {'status': status, 'code': (body.get('error') or {}).get('code')}
        created_while_down = lab.sql([f"SELECT COUNT(*) AS n FROM users WHERE uuid='{lab_uuid(31)}'"])[0][0]['n']
        lab.redis_start()
        # The client's reconnect budget is a deployment setting, not something this entry decides, so the
        # server is restarted rather than pretending to know when it would have come back by itself.
        lab.stop()
        lab.start(enabled=True, label='redis-back')
        status, body, _ = lab.exchange(issuer, student_payload(lab_uuid(32)))
        recovered = {'status': status, 'code': (body.get('error') or {}).get('code') if status != 200 else None}
        report['stages']['storage_loss'] = {'exchange': lost_exchange, 'consume': lost_consume,
                                            'accounts_created_while_down': int(created_while_down),
                                            'after_restart': recovered}
        need(lost_exchange['code'] == 'storage_unavailable' and int(created_while_down) == 0, 'redis_loss_not_closed')
        need(lost_consume['code'] in ('storage_unavailable', 'handoff_invalid'), 'consume_open_without_redis')
        need(recovered['status'] == 200, 'entry_did_not_recover')

        # ---- stage F: concurrency ---------------------------------------------------------------
        report['stage'] = 'concurrency'
        race_uuid = lab_uuid(40)
        pool_before_race = int(lab.sql(
            [f'SELECT credits_pool_used FROM user_groups WHERE id={STUDENT_GROUP}'])[0][0]['credits_pool_used'])
        results = []
        lock = threading.Lock()

        def first_login():
            outcome = lab.exchange(issuer, student_payload(race_uuid))
            with lock:
                results.append(outcome)

        threads = [threading.Thread(target=first_login) for _ in range(4)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=60)
        accounts = lab.sql([f"SELECT id,username,credits_quota FROM users WHERE uuid='{race_uuid}'"])[0]
        pool_after = lab.sql([f'SELECT credits_pool_used FROM user_groups WHERE id={STUDENT_GROUP}'])[0][0]
        tickets = [body['handoff'] for status, body, _ in results if status == 200]
        need(tickets, 'no_parallel_first_login_succeeded')
        need(len(accounts) == 1, 'concurrent_first_login_made_two_accounts')
        # Whatever the pool could afford, it may be charged for this student exactly once: the account's
        # balance and the pool's movement are the same number.
        charged = int(pool_after['credits_pool_used']) - pool_before_race
        need(int(accounts[0]['credits_quota']) == charged, 'concurrent_first_login_charged_a_different_amount')
        need(charged <= 100, 'concurrent_first_login_granted_more_than_once')
        # One handoff, spent by two browsers at the same time: exactly one may win.
        double = []

        def spend(ticket):
            outcome = lab.consume(ticket)
            with lock:
                double.append(outcome)

        spenders = [threading.Thread(target=spend, args=(tickets[0],)) for _ in range(3)]
        for thread in spenders:
            thread.start()
        for thread in spenders:
            thread.join(timeout=60)
        winners = [status for status, _, _ in double if status == 200]
        need(len(winners) == 1, 'handoff_spent_more_than_once')
        report['stages']['concurrency'] = {
            'parallel_first_logins': len(results), 'exchanges_succeeded': len(tickets),
            'refusals': sorted({(body.get('error') or {}).get('code') or str(status)
                                for status, body, _ in results if status != 200}),
            'accounts': len(accounts), 'granted': int(accounts[0]['credits_quota']),
            'pool_charged': charged, 'pool_used_after': int(pool_after['credits_pool_used']),
            'parallel_consumes': len(double), 'consumes_succeeded': len(winners)}

        # ---- stage G: username conflict and a returning student --------------------------------
        report['stage'] = 'conflict_and_return'
        clash_uuid = lab_uuid(50)
        taken = 's_' + clash_uuid.replace('-', '')[:16]
        lab.sql([{'sql': '''INSERT INTO users(uuid,uuid_source,email,username,password_hash,role,group_id,status,
                            token_quota,credits_quota,used_credits) VALUES(?,?,?,?,?,?,?,?,10000,0,0)''',
                  'params': [str(uuid.uuid4()), 'system', 'clash@lab.local', taken, 'not-a-password',
                             'user', STUDENT_GROUP, 'active']}])
        status, body, _ = lab.exchange(issuer, student_payload(clash_uuid))
        need(status == 200, 'username_conflict_not_resolved')
        clashed = lab.sql([f"SELECT username FROM users WHERE uuid='{clash_uuid}'"])[0][0]
        # The same student comes back after changing class: the tags follow, the balance does not move.
        lab.sql([f"UPDATE users SET used_credits = 30 WHERE uuid='{first_uuid}'"])
        status, body, _ = lab.exchange(issuer, student_payload(
            first_uuid, org={'school_ref': '123', 'grade_name': '初二', 'class_name': '3班'}))
        need(status == 200, 'returning_student_refused')
        returned = lab.sql([f"SELECT credits_quota,used_credits,remark FROM users WHERE uuid='{first_uuid}'"])[0][0]
        returned_tags = lab.sql(["SELECT t.name FROM user_tag_relations r JOIN user_tags t ON t.id=r.tag_id "
                                 f"JOIN users u ON u.id=r.user_id WHERE u.uuid='{first_uuid}' ORDER BY t.name"])[0]
        pool_stable = lab.sql([f'SELECT credits_pool_used FROM user_groups WHERE id={STUDENT_GROUP}'])[0][0]
        need(int(returned['credits_quota']) == 100 and int(returned['used_credits']) == 30, 'returning_login_reset_balance')
        need([row['name'] for row in returned_tags] == ['年级:初二', '班级:3班'], 'returning_tags_not_overwritten')
        report['stages']['conflict_and_return'] = {
            'taken_username': taken, 'assigned_username': clashed['username'],
            'returning': {**returned, 'tags': [row['name'] for row in returned_tags],
                          'pool_used': int(pool_stable['credits_pool_used'])}}

        # ---- stage H: a school change moves the student and the unspent credits ------------------
        report['stage'] = 'school_change'
        lab.stop()
        lab.write_config({**C05_CONFIG, 'school_groups': {'123': STUDENT_GROUP, '456': OTHER_SCHOOL_GROUP}})
        lab.start(enabled=True, label='move')
        before = lab.sql([f'SELECT credits_pool_used FROM user_groups WHERE id={STUDENT_GROUP}'])[0][0]
        status, body, _ = lab.exchange(issuer, student_payload(
            first_uuid, org={'school_ref': '456', 'grade_name': '初二', 'class_name': '2班'}))
        need(status == 200, 'school_change_refused')
        moved = lab.sql([f"SELECT group_id,credits_quota,used_credits FROM users WHERE uuid='{first_uuid}'"])[0][0]
        pools = lab.sql([f'SELECT id,credits_pool_used FROM user_groups WHERE id IN ({STUDENT_GROUP},{OTHER_SCHOOL_GROUP}) ORDER BY id'])[0]
        need(int(moved['group_id']) == OTHER_SCHOOL_GROUP and int(moved['credits_quota']) == 0, 'student_not_moved')
        need(int(pools[0]['credits_pool_used']) == int(before['credits_pool_used']) - 70, 'remainder_not_recycled')
        report['stages']['school_change'] = {'user': moved,
                                             'pool_before': int(before['credits_pool_used']),
                                             'pools_after': {str(row['id']): int(row['credits_pool_used']) for row in pools}}

        # ---- stage I: the undecided values close the entry by name --------------------------------
        report['stage'] = 'undecided_values'
        lab.stop()
        without = {key: value for key, value in C05_CONFIG.items() if key != 'issuance'}
        lab.write_config({**without, 'group_change': 'refuse'})
        lab.start(enabled=True, label='no-policy')
        status, body, _ = lab.exchange(issuer, student_payload(lab_uuid(60)))
        missing_policy = {'status': status, 'code': (body.get('error') or {}).get('code')}
        status, body, _ = lab.exchange(issuer, student_payload(
            first_uuid, org={'school_ref': '123', 'grade_name': '初二', 'class_name': '2班'}))
        refused_move = {'status': status, 'code': (body.get('error') or {}).get('code')}
        created = lab.sql([f"SELECT COUNT(*) AS n FROM users WHERE uuid='{lab_uuid(60)}'"])[0][0]['n']
        still = lab.sql([f"SELECT group_id FROM users WHERE uuid='{first_uuid}'"])[0][0]
        need(missing_policy['code'] == 'issuance_policy_missing' and int(created) == 0, 'missing_policy_not_closed')
        need(refused_move['code'] == 'group_change_refused' and int(still['group_id']) == OTHER_SCHOOL_GROUP,
             'refused_move_changed_something')
        report['stages']['undecided_values'] = {'first_login_without_issuance': missing_policy,
                                                'school_change_while_refusing': refused_move,
                                                'accounts_created': int(created)}
        lab.stop()

        # ---- stage J: the candidate migration, up and down ---------------------------------------
        report['stage'] = 'candidate_migration'
        # knex checks its own history against the directory it is given, so the real migrations are
        # copied beside the candidate: the candidate is applied on top of the schema as it actually is.
        migrations = Path(scratch) / 'migrations-c05'
        shutil.copytree(ROOT / 'backend/migrations', migrations)
        candidate = ROOT / 'backend/migrations-candidates/c05/20260923_001_c05_school_mapping.js'
        (migrations / candidate.name).write_text(candidate.read_text())
        applied = node(NODE_KNEX, {'port': lab.mysql['port'], 'user': lab.app_user, 'password': lab.app_password,
                                   'database': lab.database, 'directory': str(migrations)})
        report['stages']['candidate_migration'] = {'applied': applied}
        need(applied.get('ok') and applied['result']['files'] == [candidate.name], 'candidate_migration_failed')
        columns = lab.sql(["SELECT column_name AS name FROM information_schema.columns WHERE table_schema=DATABASE() "
                           "AND table_name='user_groups' AND column_name IN ('edu_school_id','cohort') ORDER BY 1"])[0]
        # Re-running it must be a no-op, not a second ALTER.
        again = node(NODE_KNEX, {'port': lab.mysql['port'], 'user': lab.app_user, 'password': lab.app_password,
                                 'database': lab.database, 'directory': str(migrations)})
        lab.sql([f"UPDATE user_groups SET edu_school_id='123', cohort='student' WHERE id={STUDENT_GROUP}"])
        # `down` refuses while a school is still mapped: the mapping is the only record of which group
        # belongs to which school, and dropping the column would delete it silently.
        refused_down = node(NODE_KNEX, {'port': lab.mysql['port'], 'user': lab.app_user, 'password': lab.app_password,
                                        'database': lab.database, 'directory': str(migrations), 'down': True})
        need(refused_down.get('ok') is False and 'c05_school_mapping_in_use' in refused_down.get('error', ''),
             'down_dropped_a_live_mapping')
        # With the columns applied, the provider can take the school from the row instead of the config.
        lab.write_config({**C05_CONFIG, 'school_source': 'database', 'school_groups': {}})
        lab.start(enabled=True, label='db-mapping')
        status, body, _ = lab.exchange(issuer, student_payload(lab_uuid(70)))
        from_database = {'status': status, 'code': (body.get('error') or {}).get('code') if status != 200 else None}
        need(status == 200, 'database_mapping_not_used')
        status, body, _ = lab.exchange(issuer, student_payload(lab_uuid(71), org={'school_ref': '456'}))
        unmapped = {'status': status, 'code': (body.get('error') or {}).get('code')}
        need(unmapped['code'] == 'school_not_provisioned', 'unmapped_school_accepted_from_database')
        lab.stop()
        lab.sql([f"UPDATE user_groups SET edu_school_id=NULL, cohort=NULL WHERE id={STUDENT_GROUP}"])
        rolled_back = node(NODE_KNEX, {'port': lab.mysql['port'], 'user': lab.app_user, 'password': lab.app_password,
                                       'database': lab.database, 'directory': str(migrations), 'down': True})
        after_down = lab.sql(["SELECT column_name AS name FROM information_schema.columns WHERE table_schema=DATABASE() "
                              "AND table_name='user_groups' AND column_name IN ('edu_school_id','cohort')"])[0]
        need(rolled_back.get('ok') and len(after_down) == 0, 'down_left_the_columns')
        # Asking for the database mapping without the columns refuses rather than falling back.
        lab.start(enabled=True, label='db-mapping-gone')
        status, body, _ = lab.exchange(issuer, student_payload(lab_uuid(72)))
        without_columns = {'status': status, 'code': (body.get('error') or {}).get('code')}
        need(without_columns['code'] == 'config_invalid', 'missing_columns_fell_back_to_config')
        report['stages']['candidate_migration'] = {
            'applied': applied['result'], 'columns': [row['name'] for row in columns],
            'second_run': again.get('result'), 'down_while_mapped': refused_down,
            'exchange_from_database_mapping': from_database, 'unmapped_school': unmapped,
            'down': rolled_back.get('result'), 'columns_after_down': len(after_down),
            'database_source_without_columns': without_columns}
        lab.stop()

        # ---- stage K: what the session does and does not authorize --------------------------------
        report['stage'] = 'session_boundary'
        lab.write_config(C05_CONFIG)
        lab.start(enabled=True, label='session')
        status, body, _ = lab.exchange(issuer, student_payload(
            lab_uuid(80), context={'lesson_id': '456', 'assignment_id': '77'}))
        need(status == 200, 'context_exchange_refused')
        status, session, _ = lab.consume(body['handoff'])
        need(status == 200, 'context_consume_refused')
        student_token = session['accessToken']
        auth = {'Authorization': 'Bearer ' + student_token}
        me_status, me_body, _ = lab.call('GET', '/api/auth/me', headers=auth)
        p09_status, p09_body, _ = lab.call('GET', '/api/p09/website-artifacts/capability', headers=auth)
        link_status, link_body, _ = lab.call('POST', '/api/p09/website-artifacts/links',
                                             body={'project_id': 1}, headers=auth)
        admin_status, admin_body, _ = lab.call('GET', '/api/admin/users', headers=auth)
        need(me_status == 200, 'session_not_usable')
        need(p09_body.get('available') is False or p09_status != 200, 'login_turned_p09_on')
        need(link_status >= 400, 'login_associated_a_work_by_itself')
        need(admin_status >= 400, 'student_session_reached_admin')
        report['stages']['session_boundary'] = {
            'context_in_session': session.get('context'),
            'me': {'status': me_status, 'username': ((me_body.get('data') or {}).get('user') or {}).get('username')},
            'p09_capability': {'status': p09_status, 'available': p09_body.get('available')},
            'p09_link_without_its_own_confirmation': {'status': link_status,
                                                      'code': (link_body.get('error') or {}).get('code')},
            'admin': {'status': admin_status}}

        # With P09 switched on as well, the same session reaches the entry but still cannot associate a
        # work: association needs the signed task context edu issues and the student's own confirmation.
        # (P09 itself is not re-verified here — this is only the boundary between the two packages.)
        lab.stop()
        p09_migrations = Path(scratch) / 'migrations-p09'
        shutil.copytree(ROOT / 'backend/migrations', p09_migrations)
        p09_candidate = ROOT / 'backend/migrations-candidates/p09/20260922_001_p09_website_artifacts.js'
        (p09_migrations / p09_candidate.name).write_text(p09_candidate.read_text().replace(
            "require('../../src/services/websiteArtifact/store')",
            'require(' + json.dumps(str(ROOT / 'backend/src/services/websiteArtifact/store')) + ')'))
        p09_applied = node(NODE_KNEX, {'port': lab.mysql['port'], 'user': lab.app_user, 'password': lab.app_password,
                                       'database': lab.database, 'directory': str(p09_migrations)})
        need(p09_applied.get('ok'), 'p09_ledger_not_available_for_the_boundary_check')
        # P09 insists on its own restricted database role; the boundary check runs the real runtime, so
        # the role is created here exactly as the P09 acceptance does.
        ledger_user = 'c05_led_' + secrets.token_hex(3)
        ledger_password = secrets.token_urlsafe(24)
        lab.sql([f"CREATE USER '{ledger_user}'@'%' IDENTIFIED BY '{ledger_password}'"], database=None)
        grants = node("const {restrictedRoleGrants}=require('./backend/src/services/websiteArtifact/store');"
                      "let s='';process.stdin.on('data',b=>s+=b).on('end',()=>{const c=JSON.parse(s);"
                      "process.stdout.write(JSON.stringify(restrictedRoleGrants(c)));});",
                      {'database': lab.database, 'user': ledger_user, 'host': '%',
                       'sourceTables': ['users', 'html_projects', 'html_pages']})
        lab.sql(grants, database=None)
        lab.extra_secrets.append(ledger_password)
        lab_file = Path(scratch) / 'p09-lab.json'
        lab_file.write_text(json.dumps({'source_instance': 'c05-lab',
                                        'issuers': [{'issuer': 'edu', 'key_id': 'k1', 'secret': secrets.token_urlsafe(40),
                                                     'purposes': ['website_artifact_link']}]}))
        lab.start(enabled=True, label='p09-boundary',
                  extra={'P09_WEBSITE_ARTIFACTS_ENABLED': 'true', 'P09_LAB': str(lab_file),
                         'P09_DB_USER': ledger_user, 'P09_DB_PASSWORD': ledger_password})
        status, body, _ = lab.exchange(issuer, student_payload(
            lab_uuid(81), context={'lesson_id': '456', 'assignment_id': '77'}))
        need(status == 200, 'boundary_exchange_refused')
        status, session2, _ = lab.consume(body['handoff'])
        need(status == 200, 'boundary_consume_refused')
        auth2 = {'Authorization': 'Bearer ' + session2['accessToken']}
        on_status, on_body, _ = lab.call('GET', '/api/p09/website-artifacts/capability', headers=auth2)
        no_grant = lab.call('POST', '/api/p09/website-artifacts/links',
                            body={'schema_version': 1, 'project_id': 1, 'entry_page_id': 1},
                            headers={**auth2, 'Idempotency-Key': str(uuid.uuid4())})
        report['stages']['session_boundary']['with_p09_on'] = {
            'capability': {'status': on_status, 'available': on_body.get('available')},
            'link_without_task_context': {'status': no_grant[0],
                                          'code': (no_grant[1].get('error') or {}).get('code')}}
        need(on_body.get('available') is True, 'p09_not_reachable_with_the_c05_session')
        need(no_grant[0] >= 400 and (no_grant[1].get('error') or {}).get('code') != 'unauthenticated',
             'c05_session_associated_a_work_without_its_own_confirmation')
        lab.stop()
        lab.start(enabled=True, label='browser')

        # ---- stage L: the browser, at four widths -------------------------------------------------
        report['stage'] = 'browser'
        web = Web(lab.api_port, scratch)
        browser = Browser(scratch, web.url, EVIDENCE)
        widths = {}
        report['stages']['browser'] = {'widths': widths}
        for width, height, name in WIDTHS:
            viewport = {'width': width, 'height': height}
            login = browser.call('login', viewport=viewport, screenshot=f'login-{name}')
            need(login['entry_visible'] is True, f'login_entry_missing_{name}')
            need(login['href'] == C05_CONFIG['launch_url'], f'login_entry_wrong_target_{name}')
            failure_page = browser.call('login', viewport=viewport, query='?error=sso_invalid',
                                        screenshot=f'login-failed-{name}')
            status, body, _ = lab.exchange(issuer, student_payload(lab_uuid(900 + WIDTHS.index((width, height, name)))))
            need(status == 200, f'browser_exchange_refused_{name}')
            landed = browser.call('consume', viewport=viewport, handoff=body['handoff'],
                                  screenshot=f'consume-{name}', wait=3200)
            widths[name] = {'login': {'entry_visible': login['entry_visible'], 'href': login['href'],
                                      'password_form': login['password_form'], 'errors': login['errors']},
                            'login_after_failure': {'failure_notice': failure_page['failure_notice']},
                            'consume': {'path': landed['path'], 'navigations': landed['navigations'],
                                        'url_has_handoff': landed['url_has_handoff'],
                                        'session': landed['session'], 'requests': landed['requests'],
                                        'errors': landed['errors']}}
            need(landed['session'] and landed['session']['authenticated'] is True, f'browser_no_session_{name}')
            need(landed['url_has_handoff'] is False, f'browser_handoff_left_in_url_{name}')
            # The page routes to the entry edu asked for. Where the app goes from there is the platform's
            # own decision: this laboratory database has no modules enabled, so /chat sends the student
            # on to the dashboard. Both steps are recorded rather than one being asserted away.
            need('/chat' in landed['navigations'], f'browser_did_not_route_to_entry_{name}')
            need(landed['path'] != '/auth/sso/consume', f'browser_stayed_on_consume_{name}')
            need(landed['session']['has_refresh'] is False, f'browser_got_refresh_token_{name}')
            need(all(item['body_has_handoff'] and not item['query_has_handoff']
                     for item in landed['requests'] if item['path'].endswith('/consume')),
                 f'browser_sent_handoff_in_url_{name}')
            # The same ticket in a second browser: it is already spent, so the page says so. The wait is
            # shorter than the page's own 2.5s return to the login page, so the notice is what is seen.
            spent = browser.call('consume', viewport=viewport, handoff=body['handoff'],
                                 wait=1200, screenshot=f'consume-spent-{name}')
            need(spent['failed_notice'] is True or spent['path'].startswith('/login'),
                 f'browser_reused_handoff_{name}')
            need(spent['session'] is None or spent['session'].get('authenticated') is not True
                 or spent['failed_notice'] is True, f'browser_second_use_created_a_session_{name}')
            widths[name]['second_use'] = {'failed_notice': spent['failed_notice'], 'path': spent['path']}
        externals = browser.call('externals')
        report['stages']['browser']['external_origins'] = externals['external']
        report['stages']['browser']['screenshots'] = sorted(path.name for path in EVIDENCE.glob('*.png'))
        need(externals['external'] == [], 'browser_reached_an_external_origin')

        # The login page with the entry switched off: the component renders nothing at all.
        lab.stop()
        lab.start(enabled=False, label='off-browser')
        off_page = browser.call('login', viewport={'width': 1280, 'height': 900}, screenshot='login-switched-off')
        need(off_page['entry_visible'] is False, 'login_entry_visible_while_off')
        need(off_page['password_form'] is True, 'login_page_broken_while_off')
        report['stages']['browser']['switched_off'] = {'entry_visible': off_page['entry_visible'],
                                                       'password_form': off_page['password_form']}

        # ---- stage M: what the logs may and may not contain ---------------------------------------
        report['stage'] = 'logs'
        logs = ''
        for path in sorted(Path(scratch).glob('backend-*.log')):
            logs += path.read_text(errors='replace')
        forbidden = {'issuer_secret': lab.issuer_secret, 'jwt_secret': lab.jwt_secret,
                     'db_password': lab.app_password, 'student_uuid': first_uuid,
                     'handoff': ticket, 'access_token': student_token,
                     'display_name': '王小明'}
        found = {name: (value in logs) for name, value in forbidden.items()}
        need(not any(found.values()), 'sensitive_value_in_logs_' + ','.join(k for k, v in found.items() if v))
        report['stages']['logs'] = {'bytes': len(logs), 'searched_for': sorted(forbidden), 'found': found,
                                    'c05_lines': len([line for line in logs.splitlines() if 'C05' in line])}
        report['passed'] = True
        report['stage'] = 'done'
    except Exception as error:
        report['failure'] = f'{type(error).__name__}: {error}'
        raise
    finally:
        report['finished_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        EVIDENCE.mkdir(parents=True, exist_ok=True)
        text = json.dumps(report, ensure_ascii=False, indent=2)
        for value in (lab.secrets() if lab else []):
            text = text.replace(value, '<redacted>')
        (EVIDENCE / 'report.json').write_text(text + '\n')
        for component in (browser, web):
            if component:
                try:
                    component.close()
                except Exception:
                    pass
        if lab:
            lab.stop()
            for container in (lab.mysql_container, lab.redis_container):
                if container:
                    subprocess.run(['docker', 'rm', '-f', container], capture_output=True, timeout=120)
        subprocess.run(['rm', '-rf', scratch], timeout=60)
        print(json.dumps({'passed': report['passed'], 'stage': report['stage'],
                          'failure': report.get('failure'), 'evidence': str(EVIDENCE)}, ensure_ascii=False))


if __name__ == '__main__':
    main()

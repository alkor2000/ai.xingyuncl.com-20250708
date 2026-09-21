"""Same-version triad case runner: P03 MySQL source -> native Identity provider -> unmodified T11 cmd/t11-lab.

Invoked per case by Identity's current-triad Go overlay (provider_test.go.txt, unchanged) through
I03_TRIAD_DRIVER. Derived from Identity's dev/i03/current-triad/scenarios.py (7b07fbf5…): the file spool
is replaced by the MySQL-backed worker, cmd/server by cmd/t11-lab stdin commands, HTTP fixture SQL by
docker exec psql on the isolated target container. Draft wire i03-draft-0.1. Source and Identity run on wall time;
t11-lab pins its clock to the case start second (its own design), so no side sees a future or expired deadline.
Only synthetic facts; credentials arrive on stdin and never enter argv, logs or evidence.
"""
import base64
from contextlib import closing
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import secrets
import select
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import uuid

HERE = Path(__file__).resolve().parent


def need(value, label):
    if not value:
        raise RuntimeError(label)


class Source:
    """The MySQL-backed P03 worker on the native draft profile with wall clock."""

    def __init__(self, c, mysql, identity, target):
        self.root, self.process = c['practice_root'], None
        self.config = dict(mysql=mysql, identityOrigin=identity, targetOrigin=target, authorization=c['source_auth'],
                           owner='p-teacher', endpointProfile='native-draft', wallClock=True)
        self.start()

    def start(self):
        self.process = subprocess.Popen(['node', str(Path(self.root) / 'dev/p03-mysql-worker.cjs')], cwd=self.root,
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        need(self.call('init', **self.config) == {'ready': True, 'owner': 'p-teacher'}, 'source_init_failed')
        self.config['mysql']['initialize'] = False  # shared dict: later processes on this database skip DDL and seeding

    def call(self, command, expected=None, **fields):
        self.process.stdin.write(json.dumps(dict(command=command, now=int(time.time()) * 1000, **fields)) + '\n')
        self.process.stdin.flush()
        need(select.select([self.process.stdout], [], [], 30)[0], 'source_timeout')
        response = json.loads(self.process.stdout.readline())
        code = response.get('code', 'no_error')
        if not isinstance(code, str) or not code.replace('_', '').isalnum():
            code = 'unclassified'
        if expected:
            need(response == {'ok': False, 'code': expected}, 'source_error_mismatch_' + code)
            return
        need(response.get('ok'), 'source_operation_failed_' + code)
        return response['result']

    def close(self):
        if self.process:
            self.process.kill()
            self.process.wait(timeout=5)
            self.process.stdin.close()
            self.process.stdout.close()
            self.process = None


class Receiver:
    """Unmodified T11 cmd/t11-lab: real receiver store/handlers on the isolated PG16 target database."""

    def __init__(self, c):
        self.c, self.process, self.logs = c, None, []
        self.jwt_secret, self.key, self.other = secrets.token_hex(32), secrets.token_hex(32), str(uuid.uuid4())
        self.start()

    def read(self):
        need(select.select([self.process.stdout], [], [], 30)[0], 'receiver_timeout')
        line = self.process.stdout.readline()
        need(line, 'receiver_stopped')
        return json.loads(line)

    def start(self):
        c = self.c
        log = Path(c['scratch']) / f'receiver-{len(self.logs)}.log'
        self.logs.append(log)
        self.log_handle = log.open('w')
        self.process = subprocess.Popen([c['receiver']], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.log_handle, text=True,
                                        env={'PATH': '/usr/bin:/bin', 'HOME': c['scratch'], 'GORACE': 'atexit_sleep_ms=0'})
        setup = dict(dsn=c['target']['dsn'], identity_url=c['identity_url'] + '/backchannel/teacher-artifact-handoffs/v1/redeem',
                     target_secret=c['target_secret'], key=self.key, owner=c['owner'], other=self.other, clock=int(time.time()),
                     jwt_secret=self.jwt_secret, browser_origin='http://127.0.0.1:5197', address='127.0.0.1:0')
        self.process.stdin.write(json.dumps(setup) + '\n')
        self.process.stdin.flush()
        self.ready = self.read()
        need(self.ready.get('ready') is True and self.ready['url'].startswith('http://127.0.0.1:'), 'receiver_not_ready')
        self.url = self.ready['url']

    def call(self, command, **fields):
        self.process.stdin.write(json.dumps(dict(command=command, **fields)) + '\n')
        self.process.stdin.flush()
        return self.read()

    def sql(self, query):
        t = self.c['target']
        p = subprocess.run(['docker', 'exec', '-i', t['container'], 'psql', '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', t['database']],
                           input=query, text=True, capture_output=True)
        need(p.returncode == 0, 'target_sql_failed')
        return p.stdout.strip()

    def count(self, active=False):
        return int(self.sql(f"SELECT count(*) FROM teacher_artifact_resources WHERE owner_id='{self.c['owner']}'" + (' AND deleted_at IS NULL' if active else '')))

    def stop(self, crash=False):
        if self.process:
            if self.process.poll() is None:
                if crash:
                    self.process.kill()
                else:
                    self.process.stdin.close()  # scanner ends, run() returns nil
                try:
                    code = self.process.wait(timeout=12)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    code = self.process.wait(timeout=5)
                    need(False, 'receiver_stop_timeout')
                need(code == (-signal.SIGKILL if crash else 0), 'receiver_stop_failed')
            self.process = None
            self.log_handle.close()

    def check_logs(self):
        forbidden = [self.jwt_secret, self.key, self.c['target_secret'], self.c['source_auth']]
        for log in self.logs:
            raw = log.read_text(errors='replace')
            need(not any(x in raw for x in forbidden), 'secret_in_receiver_log')
            need('WARNING: DATA RACE' not in raw, 'receiver_race')


class Relay:
    """Byte-preserving loopback relay in front of the receiver: observation and owner-disable injection only."""

    def __init__(self, receiver, kind):
        self.events, self.error, self.kind = [], None, kind
        state = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                try:
                    need(not self.headers.get('Authorization'), 'source_credential_at_target')
                    raw = self.rfile.read(int(self.headers['Content-Length']))
                    host, port = receiver.url.replace('http://', '').split(':')
                    with closing(http.client.HTTPConnection(host, int(port), timeout=20)) as upstream:
                        headers = {k: v for k, v in self.headers.items() if k.lower() not in ('host', 'connection')}
                        upstream.request('POST', self.path, raw, headers)
                        reply = upstream.getresponse()
                        body = reply.read()
                        parsed = {}
                        try:
                            parsed = json.loads(body)
                        except Exception:
                            pass
                        state.events.append({'path': self.path.rsplit('/', 1)[-1], 'status': reply.status, 'schema_version': parsed.get('schema_version'),
                                             'code': (parsed.get('error') or {}).get('code'), 'retryable': (parsed.get('error') or {}).get('retryable'),
                                             'retry_after': reply.getheader('Retry-After')})
                        if self.path.endswith('/prepare') and kind == 'disable' and reply.status == 200:
                            receiver.sql(f"UPDATE users SET status='disabled' WHERE id='{receiver.c['owner']}'")
                        self.send_response(reply.status)
                        for k, v in reply.getheaders():
                            if k.lower() not in ('transfer-encoding', 'connection', 'content-length', 'server', 'date'):
                                self.send_header(k, v)
                        self.send_header('Content-Length', str(len(body)))
                        self.end_headers()
                        self.wfile.write(body)
                except Exception:
                    state.error = 'transport_relay_failed'
                    self.close_connection = True
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.server.server_port}'

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)


def fresh_database(c):
    mysql = dict(c['mysql'], database='p03_lab_' + secrets.token_hex(6), initialize=True, directory=c['scratch'],
                 app_user='p03_app_' + secrets.token_hex(6), app_password=secrets.token_urlsafe(24))
    create = """const mysql=require('./backend/node_modules/mysql2/promise');
let s='';process.stdin.on('data',b=>s+=b).on('end',async()=>{
 const c=JSON.parse(s); if(!/^p03_lab_[a-f0-9]{12}$/.test(c.database)||c.host!=='127.0.0.1')process.exit(1);
 const db=await mysql.createConnection({host:c.host,port:c.port,user:c.user,password:c.password});
 await db.query('CREATE DATABASE '+c.database+' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');await db.end();
});"""
    subprocess.run(['node', '-e', create], cwd=c['practice_root'], input=json.dumps(mysql), text=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=10)
    return mysql


def main():
    c = json.load(sys.stdin)
    case = c['case']
    receiver = worker = relay = None
    stage, passed, checks = 'setup', False, []

    def adopt(op, version):
        adopted = receiver.call('adopt', operation_id=op)
        snapshot = adopted.get('snapshot') or {}
        need(adopted.get('ok') is True and snapshot.get('version') == version and str(snapshot.get('text', '')).startswith('先观察，再记录两杯水的变化。'), 'adopted_snapshot_mismatch')
    report = {'case': case, 'passed': False, 'source_store': 'P03 MySQL 8 durable candidate (isolated container, restricted lab role)',
              'identity': 'native Provider/Registry/Links with pku_identity_app; Gin request ID; synthetic facts; draft policy',
              'target': 'unmodified T11 cmd/t11-lab on isolated PG16 (S05b post-schema + 20260921_03 migration)',
              'wire': 'i03-draft-0.1', 'clocks': 'source and Identity on wall time; t11-lab clock pinned to case start second (its design), advanced only by command'}
    with tempfile.TemporaryDirectory(prefix='p03-triad-case-') as directory:
        c['scratch'] = directory
        try:
            receiver = Receiver(c)
            stage = 'receiver_start'
            if case in ('target_disabled', 'error_envelope'):
                relay = Relay(receiver, 'disable' if case == 'target_disabled' else 'observe')
            mysql = fresh_database(c)
            stage = 'source_start'
            worker = Source(c, mysql, c['identity_url'], relay.url if relay else receiver.url)
            stage = 'freeze'
            op = worker.call('freeze')['operation_id']
            state = worker.call('state')
            packet = state['snapshots'][op]['packet']
            stage = 'transfer'
            if case in ('revoke', 'version', 'attachment'):
                error = {'revoke': 'source_permission_revoked', 'version': 'source_changed', 'attachment': 'attachment_unavailable'}[case]
                worker.call('after_prepare', kind=case)
                worker.call('resume', operation_id=op, expected=error)
                need(worker.call('status', operation_id=op)['status'] == 'cancelled', 'cancel_not_durable')
                need(receiver.count() == 0, 'unauthorized_resource_created')
                checks.append('post-prepare source mutation cancels; no private resource created')
            elif case == 'target_disabled':
                worker.call('resume', operation_id=op, expected='subject_disabled')
                need(receiver.count() == 0, 'disabled_owner_received')
                last = relay.events[-1]
                # Draft rule: error envelopes follow the common contract and do not require schema_version (success does).
                need(last['path'] == 'commit' and last['status'] == 403 and last['code'] == 'subject_disabled' and last['retryable'] is False
                     and last['schema_version'] in (None, 1), 'new_error_not_seen')
                report['target_error_envelope_schema_version'] = last['schema_version']
                checks.append('actual users disable after prepare denies commit via owner lock; safe error envelope (schema_version optional on errors)')
            elif case == 'error_envelope':
                receiver.sql(f"INSERT INTO teacher_artifact_imports(operation_id,owner_id,binding,binding_sha256,state,package,created_at,expires_at) SELECT gen_random_uuid(),'{c['owner']}','{{}}',repeat('a',64),'prepared',convert_to('{{}}','UTF8'),now(),now()+interval '1 hour' FROM generate_series(1,50)")
                for kind in ['invalid', 'rate']:
                    data = dict(source=c['practice_root'], identity=c['identity_url'], target=relay.url, authorization=c['source_auth'], kind=kind,
                                record=state['operations'][op], packet=packet)
                    p = subprocess.run(['node', str(HERE / 'error_probe.cjs')], input=json.dumps(data) + '\n', text=True, capture_output=True, timeout=20)
                    result = json.loads(p.stdout)
                    checks.append(result)
                    need(p.returncode == 0 and result['passed'], 'native_error_probe_failed')
                need([x['status'] for x in relay.events] == [400, 429], 'unexpected_error_retry')
                need(receiver.count() == 0, 'quota_bypass')
            elif case == 'lost_commit_restart':
                receiver.call('drop_commit')
                worker.call('resume', operation_id=op, expected='target_unavailable')
                need(worker.call('get', operation_id=op)['status'] == 'unknown', 'source_claimed_success')
                need(receiver.count() == 1, 'loss_before_commit')
                original = receiver.call('packet', operation_id=op)['receipt']['resource_ref']
                worker.close()
                receiver.stop(crash=True)
                # Age only the source ledger's local deadlines (test SQL on the business pool); Identity and the
                # target keep wall time, so this is not a claim about a 2-day native deadline.
                aged = Source(c, mysql, c['identity_url'], receiver.url)  # a fresh process just to reach the lab pool
                aged.call('age', operation_id=op, milliseconds=2 * 86400 * 1000)
                aged.close()
                receiver.start()
                worker = Source(c, mysql, c['identity_url'], receiver.url)
                stage = 'recover_after_crash'
                remaining = max(0, worker.call('get', operation_id=op).get('retry_at', 0) - time.time())
                need(remaining <= 2, 'unexpected_retry_window')
                time.sleep(remaining + 0.05)
                recovered = worker.call('resume', operation_id=op)
                need(recovered['status'] == 'succeeded' and recovered['resource_ref'] == original and receiver.count() == 1, 'duplicate_after_crash')
                need(op not in worker.call('state')['snapshots'], 'expired_source_bytes_retained')
                adopt(op, recovered['resource_version'])
                checks.append('commit response genuinely dropped by t11-lab; Node terminated and receiver SIGKILL/restarted; expired source snapshot removed; status alone restores same resource')
            else:
                clicks = worker.call('duplicates', operation_id=op)
                need(len(clicks) == 4 and all(x['ok'] or x['code'] == 'operation_busy' for x in clicks), 'duplicate_click_failure')
                need(any(x['ok'] and x['result']['status'] == 'succeeded' for x in clicks), 'duplicate_click_failure')
                # A click that met the bounded owner-lock wait was told operation_busy (retryable); the user retries it.
                results = [x['result'] for x in clicks if x['ok']] + [worker.call('resume', operation_id=op) for x in clicks if not x['ok']]
                report['concurrent_clicks'] = {'immediate': sum(1 for x in clicks if x['ok']), 'operation_busy_then_retried': sum(1 for x in clicks if not x['ok'])}
                need(len(results) == 4 and all(r['status'] == 'succeeded' for r in results), 'duplicate_click_failure')
                need(len({r['resource_ref'] for r in results}) == 1 and receiver.count() == 1, 'duplicate_resources')
                got = receiver.call('packet', operation_id=op)['package']
                need(got == packet, 'private_bytes_changed')
                combined = base64.b64decode(packet['manifest_b64']).decode() + ''.join(base64.b64decode(x['data_b64']).decode() for x in packet['blobs'])
                need(len(packet['blobs']) == 2 and not any(x in combined for x in ['PRIVATE_THINKING', 'UNSELECTED_PRIVATE_PROMPT', '比较结果']), 'unselected_content_transferred')
                adopt(op, results[0]['resource_version'])
                checks.append('four simultaneous source clicks (busy ones retried); one private copy with identical selected text/attachment bytes; unselected conversation absent; adopted through real reference service')
                if case == 'deleted_restore':
                    stage = 'delete_and_new_operation'
                    need(receiver.call('delete', operation_id=op).get('ok') is True, 'delete_failed')
                    # Draft wire contract (rc3 §9): deletion is the terminal tombstone; the `recycled` value may only
                    # appear on teacher-artifact-handoff/1 once all three sides freeze the same version.
                    try:
                        status = worker.call('status', operation_id=op)['status']
                    except RuntimeError as e:
                        report['observed_after_delete'] = str(e)
                        raise RuntimeError('draft_wire_delete_status_' + str(e).replace('source_operation_failed_', ''))
                    report['observed_after_delete'] = status
                    need(status == 'deleted', 'draft_wire_delete_status_' + status)
                    worker.close()
                    worker = Source(c, fresh_database(c), c['identity_url'], receiver.url)  # a source that never saw the first operation
                    another = worker.call('freeze')['operation_id']
                    need(another != op, 'new_operation_missing')
                    worker.call('resume', operation_id=another, expected='operation_deleted')
                    need(receiver.count() == 1 and receiver.count(active=True) == 0, 'tombstone_revived')
                    checks.append('new operation cannot revive deleted selection')
                    # Observation only: the owner restores the copy on t11-lab (real Store.Restore). A draft-wire source
                    # that already holds the `deleted` tombstone must refuse the revived receipt; restore visibility
                    # belongs to the formal wire (recycled -> succeeded). Not a failure of either side.
                    stage = 'restore_observation'
                    need(receiver.call('restore', operation_id=op).get('ok') is True, 'restore_failed')
                    need(receiver.count(active=True) == 1, 'restore_not_effective')
                    worker.close()
                    worker = Source(c, mysql, c['identity_url'], receiver.url)  # the first ledger again
                    try:
                        worker.call('status', operation_id=op)
                        report['restore_on_draft_wire'] = 'accepted_unexpectedly'
                        need(False, 'draft_wire_accepted_revival')
                    except RuntimeError as e:
                        if str(e) == 'draft_wire_accepted_revival':
                            raise
                        report['restore_on_draft_wire'] = 'source_refused_' + str(e).replace('source_operation_failed_', '')
                        need(str(e) == 'source_operation_failed_receipt_invalid', 'draft_wire_restore_' + str(e))
                    kept = worker.call('get', operation_id=op)
                    need(kept['status'] == 'deleted' and kept.get('error_code') == 'receipt_invalid' and 'resource_ref' not in kept, 'tombstone_lost_after_restore')
                    checks.append('t11-lab restore succeeds locally; the draft-wire source keeps its deleted tombstone and refuses the revived receipt (formal wire carries recycled/restore)')
            if relay:
                need(relay.error is None, 'relay_error')
            stored = json.dumps(worker.call('state'))
            need(not any(x in stored for x in [c['source_auth'], c['target_secret'], c['owner'], receiver.jwt_secret, '"ticket"', 'global_person_id']), 'credential_or_target_identity_in_source_store')
            checks.append('source ledger contains no ticket, credentials, target local account or global person ID')
            passed = True
        except Exception as e:
            safe = str(e) if isinstance(e, RuntimeError) and str(e).replace('_', '').isalnum() else type(e).__name__
            report.update(failure={'stage': stage, 'code': safe})
        finally:
            if worker:
                worker.close()
            if relay:
                relay.close()
                report['transport_events'] = relay.events
            if receiver:
                try:
                    receiver.stop()
                    receiver.check_logs()
                except Exception:
                    passed = False
                    report['cleanup_or_log_check_failed'] = True
            report.update(passed=passed, checks=checks)
            Path(c['evidence'], case + '.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'case': case, 'passed': passed}))
    return 0 if passed else 1


if __name__ == '__main__':
    sys.exit(main())

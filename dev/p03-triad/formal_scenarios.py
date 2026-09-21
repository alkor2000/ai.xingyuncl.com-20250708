"""Formal-wire (teacher-artifact-handoff/1) triad case runner: P03 MySQL source -> native Identity provider
(formal candidate enabled) -> unmodified T11 cmd/t11-lab started with formal:true.

Invoked per case by dev/p03-triad/formal_overlay.go through I03_TRIAD_DRIVER. All three clocks are
injected: Identity through the overlay's loopback control endpoint, t11-lab through its `clock` command,
the source through the per-command `now`. They move together except where a case deliberately skews one
side (recorded in the case report). Only synthetic facts; credentials arrive on stdin and never enter argv,
logs or evidence.
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
import subprocess
import sys
import tempfile
import threading
import time
import uuid

WIRE = 'teacher-artifact-handoff/1'
DAY = 86400


def need(value, label):
    if not value:
        raise RuntimeError(label)


class Clocks:
    """One logical time for the three sides; `skew` lets a case move one side on purpose."""

    def __init__(self, c):
        self.c, self.now, self.receiver = c, c['epoch'], None

    def identity(self, t):
        host, port = self.c['clock_url'].replace('http://', '').split(':')
        with closing(http.client.HTTPConnection(host, int(port), timeout=10)) as conn:
            conn.request('POST', '/', json.dumps({'now': t}), {'Content-Type': 'application/json'})
            need(conn.getresponse().status == 200, 'identity_clock_rejected')

    def target(self, t):
        need(self.receiver.call('clock', now=t).get('ok') is True, 'target_clock_rejected')

    def set(self, t):
        self.identity(t)
        if self.receiver and self.receiver.process:
            self.target(t)
        self.now = t


class Source:
    """The MySQL-backed P03 worker on the formal wire with an injected per-command clock."""

    def __init__(self, c, clocks, mysql, identity, target):
        self.root, self.clocks, self.process = c['practice_root'], clocks, None
        self.config = dict(mysql=mysql, identityOrigin=identity, targetOrigin=target, authorization=c['source_auth'],
                           owner='p-teacher', endpointProfile='native-draft', wireVersion=WIRE)
        self.start()

    def start(self):
        self.process = subprocess.Popen(['node', str(Path(self.root) / 'dev/p03-mysql-worker.cjs')], cwd=self.root,
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        need(self.call('init', **self.config) == {'ready': True, 'owner': 'p-teacher'}, 'source_init_failed')
        self.config['mysql']['initialize'] = False  # shared dict: later processes on this database skip DDL and seeding

    def call(self, command, expected=None, **fields):
        self.process.stdin.write(json.dumps(dict(command=command, now=self.clocks.now * 1000, **fields)) + '\n')
        self.process.stdin.flush()
        need(select.select([self.process.stdout], [], [], 40)[0], 'source_timeout')
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
    """Unmodified T11 cmd/t11-lab (formal wire enabled unless a case keeps it closed) on the isolated PG16 target database."""

    def __init__(self, c, clocks, formal=True):
        self.c, self.clocks, self.formal, self.process, self.logs = c, clocks, formal, None, []
        self.jwt_secret, self.key, self.other = secrets.token_hex(32), secrets.token_hex(32), str(uuid.uuid4())
        clocks.receiver = self
        self.start()

    def read(self):
        need(select.select([self.process.stdout], [], [], 40)[0], 'receiver_timeout')
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
                     target_secret=c['target_secret'], key=self.key, owner=c['owner'], other=self.other, clock=self.clocks.now,
                     jwt_secret=self.jwt_secret, browser_origin='http://127.0.0.1:5197', address='127.0.0.1:0', formal=self.formal)
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

    def import_row(self, op):
        row = self.sql(f"SELECT state||'|'||protocol_version||'|'||COALESCE(extract(epoch from operation_expires_at)::bigint::text,'') FROM teacher_artifact_imports WHERE operation_id='{op}'")
        return row.split('|') if row else None

    def stop(self, crash=False):
        if self.process:
            if self.process.poll() is None:
                if crash:
                    self.process.kill()
                else:
                    self.process.stdin.close()
                try:
                    code = self.process.wait(timeout=12)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=5)
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
    """Byte-preserving loopback relay in front of the receiver. Modes: observe; disable (owner disabled after a
    successful prepare); fail_first_commit (the first commit never reaches the target, answered 503
    target_unavailable); advance_target_at_commit (t11-lab clock moved to `target_time` right before the commit is
    forwarded, so the target's own lock-then-check of W is exercised)."""

    def __init__(self, receiver, mode):
        self.events, self.error, self.mode, self.target_time, self.failed_once = [], None, mode, None, False
        state = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                try:
                    need(not self.headers.get('Authorization'), 'source_credential_at_target')
                    raw = self.rfile.read(int(self.headers['Content-Length']))
                    if self.path.endswith('/commit') and state.mode == 'fail_first_commit' and not state.failed_once:
                        state.failed_once = True
                        body = json.dumps({'request_id': uuid.uuid4().hex, 'error': {'code': 'target_unavailable', 'message': '目标暂不可用，请查询原操作状态', 'retryable': True}}).encode()
                        state.events.append({'path': 'commit', 'status': 503, 'synthetic': True})
                        self.send_response(503)
                        for k, v in [('Content-Type', 'application/json; charset=utf-8'), ('Cache-Control', 'no-store'), ('Retry-After', '1'), ('Content-Length', str(len(body)))]:
                            self.send_header(k, v)
                        self.end_headers()
                        self.wfile.write(body)
                        return
                    if self.path.endswith('/commit') and state.mode == 'advance_target_at_commit' and state.target_time is not None:
                        receiver.clocks.target(state.target_time)
                        state.events.append({'path': 'target_clock', 'now': state.target_time})
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
                                             'protocol_version': parsed.get('protocol_version'), 'receipt_status': parsed.get('status'),
                                             'code': (parsed.get('error') or {}).get('code'), 'retryable': (parsed.get('error') or {}).get('retryable'),
                                             'retry_after': reply.getheader('Retry-After')})
                        if self.path.endswith('/prepare') and state.mode == 'disable' and reply.status == 200:
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
    case, epoch = c['case'], c['epoch']
    W, R = epoch + DAY, epoch + 30 * DAY
    receiver = worker = relay = None
    stage, passed, checks = 'setup', False, []
    report = {'case': case, 'passed': False, 'wire': WIRE, 'epoch': epoch, 'W': W, 'R': R,
              'source_store': 'P03 MySQL 8 durable candidate (isolated container, restricted lab role), formal wire',
              'identity': 'native Provider/Registry/Links with formal candidate, formal policy row and formal_pairs; pku_identity_app; Gin request ID; synthetic facts',
              'target': 'unmodified T11 cmd/t11-lab formal:true on isolated PG16 (S05b post-schema + 20260921_03 migration incl. protocol_version/operation_expires_at)',
              'clocks': 'injected on all three sides and moved together; skews listed per step'}
    clocks = Clocks(c)

    def adopt(op, version):
        adopted = receiver.call('adopt', operation_id=op)
        snapshot = adopted.get('snapshot') or {}
        need(adopted.get('ok') is True and snapshot.get('version') == version and str(snapshot.get('text', '')).startswith('先观察，再记录两杯水的变化。'), 'adopted_snapshot_mismatch')

    def formal_view(view, status):
        need(view['status'] == status and view['protocol_version'] == WIRE and view.get('operation_expires_at') == W and view.get('recovery_until') == W + 29 * DAY,
             'formal_view_' + str(view.get('status')))

    def clicks(op):
        outcomes = worker.call('duplicates', operation_id=op)
        need(len(outcomes) == 4 and all(x['ok'] or x['code'] == 'operation_busy' for x in outcomes), 'duplicate_click_failure')
        results = [x['result'] for x in outcomes if x['ok']] + [worker.call('resume', operation_id=op) for x in outcomes if not x['ok']]
        need(len(results) == 4 and all(r['status'] == 'succeeded' for r in results) and len({r['resource_ref'] for r in results}) == 1, 'duplicate_click_failure')
        report['concurrent_clicks'] = {'immediate': sum(1 for x in outcomes if x['ok']), 'operation_busy_then_retried': sum(1 for x in outcomes if not x['ok'])}
        return results[0]

    with tempfile.TemporaryDirectory(prefix='p03-formal-triad-') as directory:
        c['scratch'] = directory
        try:
            clocks.identity(epoch)
            receiver = Receiver(c, clocks, formal=case != 'wire_gate_off')
            stage = 'receiver_start'
            if case in ('target_disabled', 'w_target_check'):
                relay = Relay(receiver, 'disable' if case == 'target_disabled' else 'fail_first_commit')
            mysql = fresh_database(c)
            stage = 'source_start'
            worker = Source(c, clocks, mysql, c['identity_url'], relay.url if relay else receiver.url)
            stage = 'freeze'
            op = worker.call('freeze')['operation_id']
            state = worker.call('state')
            packet = state['snapshots'][op]['packet']
            need(state['operations'][op]['protocol_version'] == WIRE, 'formal_record_wire')
            stage = 'transfer'
            if case == 'formal_success':
                done = worker.call('resume', operation_id=op)
                formal_view(done, 'succeeded')
                need(receiver.count() == 1 and receiver.call('packet', operation_id=op)['package'] == packet, 'private_bytes_changed')
                row = receiver.import_row(op)
                need(row == ['succeeded', WIRE, str(W)], 'target_row_' + str(row))
                adopt(op, done['resource_version'])
                checks.append('formal prepare/commit against the real provider (formal policy + pairs) and the real receiver: receipt wire, W and R as rc1/rc2 define; target row binds the wire and W; identical private bytes; adopted through the real reference service')
            elif case == 'duplicates':
                first = clicks(op)
                need(receiver.count() == 1 and receiver.call('packet', operation_id=op)['package'] == packet, 'duplicate_resources')
                adopt(op, first['resource_version'])
                checks.append('four simultaneous formal clicks; one private copy; busy clicks retried through status replay')
            elif case == 'w_target_check':
                worker.call('resume', operation_id=op, expected='target_unavailable')  # relay answered the first commit; target holds a prepared row
                need(receiver.import_row(op) == ['prepared', WIRE, str(W)] and receiver.count() == 0, 'prepared_row_missing')
                relay.mode, relay.target_time = 'advance_target_at_commit', W
                clocks.set(W - 1)  # Identity issues the commit ticket ending at W; the target alone is moved to W as the commit arrives
                worker.call('resume', operation_id=op, expected='operation_expired')
                need(relay.events[-1]['path'] == 'commit' and relay.events[-1]['status'] == 410 and relay.events[-1]['code'] == 'operation_expired', 'target_w_check_missing')
                need(receiver.count() == 0, 'resource_after_w')
                clocks.set(W)
                late = worker.call('resume', operation_id=op)
                need(late['status'] == 'expired', 'source_status_after_w_' + late['status'])
                need(receiver.count() == 0 and receiver.import_row(op)[0] in ('prepared', 'expired'), 'row_after_w')
                report['skew'] = 'target moved to W while Identity and the source stayed at W-1 for the commit; all three at W afterwards'
                checks.append('a commit ticket issued at W-1 is refused by the target itself at W after its own owner/operation locks (410 operation_expired, no resource, no orphan version); the source then settles expired and never writes again')
            elif case == 'replay_after_w':
                done = worker.call('resume', operation_id=op)
                formal_view(done, 'succeeded')
                clocks.set(W + 1)
                again = worker.call('status', operation_id=op)
                need(again['status'] == 'succeeded' and again['resource_ref'] == done['resource_ref'] and again['resource_version'] == done['resource_version'], 'replay_after_w_changed')
                need(worker.call('resume', operation_id=op)['status'] == 'succeeded', 'resume_after_w_rewrote')
                clocks.set(R - 1)
                need(worker.call('status', operation_id=op)['resource_ref'] == done['resource_ref'], 'status_before_r_failed')
                clocks.set(R)
                closed = worker.call('status', operation_id=op)  # at R the source asks nobody: last known result, no failed request recorded
                need(closed['status'] == 'succeeded' and closed['resource_ref'] == done['resource_ref'] and 'error_code' not in closed, 'last_known_lost_after_r')
                need(receiver.count() == 1, 'duplicate_after_w')
                checks.append('after W the status query returns the original resource/version (target replay, Identity status ticket); at R the source stops asking and keeps the last known result')
            elif case == 'recycled_restore_purge':
                done = worker.call('resume', operation_id=op)
                formal_view(done, 'succeeded')
                need(receiver.call('delete', operation_id=op).get('ok') is True, 'delete_failed')
                recycled = worker.call('status', operation_id=op)
                need(recycled['status'] == 'recycled' and recycled['resource_ref'] == done['resource_ref'] and recycled['recycle_until'] == epoch + 30 * DAY, 'recycled_receipt_' + str(recycled.get('status')))
                need(worker.call('cancel', operation_id=op)['status'] == 'recycled', 'cancel_on_recycled')
                need(receiver.call('restore', operation_id=op).get('ok') is True, 'restore_failed')
                back = worker.call('status', operation_id=op)
                need(back['status'] == 'succeeded' and back['resource_ref'] == done['resource_ref'] and 'recycle_until' not in back, 'restore_not_visible')
                adopt(op, done['resource_version'])
                need(receiver.call('delete', operation_id=op).get('ok') is True, 'second_delete_failed')
                need(worker.call('status', operation_id=op)['status'] == 'recycled', 'second_recycle_missing')
                # The recycle window (30d from deletion) ends no earlier than R (= W + 29d = epoch + 30d): a source that
                # stops asking at R can only ever see `recycled`. To reach the tombstone in this laboratory the target
                # alone is moved to recycle_until and purged; Identity and the source stay at R-1.
                clocks.set(R - 1)
                clocks.target(epoch + 30 * DAY)
                purged = receiver.call('purge')
                need(purged.get('ok') is True and purged.get('purged') == 1, 'purge_failed')
                gone = worker.call('status', operation_id=op)
                need(gone['status'] == 'deleted' and 'resource_ref' not in gone, 'tombstone_not_visible')
                worker.close()
                worker = Source(c, clocks, fresh_database(c), c['identity_url'], receiver.url)
                another = worker.call('freeze')['operation_id']
                need(another != op, 'new_operation_missing')
                worker.call('resume', operation_id=another, expected='operation_deleted')
                need(receiver.count() == 1 and receiver.count(active=True) == 0, 'tombstone_revived')
                report['skew'] = 'target moved to recycle_until for the purge while Identity and the source stayed at R-1'
                report['observation'] = 'recycle_until = deletion + 30d is never earlier than R = W + 29d, so on the formal wire a source can observe recycled but the purge tombstone only through a target-side clock skew or an early purge'
                checks.append('formal wire: delete -> recycled with the same resource identity and integer recycle_until; cancel stays recycled; restore -> succeeded and adoptable; purge -> deleted tombstone; a new operation on the same selection is refused with 410')
            elif case == 'wire_gate_off':
                worker.call('resume', operation_id=op, expected='unsupported_schema')
                view = worker.call('get', operation_id=op)
                need(view['status'] == 'unknown' and view.get('error_code') == 'unsupported_schema', 'gate_status_' + str(view.get('status')))
                need(receiver.count() == 0 and receiver.import_row(op) is None, 'gate_wrote')
                checks.append('receiver without TEDNA_T11_FORMAL refuses the formal wire with 400 unsupported_schema before redeeming or staging anything; the source keeps the operation unknown with the safe code')
            elif case == 'target_disabled':
                worker.call('resume', operation_id=op, expected='subject_disabled')
                last = relay.events[-1]
                need(last['path'] == 'commit' and last['status'] == 403 and last['code'] == 'subject_disabled' and last['retryable'] is False and last['schema_version'] in (None, 1), 'new_error_not_seen')
                need(receiver.count() == 0, 'disabled_owner_received')
                checks.append('owner disabled after the formal prepare: commit refused through the guard primitive (subject_disabled, 403); no private resource')
            elif case == 'lost_commit_restart':
                receiver.call('drop_commit')
                worker.call('resume', operation_id=op, expected='target_unavailable')
                need(worker.call('get', operation_id=op)['status'] == 'unknown', 'source_claimed_success')
                need(receiver.count() == 1, 'loss_before_commit')
                original = receiver.call('packet', operation_id=op)['receipt']['resource_ref']
                worker.close()
                receiver.stop(crash=True)
                clocks.set(epoch + 2 * DAY)  # past L and W: only status may be asked, nothing may be written
                receiver.start()
                worker = Source(c, clocks, mysql, c['identity_url'], receiver.url)
                stage = 'recover_after_crash'
                recovered = worker.call('resume', operation_id=op)
                need(recovered['status'] == 'succeeded' and recovered['resource_ref'] == original and recovered['operation_expires_at'] == W and receiver.count() == 1, 'duplicate_after_crash')
                need(op not in worker.call('state')['snapshots'], 'expired_source_bytes_retained')
                adopt(op, recovered['resource_version'])
                checks.append('commit response dropped by t11-lab; Node terminated and receiver SIGKILL/restarted two days later: the persisted W survives, status alone recovers the same resource, no write is issued after W')
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

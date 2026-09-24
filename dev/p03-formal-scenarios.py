"""rc2 V10-V13 with the REAL Identity provider (Go/PG, formal candidate enabled, injected clock),
the P03 MySQL-backed source worker, and a synthetic Node target that redeems tickets at that provider.

Driven by the Go overlay (dev/p03-formal-provider-overlay.go); config on stdin, one fixed JSON line out.
Only the Identity clock, the source clock and the target clock are moved; no peer code is modified.
"""
import http.client
import http.server
import json
from pathlib import Path
import secrets
import select
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid

DAY = 86400


class Clock:
    now = 0


class Worker:
    def __init__(self, config, mysql, identity, target, **init):
        self.root = config['practice_root']
        self.config = dict(mysql=mysql, identityOrigin=identity, targetOrigin=target, authorization=config['source_auth'],
                           owner='p-teacher', endpointProfile='native-draft', wireVersion='teacher-artifact-handoff/1', **init)
        self.process = None
        self.start()

    def start(self):
        self.process = subprocess.Popen(['node', str(Path(self.root) / 'dev/p03-mysql-worker.cjs')], cwd=self.root,
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        assert self.call('init', **self.config) == {'ready': True, 'owner': 'p-teacher'}
        self.config['mysql'] = {**self.config['mysql'], 'initialize': False}

    def begin(self, command, **fields):
        self.process.stdin.write(json.dumps(dict(command=command, now=Clock.now * 1000, **fields)) + '\n')
        self.process.stdin.flush()

    def receive(self, expected=None, timeout=40):
        assert select.select([self.process.stdout], [], [], timeout)[0], 'worker_timeout'
        result = json.loads(self.process.stdout.readline())
        if expected:
            assert result == {'ok': False, 'code': expected}, 'unexpected_error_' + str(result.get('code', result.get('result', {}).get('status', 'none')))
            return
        assert result.get('ok'), 'worker_error_' + str(result.get('code', 'none'))
        return result['result']

    def call(self, command, expected=None, **fields):
        self.begin(command, **fields)
        return self.receive(expected)

    def close(self):
        if self.process:
            self.process.kill()
            self.process.wait(timeout=5)
            self.process.stdin.close()
            self.process.stdout.close()
            self.process = None


class Relay:
    """Byte-transparent loopback relay in front of the real provider; only fault injection, never a fake response."""

    def __init__(self, upstream):
        self.upstream = upstream
        self.mode = None            # drop_next_issue_request | lose_next_issue_response | down
        self.issues = []            # [{phase, status, expires_at, operation_expires_at}] safe fields only
        relay = self

        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'

            def log_message(self, *_):
                pass

            def do_POST(self):
                body = self.rfile.read(int(self.headers.get('Content-Length', '0')))
                phase = None
                try:
                    phase = json.loads(body).get('phase')
                except Exception:
                    pass
                is_issue = self.path.endswith('/issue')
                if relay.mode == 'down' or (relay.mode == 'drop_next_issue_request' and is_issue):
                    if relay.mode != 'down':
                        relay.mode = None
                    relay.issues.append({'phase': phase, 'outcome': 'request_dropped'})
                    self.close_connection = True
                    self.connection.close()
                    return
                target = relay.upstream.replace('http://', '')
                connection = http.client.HTTPConnection(target, timeout=20)
                headers = {k: v for k, v in self.headers.items() if k.lower() in ('content-type', 'authorization', 'idempotency-key')}
                headers['Content-Length'] = str(len(body))
                connection.request('POST', self.path, body=body, headers=headers)
                response = connection.getresponse()
                data = response.read()
                record = {'phase': phase, 'status': response.status}
                if is_issue and response.status == 200:
                    try:
                        parsed = json.loads(data)
                        record.update(expires_at=parsed.get('expires_at'), operation_expires_at=parsed.get('operation_expires_at'))
                    except Exception:
                        pass
                relay.issues.append(record)
                if relay.mode == 'lose_next_issue_response' and is_issue:
                    relay.mode = None
                    record['outcome'] = 'response_lost'
                    self.close_connection = True
                    self.connection.close()
                    return
                self.send_response(response.status)
                for key in ('Content-Type', 'Cache-Control', 'Retry-After', 'X-Request-ID'):
                    value = response.getheader(key)
                    if value:
                        self.send_header(key, value)
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        self.server = socketserver.ThreadingTCPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f'http://127.0.0.1:{self.server.server_address[1]}'

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class Target:
    def __init__(self, config):
        self.process = subprocess.Popen(['node', str(Path(config['practice_root']) / 'dev/p03-formal-target.cjs')],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        self.process.stdin.write(json.dumps({'identity_url': config['identity_url'], 'target_auth': config['target_auth'], 'now': Clock.now}))
        self.process.stdin.close()
        assert select.select([self.process.stdout], [], [], 20)[0], 'target_timeout'
        self.url = json.loads(self.process.stdout.readline())['url']

    def control(self, **fields):
        req = urllib.request.Request(self.url + '/__control', data=json.dumps(fields).encode(), headers={'Content-Type': 'application/json'}, method='POST')
        with urllib.request.urlopen(req, timeout=5) as response:
            return json.loads(response.read())

    def state(self):
        with urllib.request.urlopen(self.url + '/__control', timeout=5) as response:
            return json.loads(response.read())

    def resources(self):
        return sum(1 for o in self.state()['ops'] if o['state'] == 'succeeded')

    def close(self):
        self.process.kill()
        self.process.wait(timeout=5)
        self.process.stdout.close()


def main():
    config = json.load(sys.stdin)
    case = config['case']
    epoch = config['epoch']
    Clock.now = epoch
    target = None

    def set_clock(seconds):
        req = urllib.request.Request(config['clock_url'], data=json.dumps({'now': seconds}).encode(), headers={'Content-Type': 'application/json'}, method='POST')
        with urllib.request.urlopen(req, timeout=5) as response:
            assert response.status == 200
        Clock.now = seconds
        if target:
            target.control(now=seconds)

    report = {'case': case, 'passed': False, 'identity': 'real Go/PG provider, formal candidate enabled, injected clock',
              'source': 'P03 MySQL worker (restricted lab role) formal wire', 'target': 'synthetic Node target redeeming at the real provider',
              'time_source': 'injected (Identity lab clock, worker command clock, target control clock)'}
    with tempfile.TemporaryDirectory(prefix='p03-formal-') as temp:
        mysql = dict(config['mysql'], directory=temp, database='p03_lab_' + secrets.token_hex(6), initialize=True,
                     app_user='p03_app_' + secrets.token_hex(6), app_password=secrets.token_urlsafe(24))
        create = """const mysql=require('./backend/node_modules/mysql2/promise');
let s='';process.stdin.on('data',b=>s+=b).on('end',async()=>{
 const c=JSON.parse(s); if(!/^p03_lab_[a-f0-9]{12}$/.test(c.database)||c.host!=='127.0.0.1')process.exit(1);
 const db=await mysql.createConnection({host:c.host,port:c.port,user:c.user,password:c.password});
 await db.query('CREATE DATABASE '+c.database+' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');await db.end();
});"""
        subprocess.run(['node', '-e', create], cwd=config['practice_root'], input=json.dumps(mysql), text=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=10)
        relay = Relay(config['identity_url'])
        target = Target(config)
        worker = None
        try:
            init = {'recoveryAttemptLimit': 3} if case == 'reconciliation_exit' else {}
            worker = Worker(config, mysql, relay.url, target.url, **init)
            op = worker.call('freeze')['operation_id']
            record = lambda: worker.call('state')['operations'][op]
            phases = lambda: [i['phase'] for i in relay.issues if 'outcome' not in i or i['outcome'] != 'request_dropped']
            if case == 'formal_success':
                done = worker.call('resume', operation_id=op)
                assert done['status'] == 'succeeded' and done['operation_expires_at'] == epoch + DAY, 'deadline_mismatch'
                assert record()['operation_expires_at'] == epoch + DAY and record()['hold'] is False
                assert phases() == ['prepare', 'commit'] and all(i['operation_expires_at'] == epoch + DAY for i in relay.issues)
                assert target.state()['ops'][0]['W'] == epoch + DAY and target.resources() == 1
                again = worker.call('status', operation_id=op)
                assert again['resource_ref'] == done['resource_ref'] and again['resource_version'] == done['resource_version']
            elif case == 'v10_lost_first_issue':
                relay.mode = 'lose_next_issue_response'
                worker.call('resume', operation_id=op, expected='identity_unavailable')
                r = record()
                assert r['status'] == 'unknown' and r['operation_expires_at'] is None and r['hold'] is True and r['recovery_attempts'] == 1
                set_clock(epoch + 2)
                done = worker.call('resume', operation_id=op)
                assert done['status'] == 'succeeded' and done['operation_expires_at'] == epoch + DAY, 'W_not_first_persist'
                assert phases() == ['prepare', 'status', 'prepare', 'commit'] and relay.issues[0].get('outcome') == 'response_lost'
                assert all(i.get('operation_expires_at') == epoch + DAY for i in relay.issues if i['status'] == 200)
                assert target.resources() == 1 and record()['hold'] is False
                worker.close(); worker.start()
                assert worker.call('status', operation_id=op)['resource_ref'] == done['resource_ref']
            elif case == 'v10_first_issue_in_flight':
                relay.mode = 'drop_next_issue_request'
                worker.call('resume', operation_id=op, expected='identity_unavailable')
                set_clock(epoch + 2)
                worker.call('resume', operation_id=op, expected='retry_later')
                assert record()['retry_at'] == epoch * 1000 + 5000 + 30000, 'settle_window_mismatch'
                set_clock(epoch + 36)
                done = worker.call('resume', operation_id=op)
                assert done['status'] == 'succeeded' and done['operation_expires_at'] == epoch + 36 + DAY, 'W_not_second_persist'
                assert [i['phase'] for i in relay.issues] == ['prepare', 'status', 'status', 'prepare', 'commit']
                assert [i['status'] for i in relay.issues if 'outcome' not in i] == [409, 409, 200, 200]
                assert target.resources() == 1
            elif case == 'v11_recovery_window':
                set_clock(epoch + 7200)
                done = worker.call('resume', operation_id=op)
                assert done['status'] == 'succeeded' and done['operation_expires_at'] == epoch + 7200 + DAY
                set_clock(epoch + 30 * DAY + 1)  # past freeze+30d, 7199 s before R
                assert worker.call('state')['snapshots'] == {}, 'body_not_cleaned'
                again = worker.call('status', operation_id=op)
                assert again['status'] == 'succeeded' and again['resource_ref'] == done['resource_ref']
                assert relay.issues[-1]['phase'] == 'status' and relay.issues[-1]['expires_at'] == Clock.now + 60
                assert worker.call('freeze')['operation_id'] == op and target.resources() == 1
            elif case == 'v12a_write_ticket_cut':
                W = epoch + DAY  # freeze and first issue in the same second: L = W
                target.control(drop='commit')
                worker.call('resume', operation_id=op, expected='target_unavailable')
                assert record()['released_at'] == epoch and record()['status'] == 'unknown'
                set_clock(W - 1)
                target.control(pause='commit')
                worker.begin('resume', operation_id=op)
                for _ in range(200):
                    if target.state()['paused'] == 'commit':
                        break
                    time.sleep(0.05)
                else:
                    raise AssertionError('commit_not_paused')
                assert relay.issues[-1] == {'phase': 'commit', 'status': 200, 'expires_at': W, 'operation_expires_at': W}, 'write_ticket_not_cut'
                set_clock(W)
                target.control(release=True)
                worker.receive(expected='ticket_expired')
                assert target.resources() == 0
                set_clock(W + 2)
                assert worker.call('resume', operation_id=op)['status'] == 'expired'
                assert target.state()['ops'][0]['state'] == 'expired' and target.resources() == 0
                assert [i['phase'] for i in relay.issues] == ['prepare', 'commit', 'status', 'commit', 'status']
            elif case == 'v12b_status_ticket_cut':
                done = worker.call('resume', operation_id=op)
                R = epoch + 30 * DAY
                set_clock(R - 1)
                assert worker.call('status', operation_id=op)['status'] == 'succeeded'
                assert relay.issues[-1] == {'phase': 'status', 'status': 200, 'expires_at': R, 'operation_expires_at': epoch + DAY}, 'status_ticket_not_cut'
                issued = len(relay.issues)
                set_clock(R)
                assert worker.call('status', operation_id=op)['resource_ref'] == done['resource_ref']
                worker.call('cancel', operation_id=op, expected='recovery_window_closed')
                assert len(relay.issues) == issued, 'authorization_requested_at_R'
                # The provider itself refuses a status grant at R (direct probe with the source credentials).
                probe = json.dumps({'schema_version': 1, 'protocol_version': 'teacher-artifact-handoff/1', 'request_time': R,
                                    'replay_nonce': secrets.token_urlsafe(24), 'source_local_account_id': 'p-teacher', 'target_client_id': 'tedna-client',
                                    'phase': 'status', 'binding': record()['binding']}).encode()
                req = urllib.request.Request(config['identity_url'] + '/backchannel/teacher-artifact-handoffs/v1/issue', data=probe, method='POST',
                                             headers={'Content-Type': 'application/json', 'Idempotency-Key': str(uuid.uuid4()), 'Authorization': config['source_auth']})
                try:
                    urllib.request.urlopen(req, timeout=10)
                    raise AssertionError('provider_granted_at_R')
                except urllib.error.HTTPError as e:
                    assert e.code == 410 and json.loads(e.read())['error']['code'] == 'operation_expired', 'provider_R_code'
            elif case == 'v13_local_deadline':
                set_clock(epoch + 7200)
                target.control(lose='prepare')
                worker.call('resume', operation_id=op, expected='target_unavailable')
                assert target.state()['ops'][0]['state'] == 'prepared'
                set_clock(epoch + DAY)  # L reached, W = epoch+7200+DAY still ahead
                assert worker.call('resume', operation_id=op)['status'] == 'expired'
                assert [i['phase'] for i in relay.issues] == ['prepare', 'status'] and record()['released_at'] is None
                assert target.resources() == 0 and target.state()['ops'][0]['state'] == 'prepared'
            elif case == 'v13_success_survives_local_deadline':
                set_clock(epoch + 7200)
                done = worker.call('resume', operation_id=op)
                assert done['status'] == 'succeeded'
                set_clock(epoch + DAY + 1)
                assert worker.call('state')['snapshots'] == {}
                again = worker.call('resume', operation_id=op)
                assert again['status'] == 'succeeded' and again['resource_ref'] == done['resource_ref']
                assert [i['phase'] for i in relay.issues] == ['prepare', 'commit', 'status'] and target.resources() == 1
            elif case == 'reconciliation_exit':
                relay.mode = 'down'
                for attempt in range(3):
                    worker.call('resume', operation_id=op, expected='identity_unavailable')
                    set_clock(Clock.now + 2)
                r = record()
                assert r['hold'] is True and r['recovery_attempts'] == 3 and r['reconciliation']['attempts'] == 3
                assert json.dumps(r).find('先观察') < 0 and 'ticket' not in json.dumps(r)
                relay.mode = None
                worker.call('resume', operation_id=op, expected='reconciliation_required')
                set_clock(epoch + 31 * DAY)
                inventory = worker.call('inventory')
                assert inventory['operations'] == 1 and inventory['held'] == 1, 'held_row_pruned'
                closed = worker.call('reconcile', operation_id=op, closure={'outcome': 'not_created', 'basis': 'relay refused every request; provider has no operation; target has no receipt',
                                                                            'attempts_ended': True, 'identity_history_checked': True, 'target_receipt_checked': True})
                assert closed['status'] == 'cancelled' and closed['reconciliation_closed']['outcome'] == 'not_created'
                worker.call('get', operation_id=op, expected='snapshot_unavailable')
                assert phases() == [] and target.resources() == 0
            else:
                raise AssertionError('unknown_scenario')
            stored = json.dumps(worker.call('state'))
            assert not any(x in stored for x in [config['source_auth'], config['target_auth'], mysql['app_password'], '"ticket"']), 'secret_in_source_store'
            report.update(passed=True, relay_issues=relay.issues, target_events=target.state()['ops'])
        except Exception as error:
            reason = str(error) if isinstance(error, AssertionError) else type(error).__name__
            if not reason or not all(c.isalnum() or c == '_' for c in reason):
                reason = 'assertion_failed'
            report.update(failure=reason, relay_issues=relay.issues)
            print('P03_FORMAL_SCENARIO_FAILURE:' + reason, file=sys.stderr)
        finally:
            if worker:
                worker.close()
            target.close()
            relay.close()
            if config.get('evidence'):
                Path(config['evidence'], case + '.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'case': case, 'passed': report['passed']}))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:  # never print config/credentials
        print('P03_FORMAL_DRIVER_FAILURE:' + type(error).__name__, file=sys.stderr)
        sys.exit(1)

"""P03 Node/MySQL -> actual I03 Go/PG lab -> synthetic TE-DNA SQLite.

Config/credentials arrive on stdin; stdout is a fixed result only. Each scenario
uses a fresh MySQL schema and two independent Node processes where appropriate.
"""
import base64
import concurrent.futures
import json
from pathlib import Path
import secrets
import select
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))
# Caller pins the I03 source path in PYTHONPATH; no source files are copied/modified.
from fake_peers import Clock, Target, Wire, serve


class Worker:
    def __init__(self, config, mysql, target, owner='p-teacher'):
        self.root = config['practice_root']
        self.config = dict(mysql=mysql, identityOrigin=config['identity_url'], targetOrigin=target,
                           authorization=config['source_auth'], owner=owner)
        self.process = None
        self.start()

    def start(self):
        self.process = subprocess.Popen(['node', str(Path(self.root)/'dev/p03-mysql-worker.cjs')],
            cwd=self.root, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        assert self.call('init', **self.config) == {'ready': True, 'owner': self.config['owner']}
        self.config['mysql'] = {**self.config['mysql'], 'initialize': False}

    def begin(self, command, **fields):
        self.process.stdin.write(json.dumps(dict(command=command, now=Clock.now*1000, **fields))+'\n')
        self.process.stdin.flush()

    def receive(self, expected=None):
        assert select.select([self.process.stdout], [], [], 20)[0], 'worker_timeout'
        result = json.loads(self.process.stdout.readline())
        if expected:
            assert result == {'ok': False, 'code': expected}, 'unexpected_error_' + str(result.get('code', 'none'))
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


class Receiver(Target):
    def __init__(self, *args):
        super().__init__(*args)
        self.phases = []
        self.barrier = None
        self.arrived, self.proceed = threading.Event(), threading.Event()
        self.lose_commit = False

    def pause(self, point):
        if self.barrier == point:
            self.barrier = None
            self.arrived.set()
            assert self.proceed.wait(10), 'barrier_timeout'

    def handle(self, path, request, key, headers):
        assert not headers.get('Authorization'), 'basic_reached_target'
        self.phases.append(path)
        self.pause('before_'+path.rsplit('/', 1)[-1])
        result = super().handle(path, request, key, headers)
        self.pause('after_'+path.rsplit('/', 1)[-1])
        if path == '/tedna/commit' and self.lose_commit:
            self.lose_commit = False
            self.drop_success_response = True
        return result


def main():
    config = json.load(sys.stdin)
    Clock.now = config['clock']
    mode = config['case']

    def advance(seconds):
        req = urllib.request.Request(config['clock_url'], data=json.dumps({'seconds': seconds}).encode(),
            headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=5) as response:
            assert response.status == 200
        Clock.now += seconds

    with tempfile.TemporaryDirectory(prefix='p03-durable-') as temp:
        # The restricted application role is created by the first worker; both processes then run the store under it.
        mysql = dict(config['mysql'], directory=temp, database='p03_lab_'+secrets.token_hex(6), initialize=True,
                     app_user='p03_app_'+secrets.token_hex(6), app_password=secrets.token_urlsafe(24))
        # Only create the fresh random schema. mysql2 credentials stay on stdin.
        create = """const mysql=require('./backend/node_modules/mysql2/promise');
let s='';process.stdin.on('data',b=>s+=b).on('end',async()=>{
 const c=JSON.parse(s); if(!/^p03_lab_[a-f0-9]{12}$/.test(c.database)||c.host!=='127.0.0.1')process.exit(1);
 const db=await mysql.createConnection({host:c.host,port:c.port,user:c.user,password:c.password});
 await db.query('CREATE DATABASE '+c.database+' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');await db.end();
});"""
        subprocess.run(['node','-e',create], cwd=config['practice_root'], input=json.dumps(mysql),
                       text=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=10)
        wire, secret = Wire(config['identity_url']), secrets.token_bytes(32)
        database = str(Path(temp)/'target.sqlite')
        target = Receiver(database, wire, config['target_auth'], secret)
        workers = []
        try:
            with serve(target) as target_wire:
                a = Worker(config, mysql, target_wire.base); workers.append(a)
                b = Worker(config, {**mysql, 'initialize': False}, target_wire.base,
                           owner='p-other' if mode == 'multi_owner' else 'p-teacher'); workers.append(b)
                if mode == 'restricted_role':
                    probe = a.call('privilege_probe')
                    assert all(v == 'denied' for v in probe['results'].values()), 'privilege_not_denied'
                    assert probe['tables'] and probe['facts_readonly'] and not probe['all_privileges'] and not probe['global_grant'], 'grants_too_broad'
                    op = a.call('freeze')['operation_id']
                    assert b.call('resume', operation_id=op)['status'] == 'succeeded' and target.count() == 1
                    assert a.call('inventory')['owners'] == 1
                elif mode == 'multi_owner':
                    # The second owner exists only in the source lab (no Identity link): it proves ledger isolation,
                    # it does not complete a handoff.
                    op = a.call('freeze')['operation_id']
                    b.call('get', operation_id=op, expected='snapshot_unavailable')
                    b.call('resume', operation_id=op, expected='snapshot_unavailable')
                    b.call('cancel', operation_id=op, expected='snapshot_unavailable')
                    other = b.call('freeze')['operation_id']
                    assert other != op
                    a.call('get', operation_id=other, expected='snapshot_unavailable')
                    assert a.call('resume', operation_id=op)['status'] == 'succeeded'
                    b.call('resume', operation_id=other, expected='source_link_unavailable')
                    assert b.call('get', operation_id=other)['status'] == 'unknown'
                    assert target.count() == 1
                    assert set(a.call('state')['operations']) == {op} and set(b.call('state')['operations']) == {other}
                    inventory = a.call('inventory')
                    assert inventory['operations'] == 2 and inventory['owners'] == 2 and inventory['held'] == 0
                    probe = a.call('immutable_probe', operation_id=op)
                    assert probe == {'expires_at': 'binding_mismatch', 'binding': 'binding_mismatch', 'choice': 'binding_mismatch',
                                     'snapshot': 'binding_mismatch', 'deadline_first': 'accepted', 'deadline_moved': 'binding_mismatch',
                                     'deadline_cleared': 'binding_mismatch'}, 'immutable_probe_mismatch'
                elif mode == 'hold_retention':
                    op = a.call('freeze')['operation_id']
                    assert a.call('hold', operation_id=op, value=True) == {'hold': 1}
                    advance(31*86400)
                    counts = a.call('cleanup')
                    assert counts['operations'] == 0 and counts['snapshots'] == 1 and counts['keys'] == 1 and counts['complete'], 'hold_cleanup_counts'
                    inventory = b.call('inventory')
                    assert inventory == {'operations': 1, 'snapshots': 0, 'keys': 0, 'owners': 1, 'held': 1, 'cleanup_errors': 0}
                    assert b.call('get', operation_id=op)['status'] == 'ready'
                    assert a.call('hold', operation_id=op, value=False) == {'hold': 0}
                    assert a.call('cleanup')['operations'] == 1
                    b.call('get', operation_id=op, expected='snapshot_unavailable')
                    assert target.count() == 0
                elif mode == 'duplicates':
                    same_key=str(uuid.uuid4())
                    with concurrent.futures.ThreadPoolExecutor(2) as ex:
                        results = list(ex.map(lambda w: w.call('freeze', key=same_key), [a,b]))
                    op = results[0]['operation_id']
                    assert results[1]['operation_id'] == op, 'freeze_duplicate'
                    b.call('freeze', key=same_key, purpose='courseware', expected='idempotency_conflict')
                    assert b.call('freeze', purpose='courseware')['operation_id'] == op
                    with concurrent.futures.ThreadPoolExecutor(2) as ex:
                        results = list(ex.map(lambda w: w.call('resume', operation_id=op), [a,b]))
                    assert len({r['resource_ref'] for r in results}) == 1
                    assert all(r['continuation']['status']=='not_started' for r in results)
                    assert a.call('unique_probe', operation_id=op)['rejected']
                    assert a.call('rollback', operation_id=op)['status'] == 'succeeded'
                    state = a.call('state')
                    packet = json.loads(target.db.execute('SELECT package FROM resources').fetchone()[0])
                    assert packet == state['snapshots'][op]['packet']
                    assert base64.b64decode(packet['blobs'][0]['data_b64']).decode() == '先观察，再记录两杯水的变化。'
                    text = base64.b64decode(packet['manifest_b64']).decode()+''.join(base64.b64decode(x['data_b64']).decode() for x in packet['blobs'])
                    assert len(packet['blobs'])==2 and not any(x in text for x in ['PRIVATE_THINKING','UNSELECTED_PRIVATE_PROMPT','比较结果'])
                    assert target.count()==1
                else:
                    op = a.call('freeze')['operation_id']
                    if mode in ('revoke','version','attachment'):
                        a.call('after_prepare', kind=mode)
                        expected = dict(revoke='source_permission_revoked',version='source_changed',attachment='attachment_unavailable')[mode]
                        a.call('resume', expected=expected, operation_id=op)
                        assert b.call('status', operation_id=op)['status']=='cancelled'
                        assert target.count()==0 and '/tedna/commit' not in target.phases
                    elif mode == 'rollback':
                        target.fail_after_resource=True
                        a.call('resume', expected='storage_unavailable', operation_id=op)
                        assert target.count()==0
                        target.fail_after_resource=False
                        advance(1)
                        assert b.call('resume', operation_id=op)['status']=='succeeded'
                        assert target.phases == ['/tedna/prepare','/tedna/commit','/tedna/status','/tedna/commit']
                        assert target.count()==1
                    elif mode in ('revoke_before_release','lock_connection_lost'):
                        target.barrier='after_prepare'
                        a.begin('resume', operation_id=op)
                        assert target.arrived.wait(5)
                        if mode=='revoke_before_release':
                            b.begin('mutate', kind='revoke', hold=750, notify_lock=True)
                            assert b.receive()=={'locked':True}
                            target.proceed.set()
                            a.receive('source_permission_revoked')
                            assert b.receive()=={'changed':True}
                            assert b.call('status', operation_id=op)['status']=='cancelled' and target.count()==0
                        else:
                            b.call('kill_lock', operation_id=op)
                            target.proceed.set()
                            a.receive('operation_lock_lost')
                            assert b.call('get', operation_id=op)['status']=='unknown'
                            assert b.call('resume', operation_id=op)['status']=='succeeded' and target.count()==1
                    elif mode in ('release_before_revoke','cancel_before_redeem'):
                        target.barrier='before_commit'
                        a.begin('resume', operation_id=op)
                        assert target.arrived.wait(5)
                        state=b.call('state')
                        assert state['operations'][op]['released_at']
                        if mode=='release_before_revoke':
                            b.call('mutate', kind='revoke')
                            target.proceed.set()
                            result=a.receive()
                            assert result['status']=='succeeded'
                            assert b.call('cancel', operation_id=op)['resource_ref']==result['resource_ref']
                            assert target.count()==1
                        else:
                            assert b.call('cancel', operation_id=op)['status']=='cancelled'
                            target.proceed.set()
                            a.receive('operation_cancelled')
                            assert b.call('resume', operation_id=op)['status']=='cancelled' and target.count()==0
                    elif mode in ('lost_commit_restart','kill_after_commit'):
                        if mode=='lost_commit_restart':
                            target.lose_commit=True
                            a.call('resume', expected='target_unavailable', operation_id=op)
                        else:
                            target.barrier='after_commit'
                            a.begin('resume', operation_id=op)
                            assert target.arrived.wait(5)
                        assert target.count()==1
                        original=target.db.execute('SELECT id FROM resources').fetchone()[0]
                        a.close(); b.close(); target.proceed.set()
                        advance(2*86400)
                    elif mode=='expiry_cleanup':
                        target.fail_after_resource=True
                        a.call('resume', expected='storage_unavailable', operation_id=op)
                        advance(86400)
                        a.call('start_cleanup')
                        time.sleep(.2)
                        inventory=b.call('inventory')
                        assert inventory['snapshots']==inventory['keys']==0 and inventory['operations']==1
                        assert b.call('resume', operation_id=op)['status']=='expired' and target.count()==0
                        advance(29*86400)
                        # Update the worker's injected clock; no store access triggers cleanup here.
                        a.call('inventory')
                        time.sleep(.2)
                        assert b.call('inventory') == {'operations':0,'snapshots':0,'keys':0,'owners':1,'held':0,'cleanup_errors':0}
                        b.call('get', operation_id=op, expected='snapshot_unavailable')
                    else:
                        raise AssertionError('unknown_scenario')
                if mode not in ('lost_commit_restart','kill_after_commit','expiry_cleanup','hold_retention'):
                    state = json.dumps(b.call('state'))
                    assert not any(x in state for x in [config['source_auth'],config['target_auth'],mysql['app_password'],'"ticket"','t-teacher','person-a'])
        finally:
            target.proceed.set()
            for w in workers: w.close()
            target.close()
        if mode in ('lost_commit_restart','kill_after_commit'):
            target = Receiver(database, wire, config['target_auth'], secret)
            try:
                with serve(target) as target_wire:
                    a.config['targetOrigin']=target_wire.base
                    a.start()
                    result=a.call('resume', operation_id=op)
                    assert result['status']=='succeeded' and result['resource_ref']==original
                    assert result['open_target']=={'kind':'import_result','operation_id':op}
                    assert target.phases==['/tedna/status'] and target.count()==1
                    assert a.call('inventory')['snapshots']==0
            finally:
                a.close(); target.close()
    print(json.dumps({'case':mode,'passed':True}))


if __name__=='__main__':
    try: main()
    except Exception as error:
        # Never emit a traceback/config/DB exception with credentials or selected bytes.
        reason = str(error) if isinstance(error, AssertionError) else type(error).__name__
        if not reason or not all(c.isalnum() or c=='_' for c in reason): reason='assertion_failed'
        print('P03_SCENARIO_FAILURE:'+reason, file=sys.stderr)
        sys.exit(1)

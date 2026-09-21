"""Actual Node source + I03 loopback HTTP fake peers; no production integration.

python3 dev/p03-i03-source-check.py /home/hanying/pkuailab-id/dev/i03
Synthetic credentials exist only in test memory and the child stdin pipe.
"""
import base64
from contextlib import ExitStack, contextmanager
import json
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
if len(sys.argv) != 2:
    raise SystemExit('Pass the local Identity dev/i03 review package directory')
peer_dir = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(peer_dir))
from fake_peers import Clock, Identity, Target, serve
from protocol import NOW, sha, Failure

root = Path(__file__).resolve().parent.parent
checks = []


class FaultTarget(Target):
    lose_commit = False
    phases = None

    def handle(self, path, request, key, headers):
        if self.phases is None:
            self.phases = []
        self.phases.append(path)
        assert not headers.get('Authorization')  # Practice Basic must only reach Identity.
        response = super().handle(path, request, key, headers)
        if path == '/tedna/commit' and self.lose_commit:
            self.lose_commit = False
            self.drop_success_response = True  # serve closes socket after committed response.
        return response


class Worker:
    def __init__(self, directory, identity, target, authorization):
        self.config = dict(directory=directory, identityOrigin=identity.base, targetOrigin=target.base,
                           authorization=authorization)
        self.start()

    def start(self):
        self.process = subprocess.Popen(['node', str(root / 'dev/p03-i03-source-worker.cjs')],
            cwd=root, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        assert self.call('init', **self.config) == {'ready': True}

    def close(self):
        self.process.terminate()
        self.process.wait(timeout=5)
        self.process.stdin.close()
        self.process.stdout.close()

    def call(self, command, expected=None, **fields):
        self.process.stdin.write(json.dumps(dict(command=command, now=Clock.now * 1000, **fields)) + '\n')
        self.process.stdin.flush()
        result = json.loads(self.process.stdout.readline())
        if expected:
            assert result == {'ok': False, 'code': expected}, (command, result, expected)
            return
        assert result['ok'], (command, result)
        return result['result']


@contextmanager
def peers():
    Clock.now = NOW
    with ExitStack() as stack:
        directory = stack.enter_context(tempfile.TemporaryDirectory(prefix='p03-node-http-'))
        identity = Identity()
        iwire = stack.enter_context(serve(identity))
        dbpath, key = str(Path(directory) / 'receiver.sqlite'), secrets.token_bytes(32)
        target = FaultTarget(dbpath, iwire, identity.auth['tedna-client'], key)
        stack.callback(target.close)
        twire = stack.enter_context(serve(target))
        worker = Worker(directory, iwire, twire, identity.auth['ai-platform-client'])
        stack.callback(worker.close)
        yield worker, target, identity, directory, iwire, dbpath, key


with peers() as (s, t, i, directory, *_):
    op = s.call('freeze')['operation_id']
    assert s.call('freeze', purpose='courseware')['operation_id'] == op
    answers = s.call('duplicates', operation_id=op)
    assert all(a['status'] == 'succeeded' for a in answers) and t.count() == 1
    assert len({a['resource_ref'] for a in answers}) == 1
    assert answers[0]['open_target'] == {'kind': 'import_result', 'operation_id': op}
    assert answers[0]['continuation'] == {'status': 'not_started', 'landing': 'lesson_preparation'}
    assert t.phases == ['/tedna/prepare', '/tedna/commit', '/tedna/status', '/tedna/status', '/tedna/status']
    state = json.loads((Path(directory) / 'i03-source/state.json').read_text())
    received = json.loads(t.db.execute('SELECT package FROM resources').fetchone()[0])
    assert received == state['snapshots'][op]['packet']
    text = base64.b64decode(received['blobs'][0]['data_b64']).decode()
    assert text == '先观察，再记录两杯水的变化。'
    assert len(received['blobs']) == 2
    manifest = base64.b64decode(received['manifest_b64']).decode()
    all_text = manifest + ''.join(base64.b64decode(b['data_b64']).decode() for b in received['blobs'])
    assert all(x not in all_text for x in ['PRIVATE_THINKING', 'UNSELECTED_PRIVATE_PROMPT', '比较结果'])
    assert all(x not in json.dumps(i.operations, ensure_ascii=False) for x in ['先观察', 'activity.md', 'manifest_b64', 'conversation_id'])
    assert i.auth['ai-platform-client'] not in json.dumps(state) and 'ticket' not in json.dumps(state)
    assert t.open_result(op, 't-teacher')['resource_ref'] == answers[0]['resource_ref']
    try:
        t.open_result(op, 't-other')
    except Failure as error:
        assert error.code == 'resource_unavailable'
    else:
        raise AssertionError('Wrong target account accessed receipt')
    checks.append('actual-node-selected-bytes-duplicate-clicks-one-resource-receipt-owner-no-identity-content-no-persisted-credentials')

for kind, code in [('revoke', 'source_permission_revoked'), ('version', 'source_changed'), ('attachment', 'attachment_unavailable')]:
    with peers() as (s, t, i, *_):
        op = s.call('freeze')['operation_id']
        s.call('after_prepare', kind=kind)
        s.call('resume', operation_id=op, expected=code)
        assert s.call('status', operation_id=op)['status'] == 'cancelled'
        assert i.operations[op]['revoked'] and t.count() == 0 and '/tedna/commit' not in t.phases
        checks.append('prepared-then-' + kind + '-rechecked-before-release-cancelled')

with peers() as (s, t, i, *_):
    op = s.call('freeze')['operation_id']
    t.available = False
    s.call('resume', operation_id=op, expected='target_unavailable')
    s.call('resume', operation_id=op, expected='retry_later')
    t.available = True
    Clock.now += 121  # Old write ticket has expired; explicit resume uses a new status ticket.
    assert s.call('resume', operation_id=op)['status'] == 'succeeded' and t.count() == 1
    assert t.phases == ['/tedna/prepare', '/tedna/status', '/tedna/prepare', '/tedna/commit']
    checks.append('receiver-failure-old-ticket-expired-status-then-explicit-retry')

with peers() as (s, t, i, *_):
    op = s.call('freeze')['operation_id']
    i.available = False
    s.call('resume', operation_id=op, expected='identity_unavailable')
    i.available = True
    assert s.call('cancel', operation_id=op)['status'] == 'cancelled'
    assert not i.operations and t.count() == 0
    checks.append('failed-initial-issue-confirm-no-operation-before-local-cancel')

with peers() as (s, t, i, *_):
    op = s.call('freeze')['operation_id']
    i.drop_success_response = True
    s.call('resume', operation_id=op, expected='identity_unavailable')
    assert op in i.operations and t.count() == 0
    Clock.now += 121
    assert s.call('resume', operation_id=op)['status'] == 'succeeded'
    assert len(i.operations) == 1 and t.count() == 1
    checks.append('issue-response-lost-new-issue-key-same-durable-operation')

with peers() as (s, t, i, *_):
    op = s.call('freeze')['operation_id']
    t.fail_after_resource = True
    s.call('resume', operation_id=op, expected='storage_unavailable')
    assert t.count() == 0
    t.fail_after_resource = False
    Clock.now += 1
    assert s.call('resume', operation_id=op)['status'] == 'succeeded' and t.count() == 1
    assert t.phases == ['/tedna/prepare', '/tedna/commit', '/tedna/status', '/tedna/commit']
    checks.append('receiver-transaction-rollback-no-partial-resource-status-before-retry')

with peers() as (s, t, i, directory, iwire, dbpath, key):
    op = s.call('freeze')['operation_id']
    t.lose_commit = True
    s.call('resume', operation_id=op, expected='target_unavailable')
    assert s.call('get', operation_id=op)['status'] == 'unknown' and t.count() == 1
    old_ref = t.db.execute('SELECT id FROM resources').fetchone()[0]
    Clock.now += 2 * 86400  # Snapshot/old tickets expire; durable receipt remains recoverable.
    restarted = FaultTarget(dbpath, iwire, i.auth['tedna-client'], key)
    try:
        with serve(restarted) as wire:
            s.close()
            s.config['targetOrigin'] = wire.base
            s.start()
            answer = s.call('resume', operation_id=op)
            assert answer['status'] == 'succeeded' and answer['resource_ref'] == old_ref
            assert restarted.phases == ['/tedna/status'] and restarted.count() == 1
            state = json.loads((Path(directory) / 'i03-source/state.json').read_text())
            assert op not in state['snapshots'] and state['operations'][op]['released_at']
    finally:
        restarted.close()
    checks.append('accepted-response-lost-two-days-source-and-target-restart-status-only-same-resource')

with peers() as (s, t, i, *_):
    op = s.call('freeze')['operation_id']
    t.fail_before_commit = True
    s.call('resume', operation_id=op, expected='storage_unavailable')
    Clock.now += 86401
    assert s.call('resume', operation_id=op)['status'] == 'expired' and t.count() == 0
    assert t.phases == ['/tedna/prepare', '/tedna/commit', '/tedna/status']
    checks.append('prepared-expired-no-new-commit-or-operation')

with peers() as (s, t, i, *_):
    op = s.call('freeze')['operation_id']
    answer = s.call('resume', operation_id=op)
    assert s.call('cancel', operation_id=op)['resource_ref'] == answer['resource_ref']
    t.db.execute('UPDATE resources SET deleted=1')
    assert s.call('resume', operation_id=op)['status'] == 'deleted'
    assert s.call('freeze')['operation_id'] == op and t.count() == 1
    checks.append('cancel-after-success-preserves-resource-deletion-tombstone-never-reimports')

output = root / 'storage/private/p03-handoff-validation/i03-node-http-result.json'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps({'passed': True, 'protocol_version': 'i03-draft-0.1',
    'mode': 'actual Node source orchestration and transport; synthetic source authority and I03 HTTP peers; not real integration',
    'checks': checks, 'peer_file_sha256': {name: sha((peer_dir / name).read_bytes()) for name in ['protocol.py', 'fake_peers.py']}}, indent=2) + '\n')
print(f'P03 actual Node / I03 fake HTTP checks passed ({len(checks)}); evidence: {output}')

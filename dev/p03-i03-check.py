"""P03's encoded selected bytes against the optional I03 draft fake HTTP peers.

Run after node dev/p03-handoff-check.cjs --write-examples:
python3 dev/p03-i03-check.py /home/hanying/pkuailab-id/dev/i03
No real Identity/TE-DNA, credentials, accounts, database, or production endpoints.
"""
import copy
import http.client
import json
from pathlib import Path
import secrets
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack, contextmanager

sys.dont_write_bytecode = True
if len(sys.argv) != 2:
    raise SystemExit("Pass the local Identity dev/i03 review package directory")
peer_dir = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(peer_dir))
from fake_peers import Clock, Identity, Target, Source, serve  # noqa: E402
from protocol import NOW, Failure, binding_hash, validate_package, sha  # noqa: E402

root = Path(__file__).resolve().parent.parent
fixture = json.loads((root / 'docs/integrations/p03-handoff-examples.json').read_text())['i03_draft']
validate_package(fixture['package'], fixture['binding'])
assert binding_hash(fixture['binding']) == fixture['binding_sha256']
checks = []


@contextmanager
def peers():
    Clock.now = NOW
    with ExitStack() as stack:
        directory = stack.enter_context(tempfile.TemporaryDirectory(prefix='p03-i03-'))
        identity = Identity()
        iwire = stack.enter_context(serve(identity))
        dbpath, key = str(Path(directory) / 'receiver.sqlite'), secrets.token_bytes(32)
        target = Target(dbpath, iwire, identity.auth['tedna-client'], key)
        stack.callback(target.close)
        twire = stack.enter_context(serve(target))
        source = Source(copy.deepcopy(fixture), iwire, twire, identity.auth['ai-platform-client'])
        yield source, target, identity, iwire, dbpath, key


def fails(code, fn):
    try:
        fn()
    except Failure as error:
        assert error.code == code, (error.code, code)
    else:
        raise AssertionError('Expected ' + code)


with peers() as (source, target, identity, *_):
    assert source.prepare()['status'] == 'prepared'
    assert target.count() == 0
    with ThreadPoolExecutor(4) as pool:
        answers = list(pool.map(lambda _: source.commit(), range(4)))
    assert len({a['resource_ref'] for a in answers}) == 1 and target.count() == 1
    assert all(a['operation_id'] == fixture['binding']['operation_id'] for a in answers)
    stored = json.loads(target.db.execute('SELECT package FROM resources').fetchone()[0])
    assert stored == fixture['package']
    for forbidden in ['先观察', 'activity.md', '两杯水', 'manifest_b64', 'conversation_id']:
        assert forbidden not in json.dumps(identity.operations, ensure_ascii=False)
    checks.append('p03-bytes-prepare-commit-duplicate-clicks-one-resource-identity-has-no-content')

with peers() as (source, target, *_):
    ticket = source.issue('prepare')
    Clock.now += 121
    fails('ticket_expired', lambda: source.send('prepare', ticket))
    assert target.count() == 0
    checks.append('expired-ticket-rejected')

with peers() as (source, target, *_):
    source.prepare()
    ticket = source.issue('commit')
    source.revoke()
    fails('operation_cancelled', lambda: source.send('commit', ticket))
    assert source.send('cancel')['status'] == 'cancelled' and target.count() == 0
    checks.append('revoked-before-commit-no-resource')

with peers() as (source, target, *_):
    source.package['blobs'].pop()
    fails('invalid_package', source.prepare)
    assert target.count() == 0
    checks.append('missing-selected-attachment-atomic-rejection')

with peers() as (source, target, *_):
    target.available = False
    fails('target_unavailable', source.prepare)
    target.available = True
    assert source.status()['status'] == 'not_received'
    assert source.prepare()['status'] == 'prepared'
    assert source.commit()['status'] == 'succeeded' and target.count() == 1
    checks.append('receiver-failure-status-then-same-operation-retry')

with peers() as (source, target, identity, iwire, dbpath, key):
    source.prepare()
    target.drop_success_response = True
    try:
        source.commit()
    except http.client.RemoteDisconnected:
        pass
    else:
        raise AssertionError('Expected a dropped response after commit')
    Clock.now += 121
    restarted = Target(dbpath, iwire, identity.auth['tedna-client'], key)
    try:
        with serve(restarted) as wire:
            restored = Source(fixture, iwire, wire, identity.auth['ai-platform-client'])
            answer = restored.status()
            assert answer['status'] == 'succeeded' and restarted.count() == 1
            assert answer['open_target'] == {'kind': 'import_result', 'operation_id': fixture['binding']['operation_id']}
            assert restored.status()['resource_ref'] == answer['resource_ref']
            assert restored.commit()['resource_ref'] == answer['resource_ref'] and restarted.count() == 1
    finally:
        restarted.close()
    checks.append('accepted-lost-response-expired-ticket-restart-new-status-ticket-same-resource')

output = root / 'storage/private/p03-handoff-validation/i03-http-result.json'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps({'passed': True, 'protocol_version': fixture['protocol_version'],
    'mode': 'P03 encoder plus I03 synthetic HTTP/state model; not production source release or real integration',
    'binding_sha256': fixture['binding_sha256'], 'checks': checks,
    'peer_file_sha256': {name: sha((peer_dir / name).read_bytes()) for name in ['protocol.py', 'fake_peers.py']}}, indent=2) + '\n')
print(f'P03/I03 synthetic HTTP checks passed ({len(checks)}); evidence: {output}')

"""Create disposable MySQL8/PG18 containers; run source + provider lab checks.

No .env, existing databases, Identity writes, image pulls or production routes.
Only sanitized test output and input hashes are retained in storage/private.
"""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
IDENTITY = Path(sys.argv[1] if len(sys.argv)>1 else '/home/hanying/pkuailab-id').resolve()
EVIDENCE = ROOT/'storage/private/p03-handoff-validation'


def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs).stdout.strip()


def fingerprints():
    files = list((IDENTITY/'dev/i03/provider').glob('*')) + [IDENTITY/'dev/i03/fake_peers.py',IDENTITY/'dev/i03/protocol.py',
        IDENTITY/'dev/i03/node_source_integration.py', IDENTITY/'dev/i03/fixtures.json', IDENTITY/'go.mod', IDENTITY/'go.sum']
    files += list((ROOT/'backend/src/services/artifactHandoff').glob('*.js'))
    files += [ROOT/'dev'/name for name in ['p03-durable-check.py','p03-durable-scenarios.py','p03-provider-overlay.go','p03-mysql-worker.cjs','p03-mysql-fixture.cjs','p03-i03-source-worker.cjs']]
    return {str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in files if p.is_file()}


def main():
    os.umask(0o077)
    EVIDENCE.mkdir(parents=True,exist_ok=True)
    before=fingerprints()
    names={kind:'p03-durable-'+kind+'-'+uuid.uuid4().hex[:12] for kind in ['mysql','postgres']}
    images={'mysql':'mysql:8.0','postgres':'postgres:18'}
    passwords={kind:secrets.token_urlsafe(32) for kind in names}
    for image in images.values(): run(['docker','image','inspect',image],timeout=10)
    try:
        def start(kind):
            if kind=='mysql': envs={'MYSQL_ROOT_PASSWORD':passwords[kind]}; port='3306'
            else: envs={'POSTGRES_PASSWORD':passwords[kind],'POSTGRES_DB':'i03_lab'}; port='5432'
            args=['docker','run','-d','--pull=never','--name',names[kind],'--label','pkuailab.task=p03-durable-lab','-p','127.0.0.1::'+port]
            for key in envs: args += ['-e',key]
            args += [images[kind]]
            run(args,env={**os.environ,**envs},timeout=20)
            deadline=time.monotonic()+90
            while time.monotonic()<deadline:
                probe=['docker','exec',names[kind]]+(['mysqladmin','--host=127.0.0.1','ping','--silent'] if kind=='mysql' else ['pg_isready','-U','postgres','-d','i03_lab'])
                if subprocess.run(probe,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=5).returncode==0: break
                time.sleep(.3)
            else: raise RuntimeError('database_start_timeout')
            return int(run(['docker','port',names[kind],port+'/tcp'],timeout=5).rsplit(':',1)[1])
        with concurrent.futures.ThreadPoolExecutor(2) as ex:
            ports=dict(zip(names,ex.map(start,names)))
        print('Isolated MySQL/PG ready; executing Node source scenarios.',flush=True)
        with tempfile.TemporaryDirectory(prefix='p03-go-overlay-') as temp:
            overlay=Path(temp)/'overlay.json'
            overlay.write_text(json.dumps({'Replace':{str(IDENTITY/'dev/i03/provider/p03_durable_source_test.go'):str(ROOT/'dev/p03-provider-overlay.go')}}))
            env={**os.environ,'I03_LAB_DATABASE_URL':f"postgres://postgres:{passwords['postgres']}@127.0.0.1:{ports['postgres']}/i03_lab?sslmode=disable",
                'I03_LAB_ISOLATED':'1','I03_P03_ROOT':str(ROOT),'PYTHONPATH':str(IDENTITY/'dev/i03'),
                'PYTHONDONTWRITEBYTECODE':'1','P03_MYSQL_LAB':json.dumps({'host':'127.0.0.1','port':ports['mysql'],'user':'root','password':passwords['mysql']})}
            result=subprocess.run(['go','test','-race','-count=1','-json','-overlay',str(overlay),'-run',
                'TestP03MySQLSource|TestActualP03NodeSourceAgainstPostgresIdentity','./dev/i03/provider'],
                cwd=IDENTITY,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=300)
            events=[]
            for line in result.stdout.splitlines():
                try: events.append(json.loads(line))
                except json.JSONDecodeError: pass
            # Both package tests deliberately print only fixed safe errors on failure.
            safe_output=''.join(e.get('Output','') for e in events)
            for secret in list(passwords.values()):
                assert secret not in safe_output
            (EVIDENCE/'durable-source-tests.log').write_text(safe_output)
            passed=[e['Test'] for e in events if e.get('Action')=='pass' and 'Test' in e]
            failed=[e.get('Test','package') for e in events if e.get('Action')=='fail']
            skipped=[e.get('Test','package') for e in events if e.get('Action')=='skip']
            print(json.dumps({'returncode':result.returncode,'passed':passed,'failed':failed,'skipped':skipped}),flush=True)
            assert result.returncode==0 and not failed and not skipped
            assert len([n for n in passed if n.startswith('TestP03MySQLSource/')])==15
            assert len([n for n in passed if n.startswith('TestActualP03NodeSourceAgainstPostgresIdentity/')])==6
        after=fingerprints()
        assert before==after, 'inputs_changed_during_validation'
        evidence={'draft_only':True,'source':'actual Node/MySQL8 isolated lab','identity':'actual Go/PG18 isolated lab',
          'target':'fake SQLite TE-DNA','passed':passed,'race':True,'skipped':skipped,'input_sha256':before,
          'source_head':run(['git','rev-parse','HEAD'],cwd=ROOT),'identity_head':run(['git','rev-parse','HEAD'],cwd=IDENTITY),
          'images':{kind:json.loads(run(['docker','image','inspect',image,'--format','{{json .Id}}'])) for kind,image in images.items()}}
        (EVIDENCE/'durable-source-result.json').write_text(json.dumps(evidence,indent=2)+'\n')
    finally:
        for name in names.values():
            subprocess.run(['docker','rm','--force','--volumes',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15)
        print('Owned laboratory containers and volumes removed.',flush=True)


if __name__=='__main__':
    try: main()
    except Exception as error:
        print('P03_DURABLE_CHECK_FAILED:'+type(error).__name__,file=sys.stderr)
        sys.exit(1)

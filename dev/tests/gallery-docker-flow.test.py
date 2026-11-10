"""Execute the actual remote shell block with fake Docker; no SSH or production.
Only absolute backup paths are relocated into a private temp directory. SQL behavior
is tested separately against real MySQL. This harness never claims real image build.
"""
import unittest,tempfile,pathlib,subprocess,os,json,hashlib,shutil
ROOT=pathlib.Path(__file__).resolve().parents[2]
class Flow(unittest.TestCase):
 def run_flow(self,failure=''):
  with tempfile.TemporaryDirectory(prefix='gallery-shell-test-') as name:
   t=pathlib.Path(name);app=t/'app';app.mkdir();dev=app/'dev';dev.mkdir();binpath=t/'bin';binpath.mkdir();log=t/'calls';backups=t/'backups';pkg=t/'pkg';pkg.mkdir()
   (app/'.env').write_text('CUSTOMER_DOMAIN=example.invalid\n')
   for file in ['gallery-migrate.cjs','gallery-migration-plan.json']:(dev/file).write_bytes((ROOT/'dev'/file).read_bytes())
   (dev/'docker-release-lock.sh').write_text('#!/bin/bash\nprintf "UNLOCK %s\\n" "$*" >> "$MOCK_LOG"\n')
   (dev/'docker-release-preflight.sh').write_text('''#!/bin/bash
case "$1" in
 resources) exit 0;;
 arch) echo linux/amd64;;
 image-identity) case "$2" in *frontend*) echo "id=sha256:bbbb platform=linux/amd64 size=1 customer_domain=example.invalid";; *) echo "id=sha256:aaaa platform=linux/amd64 size=1 customer_domain=-";; esac;;
 runtime) if [ "$FAILURE" = health ]; then echo STALE; else echo CURRENT; fi;;
esac
''')
   fake=r'''#!/usr/bin/env python3
import sys,os,pathlib,json
args=sys.argv[1:];root=pathlib.Path(os.environ['MOCK_ROOT']);fail=os.environ['FAILURE'];log=pathlib.Path(os.environ['MOCK_LOG'])
with log.open('a') as f:f.write(json.dumps(args)+'\n')
if args[0]=='inspect':
 fmt=args[-1]
 if 'State.Running' in fmt:print('false' if (root/'stopped').exists() else 'true')
 elif 'Config.Cmd' in fmt:print('["su-exec","nodejs","node","src/server.js"]')
 elif 'Config.Image' in fmt:print('old:parent')
 elif '.Image' in fmt:print('sha256:old')
elif args[:2]==['image','inspect']:
 print('["/bin/sh","-c","/usr/local/bin/run-migrations.sh && su-exec nodejs node src/server.js"]')
elif args[:2]==['compose','stop']:(root/'stopped').touch()
elif args[0]=='compose' and 'run' in args:
 mount=args[args.index('-v',args.index('-v')+1)+1];evidence=pathlib.Path(mount.split(':')[0]);action=args[args.index('/gallery-tools/gallery-migrate.cjs')+1]
 if action=='inspect':(evidence/'PLAN.json').write_text('{}')
 else:
  (evidence/'INTENT.json').write_text('{}')
  if fail=='migration':sys.exit(72)
  (evidence/'COMPLETE.json').write_text('{"verified":true}')
elif args[0]=='compose' and 'up' in args:
 if fail=='switch':sys.exit(73)
 (root/'stopped').unlink(missing_ok=True)
elif args[0]=='exec':print('-- synthetic dump, no production data\nCREATE TABLE fixture(id INT);')
elif args[0]=='ps':print('ai-platform-backend healthy')
'''
   (binpath/'docker').write_text(fake);(binpath/'docker').chmod(0o700)
   (binpath/'sleep').write_text('#!/bin/sh\nexit 0\n');(binpath/'sleep').chmod(0o700)
   for args in [['init','-q'],['config','user.email','test@invalid.local'],['config','user.name','Local test'],['add','.'],['commit','-qm','fixture']]:subprocess.run(['git','-C',str(app),*args],check=True,stdout=subprocess.DEVNULL)
   sha=subprocess.check_output(['git','-C',str(app),'rev-parse','HEAD'],text=True).strip()
   tar=pkg/'images.tar.gz';tar.write_bytes(b'synthetic archive');tarsha=hashlib.sha256(tar.read_bytes()).hexdigest();(pkg/'MANIFEST.env').write_text('SOURCE_COMMIT='+sha+'\n')
   script=(ROOT/'dev/deploy-docker.sh').read_text().split("<<'REMOTE' | tee \"$REMOTE_LOG\"\n",1)[1].split('\nREMOTE\n',1)[0]
   script=script.replace('/var/backups/ai-platform',str(backups))
   args=[str(app),sha[:7],'3','0','0','0','7','prebuilt',str(t/'lock'),'local-token',str(pkg),'v-'+sha[:7]+'-20261111_230000',tarsha,'sha256:aaaa','sha256:bbbb','linux/amd64','0','1','1','local-test-approval',sha]
   env={**os.environ,'PATH':str(binpath)+':'+os.environ['PATH'],'MOCK_ROOT':str(t),'MOCK_LOG':str(log),'FAILURE':failure}
   result=subprocess.run(['bash','-s','--',*args],input=script,text=True,capture_output=True,env=env,timeout=25)
   calls=log.read_text() if log.exists() else ''
   self.assertNotIn('UNLOCK',calls,'gallery remote block must leave lock to outer owner')
   self.assertNotIn('migrate:latest',calls)
   self.assertNotIn('run-migrations.sh',result.stdout)
   self.assertNotIn('autoremove',calls)
   rel=backups/'releases'/('ai-platform-'+args[11]);evidence=rel/'gallery-migrations'
   self.assertTrue((evidence/'PLAN.json').exists(),result.stdout+result.stderr)
   self.assertTrue((evidence/'BACKUP.json').exists(),result.stdout+result.stderr)
   self.assertTrue((evidence/'INTENT.json').exists(),result.stdout+result.stderr)
   if failure:
    self.assertNotEqual(result.returncode,0)
    self.assertNotIn('REMOTE_DONE',result.stdout)
    self.assertFalse((backups/'releases/current').exists())
    if failure=='migration':
     self.assertFalse((evidence/'COMPLETE.json').exists());self.assertNotIn('"up", "-d"',calls)
    if failure=='health':self.assertIn('persistent gallery freeze BEFORE',result.stdout)
   else:
    self.assertEqual(result.returncode,0,result.stdout+result.stderr);self.assertIn('REMOTE_DONE',result.stdout)
    self.assertTrue((evidence/'COMPLETE.json').exists());self.assertTrue((backups/'releases/current').is_symlink())
    self.assertIn('STARTUP_MIGRATIONS=skipped-gallery-exact',(rel/'RELEASE.txt').read_text())
   return result.returncode
 def test_outer_lock_retained_until_all_postchecks_finish(self):
  source=(ROOT/'dev/deploy-docker.sh').read_text();function=next(line for line in source.splitlines() if line.startswith('release_lock() {'))
  with tempfile.TemporaryDirectory(prefix='gallery-lock-test-') as name:
   t=pathlib.Path(name);calls=t/'calls';ssh=t/'ssh';locksh=t/'lock.sh';locksh.write_text('')
   ssh.write_text('#!/bin/sh\nprintf release >> "$CALLS"\n');ssh.chmod(0o700)
   for done in ['0','1']:
    script='GALLERY_REVIEW=1; LOCK_HELD=1; LOCK_TOKEN=fixture; LOCK_DIR=/fixture; GALLERY_REMOTE_DONE='+done+'; SSH="'+str(ssh)+'"; LOCKSH="'+str(locksh)+'"\n'+function+'\nrelease_lock\n'
    result=subprocess.run(['bash','-s'],input=script,text=True,capture_output=True,env={**os.environ,'CALLS':str(calls)})
    self.assertEqual(result.returncode,0)
    self.assertEqual(calls.exists(),done=='1')
 def test_invalid_gallery_modes_refuse_before_network(self):
  for args in [['--gallery-review=test'],['--prebuilt=/no-package','--keep-history','--gallery-review='],['--prebuilt=/no-package','--keep-history','--gallery-review=test','--code-only'],['--prebuilt=/no-package','--keep-history','--gallery-review=test','--allow-ahead'],['--prebuilt=/no-package','--keep-history','--gallery-review=test','-y']]:
   result=subprocess.run(['bash',str(ROOT/'dev/deploy-docker.sh'),*args],capture_output=True,text=True)
   self.assertEqual(result.returncode,2,result.stdout+result.stderr)
 def test_success(self):self.run_flow()
 def test_migration_failure(self):self.run_flow('migration')
 def test_switch_failure(self):self.run_flow('switch')
 def test_unhealthy_requires_freeze(self):self.run_flow('health')
if __name__=='__main__':unittest.main()

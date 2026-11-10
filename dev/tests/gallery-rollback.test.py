"""Native rollback/PM2 tail fault probes. All external commands are local stubs;
freeze SQL itself is exercised separately against isolated real MySQL."""
import unittest,tempfile,pathlib,subprocess,os,shutil,json
ROOT=pathlib.Path(__file__).resolve().parents[2]
class Gates(unittest.TestCase):
 def test_old_make_entries_refuse_without_ssh(self):
  with tempfile.TemporaryDirectory() as name:
   t=pathlib.Path(name);calls=t/'calls';ssh=t/'ssh';ssh.write_text('#!/bin/sh\necho called >> "$CALLS"\n');ssh.chmod(0o700)
   for target in ['rollback','rollback-docker']:
    r=subprocess.run(['make','--no-print-directory',target],cwd=ROOT,capture_output=True,text=True,env={**os.environ,'PATH':str(t)+':'+os.environ['PATH'],'CALLS':str(calls)})
    self.assertNotEqual(r.returncode,0);self.assertFalse(calls.exists());self.assertNotIn('rollback.override.yml up',r.stdout+r.stderr)
 def test_pm2_tail_releases_only_after_all_checks(self):
  source=(ROOT/'dev/deploy.sh').read_text();function=source[source.index('finish_deploy() {'):source.index('trap finish_deploy EXIT')];tail=source[source.index('if [ "$PREPARED_MIGRATIONS" = 1 ]; then PREPARED_REMOTE_TERMINAL=1; fi'):]
  for failure in ['first-health','last-health','push','remote-unknown','success']:
   with self.subTest(failure=failure),tempfile.TemporaryDirectory() as name:
    t=pathlib.Path(name);calls=t/'calls';ssh=t/'ssh';ssh.write_text('#!/bin/bash\nprintf "%s\\n" "$*" >> "$CALLS"\n');ssh.chmod(0o700)
    pre='''set -euo pipefail
PREPARED_MIGRATIONS=1; PREPARED_LOCK_HELD=1; PREPARED_REMOTE_TERMINAL=0; PREPARED_CHECKS_SUCCEEDED=0
BUNDLE=""; PREPARED_TOKEN=synthetic; PREPARED_LOCK=/synthetic/lock; SSH_HOST=invalid.local; REMOTE_DIR=/synthetic/app
HEALTH_URL=http://invalid.local; SERVER_FIRST=1; LOCAL_SHA=fixture; CURL_CALLS=0
curl() { CURL_CALLS=$((CURL_CALLS+1)); if { [ "$FAILURE" = first-health ] && [ "$CURL_CALLS" = 1 ]; } || { [ "$FAILURE" = last-health ] && [ "$CURL_CALLS" = 2 ]; }; then return 22; fi; }
push_branch() { [ "$FAILURE" != push ]; }
git() { return 0; }
'''
    script=pre+function+'\ntrap finish_deploy EXIT\n'+('exit 1\n' if failure=='remote-unknown' else tail)
    r=subprocess.run(['bash','-s'],input=script,text=True,capture_output=True,env={**os.environ,'PATH':str(t)+':'+os.environ['PATH'],'CALLS':str(calls),'FAILURE':failure})
    self.assertEqual(r.returncode==0,failure=='success',r.stdout+r.stderr)
    self.assertEqual(calls.exists(),failure=='success',r.stdout+r.stderr)
 def run_rollback(self,mode,failure):
  with tempfile.TemporaryDirectory(prefix='gallery-rollback-test-') as name:
   t=pathlib.Path(name);app=t/'app';dev=app/'dev';dev.mkdir(parents=True);(app/'backend').mkdir();bins=t/'bin';bins.mkdir();calls=t/'calls';base=t/'releases';base.mkdir()
   script=(ROOT/'dev/gallery-safe-rollback.sh').read_text().replace('/var/www/ai-platform',str(app)).replace('/var/backups/ai-platform/releases',str(base))
   (dev/'gallery-safe-rollback.sh').write_text(script)
   for n in ['gallery-freeze-gate.cjs','gallery-migrate.cjs','gallery-migration-plan.json','docker-release-lock.sh']:shutil.copyfile(ROOT/'dev'/n,dev/n)
   (app/'rebuild.sh').write_text('#!/bin/bash\n[ "$REBUILD_KEEP_LOGS" = 1 ]\necho PM2_SWITCH >> "$CALLS"\n')
   (app/'version').write_text('old')
   def git(*args):return subprocess.check_output(['git','-C',str(app),*args],text=True,stderr=subprocess.DEVNULL).strip()
   git('init','-q');git('config','user.email','test@invalid.local');git('config','user.name','Local test');git('add','.');git('commit','-qm','parent');parent=git('rev-parse','HEAD');(app/'version').write_text('new');git('add','.');git('commit','-qm','candidate');head=git('rev-parse','HEAD')
   rel=base/'candidate';rel.mkdir();(rel/'PREPARED.json').write_text(json.dumps({'parent':parent,'target':head}));(rel/'RELEASE.txt').write_text('SOURCE_COMMIT='+head+'\n');(rel/'release.override.yml').write_text('services: {}\n');(rel/'rollback.override.yml').write_text('services:\n  backend:\n    image: ai-platform-backend:rollback-20261111_230000\n    command: ["su-exec", "nodejs", "node", "src/server.js"]\n  frontend:\n    image: ai-platform-frontend:rollback-20261111_230000\n')
   fake=r'''#!/usr/bin/env python3
import sys,os,pathlib,json
args=sys.argv[1:];name=pathlib.Path(sys.argv[0]).name;fail=os.environ['FAILURE'];calls=pathlib.Path(os.environ['CALLS']);root=pathlib.Path(os.environ['FIXTURE'])
with calls.open('a') as f:f.write(json.dumps([name,*args])+'\n')
def gate(action,evidence):
 if action=='apply':
  if fail=='apply':sys.exit(71)
  (evidence/'FREEZE-VERIFIED.json').write_text('{"frozen":true}')
 else:
  countfile=root/'verifies';n=int(countfile.read_text())+1 if countfile.exists() else 1;countfile.write_text(str(n))
  if fail=='verify' or (fail=='late-verify' and n==2):sys.exit(72)
if name=='node':
 if args[0].endswith('gallery-freeze-gate.cjs'):gate(args[1],pathlib.Path(args[3]))
 else:os.execv(os.environ['REAL_NODE'],[os.environ['REAL_NODE'],*args])
elif name=='curl':
 if fail=='health':sys.exit(22)
elif name=='docker':
 if args[0]=='compose' and 'run' in args:
  filename='/gallery-rollback/gallery-freeze-gate.cjs';mount=args[args.index('-v')+1];gate(args[args.index(filename)+1],pathlib.Path(mount.split(':')[0]))
 elif args[:2]==['image','inspect']:print('sha256:'+('a' if 'backend' in args[2] else 'b')*64)
 elif args[0]=='inspect':
  if 'State' in args[-1]:print('true healthy')
  else:print('sha256:'+('a' if 'backend' in args[1] else 'b')*64)
'''
   for n in ['node','docker','curl']:(bins/n).write_text(fake);(bins/n).chmod(0o700)
   env={**os.environ,'PATH':str(bins)+':'+os.environ['PATH'],'REAL_NODE':shutil.which('node'),'HOME':str(t/'home'),'FIXTURE':str(t),'CALLS':str(calls),'FAILURE':failure}
   r=subprocess.run(['bash',str(dev/'gallery-safe-rollback.sh'),mode,str(rel),parent if mode=='pm2' else 'recorded-images','local-test-approval','local-lock-token'],text=True,capture_output=True,env=env,timeout=20)
   log=calls.read_text() if calls.exists() else '';switched=('PM2_SWITCH' in log if mode=='pm2' else '"up", "-d"' in log)
   self.assertEqual(switched,failure not in ['apply','verify'],r.stdout+r.stderr+log)
   self.assertEqual(r.returncode==0,failure=='success',r.stdout+r.stderr+log)
   self.assertEqual((base/'.lock').exists(),failure!='success')
   if mode=='pm2':self.assertEqual(git('rev-parse','HEAD'),parent if switched else head)
   if switched:self.assertLess(log.index('"apply"'),log.index('PM2_SWITCH' if mode=='pm2' else '"up", "-d"'))
 def test_rollback_gate_both_sites(self):
  for mode in ['docker','pm2']:
   for failure in ['apply','verify','health','late-verify','success']:
    with self.subTest(mode=mode,failure=failure):self.run_rollback(mode,failure)
if __name__=='__main__':unittest.main()

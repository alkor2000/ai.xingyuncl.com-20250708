"""Isolated loopback SSH exec server, ephemeral public key only. No production config."""
import paramiko,socket,threading,subprocess,sys,json,os,signal
from pathlib import Path
base=Path(sys.argv[1]); os.umask(0o077)
key=paramiko.RSAKey.generate(2048)
expected=(base/'ssh-client.pub').read_text().split()[1]
class Server(paramiko.ServerInterface):
 def __init__(self):self.event=threading.Event();self.command=None
 def check_auth_publickey(self,username,k):
  return paramiko.AUTH_SUCCESSFUL if username=='gallery-isolated' and k.get_base64()==expected else paramiko.AUTH_FAILED
 def get_allowed_auths(self,username):return 'publickey'
 def check_channel_request(self,kind,chanid):return paramiko.OPEN_SUCCEEDED if kind=='session' else paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED
 def check_channel_exec_request(self,channel,command):self.command=command.decode();self.event.set();return True
def connection(client):
 t=paramiko.Transport(client);s=Server()
 try:
  t.add_server_key(key);t.start_server(server=s);ch=t.accept(15)
  if ch is None or not s.event.wait(15):return
  # OpenSSH has already combined the supplied argv into THIS command string.
  with (base/'ssh-commands.private.log').open('a') as f:f.write(json.dumps(s.command)+'\n')
  p=subprocess.Popen(['bash','-c',s.command],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  def feed():
   try:
    while True:
     data=ch.recv(65536)
     if not data:break
     p.stdin.write(data);p.stdin.flush()
   except (OSError,EOFError):pass
   finally:
    try:p.stdin.close()
    except OSError:pass
  def output(stream,send):
   try:
    while True:
     data=stream.read1(65536)
     if not data:break
     send(data)
   except (OSError,EOFError):pass
  a=threading.Thread(target=feed,daemon=True);b=threading.Thread(target=output,args=(p.stdout,ch.sendall),daemon=True);c=threading.Thread(target=output,args=(p.stderr,ch.sendall_stderr),daemon=True)
  for thread in [a,b,c]:thread.start()
  rc=p.wait(timeout=150)
  for thread in [b,c]:thread.join(5)
  ch.send_exit_status(rc);ch.shutdown_write();ch.close()
 finally:t.close()
sock=socket.socket();sock.bind(('127.0.0.1',0));sock.listen(16)
port=sock.getsockname()[1]
(base/'ssh-known-hosts').write_text(f'[127.0.0.1]:{port} {key.get_name()} {key.get_base64()}\n')
(base/'ssh-ready.json').write_text(json.dumps({'host':'127.0.0.1','port':port}))
while True:
 client,_=sock.accept();threading.Thread(target=connection,args=(client,),daemon=True).start()

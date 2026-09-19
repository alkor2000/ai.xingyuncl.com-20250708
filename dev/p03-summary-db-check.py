#!/usr/bin/env python3
"""Owned disposable MySQL; checks the actual Message query used by summary, never a shared DB."""
import json, os, pathlib, secrets, subprocess, tempfile, time
root = pathlib.Path(__file__).resolve().parents[1]
name = 'p03-summary-check-' + secrets.token_hex(4)
password = secrets.token_urlsafe(24)
run = lambda args, **kw: subprocess.run(args, check=True, text=True, capture_output=True, **kw)
with tempfile.TemporaryDirectory(prefix='p03-summary-db-') as temp:
    env_file = pathlib.Path(temp) / 'mysql.env'
    env_file.write_text('MYSQL_ROOT_PASSWORD=' + password + '\nMYSQL_DATABASE=p03_summary\n')
    os.chmod(env_file, 0o600)
    try:
        run(['docker', 'run', '-d', '--name', name, '--label', 'pkuailab.task=p03-summary-check', '--env-file', str(env_file), '-p', '127.0.0.1::3306', 'mysql:8.0'])
        port = int(run(['docker', 'port', name, '3306/tcp']).stdout.strip().rsplit(':', 1)[1])
        config = dict(host='127.0.0.1', port=port, user='root', password=password, database='p03_summary')
        script = r'''
const fs=require('node:fs'), assert=require('node:assert/strict');
const mysql=require('./backend/node_modules/mysql2/promise');
(async()=>{
 const config=JSON.parse(fs.readFileSync(0,'utf8')); let pool;
 for(let i=0;i<90;i++){try{pool=mysql.createPool(config);await pool.query('SELECT 1');break}catch(e){await pool.end();pool=null;await new Promise(r=>setTimeout(r,1000))}}
 assert(pool,'isolated MySQL ready');
 try{
 await pool.query('CREATE TABLE conversations(id VARCHAR(64) PRIMARY KEY, context_length INT, cleared_at DATETIME(3) NULL)');
 await pool.query('CREATE TABLE messages(id VARCHAR(64) PRIMARY KEY, conversation_id VARCHAR(64), sequence_number INT, role VARCHAR(16), content TEXT, status VARCHAR(16), created_at DATETIME(3))');
 await pool.query("INSERT INTO conversations VALUES ('owned',2,NULL),('other',2,NULL)");
 for(let i=0;i<44;i++)await pool.query('INSERT INTO messages VALUES (?,?,?,?,?,?,?)',['m'+i,'owned',i,i%2?'assistant':'user',i===0?'EARLY_CONDITION':'讨论'+i,'completed',new Date(1700000000000+i*1000)]);
 await pool.query("INSERT INTO messages VALUES ('foreign','other',45,'assistant','OTHER_ACCOUNT','completed',NOW()),('failed','owned',46,'assistant','FAILED_TEXT','failed',NOW())");
 const db=require.resolve('./backend/src/database/connection'); require.cache[db]={id:db,filename:db,loaded:true,exports:{query:async(sql,args)=>({rows:(await pool.query(sql,args))[0]})}};
 const logger=require.resolve('./backend/src/utils/logger');require.cache[logger]={id:logger,filename:logger,loaded:true,exports:{info(){},error(){},warn(){}}};
 const Message=require('./backend/src/models/Message');
 assert.equal((await Message.getRecentMessages('owned')).length,2);
 const history=await Message.getRecentMessages('owned',201);assert.equal(history.length,44);assert.equal(history[0].content,'EARLY_CONDITION');assert(!JSON.stringify(history).includes('OTHER_ACCOUNT'));assert(!JSON.stringify(history).includes('FAILED_TEXT'));
 await pool.query('UPDATE conversations SET cleared_at=? WHERE id=?',[new Date(1700000019000),'owned']);
 const cleared=await Message.getRecentMessages('owned',201);assert.equal(cleared.length,24);assert.equal(cleared[0].id,'m20');
 console.log(JSON.stringify({passed:true,checks:['complete-history-beyond-context-length','only-requested-conversation','failed-messages-excluded','cleared-messages-excluded'],database:'disposable-mysql8-synthetic'}));
 }finally{await pool.end()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
'''
        result = run(['node', '-e', script], cwd=root, input=json.dumps(config), timeout=140)
        output = root / 'storage/private/p03-summary-validation/database-result.json'
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(result.stdout)
        print(result.stdout.strip())
    finally:
        subprocess.run(['docker', 'rm', '-fv', name], capture_output=True)

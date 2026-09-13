#!/usr/bin/env node
'use strict';

const C = require('../src/services/auth/IdentityEnrollmentContract');
const S = require('../src/services/auth/IdentityEnrollmentState');
const client = require('../src/services/auth/IdentityEnrollmentClient');

const HELP = `AI Platform Identity Enrollment 消费者

prepare --directory ABS --issuer HTTPS_ORIGIN --binding-file ABS --token-file ABS
  从私有JSON文件读取完整部署绑定及Identity签发回执，保存请求，不发送。
send --directory ABS
  发送尚未尝试的请求；凭据已保存时仅返回安全状态。
resume --directory ABS
  明确复用原请求核实结果；不更新时间戳，不自动循环重试。
status --directory ABS
  仅检查本地状态，不访问Identity或业务数据库。
record-receipt --directory ABS --receipt-file ABS
  请求窗口已过且缺少回执时，导入受控管理CLI查询回执。
import-secret --directory ABS --secret-file ABS
  导入受控换密结果，要求已有回执且Instance、Client仍为disabled。

操作要求：Linux root；目录父级预先建立为0700；输入JSON文件为0400或0600。
目录必须位于后端私有存储，不得放入前端、镜像构建上下文或公开上传目录。
Token及Secret只从文件读取，不接受凭据明文参数，不输出凭据正文。
任何异常均保留请求与已有文件；不要删目录重建或重新签发来代替恢复。
保存凭据不代表已完成Verify、Enable或运行配置激活。
`;

function parse(args) {
  if (!args.length || (args.length === 1 && ['help', '--help', '-h'].includes(args[0]))) return { command: 'help' };
  const definitions = {
    prepare: ['directory', 'issuer', 'binding-file', 'token-file'],
    send: ['directory'], resume: ['directory'], status: ['directory'],
    'record-receipt': ['directory', 'receipt-file'], 'import-secret': ['directory', 'secret-file']
  };
  const command = args[0], allowed = definitions[command];
  C.requireValue(allowed && args.length === 1 + allowed.length * 2, 'ENROLLMENT_ARGUMENTS_INVALID');
  const result = { command };
  for (let index = 1; index < args.length; index += 2) {
    const name = args[index].startsWith('--') ? args[index].slice(2) : '';
    C.requireValue(allowed.includes(name) && !Object.hasOwn(result, name) && args[index + 1],
      'ENROLLMENT_ARGUMENTS_INVALID');
    result[name] = args[index + 1];
  }
  return result;
}
async function main() {
  const options = parse(process.argv.slice(2));
  if (options.command === 'help') { process.stdout.write(HELP); return; }
  C.requireValue(process.platform === 'linux' && process.getuid() === 0 && process.getgid() === 0,
    'ENROLLMENT_ROOT_REQUIRED');
  process.umask(0o077);
  let result;
  switch (options.command) {
    case 'prepare':
      result = await client.prepare(options.directory, options.issuer,
        S.readPrivate(options['binding-file']), S.readPrivate(options['token-file']));
      break;
    case 'send': result = await client.consume(options.directory); break;
    case 'resume': result = await client.consume(options.directory, { resume: true }); break;
    case 'status': result = await client.status(options.directory); break;
    case 'record-receipt':
      result = await client.recordReceipt(options.directory, S.readPrivate(options['receipt-file']));
      break;
    case 'import-secret':
      result = await client.importSecret(options.directory, S.readPrivate(options['secret-file']));
      break;
  }
  // 唯一stdout结果来自安全摘要，不序列化请求、响应、Axios配置或异常堆栈。
  process.stdout.write(JSON.stringify(result) + '\n');
}
process.stdout.on('error', () => {
  process.exitCode = 1;
  process.stderr.write('ENROLLMENT_OUTPUT_FAILED_CHECK_LOCAL_STATUS\n');
});
main().catch(error => {
  const code = typeof error.code === 'string' && /^ENROLLMENT_[A-Z0-9_]+$/.test(error.code)
    ? error.code : 'ENROLLMENT_LOCAL_IO_FAILED';
  process.stderr.write(JSON.stringify({ error: code, action: '保留现场，返回本条错误，由助手检查本地状态。' }) + '\n');
  process.exitCode = 1;
});

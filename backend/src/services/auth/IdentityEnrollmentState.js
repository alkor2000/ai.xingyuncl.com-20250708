'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const C = require('./IdentityEnrollmentContract');

// 私有状态独立于源码与镜像。所有记录只创建、不覆盖；半写文件保留并阻止继续请求。
// root或当前执行用户必须拥有路径。共享临时目录只允许root拥有且带sticky位的祖先。
function directory(target, privateLeaf = false) {
  C.requireValue(typeof target === 'string' && path.isAbsolute(target) && path.normalize(target) === target,
    'ENROLLMENT_PATH_INVALID');
  let current = path.parse(target).root;
  for (const part of ['', ...target.split(path.sep).filter(Boolean)]) {
    if (part) current = path.join(current, part);
    const info = fs.lstatSync(current);
    C.requireValue(info.isDirectory() && !info.isSymbolicLink() &&
      (info.uid === 0 || info.uid === process.getuid()), 'ENROLLMENT_DIRECTORY_UNSAFE');
    const sharedTemporary = info.uid === 0 && (info.mode & 0o1000) !== 0 && current !== target;
    C.requireValue((info.mode & 0o022) === 0 || sharedTemporary, 'ENROLLMENT_DIRECTORY_UNSAFE');
    if (current === target && privateLeaf) {
      C.requireValue(info.uid === process.getuid() && (info.mode & 0o777) === 0o700,
        'ENROLLMENT_DIRECTORY_NOT_PRIVATE');
    }
  }
  return target;
}
function syncDirectory(target) {
  const descriptor = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}
function location(root, name) {
  C.requireValue(/^[a-z][a-z0-9-]*\.json$/.test(name), 'ENROLLMENT_RECORD_NAME_INVALID');
  return path.join(root, name);
}
function readPrivate(file) {
  C.requireValue(typeof file === 'string' && path.isAbsolute(file) && path.normalize(file) === file,
    'ENROLLMENT_PATH_INVALID');
  directory(path.dirname(file));
  // O_NONBLOCK避免被FIFO挂住；fstat验证打开的真实对象，不能只依赖打开前的路径检查。
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(descriptor);
    C.requireValue(before.isFile() && before.nlink === 1 && before.uid === process.getuid() &&
      [0o400, 0o600].includes(before.mode & 0o777) && before.size > 0 && before.size <= C.MAX_BYTES,
    'ENROLLMENT_FILE_NOT_PRIVATE');
    const data = Buffer.alloc(before.size + 1);
    let length = 0, count;
    do {
      count = fs.readSync(descriptor, data, length, data.length - length, null);
      length += count;
    } while (count > 0 && length < data.length);
    const after = fs.fstatSync(descriptor);
    C.requireValue(length === before.size && before.size === after.size && before.mtimeMs === after.mtimeMs &&
      before.ctimeMs === after.ctimeMs && after.nlink === 1, 'ENROLLMENT_FILE_CHANGED');
    return C.decodeJSON(data.subarray(0, length));
  } finally { fs.closeSync(descriptor); }
}
function read(root, name) { return readPrivate(location(root, name)); }
function optional(root, name) {
  const file = location(root, name);
  try { fs.lstatSync(file); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  return readPrivate(file);
}
function write(root, name, value) {
  directory(root, true);
  const data = Buffer.from(JSON.stringify(value) + '\n');
  C.requireValue(data.length <= C.MAX_BYTES, 'ENROLLMENT_RECORD_TOO_LARGE');
  const descriptor = fs.openSync(location(root, name), fs.constants.O_WRONLY | fs.constants.O_CREAT |
    fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {
    fs.writeFileSync(descriptor, data);
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
  syncDirectory(root);
}
function create(root, request) {
  C.requireValue(typeof root === 'string' && path.isAbsolute(root) && path.normalize(root) === root,
    'ENROLLMENT_PATH_INVALID');
  directory(path.dirname(root), true);
  C.validateRequest(request);
  // mkdir不使用recursive，已存在目录意味着另一次操作或失败现场，不能悄悄复用。
  fs.mkdirSync(root, { mode: 0o700 });
  syncDirectory(path.dirname(root));
  write(root, 'request.json', request);
  load(root);
}
function load(root) {
  directory(root, true);
  return C.validateRequest(read(root, 'request.json'));
}
function digest(request) {
  return createHash('sha256').update(JSON.stringify(C.validateRequest(request))).digest('hex');
}
function attempts(root) {
  return fs.readdirSync(root).filter(name => /^attempt-[0-9a-f-]{36}\.json$/.test(name));
}
async function locked(root, action) {
  directory(root, true);
  const lock = path.join(root, '.lock');
  try { fs.mkdirSync(lock, { mode: 0o700 }); } catch (error) {
    if (error.code === 'EEXIST') throw C.problem('ENROLLMENT_OPERATION_LOCKED');
    throw error;
  }
  // 进程被强制终止时留下锁及PID；禁止按超时自动删锁或抢占尚未确认结束的操作。
  write(lock, 'owner.json', { pid: process.pid, started_at: new Date().toISOString() });
  try { return await action(); } finally {
    fs.unlinkSync(path.join(lock, 'owner.json'));
    fs.rmdirSync(lock);
    syncDirectory(root);
  }
}
module.exports = { directory, readPrivate, read, optional, write, create, load, digest, attempts, locked };

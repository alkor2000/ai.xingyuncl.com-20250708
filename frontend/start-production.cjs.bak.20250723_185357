#!/usr/bin/env node

/**
 * 前端生产环境启动脚本
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('启动 AI Platform 前端服务...');

// 启动serve服务器
const serve = spawn('serve', [
  '-s', 'dist',          // 服务dist目录，SPA模式
  '-l', '3000',          // 监听3000端口
  '--cors',              // 启用CORS
  '--single'             // SPA单页应用模式
], {
  stdio: 'inherit',
  cwd: path.join(__dirname)
});

// 处理进程退出
serve.on('close', (code) => {
  console.log(`serve进程退出，代码: ${code}`);
  process.exit(code);
});

serve.on('error', (err) => {
  console.error('启动serve失败:', err);
  process.exit(1);
});

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('收到SIGTERM，关闭serve进程...');
  serve.kill('SIGTERM');
});

process.on('SIGINT', () => {
  console.log('收到SIGINT，关闭serve进程...');
  serve.kill('SIGINT');
});

console.log('前端服务正在启动，端口: 3000');

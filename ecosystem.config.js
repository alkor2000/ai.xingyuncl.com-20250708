module.exports = {
  apps: [
    {
      name: 'ai-platform-auth',
      script: '/var/www/ai-platform/backend/src/server.js',
      cwd: '/var/www/ai-platform/backend',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 4000
      },
      log_file: '/var/www/ai-platform/logs/backend/auth/combined.log',
      out_file: '/var/www/ai-platform/logs/backend/auth/out.log',
      error_file: '/var/www/ai-platform/logs/backend/auth/error.log',
      log_type: 'json',
      merge_logs: true,
      time: true,
      max_memory_restart: '2G',  // 增加到2GB
      node_args: '--max-old-space-size=2048',  // 增加到2GB
      restart_delay: 5000,
      max_restarts: 10,
      kill_timeout: 5000,
      listen_timeout: 10000,
      autorestart: true,
      watch: false,
      ignore_watch: [
        'node_modules',
        'logs',
        '.git'
      ]
    },
    {
      name: 'ai-platform-frontend',
      script: '/var/www/ai-platform/frontend/start-production.cjs',
      cwd: '/var/www/ai-platform/frontend',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      log_file: '/var/www/ai-platform/logs/frontend/combined.log',
      out_file: '/var/www/ai-platform/logs/frontend/out.log',
      error_file: '/var/www/ai-platform/logs/frontend/error.log',
      log_type: 'json',
      merge_logs: true,
      time: true,
      max_memory_restart: '500M',
      restart_delay: 3000,
      max_restarts: 10,
      kill_timeout: 5000,
      listen_timeout: 10000,
      autorestart: true,
      watch: false
    }
  ]
};

/**
 * 应用配置文件 - MySQL2优化版
 */

const path = require('path');

module.exports = {
  // 应用配置
  app: {
    port: 4000,
    domain: 'ai.xingyuncl.com',
    env: process.env.NODE_ENV || 'production'
  },

  // 数据库配置 - MySQL2 v3.14+ 优化
  database: {
    host: 'localhost',
    port: 3306,
    user: 'ai_user',
    password: 'AiPlatform@2025!',
    database: 'ai_platform',
    charset: 'utf8mb4',
    connectionLimit: 10,
    // 连接池性能优化配置
    idleTimeout: 30000,      // 空闲超时30秒
    maxIdle: 5,              // 最大空闲连接5个
    enableKeepAlive: true,   // 启用TCP保活
    queueLimit: 0            // 无限制排队
  },

  // Redis配置 (可选)
  redis: {
    host: 'localhost',
    port: 6379,
    db: 0
  },

  // JWT认证配置 - 延长Token有效期，适合AI对话长时间使用
  auth: {
    jwt: {
      accessSecret: 'your-super-secret-key-2025',
      refreshSecret: 'your-refresh-secret-key-2025',
      accessExpiresIn: '12h',   // 12小时，适合长时间AI对话
      refreshExpiresIn: '14d'   // 14天，减少用户重新登录频率
    }
  },

  // 安全配置
  security: {
    cors: {
      origin: [
        'https://ai.xingyuncl.com',
        'http://localhost:3000',
        'http://localhost:5173'
      ],
      credentials: true
    },
    rateLimit: {
      windowMs: 15 * 60 * 1000, // 15分钟
      max: 1000 // 限制每个IP最多1000个请求
    },
    helmet: {
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false
    }
  },

  // AI服务配置
  ai: {
    defaultModel: 'gpt-3.5-turbo',
    timeout: 30000,
    retries: 3
  },

  // 文件上传配置
  upload: {
    maxFileSize: 10 * 1024 * 1024, // 10MB
    allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'],
    uploadDir: path.resolve(__dirname, '../../storage/uploads')
  },

  // 日志配置
  logging: {
    level: 'info',
    dirname: path.resolve(__dirname, '../../logs'),
    filename: 'app-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxFiles: '14d',
    maxSize: '20m'
  }
};

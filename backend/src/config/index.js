/**
 * 应用配置文件 - 支持环境变量配置
 */

const path = require('path');
const fs = require('fs');

// 智能检测运行环境并返回正确的上传目录
function getUploadDir() {
  // 如果环境变量已设置，优先使用
  if (process.env.UPLOAD_DIR) {
    return process.env.UPLOAD_DIR;
  }
  
  // 检测是否在Docker容器中（通过检查/.dockerenv文件）
  const isDocker = fs.existsSync('/.dockerenv');
  
  if (isDocker) {
    // Docker环境：使用/app路径
    return '/app/storage/uploads';
  } else {
    // 本地开发环境：尝试找到项目根目录
    let currentDir = __dirname;
    let projectRoot = null;
    
    // 向上查找，直到找到package.json或达到根目录
    while (currentDir !== '/') {
      if (fs.existsSync(path.join(currentDir, 'package.json'))) {
        // 找到了backend的package.json，再向上一级到项目根目录
        const parentDir = path.dirname(currentDir);
        if (fs.existsSync(path.join(parentDir, 'frontend'))) {
          projectRoot = parentDir;
          break;
        }
      }
      currentDir = path.dirname(currentDir);
    }
    
    // 如果找到项目根目录，使用相对路径
    if (projectRoot) {
      return path.join(projectRoot, 'storage/uploads');
    }
    
    // 最后的备选：使用绝对路径（适用于特定的生产环境）
    return '/var/www/ai-platform/storage/uploads';
  }
}

module.exports = {
  // 应用配置
  app: {
    name: process.env.APP_NAME || 'AI Platform',
    version: '1.0.0',
    port: parseInt(process.env.PORT || process.env.BACKEND_PORT || '4000'),
    domain: process.env.APP_DOMAIN || 'ai.xingyuncl.com',
    env: process.env.NODE_ENV || 'production'
  },

  // 数据库配置 - MySQL2 v3.14+ 优化
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'ai_user',
    password: process.env.DB_PASSWORD || 'AiPlatform@2025!',
    database: process.env.DB_NAME || 'ai_platform',
    charset: 'utf8mb4',
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10'),
    // 连接池性能优化配置
    idleTimeout: 30000,      // 空闲超时30秒
    maxIdle: 5,              // 最大空闲连接5个
    enableKeepAlive: true,   // 启用TCP保活
    queueLimit: 0,           // 无限制排队
    
    // Redis配置
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD || '',
      db: parseInt(process.env.REDIS_DB || '0'),
      keyPrefix: process.env.REDIS_KEY_PREFIX || 'ai_platform:',
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100
    }
  },

  // JWT认证配置 - 修复：确保使用正确的默认值
  auth: {
    jwt: {
      accessSecret: process.env.JWT_ACCESS_SECRET || 'your-super-secret-key-2025',
      refreshSecret: process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key-2025',
      accessExpiresIn: process.env.JWT_ACCESS_EXPIRES || '24h',  // 修复：默认值改为24h
      refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES || '30d', // 修复：默认值改为30d
      issuer: 'ai-platform',
      audience: 'ai-platform-users'
    }
  },

  // 安全配置
  security: {
    cors: {
      origin: process.env.CORS_ORIGINS ? 
        process.env.CORS_ORIGINS.split(',').map(origin => origin.trim()) : 
        [
          'https://ai.xingyuncl.com',
          'http://localhost:3000',
          'http://localhost:5173'
        ],
      credentials: true
    },
    rateLimit: {
      windowMs: 15 * 60 * 1000, // 15分钟
      max: parseInt(process.env.RATE_LIMIT_MAX || '1000')
    },
    helmet: {
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false
    }
  },

  // AI服务配置
  ai: {
    defaultModel: process.env.DEFAULT_AI_MODEL || 'gpt-3.5-turbo',
    timeout: parseInt(process.env.AI_TIMEOUT || '30000'),
    retries: parseInt(process.env.AI_RETRIES || '3')
  },

  // 文件上传配置
  upload: {
    maxFileSize: parseInt(process.env.UPLOAD_MAX_SIZE || '10485760'), // 10MB
    allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'],
    // 智能检测环境并设置上传目录
    uploadDir: getUploadDir()
  },

  // 日志配置
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    dirname: process.env.LOG_DIR || path.resolve(__dirname, '../../logs'),
    filename: 'app-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxFiles: '14d',
    maxSize: '20m'
  }
};

// 在启动时输出配置信息（用于调试）
if (process.env.NODE_ENV !== 'production' || process.env.DEBUG_CONFIG === 'true') {
  console.log('=== AI Platform Configuration ===');
  console.log('Environment:', process.env.NODE_ENV || 'production');
  console.log('Upload Directory:', module.exports.upload.uploadDir);
  console.log('Is Docker:', fs.existsSync('/.dockerenv') ? 'Yes' : 'No');
  console.log('JWT Access Expires:', module.exports.auth.jwt.accessExpiresIn);
  console.log('JWT Refresh Expires:', module.exports.auth.jwt.refreshExpiresIn);
  console.log('================================');
}

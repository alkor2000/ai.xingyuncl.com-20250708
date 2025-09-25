/**
 * 应用配置文件 - 完全支持环境变量和Docker部署
 */

const path = require('path');
const fs = require('fs');

/**
 * 获取存储根目录
 * 支持环境变量配置，完全兼容Docker和本地部署
 */
function getStorageRoot() {
  // 1. 优先使用环境变量
  if (process.env.STORAGE_PATH) {
    return process.env.STORAGE_PATH;
  }
  
  // 2. 检测Docker环境
  const isDocker = fs.existsSync('/.dockerenv') || process.env.DOCKER_ENV === 'true';
  
  if (isDocker) {
    // Docker环境：使用容器内路径
    return '/app/storage';
  }
  
  // 3. 智能检测项目根目录
  let currentDir = __dirname;
  let projectRoot = null;
  
  // 向上查找项目根目录
  while (currentDir !== '/' && currentDir !== path.parse(currentDir).root) {
    // 检查是否在backend目录
    if (path.basename(currentDir) === 'backend' && 
        fs.existsSync(path.join(path.dirname(currentDir), 'frontend'))) {
      projectRoot = path.dirname(currentDir);
      break;
    }
    // 或者检查是否已经是项目根目录
    if (fs.existsSync(path.join(currentDir, 'backend')) && 
        fs.existsSync(path.join(currentDir, 'frontend'))) {
      projectRoot = currentDir;
      break;
    }
    currentDir = path.dirname(currentDir);
  }
  
  // 4. 使用找到的项目根目录
  if (projectRoot) {
    return path.join(projectRoot, 'storage');
  }
  
  // 5. 最后的备选：使用进程工作目录
  return path.join(process.cwd(), 'storage');
}

/**
 * 获取具体的存储子目录
 */
function getStoragePath(subdir = '') {
  const root = getStorageRoot();
  return subdir ? path.join(root, subdir) : root;
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

  // 数据库配置
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'ai_user',
    password: process.env.DB_PASSWORD || 'AiPlatform@2025!',
    database: process.env.DB_NAME || 'ai_platform',
    charset: 'utf8mb4',
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10'),
    // 连接池优化配置
    idleTimeout: 30000,
    maxIdle: 5,
    enableKeepAlive: true,
    queueLimit: 0,
    
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

  // JWT认证配置
  auth: {
    jwt: {
      accessSecret: process.env.JWT_ACCESS_SECRET || 'MwKSiF/tjdvjyNUALHyW44ekzdYWYS/rsCCqwK1dyHTdaj5rjMG6yzTUwz1yfQWd+rZRRPeBVGH8tm1o5qG4BA==',
      refreshSecret: process.env.JWT_REFRESH_SECRET || 'VGQCIaN5MRe2n7wmiYCoIqjq0Bd33B3OZ8iR7j+ITD1tKR1TJicWQLColOAXpvPfO8r8PJCZbaEgQl1qa2nijQ==',
      accessExpiresIn: process.env.JWT_ACCESS_EXPIRES || '24h',
      refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES || '30d',
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
      windowMs: 15 * 60 * 1000,
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

  // 存储配置 - 统一管理所有存储路径
  storage: {
    // 根目录
    root: getStorageRoot(),
    // 各种子目录
    paths: {
      uploads: getStoragePath('uploads'),
      temp: getStoragePath('temp'),
      cache: getStoragePath('cache'),
      system: getStoragePath('uploads/system'),
      avatars: getStoragePath('uploads/avatars'),
      documents: getStoragePath('uploads/documents'),
      images: getStoragePath('uploads/images'),
      audio: getStoragePath('uploads/audio'),
      video: getStoragePath('uploads/video'),
      generations: getStoragePath('uploads/generations'),
      chatImages: getStoragePath('uploads/chat-images'),
      licenses: getStoragePath('uploads/licenses')
    }
  },

  // 文件上传配置
  upload: {
    maxFileSize: parseInt(process.env.UPLOAD_MAX_SIZE || '10485760'),
    allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'],
    // 向后兼容旧配置
    uploadDir: getStoragePath('uploads')
  },

  // 日志配置
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    dirname: process.env.LOG_DIR || path.resolve(getStorageRoot(), '../logs'),
    filename: 'app-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxFiles: '14d',
    maxSize: '20m'
  }
};

// 调试输出（仅在开发环境或明确要求时）
if (process.env.NODE_ENV !== 'production' || process.env.DEBUG_CONFIG === 'true') {
  console.log('=== AI Platform Storage Configuration ===');
  console.log('Environment:', process.env.NODE_ENV || 'production');
  console.log('Storage Root:', module.exports.storage.root);
  console.log('Temp Directory:', module.exports.storage.paths.temp);
  console.log('Upload Directory:', module.exports.storage.paths.uploads);
  console.log('Is Docker:', fs.existsSync('/.dockerenv') ? 'Yes' : 'No');
  console.log('========================================');
}

// 导出辅助函数供其他模块使用
module.exports.getStoragePath = getStoragePath;
module.exports.getStorageRoot = getStorageRoot;

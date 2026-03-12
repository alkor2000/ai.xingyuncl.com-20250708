/**
 * 应用配置文件 - 完全支持环境变量和Docker部署
 * 
 * 职责：
 * 1. 集中管理所有配置项，统一从环境变量读取
 * 2. 智能检测运行环境（Docker / PM2 / 本地开发）
 * 3. 统一管理存储路径（支持 Docker 卷映射和本地目录）
 * 
 * 安全原则：
 * - 敏感配置（JWT密钥、数据库密码）必须通过环境变量提供
 * - 缺少必要配置时打印警告，不在源码中硬编码生产密钥
 */

const path = require('path');
const fs = require('fs');

/**
 * 验证必要的环境变量是否已配置
 * 在生产环境中，缺少关键配置会打印警告
 */
function validateRequiredConfig() {
  const warnings = [];

  // JWT密钥检查 - 生产环境必须配置
  if (!process.env.JWT_ACCESS_SECRET || process.env.JWT_ACCESS_SECRET.length < 32) {
    warnings.push('JWT_ACCESS_SECRET 未配置或强度不足（需要至少32字符）');
  }
  if (!process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET.length < 32) {
    warnings.push('JWT_REFRESH_SECRET 未配置或强度不足（需要至少32字符）');
  }

  // 数据库密码检查
  if (!process.env.DB_PASSWORD) {
    warnings.push('DB_PASSWORD 未配置，使用默认值（仅限开发环境）');
  }

  // 在生产环境中打印严重警告
  if (warnings.length > 0 && process.env.NODE_ENV === 'production') {
    console.error('╔══════════════════════════════════════════════════════╗');
    console.error('║          ⚠️  关键安全配置警告 ⚠️                     ║');
    console.error('╠══════════════════════════════════════════════════════╣');
    warnings.forEach(w => {
      console.error(`║  - ${w}`);
    });
    console.error('╠══════════════════════════════════════════════════════╣');
    console.error('║  请在 .env 文件中正确配置以上环境变量               ║');
    console.error('╚══════════════════════════════════════════════════════╝');
  }
}

/**
 * 获取存储根目录
 * 支持环境变量配置，完全兼容Docker和本地部署
 * 
 * 检测优先级：
 * 1. STORAGE_PATH 环境变量（显式指定）
 * 2. Docker 环境检测（/.dockerenv 文件 或 DOCKER_ENV 变量）
 * 3. 智能检测项目根目录（向上查找 backend/frontend 目录结构）
 * 4. 使用进程工作目录（最后兜底）
 */
function getStorageRoot() {
  // 1. 优先使用环境变量
  if (process.env.STORAGE_PATH) {
    return process.env.STORAGE_PATH;
  }

  // 2. 检测Docker环境
  const isDocker = fs.existsSync('/.dockerenv') || process.env.DOCKER_ENV === 'true';

  if (isDocker) {
    return '/app/storage';
  }

  // 3. 智能检测项目根目录
  let currentDir = __dirname;
  let projectRoot = null;

  while (currentDir !== '/' && currentDir !== path.parse(currentDir).root) {
    // 检查是否在backend目录
    if (path.basename(currentDir) === 'backend' &&
        fs.existsSync(path.join(path.dirname(currentDir), 'frontend'))) {
      projectRoot = path.dirname(currentDir);
      break;
    }
    // 检查是否已经是项目根目录
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

  // 5. 兜底：使用进程工作目录
  return path.join(process.cwd(), 'storage');
}

/**
 * 获取具体的存储子目录
 * @param {string} subdir - 子目录名
 * @returns {string} 完整路径
 */
function getStoragePath(subdir = '') {
  const root = getStorageRoot();
  return subdir ? path.join(root, subdir) : root;
}

// 执行配置验证
validateRequiredConfig();

/**
 * 获取安全的默认值
 * 生产环境不提供JWT默认密钥（强制配置环境变量）
 * 开发环境提供默认值方便本地调试
 */
function getJwtDefault(envKey, devDefault) {
  if (process.env[envKey]) {
    return process.env[envKey];
  }
  // 非生产环境提供开发默认值
  if (process.env.NODE_ENV !== 'production') {
    return devDefault;
  }
  // 生产环境：返回空字符串，启动时会在 server.js 中检测到并警告
  // 不在这里硬编码生产密钥，防止密钥泄露到源码仓库
  return '';
}

module.exports = {
  // 应用配置
  app: {
    name: process.env.APP_NAME || 'AI Platform',
    version: '1.0.0',
    port: parseInt(process.env.PORT || process.env.BACKEND_PORT || '4000'),
    domain: process.env.APP_DOMAIN || 'ai.xingyuncl.com',
    env: process.env.NODE_ENV || 'production',
    // CORS 配置（供 app.js 使用）
    corsOrigin: process.env.CORS_ORIGINS ?
      process.env.CORS_ORIGINS.split(',').map(origin => origin.trim()) :
      [
        'https://ai.xingyuncl.com',
        'http://localhost:3000',
        'http://localhost:5173'
      ]
  },

  // 数据库配置
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'ai_user',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'ai_platform',
    charset: 'utf8mb4',
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10'),

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
      accessSecret: getJwtDefault('JWT_ACCESS_SECRET', 'dev-only-access-secret-not-for-production'),
      refreshSecret: getJwtDefault('JWT_REFRESH_SECRET', 'dev-only-refresh-secret-not-for-production'),
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
    root: getStorageRoot(),
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

/**
 * AI Platform 配置管理
 * 统一管理所有环境变量和系统配置
 */

require('dotenv').config({ path: '/var/www/ai-platform/config/environments/.env.production' });

const config = {
  // 应用基础配置
  app: {
    name: 'AI Platform',
    version: '1.0.0',
    env: process.env.NODE_ENV || 'production',
    port: process.env.PORT || 4000,
    domain: process.env.DOMAIN || 'ai.xingyuncl.com'
  },

  // 数据库配置
  database: {
    mysql: {
      host: 'localhost',
      port: 3306,
      user: 'ai_user',
      password: 'AiPlatform@2025!',
      database: 'ai_platform',
      charset: 'utf8mb4',
      connectionLimit: 20
    },
    redis: {
      host: 'localhost',
      port: 6379,
      password: null,
      db: 0,
      keyPrefix: 'ai-platform:',
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3
    }
  },

  // 认证配置
  auth: {
    jwt: {
      accessSecret: 'ai-platform-jwt-access-secret-change-in-production-2025',
      refreshSecret: 'ai-platform-jwt-refresh-secret-change-in-production-2025',
      accessExpiresIn: '15m',
      refreshExpiresIn: '7d',
      issuer: 'ai-platform',
      audience: 'ai-platform-users'
    },
    bcrypt: {
      saltRounds: 12
    }
  },

  // 文件上传配置
  upload: {
    path: '/var/www/ai-platform/storage/uploads',
    tempPath: '/var/www/ai-platform/storage/temp',
    maxFileSize: 10 * 1024 * 1024, // 10MB
    allowedTypes: ['jpg', 'jpeg', 'png', 'gif', 'pdf', 'doc', 'docx', 'txt', 'md', 'csv'],
    allowedMimeTypes: [
      'image/jpeg', 'image/png', 'image/gif',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain', 'text/markdown', 'text/csv'
    ]
  },

  // AI服务配置
  ai: {
    openai: {
      apiKey: process.env.OPENAI_API_KEY || '',
      orgId: process.env.OPENAI_ORG_ID || '',
      baseURL: 'https://api.openai.com/v1',
      timeout: 60000
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      baseURL: 'https://api.anthropic.com/v1',
      timeout: 60000
    },
    oneapi: {
      apiKey: process.env.ONEAPI_API_KEY || '',
      baseURL: process.env.ONEAPI_BASE_URL || '',
      timeout: 60000
    },
    default: {
      maxTokens: 4096,
      temperature: 0.7,
      topP: 1,
      presencePenalty: 0,
      frequencyPenalty: 0
    }
  },

  // 安全配置
  security: {
    cors: {
      origin: 'https://ai.xingyuncl.com',
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
    },
    rateLimit: {
      windowMs: 15 * 60 * 1000, // 15分钟
      max: 100, // 限制每个IP 15分钟内最多100次请求
      message: '请求过于频繁，请稍后再试'
    },
    helmet: {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "wss:", "https:"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"]
        }
      },
      crossOriginEmbedderPolicy: false
    }
  },

  // 日志配置
  logging: {
    level: 'info',
    dir: '/var/www/ai-platform/logs/backend',
    file: {
      error: 'error.log',
      combined: 'combined.log',
      access: 'access.log'
    },
    maxSize: '20m',
    maxFiles: '14d',
    format: 'json'
  },

  // 缓存配置
  cache: {
    ttl: 3600, // 1小时
    checkPeriod: 600, // 10分钟检查一次过期keys
    keys: {
      user: 'user:',
      conversation: 'conversation:',
      aiModel: 'ai_model:',
      session: 'session:'
    }
  },

  // WebSocket配置
  websocket: {
    cors: {
      origin: 'https://ai.xingyuncl.com',
      credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
  }
};

module.exports = config;

/**
 * 应用程序配置文件
 */

module.exports = {
  // 应用基本配置
  app: {
    name: 'AI Platform',
    version: '1.0.0',
    env: 'production',
    port: 4000,
    domain: 'ai.xingyuncl.com'
  },

  // 数据库配置
  database: {
    host: 'localhost',
    port: 3306,
    user: 'ai_user',
    password: 'AiPlatform@2025!',
    database: 'ai_platform',
    connectionLimit: 10,
    charset: 'utf8mb4'
  },

  // Redis配置
  redis: {
    host: 'localhost',
    port: 6379,
    password: null,
    db: 0
  },

  // JWT认证配置
  auth: {
    jwt: {
      accessSecret: 'your-super-secret-key-2025',
      refreshSecret: 'your-refresh-secret-key-2025',
      accessExpiresIn: '15m',
      refreshExpiresIn: '7d'
    }
  },

  // 安全配置
  security: {
    cors: {
      origin: ['https://ai.xingyuncl.com', 'http://localhost:3000'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
    },
    helmet: {
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false
    }
  }
};

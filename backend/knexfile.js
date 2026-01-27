/**
 * Knex 数据库迁移配置文件
 * 
 * 用途：管理数据库结构变更（建表、加字段等）
 * 注意：此配置仅用于迁移，不影响现有业务代码
 */

require('dotenv').config();

module.exports = {
  // 开发环境（PM2 运行时使用）
  development: {
    client: 'mysql2',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER || 'ai_user',
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME || 'ai_platform',
      charset: 'utf8mb4'
    },
    migrations: {
      directory: './migrations',
      tableName: 'knex_migrations'
    },
    seeds: {
      directory: './seeds'
    }
  },

  // 生产环境（Docker 运行时使用）
  production: {
    client: 'mysql2',
    connection: {
      host: process.env.DB_HOST || 'mysql',
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER || 'ai_user',
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME || 'ai_platform',
      charset: 'utf8mb4'
    },
    migrations: {
      directory: './migrations',
      tableName: 'knex_migrations'
    },
    seeds: {
      directory: './seeds'
    }
  }
};

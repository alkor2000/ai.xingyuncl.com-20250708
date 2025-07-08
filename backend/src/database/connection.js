/**
 * MySQL数据库连接池管理
 */

const mysql = require('mysql2/promise');
const config = require('../config');
const logger = require('../utils/logger');

class DatabaseConnection {
  constructor() {
    this.pool = null;
    this.isConnected = false;
  }

  /**
   * 初始化数据库连接池
   */
  async initialize() {
    try {
      logger.info('开始初始化数据库连接池...');
      
      const dbConfig = config.database;
      
      if (!dbConfig || !dbConfig.host) {
        throw new Error('数据库配置缺失');
      }
      
      this.pool = mysql.createPool({
        host: dbConfig.host,
        port: dbConfig.port,
        user: dbConfig.user,
        password: dbConfig.password,
        database: dbConfig.database,
        waitForConnections: true,
        connectionLimit: dbConfig.connectionLimit || 10,
        queueLimit: 0,
        charset: dbConfig.charset || 'utf8mb4',
        timezone: '+08:00'
      });

      // 测试连接
      const connection = await this.pool.getConnection();
      await connection.ping();
      connection.release();
      
      this.isConnected = true;
      logger.info('数据库连接池初始化成功');
      
    } catch (error) {
      this.isConnected = false;
      logger.error('数据库连接池初始化失败:', error.message);
      throw error;
    }
  }

  /**
   * 执行查询 - 使用execute预编译查询
   */
  async query(sql, params = []) {
    try {
      if (!this.pool) {
        throw new Error('数据库连接池未初始化');
      }
      
      const [rows, fields] = await this.pool.execute(sql, params);
      return { rows, fields };
    } catch (error) {
      logger.error('数据库查询失败:', {
        sql: sql.substring(0, 100),
        error: error.message
      });
      throw error;
    }
  }

  /**
   * 执行简单查询 - 使用非预编译查询解决LIMIT/OFFSET问题
   */
  async simpleQuery(sql, params = []) {
    try {
      if (!this.pool) {
        throw new Error('数据库连接池未初始化');
      }
      
      // 对于有LIMIT/OFFSET的查询，使用字符串替换而非参数绑定
      let finalSql = sql;
      if (params.length > 0) {
        params.forEach((param, index) => {
          const placeholder = '?';
          const value = mysql.escape(param);
          finalSql = finalSql.replace(placeholder, value);
        });
      }
      
      const [rows, fields] = await this.pool.query(finalSql);
      return { rows, fields };
    } catch (error) {
      logger.error('简单查询失败:', {
        sql: sql.substring(0, 100),
        error: error.message
      });
      throw error;
    }
  }

  /**
   * 获取连接状态
   */
  getStatus() {
    return {
      connected: this.isConnected,
      poolConnections: this.pool ? this.pool._poolConnections : 0,
      promiseConnections: this.pool ? this.pool._promiseConnections : 0
    };
  }

  /**
   * 关闭连接池
   */
  async close() {
    try {
      if (this.pool) {
        await this.pool.end();
        this.isConnected = false;
        logger.info('数据库连接池已关闭');
      }
    } catch (error) {
      logger.error('关闭数据库连接池失败:', error.message);
    }
  }
}

// 创建单例实例
const dbConnection = new DatabaseConnection();

module.exports = dbConnection;

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
      this.pool = mysql.createPool({
        host: config.database.mysql.host,
        port: config.database.mysql.port,
        user: config.database.mysql.user,
        password: config.database.mysql.password,
        database: config.database.mysql.database,
        charset: config.database.mysql.charset,
        connectionLimit: config.database.mysql.connectionLimit,
        queueLimit: 0,
        acquireTimeout: 60000,
        timeout: 60000,
        reconnect: true,
        idleTimeout: 900000
      });

      // 测试连接
      await this.testConnection();
      this.isConnected = true;
      
      logger.info('数据库连接池初始化成功', {
        host: config.database.mysql.host,
        database: config.database.mysql.database,
        connectionLimit: config.database.mysql.connectionLimit
      });

      // 监听连接池事件
      this.pool.on('connection', (connection) => {
        logger.debug(`新的数据库连接建立: ${connection.threadId}`);
      });

      this.pool.on('error', (err) => {
        logger.error('数据库连接池错误:', err);
        this.isConnected = false;
      });

    } catch (error) {
      logger.error('数据库连接池初始化失败:', error);
      throw error;
    }
  }

  /**
   * 测试数据库连接
   */
  async testConnection() {
    try {
      const connection = await this.pool.getConnection();
      await connection.ping();
      connection.release();
      logger.info('数据库连接测试成功');
    } catch (error) {
      logger.error('数据库连接测试失败:', error);
      throw error;
    }
  }

  /**
   * 获取连接池
   */
  getPool() {
    if (!this.pool) {
      throw new Error('数据库连接池未初始化');
    }
    return this.pool;
  }

  /**
   * 执行查询
   */
  async query(sql, params = []) {
    try {
      const [rows, fields] = await this.pool.execute(sql, params);
      return { rows, fields };
    } catch (error) {
      logger.error('数据库查询失败:', { sql: sql.substring(0, 100), error: error.message });
      throw error;
    }
  }

  /**
   * 执行事务
   */
  async transaction(callback) {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();
      const result = await callback(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      logger.error('事务执行失败:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * 获取连接状态
   */
  getStatus() {
    if (!this.pool) {
      return { connected: false, pool: null };
    }

    return {
      connected: this.isConnected,
      pool: {
        allConnections: this.pool.pool?.allConnections?.length || 0,
        freeConnections: this.pool.pool?.freeConnections?.length || 0,
        connectionQueue: this.pool.pool?.connectionQueue?.length || 0
      }
    };
  }

  /**
   * 关闭连接池
   */
  async close() {
    if (this.pool) {
      await this.pool.end();
      this.isConnected = false;
      logger.info('数据库连接池已关闭');
    }
  }
}

// 创建单例实例
const dbConnection = new DatabaseConnection();

module.exports = dbConnection;

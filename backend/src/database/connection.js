/**
 * MySQL数据库连接池管理 - MySQL2优化版（保守修复）
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
      logger.info('开始初始化数据库连接池 (MySQL2优化版)...');
      
      const dbConfig = config.database;
      
      if (!dbConfig || !dbConfig.host) {
        throw new Error('数据库配置缺失');
      }
      
      // MySQL2优化配置 - 只保留官方支持的参数
      this.pool = mysql.createPool({
        host: dbConfig.host,
        port: dbConfig.port || 3306,
        user: dbConfig.user,
        password: dbConfig.password,
        database: dbConfig.database,
        waitForConnections: true,
        connectionLimit: dbConfig.connectionLimit || 10,
        queueLimit: 0,
        charset: dbConfig.charset || 'utf8mb4',
        timezone: '+08:00'
        // 移除所有可能引起警告的参数
      });

      // 测试连接
      const connection = await this.pool.getConnection();
      await connection.ping();
      connection.release();
      
      this.isConnected = true;
      logger.info('数据库连接池初始化成功 (MySQL2优化版 - 无警告)');
      
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
   * 开启事务 - 积分操作核心方法
   */
  async beginTransaction() {
    try {
      if (!this.pool) {
        throw new Error('数据库连接池未初始化');
      }
      
      const connection = await this.pool.getConnection();
      await connection.beginTransaction();
      
      return {
        connection,
        query: async (sql, params = []) => {
          const [rows, fields] = await connection.execute(sql, params);
          return { rows, fields };
        },
        commit: async () => {
          await connection.commit();
          connection.release();
        },
        rollback: async () => {
          await connection.rollback();
          connection.release();
        },
        release: () => {
          connection.release();
        }
      };
    } catch (error) {
      logger.error('开启事务失败:', error.message);
      throw error;
    }
  }

  /**
   * 执行事务操作 - 自动管理事务生命周期
   */
  async transaction(callback) {
    let connection = null;
    try {
      if (!this.pool) {
        throw new Error('数据库连接池未初始化');
      }
      
      connection = await this.pool.getConnection();
      await connection.beginTransaction();
      
      const transactionQuery = async (sql, params = []) => {
        const [rows, fields] = await connection.execute(sql, params);
        return { rows, fields };
      };
      
      // 执行回调函数
      const result = await callback(transactionQuery);
      
      await connection.commit();
      connection.release();
      
      return result;
    } catch (error) {
      if (connection) {
        try {
          await connection.rollback();
          connection.release();
        } catch (rollbackError) {
          logger.error('事务回滚失败:', rollbackError.message);
        }
      }
      
      logger.error('事务执行失败:', error.message);
      throw error;
    }
  }

  /**
   * 获取连接状态
   */
  getStatus() {
    return {
      connected: this.isConnected,
      poolConnections: this.pool ? this.pool._activeConnections?.size || 0 : 0,
      freeConnections: this.pool ? this.pool._freeConnections?.length || 0 : 0
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

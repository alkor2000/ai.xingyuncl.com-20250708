/**
 * MySQL数据库连接池管理 - MySQL2优化版
 * 
 * 职责：
 * 1. 管理MySQL连接池（单例模式）
 * 2. 提供预编译查询（query）和普通查询（simpleQuery）
 * 3. 提供事务管理（手动beginTransaction和自动transaction）
 * 
 * 查询方法说明：
 * - query()       : 使用 pool.execute 预编译查询，适用于大多数场景
 * - simpleQuery()  : 使用 pool.query 普通参数化查询，适用于 LIMIT/OFFSET 等动态SQL
 *   注意：两者都支持 ? 占位符参数绑定，都能防止SQL注入
 *   区别：execute 会缓存预编译语句，但不支持某些动态参数；query 不缓存但更灵活
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

      // MySQL2连接池配置 - 只使用官方支持的参数，避免警告
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
   * 执行查询 - 使用 pool.execute 预编译查询
   * 
   * 适用于大多数标准CRUD操作，MySQL会缓存预编译语句提升性能
   * 注意：不支持 LIMIT/OFFSET 的参数绑定，这类查询请使用 simpleQuery
   * 
   * @param {string} sql - SQL语句，使用 ? 占位符
   * @param {Array} params - 参数数组
   * @returns {Object} { rows, fields }
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
        sql: sql.substring(0, 200),
        error: error.message
      });
      throw error;
    }
  }

  /**
   * 执行简单查询 - 使用 pool.query 普通参数化查询
   * 
   * 适用于包含 LIMIT/OFFSET 等动态参数的查询
   * pool.query 同样支持 ? 占位符参数绑定，能防止SQL注入
   * 与 execute 的区别：不缓存预编译语句，但支持更多动态参数类型
   * 
   * @param {string} sql - SQL语句，使用 ? 占位符
   * @param {Array} params - 参数数组
   * @returns {Object} { rows, fields }
   */
  async simpleQuery(sql, params = []) {
    try {
      if (!this.pool) {
        throw new Error('数据库连接池未初始化');
      }

      // 使用 pool.query 进行参数化查询（非手动字符串替换）
      // pool.query 内部会正确处理参数转义，安全防止SQL注入
      const [rows, fields] = await this.pool.query(sql, params);
      return { rows, fields };
    } catch (error) {
      logger.error('简单查询失败:', {
        sql: sql.substring(0, 200),
        error: error.message
      });
      throw error;
    }
  }

  /**
   * 开启手动事务
   * 
   * 返回事务对象，调用方需要自行 commit/rollback
   * 推荐使用 transaction() 自动管理版本，除非需要跨方法传递事务
   * 
   * 注意：调用方必须确保在所有代码路径（包括异常路径）中释放连接
   * 
   * @returns {Object} { connection, query, commit, rollback, release }
   */
  async beginTransaction() {
    if (!this.pool) {
      throw new Error('数据库连接池未初始化');
    }

    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();

      return {
        connection,
        /**
         * 在事务中执行查询
         */
        query: async (sql, params = []) => {
          const [rows, fields] = await connection.execute(sql, params);
          return { rows, fields };
        },
        /**
         * 提交事务并释放连接
         */
        commit: async () => {
          await connection.commit();
          connection.release();
        },
        /**
         * 回滚事务并释放连接
         */
        rollback: async () => {
          try {
            await connection.rollback();
          } catch (rollbackErr) {
            logger.error('事务回滚失败:', rollbackErr.message);
          }
          connection.release();
        },
        /**
         * 直接释放连接（不提交也不回滚）
         */
        release: () => {
          connection.release();
        }
      };
    } catch (error) {
      // 如果 beginTransaction 失败，确保释放连接
      connection.release();
      logger.error('开启事务失败:', error.message);
      throw error;
    }
  }

  /**
   * 执行自动管理事务（推荐使用）
   * 
   * 自动处理 commit/rollback/release，无需调用方手动管理
   * 回调函数抛出异常时自动回滚，正常返回时自动提交
   * 
   * @param {Function} callback - 接收 transactionQuery 函数作为参数的回调
   * @returns {*} 回调函数的返回值
   * 
   * @example
   * const result = await dbConnection.transaction(async (query) => {
   *   await query('UPDATE users SET credits = credits - ? WHERE id = ?', [10, userId]);
   *   await query('INSERT INTO credit_transactions ...', [...]);
   *   return { success: true };
   * });
   */
  async transaction(callback) {
    if (!this.pool) {
      throw new Error('数据库连接池未初始化');
    }

    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();

      const transactionQuery = async (sql, params = []) => {
        const [rows, fields] = await connection.execute(sql, params);
        return { rows, fields };
      };

      // 执行业务逻辑
      const result = await callback(transactionQuery);

      await connection.commit();
      connection.release();

      return result;
    } catch (error) {
      // 确保异常时回滚并释放连接
      try {
        await connection.rollback();
      } catch (rollbackError) {
        logger.error('事务回滚失败:', rollbackError.message);
      }
      connection.release();

      logger.error('事务执行失败:', error.message);
      throw error;
    }
  }

  /**
   * 获取连接池状态信息
   * 
   * @returns {Object} { connected, poolConnections, freeConnections }
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
   * 优雅关闭时由 server.js 调用
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

// 单例实例
const dbConnection = new DatabaseConnection();

module.exports = dbConnection;

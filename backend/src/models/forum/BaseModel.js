/**
 * 论坛模块 - 数据模型基类 v2.1
 * 
 * 修复：create/updateById 中 undefined 值自动转为 null，防止 MySQL 驱动报错
 * 
 * 提供通用的 CRUD、分页、软删除、JSON解析等能力
 * 所有论坛模型继承此类，消除重复代码
 * 
 * 设计理念：
 * - 子类只需声明 tableName / columns / jsonColumns 等元信息
 * - 基类自动处理 SQL 构建、参数绑定、JSON 序列化
 * - 使用 dbConnection 原生 API，不引入额外 ORM 依赖
 * 
 * @module models/forum/BaseModel
 */

const dbConnection = require('../../database/connection');
const { DatabaseError, NotFoundError, ValidationError } = require('../../utils/errors');
const logger = require('../../utils/logger');

class BaseModel {
  /* ================================================================
   * 子类必须覆盖的静态属性
   * ================================================================ */

  /** @returns {string} 数据库表名 */
  static get tableName() {
    throw new Error('子类必须定义 tableName');
  }

  /** @returns {string} 主键字段名，默认 'id' */
  static get primaryKey() {
    return 'id';
  }

  /** @returns {boolean} 是否支持软删除（deleted_at 字段） */
  static get softDelete() {
    return false;
  }

  /** @returns {string[]} JSON 类型字段列表，查询后自动解析 */
  static get jsonColumns() {
    return [];
  }

  /* ================================================================
   * 核心查询方法
   * ================================================================ */

  /**
   * 根据主键查找单条记录
   * 
   * @param {number|string} id - 主键值
   * @param {Object} options - 可选配置
   * @param {boolean} options.includeSoftDeleted - 是否包含已软删除记录
   * @returns {Object|null} 记录对象或 null
   */
  static async findById(id, options = {}) {
    try {
      const { includeSoftDeleted = false } = options;
      let sql = `SELECT * FROM ${this.tableName} WHERE ${this.primaryKey} = ?`;

      /* 软删除过滤 */
      if (this.softDelete && !includeSoftDeleted) {
        sql += ' AND deleted_at IS NULL';
      }

      sql += ' LIMIT 1';
      const { rows } = await dbConnection.query(sql, [id]);

      if (rows.length === 0) return null;
      return this._parseRow(rows[0]);
    } catch (error) {
      logger.error(`${this.tableName}.findById 失败:`, { id, error: error.message });
      throw new DatabaseError(`查询 ${this.tableName} 失败`, error);
    }
  }

  /**
   * 根据条件查找单条记录
   * 
   * @param {Object} conditions - 查询条件键值对 { field: value }
   * @returns {Object|null} 记录对象或 null
   */
  static async findOne(conditions = {}) {
    try {
      const { whereClause, params } = this._buildWhere(conditions);
      const sql = `SELECT * FROM ${this.tableName} ${whereClause} LIMIT 1`;
      const { rows } = await dbConnection.query(sql, params);

      if (rows.length === 0) return null;
      return this._parseRow(rows[0]);
    } catch (error) {
      logger.error(`${this.tableName}.findOne 失败:`, { conditions, error: error.message });
      throw new DatabaseError(`查询 ${this.tableName} 失败`, error);
    }
  }

  /**
   * 根据条件查找多条记录（不分页）
   * 
   * @param {Object} conditions - 查询条件
   * @param {Object} options - 排序等选项
   * @param {string} options.orderBy - 排序字段和方向，如 'created_at DESC'
   * @param {number} options.limit - 最大返回数量
   * @returns {Object[]} 记录数组
   */
  static async findAll(conditions = {}, options = {}) {
    try {
      const { orderBy = `${this.primaryKey} DESC`, limit = 1000 } = options;
      const { whereClause, params } = this._buildWhere(conditions);

      const sql = `SELECT * FROM ${this.tableName} ${whereClause} ORDER BY ${orderBy} LIMIT ?`;
      const { rows } = await dbConnection.simpleQuery(sql, [...params, limit]);

      return rows.map(row => this._parseRow(row));
    } catch (error) {
      logger.error(`${this.tableName}.findAll 失败:`, { error: error.message });
      throw new DatabaseError(`查询 ${this.tableName} 列表失败`, error);
    }
  }

  /**
   * 分页查询（通用版）
   * 
   * 返回 { items, pagination } 结构，pagination 包含 page/limit/total/totalPages
   * 
   * @param {Object} conditions - WHERE 条件
   * @param {Object} options - 分页与排序选项
   * @param {number} options.page - 当前页码（从1开始）
   * @param {number} options.limit - 每页数量
   * @param {string} options.orderBy - 排序表达式
   * @param {string} options.select - SELECT 字段（默认 *）
   * @param {string} options.joins - JOIN 子句
   * @param {string} options.extraWhere - 额外的 WHERE 条件SQL
   * @param {Array} options.extraParams - 额外 WHERE 条件的参数
   * @returns {Object} { items: Object[], pagination: Object }
   */
  static async paginate(conditions = {}, options = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        orderBy = 'created_at DESC',
        select = `${this.tableName}.*`,
        joins = '',
        extraWhere = '',
        extraParams = []
      } = options;

      /* 安全的页码和条数 */
      const safePage = Math.max(1, parseInt(page) || 1);
      const safeLimit = Math.min(100, Math.max(1, parseInt(limit) || 20));
      const offset = (safePage - 1) * safeLimit;

      /* 构建 WHERE */
      const { whereClause, params } = this._buildWhere(conditions);

      /* 拼接额外条件 */
      let fullWhere = whereClause;
      const fullParams = [...params, ...extraParams];
      if (extraWhere) {
        fullWhere = fullWhere
          ? `${fullWhere} AND ${extraWhere}`
          : `WHERE ${extraWhere}`;
      }

      /* COUNT 查询 */
      const countSql = `SELECT COUNT(*) as total FROM ${this.tableName} ${joins} ${fullWhere}`;
      const { rows: countRows } = await dbConnection.simpleQuery(countSql, fullParams);
      const total = countRows[0].total;

      /* 数据查询 */
      const dataSql = `
        SELECT ${select}
        FROM ${this.tableName} ${joins}
        ${fullWhere}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?
      `;
      const { rows } = await dbConnection.simpleQuery(dataSql, [...fullParams, safeLimit, offset]);

      return {
        items: rows.map(row => this._parseRow(row)),
        pagination: {
          page: safePage,
          limit: safeLimit,
          total,
          totalPages: Math.ceil(total / safeLimit)
        }
      };
    } catch (error) {
      logger.error(`${this.tableName}.paginate 失败:`, { error: error.message });
      throw new DatabaseError(`分页查询 ${this.tableName} 失败`, error);
    }
  }

  /* ================================================================
   * 写入方法
   * ================================================================ */

  /**
   * 插入单条记录
   * 
   * v2.1 修复：自动过滤 undefined 字段，将 undefined 值转为 null
   * 防止 MySQL 驱动报 "Bind parameters must not contain undefined"
   * 
   * @param {Object} data - 要插入的字段键值对
   * @returns {Object} 包含 insertId 的结果
   */
  static async create(data) {
    try {
      /* 自动序列化 JSON 字段 */
      const processedData = this._serializeJson(data);

      /* v2.1 过滤掉值为 undefined 的字段，将其余 undefined 转 null */
      const cleanData = {};
      for (const [key, value] of Object.entries(processedData)) {
        if (value === undefined) {
          /* 跳过 undefined 字段，不插入该列（使用数据库默认值） */
          continue;
        }
        cleanData[key] = value;
      }

      const fields = Object.keys(cleanData);
      if (fields.length === 0) {
        throw new ValidationError('没有有效的字段可插入');
      }

      const placeholders = fields.map(() => '?').join(', ');
      const values = fields.map(f => cleanData[f] === null ? null : cleanData[f]);

      const sql = `INSERT INTO ${this.tableName} (${fields.join(', ')}) VALUES (${placeholders})`;
      const { rows } = await dbConnection.query(sql, values);

      const insertId = rows.insertId;
      logger.info(`${this.tableName} 创建成功`, { id: insertId });

      /* 返回完整的新记录 */
      return await this.findById(insertId, { includeSoftDeleted: true });
    } catch (error) {
      /* 唯一键冲突 */
      if (error.code === 'ER_DUP_ENTRY') {
        throw new ValidationError('记录已存在（唯一键冲突）');
      }
      logger.error(`${this.tableName}.create 失败:`, { error: error.message });
      throw new DatabaseError(`创建 ${this.tableName} 失败`, error);
    }
  }

  /**
   * 根据主键更新记录
   * 
   * v2.1 修复：自动过滤 undefined 字段
   * 
   * @param {number|string} id - 主键值
   * @param {Object} data - 要更新的字段键值对
   * @returns {Object|null} 更新后的完整记录
   */
  static async updateById(id, data) {
    try {
      const processedData = this._serializeJson(data);

      /* v2.1 过滤 undefined 值 */
      const cleanData = {};
      for (const [key, value] of Object.entries(processedData)) {
        if (value !== undefined) {
          cleanData[key] = value === undefined ? null : value;
        }
      }

      const fields = Object.keys(cleanData);
      if (fields.length === 0) return await this.findById(id);

      const setClause = fields.map(f => `${f} = ?`).join(', ');
      const values = [...fields.map(f => cleanData[f] === null ? null : cleanData[f]), id];

      const sql = `UPDATE ${this.tableName} SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE ${this.primaryKey} = ?`;
      await dbConnection.query(sql, values);

      logger.info(`${this.tableName} 更新成功`, { id, fields });
      return await this.findById(id);
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        throw new ValidationError('更新失败（唯一键冲突）');
      }
      logger.error(`${this.tableName}.updateById 失败:`, { id, error: error.message });
      throw new DatabaseError(`更新 ${this.tableName} 失败`, error);
    }
  }

  /**
   * 删除记录（支持软删除）
   * 
   * @param {number|string} id - 主键值
   * @returns {boolean} 是否成功
   */
  static async deleteById(id) {
    try {
      let sql;
      if (this.softDelete) {
        /* 软删除：设置 deleted_at */
        sql = `UPDATE ${this.tableName} SET deleted_at = NOW() WHERE ${this.primaryKey} = ? AND deleted_at IS NULL`;
      } else {
        /* 硬删除 */
        sql = `DELETE FROM ${this.tableName} WHERE ${this.primaryKey} = ?`;
      }

      const { rows } = await dbConnection.query(sql, [id]);
      const success = rows.affectedRows > 0;

      if (success) {
        logger.info(`${this.tableName} 删除成功`, { id, soft: this.softDelete });
      }
      return success;
    } catch (error) {
      logger.error(`${this.tableName}.deleteById 失败:`, { id, error: error.message });
      throw new DatabaseError(`删除 ${this.tableName} 失败`, error);
    }
  }

  /* ================================================================
   * 计数与存在性检查
   * ================================================================ */

  /**
   * 按条件计数
   * 
   * @param {Object} conditions - WHERE 条件
   * @returns {number} 记录数量
   */
  static async count(conditions = {}) {
    try {
      const { whereClause, params } = this._buildWhere(conditions);
      const sql = `SELECT COUNT(*) as total FROM ${this.tableName} ${whereClause}`;
      const { rows } = await dbConnection.query(sql, params);
      return rows[0].total;
    } catch (error) {
      logger.error(`${this.tableName}.count 失败:`, { error: error.message });
      throw new DatabaseError(`计数 ${this.tableName} 失败`, error);
    }
  }

  /**
   * 原子自增/自减字段
   * 
   * @param {number|string} id - 主键值
   * @param {string} field - 字段名
   * @param {number} amount - 增量（负数为自减）
   */
  static async increment(id, field, amount = 1) {
    try {
      /* 白名单校验字段名，防止SQL注入 */
      if (!/^[a-z_]+$/.test(field)) {
        throw new ValidationError('非法字段名');
      }
      const sql = `UPDATE ${this.tableName} SET ${field} = ${field} + ? WHERE ${this.primaryKey} = ?`;
      await dbConnection.query(sql, [amount, id]);
    } catch (error) {
      logger.error(`${this.tableName}.increment 失败:`, { id, field, amount, error: error.message });
      throw new DatabaseError(`更新计数失败`, error);
    }
  }

  /* ================================================================
   * 内部工具方法
   * ================================================================ */

  /**
   * 构建 WHERE 子句
   * 
   * 支持的条件格式：
   * - { field: value }          → field = ?
   * - { field: null }           → field IS NULL
   * - { field: [1, 2, 3] }     → field IN (?, ?, ?)
   * - 自动追加软删除过滤
   * 
   * @param {Object} conditions - 条件键值对
   * @returns {{ whereClause: string, params: Array }}
   * @private
   */
  static _buildWhere(conditions = {}) {
    const clauses = [];
    const params = [];

    /* 软删除默认过滤 */
    if (this.softDelete) {
      clauses.push('deleted_at IS NULL');
    }

    for (const [key, value] of Object.entries(conditions)) {
      if (value === null || value === undefined) {
        clauses.push(`${key} IS NULL`);
      } else if (Array.isArray(value)) {
        if (value.length === 0) {
          /* 空数组 → 永远不匹配 */
          clauses.push('1 = 0');
        } else {
          clauses.push(`${key} IN (${value.map(() => '?').join(', ')})`);
          params.push(...value);
        }
      } else {
        clauses.push(`${key} = ?`);
        params.push(value);
      }
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return { whereClause, params };
  }

  /**
   * 解析单行数据（自动处理 JSON 字段）
   * 
   * @param {Object} row - 数据库原始行
   * @returns {Object} 解析后的对象
   * @private
   */
  static _parseRow(row) {
    if (!row) return null;

    const parsed = { ...row };
    for (const col of this.jsonColumns) {
      if (parsed[col] !== undefined && parsed[col] !== null) {
        if (typeof parsed[col] === 'string') {
          try {
            parsed[col] = JSON.parse(parsed[col]);
          } catch {
            parsed[col] = [];
          }
        }
        /* 如果 MySQL JSON 类型已自动解析为对象，保持原样 */
      } else {
        /* null/undefined 的 JSON 字段默认为空数组或 null */
        parsed[col] = null;
      }
    }
    return parsed;
  }

  /**
   * 序列化 JSON 字段（写入前自动转字符串）
   * 
   * @param {Object} data - 待写入的数据
   * @returns {Object} 序列化后的数据副本
   * @private
   */
  static _serializeJson(data) {
    const result = { ...data };
    for (const col of this.jsonColumns) {
      if (result[col] !== undefined && result[col] !== null && typeof result[col] !== 'string') {
        result[col] = JSON.stringify(result[col]);
      }
    }
    return result;
  }
}

module.exports = BaseModel;

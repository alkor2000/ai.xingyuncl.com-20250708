/**
 * 健康检查服务
 * 提供系统各组件的健康状态检查
 */

const dbConnection = require('../database/connection');
const redisConnection = require('../database/redis');
const logger = require('../utils/logger');
const os = require('os');

class HealthCheckService {
  /**
   * 执行完整的健康检查
   */
  static async performHealthCheck() {
    const checks = {
      system: await this.checkSystem(),
      database: await this.checkDatabase(),
      redis: await this.checkRedis(),
      memory: await this.checkMemory(),
      timestamp: new Date().toISOString()
    };

    const overallStatus = Object.values(checks)
      .filter(check => typeof check === 'object' && check !== null)
      .every(check => check.status === 'healthy') ? 'healthy' : 'unhealthy';

    return {
      status: overallStatus,
      checks,
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0'
    };
  }

  /**
   * 检查系统状态
   */
  static async checkSystem() {
    try {
      return {
        status: 'healthy',
        uptime: process.uptime(),
        loadAverage: os.loadavg(),
        cpuUsage: process.cpuUsage(),
        platform: process.platform,
        nodeVersion: process.version
      };
    } catch (error) {
      logger.error('系统检查失败:', error);
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }

  /**
   * 检查数据库连接
   */
  static async checkDatabase() {
    try {
      const startTime = Date.now();
      await dbConnection.query('SELECT 1');
      const responseTime = Date.now() - startTime;

      return {
        status: 'healthy',
        responseTime: `${responseTime}ms`,
        activeConnections: dbConnection.pool?._allConnections?.length || 0,
        idleConnections: dbConnection.pool?._freeConnections?.length || 0
      };
    } catch (error) {
      logger.error('数据库健康检查失败:', error);
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }

  /**
   * 检查Redis连接
   */
  static async checkRedis() {
    try {
      if (!redisConnection.isConnected) {
        return {
          status: 'unhealthy',
          error: 'Redis未连接'
        };
      }

      const startTime = Date.now();
      await redisConnection.ping();
      const responseTime = Date.now() - startTime;

      const status = redisConnection.getStatus();
      
      return {
        status: 'healthy',
        responseTime: `${responseTime}ms`,
        connected: status.connected,
        clientStatus: status.client
      };
    } catch (error) {
      logger.error('Redis健康检查失败:', error);
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }

  /**
   * 检查内存使用
   */
  static async checkMemory() {
    try {
      const memUsage = process.memoryUsage();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const memPercentage = (usedMem / totalMem * 100).toFixed(2);

      return {
        status: memPercentage < 90 ? 'healthy' : 'unhealthy',
        process: {
          rss: `${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`,
          heapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
          heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
          external: `${(memUsage.external / 1024 / 1024).toFixed(2)} MB`
        },
        system: {
          total: `${(totalMem / 1024 / 1024 / 1024).toFixed(2)} GB`,
          free: `${(freeMem / 1024 / 1024 / 1024).toFixed(2)} GB`,
          used: `${(usedMem / 1024 / 1024 / 1024).toFixed(2)} GB`,
          percentage: `${memPercentage}%`
        }
      };
    } catch (error) {
      logger.error('内存检查失败:', error);
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }

  /**
   * 简单的健康检查（用于负载均衡器）
   */
  static async quickHealthCheck() {
    try {
      // 快速检查关键组件
      await dbConnection.query('SELECT 1');
      
      if (redisConnection.isConnected) {
        await redisConnection.ping();
      }
      
      return { status: 'ok' };
    } catch (error) {
      throw error;
    }
  }
}

module.exports = HealthCheckService;

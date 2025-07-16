/**
 * 动态模块代理中间件
 */

const { createProxyMiddleware } = require('http-proxy-middleware');
const dbConnection = require('../database/connection');
const logger = require('../utils/logger');

class ModuleProxyManager {
  constructor() {
    this.proxies = new Map();
    this.modules = [];
  }

  /**
   * 初始化代理路由
   */
  async initialize(app) {
    try {
      // 从数据库加载活跃的模块
      const { rows } = await dbConnection.query(
        'SELECT * FROM system_modules WHERE is_active = 1 AND api_endpoint IS NOT NULL'
      );
      
      this.modules = rows;
      
      // 为每个模块创建代理
      for (const module of this.modules) {
        this.createProxy(app, module);
      }
      
      logger.info(`初始化了 ${this.modules.length} 个模块代理`);
      
      // 定期刷新代理配置（每5分钟）
      setInterval(() => this.refreshProxies(app), 5 * 60 * 1000);
      
    } catch (error) {
      logger.error('初始化模块代理失败:', error);
    }
  }

  /**
   * 创建单个模块的代理
   */
  createProxy(app, module) {
    try {
      const proxyOptions = {
        target: module.api_endpoint,
        changeOrigin: true,
        pathRewrite: {
          [`^/api${module.proxy_path}`]: ''
        },
        onProxyReq: (proxyReq, req, res) => {
          // 如果模块需要JWT认证，转发认证信息
          if (module.auth_mode === 'jwt' && req.headers.authorization) {
            proxyReq.setHeader('Authorization', req.headers.authorization);
          }
          
          // 添加来源标识
          proxyReq.setHeader('X-Forwarded-From', 'ai-platform');
          proxyReq.setHeader('X-Module-Name', module.name);
          
          logger.info(`代理请求: ${req.method} ${req.path} -> ${module.api_endpoint}`);
        },
        onProxyRes: (proxyRes, req, res) => {
          // 添加响应头标识
          proxyRes.headers['X-Proxied-By'] = 'ai-platform';
          proxyRes.headers['X-Module-Name'] = module.name;
        },
        onError: (err, req, res) => {
          logger.error(`代理错误 [${module.name}]:`, err);
          
          // 更新模块状态为离线
          this.updateModuleStatus(module.id, 'offline');
          
          res.status(502).json({
            success: false,
            code: 502,
            message: `模块 ${module.display_name} 暂时不可用`,
            data: null,
            timestamp: new Date().toISOString()
          });
        }
      };
      
      const proxy = createProxyMiddleware(proxyOptions);
      
      // 注册代理路由
      const proxyPath = `/api${module.proxy_path}`;
      app.use(proxyPath, proxy);
      
      // 保存代理实例
      this.proxies.set(module.id, {
        path: proxyPath,
        proxy: proxy,
        module: module
      });
      
      logger.info(`创建模块代理: ${module.display_name} -> ${proxyPath} -> ${module.api_endpoint}`);
      
    } catch (error) {
      logger.error(`创建模块代理失败 [${module.name}]:`, error);
    }
  }

  /**
   * 刷新代理配置
   */
  async refreshProxies(app) {
    try {
      const { rows } = await dbConnection.query(
        'SELECT * FROM system_modules WHERE api_endpoint IS NOT NULL'
      );
      
      const activeModuleIds = new Set(
        rows.filter(m => m.is_active).map(m => m.id)
      );
      
      // 移除不再活跃的代理
      for (const [moduleId, proxyInfo] of this.proxies) {
        if (!activeModuleIds.has(moduleId)) {
          // 注意：Express不支持动态移除中间件，这里只是标记
          this.proxies.delete(moduleId);
          logger.info(`标记移除模块代理: ${proxyInfo.module.display_name}`);
        }
      }
      
      // 添加新的活跃模块
      for (const module of rows) {
        if (module.is_active && !this.proxies.has(module.id)) {
          this.createProxy(app, module);
        }
      }
      
    } catch (error) {
      logger.error('刷新模块代理失败:', error);
    }
  }

  /**
   * 更新模块状态
   */
  async updateModuleStatus(moduleId, status) {
    try {
      await dbConnection.query(
        'UPDATE system_modules SET status = ?, last_check_at = CURRENT_TIMESTAMP WHERE id = ?',
        [status, moduleId]
      );
    } catch (error) {
      logger.error('更新模块状态失败:', error);
    }
  }

  /**
   * 获取所有代理信息
   */
  getProxyInfo() {
    const info = [];
    for (const [moduleId, proxyInfo] of this.proxies) {
      info.push({
        moduleId,
        moduleName: proxyInfo.module.name,
        displayName: proxyInfo.module.display_name,
        proxyPath: proxyInfo.path,
        targetUrl: proxyInfo.module.api_endpoint,
        isActive: proxyInfo.module.is_active
      });
    }
    return info;
  }
}

// 创建单例实例
const moduleProxyManager = new ModuleProxyManager();

module.exports = moduleProxyManager;

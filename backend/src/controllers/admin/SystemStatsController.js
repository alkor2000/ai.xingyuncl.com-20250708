/**
 * 系统统计控制器 - 支持基于角色的数据过滤、配置持久化和缓存统计
 */

const { StatsService } = require('../../services/admin');
const SystemConfig = require('../../models/SystemConfig');
const EmailService = require('../../services/emailService');
const CacheService = require('../../services/cacheService');
const ResponseHelper = require('../../utils/response');
const logger = require('../../utils/logger');
const { ROLES } = require('../../middleware/permissions');
const File = require('../../models/File');
const { deleteFile } = require('../../middleware/uploadMiddleware');
const path = require('path');
const redisConnection = require('../../database/redis');
const HealthCheckService = require('../../services/healthCheckService');
const config = require('../../config');
const rateLimitService = require('../../services/rateLimitService');

class SystemStatsController {
  /**
   * 获取系统统计 - 根据用户角色过滤数据
   */
  static async getSystemStats(req, res) {
    try {
      const currentUser = req.user;
      const userRole = currentUser.role;
      
      // 组管理员只能看到本组数据
      const filterOptions = {
        groupId: userRole === ROLES.ADMIN ? currentUser.group_id : null,
        limitToGroup: userRole === ROLES.ADMIN
      };
      
      const stats = await StatsService.getSystemStats(currentUser, filterOptions);

      return ResponseHelper.success(res, stats, '获取系统统计成功');
    } catch (error) {
      logger.error('获取系统统计失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '获取系统统计失败');
    }
  }

  /**
   * 获取缓存统计信息 - 只有超级管理员可以查看
   */
  static async getCacheStats(req, res) {
    try {
      const userRole = req.user.role;
      
      // 只有超级管理员可以查看缓存统计
      if (userRole !== ROLES.SUPER_ADMIN) {
        return ResponseHelper.forbidden(res, '只有超级管理员可以查看缓存统计');
      }
      
      // 获取缓存统计信息
      const cacheStats = await CacheService.getCacheStats();
      
      // 获取Redis详细信息
      let redisInfo = null;
      if (redisConnection.isConnected) {
        try {
          const client = redisConnection.getClient();
          const info = await client.info();
          
          // 解析Redis信息
          const lines = info.split('\r\n');
          const infoObj = {};
          
          lines.forEach(line => {
            if (line && !line.startsWith('#')) {
              const [key, value] = line.split(':');
              if (key && value) {
                infoObj[key] = value;
              }
            }
          });
          
          redisInfo = {
            version: infoObj.redis_version,
            uptime: parseInt(infoObj.uptime_in_seconds),
            uptimeHuman: infoObj.uptime_in_days ? `${infoObj.uptime_in_days} days` : 'N/A',
            connectedClients: parseInt(infoObj.connected_clients),
            usedMemory: infoObj.used_memory_human,
            usedMemoryPeak: infoObj.used_memory_peak_human,
            memFragmentationRatio: parseFloat(infoObj.mem_fragmentation_ratio),
            totalSystemMemory: infoObj.total_system_memory_human,
            totalCommandsProcessed: parseInt(infoObj.total_commands_processed),
            instantaneousOpsPerSec: parseInt(infoObj.instantaneous_ops_per_sec),
            keyspaceHits: parseInt(infoObj.keyspace_hits) || 0,
            keyspaceMisses: parseInt(infoObj.keyspace_misses) || 0,
            hitRate: 0
          };
          
          // 计算命中率
          const totalAccess = redisInfo.keyspaceHits + redisInfo.keyspaceMisses;
          if (totalAccess > 0) {
            redisInfo.hitRate = ((redisInfo.keyspaceHits / totalAccess) * 100).toFixed(2) + '%';
          }
          
        } catch (error) {
          logger.warn('获取Redis详细信息失败', { error: error.message });
        }
      }
      
      // 组合响应数据
      const result = {
        cacheStats,
        redisInfo,
        summary: {
          status: cacheStats.connected ? '正常' : '未连接',
          totalKeys: cacheStats.totalKeys || 0,
          memoryUsed: cacheStats.memoryUsed || 'N/A',
          hitRate: redisInfo?.hitRate || 'N/A',
          performance: redisInfo?.instantaneousOpsPerSec ? `${redisInfo.instantaneousOpsPerSec} ops/sec` : 'N/A'
        }
      };

      return ResponseHelper.success(res, result, '获取缓存统计成功');
    } catch (error) {
      logger.error('获取缓存统计失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '获取缓存统计失败');
    }
  }

  /**
   * 清除缓存 - 只有超级管理员可以操作
   */
  static async clearCache(req, res) {
    try {
      const userRole = req.user.role;
      
      // 只有超级管理员可以清除缓存
      if (userRole !== ROLES.SUPER_ADMIN) {
        return ResponseHelper.forbidden(res, '只有超级管理员可以清除缓存');
      }
      
      const { type = 'all' } = req.body;
      
      let result = {
        cleared: false,
        message: '',
        details: {}
      };
      
      if (!redisConnection.isConnected) {
        return ResponseHelper.error(res, 'Redis未连接，无法清除缓存');
      }
      
      const client = redisConnection.getClient();
      
      switch (type) {
        case 'all':
          // 清除所有缓存
          await client.flushDb();
          result.cleared = true;
          result.message = '所有缓存已清除';
          logger.info('管理员清除了所有缓存', { adminId: req.user.id });
          break;
          
        case 'models':
          // 清除AI模型相关缓存
          await CacheService.clearAIModelsCache();
          result.cleared = true;
          result.message = 'AI模型缓存已清除';
          logger.info('管理员清除了AI模型缓存', { adminId: req.user.id });
          break;
          
        case 'permissions':
          // 清除用户权限缓存
          await CacheService.clearUserPermissionsCache();
          result.cleared = true;
          result.message = '用户权限缓存已清除';
          logger.info('管理员清除了用户权限缓存', { adminId: req.user.id });
          break;
          
        case 'settings':
          // 清除系统设置缓存
          await CacheService.clearSystemSettingsCache();
          result.cleared = true;
          result.message = '系统设置缓存已清除';
          logger.info('管理员清除了系统设置缓存', { adminId: req.user.id });
          break;
          
        case 'stats':
          // 清除统计缓存
          await CacheService.clearStatsCache();
          result.cleared = true;
          result.message = '统计数据缓存已清除';
          logger.info('管理员清除了统计缓存', { adminId: req.user.id });
          break;
          
        case 'groups':
          // 清除用户组缓存
          await CacheService.clearUserGroupsCache();
          result.cleared = true;
          result.message = '用户组缓存已清除';
          logger.info('管理员清除了用户组缓存', { adminId: req.user.id });
          break;
          
        default:
          return ResponseHelper.validation(res, ['不支持的缓存类型']);
      }
      
      // 获取清除后的缓存统计
      const afterStats = await CacheService.getCacheStats();
      result.details = {
        keysAfterClear: afterStats.totalKeys || 0,
        memoryAfterClear: afterStats.memoryUsed || 'N/A'
      };

      return ResponseHelper.success(res, result, result.message);
    } catch (error) {
      logger.error('清除缓存失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '清除缓存失败');
    }
  }

  /**
   * 获取系统健康状态 - 只有超级管理员可以查看
   */
  static async getSystemHealth(req, res) {
    try {
      const userRole = req.user.role;
      
      // 只有超级管理员可以查看系统健康状态
      if (userRole !== ROLES.SUPER_ADMIN) {
        return ResponseHelper.forbidden(res, '只有超级管理员可以查看系统健康状态');
      }
      
      // 执行健康检查
      const healthStatus = await HealthCheckService.performHealthCheck();
      
      // 添加一些额外的系统信息
      const enrichedHealthStatus = {
        ...healthStatus,
        environment: process.env.NODE_ENV || 'production',
        nodeVersion: process.version,
        platform: process.platform,
        pid: process.pid
      };

      return ResponseHelper.success(res, enrichedHealthStatus, '获取系统健康状态成功');
    } catch (error) {
      logger.error('获取系统健康状态失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '获取系统健康状态失败');
    }
  }

  /**
   * 执行系统维护操作 - 只有超级管理员可以执行
   */
  static async performMaintenance(req, res) {
    try {
      const userRole = req.user.role;
      
      // 只有超级管理员可以执行维护操作
      if (userRole !== ROLES.SUPER_ADMIN) {
        return ResponseHelper.forbidden(res, '只有超级管理员可以执行系统维护');
      }
      
      const { action } = req.body;
      let result = {};
      
      switch (action) {
        case 'clearCache':
          // 清理Redis缓存
          if (redisConnection.isConnected) {
            await redisConnection.getClient().flushDb();
            result.message = 'Redis缓存已清理';
            logger.info('管理员清理了Redis缓存', { adminId: req.user.id });
          } else {
            result.message = 'Redis未连接，无法清理缓存';
          }
          break;
          
        case 'optimizeDatabase':
          // 优化数据库表（这里只是示例，实际应该异步执行）
          result.message = '数据库优化已启动（请通过维护脚本执行）';
          logger.info('管理员请求优化数据库', { adminId: req.user.id });
          break;
          
        default:
          return ResponseHelper.validation(res, ['不支持的维护操作']);
      }
      
      return ResponseHelper.success(res, result, '维护操作执行成功');
    } catch (error) {
      logger.error('执行维护操作失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '执行维护操作失败');
    }
  }

  /**
   * 获取系统设置 - 从数据库读取
   */
  static async getSystemSettings(req, res) {
    try {
      const userRole = req.user.role;
      
      // 从数据库获取配置
      const settings = await SystemConfig.getFormattedSettings();
      
      // 组管理员：添加只读标记
      if (userRole === ROLES.ADMIN) {
        settings._readOnly = true;
        settings._message = '组管理员只能查看设置，不能修改';
      }

      return ResponseHelper.success(res, settings, '获取系统设置成功');
    } catch (error) {
      logger.error('获取系统设置失败', { 
        userId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '获取系统设置失败');
    }
  }

  /**
   * 更新系统设置 - 保存到数据库并清除缓存
   */
  static async updateSystemSettings(req, res) {
    try {
      const userRole = req.user.role;
      
      // 双重检查：只有超级管理员可以更新
      if (userRole !== ROLES.SUPER_ADMIN) {
        return ResponseHelper.forbidden(res, '只有超级管理员可以修改系统设置');
      }
      
      const settings = req.body;

      // 保存到数据库
      await SystemConfig.saveFormattedSettings(settings);

      // 清除Redis中的公开配置缓存
      if (redisConnection.isConnected) {
        try {
          const cacheKey = 'public:system:config';
          await redisConnection.del(cacheKey);
          logger.info('清除公开配置缓存成功');
        } catch (redisError) {
          logger.warn('清除Redis缓存失败:', redisError);
        }
      }

      // 清除系统设置缓存
      await CacheService.clearSystemSettingsCache();

      logger.info('管理员更新系统设置', { 
        adminId: req.user.id,
        settings
      });

      return ResponseHelper.success(res, settings, '系统设置更新成功');
    } catch (error) {
      logger.error('更新系统设置失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '更新系统设置失败');
    }
  }

  /**
   * 获取邮件设置
   */
  static async getEmailSettings(req, res) {
    try {
      const userRole = req.user.role;
      
      // 只有超级管理员可以查看邮件设置
      if (userRole !== ROLES.SUPER_ADMIN) {
        return ResponseHelper.forbidden(res, '只有超级管理员可以查看邮件设置');
      }
      
      // 从数据库获取邮件配置
      const settings = await SystemConfig.getFormattedSettings();
      const emailSettings = settings.email || {};
      
      // 隐藏密码的部分字符
      if (emailSettings.smtp_pass) {
        const passLength = emailSettings.smtp_pass.length;
        if (passLength > 4) {
          emailSettings.smtp_pass = emailSettings.smtp_pass.substring(0, 2) + 
            '*'.repeat(passLength - 4) + 
            emailSettings.smtp_pass.substring(passLength - 2);
        } else {
          emailSettings.smtp_pass = '*'.repeat(passLength);
        }
      }

      return ResponseHelper.success(res, emailSettings, '获取邮件设置成功');
    } catch (error) {
      logger.error('获取邮件设置失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '获取邮件设置失败');
    }
  }

  /**
   * 更新邮件设置
   */
  static async updateEmailSettings(req, res) {
    try {
      const userRole = req.user.role;
      
      // 只有超级管理员可以更新邮件设置
      if (userRole !== ROLES.SUPER_ADMIN) {
        return ResponseHelper.forbidden(res, '只有超级管理员可以修改邮件设置');
      }
      
      const { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from } = req.body;
      
      // 验证必填参数
      if (!smtp_host || !smtp_port || !smtp_user || !smtp_pass) {
        return ResponseHelper.validation(res, ['请填写完整的邮件服务器配置']);
      }
      
      // 验证端口号
      const port = parseInt(smtp_port);
      if (isNaN(port) || port < 1 || port > 65535) {
        return ResponseHelper.validation(res, ['端口号必须在1-65535之间']);
      }
      
      // 获取当前设置
      const currentSettings = await SystemConfig.getFormattedSettings();
      
      // 如果密码是掩码格式，保留原密码
      let finalSmtpPass = smtp_pass;
      if (smtp_pass.includes('*') && currentSettings.email?.smtp_pass) {
        // 如果新密码包含*，说明是掩码，保留原密码
        finalSmtpPass = currentSettings.email.smtp_pass;
      }
      
      // 更新邮件设置
      currentSettings.email = {
        smtp_host,
        smtp_port: port,
        smtp_user,
        smtp_pass: finalSmtpPass,
        smtp_from: smtp_from || 'AI Platform'
      };
      
      // 保存到数据库
      await SystemConfig.saveFormattedSettings(currentSettings);
      
      logger.info('管理员更新邮件设置', { 
        adminId: req.user.id,
        smtp_host,
        smtp_port: port,
        smtp_user,
        smtp_from
      });

      return ResponseHelper.success(res, {
        smtp_host,
        smtp_port: port,
        smtp_user,
        smtp_from: smtp_from || 'AI Platform'
      }, '邮件设置更新成功');
    } catch (error) {
      logger.error('更新邮件设置失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '更新邮件设置失败');
    }
  }

  /**
   * 测试邮件发送
   */
  static async testEmailSend(req, res) {
    try {
      const userRole = req.user.role;
      
      // 只有超级管理员可以测试邮件发送
      if (userRole !== ROLES.SUPER_ADMIN) {
        return ResponseHelper.forbidden(res, '只有超级管理员可以测试邮件发送');
      }
      
      const { test_email } = req.body;
      
      // 验证邮箱格式
      if (!test_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(test_email)) {
        return ResponseHelper.validation(res, ['请输入有效的测试邮箱地址']);
      }
      
      logger.info('开始测试邮件发送', { 
        adminId: req.user.id,
        testEmail: test_email
      });
      
      try {
        // 发送测试邮件
        await EmailService.sendTestEmail(test_email);
        
        logger.info('测试邮件发送成功', { 
          adminId: req.user.id,
          testEmail: test_email
        });
        
        return ResponseHelper.success(res, null, '测试邮件发送成功，请检查收件箱');
      } catch (emailError) {
        logger.error('测试邮件发送失败', { 
          adminId: req.user.id,
          testEmail: test_email,
          error: emailError.message
        });
        
        return ResponseHelper.error(res, `邮件发送失败：${emailError.message}`);
      }
    } catch (error) {
      logger.error('测试邮件发送失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '测试邮件发送失败');
    }
  }

  /**
   * 上传站点Logo
   */
  static async uploadSiteLogo(req, res) {
    try {
      const userRole = req.user.role;
      
      // 只有超级管理员可以上传
      if (userRole !== ROLES.SUPER_ADMIN) {
        return ResponseHelper.forbidden(res, '只有超级管理员可以上传站点Logo');
      }

      if (!req.file) {
        return ResponseHelper.validation(res, ['请选择要上传的图片']);
      }

      const file = req.file;
      
      // 创建文件记录
      const fileRecord = await File.create({
        user_id: req.user.id,
        conversation_id: null,
        filename: file.filename,
        original_name: file.originalname,
        mime_type: file.mimetype,
        size: file.size,
        path: file.path,
        url: `/uploads/system/${file.filename}`
      });

      // 获取当前配置
      const currentSettings = await SystemConfig.getFormattedSettings();
      
      // 删除旧Logo文件（如果存在）
      if (currentSettings.site.logo) {
        try {
          // 使用配置的上传目录构建完整路径
          const logoPath = currentSettings.site.logo.replace(/^\/uploads\//, '');
          const oldLogoPath = path.join(config.upload.uploadDir, logoPath);
          await deleteFile(oldLogoPath);
        } catch (error) {
          logger.warn('删除旧Logo失败', { error: error.message });
        }
      }

      // 更新配置中的Logo路径
      currentSettings.site.logo = `/uploads/system/${file.filename}`;
      await SystemConfig.saveFormattedSettings(currentSettings);

      // 清除Redis中的公开配置缓存
      if (redisConnection.isConnected) {
        try {
          const cacheKey = 'public:system:config';
          await redisConnection.del(cacheKey);
          logger.info('清除公开配置缓存成功（Logo更新）');
        } catch (redisError) {
          logger.warn('清除Redis缓存失败:', redisError);
        }
      }

      logger.info('站点Logo上传成功', {
        adminId: req.user.id,
        filename: file.filename,
        size: file.size
      });

      return ResponseHelper.success(res, {
        url: `/uploads/system/${file.filename}`,
        file: fileRecord.toJSON()
      }, '站点Logo上传成功');
    } catch (error) {
      logger.error('上传站点Logo失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '上传站点Logo失败');
    }
  }

  /**
   * 获取系统公告
   */
  static async getSystemAnnouncement(req, res) {
    try {
      const userRole = req.user.role;
      
      // 获取配置
      const announcement = await SystemConfig.getSetting('system_announcement');
      
      // 如果没有配置，返回默认值
      const defaultAnnouncement = {
        content: '',
        enabled: true,
        format: 'markdown',
        updated_at: new Date().toISOString(),
        updated_by: null
      };
      
      const result = announcement || defaultAnnouncement;
      
      // 组管理员和普通用户只能查看
      if (userRole !== ROLES.SUPER_ADMIN) {
        result._readOnly = true;
      }

      return ResponseHelper.success(res, result, '获取系统公告成功');
    } catch (error) {
      logger.error('获取系统公告失败', { 
        userId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '获取系统公告失败');
    }
  }

  /**
   * 更新系统公告
   */
  static async updateSystemAnnouncement(req, res) {
    try {
      const userRole = req.user.role;
      
      // 只有超级管理员可以更新
      if (userRole !== ROLES.SUPER_ADMIN) {
        return ResponseHelper.forbidden(res, '只有超级管理员可以修改系统公告');
      }
      
      const { content, enabled = true, format = 'markdown' } = req.body;
      
      // 验证参数
      if (typeof content !== 'string') {
        return ResponseHelper.validation(res, ['content必须是字符串']);
      }
      
      if (typeof enabled !== 'boolean') {
        return ResponseHelper.validation(res, ['enabled必须是布尔值']);
      }
      
      // 限制内容大小（100KB）
      if (content.length > 100 * 1024) {
        return ResponseHelper.validation(res, ['公告内容不能超过100KB']);
      }
      
      // 构建配置对象
      const announcement = {
        content,
        enabled,
        format,
        updated_at: new Date().toISOString(),
        updated_by: req.user.id
      };
      
      // 保存到数据库
      await SystemConfig.updateSetting('system_announcement', announcement, 'json');
      
      // 清除Redis缓存（如果有公开的公告缓存）
      if (redisConnection.isConnected) {
        try {
          const cacheKey = 'public:system:announcement';
          await redisConnection.del(cacheKey);
          logger.info('清除系统公告缓存成功');
        } catch (redisError) {
          logger.warn('清除Redis缓存失败:', redisError);
        }
      }
      
      logger.info('管理员更新系统公告', { 
        adminId: req.user.id,
        enabled: announcement.enabled,
        contentLength: content.length
      });

      return ResponseHelper.success(res, announcement, '系统公告更新成功');
    } catch (error) {
      logger.error('更新系统公告失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '更新系统公告失败');
    }
  }

  /**
   * 获取自定义首页配置
   */
  static async getCustomHomepage(req, res) {
    try {
      const userRole = req.user.role;
      
      // 获取配置
      const config = await SystemConfig.getSetting('custom_homepage');
      
      // 如果没有配置，返回默认值
      const defaultConfig = {
        enabled: false,
        content: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>欢迎使用AI平台</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .container {
            text-align: center;
            padding: 40px;
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            max-width: 600px;
            margin: 20px;
        }
        h1 {
            color: #333;
            margin-bottom: 20px;
        }
        p {
            color: #666;
            line-height: 1.6;
            margin-bottom: 30px;
        }
        .login-button {
            background: #1890ff;
            color: white;
            border: none;
            padding: 12px 30px;
            font-size: 16px;
            border-radius: 4px;
            cursor: pointer;
            text-decoration: none;
            display: inline-block;
        }
        .login-button:hover {
            background: #1677ff;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>欢迎使用AI平台</h1>
        <p>我们提供先进的人工智能服务，帮助您提升工作效率。请登录以开始使用。</p>
        <a href="/login" class="login-button">立即登录</a>
    </div>
</body>
</html>`,
        updated_at: new Date().toISOString()
      };
      
      const result = config || defaultConfig;
      
      // 组管理员：添加只读标记
      if (userRole === ROLES.ADMIN) {
        result._readOnly = true;
        result._message = '组管理员只能查看自定义首页设置，不能修改';
      }

      return ResponseHelper.success(res, result, '获取自定义首页配置成功');
    } catch (error) {
      logger.error('获取自定义首页配置失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '获取自定义首页配置失败');
    }
  }

  /**
   * 更新自定义首页配置
   */
  static async updateCustomHomepage(req, res) {
    try {
      const userRole = req.user.role;
      
      // 只有超级管理员可以更新
      if (userRole !== ROLES.SUPER_ADMIN) {
        return ResponseHelper.forbidden(res, '只有超级管理员可以修改自定义首页');
      }
      
      const { enabled, content } = req.body;
      
      // 验证参数
      if (typeof enabled !== 'boolean') {
        return ResponseHelper.validation(res, ['enabled必须是布尔值']);
      }
      
      if (!content || typeof content !== 'string') {
        return ResponseHelper.validation(res, ['content必须是非空字符串']);
      }
      
      // 限制内容大小（500KB）
      if (content.length > 500 * 1024) {
        return ResponseHelper.validation(res, ['HTML内容不能超过500KB']);
      }
      
      // 构建配置对象
      const config = {
        enabled,
        content,
        updated_at: new Date().toISOString(),
        updated_by: req.user.id
      };
      
      // 保存到数据库
      await SystemConfig.updateSetting('custom_homepage', config, 'json');
      
      logger.info('管理员更新自定义首页配置', { 
        adminId: req.user.id,
        enabled: config.enabled
      });

      return ResponseHelper.success(res, config, '自定义首页配置更新成功');
    } catch (error) {
      logger.error('更新自定义首页配置失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '更新自定义首页配置失败');
    }
  }

  /**
   * 获取速率限制设置（新增）
   */
  static async getRateLimitSettings(req, res) {
    try {
      const userRole = req.user.role;
      
      // 只有超级管理员可以查看速率限制设置
      if (userRole !== ROLES.SUPER_ADMIN) {
        return ResponseHelper.forbidden(res, '只有超级管理员可以查看速率限制设置');
      }
      
      // 获取格式化的配置
      const settings = await rateLimitService.getFormattedConfig();
      
      return ResponseHelper.success(res, settings, '获取速率限制设置成功');
    } catch (error) {
      logger.error('获取速率限制设置失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '获取速率限制设置失败');
    }
  }

  /**
   * 更新速率限制设置（新增）
   */
  static async updateRateLimitSettings(req, res) {
    try {
      const userRole = req.user.role;
      
      // 只有超级管理员可以更新速率限制设置
      if (userRole !== ROLES.SUPER_ADMIN) {
        return ResponseHelper.forbidden(res, '只有超级管理员可以修改速率限制设置');
      }
      
      const settings = req.body;
      
      // 验证配置格式
      if (typeof settings !== 'object' || settings === null) {
        return ResponseHelper.validation(res, ['配置格式无效']);
      }
      
      // 验证每个配置项
      for (const [key, config] of Object.entries(settings)) {
        if (!config.windowMinutes || !config.max || !config.message) {
          return ResponseHelper.validation(res, [`配置项 ${key} 缺少必要字段`]);
        }
        
        // 验证数值范围
        if (config.windowMinutes < 1 || config.windowMinutes > 1440) {
          return ResponseHelper.validation(res, [`配置项 ${key} 的时间窗口必须在1-1440分钟之间`]);
        }
        
        if (config.max < 1 || config.max > 10000) {
          return ResponseHelper.validation(res, [`配置项 ${key} 的最大请求数必须在1-10000之间`]);
        }
      }
      
      // 保存配置
      await rateLimitService.saveFormattedConfig(settings);
      
      logger.info('管理员更新速率限制设置', { 
        adminId: req.user.id,
        settings
      });

      return ResponseHelper.success(res, settings, '速率限制设置更新成功');
    } catch (error) {
      logger.error('更新速率限制设置失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '更新速率限制设置失败');
    }
  }

  /**
   * 获取实时统计数据 - 根据角色过滤
   */
  static async getRealtimeStats(req, res) {
    try {
      const userRole = req.user.role;
      const filterOptions = {
        groupId: userRole === ROLES.ADMIN ? req.user.group_id : null
      };
      
      const stats = await StatsService.getRealtimeStats(filterOptions);

      return ResponseHelper.success(res, stats, '获取实时统计成功');
    } catch (error) {
      logger.error('获取实时统计失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '获取实时统计失败');
    }
  }

  /**
   * 生成统计报表 - 组管理员只能生成本组报表
   */
  static async generateReport(req, res) {
    try {
      const { start_date, end_date, group_id, format = 'json' } = req.query;
      const userRole = req.user.role;
      
      // 组管理员强制使用自己的组ID
      let actualGroupId = group_id;
      if (userRole === ROLES.ADMIN) {
        actualGroupId = req.user.group_id;
      }
      
      const report = await StatsService.generateReport({
        startDate: start_date,
        endDate: end_date,
        groupId: actualGroupId,
        format,
        limitToGroup: userRole === ROLES.ADMIN
      });

      return ResponseHelper.success(res, report, '统计报表生成成功');
    } catch (error) {
      logger.error('生成统计报表失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '生成统计报表失败');
    }
  }

  /**
   * 获取SSO配置
   */
  static async getSSOSettings(req, res) {
    try {
      const userRole = req.user.role;
      
      // 只有超级管理员可以查看SSO配置
      if (userRole !== ROLES.SUPER_ADMIN) {
        return ResponseHelper.forbidden(res, '只有超级管理员可以查看SSO配置');
      }
      
      // 从数据库获取SSO配置
      const ssoConfig = await SystemConfig.getSetting('sso_config');
      
      // 如果没有配置，返回默认值
      const defaultConfig = {
        enabled: false,
        shared_secret: '',
        target_group_id: 1,
        default_credits: 100,
        signature_valid_minutes: 5,
        ip_whitelist_enabled: false,
        allowed_ips: ''
      };
      
      const result = ssoConfig || defaultConfig;
      
      // 隐藏密钥的部分字符
      if (result.shared_secret && result.shared_secret.length > 8) {
        result.shared_secret = result.shared_secret.substring(0, 4) + 
          '*'.repeat(result.shared_secret.length - 8) + 
          result.shared_secret.substring(result.shared_secret.length - 4);
      }

      return ResponseHelper.success(res, result, '获取SSO配置成功');
    } catch (error) {
      logger.error('获取SSO配置失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '获取SSO配置失败');
    }
  }

  /**
   * 更新SSO配置
   */
  static async updateSSOSettings(req, res) {
    try {
      const userRole = req.user.role;
      
      // 只有超级管理员可以更新SSO配置
      if (userRole !== ROLES.SUPER_ADMIN) {
        return ResponseHelper.forbidden(res, '只有超级管理员可以修改SSO配置');
      }
      
      const {
        enabled,
        shared_secret,
        target_group_id,
        default_credits,
        signature_valid_minutes,
        ip_whitelist_enabled,
        allowed_ips
      } = req.body;
      
      // 验证参数
      if (typeof enabled !== 'boolean') {
        return ResponseHelper.validation(res, ['enabled必须是布尔值']);
      }
      
      if (enabled && !shared_secret) {
        return ResponseHelper.validation(res, ['启用SSO时必须设置共享密钥']);
      }
      
      // 验证组ID
      const groupId = parseInt(target_group_id);
      if (isNaN(groupId) || groupId < 1) {
        return ResponseHelper.validation(res, ['目标组ID无效']);
      }
      
      // 验证积分数量
      const credits = parseInt(default_credits);
      if (isNaN(credits) || credits < 0) {
        return ResponseHelper.validation(res, ['默认积分数量必须大于等于0']);
      }
      
      // 验证签名有效期
      const validMinutes = parseInt(signature_valid_minutes);
      if (isNaN(validMinutes) || validMinutes < 1 || validMinutes > 60) {
        return ResponseHelper.validation(res, ['签名有效期必须在1-60分钟之间']);
      }
      
      // 获取当前配置
      const currentConfig = await SystemConfig.getSetting('sso_config') || {};
      
      // 如果密钥是掩码格式，保留原密钥
      let finalSharedSecret = shared_secret;
      if (shared_secret && shared_secret.includes('*') && currentConfig.shared_secret) {
        // 如果新密钥包含*，说明是掩码，保留原密钥
        finalSharedSecret = currentConfig.shared_secret;
      }
      
      // 构建配置对象
      const ssoConfig = {
        enabled,
        shared_secret: finalSharedSecret,
        target_group_id: groupId,
        default_credits: credits,
        signature_valid_minutes: validMinutes,
        ip_whitelist_enabled: ip_whitelist_enabled === true,
        allowed_ips: allowed_ips || '',
        updated_at: new Date().toISOString(),
        updated_by: req.user.id
      };
      
      // 保存到数据库
      await SystemConfig.updateSetting('sso_config', ssoConfig, 'json');
      
      logger.info('管理员更新SSO配置', { 
        adminId: req.user.id,
        enabled: ssoConfig.enabled,
        target_group_id: ssoConfig.target_group_id,
        ip_whitelist_enabled: ssoConfig.ip_whitelist_enabled
      });

      // 返回时隐藏密钥
      if (ssoConfig.shared_secret && ssoConfig.shared_secret.length > 8) {
        ssoConfig.shared_secret = ssoConfig.shared_secret.substring(0, 4) + 
          '*'.repeat(ssoConfig.shared_secret.length - 8) + 
          ssoConfig.shared_secret.substring(ssoConfig.shared_secret.length - 4);
      }

      return ResponseHelper.success(res, ssoConfig, 'SSO配置更新成功');
    } catch (error) {
      logger.error('更新SSO配置失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '更新SSO配置失败');
    }
  }

  /**
   * 生成新的SSO共享密钥
   */
  static async generateSSOSecret(req, res) {
    try {
      const userRole = req.user.role;
      
      // 只有超级管理员可以生成密钥
      if (userRole !== ROLES.SUPER_ADMIN) {
        return ResponseHelper.forbidden(res, '只有超级管理员可以生成SSO密钥');
      }
      
      // 生成32位随机密钥
      const crypto = require('crypto');
      const newSecret = crypto.randomBytes(16).toString('hex');
      
      logger.info('管理员生成新的SSO密钥', { 
        adminId: req.user.id
      });

      return ResponseHelper.success(res, {
        secret: newSecret
      }, 'SSO密钥生成成功');
    } catch (error) {
      logger.error('生成SSO密钥失败', { 
        adminId: req.user?.id, 
        error: error.message 
      });
      return ResponseHelper.error(res, error.message || '生成SSO密钥失败');
    }
  }
}

module.exports = SystemStatsController;

/**
 * 公开路由 - 不需要认证
 */

const express = require('express');
const SystemConfig = require('../models/SystemConfig');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');
const redisConnection = require('../database/redis');

const router = express.Router();

/**
 * @route GET /api/public/system-config
 * @desc 获取公开的系统配置
 * @access Public
 */
router.get('/system-config', async (req, res) => {
  try {
    const cacheKey = 'public:system:config';
    
    // 尝试从Redis获取缓存
    if (redisConnection.isConnected) {
      try {
        const cached = await redisConnection.get(cacheKey);
        if (cached) {
          return ResponseHelper.success(res, cached, '获取系统配置成功');
        }
      } catch (redisError) {
        logger.warn('Redis缓存读取失败:', redisError);
      }
    }
    
    // 从数据库获取配置
    const config = await SystemConfig.getFormattedSettings();
    
    // 只返回公开的配置信息
    const publicConfig = {
      site: {
        name: config.site?.name || 'AI Platform',
        description: config.site?.description || '企业级AI应用聚合平台',
        logo: config.site?.logo || ''
      },
      user: {
        allow_register: config.user?.allow_register !== false // 默认允许注册
      },
      login: {
        mode: config.login?.mode || 'standard' // 默认标准模式
      }
    };
    
    // 缓存配置（5分钟）
    if (redisConnection.isConnected) {
      try {
        await redisConnection.set(cacheKey, publicConfig, 300);
      } catch (redisError) {
        logger.warn('Redis缓存写入失败:', redisError);
      }
    }
    
    return ResponseHelper.success(res, publicConfig, '获取系统配置成功');
  } catch (error) {
    logger.error('获取系统配置失败:', error);
    // 返回默认配置，避免前端崩溃
    const defaultConfig = {
      site: {
        name: 'AI Platform',
        description: '企业级AI应用聚合平台',
        logo: ''
      },
      user: {
        allow_register: true
      },
      login: {
        mode: 'standard'
      }
    };
    return ResponseHelper.success(res, defaultConfig, '获取系统配置成功');
  }
});

/**
 * @route GET /api/public/custom-homepage
 * @desc 获取自定义首页内容
 * @access Public
 */
router.get('/custom-homepage', async (req, res) => {
  try {
    // 获取配置
    const config = await SystemConfig.getSetting('custom_homepage');
    
    // 如果没有配置或未启用，返回null
    if (!config || !config.enabled) {
      return ResponseHelper.success(res, null, '自定义首页未启用');
    }
    
    // 只返回必要的信息
    const result = {
      enabled: config.enabled,
      content: config.content
    };
    
    return ResponseHelper.success(res, result, '获取自定义首页成功');
  } catch (error) {
    logger.error('获取自定义首页失败:', error);
    return ResponseHelper.error(res, '获取自定义首页失败');
  }
});

module.exports = router;

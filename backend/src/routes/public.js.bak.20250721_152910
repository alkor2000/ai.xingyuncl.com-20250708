/**
 * 公开路由 - 不需要认证
 */

const express = require('express');
const SystemConfig = require('../models/SystemConfig');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');

const router = express.Router();

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

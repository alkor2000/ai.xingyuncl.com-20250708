/**
 * 公开路由 - 不需要认证的API端点
 * 
 * 版本更新：
 * - v1.1.0 (2026-01-29): 修复 default_language 不返回问题
 *   - 修正 SQL 查询 key: site -> site_config
 *   - 添加 default_language 字段返回
 */
const express = require('express');
const router = express.Router();
const dbConnection = require('../database/connection');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');
const OrgApplicationController = require('../controllers/admin/OrgApplicationController');
const PublicUploadController = require('../controllers/PublicUploadController');
const { uploadBusinessLicense } = require('../middleware/publicUploadMiddleware');

/**
 * 获取自定义首页配置
 * GET /public/custom-homepage
 */
router.get('/custom-homepage', async (req, res) => {
  try {
    // 从数据库获取自定义首页配置
    const sql = `
      SELECT setting_value 
      FROM system_settings 
      WHERE setting_key = 'custom_homepage'
    `;
    
    const { rows } = await dbConnection.query(sql);
    
    if (rows && rows.length > 0 && rows[0].setting_value) {
      try {
        const config = JSON.parse(rows[0].setting_value);
        return ResponseHelper.success(res, config);
      } catch (parseError) {
        logger.error('解析自定义首页配置失败:', parseError);
        return ResponseHelper.success(res, {
          enabled: false,
          content: ''
        });
      }
    }
    
    // 没有配置时返回默认值
    return ResponseHelper.success(res, {
      enabled: false,
      content: ''
    });
  } catch (error) {
    logger.error('获取自定义首页配置失败:', error);
    return ResponseHelper.success(res, {
      enabled: false,
      content: ''
    });
  }
});

/**
 * 获取系统公开配置
 * GET /public/system-config
 * 
 * 返回内容：
 * - user.allow_register: 是否允许注册
 * - login.mode: 登录模式
 * - site.site_name: 站点名称
 * - site.site_logo: 站点Logo
 * - site.default_language: 默认语言 (v1.1.0 新增)
 * 
 * v1.1.0 修复：
 * - 修正 SQL 查询 key: site -> site_config
 * - 添加 default_language 字段返回
 */
router.get('/system-config', async (req, res) => {
  try {
    // v1.1.0 修复：使用正确的 setting_key = 'site_config'，并添加 default_language
    const sql = `
      SELECT 
        JSON_OBJECT(
          'allow_register', 
          COALESCE(
            (SELECT CAST(JSON_EXTRACT(setting_value, '$.allow_register') AS UNSIGNED)
             FROM system_settings 
             WHERE setting_key = 'user_config'),
            1
          )
        ) as user,
        JSON_OBJECT(
          'mode',
          COALESCE(
            (SELECT JSON_UNQUOTE(JSON_EXTRACT(setting_value, '$.mode'))
             FROM system_settings 
             WHERE setting_key = 'login_config'),
            'standard'
          )
        ) as login,
        JSON_OBJECT(
          'site_name',
          COALESCE(
            (SELECT JSON_UNQUOTE(JSON_EXTRACT(setting_value, '$.name'))
             FROM system_settings 
             WHERE setting_key = 'site_config'),
            '星云AI平台'
          ),
          'site_logo',
          COALESCE(
            (SELECT JSON_UNQUOTE(JSON_EXTRACT(setting_value, '$.logo'))
             FROM system_settings 
             WHERE setting_key = 'site_config'),
            NULL
          ),
          'default_language',
          COALESCE(
            (SELECT JSON_UNQUOTE(JSON_EXTRACT(setting_value, '$.default_language'))
             FROM system_settings 
             WHERE setting_key = 'site_config'),
            'zh-CN'
          )
        ) as site
    `;
    
    const { rows } = await dbConnection.query(sql);
    const config = rows[0] || {
      user: { allow_register: true },
      login: { mode: 'standard' },
      site: { site_name: '星云AI平台', site_logo: null, default_language: 'zh-CN' }
    };
    
    // 解析JSON字符串
    if (typeof config.user === 'string') {
      config.user = JSON.parse(config.user);
    }
    if (typeof config.login === 'string') {
      config.login = JSON.parse(config.login);
    }
    if (typeof config.site === 'string') {
      config.site = JSON.parse(config.site);
    }
    
    // 日志记录（调试用）
    logger.info('公开系统配置返回:', {
      default_language: config.site?.default_language,
      site_name: config.site?.site_name
    });
    
    return ResponseHelper.success(res, config);
  } catch (error) {
    logger.error('获取系统公开配置失败:', error);
    return ResponseHelper.success(res, {
      user: { allow_register: true },
      login: { mode: 'standard' },
      site: { site_name: '星云AI平台', site_logo: null, default_language: 'zh-CN' }
    });
  }
});

// 机构申请相关的公开路由
router.get('/org-application/form-config', OrgApplicationController.getFormConfig);
router.post('/org-application/submit', OrgApplicationController.submitApplication);

// 公开文件上传路由
router.post('/org-application/upload-license', 
  uploadBusinessLicense,
  PublicUploadController.uploadBusinessLicense
);

module.exports = router;

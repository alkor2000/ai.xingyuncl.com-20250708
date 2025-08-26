/**
 * OSS配置管理控制器
 */

const ResponseHelper = require('../../utils/response');
const logger = require('../../utils/logger');
const dbConnection = require('../../database/connection');

class OSSConfigController {
  /**
   * 获取OSS配置
   */
  static async getConfig(req, res) {
    try {
      const sql = `SELECT * FROM system_settings WHERE setting_key = 'oss_config'`;
      const { rows } = await dbConnection.query(sql);
      
      let config = {
        enabled: false,
        provider: 'local',
        region: '',
        bucket: '',
        accessKeyId: '',
        accessKeySecret: '',
        customDomain: '',
        pathPrefix: 'uploads'
      };
      
      if (rows.length > 0 && rows[0].setting_value) {
        try {
          const storedConfig = JSON.parse(rows[0].setting_value);
          config = { ...config, ...storedConfig };
          // 不返回敏感信息的完整内容
          if (config.accessKeySecret) {
            config.accessKeySecret = '******';
          }
        } catch (e) {
          logger.error('解析OSS配置失败:', e);
        }
      }
      
      return ResponseHelper.success(res, config, '获取OSS配置成功');
    } catch (error) {
      logger.error('获取OSS配置失败:', error);
      return ResponseHelper.error(res, '获取OSS配置失败');
    }
  }

  /**
   * 保存OSS配置
   */
  static async saveConfig(req, res) {
    try {
      const config = req.body;
      
      // 如果密钥是******，说明没有修改，需要保留原有值
      if (config.accessKeySecret === '******') {
        const sql = `SELECT setting_value FROM system_settings WHERE setting_key = 'oss_config'`;
        const { rows } = await dbConnection.query(sql);
        if (rows.length > 0 && rows[0].setting_value) {
          try {
            const oldConfig = JSON.parse(rows[0].setting_value);
            config.accessKeySecret = oldConfig.accessKeySecret;
          } catch (e) {
            logger.error('解析旧OSS配置失败:', e);
          }
        }
      }
      
      const configJson = JSON.stringify(config);
      
      const checkSql = `SELECT id FROM system_settings WHERE setting_key = 'oss_config'`;
      const { rows } = await dbConnection.query(checkSql);
      
      if (rows.length > 0) {
        const updateSql = `
          UPDATE system_settings 
          SET setting_value = ?, updated_at = NOW() 
          WHERE setting_key = 'oss_config'
        `;
        await dbConnection.query(updateSql, [configJson]);
      } else {
        const insertSql = `
          INSERT INTO system_settings (setting_key, setting_value, setting_type)
          VALUES ('oss_config', ?, 'json')
        `;
        await dbConnection.query(insertSql, [configJson]);
      }
      
      logger.info('OSS配置保存成功');
      return ResponseHelper.success(res, null, 'OSS配置保存成功');
    } catch (error) {
      logger.error('保存OSS配置失败:', error);
      return ResponseHelper.error(res, '保存OSS配置失败');
    }
  }

  /**
   * 测试OSS连接
   */
  static async testConnection(req, res) {
    try {
      const config = req.body;
      
      // 如果是本地存储，直接返回成功
      if (config.provider === 'local') {
        return ResponseHelper.success(res, null, '本地存储模式，无需测试连接');
      }
      
      // 测试阿里云OSS连接
      if (config.provider === 'aliyun') {
        // 处理密钥为******的情况，从数据库读取真实密钥
        let realConfig = { ...config };
        
        if (config.accessKeySecret === '******') {
          const sql = `SELECT setting_value FROM system_settings WHERE setting_key = 'oss_config'`;
          const { rows } = await dbConnection.query(sql);
          
          if (rows.length > 0 && rows[0].setting_value) {
            try {
              const storedConfig = JSON.parse(rows[0].setting_value);
              // 只替换密钥，其他字段使用前端传来的值（用户可能修改了其他字段）
              realConfig.accessKeySecret = storedConfig.accessKeySecret;
              
              // 如果数据库中也没有真实密钥或者密钥也是******
              if (!realConfig.accessKeySecret || realConfig.accessKeySecret === '******') {
                return ResponseHelper.error(res, '请输入Access Key Secret');
              }
            } catch (e) {
              logger.error('解析存储的OSS配置失败:', e);
              return ResponseHelper.error(res, '配置数据错误，请重新配置');
            }
          } else {
            return ResponseHelper.error(res, '请先保存配置后再测试');
          }
        }
        
        // 使用真实配置测试连接
        const OSS = require('ali-oss');
        
        try {
          const client = new OSS({
            region: realConfig.region,
            accessKeyId: realConfig.accessKeyId,
            accessKeySecret: realConfig.accessKeySecret,
            bucket: realConfig.bucket
          });
          
          // 尝试列出文件来测试连接
          await client.list({ 'max-keys': 1 });
          
          return ResponseHelper.success(res, null, 'OSS连接测试成功');
        } catch (error) {
          logger.error('OSS连接测试失败:', error);
          return ResponseHelper.error(res, `连接失败: ${error.message}`);
        }
      }
      
      return ResponseHelper.error(res, '不支持的存储类型');
    } catch (error) {
      logger.error('测试OSS连接失败:', error);
      return ResponseHelper.error(res, '测试连接失败');
    }
  }

  /**
   * 获取积分配置
   */
  static async getCreditConfig(req, res) {
    try {
      const sql = `
        SELECT * FROM storage_credit_config 
        ORDER BY action_type, file_type
      `;
      const { rows } = await dbConnection.query(sql);
      
      return ResponseHelper.success(res, rows, '获取积分配置成功');
    } catch (error) {
      logger.error('获取积分配置失败:', error);
      return ResponseHelper.error(res, '获取积分配置失败');
    }
  }

  /**
   * 更新积分配置
   */
  static async updateCreditConfig(req, res) {
    const transaction = await dbConnection.beginTransaction();
    
    try {
      const { configs } = req.body;
      
      // 先清空现有配置
      await transaction.query('DELETE FROM storage_credit_config');
      
      // 插入新配置
      for (const config of configs) {
        const sql = `
          INSERT INTO storage_credit_config (
            file_type, action_type, credits_per_mb, 
            min_credits, max_credits, is_active
          ) VALUES (?, ?, ?, ?, ?, ?)
        `;
        
        await transaction.query(sql, [
          config.file_type,
          config.action_type,
          config.credits_per_mb || 1,
          config.min_credits || 1,
          config.max_credits || 100,
          config.is_active !== false
        ]);
      }
      
      await transaction.commit();
      
      logger.info('积分配置更新成功');
      return ResponseHelper.success(res, null, '积分配置更新成功');
    } catch (error) {
      await transaction.rollback();
      logger.error('更新积分配置失败:', error);
      return ResponseHelper.error(res, '更新积分配置失败');
    }
  }

  /**
   * 获取存储统计
   */
  static async getStorageStats(req, res) {
    try {
      const sql = `
        SELECT 
          COUNT(DISTINCT user_id) as total_users,
          COUNT(*) as total_files,
          SUM(file_size) as total_size,
          AVG(file_size) as avg_size
        FROM user_files
        WHERE is_deleted = 0
      `;
      
      const { rows } = await dbConnection.query(sql);
      
      return ResponseHelper.success(res, rows[0], '获取存储统计成功');
    } catch (error) {
      logger.error('获取存储统计失败:', error);
      return ResponseHelper.error(res, '获取存储统计失败');
    }
  }
}

module.exports = OSSConfigController;

/**
 * 存储积分配置控制器
 */
const dbConnection = require('../../database/connection');
const ResponseHelper = require('../../utils/response');
const logger = require('../../utils/logger');

class StorageCreditController {
  /**
   * 获取存储积分配置
   */
  static async getConfig(req, res) {
    try {
      const sql = `SELECT * FROM storage_credits_config_simple WHERE is_active = 1 LIMIT 1`;
      const { rows } = await dbConnection.query(sql);
      
      if (rows.length === 0) {
        // 返回默认配置
        return ResponseHelper.success(res, {
          base_credits: 2,
          credits_per_5mb: 1,
          max_file_size: 100
        });
      }
      
      return ResponseHelper.success(res, rows[0]);
    } catch (error) {
      logger.error('获取存储积分配置失败:', error);
      return ResponseHelper.error(res, '获取配置失败');
    }
  }
  
  /**
   * 更新存储积分配置
   */
  static async updateConfig(req, res) {
    try {
      const { base_credits, credits_per_5mb, max_file_size } = req.body;
      
      // 验证参数
      if (base_credits < 0 || credits_per_5mb < 0 || max_file_size < 1) {
        return ResponseHelper.validation(res, ['配置参数无效']);
      }
      
      // 检查是否已有配置
      const checkSql = `SELECT id FROM storage_credits_config_simple WHERE is_active = 1 LIMIT 1`;
      const { rows: existing } = await dbConnection.query(checkSql);
      
      if (existing.length > 0) {
        // 更新现有配置
        const updateSql = `
          UPDATE storage_credits_config_simple 
          SET base_credits = ?, credits_per_5mb = ?, max_file_size = ?, 
              updated_by = ?, updated_at = NOW()
          WHERE id = ?
        `;
        await dbConnection.query(updateSql, [
          base_credits, 
          credits_per_5mb, 
          max_file_size,
          req.user.id,
          existing[0].id
        ]);
      } else {
        // 插入新配置
        const insertSql = `
          INSERT INTO storage_credits_config_simple 
          (base_credits, credits_per_5mb, max_file_size, updated_by)
          VALUES (?, ?, ?, ?)
        `;
        await dbConnection.query(insertSql, [
          base_credits, 
          credits_per_5mb, 
          max_file_size,
          req.user.id
        ]);
      }
      
      logger.info('存储积分配置已更新', { 
        base_credits, 
        credits_per_5mb, 
        max_file_size,
        updatedBy: req.user.id 
      });
      
      return ResponseHelper.success(res, null, '配置更新成功');
    } catch (error) {
      logger.error('更新存储积分配置失败:', error);
      return ResponseHelper.error(res, '更新配置失败');
    }
  }
}

module.exports = StorageCreditController;

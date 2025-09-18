/**
 * OCR控制器
 * 处理OCR相关的HTTP请求
 */

const ocrService = require('../services/ocrService');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');
const dbConnection = require('../database/connection');

class OcrController {
  /**
   * 获取OCR配置
   */
  static async getConfig(req, res) {
    try {
      const config = await ocrService.getConfig();
      return ResponseHelper.success(res, config);
    } catch (error) {
      logger.error('获取OCR配置失败:', error);
      return ResponseHelper.error(res, '获取配置失败');
    }
  }

  /**
   * 处理单个图片OCR
   */
  static async processImage(req, res) {
    try {
      const userId = req.user.id;
      
      if (!req.file) {
        return ResponseHelper.validation(res, null, '请选择要识别的图片');
      }
      
      // 验证文件类型
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(req.file.mimetype)) {
        return ResponseHelper.validation(res, null, '不支持的图片格式');
      }
      
      // 处理OCR
      const result = await ocrService.processImage(userId, req.file);
      
      return ResponseHelper.success(res, result, '识别成功');
    } catch (error) {
      logger.error('图片OCR失败:', error);
      
      if (error.message.includes('积分不足')) {
        return ResponseHelper.error(res, error.message, 402);
      }
      
      return ResponseHelper.error(res, error.message || '识别失败');
    }
  }

  /**
   * 处理PDF OCR
   */
  static async processPDF(req, res) {
    try {
      const userId = req.user.id;
      
      if (!req.file) {
        return ResponseHelper.validation(res, null, '请选择要识别的PDF');
      }
      
      // 验证文件类型
      if (req.file.mimetype !== 'application/pdf') {
        return ResponseHelper.validation(res, null, '请上传PDF文件');
      }
      
      // 处理OCR
      const result = await ocrService.processPDF(userId, req.file);
      
      return ResponseHelper.success(res, result, '识别成功');
    } catch (error) {
      logger.error('PDF OCR失败:', error);
      
      if (error.message.includes('积分不足')) {
        return ResponseHelper.error(res, error.message, 402);
      }
      
      return ResponseHelper.error(res, error.message || '识别失败');
    }
  }

  /**
   * 批量处理文件
   */
  static async processBatch(req, res) {
    try {
      const userId = req.user.id;
      
      if (!req.files || req.files.length === 0) {
        return ResponseHelper.validation(res, null, '请选择要识别的文件');
      }
      
      const results = [];
      const errors = [];
      
      for (const file of req.files) {
        try {
          let result;
          
          if (file.mimetype === 'application/pdf') {
            result = await ocrService.processPDF(userId, file);
          } else if (file.mimetype.startsWith('image/')) {
            result = await ocrService.processImage(userId, file);
          } else {
            errors.push({
              file: file.originalname,
              error: '不支持的文件类型'
            });
            continue;
          }
          
          results.push({
            file: file.originalname,
            ...result
          });
        } catch (error) {
          errors.push({
            file: file.originalname,
            error: error.message
          });
        }
      }
      
      return ResponseHelper.success(res, {
        success: results.length,
        failed: errors.length,
        results,
        errors
      }, `成功处理 ${results.length} 个文件`);
      
    } catch (error) {
      logger.error('批量OCR失败:', error);
      return ResponseHelper.error(res, '批量处理失败');
    }
  }

  /**
   * 获取任务详情
   */
  static async getTask(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      
      const task = await ocrService.getTask(id, userId);
      
      if (!task) {
        return ResponseHelper.notFound(res, '任务不存在');
      }
      
      return ResponseHelper.success(res, task);
    } catch (error) {
      logger.error('获取任务详情失败:', error);
      return ResponseHelper.error(res, '获取任务失败');
    }
  }

  /**
   * 获取任务历史
   */
  static async getTasks(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 20, status } = req.query;
      
      const result = await ocrService.getUserTasks(userId, {
        page: parseInt(page),
        limit: parseInt(limit),
        status
      });
      
      return ResponseHelper.paginated(res, result.data, result.pagination);
    } catch (error) {
      logger.error('获取任务历史失败:', error);
      return ResponseHelper.error(res, '获取历史记录失败');
    }
  }

  /**
   * 更新OCR配置（管理员）
   */
  static async updateConfig(req, res) {
    try {
      const updates = req.body;
      
      // 更新配置
      for (const [key, value] of Object.entries(updates)) {
        if (key === 'mistral_api_key' && value) {
          // API密钥特殊处理
          const query = `
            UPDATE system_settings 
            SET setting_value = ?
            WHERE setting_key = 'ocr.mistral_api_key'
          `;
          await dbConnection.query(query, [value]);
        } else if (key !== 'mistral_api_key') {
          // 其他配置
          const query = `
            UPDATE system_settings 
            SET setting_value = ?
            WHERE setting_key = ?
          `;
          await dbConnection.query(query, [value, `ocr.${key}`]);
        }
      }
      
      // 重新初始化服务
      await ocrService.initialize();
      
      return ResponseHelper.success(res, null, '配置更新成功');
    } catch (error) {
      logger.error('更新OCR配置失败:', error);
      return ResponseHelper.error(res, '更新配置失败');
    }
  }
}

module.exports = OcrController;

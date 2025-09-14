/**
 * 公开文件上传控制器
 * 用于申请页面等无需登录的文件上传
 */

const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const ossService = require('../services/ossService');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');

class PublicUploadController {
  /**
   * 上传营业执照等文件
   */
  static async uploadBusinessLicense(req, res) {
    try {
      if (!req.file) {
        return ResponseHelper.validation(res, '请选择要上传的文件');
      }

      const file = req.file;
      
      // 生成唯一文件名
      const timestamp = Date.now();
      const random = crypto.randomBytes(8).toString('hex');
      const ext = path.extname(file.originalname);
      const fileName = `business_license_${timestamp}_${random}${ext}`;
      
      // 生成OSS key
      const date = new Date();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const ossKey = `public/applications/${year}/${month}/${fileName}`;
      
      // 初始化OSS服务
      await ossService.initialize();
      
      // 上传到OSS或本地
      const uploadResult = await ossService.uploadFile(file.buffer, ossKey, {
        headers: {
          'Content-Type': file.mimetype,
          'Content-Disposition': `attachment; filename="${encodeURIComponent(file.originalname)}"`
        }
      });
      
      logger.info('公开文件上传成功', {
        ossKey,
        originalName: file.originalname,
        size: file.size,
        url: uploadResult.url
      });
      
      return ResponseHelper.success(res, {
        url: uploadResult.url,
        ossKey: uploadResult.ossKey,
        fileName: file.originalname,
        size: file.size
      }, '文件上传成功');
    } catch (error) {
      logger.error('公开文件上传失败:', error);
      return ResponseHelper.error(res, '文件上传失败');
    }
  }
}

module.exports = PublicUploadController;

/**
 * OSS服务
 * 处理文件上传、下载、删除等操作
 * 支持阿里云OSS和本地存储
 */

const OSS = require('ali-oss');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const dbConnection = require('../database/connection');
const logger = require('../utils/logger');

class OSSService {
  constructor() {
    this.client = null;
    this.config = null;
    this.isLocal = true; // 默认使用本地存储
  }

  /**
   * 初始化OSS客户端
   */
  async initialize() {
    try {
      // 从system_settings表获取OSS配置
      const sql = `
        SELECT setting_value 
        FROM system_settings 
        WHERE setting_key = 'oss_config'
      `;
      
      const { rows } = await dbConnection.query(sql);
      
      if (rows.length === 0 || !rows[0].setting_value) {
        logger.info('未找到OSS配置，使用本地存储');
        this.isLocal = true;
        return true;
      }
      
      // 解析配置
      this.config = JSON.parse(rows[0].setting_value);
      
      // 检查是否启用OSS
      if (!this.config.enabled || this.config.provider === 'local') {
        logger.info('OSS未启用或使用本地存储');
        this.isLocal = true;
        return true;
      }
      
      // 如果是阿里云OSS
      if (this.config.provider === 'aliyun') {
        // 处理密钥（如果是******则跳过初始化）
        if (this.config.accessKeySecret === '******') {
          logger.warn('OSS密钥被隐藏，无法初始化');
          this.isLocal = true;
          return false;
        }
        
        // 创建OSS客户端
        this.client = new OSS({
          region: this.config.region,
          accessKeyId: this.config.accessKeyId,
          accessKeySecret: this.config.accessKeySecret,
          bucket: this.config.bucket,
          secure: true,
          timeout: 60000
        });
        
        this.isLocal = false;
        
        logger.info('阿里云OSS客户端初始化成功', {
          bucket: this.config.bucket,
          region: this.config.region
        });
      }
      
      return true;
    } catch (error) {
      logger.error('初始化OSS客户端失败:', error);
      this.isLocal = true;
      return false;
    }
  }

  /**
   * 生成唯一的OSS对象键
   */
  generateOSSKey(userId, fileName, folderId = null) {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const random = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(fileName);
    
    // 构建路径: users/{userId}/{year}/{month}/{folderId}/{timestamp}_{random}{ext}
    let filePath = `users/${userId}/${year}/${month}`;
    if (folderId) {
      filePath += `/${folderId}`;
    }
    
    return `${filePath}/${Date.now()}_${random}${ext}`;
  }

  /**
   * 上传文件
   */
  async uploadFile(buffer, ossKey, options = {}) {
    if (!this.client && !this.isLocal) {
      await this.initialize();
    }
    
    try {
      if (this.isLocal) {
        // 本地存储
        return await this.uploadToLocal(buffer, ossKey);
      } else {
        // OSS存储
        return await this.uploadToOSS(buffer, ossKey, options);
      }
    } catch (error) {
      logger.error('文件上传失败:', error);
      throw error;
    }
  }

  /**
   * 上传到本地存储
   */
  async uploadToLocal(buffer, ossKey) {
    try {
      const localPath = path.join('/var/www/ai-platform/storage/uploads', ossKey);
      const dir = path.dirname(localPath);
      
      // 创建目录
      await fs.mkdir(dir, { recursive: true });
      
      // 写入文件
      await fs.writeFile(localPath, buffer);
      
      // 生成访问URL
      const url = `https://ai.xingyuncl.com/storage/uploads/${ossKey}`;
      
      logger.info('文件已保存到本地存储', { path: localPath });
      
      return {
        success: true,
        ossKey: ossKey,
        url: url,
        isLocal: true
      };
    } catch (error) {
      logger.error('本地存储失败:', error);
      throw error;
    }
  }

  /**
   * 上传到阿里云OSS
   */
  async uploadToOSS(buffer, ossKey, options = {}) {
    if (!this.client) {
      throw new Error('OSS客户端未初始化');
    }
    
    try {
      const result = await this.client.put(ossKey, buffer, options);
      
      // 生成访问URL
      let url = result.url;
      if (this.config.customDomain) {
        // 使用自定义域名
        url = `${this.config.customDomain}/${ossKey}`;
      }
      
      return {
        success: true,
        ossKey: ossKey,
        url: url,
        etag: result.res.headers.etag,
        isLocal: false
      };
    } catch (error) {
      logger.error('上传到OSS失败:', error);
      throw error;
    }
  }

  /**
   * 删除文件
   */
  async deleteFile(ossKey) {
    if (!this.client && !this.isLocal) {
      await this.initialize();
    }
    
    try {
      if (this.isLocal) {
        // 本地存储删除
        const localPath = path.join('/var/www/ai-platform/storage/uploads', ossKey);
        await fs.unlink(localPath);
        logger.info('本地文件删除成功', { path: localPath });
      } else if (this.client) {
        // OSS删除
        await this.client.delete(ossKey);
        logger.info('OSS文件删除成功', { ossKey });
      }
      
      return true;
    } catch (error) {
      logger.error('删除文件失败:', error);
      // 文件不存在时不抛出错误
      if (error.code === 'ENOENT' || error.code === 'NoSuchKey') {
        return true;
      }
      throw error;
    }
  }

  /**
   * 批量删除文件
   */
  async deleteFiles(ossKeys) {
    if (!this.client && !this.isLocal) {
      await this.initialize();
    }
    
    try {
      if (this.isLocal) {
        // 本地批量删除
        for (const key of ossKeys) {
          await this.deleteFile(key);
        }
      } else if (this.client) {
        // OSS批量删除
        const result = await this.client.deleteMulti(ossKeys);
        logger.info('批量删除OSS文件成功', { count: ossKeys.length });
        return result;
      }
      
      return { deleted: ossKeys };
    } catch (error) {
      logger.error('批量删除文件失败:', error);
      throw error;
    }
  }

  /**
   * 生成签名URL（用于临时访问私有文件）
   */
  async generateSignedUrl(ossKey, expires = 3600) {
    if (this.isLocal) {
      // 本地存储直接返回URL
      return `https://ai.xingyuncl.com/storage/uploads/${ossKey}`;
    }
    
    if (!this.client) {
      await this.initialize();
    }
    
    if (!this.client) {
      throw new Error('OSS客户端未初始化');
    }
    
    try {
      const url = this.client.signatureUrl(ossKey, {
        expires: expires
      });
      
      return url;
    } catch (error) {
      logger.error('生成签名URL失败:', error);
      throw error;
    }
  }

  /**
   * 生成缩略图URL（阿里云OSS图片处理）
   */
  generateThumbnailUrl(url, width = 200, height = 200) {
    if (!url) return null;
    
    // 如果是本地存储，暂不支持缩略图
    if (this.isLocal || url.includes('/storage/uploads/')) {
      return url;
    }
    
    // 阿里云OSS图片处理参数
    const process = `x-oss-process=image/resize,m_fill,h_${height},w_${width}`;
    
    if (url.includes('?')) {
      return `${url}&${process}`;
    } else {
      return `${url}?${process}`;
    }
  }

  /**
   * 检查文件是否存在
   */
  async fileExists(ossKey) {
    if (!this.client && !this.isLocal) {
      await this.initialize();
    }
    
    try {
      if (this.isLocal) {
        // 检查本地文件
        const localPath = path.join('/var/www/ai-platform/storage/uploads', ossKey);
        await fs.access(localPath);
        return true;
      } else if (this.client) {
        // 检查OSS文件
        await this.client.head(ossKey);
        return true;
      }
      
      return false;
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'NoSuchKey') {
        return false;
      }
      throw error;
    }
  }

  /**
   * 获取文件元数据
   */
  async getFileMetadata(ossKey) {
    if (!this.client && !this.isLocal) {
      await this.initialize();
    }
    
    try {
      if (this.isLocal) {
        // 获取本地文件信息
        const localPath = path.join('/var/www/ai-platform/storage/uploads', ossKey);
        const stats = await fs.stat(localPath);
        return {
          'content-length': stats.size,
          'last-modified': stats.mtime.toISOString()
        };
      } else if (this.client) {
        // 获取OSS文件信息
        const result = await this.client.head(ossKey);
        return result.res.headers;
      }
      
      return null;
    } catch (error) {
      logger.error('获取文件元数据失败:', error);
      throw error;
    }
  }

  /**
   * 复制文件
   */
  async copyFile(sourceKey, targetKey) {
    if (!this.client && !this.isLocal) {
      await this.initialize();
    }
    
    try {
      if (this.isLocal) {
        // 本地文件复制
        const sourcePath = path.join('/var/www/ai-platform/storage/uploads', sourceKey);
        const targetPath = path.join('/var/www/ai-platform/storage/uploads', targetKey);
        const targetDir = path.dirname(targetPath);
        
        await fs.mkdir(targetDir, { recursive: true });
        await fs.copyFile(sourcePath, targetPath);
        
        return { success: true };
      } else if (this.client) {
        // OSS文件复制
        const result = await this.client.copy(targetKey, sourceKey);
        return result;
      }
      
      return null;
    } catch (error) {
      logger.error('复制文件失败:', error);
      throw error;
    }
  }
}

module.exports = new OSSService();

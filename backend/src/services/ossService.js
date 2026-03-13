/**
 * OSS存储服务（单例模式）
 * 
 * 职责：
 * 1. 文件上传/删除/复制/元数据查询
 * 2. 签名URL生成（临时访问私有文件）
 * 3. 缩略图URL生成（阿里云OSS图片处理）
 * 
 * 双模式支持：
 * - 阿里云OSS：从 system_settings 表读取配置
 * - 本地存储：默认模式，文件存储到 config.storage.paths.uploads
 * 
 * 路径说明：
 * - 所有本地路径通过 config.storage.paths.uploads 获取，兼容 Docker 和 PM2
 * - URL 通过 config.app.domain 生成，不硬编码域名
 */

const OSS = require('ali-oss');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const dbConnection = require('../database/connection');
const config = require('../config');
const logger = require('../utils/logger');

class OSSService {
  constructor() {
    this.client = null;
    this.config = null;
    this.isLocal = true;
    this.initialized = false;
  }

  /**
   * 获取本地存储根路径（统一从 config 读取）
   * @returns {string} 本地存储路径
   */
  _getLocalStoragePath() {
    return config.storage.paths.uploads;
  }

  /**
   * 获取文件的完整本地路径
   * @param {string} ossKey - 文件的 OSS key（相对路径）
   * @returns {string} 完整的本地磁盘路径
   */
  _getLocalFilePath(ossKey) {
    return path.join(this._getLocalStoragePath(), ossKey);
  }

  /**
   * 生成本地文件的公开访问 URL
   * @param {string} ossKey - 文件的 OSS key（相对路径）
   * @returns {string} 完整的 URL
   */
  _buildLocalUrl(ossKey) {
    const protocol = config.app.env === 'production' ? 'https' : 'http';
    const domain = config.app.domain;
    return `${protocol}://${domain}/uploads/${ossKey}`;
  }

  /**
   * 初始化OSS客户端
   * 从 system_settings 表读取配置，决定使用 OSS 还是本地存储
   * 
   * @returns {boolean} 初始化是否成功
   */
  async initialize() {
    // 避免重复初始化
    if (this.initialized) {
      return true;
    }

    try {
      const sql = `
        SELECT setting_value 
        FROM system_settings 
        WHERE setting_key = 'oss_config'
      `;

      const { rows } = await dbConnection.query(sql);

      if (rows.length === 0 || !rows[0].setting_value) {
        logger.info('未找到OSS配置，使用本地存储');
        this.isLocal = true;
        this.initialized = true;
        return true;
      }

      this.config = JSON.parse(rows[0].setting_value);

      if (!this.config.enabled || this.config.provider === 'local') {
        logger.info('OSS未启用或使用本地存储');
        this.isLocal = true;
        this.initialized = true;
        return true;
      }

      if (this.config.provider === 'aliyun') {
        // 密钥被掩码时跳过初始化
        if (this.config.accessKeySecret === '******') {
          logger.warn('OSS密钥被隐藏，无法初始化，降级为本地存储');
          this.isLocal = true;
          this.initialized = true;
          return false;
        }

        this.client = new OSS({
          region: this.config.region,
          accessKeyId: this.config.accessKeyId,
          accessKeySecret: this.config.accessKeySecret,
          bucket: this.config.bucket,
          secure: true,
          timeout: 60000
        });

        this.isLocal = false;
        this.initialized = true;

        logger.info('阿里云OSS客户端初始化成功', {
          bucket: this.config.bucket,
          region: this.config.region
        });
      }

      return true;
    } catch (error) {
      logger.error('初始化OSS客户端失败:', error);
      this.isLocal = true;
      this.initialized = true;
      return false;
    }
  }

  /**
   * 确保已初始化（内部方法，操作前调用）
   */
  async _ensureInitialized() {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * 生成唯一的OSS对象键
   * 格式：users/{userId}/{year}/{month}/{folderId?}/{timestamp}_{random}{ext}
   * 
   * @param {number} userId - 用户ID
   * @param {string} fileName - 原始文件名
   * @param {number|null} folderId - 文件夹ID（可选）
   * @returns {string} OSS key
   */
  generateOSSKey(userId, fileName, folderId = null) {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const random = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(fileName);

    let filePath = `users/${userId}/${year}/${month}`;
    if (folderId) {
      filePath += `/${folderId}`;
    }

    return `${filePath}/${Date.now()}_${random}${ext}`;
  }

  /**
   * 上传文件（自动选择 OSS 或本地存储）
   * 
   * @param {Buffer} buffer - 文件内容
   * @param {string} ossKey - 文件的 OSS key
   * @param {Object} options - 上传选项（headers 等）
   * @returns {Object} { success, ossKey, url, isLocal }
   */
  async uploadFile(buffer, ossKey, options = {}) {
    await this._ensureInitialized();

    try {
      if (this.isLocal) {
        return await this.uploadToLocal(buffer, ossKey);
      } else {
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
      const localPath = this._getLocalFilePath(ossKey);
      const dir = path.dirname(localPath);

      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(localPath, buffer);

      const url = this._buildLocalUrl(ossKey);

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

      let url = result.url;
      if (this.config.customDomain) {
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
   * 
   * @param {string} ossKey - 文件的 OSS key
   * @returns {boolean} 是否删除成功
   */
  async deleteFile(ossKey) {
    await this._ensureInitialized();

    try {
      if (this.isLocal) {
        const localPath = this._getLocalFilePath(ossKey);
        await fs.unlink(localPath);
        logger.info('本地文件删除成功', { path: localPath });
      } else if (this.client) {
        await this.client.delete(ossKey);
        logger.info('OSS文件删除成功', { ossKey });
      }

      return true;
    } catch (error) {
      logger.error('删除文件失败:', error);
      // 文件不存在时不报错
      if (error.code === 'ENOENT' || error.code === 'NoSuchKey') {
        return true;
      }
      throw error;
    }
  }

  /**
   * 批量删除文件
   * 
   * @param {string[]} ossKeys - OSS key 数组
   * @returns {Object} 删除结果
   */
  async deleteFiles(ossKeys) {
    await this._ensureInitialized();

    try {
      if (this.isLocal) {
        for (const key of ossKeys) {
          await this.deleteFile(key);
        }
      } else if (this.client) {
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
   * 
   * @param {string} ossKey - 文件的 OSS key
   * @param {number} expires - 过期秒数（默认1小时）
   * @returns {string} 签名URL
   */
  async generateSignedUrl(ossKey, expires = 3600) {
    if (this.isLocal) {
      return this._buildLocalUrl(ossKey);
    }

    await this._ensureInitialized();

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
   * 本地存储不支持缩略图，返回原图
   * 
   * @param {string} url - 原始文件URL
   * @param {number} width - 缩略图宽度
   * @param {number} height - 缩略图高度
   * @returns {string} 缩略图URL
   */
  generateThumbnailUrl(url, width = 200, height = 200) {
    if (!url) return null;

    // 本地存储暂不支持缩略图
    if (this.isLocal || url.includes('/uploads/')) {
      return url;
    }

    const process = `x-oss-process=image/resize,m_fill,h_${height},w_${width}`;

    if (url.includes('?')) {
      return `${url}&${process}`;
    } else {
      return `${url}?${process}`;
    }
  }

  /**
   * 检查文件是否存在
   * 
   * @param {string} ossKey - 文件的 OSS key
   * @returns {boolean} 文件是否存在
   */
  async fileExists(ossKey) {
    await this._ensureInitialized();

    try {
      if (this.isLocal) {
        const localPath = this._getLocalFilePath(ossKey);
        await fs.access(localPath);
        return true;
      } else if (this.client) {
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
   * 
   * @param {string} ossKey - 文件的 OSS key
   * @returns {Object|null} 文件元数据
   */
  async getFileMetadata(ossKey) {
    await this._ensureInitialized();

    try {
      if (this.isLocal) {
        const localPath = this._getLocalFilePath(ossKey);
        const stats = await fs.stat(localPath);
        return {
          'content-length': stats.size,
          'last-modified': stats.mtime.toISOString()
        };
      } else if (this.client) {
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
   * 
   * @param {string} sourceKey - 源文件 OSS key
   * @param {string} targetKey - 目标文件 OSS key
   * @returns {Object|null} 复制结果
   */
  async copyFile(sourceKey, targetKey) {
    await this._ensureInitialized();

    try {
      if (this.isLocal) {
        const sourcePath = this._getLocalFilePath(sourceKey);
        const targetPath = this._getLocalFilePath(targetKey);
        const targetDir = path.dirname(targetPath);

        await fs.mkdir(targetDir, { recursive: true });
        await fs.copyFile(sourcePath, targetPath);

        return { success: true };
      } else if (this.client) {
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

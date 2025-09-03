/**
 * 图片生成服务 - 处理Gemini等模型生成的图片
 * 支持OpenRouter API格式和OSS存储
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');
const ossService = require('./ossService');
const dbConnection = require('../database/connection');

class ImageGenerationService {
  /**
   * 获取消息对应的用户ID
   * @param {string} messageId - 消息ID
   * @returns {number|null} 用户ID
   */
  static async getUserIdFromMessage(messageId) {
    try {
      // 通过消息ID查找对应的会话和用户
      const sql = `
        SELECT c.user_id 
        FROM messages m
        JOIN conversations c ON m.conversation_id = c.id
        WHERE m.id = ?
        LIMIT 1
      `;
      
      const { rows } = await dbConnection.query(sql, [messageId]);
      
      if (rows.length > 0) {
        return rows[0].user_id;
      }
      
      logger.warn('无法找到消息对应的用户ID', { messageId });
      return null;
    } catch (error) {
      logger.error('获取用户ID失败:', error);
      return null;
    }
  }

  /**
   * 处理OpenRouter格式的图片响应
   * @param {Object} response - API响应
   * @param {string} messageId - 消息ID
   * @returns {Object} 包含文本和图片信息
   */
  static async processOpenRouterImageResponse(response, messageId) {
    try {
      const result = {
        content: '',
        images: []
      };

      // 检查OpenRouter格式的响应
      if (response.choices && response.choices[0]) {
        const message = response.choices[0].message;
        
        // 提取文本内容
        if (message.content) {
          result.content = message.content;
        }
        
        // 提取图片（OpenRouter格式）
        if (message.images && Array.isArray(message.images)) {
          logger.info('发现OpenRouter格式的图片数据', {
            messageId,
            imageCount: message.images.length
          });
          
          // 获取用户ID用于隔离存储
          const userId = await this.getUserIdFromMessage(messageId);
          if (!userId) {
            logger.warn('无法获取用户ID，使用默认目录');
          }
          
          for (let i = 0; i < message.images.length; i++) {
            const imageData = message.images[i];
            
            // OpenRouter返回的格式是: { type: "image_url", image_url: { url: "data:..." } }
            let imageUrl = null;
            
            // 主要格式：嵌套的image_url对象
            if (imageData && imageData.image_url && imageData.image_url.url) {
              imageUrl = imageData.image_url.url;
              logger.info(`找到第${i+1}张图片（嵌套格式）`);
            }
            // 备用格式1: 直接的url字段
            else if (imageData && imageData.url) {
              imageUrl = imageData.url;
              logger.info(`找到第${i+1}张图片（直接url格式）`);
            }
            // 备用格式2: 直接是字符串
            else if (typeof imageData === 'string') {
              imageUrl = imageData;
              logger.info(`找到第${i+1}张图片（字符串格式）`);
            }
            
            if (imageUrl) {
              logger.info(`处理图片数据`, {
                imageIndex: i + 1,
                urlPrefix: imageUrl.substring(0, 50),
                urlLength: imageUrl.length
              });
              
              if (imageUrl.startsWith('data:image')) {
                // 提取Base64数据
                const base64Match = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
                if (base64Match) {
                  const mimeType = `image/${base64Match[1]}`;
                  const base64Data = base64Match[2];
                  
                  logger.info('正在保存Base64图片', {
                    mimeType,
                    dataLength: base64Data.length
                  });
                  
                  try {
                    // 保存图片（使用OSS服务）
                    const savedImage = await this.saveGeneratedImage(
                      base64Data,
                      mimeType,
                      messageId,
                      userId
                    );
                    
                    if (savedImage) {
                      result.images.push(savedImage);
                      logger.info('图片保存成功', savedImage);
                    }
                  } catch (saveError) {
                    logger.error('保存单张图片失败', {
                      error: saveError.message,
                      stack: saveError.stack
                    });
                  }
                } else {
                  logger.warn('Base64格式匹配失败');
                }
              } else if (imageUrl.startsWith('http')) {
                // 如果是HTTP URL，直接记录
                result.images.push({
                  url: imageUrl,
                  filename: `external_${i}.png`,
                  mime_type: 'image/png'
                });
                logger.info('记录外部图片URL', { url: imageUrl });
              }
            } else {
              logger.warn(`第${i+1}张图片没有找到有效的URL`, {
                imageDataKeys: imageData ? Object.keys(imageData) : null
              });
            }
          }
          
          logger.info('OpenRouter图片处理完成', {
            totalImages: message.images.length,
            savedImages: result.images.length
          });
        }
      }

      return result;
    } catch (error) {
      logger.error('处理OpenRouter图片响应失败:', {
        error: error.message,
        stack: error.stack
      });
      return { content: '', images: [] };
    }
  }

  /**
   * 处理Gemini响应中的图片数据（原始Gemini格式）
   * @param {Object} response - Gemini API响应
   * @param {string} messageId - 消息ID
   * @returns {Object} 包含文本和图片信息
   */
  static async processGeminiImageResponse(response, messageId) {
    try {
      const result = {
        content: '',
        images: []
      };

      // 检查响应格式
      if (!response.candidates || !response.candidates[0]) {
        return result;
      }

      const candidate = response.candidates[0];
      if (!candidate.content || !candidate.content.parts) {
        return result;
      }

      // 获取用户ID用于隔离存储
      const userId = await this.getUserIdFromMessage(messageId);
      if (!userId) {
        logger.warn('无法获取用户ID，使用默认目录');
      }

      // 遍历parts，提取文本和图片
      for (const part of candidate.content.parts) {
        // 文本部分
        if (part.text) {
          result.content += part.text;
        }
        
        // 图片部分（inline_data）
        if (part.inline_data) {
          try {
            const imageInfo = await this.saveGeneratedImage(
              part.inline_data.data,
              part.inline_data.mime_type || 'image/png',
              messageId,
              userId
            );
            
            if (imageInfo) {
              result.images.push(imageInfo);
            }
          } catch (error) {
            logger.error('保存生成的图片失败:', error);
          }
        }
      }

      return result;
    } catch (error) {
      logger.error('处理Gemini图片响应失败:', error);
      return { content: '', images: [] };
    }
  }

  /**
   * 保存生成的图片（支持OSS和本地存储）
   * @param {string} base64Data - Base64编码的图片数据
   * @param {string} mimeType - MIME类型
   * @param {string} messageId - 消息ID
   * @param {number} userId - 用户ID（用于隔离存储）
   * @returns {Object} 图片信息
   */
  static async saveGeneratedImage(base64Data, mimeType, messageId, userId = null) {
    try {
      // 确定文件扩展名
      const ext = mimeType.split('/')[1] || 'png';
      const timestamp = Date.now();
      const randomStr = crypto.randomBytes(8).toString('hex');
      const filename = `gen_${messageId}_${timestamp}_${randomStr}.${ext}`;

      // 将Base64转换为Buffer
      const buffer = Buffer.from(base64Data, 'base64');

      // 初始化OSS服务（会自动读取配置）
      await ossService.initialize();

      // 生成OSS key，包含用户隔离路径
      const yearMonth = new Date().toISOString().slice(0, 7).replace('-', '/');
      let ossKey;
      
      if (userId) {
        // 有用户ID，使用用户隔离目录
        ossKey = `generations/user_${userId}/${yearMonth}/${filename}`;
      } else {
        // 没有用户ID，使用共享目录（保持向后兼容）
        ossKey = `generations/shared/${yearMonth}/${filename}`;
      }

      logger.info('准备保存生成的图片', {
        messageId,
        userId,
        filename,
        size: buffer.length,
        ossKey,
        isLocal: ossService.isLocal
      });

      // 使用OSS服务上传（会自动选择OSS或本地存储）
      const uploadResult = await ossService.uploadFile(buffer, ossKey, {
        headers: {
          'Content-Type': mimeType
        }
      });

      if (!uploadResult.success) {
        throw new Error('图片上传失败');
      }

      // 从上传结果中提取URL
      // ossService会根据配置返回正确的URL
      let url = uploadResult.url;
      
      // 如果是本地存储，确保URL路径正确
      if (uploadResult.isLocal) {
        // 本地存储时，ossService返回的是完整的https URL
        // 但为了前端显示，我们需要返回相对路径
        const urlPath = url.replace('https://ai.xingyuncl.com', '');
        url = urlPath;
      }

      logger.info('生成的图片已保存', {
        messageId,
        userId,
        filename,
        size: buffer.length,
        url,
        ossKey,
        isLocal: uploadResult.isLocal
      });

      return {
        filename,
        url,
        size: buffer.length,
        mime_type: mimeType,
        created_at: new Date().toISOString()
      };
    } catch (error) {
      logger.error('保存生成的图片失败:', {
        error: error.message,
        stack: error.stack,
        messageId,
        userId,
        mimeType
      });
      throw error;
    }
  }

  /**
   * 检查模型是否支持图片生成
   * @param {Object} model - AI模型对象
   * @returns {boolean}
   */
  static isImageGenerationModel(model) {
    // 检查数据库标记
    if (model.image_generation_enabled === 1 || model.image_generation_enabled === true) {
      return true;
    }
    
    // 检查模型名称（备用）
    if (model.name && model.name.includes('image-preview')) {
      return true;
    }
    
    return false;
  }
}

module.exports = ImageGenerationService;

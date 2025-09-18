/**
 * OCR服务
 * 处理图片和PDF的文字识别
 * 使用Mistral OCR API
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const dbConnection = require('../database/connection');
const logger = require('../utils/logger');
const ossService = require('./ossService');
const User = require('../models/User');

class OCRService {
  constructor() {
    this.apiKey = null;
    this.model = 'mistral-ocr-latest';
    this.initialized = false;
  }

  /**
   * 初始化OCR服务
   */
  async initialize() {
    try {
      // 获取OCR配置
      const query = `
        SELECT setting_key, setting_value 
        FROM system_settings 
        WHERE setting_key LIKE 'ocr.%'
      `;
      
      const result = await dbConnection.query(query);
      const settings = {};
      
      result.rows.forEach(row => {
        const key = row.setting_key.replace('ocr.', '');
        settings[key] = row.setting_value;
      });
      
      this.apiKey = settings.mistral_api_key || process.env.MISTRAL_API_KEY;
      this.model = settings.mistral_model || 'mistral-ocr-latest';
      
      if (!this.apiKey) {
        logger.warn('Mistral API密钥未配置');
        return false;
      }
      
      this.initialized = true;
      logger.info('OCR服务初始化成功');
      return true;
    } catch (error) {
      logger.error('OCR服务初始化失败:', error);
      return false;
    }
  }

  /**
   * 获取OCR配置
   */
  async getConfig() {
    // 先初始化以获取最新的API密钥状态
    await this.initialize();
    
    const query = `
      SELECT setting_key, setting_value 
      FROM system_settings 
      WHERE setting_key LIKE 'ocr.%'
    `;
    
    const result = await dbConnection.query(query);
    const config = {};
    
    result.rows.forEach(row => {
      const key = row.setting_key.replace('ocr.', '');
      if (key !== 'mistral_api_key') { // 不返回API密钥
        config[key] = row.setting_value;
      }
    });
    
    config.has_api_key = !!this.apiKey;
    return config;
  }

  /**
   * 处理图片OCR
   */
  async processImage(userId, file, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    if (!this.apiKey) {
      throw new Error('OCR服务未配置API密钥');
    }
    
    const startTime = Date.now();
    let taskId = null;
    
    try {
      // 创建OCR任务记录
      taskId = await this.createTask(userId, {
        task_type: 'image',
        file_name: file.originalname,
        file_size: file.size,
        file_type: file.mimetype
      });
      
      // 转换文件为Base64
      const base64Data = file.buffer.toString('base64');
      const mimeType = file.mimetype;
      
      // 调用Mistral OCR API
      const ocrResult = await this.callMistralOCR(base64Data, mimeType, 'image');
      
      // 保存文件到OSS（可选，用于历史记录）
      const fileUrl = await this.saveFile(userId, file, taskId);
      await this.updateTask(taskId, { file_url: fileUrl });
      
      // 保存识别结果
      await this.saveResult(taskId, {
        recognized_text: ocrResult.text,
        markdown_content: ocrResult.markdown,
        confidence_score: ocrResult.confidence,
        metadata: ocrResult.metadata
      });
      
      // 计算并扣除积分
      const creditsConsumed = await this.consumeCredits(userId, 'image', 1);
      
      // 更新任务状态
      const processingTime = Date.now() - startTime;
      await this.updateTask(taskId, {
        status: 'completed',
        credits_consumed: creditsConsumed,
        processing_time: processingTime
      });
      
      // 返回结果
      return {
        success: true,
        taskId,
        text: ocrResult.text,
        markdown: ocrResult.markdown,
        creditsConsumed,
        processingTime
      };
      
    } catch (error) {
      logger.error('图片OCR处理失败:', error);
      
      // 更新任务状态为失败
      if (taskId) {
        await this.updateTask(taskId, {
          status: 'failed',
          error_message: error.message,
          processing_time: Date.now() - startTime
        });
      }
      
      throw error;
    }
  }

  /**
   * 处理PDF OCR
   */
  async processPDF(userId, file, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    if (!this.apiKey) {
      throw new Error('OCR服务未配置API密钥');
    }
    
    const startTime = Date.now();
    let taskId = null;
    
    try {
      // 创建OCR任务记录
      taskId = await this.createTask(userId, {
        task_type: 'pdf',
        file_name: file.originalname,
        file_size: file.size,
        file_type: file.mimetype,
        page_count: options.pageCount || 1
      });
      
      // 转换PDF为Base64
      const base64Data = file.buffer.toString('base64');
      
      // 调用Mistral OCR API
      const ocrResult = await this.callMistralOCR(base64Data, 'application/pdf', 'pdf');
      
      // 保存文件到OSS（可选）
      const fileUrl = await this.saveFile(userId, file, taskId);
      await this.updateTask(taskId, { file_url: fileUrl });
      
      // 保存识别结果
      await this.saveResult(taskId, {
        recognized_text: ocrResult.text,
        markdown_content: ocrResult.markdown,
        confidence_score: ocrResult.confidence,
        metadata: ocrResult.metadata
      });
      
      // 计算并扣除积分（按页数计算）
      const pageCount = ocrResult.pageCount || 1;
      const creditsConsumed = await this.consumeCredits(userId, 'pdf', pageCount);
      
      // 更新任务状态
      const processingTime = Date.now() - startTime;
      await this.updateTask(taskId, {
        status: 'completed',
        credits_consumed: creditsConsumed,
        processing_time: processingTime,
        page_count: pageCount
      });
      
      // 返回结果
      return {
        success: true,
        taskId,
        pageCount,
        text: ocrResult.text,
        markdown: ocrResult.markdown,
        creditsConsumed,
        processingTime
      };
      
    } catch (error) {
      logger.error('PDF OCR处理失败:', error);
      
      // 更新任务状态为失败
      if (taskId) {
        await this.updateTask(taskId, {
          status: 'failed',
          error_message: error.message,
          processing_time: Date.now() - startTime
        });
      }
      
      throw error;
    }
  }

  /**
   * 调用Mistral OCR API
   */
  async callMistralOCR(base64Data, mimeType, fileType) {
    try {
      // 构建文档对象 - 根据官方API文档格式
      let document = {};
      
      if (fileType === 'pdf') {
        // PDF使用document_url格式
        document = {
          type: "document_url",
          document_url: `data:${mimeType};base64,${base64Data}`
        };
      } else {
        // 图片使用image_url格式
        document = {
          type: "image_url", 
          image_url: `data:${mimeType};base64,${base64Data}`
        };
      }
      
      // 准备请求体 - 根据官方API文档
      const requestBody = {
        model: this.model,
        document: document
      };
      
      logger.info('调用Mistral OCR API，端点: /v1/ocr');
      
      // 调用Mistral OCR API - 使用正确的端点
      const response = await axios.post(
        'https://api.mistral.ai/v1/ocr',  // 修正端点
        requestBody,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 120000 // 120秒超时，PDF可能需要更长时间
        }
      );
      
      // 处理响应 - 根据官方API响应格式
      const result = response.data;
      logger.info('OCR API响应成功');
      
      // 调试：记录响应结构
      logger.debug('OCR API响应结构:', {
        hasPages: !!result.pages,
        pagesLength: result.pages?.length,
        firstPageKeys: result.pages?.[0] ? Object.keys(result.pages[0]) : null,
        hasDocumentAnnotation: !!result.document_annotation
      });
      
      // 提取文本内容
      let text = '';
      let markdown = '';
      let pageCount = 1;
      
      // 根据官方API文档，响应格式包含 pages 数组
      if (result.pages && Array.isArray(result.pages)) {
        // 处理页面数组
        pageCount = result.pages.length;
        
        // 提取所有页面的文本
        const pageTexts = [];
        const pageMarkdowns = [];
        
        result.pages.forEach((page, index) => {
          // 修复：正确提取页面中的markdown或text字段
          let pageText = '';
          let pageMarkdown = '';
          
          if (page.markdown) {
            pageMarkdown = page.markdown;
            pageText = page.markdown; // 如果没有纯文本，使用markdown
          } else if (page.text) {
            pageText = page.text;
            pageMarkdown = page.text; // 如果没有markdown，使用纯文本
          } else if (page.content) {
            pageText = page.content;
            pageMarkdown = page.content;
          }
          
          // 如果是多页，添加页面标记
          if (result.pages.length > 1) {
            pageTexts.push(`=== Page ${index + 1} ===\n${pageText}`);
            pageMarkdowns.push(`## Page ${index + 1}\n${pageMarkdown}`);
          } else {
            // 单页不需要标记
            pageTexts.push(pageText);
            pageMarkdowns.push(pageMarkdown);
          }
        });
        
        text = pageTexts.join('\n\n');
        markdown = pageMarkdowns.join('\n\n');
        
      } else if (result.document_annotation) {
        // 如果有文档级别的注释
        text = result.document_annotation;
        markdown = result.document_annotation;
      } else {
        // 其他可能的响应格式
        text = result.text || result.content || '';
        markdown = result.markdown || text;
      }
      
      // 确保返回的内容不为空
      if (!text && !markdown) {
        logger.warn('OCR API未返回有效文本内容');
        text = '未能提取到文本内容';
        markdown = '未能提取到文本内容';
      }
      
      return {
        text: text,
        markdown: markdown,
        confidence: null, // Mistral OCR不返回置信度
        pageCount: pageCount,
        metadata: {
          model: result.model || this.model,
          usage_info: result.usage_info || {},
          processing_id: result.id
        }
      };
      
    } catch (error) {
      logger.error('Mistral OCR API调用失败:', {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });
      
      if (error.response?.status === 401) {
        throw new Error('API密钥无效，请检查Mistral API密钥是否正确');
      } else if (error.response?.status === 429) {
        throw new Error('API调用频率限制，请稍后重试');
      } else if (error.response?.status === 413) {
        throw new Error('文件太大（最大50MB）');
      } else if (error.response?.status === 400) {
        const errorMsg = error.response?.data?.detail || error.response?.data?.error?.message || '请求格式错误';
        throw new Error(`请求错误: ${errorMsg}`);
      } else if (error.response?.status === 404) {
        throw new Error('API端点不存在，请检查API版本');
      } else if (error.response?.status === 422) {
        const detail = error.response?.data?.detail;
        if (Array.isArray(detail)) {
          const errorMsg = detail.map(d => d.msg || d.message).join('; ');
          throw new Error(`请求验证失败: ${errorMsg}`);
        }
        throw new Error('请求验证失败');
      } else {
        throw new Error(`OCR处理失败: ${error.response?.data?.detail || error.response?.data?.error?.message || error.message}`);
      }
    }
  }

  /**
   * 保存文件
   */
  async saveFile(userId, file, taskId) {
    await ossService.initialize();
    
    // 生成OSS key
    const ossKey = ossService.generateOSSKey(userId, file.originalname, 'ocr');
    
    // 上传文件
    const uploadResult = await ossService.uploadFile(file.buffer, ossKey, {
      headers: {
        'Content-Type': file.mimetype
      }
    });
    
    if (!uploadResult.success) {
      throw new Error('文件上传失败');
    }
    
    return uploadResult.url;
  }

  /**
   * 创建OCR任务
   */
  async createTask(userId, taskData) {
    const query = `
      INSERT INTO ocr_tasks (
        user_id, task_type, file_name, file_size, 
        file_type, page_count, status
      ) VALUES (?, ?, ?, ?, ?, ?, 'processing')
    `;
    
    const result = await dbConnection.query(query, [
      userId,
      taskData.task_type || 'image',
      taskData.file_name,
      taskData.file_size,
      taskData.file_type,
      taskData.page_count || 1
    ]);
    
    return result.rows.insertId;
  }

  /**
   * 更新任务状态
   */
  async updateTask(taskId, updates) {
    const fields = [];
    const values = [];
    
    Object.keys(updates).forEach(key => {
      fields.push(`${key} = ?`);
      values.push(updates[key]);
    });
    
    values.push(taskId);
    
    const query = `
      UPDATE ocr_tasks 
      SET ${fields.join(', ')}
      WHERE id = ?
    `;
    
    await dbConnection.query(query, values);
  }

  /**
   * 保存OCR结果
   */
  async saveResult(taskId, resultData) {
    const query = `
      INSERT INTO ocr_results (
        task_id, page_number, recognized_text, 
        markdown_content, confidence_score, metadata
      ) VALUES (?, ?, ?, ?, ?, ?)
    `;
    
    await dbConnection.query(query, [
      taskId,
      resultData.page_number || 1,
      resultData.recognized_text,
      resultData.markdown_content,
      resultData.confidence_score,
      JSON.stringify(resultData.metadata || {})
    ]);
  }

  /**
   * 消耗积分
   */
  async consumeCredits(userId, type, count = 1) {
    // 获取积分配置
    const config = await this.getConfig();
    let creditsPerUnit = 0;
    
    if (type === 'image') {
      creditsPerUnit = parseInt(config.credits_per_image || 5);
    } else if (type === 'pdf') {
      creditsPerUnit = parseInt(config.credits_per_pdf_page || 3);
    }
    
    const totalCredits = creditsPerUnit * count;
    
    if (totalCredits > 0) {
      const user = await User.findById(userId);
      // 重要修改：使用正确的transaction_type值 'ocr_consume'
      await user.consumeCredits(
        totalCredits, 
        null, 
        null, 
        `OCR识别(${type})`, 
        'ocr_consume'  // 修改为数据库中已有的枚举值
      );
    }
    
    return totalCredits;
  }

  /**
   * 获取任务详情
   */
  async getTask(taskId, userId = null) {
    let query = `
      SELECT t.*, 
        GROUP_CONCAT(
          JSON_OBJECT(
            'page_number', r.page_number,
            'text', r.recognized_text,
            'markdown', r.markdown_content,
            'confidence', r.confidence_score
          )
        ) as results
      FROM ocr_tasks t
      LEFT JOIN ocr_results r ON t.id = r.task_id
      WHERE t.id = ?
    `;
    
    const params = [taskId];
    
    if (userId) {
      query += ' AND t.user_id = ?';
      params.push(userId);
    }
    
    query += ' GROUP BY t.id';
    
    const result = await dbConnection.query(query, params);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    const task = result.rows[0];
    
    // 解析结果
    if (task.results) {
      try {
        task.results = JSON.parse(`[${task.results}]`);
      } catch (e) {
        task.results = [];
      }
    } else {
      task.results = [];
    }
    
    return task;
  }

  /**
   * 获取用户任务历史 - 修复LIMIT/OFFSET参数问题
   */
  async getUserTasks(userId, options = {}) {
    const { page = 1, limit = 20, status } = options;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;
    
    // 构建基础查询
    let baseQuery = `
      SELECT SQL_CALC_FOUND_ROWS
        t.*,
        (SELECT COUNT(*) FROM ocr_results WHERE task_id = t.id) as result_count
      FROM ocr_tasks t
      WHERE t.user_id = ${dbConnection.pool.escape(userId)}
    `;
    
    // 添加状态过滤（如果提供）
    if (status) {
      baseQuery += ` AND t.status = ${dbConnection.pool.escape(status)}`;
    }
    
    // 添加排序和分页（直接使用数字，避免参数化查询问题）
    baseQuery += ` ORDER BY t.created_at DESC LIMIT ${limitNum} OFFSET ${offset}`;
    
    try {
      // 使用非参数化查询执行（已经通过escape处理了安全问题）
      const connection = await dbConnection.pool.getConnection();
      const [rows] = await connection.query(baseQuery);
      const [countRows] = await connection.query('SELECT FOUND_ROWS() as total');
      connection.release();
      
      return {
        data: rows || [],
        pagination: {
          total: countRows[0]?.total || 0,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil((countRows[0]?.total || 0) / limitNum)
        }
      };
    } catch (error) {
      logger.error('获取任务历史失败:', error);
      // 返回空结果而不是抛出错误
      return {
        data: [],
        pagination: {
          total: 0,
          page: pageNum,
          limit: limitNum,
          pages: 0
        }
      };
    }
  }
}

module.exports = new OCRService();

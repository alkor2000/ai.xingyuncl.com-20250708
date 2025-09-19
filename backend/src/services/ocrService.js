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
      // 修复文件名编码问题
      const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      
      // 创建OCR任务记录
      taskId = await this.createTask(userId, {
        task_type: 'image',
        file_name: fileName,  // 使用修复后的文件名
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
      // 修复文件名编码问题
      const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      
      // 创建OCR任务记录
      taskId = await this.createTask(userId, {
        task_type: 'pdf',
        file_name: fileName,  // 使用修复后的文件名
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
   * 调用Mistral OCR API - 使用Python SDK的API格式
   */
  async callMistralOCR(base64Data, mimeType, fileType) {
    try {
      // 构建文档对象 - 根据官方Python SDK格式
      let requestBody = {
        model: this.model
      };
      
      if (fileType === 'pdf') {
        // PDF使用document格式
        requestBody.document = {
          type: "document_url",
          document_url: `data:${mimeType};base64,${base64Data}`
        };
      } else {
        // 图片使用document格式，但内部是image_url
        requestBody.document = {
          type: "image_url", 
          image_url: `data:${mimeType};base64,${base64Data}`
        };
      }
      
      // 添加额外参数以提高识别质量
      // 注意：include_image_base64 参数可能会增加响应大小
      // requestBody.include_image_base64 = false;  // 不需要返回图片的base64
      
      logger.info('调用Mistral OCR API，模型:', this.model);
      logger.debug('请求体大小:', JSON.stringify(requestBody).length);
      
      // 调用Mistral OCR API
      const response = await axios.post(
        'https://api.mistral.ai/v1/ocr',
        requestBody,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          timeout: 180000, // 180秒超时
          maxBodyLength: Infinity,
          maxContentLength: Infinity
        }
      );
      
      // 处理响应
      const result = response.data;
      logger.info('OCR API响应成功，状态码:', response.status);
      
      // 记录响应结构用于调试
      logger.debug('OCR响应结构:', {
        hasPages: !!result.pages,
        pagesLength: result.pages?.length,
        pageKeys: result.pages?.[0] ? Object.keys(result.pages[0]).slice(0, 5) : null,
        hasText: !!result.text,
        hasMarkdown: !!result.markdown,
        responseKeys: Object.keys(result).slice(0, 10)
      });
      
      // 提取文本内容 - 根据实际响应格式调整
      let text = '';
      let markdown = '';
      let pageCount = 1;
      
      // 方案1：如果直接返回text和markdown字段
      if (result.text || result.markdown) {
        text = result.text || '';
        markdown = result.markdown || result.text || '';
        pageCount = result.page_count || 1;
      }
      // 方案2：如果返回pages数组
      else if (result.pages && Array.isArray(result.pages)) {
        pageCount = result.pages.length;
        
        const pageTexts = [];
        const pageMarkdowns = [];
        
        result.pages.forEach((page, index) => {
          // 尝试多种可能的字段名
          let pageText = '';
          let pageMarkdown = '';
          
          // 优先使用markdown
          if (page.markdown) {
            pageMarkdown = page.markdown;
            pageText = page.text || page.markdown;
          } else if (page.text) {
            pageText = page.text;
            pageMarkdown = page.text;
          } else if (page.content) {
            pageText = page.content;
            pageMarkdown = page.content;
          } else if (typeof page === 'string') {
            // 如果page直接是字符串
            pageText = page;
            pageMarkdown = page;
          }
          
          // 添加页码标记（多页时）
          if (pageCount > 1) {
            pageTexts.push(`【第 ${index + 1} 页】\n${pageText}`);
            pageMarkdowns.push(`## 第 ${index + 1} 页\n\n${pageMarkdown}`);
          } else {
            pageTexts.push(pageText);
            pageMarkdowns.push(pageMarkdown);
          }
        });
        
        text = pageTexts.join('\n\n---\n\n');
        markdown = pageMarkdowns.join('\n\n---\n\n');
      }
      // 方案3：其他格式
      else {
        // 尝试查找任何包含文本的字段
        text = result.content || result.document || JSON.stringify(result, null, 2);
        markdown = result.markdown_content || text;
      }
      
      // 清理识别结果
      text = this.cleanupOCRResult(text);
      markdown = this.cleanupOCRResult(markdown);
      
      // 确保有内容
      if (!text && !markdown) {
        logger.warn('OCR未返回有效内容，原始响应:', JSON.stringify(result).substring(0, 500));
        text = '识别失败：未能提取到文本内容';
        markdown = text;
      }
      
      return {
        text: text,
        markdown: markdown,
        confidence: result.confidence || null,
        pageCount: pageCount,
        metadata: {
          model: result.model || this.model,
          usage: result.usage || {},
          doc_size_bytes: result.doc_size_bytes,
          pages_processed: result.pages_processed || pageCount
        }
      };
      
    } catch (error) {
      logger.error('Mistral OCR API调用失败:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message
      });
      
      if (error.response?.status === 401) {
        throw new Error('API密钥无效，请检查Mistral API密钥是否正确');
      } else if (error.response?.status === 429) {
        throw new Error('API调用频率限制，请稍后重试');
      } else if (error.response?.status === 413) {
        throw new Error('文件太大，最大支持50MB');
      } else if (error.response?.status === 400) {
        const errorMsg = error.response?.data?.message || error.response?.data?.error || '请求格式错误';
        throw new Error(`请求错误: ${errorMsg}`);
      } else if (error.response?.status === 422) {
        throw new Error('请求参数验证失败，请检查文件格式');
      } else {
        throw new Error(`OCR处理失败: ${error.response?.data?.message || error.message}`);
      }
    }
  }

  /**
   * 清理OCR识别结果
   */
  cleanupOCRResult(content) {
    if (!content) return content;
    
    // 移除过多的空行
    content = content.replace(/\n{4,}/g, '\n\n\n');
    
    // 移除只包含分隔符的行
    content = content.replace(/^[-=_*]{3,}$/gm, '---');
    
    // 移除大量重复的空表格
    // 检测连续的空表格行（只包含 | 和空格）
    const lines = content.split('\n');
    const cleanedLines = [];
    let emptyTableCount = 0;
    const maxEmptyTableRows = 3; // 最多保留3行空表格
    
    for (const line of lines) {
      // 检测空表格行
      if (/^\|\s*(\|\s*){2,}$/.test(line.trim())) {
        emptyTableCount++;
        if (emptyTableCount <= maxEmptyTableRows) {
          cleanedLines.push(line);
        }
      } else {
        // 不是空表格行，重置计数
        if (emptyTableCount > maxEmptyTableRows) {
          // 添加省略标记
          cleanedLines.push('... [空表格已省略] ...');
        }
        emptyTableCount = 0;
        cleanedLines.push(line);
      }
    }
    
    return cleanedLines.join('\n').trim();
  }

  /**
   * 保存文件
   */
  async saveFile(userId, file, taskId) {
    await ossService.initialize();
    
    // 修复文件名编码
    const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    
    // 生成OSS key
    const ossKey = ossService.generateOSSKey(userId, fileName, 'ocr');
    
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
      // 使用正确的transaction_type值
      await user.consumeCredits(
        totalCredits, 
        null, 
        null, 
        `OCR识别(${type})`, 
        'ocr_consume'
      );
    }
    
    return totalCredits;
  }

  /**
   * 获取任务详情 - 修复查询方法
   */
  async getTask(taskId, userId = null) {
    try {
      // 先查询任务基本信息
      let taskQuery = `
        SELECT * FROM ocr_tasks WHERE id = ?
      `;
      
      const taskParams = [taskId];
      
      if (userId) {
        taskQuery += ' AND user_id = ?';
        taskParams.push(userId);
      }
      
      const taskResult = await dbConnection.query(taskQuery, taskParams);
      
      if (taskResult.rows.length === 0) {
        return null;
      }
      
      const task = taskResult.rows[0];
      
      // 分别查询结果
      const resultsQuery = `
        SELECT page_number, recognized_text as text, 
               markdown_content as markdown, confidence_score as confidence
        FROM ocr_results 
        WHERE task_id = ?
        ORDER BY page_number
      `;
      
      const resultsResult = await dbConnection.query(resultsQuery, [taskId]);
      
      // 清理结果
      task.results = resultsResult.rows.map(result => ({
        ...result,
        text: this.cleanupOCRResult(result.text),
        markdown: this.cleanupOCRResult(result.markdown)
      }));
      
      // 如果只有一个结果，直接添加到task对象
      if (task.results.length === 1) {
        task.text = task.results[0].text;
        task.markdown = task.results[0].markdown;
      }
      
      return task;
      
    } catch (error) {
      logger.error('获取任务详情失败:', error);
      throw error;
    }
  }

  /**
   * 获取用户任务历史
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
    
    // 添加状态过滤
    if (status) {
      baseQuery += ` AND t.status = ${dbConnection.pool.escape(status)}`;
    }
    
    // 添加排序和分页
    baseQuery += ` ORDER BY t.created_at DESC LIMIT ${limitNum} OFFSET ${offset}`;
    
    try {
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

/**
 * 文档解析服务
 * 
 * 支持解析PDF、Word(.docx)、纯文本/Markdown文档
 * 提取纯文本内容用于后续分块和向量化
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class DocumentParserService {
  /**
   * 解析文档文件，提取纯文本
   * @param {string} filePath - 文件绝对路径
   * @param {string} originalName - 原始文件名（用于判断类型）
   * @returns {Object} { content: string, pageCount: number, charCount: number }
   */
  static async parseFile(filePath, originalName) {
    const ext = path.extname(originalName || filePath).toLowerCase();

    logger.info('开始解析文档', { filePath, originalName, ext });

    switch (ext) {
      case '.pdf':
        return await DocumentParserService.parsePDF(filePath);
      case '.docx':
        return await DocumentParserService.parseDocx(filePath);
      case '.txt':
      case '.md':
      case '.markdown':
        return await DocumentParserService.parseText(filePath);
      default:
        throw new Error(`不支持的文件格式: ${ext}，支持 PDF、Word(.docx)、TXT、Markdown`);
    }
  }

  /**
   * 解析PDF文件
   * @param {string} filePath - PDF文件路径
   * @returns {Object} { content, pageCount, charCount }
   */
  static async parsePDF(filePath) {
    try {
      const pdfParse = require('pdf-parse');
      const buffer = fs.readFileSync(filePath);
      const data = await pdfParse(buffer);

      const content = data.text || '';
      /* 清理多余空白 */
      const cleaned = content
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      logger.info('PDF解析成功', {
        pages: data.numpages,
        charCount: cleaned.length
      });

      return {
        content: cleaned,
        pageCount: data.numpages || 0,
        charCount: cleaned.length
      };
    } catch (error) {
      logger.error('PDF解析失败:', error);
      throw new Error(`PDF解析失败: ${error.message}`);
    }
  }

  /**
   * 解析Word文档(.docx)
   * @param {string} filePath - docx文件路径
   * @returns {Object} { content, pageCount, charCount }
   */
  static async parseDocx(filePath) {
    try {
      const mammoth = require('mammoth');
      const buffer = fs.readFileSync(filePath);
      const result = await mammoth.extractRawText({ buffer });

      const content = (result.value || '')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      logger.info('Word文档解析成功', { charCount: content.length });

      return {
        content: content,
        pageCount: 0, /* Word无法直接获取页数 */
        charCount: content.length
      };
    } catch (error) {
      logger.error('Word文档解析失败:', error);
      throw new Error(`Word文档解析失败: ${error.message}`);
    }
  }

  /**
   * 解析纯文本/Markdown文件
   * @param {string} filePath - 文件路径
   * @returns {Object} { content, pageCount, charCount }
   */
  static async parseText(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
        .replace(/\r\n/g, '\n')
        .trim();

      logger.info('文本文件解析成功', { charCount: content.length });

      return {
        content: content,
        pageCount: 0,
        charCount: content.length
      };
    } catch (error) {
      logger.error('文本文件解析失败:', error);
      throw new Error(`文本文件解析失败: ${error.message}`);
    }
  }

  /**
   * 从Buffer解析文档（用于内存中的文件，如multer memoryStorage）
   * @param {Buffer} buffer - 文件buffer
   * @param {string} originalName - 原始文件名
   * @returns {Object} { content, pageCount, charCount }
   */
  static async parseBuffer(buffer, originalName) {
    const ext = path.extname(originalName).toLowerCase();

    switch (ext) {
      case '.pdf': {
        const pdfParse = require('pdf-parse');
        const data = await pdfParse(buffer);
        const content = (data.text || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        return { content, pageCount: data.numpages || 0, charCount: content.length };
      }
      case '.docx': {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ buffer });
        const content = (result.value || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        return { content, pageCount: 0, charCount: content.length };
      }
      case '.txt':
      case '.md':
      case '.markdown': {
        const content = buffer.toString('utf-8').replace(/\r\n/g, '\n').trim();
        return { content, pageCount: 0, charCount: content.length };
      }
      default:
        throw new Error(`不支持的文件格式: ${ext}`);
    }
  }
}

module.exports = DocumentParserService;

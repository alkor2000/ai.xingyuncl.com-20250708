/**
 * 流式AI服务 - 增强PDF和多图支持版本
 * 
 * v2.0：processMessagesForOpenRouter/Standard 支持多图数组
 * v3.0：callStreamAPI 支持 enableThinking 参数控制 OpenRouter 推理输出
 * v4.0：SSE心跳保活机制 + 上游超时延长至300秒
 * v5.0：PDF base64 内嵌支持，修复 OneAPI 中转 Gemini 时 PDF 退化问题
 * 
 * v5.1 变更（2026-05-18 性能优化）：
 *   - 单请求内 PDF base64 缓存：同一 PDF 多次出现只读取/编码一次
 *   - 配合 MessageService v3.0 的"PDF 最后一次出现保留"算法
 *   - 即使在缓存失效场景，缓存机制也能容错
 * 
 * v5.2 变更（2026-05-20 图像生成模型防呆保护）：
 *   - sendStreamMessage 入口检测图像生成模型并直接拒绝
 *   - 流式链路不支持图像生成（不发 modalities、不解析 images 字段）
 *   - 图像生成模型必须走非流式（stream_enabled=0），否则会返回空响应
 *   - 此保护把"配置错误导致的诡异空响应"转为"清晰的错误提示"
 *     防止管理员误开图像模型流式开关后难以排查
 */

const axios = require('axios');
const path = require('path');
const fs = require('fs').promises;
const AIModel = require('../models/AIModel');
const ImageGenerationService = require('./imageGenerationService');
const config = require('../config');
const logger = require('../utils/logger');
const { ExternalServiceError } = require('../utils/errors');

/** SSE心跳间隔（毫秒）*/
const SSE_HEARTBEAT_INTERVAL_MS = 15000;

/** 上游AI API请求超时（毫秒）*/
const UPSTREAM_API_TIMEOUT_MS = 300000;

/** PDF 文件 base64 编码后的最大尺寸（30MB）*/
const MAX_PDF_BASE64_BYTES = 30 * 1024 * 1024;

class AIStreamService {
  /** 解析Azure配置字符串 */
  static parseAzureConfig(configString) {
    const parts = configString.split('|');
    if (parts.length === 3) {
      return { apiKey: parts[0].trim(), endpoint: parts[1].trim(), apiVersion: parts[2].trim() };
    }
    return null;
  }

  /** 检测是否为Azure配置 */
  static isAzureConfig(model) {
    if (model.provider === 'azure' || model.provider === 'azure-openai') return true;
    if (model.api_key && model.api_key.includes('|')) {
      if (model.api_key.split('|').length === 3) return true;
    }
    if (model.api_endpoint === 'azure' || model.api_endpoint === 'use-from-key') return true;
    return false;
  }

  /** 判断是否为OpenRouter端点 */
  static isOpenRouterEndpoint(endpoint) {
    return endpoint && endpoint.includes('openrouter');
  }

  /** 判断文件是否为PDF */
  static isPDFFile(fileInfo) {
    if (!fileInfo) return false;
    if (fileInfo.mime_type === 'application/pdf') return true;
    if (fileInfo.url && fileInfo.url.toLowerCase().endsWith('.pdf')) return true;
    if (fileInfo.original_name && fileInfo.original_name.toLowerCase().endsWith('.pdf')) return true;
    return false;
  }

  /** 构建图片 content 块数组 */
  static _buildImageContentBlocks(urls) {
    if (!urls || urls.length === 0) return [];
    return urls.map(url => ({ type: 'image_url', image_url: { url: url } }));
  }

  /**
   * 构建 PDF 的 content 块（base64 内嵌格式）
   * v5.1: 增加 pdfCache 参数支持单请求内缓存
   */
  static async _buildPDFContentBlock(fileInfo, pdfCache = null) {
    try {
      if (!fileInfo || !fileInfo.file_path) {
        logger.warn('PDF文件信息不完整，缺少 file_path 字段', { fileInfo });
        return null;
      }

      // 缓存命中
      if (pdfCache && pdfCache.has(fileInfo.file_path)) {
        const cached = pdfCache.get(fileInfo.file_path);
        logger.info('流式：PDF base64 缓存命中', {
          file_path: fileInfo.file_path,
          original_name: fileInfo.original_name
        });
        return {
          type: 'file',
          file: { ...cached.file }
        };
      }

      try {
        await fs.access(fileInfo.file_path);
      } catch (e) {
        logger.error('PDF文件不存在或无权访问', {
          file_path: fileInfo.file_path,
          original_name: fileInfo.original_name
        });
        return null;
      }

      const stats = await fs.stat(fileInfo.file_path);
      if (stats.size > MAX_PDF_BASE64_BYTES) {
        logger.warn('PDF文件过大，无法 base64 编码发送', {
          file_path: fileInfo.file_path,
          size: stats.size,
          limit: MAX_PDF_BASE64_BYTES
        });
        return null;
      }

      const fileBuffer = await fs.readFile(fileInfo.file_path);
      const base64Data = fileBuffer.toString('base64');
      const mimeType = fileInfo.mime_type || 'application/pdf';
      const filename = fileInfo.original_name || 'document.pdf';

      logger.info('流式：PDF文件base64编码完成', {
        filename,
        rawSize: stats.size,
        base64Size: base64Data.length,
        mimeType,
        cached: !!pdfCache
      });

      const block = {
        type: 'file',
        file: {
          filename: filename,
          file_data: `data:${mimeType};base64,${base64Data}`
        }
      };

      if (pdfCache) {
        pdfCache.set(fileInfo.file_path, block);
      }

      return block;
    } catch (error) {
      logger.error('流式：构建PDF content块失败:', error);
      return null;
    }
  }

  /**
   * 处理消息为OpenRouter格式（URL方式 + file-parser插件）
   */
  static processMessagesForOpenRouter(messages, model) {
    return messages.map(msg => {
      if (msg.file && this.isPDFFile(msg.file)) {
        logger.info('处理PDF消息为OpenRouter流式格式', { role: msg.role });
        return {
          role: msg.role,
          content: [
            { type: 'text', text: msg.content },
            { type: 'file', file: { filename: msg.file.original_name || 'document.pdf', file_data: msg.file.url } }
          ]
        };
      }

      const imageUrls = [];
      if (msg.image_urls && Array.isArray(msg.image_urls)) {
        imageUrls.push(...msg.image_urls);
      } else if (msg.image_url) {
        imageUrls.push(msg.image_url);
      }

      if (imageUrls.length > 0 && model.image_upload_enabled) {
        const contentBlocks = [{ type: 'text', text: msg.content }];
        contentBlocks.push(...this._buildImageContentBlocks(imageUrls));
        return { role: msg.role, content: contentBlocks };
      }

      return { role: msg.role, content: msg.content };
    });
  }

  /**
   * 处理消息为标准格式 - v5.1: 支持 PDF 缓存
   */
  static async processMessagesStandard(messages, model) {
    // v5.1: 单请求内 base64 缓存
    const pdfCache = new Map();
    const result = [];

    for (const msg of messages) {
      const imageUrls = [];
      if (msg.image_urls && Array.isArray(msg.image_urls)) {
        imageUrls.push(...msg.image_urls);
      } else if (msg.image_url) {
        imageUrls.push(msg.image_url);
      }

      const isPDF = msg.file && this.isPDFFile(msg.file);

      // 场景一：仅有图片
      if (imageUrls.length > 0 && !isPDF && model.image_upload_enabled) {
        const contentBlocks = [{ type: 'text', text: msg.content }];
        contentBlocks.push(...this._buildImageContentBlocks(imageUrls));
        result.push({ role: msg.role, content: contentBlocks });
        continue;
      }

      // 场景二：有 PDF
      if (isPDF && model.document_upload_enabled) {
        const pdfBlock = await this._buildPDFContentBlock(msg.file, pdfCache);

        if (pdfBlock) {
          const contentBlocks = [{ type: 'text', text: msg.content }];

          if (imageUrls.length > 0 && model.image_upload_enabled) {
            contentBlocks.push(...this._buildImageContentBlocks(imageUrls));
          }

          contentBlocks.push(pdfBlock);

          result.push({ role: msg.role, content: contentBlocks });
          continue;
        } else {
          logger.warn('流式：PDF base64 编码失败', { file: msg.file.original_name });
          result.push({
            role: msg.role,
            content: `${msg.content}\n\n[系统提示：用户上传了文件 "${msg.file.original_name || '未知文件名'}"，但文件读取失败。请提示用户重新上传。]`
          });
          continue;
        }
      }

      // 场景三：其他类型文件
      if (msg.file && !isPDF) {
        logger.warn('流式：遇到非图片非PDF的文件，作为文本附件处理', {
          mime_type: msg.file.mime_type,
          provider: model.provider
        });
        result.push({
          role: msg.role,
          content: `${msg.content}\n\n[附件: ${msg.file.original_name || msg.file.url}]`
        });
        continue;
      }

      // 场景四：纯文本消息
      result.push(msg);
    }

    if (pdfCache.size > 0) {
      logger.info('流式：单请求 PDF 缓存统计', {
        uniquePdfCount: pdfCache.size,
        cacheKeys: Array.from(pdfCache.keys()).map(k => path.basename(k))
      });
    }

    return result;
  }

  /** 发送SSE事件 */
  static sendSSE(res, event, data) {
    try {
      if (res.writableEnded || !res.headersSent) return false;
      if (event) res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      return true;
    } catch (error) {
      logger.error('发送SSE失败:', error);
      return false;
    }
  }

  /** 发送SSE心跳事件 */
  static sendHeartbeat(res) {
    try {
      if (res.writableEnded || !res.headersSent) return false;
      res.write(`:heartbeat ${Date.now()}\n\n`);
      return true;
    } catch (error) {
      return false;
    }
  }

  /** 启动SSE心跳定时器 */
  static startHeartbeat(res) {
    const heartbeatTimer = setInterval(() => {
      const sent = AIStreamService.sendHeartbeat(res);
      if (!sent) {
        clearInterval(heartbeatTimer);
      }
    }, SSE_HEARTBEAT_INTERVAL_MS);

    return heartbeatTimer;
  }

  /** 安全序列化对象 */
  static safeStringify(obj, maxLength = 500) {
    if (obj === null || obj === undefined) return '';
    if (typeof obj === 'string') return obj.substring(0, maxLength);

    if (typeof obj === 'object') {
      if (obj.readable !== undefined || obj.writable !== undefined ||
          obj.pipe !== undefined || obj._readableState !== undefined) {
        return '[Stream Object]';
      }
      try {
        const seen = new WeakSet();
        const result = JSON.stringify(obj, (key, value) => {
          if (typeof value === 'function') return '[Function]';
          if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) return '[Circular]';
            seen.add(value);
          }
          return value;
        });
        return result.substring(0, maxLength);
      } catch (e) {
        return `[Object: ${obj.constructor?.name || 'Unknown'}]`;
      }
    }
    return String(obj).substring(0, maxLength);
  }

  /** 解析API错误信息 */
  static parseAPIError(error, model) {
    let userMessage = 'AI服务暂时不可用，请稍后重试';
    let technicalDetails = '';

    if (error.response) {
      const status = error.response.status;
      technicalDetails = AIStreamService.safeStringify(error.response.data, 500);

      switch (status) {
        case 400:
          if (technicalDetails.includes('file') || technicalDetails.includes('pdf') || technicalDetails.includes('document')) {
            userMessage = '文件处理失败：可能是文件过大、格式不支持或文件名包含特殊字符，请尝试重新上传';
          } else if (technicalDetails.includes('content') || technicalDetails.includes('message')) {
            userMessage = '消息内容格式错误，请检查输入内容';
          } else if (technicalDetails.includes('model')) {
            userMessage = '模型暂时不可用，请尝试切换其他模型';
          } else {
            userMessage = '请求格式错误，请检查输入内容或文件';
          }
          break;
        case 401: userMessage = 'API认证失败，请联系管理员检查配置'; break;
        case 402: userMessage = 'API额度不足，请联系管理员'; break;
        case 403: userMessage = '没有权限访问此模型'; break;
        case 404: userMessage = `模型 ${model.name} 不存在或已下线`; break;
        case 413: userMessage = '请求内容过大，请减少输入内容或文件大小'; break;
        case 429: userMessage = 'AI服务请求过于频繁，请稍后再试'; break;
        case 500: case 502: case 503: userMessage = 'AI服务暂时不可用，请稍后重试'; break;
        case 504: userMessage = 'AI服务响应超时，请稍后重试'; break;
        default: userMessage = `AI服务错误 (${status})，请稍后重试`;
      }
    } else if (error.code === 'ECONNABORTED' || (error.message && error.message.includes('timeout'))) {
      userMessage = 'AI服务响应超时，请稍后重试或尝试缩短提问内容';
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      userMessage = 'AI服务连接失败，请检查网络';
    } else if (error.message) {
      userMessage = error.message.length > 100 ? error.message.substring(0, 100) + '...' : error.message;
    }

    return { userMessage, technicalDetails, statusCode: error.response?.status };
  }

  /** 发送流式消息到AI模型 */
  static async sendStreamMessage(res, modelName, messages, options = {}) {
    try {
      logger.info('开始流式AI服务', {
        model: modelName, messageCount: messages.length,
        enableThinking: options.enableThinking,
        hasPDFs: messages.some(m => m.file),
        hasMultiImages: messages.some(m => m.image_urls)
      });

      const model = await AIModel.findByName(modelName);
      if (!model) throw new Error(`AI模型 ${modelName} 未找到`);
      if (!model.stream_enabled) throw new Error(`AI模型 ${modelName} 不支持流式输出`);

      // v5.2: 图像生成模型防呆保护
      // 流式链路不支持图像生成（不发 modalities 参数、不解析 images 字段），
      // 图像生成模型必须走非流式（数据库 stream_enabled=0）。
      // 若管理员误开图像模型的流式开关，此处给出清晰错误而非诡异的空响应。
      if (ImageGenerationService.isImageGenerationModel(model)) {
        logger.warn('图像生成模型被错误地以流式方式调用，已拒绝', {
          model: modelName,
          hint: '请在后台关闭该图像生成模型的"流式输出"开关，图像生成需走非流式'
        });
        throw new Error('图像生成模型不支持流式输出，请在模型设置中关闭"流式输出"开关后重试');
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*'
      });

      if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
      }

      if (options.userMessage || options.creditsInfo) {
        AIStreamService.sendSSE(res, 'init', {
          user_message: options.userMessage,
          ai_message_id: options.messageId,
          credits_info: options.creditsInfo
        });
      }

      if (AIStreamService.isAzureConfig(model)) {
        return await AIStreamService.callAzureStreamAPI(res, model, messages, options);
      } else {
        return await AIStreamService.callStreamAPI(res, model, messages, options);
      }
    } catch (error) {
      logger.error('流式AI服务失败:', error);
      const errorInfo = AIStreamService.parseAPIError(error, { name: modelName });
      if (!res.writableEnded) {
        // 注意：图像模型防呆等入口错误发生在 writeHead 之前，
        // 此时 headersSent 为 false，sendSSE 会因 !headersSent 返回 false 不写入。
        // 因此这里需要确保错误能正常返回给上层（由 ChatController 退款并返回错误）。
        if (res.headersSent) {
          AIStreamService.sendSSE(res, 'error', { error: errorInfo.userMessage, details: errorInfo.technicalDetails || '', code: errorInfo.statusCode || '' });
          res.end();
        }
      }
      throw new ExternalServiceError(`流式AI服务失败: ${error.message}`, 'ai');
    }
  }

  /**
   * 内部方法：处理流式数据的通用逻辑
   */
  static _handleStreamResponse(res, response, model, options, startTime) {
    let fullContent = '';
    let buffer = '';
    let isDone = false;
    let chunkCount = 0;

    const heartbeatTimer = AIStreamService.startHeartbeat(res);

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
        }
      };

      response.data.on('data', (chunk) => {
        try {
          chunkCount++;
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;

            const data = trimmed.slice(6);

            if (data === '[DONE]') {
              if (!isDone) {
                isDone = true;
                cleanup();
                logger.info('流式传输完成[DONE]', {
                  model: model.name, messageId: options.messageId,
                  chunkCount, contentLength: fullContent.length, totalTimeMs: Date.now() - startTime
                });
                AIStreamService._finishStream(res, fullContent, options);
                resolve({ content: fullContent });
              }
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                fullContent += delta;
                AIStreamService.sendSSE(res, 'message', { delta, fullContent });
              }
              if (parsed.choices?.[0]?.finish_reason === 'stop' && !isDone) {
                isDone = true;
                cleanup();
                logger.info('流式传输完成[stop]', {
                  model: model.name, messageId: options.messageId,
                  chunkCount, contentLength: fullContent.length, totalTimeMs: Date.now() - startTime
                });
                AIStreamService._finishStream(res, fullContent, options);
                resolve({ content: fullContent });
              }
            } catch (e) {
              logger.warn('解析流数据失败:', { error: e.message, rawData: data.substring(0, 200) });
            }
          }
        } catch (error) {
          logger.error('处理流数据失败:', error);
        }
      });

      response.data.on('end', () => {
        if (!isDone) {
          isDone = true;
          cleanup();
          logger.info('流式传输结束[on end]', {
            model: model.name, messageId: options.messageId,
            chunkCount, contentLength: fullContent.length, totalTimeMs: Date.now() - startTime
          });
          AIStreamService._finishStream(res, fullContent, options);
          resolve({ content: fullContent });
        }
      });

      response.data.on('error', (error) => {
        cleanup();
        logger.error('流式响应错误:', error);
        const errorInfo = AIStreamService.parseAPIError(error, model);
        if (!res.writableEnded) {
          AIStreamService.sendSSE(res, 'error', { error: errorInfo.userMessage, details: errorInfo.technicalDetails || '', code: errorInfo.statusCode });
          res.end();
        }
        reject(error);
      });

      res.on('close', () => {
        cleanup();
        logger.info('客户端断开连接', {
          model: model.name, messageId: options.messageId,
          chunkCount, contentLength: fullContent.length, isDone, totalTimeMs: Date.now() - startTime
        });
        if (!isDone && options.onComplete) {
          if (fullContent && fullContent.length > 0) {
            options.onComplete(fullContent, AIStreamService.estimateTokens(fullContent));
          } else {
            options.onComplete(null, 0);
          }
        }
      });
    });
  }

  /** 内部方法：完成流式响应 */
  static _finishStream(res, fullContent, options) {
    if (fullContent.length > 0) {
      AIStreamService.sendSSE(res, 'done', { content: fullContent, messageId: options.messageId });
    } else {
      logger.warn('流式传输完成但内容为空，发送错误事件', { messageId: options.messageId });
      AIStreamService.sendSSE(res, 'error', {
        error: 'AI返回内容为空，可能是文件解析失败或请求被拒绝，请重试或更换文件',
        code: 'EMPTY_RESPONSE'
      });
    }
    res.end();

    if (options.onComplete) {
      if (fullContent.length > 0) {
        options.onComplete(fullContent, AIStreamService.estimateTokens(fullContent));
      } else {
        options.onComplete(null, 0);
      }
    }
  }

  /** 调用标准OpenAI格式的流式API */
  static async callStreamAPI(res, model, messages, options = {}) {
    const startTime = Date.now();

    try {
      const isOpenRouter = AIStreamService.isOpenRouterEndpoint(model.api_endpoint);

      let processedMessages;
      let plugins = undefined;

      if (isOpenRouter) {
        processedMessages = AIStreamService.processMessagesForOpenRouter(messages, model);
        if (messages.some(m => m.file)) {
          plugins = [{ id: 'file-parser', pdf: { engine: 'pdf-text' } }];
        }
      } else {
        processedMessages = await AIStreamService.processMessagesStandard(messages, model);
      }

      const requestData = {
        model: model.name,
        messages: processedMessages,
        temperature: options.temperature || 0.7,
        stream: true
      };
      if (plugins) requestData.plugins = plugins;

      if (isOpenRouter && !options.enableThinking) {
        requestData.include_reasoning = false;
        logger.info('OpenRouter: 禁用推理输出（enableThinking=false）', { model: model.name });
      }

      const endpoint = model.api_endpoint.endsWith('/chat/completions')
        ? model.api_endpoint : `${model.api_endpoint}/chat/completions`;

      const siteDomain = config.app.domain || 'ai.xingyuncl.com';
      const siteName = config.app.name || 'AI Platform';

      let headers = {
        'Authorization': `Bearer ${model.api_key}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      };
      if (isOpenRouter) {
        headers['HTTP-Referer'] = `https://${siteDomain}`;
        headers['X-Title'] = siteName;
      }

      let response;
      try {
        response = await axios({
          method: 'post',
          url: endpoint,
          data: requestData,
          headers,
          responseType: 'stream',
          timeout: UPSTREAM_API_TIMEOUT_MS
        });
      } catch (axiosError) {
        const errorInfo = AIStreamService.parseAPIError(axiosError, model);
        logger.error('API请求失败', { model: model.name, statusCode: errorInfo.statusCode, userMessage: errorInfo.userMessage });
        AIStreamService.sendSSE(res, 'error', { error: errorInfo.userMessage, code: errorInfo.statusCode, details: errorInfo.technicalDetails });
        res.end();
        if (options.onComplete) options.onComplete(null, 0);
        throw axiosError;
      }

      logger.info('开始接收流式响应', {
        model: model.name, isOpenRouter,
        enableThinking: options.enableThinking,
        upstreamTimeout: UPSTREAM_API_TIMEOUT_MS,
        responseTimeMs: Date.now() - startTime
      });

      return await AIStreamService._handleStreamResponse(res, response, model, options, startTime);
    } catch (error) {
      logger.error('流式API调用失败:', error);
      throw error;
    }
  }

  /** 调用Azure流式API */
  static async callAzureStreamAPI(res, model, messages, options = {}) {
    const startTime = Date.now();

    try {
      const azureConfig = AIStreamService.parseAzureConfig(model.api_key);
      if (!azureConfig) throw new Error('Azure配置格式错误');

      const { apiKey, endpoint, apiVersion } = azureConfig;
      let deploymentName = model.name;
      if (model.name.includes('/')) deploymentName = model.name.split('/').pop();

      const baseUrl = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
      const azureUrl = `${baseUrl}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;

      const processedMessages = await AIStreamService.processMessagesStandard(messages, model);
      const requestData = { messages: processedMessages, temperature: options.temperature || 0.7, stream: true };

      let response;
      try {
        response = await axios({
          method: 'post', url: azureUrl, data: requestData,
          headers: { 'api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
          responseType: 'stream', timeout: UPSTREAM_API_TIMEOUT_MS
        });
      } catch (axiosError) {
        const errorInfo = AIStreamService.parseAPIError(axiosError, model);
        logger.error('Azure API请求失败', { model: model.name, statusCode: errorInfo.statusCode });
        AIStreamService.sendSSE(res, 'error', { error: errorInfo.userMessage, code: errorInfo.statusCode });
        res.end();
        if (options.onComplete) options.onComplete(null, 0);
        throw axiosError;
      }

      logger.info('开始接收Azure流式响应');

      return await AIStreamService._handleStreamResponse(res, response, model, options, startTime);
    } catch (error) {
      logger.error('Azure流式API调用失败:', error);
      throw error;
    }
  }

  /** 估算Token数量 */
  static estimateTokens(content) {
    if (!content) return 0;
    const chineseChars = (content.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = content.length - chineseChars;
    return Math.ceil(chineseChars * 0.67 + otherChars * 0.25);
  }
}

module.exports = AIStreamService;

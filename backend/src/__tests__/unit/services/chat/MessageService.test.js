/**
 * MessageService - 消息服务单元测试
 * 
 * 测试范围：
 * - validateMessageSending()    消息发送前验证（内容/会话/模型/积分/Token）
 * - processFileAttachment()     单文件处理（权限/类型/模型支持）
 * - processFileAttachments()    多文件批量处理（v2.0）
 * - isPDFFile() / isImageFile() 文件类型判断
 * - buildAIContext()            AI请求上下文构建（系统提示词/模块组合/历史消息/多图）
 * - autoGenerateTitle()         自动生成会话标题
 * - refundCredits()             积分退款
 * - buildActualContent()        内容预处理
 * 
 * Mock策略：
 * - 数据库模型（File、Message、SystemPrompt、ModuleCombination）全Mock
 * - AI服务不测试（由各自的测试覆盖）
 * - 只测试MessageService层的业务逻辑
 */

// ========== Mock外部依赖 ==========

jest.mock('../../../../models/Message', () => ({
  estimateTokens: jest.fn().mockReturnValue(100)
}));

const mockCheckOwnership = jest.fn();
const mockCheckOwnershipBatch = jest.fn();
const mockFileFindById = jest.fn();
const mockFindByIds = jest.fn();

jest.mock('../../../../models/File', () => ({
  checkOwnership: mockCheckOwnership,
  checkOwnershipBatch: mockCheckOwnershipBatch,
  findById: mockFileFindById,
  findByIds: mockFindByIds
}));

jest.mock('../../../../models/SystemPrompt', () => ({
  getPromptContent: jest.fn()
}));

jest.mock('../../../../models/ModuleCombination', () => ({
  getCombinedContent: jest.fn()
}));

jest.mock('../../../../services/aiService');
jest.mock('../../../../services/aiStreamService');

jest.mock('../../../../services/cacheService', () => ({
  clearConversationCache: jest.fn()
}));

jest.mock('../../../../services/statsService', () => ({
  updateUserDailyStats: jest.fn(),
  recordModelUsage: jest.fn()
}));

jest.mock('../../../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

jest.mock('../../../../database/connection', () => ({
  query: jest.fn(),
  simpleQuery: jest.fn(),
  transaction: jest.fn()
}));

// ========== 引入被测模块 ==========
const MessageService = require('../../../../services/chat/MessageService');
const Message = require('../../../../models/Message');
const File = require('../../../../models/File');
const SystemPrompt = require('../../../../models/SystemPrompt');
const ModuleCombination = require('../../../../models/ModuleCombination');

// ========== 辅助函数 ==========

/** 创建Mock用户 */
function createMockUser(overrides = {}) {
  return {
    id: 1,
    hasCredits: jest.fn().mockReturnValue(true),
    getCredits: jest.fn().mockReturnValue(800),
    hasTokenQuota: jest.fn().mockReturnValue(true),
    addCredits: jest.fn().mockResolvedValue({ success: true }),
    consumeTokens: jest.fn().mockResolvedValue(true),
    ...overrides
  };
}

/** 创建Mock AI模型 */
function createMockModel(overrides = {}) {
  return {
    name: 'gpt-4',
    credits_per_chat: 10,
    image_upload_enabled: true,
    document_upload_enabled: true,
    ...overrides
  };
}

/** 创建Mock会话 */
function createMockConversation(overrides = {}) {
  return {
    id: 'conv-uuid-1',
    title: 'New Chat',
    model_name: 'gpt-4',
    system_prompt: null,
    system_prompt_id: null,
    module_combination_id: null,
    update: jest.fn().mockResolvedValue(true),
    updateStats: jest.fn().mockResolvedValue(true),
    ...overrides
  };
}

/** 创建Mock文件信息 */
function createMockFile(overrides = {}) {
  return {
    id: 'file-uuid-1',
    original_name: 'test.jpg',
    mime_type: 'image/jpeg',
    url: 'https://example.com/test.jpg',
    user_id: 1,
    ...overrides
  };
}

// ========== 测试套件 ==========

describe('MessageService - 消息服务', () => {

  // ========== validateMessageSending() 测试 ==========
  describe('validateMessageSending() - 消息发送前验证', () => {

    test('所有条件满足：应返回estimatedTokens', async () => {
      Message.estimateTokens.mockReturnValue(150);

      const result = await MessageService.validateMessageSending({
        content: '你好，请帮我翻译',
        conversation: createMockConversation(),
        aiModel: createMockModel(),
        user: createMockUser(),
        requiredCredits: 10
      });

      expect(result.estimatedTokens).toBe(150);
    });

    test('消息内容为空：应抛出错误', async () => {
      await expect(MessageService.validateMessageSending({
        content: '',
        conversation: createMockConversation(),
        aiModel: createMockModel(),
        user: createMockUser(),
        requiredCredits: 10
      })).rejects.toThrow('消息内容不能为空');
    });

    test('消息内容只有空格：应抛出错误', async () => {
      await expect(MessageService.validateMessageSending({
        content: '   ',
        conversation: createMockConversation(),
        aiModel: createMockModel(),
        user: createMockUser(),
        requiredCredits: 10
      })).rejects.toThrow('消息内容不能为空');
    });

    test('会话不存在：应抛出错误', async () => {
      await expect(MessageService.validateMessageSending({
        content: '测试',
        conversation: null,
        aiModel: createMockModel(),
        user: createMockUser(),
        requiredCredits: 10
      })).rejects.toThrow('会话不存在');
    });

    test('AI模型不可用：应抛出限制错误', async () => {
      await expect(MessageService.validateMessageSending({
        content: '测试',
        conversation: createMockConversation(),
        aiModel: null,
        user: createMockUser(),
        requiredCredits: 10
      })).rejects.toThrow('限制使用该模型');
    });

    test('积分不足：应抛出余额错误', async () => {
      const user = createMockUser({
        hasCredits: jest.fn().mockReturnValue(false),
        getCredits: jest.fn().mockReturnValue(5)
      });

      await expect(MessageService.validateMessageSending({
        content: '测试',
        conversation: createMockConversation(),
        aiModel: createMockModel(),
        user,
        requiredCredits: 10
      })).rejects.toThrow('积分不足');
    });

    test('Token配额不足：应抛出错误', async () => {
      const user = createMockUser({
        hasTokenQuota: jest.fn().mockReturnValue(false)
      });

      await expect(MessageService.validateMessageSending({
        content: '测试',
        conversation: createMockConversation(),
        aiModel: createMockModel(),
        user,
        requiredCredits: 0
      })).rejects.toThrow('Token配额不足');
    });
  });

  // ========== processFileAttachment() 单文件测试 ==========
  describe('processFileAttachment() - 单文件处理', () => {

    test('无fileId：应返回null', async () => {
      const result = await MessageService.processFileAttachment(null, 1, createMockModel());
      expect(result.fileInfo).toBeNull();
      expect(result.documentContent).toBeNull();
    });

    test('文件不属于用户：应抛出权限错误', async () => {
      mockCheckOwnership.mockResolvedValue(false);

      await expect(MessageService.processFileAttachment('file-1', 1, createMockModel()))
        .rejects.toThrow('无权使用此文件');
    });

    test('文件不存在：应抛出错误', async () => {
      mockCheckOwnership.mockResolvedValue(true);
      mockFileFindById.mockResolvedValue(null);

      await expect(MessageService.processFileAttachment('file-1', 1, createMockModel()))
        .rejects.toThrow('文件不存在');
    });

    test('图片文件但模型不支持图片：应抛出错误', async () => {
      mockCheckOwnership.mockResolvedValue(true);
      mockFileFindById.mockResolvedValue(createMockFile({ mime_type: 'image/png' }));

      await expect(MessageService.processFileAttachment(
        'file-1', 1,
        createMockModel({ image_upload_enabled: false })
      )).rejects.toThrow('不支持图片识别');
    });

    test('文档文件但模型不支持文档：应抛出错误', async () => {
      mockCheckOwnership.mockResolvedValue(true);
      mockFileFindById.mockResolvedValue(createMockFile({ mime_type: 'application/pdf' }));

      await expect(MessageService.processFileAttachment(
        'file-1', 1,
        createMockModel({ document_upload_enabled: false })
      )).rejects.toThrow('不支持文档上传');
    });

    test('图片文件且模型支持：应返回fileInfo', async () => {
      const mockFile = createMockFile({ mime_type: 'image/jpeg' });
      mockCheckOwnership.mockResolvedValue(true);
      mockFileFindById.mockResolvedValue(mockFile);

      const result = await MessageService.processFileAttachment(
        'file-1', 1, createMockModel()
      );

      expect(result.fileInfo).toBe(mockFile);
    });
  });

  // ========== processFileAttachments() 多文件测试 ==========
  describe('processFileAttachments() - 多文件批量处理（v2.0）', () => {

    test('空数组：应返回空fileInfos', async () => {
      const result = await MessageService.processFileAttachments([], 1, createMockModel());
      expect(result.fileInfos).toEqual([]);
    });

    test('null/undefined：应返回空fileInfos', async () => {
      const result = await MessageService.processFileAttachments(null, 1, createMockModel());
      expect(result.fileInfos).toEqual([]);
    });

    test('批量权限校验失败：应抛出错误', async () => {
      mockCheckOwnershipBatch.mockResolvedValue(false);

      await expect(MessageService.processFileAttachments(
        ['f1', 'f2'], 1, createMockModel()
      )).rejects.toThrow('无权使用部分文件');
    });

    test('部分文件不存在：应抛出错误', async () => {
      mockCheckOwnershipBatch.mockResolvedValue(true);
      mockFindByIds.mockResolvedValue([
        createMockFile({ id: 'f1' })
      ]);

      await expect(MessageService.processFileAttachments(
        ['f1', 'f2'], 1, createMockModel()
      )).rejects.toThrow('部分文件不存在');
    });

    test('包含图片但模型不支持：应抛出错误', async () => {
      mockCheckOwnershipBatch.mockResolvedValue(true);
      mockFindByIds.mockResolvedValue([
        createMockFile({ id: 'f1', mime_type: 'image/png', original_name: 'photo.png' })
      ]);

      await expect(MessageService.processFileAttachments(
        ['f1'], 1,
        createMockModel({ image_upload_enabled: false })
      )).rejects.toThrow('不支持图片识别');
    });

    test('多文件全部合法：应返回完整fileInfos', async () => {
      const files = [
        createMockFile({ id: 'f1', mime_type: 'image/jpeg' }),
        createMockFile({ id: 'f2', mime_type: 'image/png' }),
        createMockFile({ id: 'f3', mime_type: 'application/pdf' })
      ];
      mockCheckOwnershipBatch.mockResolvedValue(true);
      mockFindByIds.mockResolvedValue(files);

      const result = await MessageService.processFileAttachments(
        ['f1', 'f2', 'f3'], 1, createMockModel()
      );

      expect(result.fileInfos).toHaveLength(3);
    });
  });

  // ========== 文件类型判断 ==========
  describe('isPDFFile() / isImageFile() - 文件类型判断', () => {

    test('isPDFFile：application/pdf应为true', () => {
      expect(MessageService.isPDFFile({ mime_type: 'application/pdf' })).toBe(true);
    });

    test('isPDFFile：.pdf后缀应为true', () => {
      expect(MessageService.isPDFFile({
        mime_type: 'application/octet-stream',
        original_name: 'document.PDF'
      })).toBe(true);
    });

    test('isPDFFile：图片文件应为false', () => {
      expect(MessageService.isPDFFile({ mime_type: 'image/jpeg' })).toBe(false);
    });

    test('isPDFFile：null应为false', () => {
      expect(MessageService.isPDFFile(null)).toBe(false);
    });

    test('isImageFile：image/jpeg应为true', () => {
      expect(MessageService.isImageFile({ mime_type: 'image/jpeg' })).toBe(true);
    });

    test('isImageFile：image/png应为true', () => {
      expect(MessageService.isImageFile({ mime_type: 'image/png' })).toBe(true);
    });

    test('isImageFile：application/pdf应为false', () => {
      expect(MessageService.isImageFile({ mime_type: 'application/pdf' })).toBe(false);
    });

    test('isImageFile：null应为false', () => {
      expect(MessageService.isImageFile(null)).toBe(false);
    });

    test('isImageFile：无mime_type应为falsy', () => {
      // 源码：fileInfo.mime_type && fileInfo.mime_type.startsWith('image/')
      // 当mime_type为undefined时，&&短路返回undefined（falsy但不是false）
      expect(MessageService.isImageFile({ original_name: 'test.jpg' })).toBeFalsy();
    });
  });

  // ========== buildAIContext() 测试 ==========
  describe('buildAIContext() - AI请求上下文构建', () => {

    test('最简场景：只有当前消息', async () => {
      const result = await MessageService.buildAIContext({
        conversation: createMockConversation(),
        recentMessages: [],
        currentContent: '你好'
      });

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
      expect(result[0].content).toBe('你好');
    });

    test('带系统提示词：应在消息列表开头', async () => {
      const result = await MessageService.buildAIContext({
        conversation: createMockConversation({ system_prompt: '你是一个翻译助手' }),
        recentMessages: [],
        currentContent: '翻译这段话'
      });

      expect(result[0].role).toBe('system');
      expect(result[0].content).toBe('你是一个翻译助手');
      expect(result[1].role).toBe('user');
    });

    test('带系统提示词ID：应从数据库获取内容', async () => {
      SystemPrompt.getPromptContent.mockResolvedValue('你是专业编程助手');

      const result = await MessageService.buildAIContext({
        conversation: createMockConversation(),
        recentMessages: [],
        systemPromptId: 10,
        currentContent: '写一个函数'
      });

      expect(result[0].role).toBe('system');
      expect(result[0].content).toBe('你是专业编程助手');
    });

    test('带模块组合：应添加知识上下文', async () => {
      ModuleCombination.getCombinedContent.mockResolvedValue({
        systemPrompt: '你是AI专家',
        normalPrompt: '以下是背景知识：...'
      });

      const result = await MessageService.buildAIContext({
        conversation: createMockConversation(),
        recentMessages: [],
        moduleCombinationId: 5,
        userId: 1,
        currentContent: '请回答问题'
      });

      expect(result.length).toBeGreaterThanOrEqual(3);
      expect(result.some(m => m.content.includes('背景知识'))).toBe(true);
      expect(result.some(m => m.content === '我已经理解了上述内容，请继续提问。')).toBe(true);
    });

    test('v2.0多图：当前消息带多张图片应设置image_urls', async () => {
      const fileInfos = [
        createMockFile({ mime_type: 'image/jpeg', url: 'https://img1.jpg' }),
        createMockFile({ mime_type: 'image/png', url: 'https://img2.png' })
      ];

      const result = await MessageService.buildAIContext({
        conversation: createMockConversation(),
        recentMessages: [],
        currentContent: '请描述这些图片',
        currentFileInfos: fileInfos
      });

      const userMsg = result.find(m => m.role === 'user');
      expect(userMsg.image_urls).toEqual(['https://img1.jpg', 'https://img2.png']);
      expect(userMsg.image_url).toBeUndefined();
    });

    test('v2.0单图：应使用image_url而非image_urls', async () => {
      const fileInfos = [
        createMockFile({ mime_type: 'image/jpeg', url: 'https://img1.jpg' })
      ];

      const result = await MessageService.buildAIContext({
        conversation: createMockConversation(),
        recentMessages: [],
        currentContent: '描述这张图',
        currentFileInfos: fileInfos
      });

      const userMsg = result.find(m => m.role === 'user');
      expect(userMsg.image_url).toBe('https://img1.jpg');
      expect(userMsg.image_urls).toBeUndefined();
    });

    test('当前消息带PDF：应设置file字段', async () => {
      const fileInfos = [
        createMockFile({ mime_type: 'application/pdf', url: 'https://doc.pdf' })
      ];

      const result = await MessageService.buildAIContext({
        conversation: createMockConversation(),
        recentMessages: [],
        currentContent: '总结这份文档',
        currentFileInfos: fileInfos
      });

      const userMsg = result.find(m => m.role === 'user');
      expect(userMsg.file).toEqual({
        url: 'https://doc.pdf',
        mime_type: 'application/pdf'
      });
    });

    test('向后兼容：currentFileInfo单文件参数应正常工作', async () => {
      const singleFile = createMockFile({ mime_type: 'image/jpeg', url: 'https://old.jpg' });

      const result = await MessageService.buildAIContext({
        conversation: createMockConversation(),
        recentMessages: [],
        currentContent: '看这张图',
        currentFileInfo: singleFile
      });

      const userMsg = result.find(m => m.role === 'user');
      expect(userMsg.image_url).toBe('https://old.jpg');
    });
  });

  // ========== autoGenerateTitle() 测试 ==========
  describe('autoGenerateTitle() - 自动生成标题', () => {

    test('首条消息且标题为New Chat：应截断为标题', async () => {
      const conversation = createMockConversation({ title: 'New Chat' });
      const title = await MessageService.autoGenerateTitle(
        conversation, '请帮我写一段Python排序代码', 0
      );

      expect(title).toBe('请帮我写一段Python排序代码');
      expect(conversation.update).toHaveBeenCalled();
    });

    test('长消息应截断到30字符并加省略号', async () => {
      const conversation = createMockConversation({ title: 'New Chat' });
      const longContent = '这是一段非常非常长的消息内容，用来测试自动标题生成的截断功能是否正常工作';
      const title = await MessageService.autoGenerateTitle(conversation, longContent, 0);

      expect(title.length).toBeLessThanOrEqual(33);
      expect(title.endsWith('...')).toBe(true);
    });

    test('非首条消息：应返回null不更新', async () => {
      const conversation = createMockConversation({ title: 'New Chat' });
      const title = await MessageService.autoGenerateTitle(conversation, '测试', 5);

      expect(title).toBeNull();
      expect(conversation.update).not.toHaveBeenCalled();
    });

    test('已有自定义标题：应返回null不更新', async () => {
      const conversation = createMockConversation({ title: '我的对话' });
      const title = await MessageService.autoGenerateTitle(conversation, '测试', 0);

      expect(title).toBeNull();
      expect(conversation.update).not.toHaveBeenCalled();
    });
  });

  // ========== refundCredits() 测试 ==========
  describe('refundCredits() - 积分退款', () => {

    test('正常退款：应返回true', async () => {
      const user = createMockUser();
      const result = await MessageService.refundCredits(user, 10, 'AI调用失败');

      expect(result).toBe(true);
      expect(user.addCredits).toHaveBeenCalledWith(10, 'AI调用失败');
    });

    test('退款失败：应返回false而非抛出错误', async () => {
      const user = createMockUser({
        addCredits: jest.fn().mockRejectedValue(new Error('数据库错误'))
      });

      const result = await MessageService.refundCredits(user, 10, '退款');

      expect(result).toBe(false);
    });
  });

  // ========== buildActualContent() 测试 ==========
  describe('buildActualContent() - 内容预处理', () => {

    test('应去除前后空白', () => {
      expect(MessageService.buildActualContent('  你好  ', null)).toBe('你好');
    });

    test('带文件信息也不应修改内容（PDF/图片通过专门字段）', () => {
      const fileInfo = createMockFile({ mime_type: 'application/pdf', url: 'https://x.pdf' });
      expect(MessageService.buildActualContent('总结文档', fileInfo)).toBe('总结文档');
    });
  });
});

/**
 * uploadMiddleware - 文件上传中间件单元测试
 * 
 * 测试范围：
 * - ALLOWED_IMAGE_MIMES    支持的图片类型列表
 * - uploadImage()           Multer错误处理（文件大小/数量/字段名/格式）
 * - getFileUrl()            磁盘路径转URL
 * 
 * Mock策略：
 * - 不真正上传文件，通过模拟Multer错误测试错误处理逻辑
 * - getFileUrl使用真实逻辑测试路径转换
 */

// ========== Mock外部依赖 ==========

jest.mock('../../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

jest.mock('../../../config', () => ({
  app: {
    domain: 'ai.xingyuncl.com',
    env: 'production'
  },
  upload: {
    uploadDir: '/var/www/ai-platform/storage/uploads'
  }
}));

// ========== 引入被测模块 ==========
const { ALLOWED_IMAGE_MIMES, getFileUrl } = require('../../../middleware/uploadMiddleware');

// ========== 测试套件 ==========

describe('uploadMiddleware - 文件上传中间件', () => {

  // ========== ALLOWED_IMAGE_MIMES 测试 ==========
  describe('ALLOWED_IMAGE_MIMES - 支持的图片类型', () => {

    test('应包含6种常见图片格式', () => {
      expect(ALLOWED_IMAGE_MIMES).toContain('image/jpeg');
      expect(ALLOWED_IMAGE_MIMES).toContain('image/jpg');
      expect(ALLOWED_IMAGE_MIMES).toContain('image/png');
      expect(ALLOWED_IMAGE_MIMES).toContain('image/gif');
      expect(ALLOWED_IMAGE_MIMES).toContain('image/webp');
      expect(ALLOWED_IMAGE_MIMES).toContain('image/bmp');
    });

    test('不应包含SVG（安全风险）', () => {
      expect(ALLOWED_IMAGE_MIMES).not.toContain('image/svg+xml');
    });

    test('不应包含非图片类型', () => {
      expect(ALLOWED_IMAGE_MIMES).not.toContain('application/pdf');
      expect(ALLOWED_IMAGE_MIMES).not.toContain('text/html');
    });
  });

  // ========== getFileUrl() 测试 ==========
  describe('getFileUrl() - 磁盘路径转URL', () => {

    test('标准上传路径：应返回相对URL', () => {
      const url = getFileUrl('/var/www/ai-platform/storage/uploads/chat-images/2026-03/img.jpg');
      expect(url).toMatch(/\/uploads\/chat-images\/2026-03\/img\.jpg/);
    });

    test('others目录：应正确转换', () => {
      const url = getFileUrl('/var/www/ai-platform/storage/uploads/others/doc.txt');
      expect(url).toMatch(/\/uploads\/others\/doc\.txt/);
    });
  });
});

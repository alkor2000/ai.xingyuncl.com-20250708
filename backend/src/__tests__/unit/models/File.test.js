/**
 * File - 文件模型单元测试
 * 
 * 测试范围：
 * - constructor()          构造函数（字段初始化、URL自动生成）
 * - _buildUrl()            路径→URL转换（Docker/PM2路径前缀处理、协议选择）
 * - findByIds()            批量查询（去重、顺序保持、空数组）
 * - checkOwnership()       单文件权限检查
 * - checkOwnershipBatch()  批量权限检查（部分不存在、所有权不匹配）
 * - toJSON()               JSON序列化
 * 
 * Mock策略：
 * - 数据库连接Mock
 * - config Mock控制domain和环境变量
 */

// ========== Mock外部依赖 ==========

const mockQuery = jest.fn();
jest.mock('../../../database/connection', () => ({
  query: mockQuery,
  simpleQuery: jest.fn()
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

jest.mock('../../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

// ========== 引入被测模块 ==========
const File = require('../../../models/File');

// ========== 测试套件 ==========

describe('File - 文件模型', () => {

  // ========== constructor 测试 ==========
  describe('constructor() - 构造函数', () => {

    test('应正确初始化所有字段', () => {
      const file = new File({
        id: 'uuid-1',
        user_id: 1,
        original_name: 'photo.jpg',
        stored_name: '1234-abc.jpg',
        file_path: '/var/www/ai-platform/storage/uploads/chat-images/2026-03/1234-abc.jpg',
        file_size: 102400,
        mime_type: 'image/jpeg'
      });

      expect(file.id).toBe('uuid-1');
      expect(file.user_id).toBe(1);
      expect(file.original_name).toBe('photo.jpg');
      expect(file.mime_type).toBe('image/jpeg');
      expect(file.file_size).toBe(102400);
      expect(file.url).toBeDefined();
    });

    test('无file_path时url应为null', () => {
      const file = new File({ id: 'uuid-1' });
      expect(file.url).toBeNull();
    });

    test('空数据应使用默认值', () => {
      const file = new File();
      expect(file.id).toBeNull();
      expect(file.file_size).toBe(0);
      expect(file.status).toBe('ready');
    });
  });

  // ========== _buildUrl() 测试 ==========
  describe('_buildUrl() - 路径转URL', () => {

    test('PM2路径：应正确去除前缀并生成URL', () => {
      const url = File._buildUrl('/var/www/ai-platform/storage/uploads/chat-images/2026-03/img.jpg');
      expect(url).toBe('https://ai.xingyuncl.com/uploads/chat-images/2026-03/img.jpg');
    });

    test('Docker路径：应正确去除前缀', () => {
      const url = File._buildUrl('/app/storage/uploads/chat-images/2026-03/img.jpg');
      expect(url).toBe('https://ai.xingyuncl.com/uploads/chat-images/2026-03/img.jpg');
    });

    test('相对路径：应正确处理', () => {
      const url = File._buildUrl('storage/uploads/chat-images/img.jpg');
      expect(url).toBe('https://ai.xingyuncl.com/uploads/chat-images/img.jpg');
    });

    test('已经是/uploads开头的路径：不应重复添加', () => {
      const url = File._buildUrl('/uploads/chat-images/img.jpg');
      expect(url).toBe('https://ai.xingyuncl.com/uploads/chat-images/img.jpg');
    });
  });

  // ========== findByIds() 测试 ==========
  describe('findByIds() - 批量查询', () => {

    beforeEach(() => {
      mockQuery.mockReset();
    });

    test('空数组：应直接返回空数组不查库', async () => {
      const result = await File.findByIds([]);
      expect(result).toEqual([]);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    test('null/undefined：应返回空数组', async () => {
      expect(await File.findByIds(null)).toEqual([]);
      expect(await File.findByIds(undefined)).toEqual([]);
    });

    test('正常查询：应按传入顺序返回', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: 'b', original_name: 'b.jpg', file_path: '/var/www/ai-platform/storage/uploads/b.jpg' },
          { id: 'a', original_name: 'a.jpg', file_path: '/var/www/ai-platform/storage/uploads/a.jpg' }
        ]
      });

      const result = await File.findByIds(['a', 'b']);

      // 应按传入顺序：a在前b在后
      expect(result[0].id).toBe('a');
      expect(result[1].id).toBe('b');
    });

    test('部分ID不存在：应只返回找到的文件', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: 'a', original_name: 'a.jpg', file_path: '/var/www/ai-platform/storage/uploads/a.jpg' }
        ]
      });

      const result = await File.findByIds(['a', 'missing']);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('a');
    });

    test('重复ID：查询应去重', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'a', original_name: 'a.jpg', file_path: '/var/www/ai-platform/storage/uploads/a.jpg' }]
      });

      const result = await File.findByIds(['a', 'a', 'a']);

      // SQL的IN查询参数应去重
      const sqlCall = mockQuery.mock.calls[0];
      expect(sqlCall[1]).toEqual(['a']); // 去重后只有1个
    });

    test('返回的File对象应有url属性', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'f1', file_path: '/var/www/ai-platform/storage/uploads/chat-images/img.jpg' }]
      });

      const result = await File.findByIds(['f1']);
      expect(result[0].url).toContain('https://');
      expect(result[0].url).toContain('img.jpg');
    });
  });

  // ========== checkOwnership() 测试 ==========
  describe('checkOwnership() - 单文件权限检查', () => {

    beforeEach(() => {
      mockQuery.mockReset();
    });

    test('文件属于用户：应返回true', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 5 }] });

      const result = await File.checkOwnership('file-1', 5);
      expect(result).toBe(true);
    });

    test('文件不属于用户：应返回false', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 10 }] });

      const result = await File.checkOwnership('file-1', 5);
      expect(result).toBe(false);
    });

    test('文件不存在：应返回false', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await File.checkOwnership('nonexist', 5);
      expect(result).toBe(false);
    });

    test('数据库异常：应返回false不抛错', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));

      const result = await File.checkOwnership('file-1', 5);
      expect(result).toBe(false);
    });
  });

  // ========== checkOwnershipBatch() 测试 ==========
  describe('checkOwnershipBatch() - 批量权限检查', () => {

    beforeEach(() => {
      mockQuery.mockReset();
    });

    test('空数组：应返回true', async () => {
      const result = await File.checkOwnershipBatch([], 5);
      expect(result).toBe(true);
    });

    test('null：应返回true', async () => {
      const result = await File.checkOwnershipBatch(null, 5);
      expect(result).toBe(true);
    });

    test('所有文件属于用户：应返回true', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: 'f1', user_id: 5 },
          { id: 'f2', user_id: 5 }
        ]
      });

      const result = await File.checkOwnershipBatch(['f1', 'f2'], 5);
      expect(result).toBe(true);
    });

    test('部分文件不存在：应返回false', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'f1', user_id: 5 }]
        // f2不存在
      });

      const result = await File.checkOwnershipBatch(['f1', 'f2'], 5);
      expect(result).toBe(false);
    });

    test('部分文件属于其他用户：应返回false', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: 'f1', user_id: 5 },
          { id: 'f2', user_id: 99 } // 属于其他用户
        ]
      });

      const result = await File.checkOwnershipBatch(['f1', 'f2'], 5);
      expect(result).toBe(false);
    });

    test('数据库异常：应返回false不抛错', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));

      const result = await File.checkOwnershipBatch(['f1'], 5);
      expect(result).toBe(false);
    });
  });

  // ========== toJSON() 测试 ==========
  describe('toJSON() - JSON序列化', () => {

    test('应包含所有必要字段', () => {
      const file = new File({
        id: 'uuid-1',
        user_id: 1,
        original_name: 'photo.jpg',
        stored_name: '1234-abc.jpg',
        file_path: '/var/www/ai-platform/storage/uploads/img.jpg',
        file_size: 1024,
        mime_type: 'image/jpeg'
      });

      const json = file.toJSON();
      expect(json.id).toBe('uuid-1');
      expect(json.original_name).toBe('photo.jpg');
      expect(json.filename).toBe('1234-abc.jpg');
      expect(json.mime_type).toBe('image/jpeg');
      expect(json.size).toBe(1024);
      expect(json.url).toContain('https://');
    });

    test('不应暴露file_path磁盘路径', () => {
      const file = new File({
        id: 'uuid-1',
        file_path: '/var/www/ai-platform/storage/uploads/secret.jpg'
      });

      const json = file.toJSON();
      expect(json.file_path).toBeUndefined();
    });
  });
});

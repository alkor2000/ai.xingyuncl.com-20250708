/**
 * ImageService - 图像生成服务单元测试
 * 
 * 测试范围：
 * - isSeedreamModel()          Seedream模型识别
 * - isWanxiangModel()          万相模型识别
 * - getSeedreamVersion()       Seedream版本号提取
 * - convertSizeForSeedream()   尺寸转换（Seedream格式）
 * - convertSizeForWanxiang()   尺寸转换（万相格式 x→*）
 * - buildWanxiangRequest()     万相API请求体构建
 * - parseWanxiangResponse()    万相API响应解析
 * - validateGenerationParams() 生成参数验证
 * 
 * Mock策略：
 * - 不测试实际API调用和图片下载
 * - 只测纯逻辑方法（模型判断、尺寸转换、参数验证、响应解析）
 */

// ========== Mock外部依赖 ==========

jest.mock('../../../models/ImageModel', () => ({
  findById: jest.fn(),
  findAll: jest.fn(),
  decryptApiKey: jest.fn()
}));

jest.mock('../../../models/ImageGeneration', () => ({
  create: jest.fn(),
  update: jest.fn(),
  findById: jest.fn()
}));

jest.mock('../../../models/User', () => ({
  findById: jest.fn()
}));

jest.mock('../../../services/ossService', () => ({
  initialize: jest.fn(),
  uploadFile: jest.fn(),
  deleteFile: jest.fn()
}));

jest.mock('../../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

// ========== 引入被测模块 ==========
const ImageService = require('../../../services/imageService');

// ========== 测试套件 ==========

describe('ImageService - 图像生成服务', () => {

  // ========== isSeedreamModel() 测试 ==========
  describe('isSeedreamModel() - Seedream模型识别', () => {

    test('doubao-seedream-4-0：应为true', () => {
      expect(ImageService.isSeedreamModel({ provider: 'volcano', model_id: 'doubao-seedream-4-0' })).toBe(true);
    });

    test('doubao-seedream-3-0：应为true', () => {
      expect(ImageService.isSeedreamModel({ provider: 'volcano', model_id: 'doubao-seedream-3-0' })).toBe(true);
    });

    test('非volcano provider：应为false', () => {
      expect(ImageService.isSeedreamModel({ provider: 'openai', model_id: 'doubao-seedream-4-0' })).toBe(false);
    });

    test('非seedream模型：应为false', () => {
      expect(ImageService.isSeedreamModel({ provider: 'volcano', model_id: 'doubao-text-2-0' })).toBe(false);
    });

    test('null/undefined：应为false', () => {
      expect(ImageService.isSeedreamModel(null)).toBe(false);
      expect(ImageService.isSeedreamModel(undefined)).toBe(false);
      expect(ImageService.isSeedreamModel({})).toBe(false);
    });
  });

  // ========== isWanxiangModel() 测试 ==========
  describe('isWanxiangModel() - 万相模型识别', () => {

    test('aliyun provider：应为true', () => {
      expect(ImageService.isWanxiangModel({ provider: 'aliyun', model_id: 'wan2.6-image' })).toBe(true);
    });

    test('dashscope provider：应为true', () => {
      expect(ImageService.isWanxiangModel({ provider: 'dashscope', model_id: 'any-model' })).toBe(true);
    });

    test('model_id以wan开头：应为true', () => {
      expect(ImageService.isWanxiangModel({ provider: 'other', model_id: 'wan2.6-image' })).toBe(true);
    });

    test('model_id以wanx开头：应为true', () => {
      expect(ImageService.isWanxiangModel({ provider: 'other', model_id: 'wanx-v1' })).toBe(true);
    });

    test('无关模型：应为false', () => {
      expect(ImageService.isWanxiangModel({ provider: 'openai', model_id: 'dall-e-3' })).toBe(false);
    });

    test('null/undefined：应为false', () => {
      expect(ImageService.isWanxiangModel(null)).toBe(false);
      expect(ImageService.isWanxiangModel(undefined)).toBe(false);
    });
  });

  // ========== getSeedreamVersion() 测试 ==========
  describe('getSeedreamVersion() - 版本号提取', () => {

    test('doubao-seedream-4-0：应返回4.0', () => {
      expect(ImageService.getSeedreamVersion('doubao-seedream-4-0')).toBe('4.0');
    });

    test('doubao-seedream-3-5：应返回3.5', () => {
      expect(ImageService.getSeedreamVersion('doubao-seedream-3-5')).toBe('3.5');
    });

    test('无法匹配的格式：应返回默认4.0', () => {
      expect(ImageService.getSeedreamVersion('unknown-model')).toBe('4.0');
    });

    test('null/undefined：应返回默认4.0', () => {
      expect(ImageService.getSeedreamVersion(null)).toBe('4.0');
      expect(ImageService.getSeedreamVersion(undefined)).toBe('4.0');
    });
  });

  // ========== convertSizeForSeedream() 测试 ==========
  describe('convertSizeForSeedream() - Seedream尺寸转换', () => {

    test('1024x1024：应返回2K', () => {
      expect(ImageService.convertSizeForSeedream('1024x1024')).toBe('2K');
    });

    test('2048x2048：应返回4K', () => {
      expect(ImageService.convertSizeForSeedream('2048x2048')).toBe('4K');
    });

    test('比例格式1:1：应返回2K', () => {
      expect(ImageService.convertSizeForSeedream('1:1')).toBe('2K');
    });

    test('已经是2K/4K格式：应原样返回', () => {
      expect(ImageService.convertSizeForSeedream('2K')).toBe('2K');
      expect(ImageService.convertSizeForSeedream('4K')).toBe('4K');
    });

    test('未知尺寸：应默认返回2K', () => {
      expect(ImageService.convertSizeForSeedream('999x999')).toBe('2K');
    });
  });

  // ========== convertSizeForWanxiang() 测试 ==========
  describe('convertSizeForWanxiang() - 万相尺寸转换', () => {

    test('x格式转*格式：1024x1024→1024*1024', () => {
      expect(ImageService.convertSizeForWanxiang('1024x1024')).toBe('1024*1024');
    });

    test('已是*格式：应原样返回', () => {
      expect(ImageService.convertSizeForWanxiang('1280*1280')).toBe('1280*1280');
    });

    test('比例格式1:1：应返回1280*1280', () => {
      expect(ImageService.convertSizeForWanxiang('1:1')).toBe('1280*1280');
    });

    test('比例格式16:9：应返回1280*720', () => {
      expect(ImageService.convertSizeForWanxiang('16:9')).toBe('1280*720');
    });

    test('null/undefined：应返回默认1280*1280', () => {
      expect(ImageService.convertSizeForWanxiang(null)).toBe('1280*1280');
      expect(ImageService.convertSizeForWanxiang(undefined)).toBe('1280*1280');
    });
  });

  // ========== buildWanxiangRequest() 测试 ==========
  describe('buildWanxiangRequest() - 万相API请求构建', () => {

    test('纯文本生成：应包含text和stream参数', () => {
      const model = { model_id: 'wan2.6-image' };
      const params = { prompt: '一只猫', size: '1:1' };
      const req = ImageService.buildWanxiangRequest(model, params);

      expect(req.model).toBe('wan2.6-image');
      expect(req.input.messages[0].content[0].text).toBe('一只猫');
      expect(req.parameters.stream).toBe(true);
      expect(req.parameters.enable_interleave).toBe(true);
      expect(req.parameters.size).toBe('1280*1280');
    });

    test('图生图（有参考图）：应包含image项且关闭interleave', () => {
      const model = { model_id: 'wan2.6-image' };
      const params = {
        prompt: '修改背景',
        size: '1:1',
        reference_images: ['https://example.com/ref.jpg']
      };
      const req = ImageService.buildWanxiangRequest(model, params);

      const content = req.input.messages[0].content;
      expect(content).toHaveLength(2);
      expect(content[0].text).toBe('修改背景');
      expect(content[1].image).toBe('https://example.com/ref.jpg');
      expect(req.parameters.enable_interleave).toBe(false);
    });

    test('多张参考图：content应包含对应数量的image项', () => {
      const model = { model_id: 'wan2.6-image' };
      const params = {
        prompt: '合并风格',
        size: '1:1',
        reference_images: ['https://a.jpg', 'https://b.jpg']
      };
      const req = ImageService.buildWanxiangRequest(model, params);

      const content = req.input.messages[0].content;
      expect(content).toHaveLength(3); // 1 text + 2 image
    });
  });

  // ========== parseWanxiangResponse() 测试 ==========
  describe('parseWanxiangResponse() - 万相API响应解析', () => {

    test('正常响应：应提取图片URL', () => {
      const response = {
        data: {
          output: {
            choices: [{
              message: {
                content: [
                  { type: 'image', image: 'https://example.com/result.jpg' }
                ]
              }
            }]
          }
        }
      };

      const url = ImageService.parseWanxiangResponse(response);
      expect(url).toBe('https://example.com/result.jpg');
    });

    test('响应为空：应抛出错误', () => {
      expect(() => ImageService.parseWanxiangResponse({ data: null }))
        .toThrow('响应为空');
    });

    test('API返回错误码：应抛出错误', () => {
      expect(() => ImageService.parseWanxiangResponse({
        data: { code: 'InvalidParameter', message: '参数错误' }
      })).toThrow('参数错误');
    });

    test('缺少choices：应抛出格式错误', () => {
      expect(() => ImageService.parseWanxiangResponse({
        data: { output: {} }
      })).toThrow('缺少choices');
    });

    test('content为空数组：应抛出错误', () => {
      expect(() => ImageService.parseWanxiangResponse({
        data: { output: { choices: [{ message: { content: [] } }] } }
      })).toThrow('缺少content');
    });

    test('content无图片：应抛出错误', () => {
      expect(() => ImageService.parseWanxiangResponse({
        data: {
          output: {
            choices: [{
              message: { content: [{ type: 'text', text: '无图' }] }
            }]
          }
        }
      })).toThrow('未返回图片URL');
    });
  });

  // ========== validateGenerationParams() 测试 ==========
  describe('validateGenerationParams() - 生成参数验证', () => {

    test('合法参数：应返回空错误数组', () => {
      const errors = ImageService.validateGenerationParams({
        prompt: '一只可爱的猫',
        seed: 42,
        quantity: 2
      });
      expect(errors).toEqual([]);
    });

    test('提示词为空：应报错', () => {
      const errors = ImageService.validateGenerationParams({ prompt: '' });
      expect(errors.some(e => e.includes('提示词'))).toBe(true);
    });

    test('提示词只有空格：应报错', () => {
      const errors = ImageService.validateGenerationParams({ prompt: '   ' });
      expect(errors.some(e => e.includes('提示词'))).toBe(true);
    });

    test('提示词超过4000字符：应报错', () => {
      const errors = ImageService.validateGenerationParams({
        prompt: 'a'.repeat(4001)
      });
      expect(errors.some(e => e.includes('4000'))).toBe(true);
    });

    test('seed超出范围：应报错', () => {
      const errors = ImageService.validateGenerationParams({
        prompt: '测试',
        seed: 2147483648
      });
      expect(errors.some(e => e.includes('种子值'))).toBe(true);
    });

    test('seed为-1（随机）：应通过', () => {
      const errors = ImageService.validateGenerationParams({
        prompt: '测试',
        seed: -1
      });
      expect(errors).toEqual([]);
    });

    test('数量超过4：应报错', () => {
      const errors = ImageService.validateGenerationParams({
        prompt: '测试',
        quantity: 5
      });
      expect(errors.some(e => e.includes('1到4'))).toBe(true);
    });

    test('参考图片URL格式不正确：应报错', () => {
      const errors = ImageService.validateGenerationParams({
        prompt: '测试',
        reference_images: ['not-a-url']
      });
      expect(errors.some(e => e.includes('URL'))).toBe(true);
    });

    test('参考图片URL合法：应通过', () => {
      const errors = ImageService.validateGenerationParams({
        prompt: '测试',
        reference_images: ['https://example.com/img.jpg']
      });
      expect(errors).toEqual([]);
    });
  });
});

/**
 * outputFormatInstructions 单元测试
 * - normalizeOutputFormat 白名单归一化
 * - buildOutputFormatInstruction 与前端画布解析器（htmlBlockParser）约定的语言标识一致
 */
const {
  OUTPUT_FORMATS,
  normalizeOutputFormat,
  buildOutputFormatInstruction,
  buildOutputFormatReminder
} = require('../../../../services/chat/outputFormatInstructions');

describe('outputFormatInstructions', () => {
  describe('normalizeOutputFormat()', () => {
    test('白名单内的值原样返回，忽略大小写与首尾空白', () => {
      expect(normalizeOutputFormat('pptx')).toBe('pptx');
      expect(normalizeOutputFormat(' DOCX ')).toBe('docx');
      expect(normalizeOutputFormat('Pdf')).toBe('pdf');
      expect(normalizeOutputFormat('html')).toBe('html');
    });

    test('非字符串、空串、白名单外的值返回 null', () => {
      expect(normalizeOutputFormat(undefined)).toBeNull();
      expect(normalizeOutputFormat(null)).toBeNull();
      expect(normalizeOutputFormat('')).toBeNull();
      expect(normalizeOutputFormat('none')).toBeNull();
      expect(normalizeOutputFormat('exe')).toBeNull();
      expect(normalizeOutputFormat(123)).toBeNull();
      expect(normalizeOutputFormat({ format: 'pptx' })).toBeNull();
    });
  });

  describe('buildOutputFormatInstruction()', () => {
    test('每种格式的指令都要求使用与格式同名的围栏语言标识', () => {
      OUTPUT_FORMATS.forEach(format => {
        const text = buildOutputFormatInstruction(format);
        expect(text).toContain('```' + format);
      });
    });

    test('pptx 指令要求用 --- 分页、内部用 ~~~ 围栏、修改时重新输出完整代码块', () => {
      const text = buildOutputFormatInstruction('pptx');
      expect(text).toContain('---');
      expect(text).toContain('~~~');
      expect(text).toContain('重新输出完整的代码块');
    });

    test('pdf 指令要求 A4 打印样式', () => {
      expect(buildOutputFormatInstruction('pdf')).toContain('@page');
    });

    test('每种格式都写死回答结构：一句话 + 一个代码块，闭合即停，不附赠脚本', () => {
      OUTPUT_FORMATS.forEach(format => {
        const text = buildOutputFormatInstruction(format);
        expect(text).toContain('回答固定为两部分');
        expect(text).toContain('代码块闭合后立即停止回答');
        expect(text).toContain('生成脚本');
      });
    });

    test('非法格式返回空串', () => {
      expect(buildOutputFormatInstruction(null)).toBe('');
      expect(buildOutputFormatInstruction('exe')).toBe('');
    });
  });

  describe('buildOutputFormatReminder()', () => {
    test('合法格式给出一行带围栏语言标识的提醒，非法格式返回空串', () => {
      expect(buildOutputFormatReminder('pptx')).toContain('```pptx');
      expect(buildOutputFormatReminder('docx')).toContain('【格式提醒】');
      expect(buildOutputFormatReminder('exe')).toBe('');
      expect(buildOutputFormatReminder(null)).toBe('');
    });
  });
});

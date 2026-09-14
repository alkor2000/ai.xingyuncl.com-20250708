/**
 * normalizeRowPayload - 行样本 payload 规范化单元测试
 *
 * 测试范围：
 * - text 列：字符串、去首尾空白、1–1000 字；空 / 纯空白 / 超长 / 对象值 报错；数字等标量转字符串；不做类别校验
 * - number / category 列：既有行为不变（转数值、空值为 null、≤50 字）
 * - 键必须在 columns 内；payload 必须是非空对象
 * - 文本数据集固定列 TEXT_COLUMNS 可直接用于 payload={text}
 *
 * Mock策略：纯函数，无外部依赖（只依赖 utils/errors 的 ValidationError）
 */

const normalizeRowPayload = require('../../../../services/aiLab/rowPayload');
const { MAX_TEXT_VALUE_LENGTH } = require('../../../../services/aiLab/rowPayload');
const { ValidationError } = require('../../../../utils/errors');

const TEXT_COLUMNS = [{ key: 'text', label: '文本', type: 'text' }];
const MIXED_COLUMNS = [
  { key: 'name', label: '名字', type: 'text' },
  { key: 'legs', label: '腿数', type: 'number' },
  { key: 'habitat', label: '环境', type: 'category' }
];

describe('normalizeRowPayload - text 列', () => {
  test('去首尾空白并原样保留内容（不做类别校验）', () => {
    expect(normalizeRowPayload({ text: '  今天食堂很好吃！  ' }, TEXT_COLUMNS)).toEqual({ text: '今天食堂很好吃！' });
    expect(normalizeRowPayload({ text: 'anything goes: 123 / ？' }, TEXT_COLUMNS)).toEqual({ text: 'anything goes: 123 / ？' });
  });

  test('标量转成字符串', () => {
    expect(normalizeRowPayload({ text: 42 }, TEXT_COLUMNS)).toEqual({ text: '42' });
    expect(normalizeRowPayload({ text: true }, TEXT_COLUMNS)).toEqual({ text: 'true' });
  });

  test('允许 1 字与 1000 字，超过 1000 字报错', () => {
    expect(normalizeRowPayload({ text: '好' }, TEXT_COLUMNS)).toEqual({ text: '好' });
    const max = '字'.repeat(MAX_TEXT_VALUE_LENGTH);
    expect(normalizeRowPayload({ text: max }, TEXT_COLUMNS)).toEqual({ text: max });
    expect(() => normalizeRowPayload({ text: max + '多' }, TEXT_COLUMNS)).toThrow(ValidationError);
    expect(() => normalizeRowPayload({ text: max + '多' }, TEXT_COLUMNS)).toThrow(/1000/);
  });

  test('空、纯空白、null、undefined 都报错（text 列不允许为空）', () => {
    expect(() => normalizeRowPayload({ text: '' }, TEXT_COLUMNS)).toThrow(/不能为空/);
    expect(() => normalizeRowPayload({ text: '   ' }, TEXT_COLUMNS)).toThrow(/不能为空/);
    expect(() => normalizeRowPayload({ text: null }, TEXT_COLUMNS)).toThrow(/不能为空/);
    expect(() => normalizeRowPayload({ text: undefined }, TEXT_COLUMNS)).toThrow(/不能为空/);
  });

  test('对象 / 数组值报错', () => {
    expect(() => normalizeRowPayload({ text: { a: 1 } }, TEXT_COLUMNS)).toThrow(/必须是字符串/);
    expect(() => normalizeRowPayload({ text: ['a'] }, TEXT_COLUMNS)).toThrow(/必须是字符串/);
  });

  test('表格数据集里的 text 列与 number / category 列可混用', () => {
    const result = normalizeRowPayload({ name: ' 狗 ', legs: '4', habitat: '陆地' }, MIXED_COLUMNS);
    expect(result).toEqual({ name: '狗', legs: 4, habitat: '陆地' });
  });
});

describe('normalizeRowPayload - 既有行为', () => {
  test('number 列转数值、空值为 null；category 列去空白且 ≤50 字', () => {
    expect(normalizeRowPayload({ legs: '12.5' }, MIXED_COLUMNS)).toEqual({ legs: 12.5 });
    expect(normalizeRowPayload({ legs: '' }, MIXED_COLUMNS)).toEqual({ legs: null });
    expect(normalizeRowPayload({ habitat: null }, MIXED_COLUMNS)).toEqual({ habitat: null });
    expect(() => normalizeRowPayload({ legs: 'abc' }, MIXED_COLUMNS)).toThrow(/必须是数字/);
    expect(() => normalizeRowPayload({ habitat: 'x'.repeat(51) }, MIXED_COLUMNS)).toThrow(/50/);
  });

  test('未定义的列、空 payload、非对象 payload、无 columns 报错', () => {
    expect(() => normalizeRowPayload({ nope: 1 }, MIXED_COLUMNS)).toThrow(/未定义的列/);
    expect(() => normalizeRowPayload({}, MIXED_COLUMNS)).toThrow(/不能为空/);
    expect(() => normalizeRowPayload('text', MIXED_COLUMNS)).toThrow(/键值对象/);
    expect(() => normalizeRowPayload([1], MIXED_COLUMNS)).toThrow(/键值对象/);
    expect(() => normalizeRowPayload({ text: 'a' }, [])).toThrow(/尚未定义列/);
  });
});

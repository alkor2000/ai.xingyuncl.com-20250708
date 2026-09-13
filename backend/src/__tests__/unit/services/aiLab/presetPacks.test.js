/**
 * presetPacks - 预置数据包纯函数单元测试
 *
 * 测试范围：
 * - isValidPackKey：包 key 只允许 [a-z0-9_-]{1,50}，拒绝 '..'、'/'、大写、空
 * - isSafeRelativePath / resolvePackFile：manifest 文件路径防目录穿越
 *     拒绝 '..' 段、绝对路径、Windows 盘符与反斜杠、'.' 段、空段、NUL、过长；
 *     解析结果必须落在包目录内
 * - selectPerClass：每类最多取前 N 个，N 为空/非法时取全部
 * - computeCounts：图像包按 files 计数，表格包按 rows 计数
 *
 * Mock策略：无外部依赖（只用 path），纯逻辑测试
 */

const path = require('path');
const {
  isValidPackKey,
  isSafeRelativePath,
  resolvePackFile,
  selectPerClass,
  computeCounts
} = require('../../../../services/aiLab/presetPacks');

const PACK_DIR = path.resolve('/srv/presets/ai-lab/shapes');

describe('presetPacks - 预置数据包工具', () => {

  describe('isValidPackKey - 包 key', () => {
    test('接受小写字母、数字、下划线、短横线', () => {
      expect(isValidPackKey('shapes')).toBe(true);
      expect(isValidPackKey('fruits-mini')).toBe(true);
      expect(isValidPackKey('_test-shapes')).toBe(true);
      expect(isValidPackKey('iris2')).toBe(true);
    });

    test('拒绝穿越与非法字符', () => {
      expect(isValidPackKey('..')).toBe(false);
      expect(isValidPackKey('../etc')).toBe(false);
      expect(isValidPackKey('a/b')).toBe(false);
      expect(isValidPackKey('a\\b')).toBe(false);
      expect(isValidPackKey('Shapes')).toBe(false);
      expect(isValidPackKey('a b')).toBe(false);
      expect(isValidPackKey('')).toBe(false);
      expect(isValidPackKey(null)).toBe(false);
      expect(isValidPackKey(123)).toBe(false);
      expect(isValidPackKey('x'.repeat(51))).toBe(false);
    });
  });

  describe('isSafeRelativePath - 相对路径', () => {
    test('接受包内的相对路径', () => {
      expect(isSafeRelativePath('train/apple/0001.jpg')).toBe(true);
      expect(isSafeRelativePath('shift/color/apple/0001.jpg')).toBe(true);
      expect(isSafeRelativePath('a.jpg')).toBe(true);
      expect(isSafeRelativePath('train/my file (1).png')).toBe(true);
    });

    test('拒绝 .. 段', () => {
      expect(isSafeRelativePath('../manifest.json')).toBe(false);
      expect(isSafeRelativePath('train/../../secret')).toBe(false);
      expect(isSafeRelativePath('..')).toBe(false);
      expect(isSafeRelativePath('train/..')).toBe(false);
    });

    test('拒绝绝对路径、盘符与反斜杠', () => {
      expect(isSafeRelativePath('/etc/passwd')).toBe(false);
      expect(isSafeRelativePath('C:/x.jpg')).toBe(false);
      expect(isSafeRelativePath('train\\apple\\1.jpg')).toBe(false);
      expect(isSafeRelativePath('..\\x')).toBe(false);
    });

    test('拒绝空、点段、空段、NUL、过长', () => {
      expect(isSafeRelativePath('')).toBe(false);
      expect(isSafeRelativePath('.')).toBe(false);
      expect(isSafeRelativePath('./a.jpg')).toBe(false);
      expect(isSafeRelativePath('train//a.jpg')).toBe(false);
      expect(isSafeRelativePath('train/a.jpg/')).toBe(false);
      expect(isSafeRelativePath('a\0.jpg')).toBe(false);
      expect(isSafeRelativePath('a/'.repeat(100) + 'x.jpg')).toBe(false);
      expect(isSafeRelativePath(null)).toBe(false);
      expect(isSafeRelativePath(42)).toBe(false);
    });
  });

  describe('resolvePackFile - 解析并确认在包目录内', () => {
    test('合法路径解析到包目录下', () => {
      const abs = resolvePackFile(PACK_DIR, 'train/circle/0001.jpg');
      expect(abs).toBe(path.join(PACK_DIR, 'train', 'circle', '0001.jpg'));
      expect(abs.startsWith(PACK_DIR + path.sep)).toBe(true);
    });

    test('穿越路径抛错', () => {
      expect(() => resolvePackFile(PACK_DIR, '../other/manifest.json')).toThrow(/无效/);
      expect(() => resolvePackFile(PACK_DIR, 'train/../../x.jpg')).toThrow(/无效/);
      expect(() => resolvePackFile(PACK_DIR, '/etc/passwd')).toThrow(/无效/);
      expect(() => resolvePackFile(PACK_DIR, 'a\\..\\b')).toThrow(/无效/);
      expect(() => resolvePackFile(PACK_DIR, '')).toThrow(/无效/);
    });

    test('包目录带尾部斜杠或相对形式时结果一致', () => {
      const a = resolvePackFile(PACK_DIR + '/', 'train/a.jpg');
      const b = resolvePackFile(PACK_DIR, 'train/a.jpg');
      expect(a).toBe(b);
    });
  });

  describe('selectPerClass - 每类上限', () => {
    const list = ['a', 'b', 'c', 'd'];

    test('取前 N 个并保持顺序', () => {
      expect(selectPerClass(list, 2)).toEqual(['a', 'b']);
      expect(selectPerClass(list, 2.9)).toEqual(['a', 'b']);
      expect(selectPerClass(list, 10)).toEqual(list);
    });

    test('N 为空/非法/非正数时取全部', () => {
      expect(selectPerClass(list, null)).toEqual(list);
      expect(selectPerClass(list, undefined)).toEqual(list);
      expect(selectPerClass(list, 0)).toEqual(list);
      expect(selectPerClass(list, -3)).toEqual(list);
      expect(selectPerClass(list, 'abc')).toEqual(list);
    });

    test('返回副本且容忍非数组', () => {
      const copy = selectPerClass(list, null);
      copy.push('z');
      expect(list).toHaveLength(4);
      expect(selectPerClass(null, 3)).toEqual([]);
    });
  });

  describe('computeCounts - 计数', () => {
    test('图像包按 files 计数', () => {
      const counts = computeCounts({
        kind: 'image',
        files: {
          train: { circle: ['1', '2', '3'], square: ['1'] },
          shift: { color: { circle: ['1', '2'], square: [] } }
        }
      });
      expect(counts).toEqual({
        train: { circle: 3, square: 1 },
        shift: { color: { circle: 2, square: 0 } }
      });
    });

    test('表格包按 rows 计数', () => {
      const counts = computeCounts({
        kind: 'table',
        rows: {
          train: [{ class_key: 'adelie' }, { class_key: 'adelie' }, { class_key: 'gentoo' }],
          shift: { '2009年': [{ class_key: 'gentoo' }] }
        }
      });
      expect(counts).toEqual({
        train: { adelie: 2, gentoo: 1 },
        shift: { '2009年': { gentoo: 1 } }
      });
    });

    test('缺字段或非法输入返回空计数', () => {
      expect(computeCounts(null)).toEqual({ train: {}, shift: {} });
      expect(computeCounts({ kind: 'image' })).toEqual({ train: {}, shift: {} });
      expect(computeCounts({ kind: 'table', rows: { train: 'nope' } })).toEqual({ train: {}, shift: {} });
    });
  });
});

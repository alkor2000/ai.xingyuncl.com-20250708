/**
 * AI训练专区预置数据包服务
 *
 * 包目录：backend/presets/ai-lab/<pack_key>/manifest.json（目录名即 pack_key）
 *
 * 职责：
 * - 列出 / 读取包：解析并规范化 manifest，带 mtime 缓存
 *     · image / audio 包：files.train / files.shift（音频包可带 durations {相对路径: ms}）
 *     · table / text 包：columns + rows.train / rows.shift（text 包 columns 缺省为 TEXT_COLUMNS）
 * - 安全：pack_key 只允许 [a-z0-9_-]，manifest 中的文件路径只允许包目录内的相对路径（presetPacks.resolvePackFile）
 * - 导入：把包内容导入数据集
 *     · 图像：sharp 规范为最长边 320 的 JPEG（与上传管线一致），落到 uploads/ai-lab/<user_id>/<dataset_id>/preset-<pack>-<n>.jpg
 *     · 音频：原样复制字节（不转码），落到 preset-<pack>-<n>.<wav|webm|ogg|mp3>，duration_ms 取 manifest.durations（没有则 NULL）
 *     · 表格 / 文本：行样本 file_path=NULL，payload 按数据集 columns 规范化
 *     · origin_ref = <pack_key>:<包内相对路径>（行样本为 <pack_key>:rows/train/<i> 或 rows/shift/<set>/<i>），
 *       同一 origin_ref 已在数据集（未删除）里则跳过 —— 重复导入 / 逐步加大 per_class 不产生重复样本
 *     · 类别按 key 合并进数据集（不改已有 label）；表格列同样按 key 合并
 *     · 数据集 kind 与包不一致：数据集为空（sample_count=0）时以包的 kind 覆盖，否则报错
 *     · 事务写入样本 + sample_count + 数据集变更；失败则删除已落盘的文件
 */

const path = require('path');
const fs = require('fs').promises;
const sharp = require('sharp');
const dbConnection = require('../../database/connection');
const logger = require('../../utils/logger');
const { ValidationError } = require('../../utils/errors');
const AiLabDataset = require('../../models/AiLabDataset');
const AiLabSample = require('../../models/AiLabSample');
const AiLabService = require('./AiLabService');
const { MAX_EDGE, JPEG_QUALITY } = require('../../middleware/aiLabUploadMiddleware');
const presetPacks = require('./presetPacks');

const {
  isValidPackKey, isSafeRelativePath, resolvePackFile, selectPerClass, computeCounts,
  packUsesRows, fileExtension, AUDIO_FILE_EXTENSIONS
} = presetPacks;

const DEFAULT_PRESETS_ROOT = path.resolve(__dirname, '../../../presets/ai-lab');
const MANIFEST_FILE = 'manifest.json';
const MAX_SHIFT_SET_LENGTH = 50;
const MAX_PACK_ROWS = 5000;
const PACK_KINDS = ['image', 'table', 'audio', 'text'];
const MIN_DURATION_MS = 1;
const MAX_DURATION_MS = 600000;

/** manifest 缓存：key → { mtimeMs, pack } */
const cache = new Map();

class AiLabPresetService {
  static getPresetsRoot() {
    return AiLabPresetService.presetsRoot || DEFAULT_PRESETS_ROOT;
  }

  /** 仅供测试替换包目录 */
  static setPresetsRoot(dir) {
    AiLabPresetService.presetsRoot = dir || null;
    cache.clear();
  }

  /* ================================================================
   * manifest 规范化
   * ================================================================ */

  static cleanText(value, max = 2000) {
    if (value === undefined || value === null) return '';
    return String(value).trim().slice(0, max);
  }

  static isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  /**
   * 校验并规范化 manifest（抛 ValidationError 表示包无效）
   * @param {Object} raw - JSON 内容
   * @param {string} dirKey - 目录名（作为 key）
   */
  static normalizeManifest(raw, dirKey) {
    if (!AiLabPresetService.isPlainObject(raw)) throw new ValidationError('manifest 必须是 JSON 对象');
    if (raw.key !== undefined && raw.key !== dirKey) {
      logger.warn('预置包 manifest.key 与目录名不一致，以目录名为准', { dirKey, manifestKey: raw.key });
    }
    const kind = PACK_KINDS.includes(raw.kind) ? raw.kind : null;
    if (!kind) throw new ValidationError(`预置包 ${dirKey} 的 kind 只能是 image、table、audio 或 text`);

    const classes = AiLabDataset.validateClasses(raw.classes || []);
    if (classes.length === 0) throw new ValidationError(`预置包 ${dirKey} 至少要有一个类别`);
    const classKeys = new Set(classes.map(cls => cls.key));

    const gradeBands = Array.isArray(raw.grade_bands)
      ? raw.grade_bands.map(item => AiLabPresetService.cleanText(item, 10)).filter(Boolean)
      : [];

    const pack = {
      key: dirKey,
      kind,
      title: AiLabPresetService.cleanText(raw.title, 200) || dirKey,
      description: AiLabPresetService.cleanText(raw.description),
      license: AiLabPresetService.cleanText(raw.license, 200),
      source: AiLabPresetService.cleanText(raw.source, 500),
      attribution: AiLabPresetService.cleanText(raw.attribution, 500),
      grade_bands: gradeBands,
      classes,
      columns: null,
      files: null,
      rows: null,
      durations: null,
      condition_tags: { train: null, shift: {} }
    };

    /* condition_tags */
    const rawTags = AiLabPresetService.isPlainObject(raw.condition_tags) ? raw.condition_tags : {};
    pack.condition_tags.train = AiLabService.validateConditionTags(rawTags.train) ?? null;
    const rawShiftTags = AiLabPresetService.isPlainObject(rawTags.shift) ? rawTags.shift : {};
    Object.keys(rawShiftTags).forEach(setName => {
      pack.condition_tags.shift[setName] = AiLabService.validateConditionTags(rawShiftTags[setName]) ?? null;
    });

    const checkSetName = (setName) => {
      const name = String(setName).trim();
      if (!name || name.length > MAX_SHIFT_SET_LENGTH) {
        throw new ValidationError(`预置包 ${dirKey} 的 shift 集合名无效: ${setName}`);
      }
      return name;
    };
    const checkClassKey = (key, where) => {
      if (!classKeys.has(key)) throw new ValidationError(`预置包 ${dirKey} 的 ${where} 含未声明的类别: ${key}`);
    };

    if (!packUsesRows(kind)) {
      const files = AiLabPresetService.isPlainObject(raw.files) ? raw.files : {};
      const normalizeGroup = (group, where) => {
        const result = {};
        if (!AiLabPresetService.isPlainObject(group)) return result;
        Object.keys(group).forEach(key => {
          checkClassKey(key, where);
          const list = Array.isArray(group[key]) ? group[key] : [];
          list.forEach(rel => {
            if (!isSafeRelativePath(rel)) {
              throw new ValidationError(`预置包 ${dirKey} 的文件路径无效: ${String(rel).slice(0, 80)}`);
            }
            if (kind === 'audio' && !AUDIO_FILE_EXTENSIONS.includes(fileExtension(rel))) {
              throw new ValidationError(`预置包 ${dirKey} 的音频文件扩展名无效: ${String(rel).slice(0, 80)}`);
            }
          });
          result[key] = list.slice();
        });
        return result;
      };
      const shift = {};
      const rawShift = AiLabPresetService.isPlainObject(files.shift) ? files.shift : {};
      Object.keys(rawShift).forEach(setName => {
        const name = checkSetName(setName);
        shift[name] = normalizeGroup(rawShift[setName], `files.shift.${name}`);
      });
      pack.files = { train: normalizeGroup(files.train, 'files.train'), shift };

      /* 音频包：可选 durations {相对路径: 毫秒} */
      if (kind === 'audio' && raw.durations !== undefined && raw.durations !== null) {
        if (!AiLabPresetService.isPlainObject(raw.durations)) {
          throw new ValidationError(`预置包 ${dirKey} 的 durations 必须是 {相对路径: 毫秒} 对象`);
        }
        const durations = {};
        Object.keys(raw.durations).forEach(rel => {
          const ms = Number(raw.durations[rel]);
          if (!Number.isInteger(ms) || ms < MIN_DURATION_MS || ms > MAX_DURATION_MS) {
            throw new ValidationError(`预置包 ${dirKey} 的 durations[${String(rel).slice(0, 80)}] 无效`);
          }
          durations[rel] = ms;
        });
        pack.durations = durations;
      }
    } else {
      pack.columns = kind === 'text' && (raw.columns === undefined || raw.columns === null)
        ? AiLabDataset.TEXT_COLUMNS.map(col => ({ ...col }))
        : AiLabDataset.validateColumns(raw.columns || []);
      if (pack.columns.length === 0) throw new ValidationError(`预置包 ${dirKey} 缺少 columns`);
      if (kind === 'text' && !pack.columns.some(col => col.type === 'text')) {
        throw new ValidationError(`预置包 ${dirKey} 是文本包，columns 必须含 text 类型的列`);
      }
      const rows = AiLabPresetService.isPlainObject(raw.rows) ? raw.rows : {};
      const normalizeRows = (list, where) => {
        if (list === undefined || list === null) return [];
        if (!Array.isArray(list)) throw new ValidationError(`预置包 ${dirKey} 的 ${where} 必须是数组`);
        if (list.length > MAX_PACK_ROWS) throw new ValidationError(`预置包 ${dirKey} 的 ${where} 超过 ${MAX_PACK_ROWS} 行`);
        return list.map((row, index) => {
          if (!AiLabPresetService.isPlainObject(row)) throw new ValidationError(`预置包 ${dirKey} 的 ${where}[${index}] 无效`);
          const classKey = String(row.class_key || '');
          checkClassKey(classKey, `${where}[${index}]`);
          let payload;
          try {
            payload = AiLabService.normalizeRowPayload(row.payload, pack.columns);
          } catch (error) {
            throw new ValidationError(`预置包 ${dirKey} 的 ${where}[${index}]：${error.message}`);
          }
          return { class_key: classKey, payload };
        });
      };
      const shift = {};
      const rawShift = AiLabPresetService.isPlainObject(rows.shift) ? rows.shift : {};
      Object.keys(rawShift).forEach(setName => {
        const name = checkSetName(setName);
        shift[name] = normalizeRows(rawShift[setName], `rows.shift.${name}`);
      });
      pack.rows = { train: normalizeRows(rows.train, 'rows.train'), shift };
    }

    return pack;
  }

  /* ================================================================
   * 读取
   * ================================================================ */

  /**
   * 读取并规范化一个包；目录或 manifest 不存在返回 null；manifest 无效抛 ValidationError
   */
  static async loadPack(packKey) {
    if (!isValidPackKey(packKey)) return null;
    const root = AiLabPresetService.getPresetsRoot();
    const packDir = path.join(root, packKey);
    if (path.relative(root, packDir).startsWith('..')) return null;
    const manifestPath = path.join(packDir, MANIFEST_FILE);

    let stat;
    try {
      stat = await fs.stat(manifestPath);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
      throw error;
    }

    const cached = cache.get(packKey);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.pack;

    let raw;
    try {
      raw = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    } catch (error) {
      throw new ValidationError(`预置包 ${packKey} 的 manifest.json 不是合法 JSON`);
    }
    const pack = AiLabPresetService.normalizeManifest(raw, packKey);
    pack.dir = packDir;
    cache.set(packKey, { mtimeMs: stat.mtimeMs, pack });
    return pack;
  }

  /**
   * 对外摘要：manifest 去掉 files/rows/dir，附 counts 与 shift_sets
   */
  static summarize(pack) {
    const { files, rows, dir, durations, ...rest } = pack; // eslint-disable-line no-unused-vars
    const counts = computeCounts(pack);
    return { ...rest, counts, shift_sets: Object.keys(counts.shift) };
  }

  /**
   * 列出全部包（可按 kind 过滤）；无效的包只记日志并跳过
   */
  static async listPacks({ kind } = {}) {
    const root = AiLabPresetService.getPresetsRoot();
    let entries;
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }

    const packs = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || !isValidPackKey(entry.name)) continue;
      try {
        const pack = await AiLabPresetService.loadPack(entry.name);
        if (!pack) continue;
        if (kind && pack.kind !== kind) continue;
        packs.push(AiLabPresetService.summarize(pack));
      } catch (error) {
        logger.warn('预置包无效，已跳过', { pack: entry.name, error: error.message });
      }
    }
    packs.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return packs;
  }

  /* ================================================================
   * 导入
   * ================================================================ */

  /** 只导入包里的部分类别（如低年级两类入门）；classKeys 为空则全部 */
  static pickClasses(pack, classKeys) {
    if (!Array.isArray(classKeys) || classKeys.length === 0) return pack.classes;
    return pack.classes.filter(cls => classKeys.includes(cls.key));
  }

  /**
   * 计算要导入的条目（未去重）
   * @returns {Array<{split:string, shift_set:string|null, class_key:string, ref:string, rel?:string, payload?:Object, condition_tags:Object|null}>}
   */
  static planItems(pack, { perClass, shiftSets, includeTrain, classKeys = null }) {
    const items = [];
    const classes = AiLabPresetService.pickClasses(pack, classKeys);
    const pushGroup = (split, shiftSet, tags) => {
      classes.forEach(cls => {
        if (!packUsesRows(pack.kind)) {
          const group = split === 'train' ? pack.files.train : (pack.files.shift[shiftSet] || {});
          selectPerClass(group[cls.key] || [], perClass).forEach(rel => {
            items.push({ split, shift_set: shiftSet, class_key: cls.key, ref: `${pack.key}:${rel}`, rel, condition_tags: tags });
          });
        } else {
          const list = split === 'train' ? pack.rows.train : (pack.rows.shift[shiftSet] || []);
          const indexed = list.map((row, index) => ({ row, index })).filter(item => item.row.class_key === cls.key);
          selectPerClass(indexed, perClass).forEach(({ row, index }) => {
            const refPath = split === 'train' ? `rows/train/${index}` : `rows/shift/${shiftSet}/${index}`;
            items.push({ split, shift_set: shiftSet, class_key: cls.key, ref: `${pack.key}:${refPath}`, payload: row.payload, condition_tags: tags });
          });
        }
      });
    };

    if (includeTrain) pushGroup('train', null, pack.condition_tags.train);
    shiftSets.forEach(setName => pushGroup('shift', setName, pack.condition_tags.shift[setName] || null));
    return items;
  }

  /**
   * 目录内 preset-<pack>-<n>.<ext> 的下一个序号（图片 jpg 与音频扩展名共用一个序号空间）
   */
  static async nextFileIndex(absoluteDir, packKey) {
    let max = 0;
    try {
      const names = await fs.readdir(absoluteDir);
      /* packKey 已由 isValidPackKey 限定为 [a-z0-9_-]，可直接拼进正则 */
      const pattern = new RegExp(`^preset-${packKey}-(\\d+)\\.(?:jpg|${AUDIO_FILE_EXTENSIONS.join('|')})$`);
      names.forEach(name => {
        const match = pattern.exec(name);
        if (match) max = Math.max(max, parseInt(match[1], 10) || 0);
      });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return max + 1;
  }

  /**
   * 把包内图片规范化后写入数据集目录
   * @returns {Array<{file_path, width, height, file_size}>} 与 items 顺序一致
   */
  static async storePackImages(pack, items, userId, datasetId) {
    const relativeDir = path.posix.join('ai-lab', String(userId), String(datasetId));
    const absoluteDir = path.join(AiLabService.getUploadsDir(), relativeDir);
    await AiLabService.ensureDir(absoluteDir);

    let index = await AiLabPresetService.nextFileIndex(absoluteDir, pack.key);
    const stored = [];
    try {
      for (const item of items) {
        const source = resolvePackFile(pack.dir, item.rel);
        let output;
        try {
          output = await sharp(source)
            .rotate()
            .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: JPEG_QUALITY })
            .toBuffer({ resolveWithObject: true });
        } catch (error) {
          throw new Error(`预置包 ${pack.key} 的文件无法读取: ${item.rel}`);
        }
        const fileName = `preset-${pack.key}-${index}.jpg`;
        index += 1;
        await fs.writeFile(path.join(absoluteDir, fileName), output.data);
        stored.push({
          file_path: path.posix.join(relativeDir, fileName),
          width: output.info.width,
          height: output.info.height,
          file_size: output.data.length
        });
      }
    } catch (error) {
      await AiLabService.removeFiles(stored.map(item => item.file_path));
      throw error;
    }
    return stored;
  }

  /**
   * 把包内音频原样复制到数据集目录（不转码）
   * @returns {Array<{file_path, file_size, duration_ms}>} 与 items 顺序一致
   */
  static async storePackAudio(pack, items, userId, datasetId) {
    const relativeDir = path.posix.join('ai-lab', String(userId), String(datasetId));
    const absoluteDir = path.join(AiLabService.getUploadsDir(), relativeDir);
    await AiLabService.ensureDir(absoluteDir);

    let index = await AiLabPresetService.nextFileIndex(absoluteDir, pack.key);
    const stored = [];
    try {
      for (const item of items) {
        const source = resolvePackFile(pack.dir, item.rel);
        const ext = fileExtension(item.rel);
        if (!AUDIO_FILE_EXTENSIONS.includes(ext)) throw new Error(`预置包 ${pack.key} 的音频扩展名无效: ${item.rel}`);
        let data;
        try {
          data = await fs.readFile(source);
        } catch (error) {
          throw new Error(`预置包 ${pack.key} 的文件无法读取: ${item.rel}`);
        }
        const fileName = `preset-${pack.key}-${index}.${ext}`;
        index += 1;
        await fs.writeFile(path.join(absoluteDir, fileName), data);
        stored.push({
          file_path: path.posix.join(relativeDir, fileName),
          file_size: data.length,
          duration_ms: pack.durations && pack.durations[item.rel] !== undefined ? pack.durations[item.rel] : null
        });
      }
    } catch (error) {
      await AiLabService.removeFiles(stored.map(item => item.file_path));
      throw error;
    }
    return stored;
  }

  /**
   * 导入包到数据集
   * @param {Object} params - { userId, dataset, pack, perClass, shiftSets, includeTrain, classKeys }
   * @returns {{imported:{train:number, shift:Object}, skipped:{train:number, shift:Object}, dataset:Object}}
   */
  static async importPack({ userId, dataset, pack, perClass = null, shiftSets = [], includeTrain = true, classKeys = null }) {
    /* 1. kind 与 columns / classes 的变更 */
    const datasetUpdates = {};
    let columns = Array.isArray(dataset.columns) ? dataset.columns : [];
    const usesRows = packUsesRows(pack.kind);
    if (dataset.kind !== pack.kind) {
      if (dataset.sample_count > 0) {
        throw new ValidationError(`数据集类型为 ${dataset.kind}，不能导入 ${pack.kind} 类型的预置包（仅空数据集可切换类型）`);
      }
      datasetUpdates.kind = pack.kind;
      columns = usesRows ? pack.columns : [];
      datasetUpdates.columns = usesRows ? columns : null;
    } else if (pack.kind === 'table') {
      const merged = AiLabService.mergeByKey(columns, pack.columns);
      if (merged.length !== columns.length) {
        columns = merged;
        datasetUpdates.columns = merged;
      }
    } else if (pack.kind === 'text' && columns.length === 0) {
      /* 文本数据集的列固定；旧数据缺列时补齐 */
      columns = AiLabDataset.TEXT_COLUMNS.map(col => ({ ...col }));
      datasetUpdates.columns = columns;
    }
    /* 空数据集：模板带的占位类别（物品A/物品B…）直接换成包里的类别；已有样本则按 key 合并 */
    const packClasses = AiLabPresetService.pickClasses(pack, classKeys);
    const mergedClasses = (dataset.sample_count || 0) === 0
      ? packClasses.map(cls => ({ ...cls }))
      : AiLabService.mergeByKey(dataset.classes, packClasses);
    if (JSON.stringify(mergedClasses) !== JSON.stringify(dataset.classes)) datasetUpdates.classes = mergedClasses;

    /* 2. 计划 + 去重 */
    const planned = AiLabPresetService.planItems(pack, { perClass, shiftSets, includeTrain, classKeys });
    const existingRefs = await AiLabSample.findOriginRefs(dataset.id);
    const imported = { train: 0, shift: {} };
    const skipped = { train: 0, shift: {} };
    shiftSets.forEach(setName => {
      imported.shift[setName] = 0;
      skipped.shift[setName] = 0;
    });
    const items = [];
    planned.forEach(item => {
      if (existingRefs.has(item.ref)) {
        if (item.split === 'train') skipped.train += 1;
        else skipped.shift[item.shift_set] += 1;
        return;
      }
      existingRefs.add(item.ref);
      items.push(item);
    });

    /* 3. 行样本按最终 columns 再规范化一次（columns 合并后可能多了列，键仍需在其中） */
    if (usesRows) {
      items.forEach(item => {
        item.payload = AiLabService.normalizeRowPayload(item.payload, columns);
      });
    }

    /* 4. 文件落盘（图片经 sharp 规范化；音频原样复制） */
    let stored = [];
    if (pack.kind === 'image' && items.length > 0) {
      stored = await AiLabPresetService.storePackImages(pack, items, userId, dataset.id);
    } else if (pack.kind === 'audio' && items.length > 0) {
      stored = await AiLabPresetService.storePackAudio(pack, items, userId, dataset.id);
    }

    /* 5. 事务写入 */
    try {
      await dbConnection.transaction(async (query) => {
        if (items.length > 0) {
          await AiLabSample.insertMany(items.map((item, index) => ({
            dataset_id: dataset.id,
            user_id: userId,
            class_key: item.class_key,
            split: item.split,
            shift_set: item.shift_set,
            condition_tags: item.condition_tags,
            source: 'preset',
            origin_ref: item.ref,
            file_path: usesRows ? null : stored[index].file_path,
            width: pack.kind === 'image' ? stored[index].width : null,
            height: pack.kind === 'image' ? stored[index].height : null,
            file_size: usesRows ? null : stored[index].file_size,
            duration_ms: pack.kind === 'audio' ? stored[index].duration_ms : null,
            payload: usesRows ? item.payload : null,
            added_version: dataset.version
          })), query);
          await AiLabDataset.adjustSampleCount(dataset.id, items.length, query);
        }
        if (Object.keys(datasetUpdates).length > 0) {
          await AiLabDataset.update(dataset.id, datasetUpdates, query);
        }
      });
    } catch (error) {
      await AiLabService.removeFiles(stored.map(item => item.file_path));
      throw error;
    }

    items.forEach(item => {
      if (item.split === 'train') imported.train += 1;
      else imported.shift[item.shift_set] += 1;
    });

    const updated = await AiLabDataset.findById(dataset.id);
    updated.counts = await AiLabDataset.getCounts(updated.id, updated.classes);

    logger.info('导入预置数据包', {
      datasetId: dataset.id, userId, pack: pack.key, perClass, shiftSets, includeTrain, classKeys,
      imported, skipped
    });
    return { imported, skipped, dataset: updated };
  }
}

AiLabPresetService.presetsRoot = null;
AiLabPresetService.DEFAULT_PRESETS_ROOT = DEFAULT_PRESETS_ROOT;

module.exports = AiLabPresetService;

/**
 * AI训练专区服务层
 *
 * 职责：
 * - 权限判断：canAccess（所有者 / super_admin / 本组 admin 可读）、canWrite（仅所有者）
 * - 样本图片 / 音频与模型 artifact 落盘（相对 storage/uploads 的 ai-lab/... 路径，由 /uploads 静态服务直出）
 * - 留出划分编排：候选样本 → splitHoldout（纯函数）→ 数据集 lock
 * - 混入错标编排：候选样本 → pickMislabels（纯函数）→ 批量改标（version 不变）
 * - 评测指标合并进 models.metrics 并计算 generalization_gap
 * - 项目 summary 缓存重算
 * - condition_tags 校验；行 payload 按 columns 规范化（rowPayload.js，含 text 列）；classes/columns 按 key 合并
 *
 * 文件路径约定（契约 §1 / v3 §3）：
 * - 图片样本：ai-lab/<user_id>/<dataset_id>/<时间戳>-<随机>.jpg
 * - 音频样本：ai-lab/<user_id>/<dataset_id>/<uuid>.<wav|webm|ogg|mp3>（原样落盘，不转码）
 * - 模型：ai-lab/<user_id>/<project_id>/models/v<version>.json
 */

const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const config = require('../../config');
const logger = require('../../utils/logger');
const { ValidationError } = require('../../utils/errors');
const AiLabProject = require('../../models/AiLabProject');
const AiLabDataset = require('../../models/AiLabDataset');
const AiLabSample = require('../../models/AiLabSample');
const AiLabModel = require('../../models/AiLabModel');
const splitHoldout = require('./splitHoldout');
const pickMislabels = require('./mislabel');
const normalizeRowPayload = require('./rowPayload');

const MAX_CONDITION_TAG_KEYS = 20;
const MAX_CONDITION_TAG_KEY_LENGTH = 32;
const MAX_CONDITION_TAG_VALUE_LENGTH = 50;
const MAX_SEED = 2147483647;
const AUDIO_EXTENSIONS = ['wav', 'webm', 'ogg', 'mp3'];

class AiLabService {
  /* ================================================================
   * 权限
   * ================================================================ */

  /**
   * 读权限：所有者、super_admin、或本组 admin
   */
  static canAccess(user, project) {
    if (!user || !project) return false;
    if (Number(project.user_id) === Number(user.id)) return true;
    if (user.role === 'super_admin') return true;
    if (user.role === 'admin' && user.group_id !== null && user.group_id !== undefined
        && project.group_id !== null && project.group_id !== undefined
        && Number(project.group_id) === Number(user.group_id)) {
      return true;
    }
    return false;
  }

  /**
   * 写权限：仅所有者
   */
  static canWrite(user, project) {
    if (!user || !project) return false;
    return Number(project.user_id) === Number(user.id);
  }

  /* ================================================================
   * 文件落盘
   * ================================================================ */

  /**
   * 上传根目录（config.storage.paths.uploads，兜底 config.upload.uploadDir）
   */
  static getUploadsDir() {
    return (config.storage && config.storage.paths && config.storage.paths.uploads)
      || (config.upload && config.upload.uploadDir)
      || path.join(process.cwd(), 'storage', 'uploads');
  }

  static async ensureDir(dirPath) {
    await fs.mkdir(dirPath, { recursive: true });
  }

  /**
   * 把 sharp 处理后的 JPEG 缓冲写到 ai-lab/<user_id>/<dataset_id>/ 下
   * @param {number} userId
   * @param {number} datasetId
   * @param {Array<{buffer:Buffer,width:number,height:number,size:number}>} images
   * @returns {Array<{file_path:string,width:number,height:number,file_size:number}>}
   */
  static async storeSampleImages(userId, datasetId, images) {
    const relativeDir = path.posix.join('ai-lab', String(userId), String(datasetId));
    const absoluteDir = path.join(AiLabService.getUploadsDir(), relativeDir);
    await AiLabService.ensureDir(absoluteDir);

    const stored = [];
    try {
      for (const image of images) {
        const fileName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.jpg`;
        await fs.writeFile(path.join(absoluteDir, fileName), image.buffer);
        stored.push({
          file_path: path.posix.join(relativeDir, fileName),
          width: image.width,
          height: image.height,
          file_size: image.size
        });
      }
    } catch (error) {
      await AiLabService.removeFiles(stored.map(item => item.file_path));
      logger.error('样本图片落盘失败:', error);
      throw error;
    }
    return stored;
  }

  /**
   * 把音频文件原样写到 ai-lab/<user_id>/<dataset_id>/<uuid>.<ext> 下（不转码）
   * @param {number} userId
   * @param {number} datasetId
   * @param {Array<{buffer:Buffer,ext:string,size:number}>} files
   * @returns {Array<{file_path:string,file_size:number}>}
   */
  static async storeSampleAudio(userId, datasetId, files) {
    const relativeDir = path.posix.join('ai-lab', String(userId), String(datasetId));
    const absoluteDir = path.join(AiLabService.getUploadsDir(), relativeDir);
    await AiLabService.ensureDir(absoluteDir);

    const stored = [];
    try {
      for (const file of files) {
        const ext = String(file.ext || '').toLowerCase();
        if (!AUDIO_EXTENSIONS.includes(ext)) throw new ValidationError(`不支持的音频扩展名: ${ext}`);
        const fileName = `${crypto.randomUUID()}.${ext}`;
        await fs.writeFile(path.join(absoluteDir, fileName), file.buffer);
        stored.push({
          file_path: path.posix.join(relativeDir, fileName),
          file_size: file.buffer.length
        });
      }
    } catch (error) {
      await AiLabService.removeFiles(stored.map(item => item.file_path));
      if (!(error instanceof ValidationError)) logger.error('样本音频落盘失败:', error);
      throw error;
    }
    return stored;
  }

  /**
   * 删除相对 uploads 的文件（失败只记日志）
   */
  static async removeFiles(relativePaths = []) {
    const base = AiLabService.getUploadsDir();
    for (const relativePath of relativePaths) {
      if (!relativePath) continue;
      try {
        await fs.unlink(path.join(base, relativePath));
      } catch (error) {
        if (error.code !== 'ENOENT') logger.warn('删除AI实验文件失败', { relativePath, error: error.message });
      }
    }
  }

  /**
   * 写模型 artifact JSON（artifact 可以是对象，也可以是已序列化的 JSON 字符串）
   * @returns {string} 相对 uploads 的路径
   */
  static async writeModelArtifact(userId, projectId, version, artifact) {
    const relativeDir = path.posix.join('ai-lab', String(userId), String(projectId), 'models');
    const absoluteDir = path.join(AiLabService.getUploadsDir(), relativeDir);
    await AiLabService.ensureDir(absoluteDir);
    const fileName = `v${version}.json`;
    const content = typeof artifact === 'string' ? artifact : JSON.stringify(artifact);
    await fs.writeFile(path.join(absoluteDir, fileName), content);
    return path.posix.join(relativeDir, fileName);
  }

  /* ================================================================
   * 留出划分
   * ================================================================ */

  static generateSeed() {
    return crypto.randomInt(0, MAX_SEED);
  }

  /**
   * 锁定留出集：本轮新加的 train 样本按比例分层随机改为 holdout，version+1
   * @param {Object} dataset - AiLabDataset.format 后的对象
   * @param {{holdout_ratio:number, seed:number}} options
   * @returns {{dataset:Object, counts:Object, holdout_added:number, candidate_count:number}}
   */
  static async lockDataset(dataset, { holdout_ratio, seed }) {
    const candidates = await AiLabSample.findLockCandidates(dataset.id, dataset.version);
    const holdoutIds = splitHoldout(candidates, holdout_ratio, seed);

    await AiLabDataset.lock(dataset.id, holdoutIds, { holdout_ratio, seed });

    const updated = await AiLabDataset.findById(dataset.id);
    const counts = await AiLabDataset.getCounts(dataset.id, updated.classes);
    return {
      dataset: updated,
      counts,
      holdout_added: holdoutIds.length,
      candidate_count: candidates.length
    };
  }

  /* ================================================================
   * 混入错标
   * ================================================================ */

  /**
   * 对 train 且未被改过的样本按类别分层随机改标（dataset.version 不变）
   * @param {Object} dataset - AiLabDataset.format 后的对象
   * @param {{ratio:number, seed:number}} options
   * @returns {{changed:number, sample_ids:Array<number>, ratio:number, seed:number, candidate_count:number}}
   */
  static async mislabelDataset(dataset, { ratio, seed }) {
    const classKeys = dataset.classes.map(cls => cls.key);
    if (classKeys.length < 2) throw new ValidationError('至少需要两个类别才能混入错标');

    const candidates = await AiLabSample.findMislabelCandidates(dataset.id);
    const changes = pickMislabels(candidates, ratio, seed, classKeys);
    const changedIds = await AiLabSample.applyMislabels(dataset.id, changes);
    return {
      changed: changedIds.length,
      sample_ids: changedIds,
      ratio,
      seed,
      candidate_count: candidates.length
    };
  }

  /* ================================================================
   * 校验
   * ================================================================ */

  /**
   * condition_tags：自由键值对象，值为 ≤50 字的字符串；接受 JSON 字符串或对象
   * @returns {Object|null|undefined} undefined 表示未提供
   */
  static validateConditionTags(value) {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;

    let tags = value;
    if (typeof value === 'string') {
      try {
        tags = JSON.parse(value);
      } catch (e) {
        throw new ValidationError('condition_tags 必须是合法的 JSON 对象');
      }
    }
    if (tags === null) return null;
    if (typeof tags !== 'object' || Array.isArray(tags)) {
      throw new ValidationError('condition_tags 必须是键值对象');
    }

    const keys = Object.keys(tags);
    if (keys.length > MAX_CONDITION_TAG_KEYS) {
      throw new ValidationError(`condition_tags 最多 ${MAX_CONDITION_TAG_KEYS} 个键`);
    }

    const normalized = {};
    for (const key of keys) {
      const cleanKey = String(key).trim();
      if (!cleanKey || cleanKey.length > MAX_CONDITION_TAG_KEY_LENGTH) {
        throw new ValidationError(`condition_tags 的键 "${key}" 无效（1-${MAX_CONDITION_TAG_KEY_LENGTH} 字）`);
      }
      const raw = tags[key];
      if (raw === null || raw === undefined) continue;
      if (typeof raw === 'object') {
        throw new ValidationError(`condition_tags 的值必须是字符串：${cleanKey}`);
      }
      const cleanValue = String(raw).trim();
      if (cleanValue.length > MAX_CONDITION_TAG_VALUE_LENGTH) {
        throw new ValidationError(`condition_tags 的值不能超过 ${MAX_CONDITION_TAG_VALUE_LENGTH} 字：${cleanKey}`);
      }
      normalized[cleanKey] = cleanValue;
    }
    return normalized;
  }

  /**
   * 行 payload：键必须在 columns 内；number 列转数值（空值为 null），category 列转 ≤50 字的字符串，
   * text 列为 1–1000 字的字符串（见 rowPayload.js）
   * @param {Object} payload
   * @param {Array<{key:string,type:string}>} columns
   * @returns {Object} 规范化后的 {col_key: value}
   */
  static normalizeRowPayload(payload, columns) {
    return normalizeRowPayload(payload, columns);
  }

  /**
   * 按 key 合并两组定义（classes / columns）：已有的保持不变，新的追加在后
   */
  static mergeByKey(existing, incoming) {
    const result = Array.isArray(existing) ? existing.slice() : [];
    const seen = new Set(result.map(item => item.key));
    (Array.isArray(incoming) ? incoming : []).forEach(item => {
      if (item && item.key && !seen.has(item.key)) {
        seen.add(item.key);
        result.push({ ...item });
      }
    });
    return result;
  }

  /* ================================================================
   * 指标合并与 summary
   * ================================================================ */

  static toNumberOrNull(value) {
    const n = typeof value === 'string' ? parseFloat(value) : value;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  }

  static round4(value) {
    return Math.round(value * 10000) / 10000;
  }

  /**
   * generalization_gap = holdout.accuracy − min(所有 shift 集的 accuracy)，没有 shift 或 holdout 则 null
   */
  static computeGeneralizationGap(metrics) {
    if (!metrics || typeof metrics !== 'object') return null;
    const holdoutAccuracy = AiLabService.toNumberOrNull(metrics.holdout && metrics.holdout.accuracy);
    const shiftSets = metrics.shift && typeof metrics.shift === 'object' && !Array.isArray(metrics.shift)
      ? Object.values(metrics.shift)
      : [];
    const shiftAccuracies = shiftSets
      .map(set => AiLabService.toNumberOrNull(set && set.accuracy))
      .filter(value => value !== null);
    if (holdoutAccuracy === null || shiftAccuracies.length === 0) return null;
    return AiLabService.round4(holdoutAccuracy - Math.min(...shiftAccuracies));
  }

  /**
   * 把一次评测的指标合并进 models.metrics（holdout 或 shift['<set>']），并重算 generalization_gap
   * @returns {Object} 新的 metrics（不修改入参）
   */
  static mergeEvaluation(currentMetrics, split, shiftSet, evaluationMetrics) {
    const next = currentMetrics && typeof currentMetrics === 'object'
      ? JSON.parse(JSON.stringify(currentMetrics))
      : {};

    if (split === 'holdout') {
      next.holdout = evaluationMetrics;
    } else {
      if (!next.shift || typeof next.shift !== 'object' || Array.isArray(next.shift)) next.shift = {};
      next.shift[shiftSet] = evaluationMetrics;
    }
    next.generalization_gap = AiLabService.computeGeneralizationGap(next);
    return next;
  }

  /**
   * 重算项目 summary 缓存并写回
   * - best_holdout_accuracy / best_shift_accuracy：所有模型版本中的最高值
   * - generalization_gap：最新（version 最大）且已有 gap 的模型版本的 gap
   */
  static async recalcProjectSummary(projectId) {
    const sampleCount = await AiLabDataset.sumSampleCountByProject(projectId);
    const models = await AiLabModel.findByProject(projectId);

    let bestHoldout = null;
    let bestShift = null;
    let gap = null;

    models.forEach(model => {
      const metrics = model.metrics && typeof model.metrics === 'object' ? model.metrics : {};
      const holdoutAccuracy = AiLabService.toNumberOrNull(metrics.holdout && metrics.holdout.accuracy);
      if (holdoutAccuracy !== null && (bestHoldout === null || holdoutAccuracy > bestHoldout)) {
        bestHoldout = holdoutAccuracy;
      }
      const shiftSets = metrics.shift && typeof metrics.shift === 'object' && !Array.isArray(metrics.shift)
        ? Object.values(metrics.shift)
        : [];
      shiftSets.forEach(set => {
        const accuracy = AiLabService.toNumberOrNull(set && set.accuracy);
        if (accuracy !== null && (bestShift === null || accuracy > bestShift)) bestShift = accuracy;
      });
    });

    for (let i = models.length - 1; i >= 0; i--) {
      const value = AiLabService.toNumberOrNull(models[i].metrics && models[i].metrics.generalization_gap);
      if (value !== null) {
        gap = value;
        break;
      }
    }

    const summary = {
      sample_count: sampleCount,
      model_count: models.length,
      best_holdout_accuracy: bestHoldout,
      best_shift_accuracy: bestShift,
      generalization_gap: gap
    };
    await AiLabProject.update(projectId, { summary });
    return summary;
  }
}

AiLabService.MAX_SEED = MAX_SEED;
AiLabService.AUDIO_EXTENSIONS = AUDIO_EXTENSIONS;

module.exports = AiLabService;

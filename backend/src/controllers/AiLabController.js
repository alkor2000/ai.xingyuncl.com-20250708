/**
 * AI训练专区控制器
 *
 * 功能：任务模板、项目 CRUD 与列表、数据集/类别管理、样本上传/更新/软删除、留出集锁定、
 *       模型版本保存与读取、评测记录与指标合并、过程事件写读、管理端项目列表
 *
 * 权限规则（契约 §4）：
 * - 读：所有者、super_admin、或与项目同组的 admin（AiLabService.canAccess）
 * - 写（增删样本、训练、评测、事件、修改项目/数据集/模型）：仅所有者（AiLabService.canWrite）
 *
 * 错误：资源不存在 404、无权 403、校验失败 400（ResponseHelper.validation）
 */

const dbConnection = require('../database/connection');
const AiLabProject = require('../models/AiLabProject');
const AiLabDataset = require('../models/AiLabDataset');
const AiLabSample = require('../models/AiLabSample');
const AiLabModel = require('../models/AiLabModel');
const AiLabEvent = require('../models/AiLabEvent');
const AiLabService = require('../services/aiLab/AiLabService');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');
const { ValidationError } = require('../utils/errors');
const { AI_LAB_TASKS, AI_LAB_EVENT_TYPES, AI_LAB_ENGINES, findTask } = require('../config/aiLabTasks');

const MAX_EVENTS_PER_BATCH = 50;
const MAX_EVENT_PAYLOAD_BYTES = 8 * 1024;
const MAX_MODEL_CARD_FIELD_LENGTH = 2000;
const MODEL_CARD_FIELDS = ['scope', 'not_scope', 'evidence', 'notes'];
const UPLOAD_SPLITS = ['train', 'shift'];

/* ================================================================
 * 工具
 * ================================================================ */

const badRequest = (res, message) => ResponseHelper.validation(res, [message], message);

const handleError = (res, error, fallbackMessage) => {
  if (error instanceof ValidationError) return badRequest(res, error.message);
  logger.error(`${fallbackMessage}:`, error);
  return ResponseHelper.error(res, error.message || fallbackMessage);
};

const parseId = (value) => {
  const n = parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** undefined/null 原样返回，其余转成去首尾空白的字符串 */
const cleanString = (value) => (value === undefined || value === null ? value : String(value).trim());

const parseClientTs = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/* ================================================================
 * 资源解析（附带 404 / 403 处理，失败时已写响应并返回 null）
 * ================================================================ */

async function resolveProject(req, res, rawId, { write = false } = {}) {
  const projectId = parseId(rawId);
  if (!projectId) {
    badRequest(res, '无效的项目ID');
    return null;
  }
  const project = await AiLabProject.findById(projectId);
  if (!project) {
    ResponseHelper.notFound(res, '项目不存在');
    return null;
  }
  const allowed = write ? AiLabService.canWrite(req.user, project) : AiLabService.canAccess(req.user, project);
  if (!allowed) {
    ResponseHelper.forbidden(res, write ? '只有项目所有者可以执行此操作' : '无权访问该项目');
    return null;
  }
  return project;
}

async function resolveDataset(req, res, rawId, options = {}) {
  const datasetId = parseId(rawId);
  if (!datasetId) {
    badRequest(res, '无效的数据集ID');
    return null;
  }
  const dataset = await AiLabDataset.findById(datasetId);
  if (!dataset) {
    ResponseHelper.notFound(res, '数据集不存在');
    return null;
  }
  const project = await resolveProject(req, res, dataset.project_id, options);
  if (!project) return null;
  return { dataset, project };
}

async function resolveSample(req, res, rawId, options = {}) {
  const sampleId = parseId(rawId);
  if (!sampleId) {
    badRequest(res, '无效的样本ID');
    return null;
  }
  const sample = await AiLabSample.findById(sampleId);
  if (!sample) {
    ResponseHelper.notFound(res, '样本不存在');
    return null;
  }
  const resolved = await resolveDataset(req, res, sample.dataset_id, options);
  if (!resolved) return null;
  return { sample, ...resolved };
}

async function resolveModel(req, res, rawId, options = {}) {
  const modelId = parseId(rawId);
  if (!modelId) {
    badRequest(res, '无效的模型ID');
    return null;
  }
  const model = await AiLabModel.findById(modelId);
  if (!model) {
    ResponseHelper.notFound(res, '模型不存在');
    return null;
  }
  const project = await resolveProject(req, res, model.project_id, options);
  if (!project) return null;
  return { model, project };
}

/* ================================================================
 * 任务模板
 * ================================================================ */

const getTasks = async (req, res) => {
  return ResponseHelper.success(res, AI_LAB_TASKS, '获取任务模板成功');
};

/* ================================================================
 * 项目
 * ================================================================ */

/** GET /projects?status=active&page=1&limit=20&group_id=&user_id= */
const getProjects = async (req, res) => {
  try {
    const { role } = req.user;
    const filters = {
      status: req.query.status || 'active',
      page: req.query.page,
      limit: req.query.limit
    };
    const requestedGroupId = parseId(req.query.group_id);
    const requestedUserId = parseId(req.query.user_id);

    if (role === 'super_admin' && (requestedGroupId || requestedUserId)) {
      if (requestedGroupId) filters.groupId = requestedGroupId;
      if (requestedUserId) filters.userId = requestedUserId;
    } else if (role === 'admin' && (requestedGroupId || requestedUserId)) {
      if (!req.user.group_id) return ResponseHelper.forbidden(res, '未分配用户组，无法查看他人项目');
      if (requestedGroupId && Number(requestedGroupId) !== Number(req.user.group_id)) {
        return ResponseHelper.forbidden(res, '组管理员只能查看本组项目');
      }
      filters.groupId = req.user.group_id;
      if (requestedUserId) filters.userId = requestedUserId;
    } else {
      filters.userId = req.user.id;
    }

    const result = await AiLabProject.list(filters);
    return ResponseHelper.paginated(res, result.items, {
      page: result.page,
      limit: result.limit,
      total: result.total
    }, '获取项目列表成功');
  } catch (error) {
    return handleError(res, error, '获取项目列表失败');
  }
};

/** POST /projects {title, task_key, participation_mode, context?} */
const createProject = async (req, res) => {
  try {
    const title = cleanString(req.body.title);
    if (!title) return badRequest(res, '项目标题不能为空');
    if (title.length > 200) return badRequest(res, '项目标题不能超过 200 字');

    const taskKey = req.body.task_key || 'free';
    const task = findTask(taskKey);
    if (!task) return badRequest(res, `无效的任务模板: ${taskKey}`);

    const participationMode = req.body.participation_mode || 'individual';
    if (!AiLabProject.PARTICIPATION_MODES.includes(participationMode)) {
      return badRequest(res, '无效的参与方式');
    }

    let context = null;
    if (req.body.context !== undefined && req.body.context !== null) {
      if (!isPlainObject(req.body.context)) return badRequest(res, 'context 必须是对象');
      context = req.body.context;
    }

    const userId = req.user.id;
    const groupId = req.user.group_id ?? null;

    const { projectId, datasetId } = await dbConnection.transaction(async (query) => {
      const newProjectId = await AiLabProject.create({
        user_id: userId,
        group_id: groupId,
        title,
        task_key: task.key,
        task_version: task.version || '1',
        participation_mode: participationMode,
        context
      }, query);
      const newDatasetId = await AiLabDataset.create({
        project_id: newProjectId,
        user_id: userId,
        name: '数据集',
        classes: task.default_classes || []
      }, query);
      return { projectId: newProjectId, datasetId: newDatasetId };
    });

    const project = await AiLabProject.findById(projectId);
    const dataset = await AiLabDataset.findById(datasetId);
    dataset.counts = await AiLabDataset.getCounts(dataset.id, dataset.classes);

    logger.info('创建AI实验项目成功', { projectId, datasetId, userId, taskKey: task.key });
    return ResponseHelper.success(res, { project, dataset }, '创建项目成功', 201);
  } catch (error) {
    return handleError(res, error, '创建项目失败');
  }
};

/** GET /projects/:id */
const getProject = async (req, res) => {
  try {
    const project = await resolveProject(req, res, req.params.id);
    if (!project) return;

    const datasets = await AiLabDataset.findByProject(project.id);
    for (const dataset of datasets) {
      dataset.counts = await AiLabDataset.getCounts(dataset.id, dataset.classes);
    }
    const models = await AiLabModel.findByProject(project.id);

    return ResponseHelper.success(res, { project, datasets, models }, '获取项目详情成功');
  } catch (error) {
    return handleError(res, error, '获取项目详情失败');
  }
};

/** PATCH /projects/:id {title?, status?, participation_mode?, context?} */
const updateProject = async (req, res) => {
  try {
    const project = await resolveProject(req, res, req.params.id, { write: true });
    if (!project) return;

    const fields = {};
    if (req.body.title !== undefined) {
      const title = cleanString(req.body.title);
      if (!title) return badRequest(res, '项目标题不能为空');
      if (title.length > 200) return badRequest(res, '项目标题不能超过 200 字');
      fields.title = title;
    }
    if (req.body.status !== undefined) {
      if (!AiLabProject.PROJECT_STATUSES.includes(req.body.status)) return badRequest(res, '无效的项目状态');
      fields.status = req.body.status;
    }
    if (req.body.participation_mode !== undefined) {
      if (!AiLabProject.PARTICIPATION_MODES.includes(req.body.participation_mode)) return badRequest(res, '无效的参与方式');
      fields.participation_mode = req.body.participation_mode;
    }
    if (req.body.context !== undefined) {
      if (req.body.context !== null && !isPlainObject(req.body.context)) return badRequest(res, 'context 必须是对象');
      fields.context = req.body.context;
    }
    if (Object.keys(fields).length === 0) return badRequest(res, '没有要更新的字段');

    await AiLabProject.update(project.id, fields);
    const updated = await AiLabProject.findById(project.id);
    return ResponseHelper.success(res, updated, '更新项目成功');
  } catch (error) {
    return handleError(res, error, '更新项目失败');
  }
};

/* ================================================================
 * 数据集
 * ================================================================ */

/** POST /projects/:id/datasets {name, classes} */
const createDataset = async (req, res) => {
  try {
    const project = await resolveProject(req, res, req.params.id, { write: true });
    if (!project) return;

    const name = cleanString(req.body.name);
    if (!name) return badRequest(res, '数据集名称不能为空');
    if (name.length > 200) return badRequest(res, '数据集名称不能超过 200 字');

    const datasetId = await AiLabDataset.create({
      project_id: project.id,
      user_id: req.user.id,
      name,
      classes: req.body.classes ?? []
    });
    const dataset = await AiLabDataset.findById(datasetId);
    dataset.counts = await AiLabDataset.getCounts(dataset.id, dataset.classes);

    logger.info('创建AI实验数据集成功', { projectId: project.id, datasetId, userId: req.user.id });
    return ResponseHelper.success(res, dataset, '创建数据集成功', 201);
  } catch (error) {
    return handleError(res, error, '创建数据集失败');
  }
};

/** PATCH /datasets/:id {name?, classes?}：classes 只能新增或改 label，有样本的 key 不能删 */
const updateDataset = async (req, res) => {
  try {
    const resolved = await resolveDataset(req, res, req.params.id, { write: true });
    if (!resolved) return;
    const { dataset } = resolved;

    const fields = {};
    if (req.body.name !== undefined) {
      const name = cleanString(req.body.name);
      if (!name) return badRequest(res, '数据集名称不能为空');
      if (name.length > 200) return badRequest(res, '数据集名称不能超过 200 字');
      fields.name = name;
    }
    if (req.body.classes !== undefined) {
      const normalized = AiLabDataset.validateClasses(req.body.classes);
      const nextKeys = new Set(normalized.map(cls => cls.key));
      const usedKeys = await AiLabDataset.getClassKeysWithSamples(dataset.id);
      const missing = [...usedKeys].filter(key => !nextKeys.has(key));
      if (missing.length > 0) {
        return badRequest(res, `类别 ${missing.join(', ')} 已有样本，不能删除`);
      }
      fields.classes = normalized;
    }
    if (Object.keys(fields).length === 0) return badRequest(res, '没有要更新的字段');

    await AiLabDataset.update(dataset.id, fields);
    const updated = await AiLabDataset.findById(dataset.id);
    updated.counts = await AiLabDataset.getCounts(updated.id, updated.classes);
    return ResponseHelper.success(res, updated, '更新数据集成功');
  } catch (error) {
    return handleError(res, error, '更新数据集失败');
  }
};

/* ================================================================
 * 样本
 * ================================================================ */

/** GET /datasets/:id/samples?split=&class_key=&shift_set=&include_removed=0 */
const getSamples = async (req, res) => {
  try {
    const resolved = await resolveDataset(req, res, req.params.id);
    if (!resolved) return;
    const { dataset } = resolved;

    const filters = {};
    if (req.query.split) {
      if (!AiLabSample.SPLITS.includes(req.query.split)) return badRequest(res, '无效的 split');
      filters.split = req.query.split;
    }
    if (req.query.class_key) filters.class_key = String(req.query.class_key);
    if (req.query.shift_set) filters.shift_set = String(req.query.shift_set);
    filters.include_removed = ['1', 'true'].includes(String(req.query.include_removed || '0'));

    const samples = await AiLabSample.list(dataset.id, filters);
    return ResponseHelper.success(res, samples, '获取样本列表成功');
  } catch (error) {
    return handleError(res, error, '获取样本列表失败');
  }
};

/** POST /datasets/:id/samples multipart：files[]、class_key、split、shift_set、condition_tags、source */
const uploadSamples = async (req, res) => {
  try {
    const resolved = await resolveDataset(req, res, req.params.id, { write: true });
    if (!resolved) return;
    const { dataset, project } = resolved;
    const images = req.aiLabImages || [];
    if (images.length === 0) return badRequest(res, '请至少上传一张图片');

    const classKey = cleanString(req.body.class_key);
    if (!classKey) return badRequest(res, 'class_key 不能为空');
    if (!dataset.classes.some(cls => cls.key === classKey)) {
      return badRequest(res, `类别 ${classKey} 不存在，请先在数据集中添加该类别`);
    }

    const split = req.body.split ? String(req.body.split) : 'train';
    if (!UPLOAD_SPLITS.includes(split)) {
      return badRequest(res, '上传时 split 只能是 train 或 shift（留出集由锁定操作自动划分）');
    }
    let shiftSet = null;
    if (split === 'shift') {
      shiftSet = cleanString(req.body.shift_set);
      if (!shiftSet) return badRequest(res, 'split=shift 时必须提供 shift_set');
      if (shiftSet.length > 50) return badRequest(res, 'shift_set 不能超过 50 字');
    }

    const conditionTags = AiLabService.validateConditionTags(req.body.condition_tags) ?? null;

    const source = req.body.source ? String(req.body.source) : 'camera';
    if (!AiLabSample.SOURCES.includes(source)) return badRequest(res, '无效的 source');

    const stored = await AiLabService.storeSampleImages(req.user.id, dataset.id, images);

    let created;
    try {
      created = await AiLabSample.createMany(
        stored.map(file => ({
          dataset_id: dataset.id,
          user_id: req.user.id,
          class_key: classKey,
          split,
          shift_set: shiftSet,
          condition_tags: conditionTags,
          source,
          file_path: file.file_path,
          width: file.width,
          height: file.height,
          file_size: file.file_size,
          added_version: dataset.version
        })),
        async (query) => {
          await AiLabDataset.adjustSampleCount(dataset.id, stored.length, query);
        }
      );
    } catch (error) {
      await AiLabService.removeFiles(stored.map(file => file.file_path));
      throw error;
    }

    await AiLabService.recalcProjectSummary(project.id);

    logger.info('上传AI实验样本成功', {
      datasetId: dataset.id, userId: req.user.id, classKey, split, shiftSet, count: created.length
    });
    return ResponseHelper.success(res, created, '上传样本成功', 201);
  } catch (error) {
    return handleError(res, error, '上传样本失败');
  }
};

/** DELETE /samples/:id → 软删除（removed_version = 当前 dataset.version） */
const deleteSample = async (req, res) => {
  try {
    const resolved = await resolveSample(req, res, req.params.id, { write: true });
    if (!resolved) return;
    const { sample, dataset, project } = resolved;

    if (sample.removed_version !== null && sample.removed_version !== undefined) {
      return ResponseHelper.notFound(res, '样本已删除');
    }

    const removed = await AiLabSample.softDelete(sample.id, dataset.id, dataset.version);
    if (!removed) return ResponseHelper.notFound(res, '样本已删除');

    await AiLabService.recalcProjectSummary(project.id);

    logger.info('删除AI实验样本', { sampleId: sample.id, datasetId: dataset.id, removedVersion: dataset.version });
    return ResponseHelper.success(res, { id: sample.id, removed_version: dataset.version }, '删除样本成功');
  } catch (error) {
    return handleError(res, error, '删除样本失败');
  }
};

/** PATCH /samples/:id {class_key?, condition_tags?, split?, shift_set?}（holdout 样本不允许改 split） */
const updateSample = async (req, res) => {
  try {
    const resolved = await resolveSample(req, res, req.params.id, { write: true });
    if (!resolved) return;
    const { sample, dataset } = resolved;

    if (sample.removed_version !== null && sample.removed_version !== undefined) {
      return ResponseHelper.notFound(res, '样本已删除');
    }

    const fields = {};

    if (req.body.class_key !== undefined) {
      const classKey = cleanString(req.body.class_key);
      if (!classKey || !dataset.classes.some(cls => cls.key === classKey)) {
        return badRequest(res, `类别 ${classKey} 不存在`);
      }
      fields.class_key = classKey;
    }

    if (req.body.split !== undefined) {
      const split = String(req.body.split);
      if (sample.split === 'holdout' && split !== 'holdout') {
        return badRequest(res, '留出集样本不允许更改所属集合');
      }
      if (sample.split !== 'holdout') {
        if (!UPLOAD_SPLITS.includes(split)) {
          return badRequest(res, 'split 只能改为 train 或 shift（留出集由锁定操作自动划分）');
        }
        if (split === 'shift') {
          const shiftSet = cleanString(req.body.shift_set !== undefined ? req.body.shift_set : sample.shift_set);
          if (!shiftSet) return badRequest(res, 'split=shift 时必须提供 shift_set');
          if (shiftSet.length > 50) return badRequest(res, 'shift_set 不能超过 50 字');
          fields.split = 'shift';
          fields.shift_set = shiftSet;
        } else {
          fields.split = 'train';
          fields.shift_set = null;
        }
      }
    } else if (req.body.shift_set !== undefined) {
      if (sample.split !== 'shift') return badRequest(res, '只有 shift 样本可以设置 shift_set');
      const shiftSet = cleanString(req.body.shift_set);
      if (!shiftSet) return badRequest(res, 'shift_set 不能为空');
      if (shiftSet.length > 50) return badRequest(res, 'shift_set 不能超过 50 字');
      fields.shift_set = shiftSet;
    }

    if (req.body.condition_tags !== undefined) {
      fields.condition_tags = AiLabService.validateConditionTags(req.body.condition_tags) ?? null;
    }

    if (Object.keys(fields).length === 0) return badRequest(res, '没有要更新的字段');

    await AiLabSample.update(sample.id, fields);
    const updated = await AiLabSample.findById(sample.id);
    return ResponseHelper.success(res, updated, '更新样本成功');
  } catch (error) {
    return handleError(res, error, '更新样本失败');
  }
};

/** POST /datasets/:id/lock {holdout_ratio?=0.2, seed?} */
const lockDataset = async (req, res) => {
  try {
    const resolved = await resolveDataset(req, res, req.params.id, { write: true });
    if (!resolved) return;
    const { dataset } = resolved;

    let ratio = 0.2;
    if (req.body.holdout_ratio !== undefined && req.body.holdout_ratio !== null) {
      ratio = Number(req.body.holdout_ratio);
      if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) {
        return badRequest(res, 'holdout_ratio 必须在 0 到 1 之间（不含）');
      }
      ratio = Math.round(ratio * 100) / 100;
    }

    let seed;
    if (req.body.seed !== undefined && req.body.seed !== null && req.body.seed !== '') {
      seed = Number(req.body.seed);
      if (!Number.isInteger(seed) || seed < 0 || seed > AiLabService.MAX_SEED) {
        return badRequest(res, `seed 必须是 0 到 ${AiLabService.MAX_SEED} 之间的整数`);
      }
    } else {
      seed = AiLabService.generateSeed();
    }

    const result = await AiLabService.lockDataset(dataset, { holdout_ratio: ratio, seed });

    logger.info('锁定AI实验数据集留出集', {
      datasetId: dataset.id, userId: req.user.id, ratio, seed,
      holdoutAdded: result.holdout_added, version: result.dataset.version
    });
    return ResponseHelper.success(res, result, '留出集已锁定');
  } catch (error) {
    return handleError(res, error, '锁定留出集失败');
  }
};

/* ================================================================
 * 模型
 * ================================================================ */

/** POST /projects/:id/models JSON（≤10MB） */
const createModel = async (req, res) => {
  try {
    const project = await resolveProject(req, res, req.params.id, { write: true });
    if (!project) return;

    const datasetId = parseId(req.body.dataset_id);
    if (!datasetId) return badRequest(res, 'dataset_id 不能为空');
    const dataset = await AiLabDataset.findById(datasetId);
    if (!dataset || Number(dataset.project_id) !== Number(project.id)) {
      return badRequest(res, '数据集不存在或不属于该项目');
    }

    let datasetVersion = dataset.version;
    if (req.body.dataset_version !== undefined && req.body.dataset_version !== null) {
      datasetVersion = Number(req.body.dataset_version);
      if (!Number.isInteger(datasetVersion) || datasetVersion < 0) return badRequest(res, 'dataset_version 必须是非负整数');
    }

    const engine = req.body.engine || 'image-knn';
    if (!AI_LAB_ENGINES.includes(engine)) return badRequest(res, `无效的 engine: ${engine}`);

    const featureExtractor = cleanString(req.body.feature_extractor) || 'mobilenet_v1_050_224';
    if (featureExtractor.length > 60) return badRequest(res, 'feature_extractor 不能超过 60 字');

    let params = null;
    if (req.body.params !== undefined && req.body.params !== null) {
      if (!isPlainObject(req.body.params)) return badRequest(res, 'params 必须是对象');
      params = req.body.params;
    }

    if (!Array.isArray(req.body.class_keys) || req.body.class_keys.length === 0) {
      return badRequest(res, 'class_keys 必须是非空数组');
    }
    const classKeys = req.body.class_keys.map(key => cleanString(key));
    if (classKeys.some(key => !key || key.length > 32)) return badRequest(res, 'class_keys 含无效的类别 key');

    let trainSampleCount = 0;
    if (req.body.train_sample_count !== undefined && req.body.train_sample_count !== null) {
      trainSampleCount = Number(req.body.train_sample_count);
      if (!Number.isInteger(trainSampleCount) || trainSampleCount < 0) return badRequest(res, 'train_sample_count 必须是非负整数');
    }

    if (req.body.artifact === undefined || req.body.artifact === null) return badRequest(res, 'artifact 不能为空');
    const artifact = req.body.artifact;

    let note = null;
    if (req.body.note !== undefined && req.body.note !== null) {
      note = cleanString(req.body.note);
      if (note.length > 500) return badRequest(res, 'note 不能超过 500 字');
    }

    let artifactPath = null;
    let model;
    try {
      model = await AiLabModel.create({
        project_id: project.id,
        dataset_id: dataset.id,
        user_id: req.user.id,
        dataset_version: datasetVersion,
        engine,
        feature_extractor: featureExtractor,
        params,
        class_keys: classKeys,
        train_sample_count: trainSampleCount,
        note
      }, async (version) => {
        artifactPath = await AiLabService.writeModelArtifact(req.user.id, project.id, version, artifact);
        return artifactPath;
      });
    } catch (error) {
      if (artifactPath) await AiLabService.removeFiles([artifactPath]);
      throw error;
    }

    await AiLabService.recalcProjectSummary(project.id);

    logger.info('保存AI实验模型版本', { projectId: project.id, modelId: model.id, version: model.version, engine });
    return ResponseHelper.success(res, model, '保存模型成功', 201);
  } catch (error) {
    return handleError(res, error, '保存模型失败');
  }
};

/** GET /models/:id */
const getModel = async (req, res) => {
  try {
    const resolved = await resolveModel(req, res, req.params.id);
    if (!resolved) return;
    return ResponseHelper.success(res, resolved.model, '获取模型成功');
  } catch (error) {
    return handleError(res, error, '获取模型失败');
  }
};

/** PATCH /models/:id {model_card?, note?} */
const updateModel = async (req, res) => {
  try {
    const resolved = await resolveModel(req, res, req.params.id, { write: true });
    if (!resolved) return;
    const { model } = resolved;

    const fields = {};
    if (req.body.model_card !== undefined) {
      if (req.body.model_card === null) {
        fields.model_card = null;
      } else {
        if (!isPlainObject(req.body.model_card)) return badRequest(res, 'model_card 必须是对象');
        const card = {};
        for (const field of MODEL_CARD_FIELDS) {
          const value = req.body.model_card[field];
          if (value === undefined || value === null) continue;
          const text = String(value).trim();
          if (text.length > MAX_MODEL_CARD_FIELD_LENGTH) {
            return badRequest(res, `model_card.${field} 不能超过 ${MAX_MODEL_CARD_FIELD_LENGTH} 字`);
          }
          card[field] = text;
        }
        fields.model_card = card;
      }
    }
    if (req.body.note !== undefined) {
      if (req.body.note === null) {
        fields.note = null;
      } else {
        const note = cleanString(req.body.note);
        if (note.length > 500) return badRequest(res, 'note 不能超过 500 字');
        fields.note = note;
      }
    }
    if (Object.keys(fields).length === 0) return badRequest(res, '没有要更新的字段');

    await AiLabModel.update(model.id, fields);
    const updated = await AiLabModel.findById(model.id);
    return ResponseHelper.success(res, updated, '更新模型成功');
  } catch (error) {
    return handleError(res, error, '更新模型失败');
  }
};

/* ================================================================
 * 评测
 * ================================================================ */

/** POST /models/:id/evaluations {split, shift_set?, sample_count, metrics, errors?} */
const createEvaluation = async (req, res) => {
  try {
    const resolved = await resolveModel(req, res, req.params.id, { write: true });
    if (!resolved) return;
    const { model, project } = resolved;

    const split = req.body.split;
    if (!AiLabModel.EVALUATION_SPLITS.includes(split)) return badRequest(res, 'split 只能是 holdout 或 shift');

    let shiftSet = null;
    if (split === 'shift') {
      shiftSet = cleanString(req.body.shift_set);
      if (!shiftSet) return badRequest(res, 'split=shift 时必须提供 shift_set');
      if (shiftSet.length > 50) return badRequest(res, 'shift_set 不能超过 50 字');
    }

    const sampleCount = Number(req.body.sample_count);
    if (!Number.isInteger(sampleCount) || sampleCount < 0) return badRequest(res, 'sample_count 必须是非负整数');

    const metrics = req.body.metrics;
    if (!isPlainObject(metrics)) return badRequest(res, 'metrics 必须是对象');
    if (AiLabService.toNumberOrNull(metrics.accuracy) === null) return badRequest(res, 'metrics.accuracy 必须是数字');

    let errors = null;
    if (req.body.errors !== undefined && req.body.errors !== null) {
      if (!Array.isArray(req.body.errors)) return badRequest(res, 'errors 必须是数组');
      errors = req.body.errors.slice(0, AiLabModel.MAX_EVALUATION_ERRORS);
    }

    await AiLabModel.createEvaluation({
      model_id: model.id,
      user_id: req.user.id,
      split,
      shift_set: shiftSet,
      sample_count: sampleCount,
      metrics,
      errors
    });

    const merged = AiLabService.mergeEvaluation(model.metrics, split, shiftSet, metrics);
    await AiLabModel.update(model.id, { metrics: merged });
    await AiLabService.recalcProjectSummary(project.id);

    const updated = await AiLabModel.findById(model.id);
    logger.info('记录AI实验评测', { modelId: model.id, split, shiftSet, accuracy: metrics.accuracy, gap: merged.generalization_gap });
    return ResponseHelper.success(res, updated, '评测结果已记录', 201);
  } catch (error) {
    return handleError(res, error, '记录评测失败');
  }
};

/** GET /models/:id/evaluations */
const getEvaluations = async (req, res) => {
  try {
    const resolved = await resolveModel(req, res, req.params.id);
    if (!resolved) return;
    const evaluations = await AiLabModel.listEvaluations(resolved.model.id);
    return ResponseHelper.success(res, evaluations, '获取评测记录成功');
  } catch (error) {
    return handleError(res, error, '获取评测记录失败');
  }
};

/* ================================================================
 * 过程事件
 * ================================================================ */

/** POST /projects/:id/events {events:[{type, payload, client_ts}]}（≤50 条/次） */
const createEvents = async (req, res) => {
  try {
    const project = await resolveProject(req, res, req.params.id, { write: true });
    if (!project) return;

    const events = req.body.events;
    if (!Array.isArray(events) || events.length === 0) return badRequest(res, 'events 必须是非空数组');
    if (events.length > MAX_EVENTS_PER_BATCH) return badRequest(res, `一次最多提交 ${MAX_EVENTS_PER_BATCH} 条事件`);

    const normalized = [];
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (!isPlainObject(event)) return badRequest(res, `第 ${i + 1} 条事件格式无效`);
      if (!AI_LAB_EVENT_TYPES.includes(event.type)) {
        return badRequest(res, `第 ${i + 1} 条事件类型无效: ${event.type}`);
      }
      let payload = null;
      if (event.payload !== undefined && event.payload !== null) {
        if (typeof event.payload !== 'object') return badRequest(res, `第 ${i + 1} 条事件的 payload 必须是对象`);
        if (Buffer.byteLength(JSON.stringify(event.payload), 'utf8') > MAX_EVENT_PAYLOAD_BYTES) {
          return badRequest(res, `第 ${i + 1} 条事件的 payload 超过 8KB`);
        }
        payload = event.payload;
      }
      normalized.push({ type: event.type, payload, client_ts: parseClientTs(event.client_ts) });
    }

    const inserted = await AiLabEvent.createMany(project.id, req.user.id, normalized);
    return ResponseHelper.success(res, { inserted }, '事件已记录', 201);
  } catch (error) {
    return handleError(res, error, '记录事件失败');
  }
};

/** GET /projects/:id/events?after_id=0&limit=200 */
const getEvents = async (req, res) => {
  try {
    const project = await resolveProject(req, res, req.params.id);
    if (!project) return;
    const events = await AiLabEvent.list(project.id, {
      afterId: req.query.after_id,
      limit: req.query.limit
    });
    return ResponseHelper.success(res, events, '获取事件成功');
  } catch (error) {
    return handleError(res, error, '获取事件失败');
  }
};

/* ================================================================
 * 管理端
 * ================================================================ */

/** GET /admin/projects?group_id=&user_id=&page=&limit=（admin 强制本组） */
const getAdminProjects = async (req, res) => {
  try {
    const filters = {
      status: req.query.status || 'all',
      page: req.query.page,
      limit: req.query.limit,
      withUser: true
    };

    if (req.user.role === 'admin') {
      if (!req.user.group_id) return ResponseHelper.forbidden(res, '未分配用户组');
      filters.groupId = req.user.group_id;
    } else {
      const groupId = parseId(req.query.group_id);
      if (groupId) filters.groupId = groupId;
    }
    const userId = parseId(req.query.user_id);
    if (userId) filters.userId = userId;

    const result = await AiLabProject.list(filters);
    return ResponseHelper.paginated(res, result.items, {
      page: result.page,
      limit: result.limit,
      total: result.total
    }, '获取项目列表成功');
  } catch (error) {
    return handleError(res, error, '获取项目列表失败');
  }
};

module.exports = {
  getTasks,
  getProjects,
  createProject,
  getProject,
  updateProject,
  createDataset,
  updateDataset,
  getSamples,
  uploadSamples,
  deleteSample,
  updateSample,
  lockDataset,
  createModel,
  getModel,
  updateModel,
  createEvaluation,
  getEvaluations,
  createEvents,
  getEvents,
  getAdminProjects
};

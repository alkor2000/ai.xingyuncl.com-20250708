/**
 * 知识库控制器
 * 
 * 功能：知识库CRUD + 版本管理 + 编辑者管理 + RAG文件上传/索引/检索 + Embedding配置
 */

const WikiItem = require('../models/WikiItem');
const WikiChunk = require('../models/WikiChunk');
const RAGService = require('../services/ragService');
const EmbeddingService = require('../services/embeddingService');
const DocumentParserService = require('../services/documentParserService');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');

/* ========== 知识库列表 ========== */
const getItems = async (req, res) => {
  try {
    const { id: userId, group_id: groupId, role: userRole } = req.user;
    const { scope } = req.query;
    const items = await WikiItem.getUserAccessibleItems(userId, groupId, userRole, scope);
    const listData = items.map(item => ({
      id: item.id, title: item.title, description: item.description,
      scope: item.scope, creator_id: item.creator_id, creator_name: item.creator_name,
      group_id: item.group_id, group_name: item.group_name, is_pinned: item.is_pinned,
      current_version: item.current_version, can_edit: item.can_edit,
      rag_enabled: item.rag_enabled, index_status: item.index_status,
      chunk_count: item.chunk_count, source_type: item.source_type,
      file_name: item.file_name, indexed_at: item.indexed_at,
      created_at: item.created_at, updated_at: item.updated_at
    }));
    return ResponseHelper.success(res, listData, '获取知识库列表成功');
  } catch (error) {
    logger.error('获取知识库列表失败:', error);
    return ResponseHelper.error(res, error.message || '获取知识库列表失败');
  }
};

/* ========== 知识库详情 ========== */
const getItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { id: userId, group_id: groupId, role: userRole } = req.user;
    const { hasAccess, canEdit, item } = await WikiItem.checkAccess(id, userId, groupId, userRole);
    if (!item) return ResponseHelper.notFound(res, '知识库不存在');
    if (!hasAccess) return ResponseHelper.forbidden(res, '无权访问此知识库');
    const fullItem = await WikiItem.findById(id, userId, groupId, userRole);
    fullItem.can_edit = canEdit;
    return ResponseHelper.success(res, fullItem.toJSON(), '获取知识库详情成功');
  } catch (error) {
    logger.error('获取知识库详情失败:', error);
    return ResponseHelper.error(res, error.message || '获取知识库详情失败');
  }
};

/* ========== 创建知识库 ========== */
const createItem = async (req, res) => {
  try {
    const { id: userId, group_id: groupId, role: userRole } = req.user;
    const data = req.body;
    const scope = data.scope || 'personal';
    if (scope === 'global' && userRole !== 'super_admin') return ResponseHelper.forbidden(res, '只有超级管理员可以创建全局知识库');
    if (scope === 'team') {
      if (userRole !== 'super_admin' && userRole !== 'admin') return ResponseHelper.forbidden(res, '只有组管理员可以创建团队知识库');
      if (!data.group_id) data.group_id = groupId;
      if (userRole !== 'super_admin' && data.group_id !== groupId) return ResponseHelper.forbidden(res, '只能为自己的组创建团队知识库');
    }
    const item = await WikiItem.create(data, userId);
    /* 如果指定了file类型，更新source_type */
    if (data.source_type === 'file') {
      const dbConn = require('../database/connection');
      await dbConn.query('UPDATE wiki_items SET source_type = ? WHERE id = ?', ['file', item.id]);
      item.source_type = 'file';
    }
    item.can_edit = true;
    return ResponseHelper.success(res, item.toJSON(), '创建知识库成功', 201);
  } catch (error) {
    logger.error('创建知识库失败:', error);
    if (error.name === 'ValidationError') return ResponseHelper.validationError(res, error.message);
    return ResponseHelper.error(res, error.message || '创建知识库失败');
  }
};

/* ========== 更新知识库基本信息 ========== */
const updateItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { id: userId, group_id: groupId, role: userRole } = req.user;
    const { canEdit, item } = await WikiItem.checkAccess(id, userId, groupId, userRole);
    if (!item) return ResponseHelper.notFound(res, '知识库不存在');
    if (!canEdit) return ResponseHelper.forbidden(res, '无权编辑此知识库');
    const allowedFields = ['is_pinned', 'sort_order'];
    const updateData = {};
    allowedFields.forEach(f => { if (req.body[f] !== undefined) updateData[f] = req.body[f]; });
    if (Object.keys(updateData).length > 0) await WikiItem.updateBasicInfo(id, updateData);
    const fullItem = await WikiItem.findById(id, userId, groupId, userRole);
    fullItem.can_edit = canEdit;
    return ResponseHelper.success(res, fullItem.toJSON(), '更新成功');
  } catch (error) {
    logger.error('更新知识库失败:', error);
    return ResponseHelper.error(res, error.message || '更新失败');
  }
};

/* ========== 删除知识库 ========== */
const deleteItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { id: userId, role: userRole, group_id: groupId } = req.user;
    const { item } = await WikiItem.checkAccess(id, userId, groupId, userRole);
    if (!item) return ResponseHelper.notFound(res, '知识库不存在');
    if (item.creator_id !== userId && userRole !== 'super_admin') return ResponseHelper.forbidden(res, '只有创建者或超级管理员可以删除');
    /* 删除关联chunks */
    await WikiChunk.deleteByWikiId(parseInt(id)).catch(() => {});
    await WikiItem.delete(id);
    return ResponseHelper.success(res, null, '删除知识库成功');
  } catch (error) {
    logger.error('删除知识库失败:', error);
    return ResponseHelper.error(res, error.message || '删除知识库失败');
  }
};

/* ========== 版本管理 ========== */
const getVersions = async (req, res) => {
  try {
    const { id } = req.params;
    const { id: userId, group_id: groupId, role: userRole } = req.user;
    const { hasAccess, item } = await WikiItem.checkAccess(id, userId, groupId, userRole);
    if (!item) return ResponseHelper.notFound(res, '知识库不存在');
    if (!hasAccess) return ResponseHelper.forbidden(res, '无权访问');
    const versions = await WikiItem.getVersions(id);
    return ResponseHelper.success(res, versions, '获取版本历史成功');
  } catch (error) {
    logger.error('获取版本历史失败:', error);
    return ResponseHelper.error(res, error.message || '获取版本历史失败');
  }
};

const createVersion = async (req, res) => {
  try {
    const { id } = req.params;
    const { id: userId, group_id: groupId, role: userRole } = req.user;
    const { base_version_id } = req.body;
    const { canEdit, item } = await WikiItem.checkAccess(id, userId, groupId, userRole);
    if (!item) return ResponseHelper.notFound(res, '知识库不存在');
    if (!canEdit) return ResponseHelper.forbidden(res, '无权编辑');
    const result = await WikiItem.createNewVersion(id, userId, base_version_id);
    return ResponseHelper.success(res, result, '新版本创建成功');
  } catch (error) {
    logger.error('创建版本失败:', error);
    return ResponseHelper.error(res, error.message || '创建版本失败');
  }
};

const getVersionDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const { id: userId, group_id: groupId, role: userRole } = req.user;
    const version = await WikiItem.getVersionDetail(id);
    if (!version) return ResponseHelper.notFound(res, '版本不存在');
    const { hasAccess, canEdit } = await WikiItem.checkAccess(version.wiki_id, userId, groupId, userRole);
    if (!hasAccess) return ResponseHelper.forbidden(res, '无权访问');
    version.can_edit = canEdit;
    return ResponseHelper.success(res, version, '获取版本详情成功');
  } catch (error) {
    logger.error('获取版本详情失败:', error);
    return ResponseHelper.error(res, error.message || '获取版本详情失败');
  }
};

const updateVersion = async (req, res) => {
  try {
    const { id: versionId } = req.params;
    const { id: userId, group_id: groupId, role: userRole } = req.user;
    const version = await WikiItem.getVersionDetail(versionId);
    if (!version) return ResponseHelper.notFound(res, '版本不存在');
    const { canEdit } = await WikiItem.checkAccess(version.wiki_id, userId, groupId, userRole);
    if (!canEdit) return ResponseHelper.forbidden(res, '无权编辑');
    const result = await WikiItem.updateVersion(versionId, req.body, userId);
    return ResponseHelper.success(res, result, '保存成功');
  } catch (error) {
    logger.error('保存版本失败:', error);
    if (error.name === 'ValidationError') return ResponseHelper.validationError(res, error.message);
    return ResponseHelper.error(res, error.message || '保存失败');
  }
};

const deleteVersion = async (req, res) => {
  try {
    const { id, versionId } = req.params;
    const { id: userId, group_id: groupId, role: userRole } = req.user;
    const { canEdit, item } = await WikiItem.checkAccess(id, userId, groupId, userRole);
    if (!item) return ResponseHelper.notFound(res, '知识库不存在');
    if (!canEdit) return ResponseHelper.forbidden(res, '无权编辑');
    const result = await WikiItem.deleteVersion(parseInt(id), parseInt(versionId));
    return ResponseHelper.success(res, result, '版本删除成功');
  } catch (error) {
    logger.error('删除版本失败:', error);
    if (error.name === 'ValidationError') return ResponseHelper.validationError(res, error.message);
    return ResponseHelper.error(res, error.message || '删除版本失败');
  }
};

/* ========== RAG：上传文档（支持多文件追加） ========== */
const uploadDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const { id: userId, group_id: groupId, role: userRole } = req.user;
    const { canEdit, item } = await WikiItem.checkAccess(id, userId, groupId, userRole);
    if (!item) return ResponseHelper.notFound(res, '知识库不存在');
    if (!canEdit) return ResponseHelper.forbidden(res, '无权编辑');

    /* 支持单文件(req.file)和多文件(req.files) */
    const files = req.files || (req.file ? [req.file] : []);
    if (files.length === 0) return ResponseHelper.validationError(res, '请上传文件');

    logger.info('开始解析上传文档', {
      wikiId: id, fileCount: files.length,
      fileNames: files.map(f => f.originalname)
    });

    /* 逐个解析文档并合并内容 */
    const results = [];
    const contentParts = [];
    const fileNames = [];
    let totalSize = 0;
    /* 双换行分隔符 */
    const SEPARATOR = '\n\n';
    /* 文档标题分隔线 */
    const DOC_DIVIDER = '\n===== 文档: ';
    const DOC_DIVIDER_END = ' =====\n\n';

    for (const file of files) {
      try {
        const parsed = await DocumentParserService.parseFile(file.path, file.originalname);
        if (parsed.content && parsed.content.trim().length > 0) {
          /* 每个文档前加标题分隔 */
          contentParts.push(DOC_DIVIDER + file.originalname + DOC_DIVIDER_END + parsed.content);
          fileNames.push(file.originalname);
          totalSize += file.size;
          results.push({
            file_name: file.originalname,
            file_size: file.size,
            char_count: parsed.charCount,
            page_count: parsed.pageCount,
            status: 'success'
          });
        } else {
          results.push({ file_name: file.originalname, status: 'empty', message: '文档内容为空' });
        }
      } catch (parseErr) {
        logger.warn('解析文档失败，跳过', { fileName: file.originalname, error: parseErr.message });
        results.push({ file_name: file.originalname, status: 'failed', message: parseErr.message });
      }
    }

    if (contentParts.length === 0) {
      return ResponseHelper.error(res, '所有文档内容为空或解析失败');
    }

    /* 获取已有内容，追加新内容 */
    const dbConnection = require('../database/connection');
    const { rows: existingRows } = await dbConnection.query('SELECT content FROM wiki_items WHERE id = ?', [id]);
    const existingContent = existingRows[0]?.content || '';
    const newContent = contentParts.join(SEPARATOR);
    const mergedContent = existingContent
      ? existingContent + SEPARATOR + newContent
      : newContent.trim();

    /* 文件名合并（多个文件用逗号分隔） */
    const existingFileName = item.file_name || '';
    const allFileNames = existingFileName
      ? existingFileName + ', ' + fileNames.join(', ')
      : fileNames.join(', ');

    /* 更新知识库 */
    await dbConnection.query(
      'UPDATE wiki_items SET content = ?, source_type = ?, file_name = ?, file_size = ? WHERE id = ?',
      [mergedContent, 'file', allFileNames, totalSize, id]
    );

    /* 同步更新当前版本的内容 */
    await dbConnection.query(
      'UPDATE wiki_versions SET content = ? WHERE wiki_id = ? AND version_number = (SELECT current_version FROM wiki_items WHERE id = ?)',
      [mergedContent, id, id]
    );

    logger.info('文档上传解析成功', {
      wikiId: id, fileCount: files.length,
      successCount: results.filter(r => r.status === 'success').length,
      totalChars: mergedContent.length
    });

    const successCount = results.filter(r => r.status === 'success').length;
    const msg = files.length === 1
      ? '文档上传成功'
      : successCount + '/' + files.length + ' 个文档上传成功';

    return ResponseHelper.success(res, {
      file_count: files.length,
      success_count: successCount,
      files: results,
      total_char_count: mergedContent.length,
      file_names: allFileNames
    }, msg);

  } catch (error) {
    logger.error('上传文档失败:', error);
    return ResponseHelper.error(res, error.message || '上传文档失败');
  }
};

/* ========== RAG：构建向量索引 ========== */
const buildIndex = async (req, res) => {
  try {
    const { id } = req.params;
    const { id: userId, group_id: groupId, role: userRole } = req.user;
    const { canEdit, item } = await WikiItem.checkAccess(id, userId, groupId, userRole);
    if (!item) return ResponseHelper.notFound(res, '知识库不存在');
    if (!canEdit) return ResponseHelper.forbidden(res, '无权操作');

    /* 获取内容 */
    const fullItem = await WikiItem.findById(id);
    if (!fullItem || !fullItem.content || fullItem.content.trim().length === 0) {
      return ResponseHelper.error(res, '知识库内容为空，请先添加内容或上传文档');
    }

    /* 异步构建索引（先返回响应，后台执行） */
    res.json({
      success: true,
      message: '索引构建已启动，请稍后查看状态',
      data: { wiki_id: parseInt(id), status: 'processing' }
    });

    /* 后台执行索引构建 */
    RAGService.buildIndex(parseInt(id), fullItem.content, fullItem.current_version)
      .then(result => {
        logger.info('索引构建完成', { wikiId: id, ...result });
      })
      .catch(error => {
        logger.error('索引构建失败:', { wikiId: id, error: error.message });
      });

  } catch (error) {
    logger.error('启动索引构建失败:', error);
    return ResponseHelper.error(res, error.message || '启动索引构建失败');
  }
};

/* ========== RAG：获取索引状态 ========== */
const getIndexStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const dbConnection = require('../database/connection');
    const sql = 'SELECT rag_enabled, index_status, chunk_count, indexed_at, source_type, file_name, file_size FROM wiki_items WHERE id = ?';
    const { rows } = await dbConnection.query(sql, [id]);
    if (rows.length === 0) return ResponseHelper.notFound(res, '知识库不存在');
    return ResponseHelper.success(res, rows[0], '获取索引状态成功');
  } catch (error) {
    logger.error('获取索引状态失败:', error);
    return ResponseHelper.error(res, '获取索引状态失败');
  }
};

/* ========== RAG：语义检索测试 ========== */
const ragSearch = async (req, res) => {
  try {
    const { id } = req.params;
    const { query, top_k } = req.body;
    if (!query) return ResponseHelper.validationError(res, '请提供查询文本');

    const results = await RAGService.search([parseInt(id)], query, top_k);
    const context = RAGService.formatAsContext(results);

    return ResponseHelper.success(res, {
      results, context, result_count: results.length
    }, '检索完成');
  } catch (error) {
    logger.error('RAG检索失败:', error);
    return ResponseHelper.error(res, error.message || '检索失败');
  }
};

/* ========== RAG：获取chunks列表 ========== */
const getChunks = async (req, res) => {
  try {
    const { id } = req.params;
    const { id: userId, group_id: groupId, role: userRole } = req.user;
    const { hasAccess } = await WikiItem.checkAccess(id, userId, groupId, userRole);
    if (!hasAccess) return ResponseHelper.forbidden(res, '无权访问');

    const chunks = await WikiChunk.findByWikiId(parseInt(id));
    /* 返回chunks列表（不含向量数据） */
    const chunkList = chunks.map(c => ({
      id: c.id,
      chunk_index: c.chunk_index,
      content_preview: c.content ? c.content.substring(0, 200) : '',
      content_full: c.content || '',
      token_count: c.token_count,
      char_count: c.char_count,
      embedding_model: c.embedding_model,
      has_embedding: !!(c.embedding && Array.isArray(c.embedding) && c.embedding.length > 0)
    }));

    return ResponseHelper.success(res, {
      wiki_id: parseInt(id),
      total_chunks: chunkList.length,
      total_tokens: chunkList.reduce((sum, c) => sum + (c.token_count || 0), 0),
      chunks: chunkList
    }, '获取chunks成功');
  } catch (error) {
    logger.error('获取chunks失败:', error);
    return ResponseHelper.error(res, error.message || '获取chunks失败');
  }
};

/* ========== Embedding配置管理 ========== */
const getEmbeddingConfig = async (req, res) => {
  try {
    const config = await EmbeddingService.getConfig();
    /* 隐藏完整API Key */
    if (config.api_key) {
      config.api_key_masked = config.api_key.substring(0, 8) + '...' + config.api_key.slice(-4);
      config.has_api_key = true;
    } else {
      config.api_key_masked = '';
      config.has_api_key = false;
    }
    delete config.api_key;
    return ResponseHelper.success(res, config, '获取配置成功');
  } catch (error) {
    logger.error('获取Embedding配置失败:', error);
    return ResponseHelper.error(res, '获取配置失败');
  }
};

const updateEmbeddingConfig = async (req, res) => {
  try {
    const currentConfig = await EmbeddingService.getConfig();
    const newConfig = { ...currentConfig, ...req.body };
    /* 如果api_key为空字符串，保持原值 */
    if (req.body.api_key === '' || req.body.api_key === undefined) {
      newConfig.api_key = currentConfig.api_key;
    }
    await EmbeddingService.updateConfig(newConfig);
    return ResponseHelper.success(res, null, '配置更新成功');
  } catch (error) {
    logger.error('更新Embedding配置失败:', error);
    return ResponseHelper.error(res, '更新配置失败');
  }
};

/* ========== 其他功能 ========== */
const togglePin = async (req, res) => {
  try {
    const { id } = req.params;
    const { id: userId, group_id: groupId, role: userRole } = req.user;
    const { canEdit, item } = await WikiItem.checkAccess(id, userId, groupId, userRole);
    if (!item) return ResponseHelper.notFound(res, '知识库不存在');
    if (!canEdit) return ResponseHelper.forbidden(res, '无权编辑');
    const result = await WikiItem.togglePin(id);
    result.can_edit = canEdit;
    return ResponseHelper.success(res, result.toJSON(), '切换置顶状态成功');
  } catch (error) {
    logger.error('切换置顶状态失败:', error);
    return ResponseHelper.error(res, error.message || '切换置顶状态失败');
  }
};

const getEditors = async (req, res) => {
  try {
    const { id } = req.params;
    const { id: userId, group_id: groupId, role: userRole } = req.user;
    const { hasAccess, item } = await WikiItem.checkAccess(id, userId, groupId, userRole);
    if (!item) return ResponseHelper.notFound(res, '知识库不存在');
    if (item.scope !== 'team') return ResponseHelper.validationError(res, '只有团队知识库支持编辑者管理');
    if (!hasAccess) return ResponseHelper.forbidden(res, '无权访问');
    const editors = await WikiItem.getEditors(id);
    return ResponseHelper.success(res, editors, '获取编辑者列表成功');
  } catch (error) {
    logger.error('获取编辑者列表失败:', error);
    return ResponseHelper.error(res, error.message || '获取编辑者列表失败');
  }
};

const addEditor = async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.body;
    const { id: operatorId, group_id: groupId, role: userRole } = req.user;
    if (!user_id) return ResponseHelper.validationError(res, '请指定要添加的用户');
    const { item } = await WikiItem.checkAccess(id, operatorId, groupId, userRole);
    if (!item) return ResponseHelper.notFound(res, '知识库不存在');
    if (item.scope !== 'team') return ResponseHelper.validationError(res, '只有团队知识库支持编辑者管理');
    if (item.creator_id !== operatorId && userRole !== 'super_admin') return ResponseHelper.forbidden(res, '只有创建者或超级管理员可以管理编辑者');
    await WikiItem.addEditor(id, user_id, operatorId);
    const editors = await WikiItem.getEditors(id);
    return ResponseHelper.success(res, editors, '添加编辑者成功');
  } catch (error) {
    logger.error('添加编辑者失败:', error);
    return ResponseHelper.error(res, error.message || '添加编辑者失败');
  }
};

const removeEditor = async (req, res) => {
  try {
    const { id, userId: targetUserId } = req.params;
    const { id: operatorId, group_id: groupId, role: userRole } = req.user;
    const { item } = await WikiItem.checkAccess(id, operatorId, groupId, userRole);
    if (!item) return ResponseHelper.notFound(res, '知识库不存在');
    if (item.scope !== 'team') return ResponseHelper.validationError(res, '只有团队知识库支持编辑者管理');
    if (item.creator_id !== operatorId && userRole !== 'super_admin') return ResponseHelper.forbidden(res, '只有创建者或超级管理员可以管理编辑者');
    await WikiItem.removeEditor(id, targetUserId);
    const editors = await WikiItem.getEditors(id);
    return ResponseHelper.success(res, editors, '移除编辑者成功');
  } catch (error) {
    logger.error('移除编辑者失败:', error);
    return ResponseHelper.error(res, error.message || '移除编辑者失败');
  }
};

module.exports = {
  getItems, getItem, createItem, updateItem, deleteItem,
  getVersions, createVersion, getVersionDetail, updateVersion, deleteVersion,
  uploadDocument, buildIndex, getIndexStatus, ragSearch,
  getEmbeddingConfig, updateEmbeddingConfig,
  getChunks,
  togglePin, getEditors, addEditor, removeEditor
};

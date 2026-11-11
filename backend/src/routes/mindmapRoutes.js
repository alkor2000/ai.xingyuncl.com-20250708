/**
 * 思维导图相关路由 - 支持 Markdown/Mermaid/SVG 三种模式
 *
 * v2.1 修复 PUT 接口 title/content 必填校验缺失（数据完整性 bug）
 * v2.0 项目式持久化
 *   - GET /:id 按ID加载自己的导图（含 share_token）
 *   - GET /share/:id/:token 公开分享，HMAC 签名验证（需登录）
 *   - 列表接口轻量字段（不带 content）
 *   - 保存/更新免积分；导出仍按配置扣分
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authMiddleware');
const dbConnection = require('../database/connection');
const ResponseHelper = require('../utils/response');
const SystemConfig = require('../models/SystemConfig');
const User = require('../models/User');
const logger = require('../utils/logger');

/**
 * HMAC 分享 token 工具
 * 用 JWT_ACCESS_SECRET 派生密钥，对 id 做 HMAC-SHA256，截前12字符
 * 不存数据库，12位 base64url 约 72bit 熵
 */
const sharedWorks = require('../services/sharedWorkService');
const generateShareToken = sharedWorks.token;

// ===================== 积分配置 =====================

router.get('/credits-config', authenticate, async (req, res) => {
  try {
    const saveCredits = await SystemConfig.getSetting('mindmap.save_credits') || 0;
    const exportSvgCredits = await SystemConfig.getSetting('mindmap.export_svg_credits') || 2;
    const exportMarkdownCredits = await SystemConfig.getSetting('mindmap.export_markdown_credits') || 1;
    const exportPngCredits = await SystemConfig.getSetting('mindmap.export_png_credits') || 3;
    const exportPdfCredits = await SystemConfig.getSetting('mindmap.export_pdf_credits') || 5;

    return ResponseHelper.success(res, {
      save_credits: saveCredits,
      export_svg_credits: exportSvgCredits,
      export_markdown_credits: exportMarkdownCredits,
      export_png_credits: exportPngCredits,
      export_pdf_credits: exportPdfCredits
    });
  } catch (error) {
    logger.error('获取思维导图积分配置失败:', error);
    return ResponseHelper.error(res, '获取配置失败');
  }
});

router.get('/check-credits', authenticate, async (req, res) => {
  try {
    const { operation } = req.query;
    const userId = req.user.id;

    let requiredCredits = 0;
    switch (operation) {
      case 'save':
        requiredCredits = await SystemConfig.getSetting('mindmap.save_credits') || 0;
        break;
      case 'export_svg':
        requiredCredits = await SystemConfig.getSetting('mindmap.export_svg_credits') || 2;
        break;
      case 'export_markdown':
        requiredCredits = await SystemConfig.getSetting('mindmap.export_markdown_credits') || 1;
        break;
      case 'export_png':
        requiredCredits = await SystemConfig.getSetting('mindmap.export_png_credits') || 3;
        break;
      case 'export_pdf':
        requiredCredits = await SystemConfig.getSetting('mindmap.export_pdf_credits') || 5;
        break;
      default:
        return ResponseHelper.validation(res, ['无效的操作类型']);
    }

    if (requiredCredits === 0) {
      return ResponseHelper.success(res, {
        sufficient: true,
        requiredCredits: 0,
        currentCredits: 0,
        message: '该操作无需消耗积分'
      });
    }

    const user = await User.findById(userId);
    if (!user) return ResponseHelper.error(res, '用户不存在');

    const currentCredits = user.getCredits();
    const sufficient = user.hasCredits(requiredCredits);

    return ResponseHelper.success(res, {
      sufficient,
      requiredCredits,
      currentCredits,
      message: sufficient ? '积分充足' : '积分不足'
    });
  } catch (error) {
    logger.error('检查积分失败:', error);
    return ResponseHelper.error(res, '检查积分失败');
  }
});

// ===================== 公开分享（必须在 /:id 之前注册） =====================

/**
 * GET /mindmap/share/:id/:token
 * 登录分享端点 - 同时校验认证、发布状态和当前版本HMAC
 * 仅返回内容字段，不返回 user_id 等敏感信息
 */
router.get('/share/:id/:token', authenticate, async (req, res) => {
  try {
    const { id, token } = req.params;

    if (!/^\d+$/.test(id)) {
      return ResponseHelper.validation(res, {}, '无效的导图ID');
    }

    const query = `
      SELECT id, title, content, content_type, share_state, share_revision, created_at, updated_at
      FROM user_mindmaps
      WHERE id = ?
    `;
    const result = await dbConnection.query(query, [id]);

    if (result.rows.length === 0) {
      return ResponseHelper.notFound(res, '思维导图不存在');
    }

    const data = result.rows[0];
    res.set('Cache-Control', 'private, no-store');
    if (data.share_state !== 'published' || !sharedWorks.verify(id, token, data.share_revision)) return ResponseHelper.notFound(res, '链接无效或作品已撤回');
    return ResponseHelper.success(res, data);
  } catch (error) {
    logger.error('获取公开思维导图失败:', error);
    return ResponseHelper.error(res, '获取失败');
  }
});

router.post('/:id/share', authenticate, async (req, res) => {
  try { return ResponseHelper.success(res, await sharedWorks.publishMindmap(req.params.id, req.user)); }
  catch(e) { return ResponseHelper.error(res, e.statusCode ? e.message : '分享失败', e.statusCode || 500); }
});

// ===================== 列表 / CRUD =====================

/**
 * GET /mindmap/
 * 用户的思维导图列表（轻量字段，不带 content）
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    const query = `
      SELECT id, title, content_type, share_state, share_revision, created_at, updated_at,
             CHAR_LENGTH(content) AS content_length
      FROM user_mindmaps
      WHERE user_id = ?
      ORDER BY updated_at DESC
    `;
    const result = await dbConnection.query(query, [userId]);

    return ResponseHelper.success(res, result.rows);
  } catch (error) {
    logger.error('获取思维导图列表失败:', error);
    return ResponseHelper.error(res, '获取失败');
  }
});

/**
 * GET /mindmap/:id
 * 加载单个思维导图（含完整内容） + 返回 share_token
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    if (!/^\d+$/.test(id)) {
      return ResponseHelper.validation(res, {}, '无效的导图ID');
    }

    const query = `
      SELECT id, title, content, content_type, share_state, share_revision, created_at, updated_at
      FROM user_mindmaps
      WHERE id = ? AND user_id = ?
    `;
    const result = await dbConnection.query(query, [id, userId]);

    if (result.rows.length === 0) {
      return ResponseHelper.notFound(res, '思维导图不存在');
    }

    const data = result.rows[0];
    data.share_token = data.share_state === 'published' ? generateShareToken(data.id, data.share_revision) : null;

    return ResponseHelper.success(res, data);
  } catch (error) {
    logger.error('获取思维导图失败:', error);
    return ResponseHelper.error(res, '获取失败');
  }
});

/**
 * POST /mindmap/
 * 新建思维导图
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { title, content, content_type = 'markdown' } = req.body;

    if (!title || !content) {
      return ResponseHelper.validation(res, {}, '标题和内容不能为空');
    }

    const validTypes = ['markdown', 'mermaid', 'svg'];
    if (!validTypes.includes(content_type)) {
      return ResponseHelper.validation(res, {}, '无效的内容类型');
    }

    if (title.length > 200) {
      return ResponseHelper.validation(res, {}, '标题过长（最多200字符）');
    }

    const requiredCredits = await SystemConfig.getSetting('mindmap.save_credits') || 0;

    if (requiredCredits > 0) {
      const user = await User.findById(userId);
      if (!user) return ResponseHelper.error(res, '用户不存在');

      if (!user.hasCredits(requiredCredits)) {
        return ResponseHelper.error(res, `积分不足，需要${requiredCredits}积分，当前余额${user.getCredits()}积分`);
      }

      await user.consumeCredits(
        requiredCredits, null, null,
        `保存思维导图(${content_type})`, 'mindmap_save'
      );
    }

    const query = `
      INSERT INTO user_mindmaps (user_id, title, content, content_type, share_state)
      VALUES (?, ?, ?, ?, 'draft')
    `;
    const result = await dbConnection.query(query, [userId, title, content, content_type]);
    const newId = result.rows.insertId;

    return ResponseHelper.success(res, {
      id: newId,
      share_token: null, share_state: 'draft', share_revision: 0,
      message: requiredCredits > 0 ? `保存成功，消耗${requiredCredits}积分` : '保存成功'
    });
  } catch (error) {
    logger.error('保存思维导图失败:', error);
    return ResponseHelper.error(res, error.message || '保存失败');
  }
});

/**
 * PUT /mindmap/:id
 * 更新思维导图
 * v2.1 修复：title/content 必填校验缺失（数据完整性 bug）
 */
router.put('/:id', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { title, content, content_type = 'markdown' } = req.body;

    if (!/^\d+$/.test(id)) {
      return ResponseHelper.validation(res, {}, '无效的导图ID');
    }

    // v2.1 修复：必填校验，避免 UPDATE 设置 title=NULL 破坏数据
    if (!title || !content) {
      return ResponseHelper.validation(res, {}, '标题和内容不能为空');
    }

    if (title.length > 200) {
      return ResponseHelper.validation(res, {}, '标题过长（最多200字符）');
    }

    const validTypes = ['markdown', 'mermaid', 'svg'];
    if (!validTypes.includes(content_type)) {
      return ResponseHelper.validation(res, {}, '无效的内容类型');
    }

    const requiredCredits = await SystemConfig.getSetting('mindmap.save_credits') || 0;

    if (requiredCredits > 0) {
      const user = await User.findById(userId);
      if (!user) return ResponseHelper.error(res, '用户不存在');

      if (!user.hasCredits(requiredCredits)) {
        return ResponseHelper.error(res, `积分不足，需要${requiredCredits}积分，当前余额${user.getCredits()}积分`);
      }

      await user.consumeCredits(
        requiredCredits, null, null,
        `更新思维导图(${content_type})`, 'mindmap_save'
      );
    }

    const query = `
      UPDATE user_mindmaps
      SET title = ?, content = ?, content_type = ?, updated_at = NOW()
      WHERE id = ? AND user_id = ?
    `;
    const result = await dbConnection.query(query, [title, content, content_type, id, userId]);

    if (result.rows.affectedRows === 0) {
      return ResponseHelper.notFound(res, '思维导图不存在或无权限');
    }

    const current = (await dbConnection.query('SELECT share_state,share_revision FROM user_mindmaps WHERE id=? AND user_id=?', [id,userId])).rows[0];
    return ResponseHelper.success(res, {
      id: parseInt(id),
      ...current,
      share_token: current?.share_state === 'published' ? generateShareToken(id, current.share_revision) : null,
      message: requiredCredits > 0 ? `更新成功，消耗${requiredCredits}积分` : '更新成功'
    });
  } catch (error) {
    logger.error('更新思维导图失败:', error);
    return ResponseHelper.error(res, error.message || '更新失败');
  }
});

/**
 * POST /mindmap/export-log
 * 导出操作扣分
 */
router.post('/export-log', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { type } = req.body;

    let requiredCredits = 0;
    let exportType = '';

    if (type === 'svg') {
      requiredCredits = await SystemConfig.getSetting('mindmap.export_svg_credits') || 2;
      exportType = 'SVG';
    } else if (type === 'markdown') {
      requiredCredits = await SystemConfig.getSetting('mindmap.export_markdown_credits') || 1;
      exportType = 'Markdown';
    } else if (type === 'png') {
      requiredCredits = await SystemConfig.getSetting('mindmap.export_png_credits') || 3;
      exportType = 'PNG';
    } else if (type === 'pdf') {
      requiredCredits = await SystemConfig.getSetting('mindmap.export_pdf_credits') || 5;
      exportType = 'PDF';
    } else {
      return ResponseHelper.validation(res, {}, '无效的导出类型');
    }

    if (requiredCredits > 0) {
      const user = await User.findById(userId);
      if (!user) return ResponseHelper.error(res, '用户不存在');

      if (!user.hasCredits(requiredCredits)) {
        return ResponseHelper.error(res, `积分不足，需要${requiredCredits}积分，当前余额${user.getCredits()}积分`);
      }

      await user.consumeCredits(
        requiredCredits, null, null,
        `导出思维导图(${exportType})`, 'mindmap_export'
      );
    }

    return ResponseHelper.success(res, {
      message: requiredCredits > 0 ? `导出成功，消耗${requiredCredits}积分` : '导出成功',
      creditsUsed: requiredCredits
    });
  } catch (error) {
    logger.error('导出思维导图失败:', error);
    return ResponseHelper.error(res, error.message || '导出失败');
  }
});

/**
 * DELETE /mindmap/:id
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    if (!/^\d+$/.test(id)) {
      return ResponseHelper.validation(res, {}, '无效的导图ID');
    }

    const query = `
      DELETE FROM user_mindmaps
      WHERE id = ? AND user_id = ?
    `;
    const result = await dbConnection.query(query, [id, userId]);

    if (result.rows.affectedRows === 0) {
      return ResponseHelper.notFound(res, '思维导图不存在');
    }

    return ResponseHelper.success(res, { message: '删除成功' });
  } catch (error) {
    logger.error('删除思维导图失败:', error);
    return ResponseHelper.error(res, '删除失败');
  }
});

module.exports = router;

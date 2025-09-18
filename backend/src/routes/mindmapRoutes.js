/**
 * 思维导图相关路由
 * 提供思维导图的保存、加载、导出等功能（支持积分扣减）
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authMiddleware');
const dbConnection = require('../database/connection');
const ResponseHelper = require('../utils/response');
const SystemConfig = require('../models/SystemConfig');
const User = require('../models/User');
const logger = require('../utils/logger');

// 获取思维导图积分配置
router.get('/credits-config', authenticate, async (req, res) => {
  try {
    const saveCredits = await SystemConfig.getSetting('mindmap.save_credits') || 5;
    const exportSvgCredits = await SystemConfig.getSetting('mindmap.export_svg_credits') || 2;
    const exportMarkdownCredits = await SystemConfig.getSetting('mindmap.export_markdown_credits') || 1;
    
    return ResponseHelper.success(res, {
      save_credits: saveCredits,
      export_svg_credits: exportSvgCredits,
      export_markdown_credits: exportMarkdownCredits
    });
  } catch (error) {
    logger.error('获取思维导图积分配置失败:', error);
    return ResponseHelper.error(res, '获取配置失败');
  }
});

// 检查积分是否充足（供前端调用）
router.get('/check-credits', authenticate, async (req, res) => {
  try {
    const { operation } = req.query; // save, export_svg, export_markdown
    const userId = req.user.id;
    
    // 获取操作所需积分
    let requiredCredits = 0;
    switch(operation) {
      case 'save':
        requiredCredits = await SystemConfig.getSetting('mindmap.save_credits') || 5;
        break;
      case 'export_svg':
        requiredCredits = await SystemConfig.getSetting('mindmap.export_svg_credits') || 2;
        break;
      case 'export_markdown':
        requiredCredits = await SystemConfig.getSetting('mindmap.export_markdown_credits') || 1;
        break;
      default:
        return ResponseHelper.validation(res, ['无效的操作类型']);
    }
    
    // 如果积分设置为0，表示不需要积分
    if (requiredCredits === 0) {
      return ResponseHelper.success(res, {
        sufficient: true,
        requiredCredits: 0,
        currentCredits: 0,
        message: '该操作无需消耗积分'
      });
    }
    
    // 获取用户信息
    const user = await User.findById(userId);
    
    if (!user) {
      return ResponseHelper.error(res, '用户不存在');
    }
    
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

// 获取用户的思维导图列表
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const query = `
      SELECT id, title, content, created_at, updated_at
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

// 保存思维导图（需要扣减积分）
router.post('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { title, content } = req.body;
    
    if (!title || !content) {
      return ResponseHelper.validation(res, {}, '标题和内容不能为空');
    }
    
    // 获取保存所需积分
    const requiredCredits = await SystemConfig.getSetting('mindmap.save_credits') || 5;
    
    // 如果需要积分
    if (requiredCredits > 0) {
      const user = await User.findById(userId);
      
      if (!user) {
        return ResponseHelper.error(res, '用户不存在');
      }
      
      // 检查积分是否充足
      if (!user.hasCredits(requiredCredits)) {
        return ResponseHelper.error(res, `积分不足，需要${requiredCredits}积分，当前余额${user.getCredits()}积分`);
      }
      
      // 扣减积分
      await user.consumeCredits(
        requiredCredits, 
        null, 
        null, 
        '保存思维导图',
        'mindmap_save'
      );
      
      logger.info('思维导图保存扣减积分', { userId, credits: requiredCredits });
    }
    
    // 保存思维导图
    const query = `
      INSERT INTO user_mindmaps (user_id, title, content)
      VALUES (?, ?, ?)
    `;
    
    const result = await dbConnection.query(query, [userId, title, content]);
    
    return ResponseHelper.success(res, { 
      id: result.rows.insertId,
      message: requiredCredits > 0 ? `保存成功，消耗${requiredCredits}积分` : '保存成功'
    });
  } catch (error) {
    logger.error('保存思维导图失败:', error);
    return ResponseHelper.error(res, error.message || '保存失败');
  }
});

// 更新思维导图（需要扣减积分）
router.put('/:id', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { title, content } = req.body;
    
    // 获取保存所需积分
    const requiredCredits = await SystemConfig.getSetting('mindmap.save_credits') || 5;
    
    // 如果需要积分
    if (requiredCredits > 0) {
      const user = await User.findById(userId);
      
      if (!user) {
        return ResponseHelper.error(res, '用户不存在');
      }
      
      // 检查积分是否充足
      if (!user.hasCredits(requiredCredits)) {
        return ResponseHelper.error(res, `积分不足，需要${requiredCredits}积分，当前余额${user.getCredits()}积分`);
      }
      
      // 扣减积分
      await user.consumeCredits(
        requiredCredits,
        null,
        null,
        '更新思维导图',
        'mindmap_save'
      );
      
      logger.info('思维导图更新扣减积分', { userId, credits: requiredCredits });
    }
    
    const query = `
      UPDATE user_mindmaps
      SET title = ?, content = ?, updated_at = NOW()
      WHERE id = ? AND user_id = ?
    `;
    
    const result = await dbConnection.query(query, [title, content, id, userId]);
    
    if (result.rows.affectedRows === 0) {
      return ResponseHelper.notFound(res, '思维导图不存在');
    }
    
    return ResponseHelper.success(res, { 
      message: requiredCredits > 0 ? `更新成功，消耗${requiredCredits}积分` : '更新成功'
    });
  } catch (error) {
    logger.error('更新思维导图失败:', error);
    return ResponseHelper.error(res, error.message || '更新失败');
  }
});

// 导出操作记录（用于扣减积分）
router.post('/export-log', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { type } = req.body; // svg 或 markdown
    
    // 获取导出所需积分
    let requiredCredits = 0;
    let exportType = '';
    
    if (type === 'svg') {
      requiredCredits = await SystemConfig.getSetting('mindmap.export_svg_credits') || 2;
      exportType = 'SVG';
    } else if (type === 'markdown') {
      requiredCredits = await SystemConfig.getSetting('mindmap.export_markdown_credits') || 1;
      exportType = 'Markdown';
    } else {
      return ResponseHelper.validation(res, {}, '无效的导出类型');
    }
    
    // 如果需要积分
    if (requiredCredits > 0) {
      const user = await User.findById(userId);
      
      if (!user) {
        return ResponseHelper.error(res, '用户不存在');
      }
      
      // 检查积分是否充足
      if (!user.hasCredits(requiredCredits)) {
        return ResponseHelper.error(res, `积分不足，需要${requiredCredits}积分，当前余额${user.getCredits()}积分`);
      }
      
      // 扣减积分
      await user.consumeCredits(
        requiredCredits,
        null,
        null,
        `导出思维导图(${exportType})`,
        'mindmap_export'
      );
      
      logger.info('思维导图导出扣减积分', { userId, credits: requiredCredits, type: exportType });
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

// 删除思维导图
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    
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

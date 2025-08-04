/**
 * 模块组合控制器
 */

const ModuleCombination = require('../models/ModuleCombination');
const ResponseHelper = require('../utils/response');
const logger = require('../utils/logger');

class ModuleCombinationController {
  /**
   * 获取用户的模块组合列表
   */
  static async getCombinations(req, res) {
    try {
      const userId = req.user.id;
      const { include_inactive = false } = req.query;
      
      const combinations = await ModuleCombination.getUserCombinations(
        userId, 
        include_inactive === 'true'
      );
      
      // 获取每个组合的完整模块信息
      const combinationsWithModules = await Promise.all(
        combinations.map(async (combination) => {
          // 获取组合的完整信息（包括模块）
          const fullCombination = await ModuleCombination.findById(combination.id, userId);
          if (fullCombination) {
            return fullCombination.toJSON();
          }
          return combination.toJSON();
        })
      );
      
      return ResponseHelper.success(res, combinationsWithModules, '获取模块组合列表成功');
    } catch (error) {
      logger.error('获取模块组合列表失败', { 
        error: error.message,
        userId: req.user?.id 
      });
      return ResponseHelper.error(res, '获取模块组合列表失败');
    }
  }

  /**
   * 获取单个模块组合详情
   */
  static async getCombination(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      
      const combination = await ModuleCombination.findById(id, userId);
      
      if (!combination) {
        return ResponseHelper.notFound(res, '模块组合不存在');
      }
      
      if (combination.user_id !== userId) {
        return ResponseHelper.forbidden(res, '无权访问此组合');
      }
      
      return ResponseHelper.success(res, combination.toJSON(), '获取模块组合详情成功');
    } catch (error) {
      logger.error('获取模块组合详情失败', { 
        error: error.message,
        combinationId: req.params.id,
        userId: req.user?.id 
      });
      return ResponseHelper.error(res, '获取模块组合详情失败');
    }
  }

  /**
   * 创建模块组合
   */
  static async createCombination(req, res) {
    try {
      const userId = req.user.id;
      const { name, description, module_ids } = req.body;
      
      // 验证必填字段
      if (!name) {
        return ResponseHelper.validation(res, ['组合名称不能为空']);
      }
      
      if (!module_ids || !Array.isArray(module_ids) || module_ids.length === 0) {
        return ResponseHelper.validation(res, ['请至少选择一个模块']);
      }
      
      const combination = await ModuleCombination.create(
        { name, description, module_ids },
        userId
      );
      
      return ResponseHelper.success(res, combination.toJSON(), '创建模块组合成功', 201);
    } catch (error) {
      logger.error('创建模块组合失败', { 
        error: error.message,
        userId: req.user?.id,
        data: req.body 
      });
      return ResponseHelper.error(res, error.message || '创建模块组合失败');
    }
  }

  /**
   * 更新模块组合
   */
  static async updateCombination(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const updateData = req.body;
      
      const combination = await ModuleCombination.update(id, updateData, userId);
      
      return ResponseHelper.success(res, combination.toJSON(), '更新模块组合成功');
    } catch (error) {
      logger.error('更新模块组合失败', { 
        error: error.message,
        combinationId: req.params.id,
        userId: req.user?.id,
        data: req.body 
      });
      return ResponseHelper.error(res, error.message || '更新模块组合失败');
    }
  }

  /**
   * 删除模块组合
   */
  static async deleteCombination(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      
      await ModuleCombination.delete(id, userId);
      
      return ResponseHelper.success(res, null, '删除模块组合成功');
    } catch (error) {
      logger.error('删除模块组合失败', { 
        error: error.message,
        combinationId: req.params.id,
        userId: req.user?.id 
      });
      return ResponseHelper.error(res, error.message || '删除模块组合失败');
    }
  }

  /**
   * 复制模块组合
   */
  static async copyCombination(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { name } = req.body;
      
      const newCombination = await ModuleCombination.copy(id, userId, name);
      
      return ResponseHelper.success(res, newCombination.toJSON(), '复制模块组合成功', 201);
    } catch (error) {
      logger.error('复制模块组合失败', { 
        error: error.message,
        combinationId: req.params.id,
        userId: req.user?.id 
      });
      return ResponseHelper.error(res, error.message || '复制模块组合失败');
    }
  }

  /**
   * 获取组合内容（用于对话）
   */
  static async getCombinationContent(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      
      const content = await ModuleCombination.getCombinedContent(id, userId);
      
      return ResponseHelper.success(res, content, '获取组合内容成功');
    } catch (error) {
      logger.error('获取组合内容失败', { 
        error: error.message,
        combinationId: req.params.id,
        userId: req.user?.id 
      });
      return ResponseHelper.error(res, error.message || '获取组合内容失败');
    }
  }
}

module.exports = ModuleCombinationController;

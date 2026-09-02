/**
 * AI渠道管理控制器
 *
 * 渠道 = API接入点(名称+Base URL+Key)，供创建/编辑AI模型时选择复用，
 * 避免每个模型都要单独填写一遍URL和Key。存储在system_settings表(非新表)，
 * 详见 services/admin/ChannelService.js 的设计说明。
 *
 * 权限：全部接口仅超级管理员可访问(与AI模型管理canManageAIModels一致)。
 */

const ChannelService = require('../../services/admin/ChannelService');
const ResponseHelper = require('../../utils/response');
const { ValidationError } = require('../../utils/errors');
const logger = require('../../utils/logger');

class AIChannelController {
  /**
   * 获取渠道列表(密钥脱敏)
   */
  static async getChannels(req, res) {
    try {
      const channels = await ChannelService.getChannelsForDisplay();
      return ResponseHelper.success(res, channels, '获取渠道列表成功');
    } catch (error) {
      logger.error('获取渠道列表失败', { adminId: req.user?.id, error: error.message });
      return ResponseHelper.error(res, '获取渠道列表失败');
    }
  }

  /**
   * 创建渠道
   */
  static async createChannel(req, res) {
    try {
      const { name, base_url, api_key } = req.body;
      const channel = await ChannelService.createChannel({ name, base_url, api_key });

      logger.info('创建AI渠道成功', { adminId: req.user.id, channelId: channel.id, name: channel.name });

      return ResponseHelper.success(res, channel, '渠道创建成功', 201);
    } catch (error) {
      logger.error('创建AI渠道失败', { adminId: req.user?.id, error: error.message });
      if (error instanceof ValidationError) {
        return ResponseHelper.validation(res, [error.message]);
      }
      return ResponseHelper.error(res, '创建渠道失败');
    }
  }

  /**
   * 更新渠道(api_key留空表示保持不变)
   */
  static async updateChannel(req, res) {
    try {
      const { id } = req.params;
      const { name, base_url, api_key } = req.body;
      const channel = await ChannelService.updateChannel(id, { name, base_url, api_key });

      logger.info('更新AI渠道成功', { adminId: req.user.id, channelId: id });

      return ResponseHelper.success(res, channel, '渠道更新成功');
    } catch (error) {
      logger.error('更新AI渠道失败', { adminId: req.user?.id, channelId: req.params.id, error: error.message });
      if (error instanceof ValidationError) {
        return ResponseHelper.validation(res, [error.message]);
      }
      return ResponseHelper.error(res, '更新渠道失败');
    }
  }

  /**
   * 删除渠道
   */
  static async deleteChannel(req, res) {
    try {
      const { id } = req.params;
      await ChannelService.deleteChannel(id);

      logger.info('删除AI渠道成功', { adminId: req.user.id, channelId: id });

      return ResponseHelper.success(res, null, '渠道删除成功');
    } catch (error) {
      logger.error('删除AI渠道失败', { adminId: req.user?.id, channelId: req.params.id, error: error.message });
      if (error instanceof ValidationError) {
        return ResponseHelper.validation(res, [error.message]);
      }
      return ResponseHelper.error(res, '删除渠道失败');
    }
  }
}

module.exports = AIChannelController;

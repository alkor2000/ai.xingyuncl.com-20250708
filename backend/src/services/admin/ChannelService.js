/**
 * AI渠道管理服务
 *
 * 背景：AI模型管理原本每个模型都要单独填写一遍API密钥+API端点(Base URL)，
 * 当多个模型共用同一个中转/代理服务商时非常繁琐。引入"渠道"概念——
 * 渠道 = 一个API接入点(名称+Base URL+Key)，创建/编辑AI模型时选择某个渠道，
 * 系统会自动使用该渠道当前的URL和Key填入模型配置，无需重复手动输入。
 *
 * 技术方案（刻意不新增数据库表/字段，避免开发/生产环境迁移同步成本）：
 *   渠道列表以JSON数组形式存储在系统已有的通用配置表 system_settings 中
 *   (setting_key='ai_channels_config')，与本系统已有的oss_config/sso_config/
 *   embedding_config等配置存储方式完全一致的既有模式，零数据库结构变更。
 *
 * 与AI模型(ai_models表)的关联方式：
 *   ai_models表不新增channel_id字段。创建/编辑模型时若指定了渠道，
 *   由调用方(AIModelController)在写库前实时解析该渠道当前的base_url+api_key
 *   并直接填入模型的api_endpoint/api_key字段——即"渠道"只是创建/编辑时的
 *   一次性填充助手，不建立持久化的强关联。这意味着渠道密钥后续更换后，
 *   已用该渠道创建的模型不会自动同步，需要在模型编辑时重新选择该渠道
 *   才会拉取最新值(前端会在此处做出提示)。
 *
 * 安全说明：
 *   每个渠道的api_key在写入system_settings前使用cryptoHelper.encrypt()加密
 *   (与ImageModel/VideoModel/Module等模型的密钥加密方式一致)，对外展示
 *   (getChannelsForDisplay)统一走AIModel.maskSensitiveValue()脱敏(头尾可见)，
 *   解密后的明文密钥只会在resolveChannelById()内部流转，供AIModelController
 *   写入ai_models表使用，绝不会返回给前端。
 */

const dbConnection = require('../../database/connection');
const cryptoHelper = require('../../utils/cryptoHelper');
const AIModel = require('../../models/AIModel');
const { ValidationError } = require('../../utils/errors');
const logger = require('../../utils/logger');

/** system_settings表中存储渠道列表的键名 */
const SETTING_KEY = 'ai_channels_config';

class ChannelService {
  /**
   * 内部方法：从system_settings读取原始渠道列表并解密api_key
   * 单个渠道解密失败不影响其他渠道的正常读取(降级为空字符串)
   * @returns {Array<{id,name,base_url,api_key,created_at,updated_at}>}
   */
  static async _loadChannels() {
    try {
      const { rows } = await dbConnection.query(
        'SELECT setting_value FROM system_settings WHERE setting_key = ?',
        [SETTING_KEY]
      );

      if (rows.length === 0) return [];

      let channels;
      try {
        channels = JSON.parse(rows[0].setting_value);
      } catch (parseError) {
        logger.error('解析渠道配置JSON失败:', parseError);
        return [];
      }

      if (!Array.isArray(channels)) return [];

      return channels.map(ch => {
        let plainKey = '';
        try {
          plainKey = cryptoHelper.decrypt(ch.api_key) || '';
        } catch (decryptError) {
          logger.warn('渠道密钥解密失败，该渠道密钥将为空', { channelId: ch.id });
        }
        return { ...ch, api_key: plainKey };
      });
    } catch (error) {
      logger.error('读取渠道列表失败:', error);
      throw error;
    }
  }

  /**
   * 内部方法：加密渠道列表的api_key字段后写回system_settings
   * 沿用OSS配置/Embedding配置已验证过的"先查是否存在再决定INSERT或UPDATE"模式
   */
  static async _saveChannels(channels) {
    const encrypted = channels.map(ch => ({
      ...ch,
      api_key: ch.api_key ? cryptoHelper.encrypt(ch.api_key) : null
    }));
    const value = JSON.stringify(encrypted);

    const { rows } = await dbConnection.query(
      'SELECT id FROM system_settings WHERE setting_key = ?',
      [SETTING_KEY]
    );

    if (rows.length === 0) {
      await dbConnection.query(
        'INSERT INTO system_settings (setting_key, setting_value, setting_type, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
        [SETTING_KEY, value, 'json']
      );
    } else {
      await dbConnection.query(
        'UPDATE system_settings SET setting_value = ?, updated_at = NOW() WHERE setting_key = ?',
        [value, SETTING_KEY]
      );
    }
  }

  /**
   * 获取渠道列表供管理界面展示(密钥脱敏，不含明文)
   * @returns {Array<{id,name,base_url,api_key_masked,has_api_key,created_at,updated_at}>}
   */
  static async getChannelsForDisplay() {
    const channels = await this._loadChannels();
    return channels.map(ch => ({
      id: ch.id,
      name: ch.name,
      base_url: ch.base_url,
      api_key_masked: ch.api_key ? AIModel.maskSensitiveValue(ch.api_key) : null,
      has_api_key: !!ch.api_key,
      created_at: ch.created_at,
      updated_at: ch.updated_at
    }));
  }

  /**
   * 创建渠道
   * @param {{name:string, base_url:string, api_key:string}} data
   */
  static async createChannel({ name, base_url, api_key }) {
    if (!name || !name.trim()) throw new ValidationError('渠道名称不能为空');
    if (!base_url || !base_url.trim()) throw new ValidationError('API Base URL不能为空');
    if (!api_key || !api_key.trim()) throw new ValidationError('API Key不能为空');

    const channels = await this._loadChannels();
    const nextId = channels.length > 0 ? Math.max(...channels.map(c => c.id)) + 1 : 1;
    const now = new Date().toISOString();

    const newChannel = {
      id: nextId,
      name: name.trim(),
      base_url: base_url.trim(),
      api_key: api_key.trim(),
      created_at: now,
      updated_at: now
    };

    channels.push(newChannel);
    await this._saveChannels(channels);

    logger.info('AI渠道创建成功', { channelId: newChannel.id, name: newChannel.name });

    return { id: newChannel.id, name: newChannel.name, base_url: newChannel.base_url };
  }

  /**
   * 更新渠道
   * api_key留空表示保持原值不变，与AI模型编辑弹窗的既有交互习惯一致
   * @param {number} id
   * @param {{name?:string, base_url?:string, api_key?:string}} data
   */
  static async updateChannel(id, { name, base_url, api_key }) {
    const channels = await this._loadChannels();
    const idx = channels.findIndex(c => c.id === Number(id));
    if (idx === -1) throw new ValidationError('渠道不存在');

    const existing = channels[idx];
    channels[idx] = {
      ...existing,
      name: (name !== undefined && name.trim()) ? name.trim() : existing.name,
      base_url: (base_url !== undefined && base_url.trim()) ? base_url.trim() : existing.base_url,
      api_key: (api_key !== undefined && api_key.trim()) ? api_key.trim() : existing.api_key,
      updated_at: new Date().toISOString()
    };

    await this._saveChannels(channels);

    logger.info('AI渠道更新成功', { channelId: id });

    return { id: channels[idx].id, name: channels[idx].name, base_url: channels[idx].base_url };
  }

  /**
   * 删除渠道
   * 注：已使用该渠道创建的AI模型不受影响(渠道与模型无持久化强关联，
   * 模型自身的api_key/api_endpoint早已在创建时写入ai_models表)
   */
  static async deleteChannel(id) {
    const channels = await this._loadChannels();
    const idx = channels.findIndex(c => c.id === Number(id));
    if (idx === -1) throw new ValidationError('渠道不存在');

    channels.splice(idx, 1);
    await this._saveChannels(channels);

    logger.info('AI渠道删除成功', { channelId: id });
  }

  /**
   * 根据ID解析渠道，返回含明文api_key的完整信息
   * 仅供AIModelController在创建/更新AI模型时内部调用，用于填充模型的
   * api_key/api_endpoint字段，返回结果绝不能直接暴露给前端接口。
   * @param {number} id
   * @returns {{id:number,name:string,base_url:string,api_key:string}}
   */
  static async resolveChannelById(id) {
    if (!id) return null;
    const channels = await this._loadChannels();
    const channel = channels.find(c => c.id === Number(id));
    if (!channel) throw new ValidationError('所选渠道不存在，可能已被删除，请重新选择');
    return { id: channel.id, name: channel.name, base_url: channel.base_url, api_key: channel.api_key };
  }
}

module.exports = ChannelService;

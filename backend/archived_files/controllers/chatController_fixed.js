  /**
   * 获取会话消息
   * GET /api/chat/conversations/:id/messages
   */
  static async getMessages(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      // 修改：将默认limit从50改为1000，确保显示所有历史消息
      const { page = 1, limit = 1000, useCache = true } = req.query;

      // 检查并恢复未完成的流式消息
      await Message.checkAndRecoverStreamingMessages(id);

      // 检查会话所有权
      const hasAccess = await Conversation.checkOwnership(id, userId);
      if (!hasAccess) {
        return ResponseHelper.forbidden(res, '无权访问此会话消息');
      }

      // 尝试从缓存获取
      if (useCache !== 'false') {
        const cachedMessages = await CacheService.getCachedMessages(userId, id);
        if (cachedMessages) {
          logger.info('从缓存返回消息', { conversationId: id, count: cachedMessages.length });
          
          // 处理带图片或文档的消息
          const messagesWithFiles = await Promise.all(cachedMessages.map(async msg => {
            if (msg.file_id) {
              const file = await File.findById(msg.file_id);
              if (file) {
                msg.file = file.toJSON();
              }
            }
            return msg;
          }));
          
          return ResponseHelper.success(res, messagesWithFiles, '获取消息列表成功');
        }
      }

      // 从数据库获取
      const result = await Message.getConversationMessages(id, {
        page: parseInt(page),
        limit: parseInt(limit),
        order: 'ASC'
      });

      // 处理带图片或文档的消息
      const messagesWithFiles = await Promise.all(result.messages.map(async msg => {
        const msgData = msg.toJSON();
        if (msgData.file_id) {
          const file = await File.findById(msgData.file_id);
          if (file) {
            msgData.file = file.toJSON();
          }
        }
        return msgData;
      }));

      // 缓存消息（只缓存第一页）
      if (page == 1 && messagesWithFiles.length > 0) {
        await CacheService.cacheMessages(userId, id, messagesWithFiles);
      }

      return ResponseHelper.paginated(res, messagesWithFiles, result.pagination, '获取消息列表成功');
    } catch (error) {
      logger.error('获取会话消息失败', { 
        conversationId: req.params.id,
        userId: req.user?.id, 
        error: error.message,
        stack: error.stack
      });
      return ResponseHelper.error(res, '获取消息失败');
    }
  }

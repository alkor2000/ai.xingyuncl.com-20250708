  /**
   * 计算积分消耗（简化版）
   * 公式：基础积分 + (文件大小MB / 5) * 每5MB积分
   */
  static async calculateCreditCost(action, files) {
    try {
      // 只对上传操作收费
      if (action !== 'upload') {
        return 0;
      }
      
      // 获取简化配置
      const sql = `SELECT * FROM storage_credits_config_simple WHERE is_active = 1 LIMIT 1`;
      const { rows } = await dbConnection.query(sql);
      
      if (rows.length === 0) {
        logger.warn('未找到积分配置，使用默认值');
        // 默认配置
        const config = {
          base_credits: 2,
          credits_per_5mb: 1,
          max_file_size: 100
        };
        rows.push(config);
      }
      
      const config = rows[0];
      let totalCost = 0;
      
      for (const file of files) {
        // 检查文件大小限制
        const fileSizeMB = file.size / (1024 * 1024);
        if (fileSizeMB > config.max_file_size) {
          throw new Error(`文件 ${file.originalname} 超过最大限制 ${config.max_file_size}MB`);
        }
        
        // 计算单个文件积分
        // 基础积分 + 大小积分
        const sizeCredits = Math.ceil(fileSizeMB / 5) * parseFloat(config.credits_per_5mb);
        const fileCredits = parseInt(config.base_credits) + sizeCredits;
        
        totalCost += fileCredits;
        
        logger.info('文件积分计算', {
          filename: file.originalname,
          sizeMB: fileSizeMB.toFixed(2),
          baseCredits: config.base_credits,
          sizeCredits: sizeCredits,
          totalCredits: fileCredits
        });
      }
      
      return Math.ceil(totalCost);
    } catch (error) {
      logger.error('计算积分消耗失败:', error);
      // 出错时返回0，不阻止上传
      return 0;
    }
  }

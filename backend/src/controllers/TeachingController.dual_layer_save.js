/**
 * 双层配置保存方法片段
 * 用于替换TeachingController中的saveGlobalAuthorizations方法
 * 
 * 核心改进：
 * 1. 超级管理员保存到superAdminConfig层
 * 2. 组管理员保存到groupAdminConfig层
 * 3. 保持两层配置独立，防止覆盖
 */

  // ==================== 全局授权管理（双层配置版 v2.0）====================

  /**
   * 保存全局授权配置（双层配置版）
   * 超级管理员：更新superAdminConfig层（模块级授权）
   * 组管理员：更新groupAdminConfig层（标签和用户级分配）
   * 
   * @version 2.0.0
   * @since 2025-11-09
   */
  static async saveGlobalAuthorizations(req, res) {
    try {
      const user = req.user;
      const { authorizations } = req.body;

      if (!Array.isArray(authorizations) || authorizations.length === 0) {
        return ResponseHelper.validation(res, ['授权配置不能为空']);
      }

      const dbConnection = require('../database/connection');

      // 组管理员权限检查
      if (user.role === 'admin') {
        // 检查是否只操作本组
        const invalidGroups = authorizations.filter(auth => auth.groupId !== user.group_id);
        if (invalidGroups.length > 0) {
          return ResponseHelper.forbidden(res, '组管理员只能管理本组的授权配置');
        }
      }

      // 使用事务保存配置
      await dbConnection.transaction(async (query) => {
        for (const auth of authorizations) {
          const { groupId, modulePermissions, tags } = auth;

          if (!groupId) {
            continue;
          }

          // 获取现有配置
          const { rows: existingRows } = await query(
            'SELECT config_data FROM teaching_global_authorizations WHERE group_id = ?',
            [groupId]
          );

          let existingConfig = {};
          if (existingRows.length > 0) {
            try {
              existingConfig = typeof existingRows[0].config_data === 'string'
                ? JSON.parse(existingRows[0].config_data)
                : existingRows[0].config_data;
            } catch (error) {
              logger.error('解析现有配置失败:', error);
              existingConfig = {};
            }
          }

          // 构建双层配置
          let newConfig;
          
          if (user.role === 'super_admin') {
            // 超级管理员：更新superAdminConfig层
            newConfig = {
              ...existingConfig,
              superAdminConfig: {
                modulePermissions: modulePermissions || [],
                createdBy: user.id,
                createdAt: existingConfig.superAdminConfig?.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                note: '超级管理员授权配置'
              },
              // 如果是首次设置，初始化groupAdminConfig
              groupAdminConfig: existingConfig.groupAdminConfig || {
                tags: tags || [],
                updatedBy: user.id,
                updatedAt: new Date().toISOString(),
                note: '组管理员分配配置'
              },
              version: '2.0.0',
              lastUpdatedBy: user.id,
              lastUpdatedAt: new Date().toISOString()
            };
          } else if (user.role === 'admin') {
            // 组管理员：只更新groupAdminConfig层
            if (!existingConfig.superAdminConfig) {
              return ResponseHelper.forbidden(res, '超级管理员尚未对该组进行授权配置');
            }

            // 验证组管理员不能分配超出授权范围的模块
            const authorizedModuleIds = new Set(
              (existingConfig.superAdminConfig.modulePermissions || [])
                .filter(mp => mp.view_lesson || mp.view_plan || mp.edit || mp.view)
                .map(mp => mp.moduleId)
            );

            // 检查标签和用户配置中的模块
            for (const tag of (tags || [])) {
              for (const mp of (tag.modulePermissions || [])) {
                if (!authorizedModuleIds.has(mp.moduleId)) {
                  return ResponseHelper.forbidden(res, 
                    `模块 ${mp.moduleName || mp.moduleId} 未被超级管理员授权，无法分配`
                  );
                }
              }
              
              // 检查用户级配置
              for (const user of (tag.users || [])) {
                for (const mp of (user.modulePermissions || [])) {
                  if (!authorizedModuleIds.has(mp.moduleId)) {
                    return ResponseHelper.forbidden(res, 
                      `模块 ${mp.moduleName || mp.moduleId} 未被超级管理员授权，无法分配`
                    );
                  }
                }
              }
            }

            // 更新groupAdminConfig层
            newConfig = {
              ...existingConfig,
              superAdminConfig: existingConfig.superAdminConfig, // 保持不变
              groupAdminConfig: {
                tags: tags || [],
                updatedBy: user.id,
                updatedAt: new Date().toISOString(),
                note: '组管理员分配配置'
              },
              version: '2.0.0',
              lastUpdatedBy: user.id,
              lastUpdatedAt: new Date().toISOString()
            };
          } else {
            return ResponseHelper.forbidden(res, '无权执行此操作');
          }

          // 保存配置
          if (existingRows.length > 0) {
            // 更新现有记录
            const updateSql = `
              UPDATE teaching_global_authorizations 
              SET config_data = ?, updated_by = ?, updated_at = NOW()
              WHERE group_id = ?
            `;
            await query(updateSql, [JSON.stringify(newConfig), user.id, groupId]);
          } else {
            // 插入新记录
            const insertSql = `
              INSERT INTO teaching_global_authorizations 
              (group_id, config_data, created_by, updated_by, created_at, updated_at)
              VALUES (?, ?, ?, ?, NOW(), NOW())
            `;
            await query(insertSql, [groupId, JSON.stringify(newConfig), user.id, user.id]);
          }
        }
      });

      logger.info('双层授权配置保存成功', {
        userId: user.id,
        userRole: user.role,
        groupCount: authorizations.length,
        layer: user.role === 'super_admin' ? 'superAdminConfig' : 'groupAdminConfig'
      });

      return ResponseHelper.success(res, null, '授权配置保存成功');
    } catch (error) {
      logger.error('保存双层授权配置失败:', error);
      return ResponseHelper.error(res, error.message || '保存授权配置失败');
    }
  }

  /**
   * 获取全局授权配置（双层配置版）
   * 返回合并后的配置，前端可以正确显示两层权限
   * 
   * @version 2.0.0
   * @since 2025-11-09
   */
  static async getGlobalAuthorizations(req, res) {
    try {
      const user = req.user;
      const dbConnection = require('../database/connection');

      let sql;
      let params = [];

      if (user.role === 'admin') {
        // 组管理员只获取本组的配置
        sql = `
          SELECT 
            tga.id,
            tga.group_id,
            tga.config_data,
            ug.name as group_name,
            (SELECT COUNT(*) FROM users WHERE group_id = ug.id AND deleted_at IS NULL) as user_count,
            tga.created_at,
            tga.updated_at
          FROM teaching_global_authorizations tga
          LEFT JOIN user_groups ug ON tga.group_id = ug.id
          WHERE tga.group_id = ?
        `;
        params = [user.group_id];
      } else if (user.role === 'super_admin') {
        // 超级管理员获取所有组的配置
        sql = `
          SELECT 
            tga.id,
            tga.group_id,
            tga.config_data,
            ug.name as group_name,
            (SELECT COUNT(*) FROM users WHERE group_id = ug.id AND deleted_at IS NULL) as user_count,
            tga.created_at,
            tga.updated_at
          FROM teaching_global_authorizations tga
          LEFT JOIN user_groups ug ON tga.group_id = ug.id
          WHERE ug.id IS NOT NULL
          ORDER BY ug.name ASC
        `;
      } else {
        return ResponseHelper.forbidden(res, '无权访问授权配置');
      }

      const { rows } = await dbConnection.query(sql, params);

      const authorizations = rows.map(row => {
        let configData;
        try {
          configData = typeof row.config_data === 'string' 
            ? JSON.parse(row.config_data) 
            : row.config_data;
        } catch (error) {
          logger.error('解析配置数据失败:', error);
          configData = {};
        }

        // 合并双层配置为前端期望的格式
        let mergedConfig;
        
        if (configData.version === '2.0.0') {
          // 新的双层格式
          const superConfig = configData.superAdminConfig || {};
          const groupConfig = configData.groupAdminConfig || {};
          
          mergedConfig = {
            modulePermissions: superConfig.modulePermissions || [],
            tags: groupConfig.tags || [],
            // 保留元数据供前端参考
            _metadata: {
              version: '2.0.0',
              superAdminUpdatedAt: superConfig.updatedAt,
              superAdminUpdatedBy: superConfig.createdBy,
              groupAdminUpdatedAt: groupConfig.updatedAt,
              groupAdminUpdatedBy: groupConfig.updatedBy
            }
          };
        } else {
          // 兼容旧格式
          mergedConfig = {
            modulePermissions: configData.modulePermissions || [],
            tags: configData.tags || []
          };
        }

        return {
          id: row.id,
          groupId: row.group_id,
          groupName: row.group_name,
          userCount: row.user_count,
          config: mergedConfig,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
      });

      logger.info('获取双层授权配置成功', {
        userId: user.id,
        userRole: user.role,
        recordCount: authorizations.length
      });

      return ResponseHelper.success(res, authorizations, '获取授权配置成功');
    } catch (error) {
      logger.error('获取双层授权配置失败:', error);
      return ResponseHelper.error(res, '获取授权配置失败');
    }
  }

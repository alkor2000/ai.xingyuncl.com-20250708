/**
 * Casbin数据同步服务
 * 
 * 功能：
 * - 将现有的teaching_global_authorizations数据同步到Casbin
 * - 支持双向同步，确保数据一致性
 * - 提供增量同步和全量同步
 */

const dbConnection = require('../../database/connection');
const CasbinService = require('./CasbinService');
const logger = require('../../utils/logger');

class CasbinSyncService {
  /**
   * 从现有系统同步到Casbin
   */
  async syncFromGlobalAuth() {
    try {
      logger.info('开始同步全局授权数据到Casbin...');
      
      // 获取所有全局授权配置
      const sql = 'SELECT * FROM teaching_global_authorizations';
      const { rows } = await dbConnection.query(sql);
      
      let totalPolicies = 0;
      
      for (const row of rows) {
        const config = JSON.parse(row.config_data);
        const groupId = row.group_id;
        
        // 同步组权限
        if (config.modulePermissions) {
          for (const perm of config.modulePermissions) {
            if (perm.view) {
              await CasbinService.addPolicy(
                `group:${groupId}`,
                `module:${perm.moduleId}`,
                'view',
                'allow'
              );
              totalPolicies++;
            }
            if (perm.edit) {
              await CasbinService.addPolicy(
                `group:${groupId}`,
                `module:${perm.moduleId}`,
                'edit',
                'allow'
              );
              totalPolicies++;
            }
            
            // 同步课程权限
            if (perm.lessons) {
              for (const lesson of perm.lessons) {
                if (lesson.view === false) {
                  await CasbinService.addPolicy(
                    `group:${groupId}`,
                    `lesson:${lesson.lessonId}`,
                    'view',
                    'deny'
                  );
                  totalPolicies++;
                }
                if (lesson.edit === false) {
                  await CasbinService.addPolicy(
                    `group:${groupId}`,
                    `lesson:${lesson.lessonId}`,
                    'edit',
                    'deny'
                  );
                  totalPolicies++;
                }
              }
            }
          }
        }
        
        // 同步标签权限
        if (config.tags) {
          for (const tag of config.tags) {
            // 标签继承组
            if (tag.inheritFromGroup) {
              await CasbinService.addRoleForUser(
                `tag:${tag.tagId}`,
                `group:${groupId}`
              );
            } else {
              // 标签自己的权限
              if (tag.modulePermissions) {
                for (const perm of tag.modulePermissions) {
                  if (perm.view) {
                    await CasbinService.addPolicy(
                      `tag:${tag.tagId}`,
                      `module:${perm.moduleId}`,
                      'view',
                      'allow'
                    );
                    totalPolicies++;
                  }
                  if (perm.edit) {
                    await CasbinService.addPolicy(
                      `tag:${tag.tagId}`,
                      `module:${perm.moduleId}`,
                      'edit',
                      'allow'
                    );
                    totalPolicies++;
                  }
                }
              }
            }
            
            // 同步用户权限
            if (tag.users) {
              for (const user of tag.users) {
                // 用户继承标签
                if (user.inheritFromTag) {
                  await CasbinService.addRoleForUser(
                    `user:${user.userId}`,
                    `tag:${tag.tagId}`
                  );
                } else {
                  // 用户自己的权限
                  if (user.modulePermissions) {
                    for (const perm of user.modulePermissions) {
                      if (perm.view) {
                        await CasbinService.addPolicy(
                          `user:${user.userId}`,
                          `module:${perm.moduleId}`,
                          'view',
                          'allow'
                        );
                        totalPolicies++;
                      }
                      if (perm.edit) {
                        await CasbinService.addPolicy(
                          `user:${user.userId}`,
                          `module:${perm.moduleId}`,
                          'edit',
                          'allow'
                        );
                        totalPolicies++;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      
      // 更新同步元数据
      await dbConnection.query(
        'UPDATE casbin_metadata SET sync_version = sync_version + 1, sync_status = "completed" WHERE id = 1'
      );
      
      logger.info(`同步完成：共同步${totalPolicies}条策略`);
      return { success: true, totalPolicies };
      
    } catch (error) {
      logger.error('同步失败:', error);
      await dbConnection.query(
        'UPDATE casbin_metadata SET sync_status = "failed" WHERE id = 1'
      );
      throw error;
    }
  }

  /**
   * 清空Casbin策略
   */
  async clearPolicies() {
    try {
      await dbConnection.query('DELETE FROM casbin_rule');
      await CasbinService.reloadPolicy();
      logger.info('Casbin策略已清空');
    } catch (error) {
      logger.error('清空策略失败:', error);
      throw error;
    }
  }

  /**
   * 获取同步状态
   */
  async getSyncStatus() {
    try {
      const { rows } = await dbConnection.query(
        'SELECT * FROM casbin_metadata WHERE id = 1'
      );
      return rows[0];
    } catch (error) {
      logger.error('获取同步状态失败:', error);
      return null;
    }
  }
}

module.exports = new CasbinSyncService();

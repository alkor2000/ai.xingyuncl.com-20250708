/**
 * 权限数据同步脚本
 * 将现有的teaching_global_authorizations数据完整同步到Casbin
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const dbConnection = require('./src/database/connection');
const CasbinService = require('./src/services/casbin/CasbinService');
const logger = require('./src/utils/logger');

async function syncAuthToCasbin() {
  console.log('==================== 开始同步权限数据 ====================\n');
  
  try {
    // 1. 初始化连接
    console.log('1. 初始化数据库连接...');
    await dbConnection.initialize();
    console.log('   ✓ 数据库连接成功\n');
    
    // 2. 初始化Casbin
    console.log('2. 初始化Casbin...');
    await CasbinService.initialize();
    console.log('   ✓ Casbin初始化成功\n');
    
    // 3. 清空现有Casbin策略
    console.log('3. 清空现有策略...');
    await dbConnection.query('DELETE FROM casbin_rule');
    await dbConnection.query('DELETE FROM casbin_deny_policies');
    await CasbinService.reloadPolicy();
    console.log('   ✓ 策略已清空\n');
    
    // 4. 同步用户到标签的关系
    console.log('4. 同步用户-标签关系...');
    const userTagSql = `
      SELECT utr.user_id, utr.tag_id
      FROM user_tag_relations utr
      JOIN user_tags ut ON utr.tag_id = ut.id
      WHERE ut.is_active = 1
    `;
    const { rows: userTags } = await dbConnection.query(userTagSql);
    
    for (const rel of userTags) {
      await CasbinService.addRoleForUser(
        `user:${rel.user_id}`,
        `tag:${rel.tag_id}`
      );
    }
    console.log(`   ✓ 同步了 ${userTags.length} 个用户-标签关系\n`);
    
    // 5. 同步标签到组的关系
    console.log('5. 同步标签-组关系...');
    const tagGroupSql = `
      SELECT DISTINCT ut.id as tag_id, u.group_id
      FROM user_tags ut
      JOIN user_tag_relations utr ON ut.id = utr.tag_id
      JOIN users u ON utr.user_id = u.id
      WHERE ut.is_active = 1 AND u.group_id IS NOT NULL
    `;
    const { rows: tagGroups } = await dbConnection.query(tagGroupSql);
    
    for (const rel of tagGroups) {
      await CasbinService.addRoleForUser(
        `tag:${rel.tag_id}`,
        `group:${rel.group_id}`
      );
    }
    console.log(`   ✓ 同步了 ${tagGroups.length} 个标签-组关系\n`);
    
    // 6. 同步全局授权配置
    console.log('6. 同步全局授权配置...');
    const authSql = 'SELECT * FROM teaching_global_authorizations';
    const { rows: auths } = await dbConnection.query(authSql);
    
    let totalPolicies = 0;
    
    for (const auth of auths) {
      const groupId = auth.group_id;
      let config;
      
      try {
        config = typeof auth.config_data === 'string' 
          ? JSON.parse(auth.config_data) 
          : auth.config_data;
      } catch (e) {
        console.error(`   ✗ 解析组 ${groupId} 的配置失败`);
        continue;
      }
      
      console.log(`   处理组 ${groupId} 的授权...`);
      
      // 同步组级模块权限
      if (config.modulePermissions && Array.isArray(config.modulePermissions)) {
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
          
          // 同步课程级权限（特别是deny）
          if (perm.lessons && Array.isArray(perm.lessons)) {
            for (const lesson of perm.lessons) {
              // 处理明确的false权限（deny）
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
              // 处理明确的true权限
              if (lesson.view === true) {
                await CasbinService.addPolicy(
                  `group:${groupId}`,
                  `lesson:${lesson.lessonId}`,
                  'view',
                  'allow'
                );
                totalPolicies++;
              }
              if (lesson.edit === true) {
                await CasbinService.addPolicy(
                  `group:${groupId}`,
                  `lesson:${lesson.lessonId}`,
                  'edit',
                  'allow'
                );
                totalPolicies++;
              }
            }
          }
        }
      }
      
      // 同步标签权限
      if (config.tags && Array.isArray(config.tags)) {
        for (const tag of config.tags) {
          // 标签继承组权限
          if (tag.inheritFromGroup) {
            // 已在前面建立了继承关系
            console.log(`     标签 ${tag.tagId} 继承组权限`);
          } else if (tag.modulePermissions && Array.isArray(tag.modulePermissions)) {
            // 标签有自己的权限
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
          
          // 同步用户权限
          if (tag.users && Array.isArray(tag.users)) {
            for (const user of tag.users) {
              if (user.inheritFromTag) {
                // 用户继承标签权限（关系已建立）
                console.log(`     用户 ${user.userId} 继承标签 ${tag.tagId} 权限`);
              } else if (user.modulePermissions && Array.isArray(user.modulePermissions)) {
                // 用户有自己的权限
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
                  
                  // 处理课程级权限
                  if (perm.lessons && Array.isArray(perm.lessons)) {
                    for (const lesson of perm.lessons) {
                      if (lesson.view === false) {
                        await CasbinService.addPolicy(
                          `user:${user.userId}`,
                          `lesson:${lesson.lessonId}`,
                          'view',
                          'deny'
                        );
                        totalPolicies++;
                      }
                      if (lesson.edit === false) {
                        await CasbinService.addPolicy(
                          `user:${user.userId}`,
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
            }
          }
        }
      }
    }
    
    console.log(`\n   ✓ 共同步 ${totalPolicies} 条策略\n`);
    
    // 7. 同步创建者权限
    console.log('7. 同步模块创建者权限...');
    const creatorSql = `
      SELECT DISTINCT creator_id, id as module_id 
      FROM teaching_modules 
      WHERE is_deleted = 0
    `;
    const { rows: creators } = await dbConnection.query(creatorSql);
    
    for (const creator of creators) {
      await CasbinService.addPolicy(
        `user:${creator.creator_id}`,
        `module:${creator.module_id}`,
        'view',
        'allow'
      );
      await CasbinService.addPolicy(
        `user:${creator.creator_id}`,
        `module:${creator.module_id}`,
        'edit',
        'allow'
      );
    }
    console.log(`   ✓ 同步了 ${creators.length} 个创建者权限\n`);
    
    // 8. 验证同步结果
    console.log('8. 验证同步结果...');
    const { rows: ruleCount } = await dbConnection.query(
      'SELECT COUNT(*) as count FROM casbin_rule'
    );
    const { rows: denyCount } = await dbConnection.query(
      'SELECT COUNT(*) as count FROM casbin_deny_policies'
    );
    
    console.log(`   - Allow策略数: ${ruleCount[0].count}`);
    console.log(`   - Deny策略数: ${denyCount[0].count}`);
    
    // 9. 更新同步元数据
    await dbConnection.query(`
      UPDATE casbin_metadata 
      SET sync_version = sync_version + 1,
          sync_status = 'completed',
          last_sync_time = NOW()
      WHERE id = 1
    `);
    
    console.log('\n==================== 同步完成 ====================');
    console.log('现在可以启用Casbin进行权限检查了');
    console.log('设置环境变量 ENABLE_CASBIN=true 来启用\n');
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n同步失败:', error);
    await dbConnection.query(`
      UPDATE casbin_metadata 
      SET sync_status = 'failed',
          notes = ?
      WHERE id = 1
    `, [error.message]);
    process.exit(1);
  }
}

// 执行同步
syncAuthToCasbin();

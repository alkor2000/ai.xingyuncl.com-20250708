/**
 * Casbin集成测试脚本
 * 测试Casbin与现有系统的集成是否正常
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const dbConnection = require('./src/database/connection');
const CasbinService = require('./src/services/casbin/CasbinService');
const CasbinSyncService = require('./src/services/casbin/CasbinSyncService');
const CasbinAuthAdapter = require('./src/services/casbin/CasbinAuthAdapter');

async function testCasbinIntegration() {
  console.log('========== Casbin集成测试 ==========\n');

  try {
    // 1. 初始化数据库连接
    console.log('1. 初始化数据库连接...');
    await dbConnection.initialize();
    console.log('   ✓ 数据库连接成功\n');

    // 2. 初始化Casbin
    console.log('2. 初始化Casbin引擎...');
    await CasbinService.initialize();
    console.log('   ✓ Casbin初始化成功\n');

    // 3. 测试基本策略操作
    console.log('3. 测试策略操作...');
    
    // 添加测试策略
    const added = await CasbinService.addPolicy('user:test', 'module:1', 'view', 'allow');
    console.log(`   - 添加策略: ${added ? '✓' : '✗'}`);
    
    // 检查权限
    const hasPermission = await CasbinService.checkPermission('user:test', 'module:1', 'view');
    console.log(`   - 检查权限: ${hasPermission ? '✓' : '✗'}`);
    
    // 删除策略
    const removed = await CasbinService.removePolicy('user:test', 'module:1', 'view');
    console.log(`   - 删除策略: ${removed ? '✓' : '✗'}\n`);

    // 4. 测试角色继承
    console.log('4. 测试角色继承...');
    
    // 添加角色关系
    await CasbinService.addRoleForUser('user:138', 'tag:14');
    await CasbinService.addRoleForUser('tag:14', 'group:13');
    
    // 获取用户角色
    const roles = await CasbinService.getRolesForUser('user:138');
    console.log(`   - 用户角色: ${roles.join(', ')}\n`);

    // 5. 同步现有数据（小心！这会同步实际数据）
    console.log('5. 是否同步现有授权数据到Casbin？');
    console.log('   警告：这将同步所有teaching_global_authorizations数据');
    console.log('   跳过同步测试...\n');
    // 如果要测试同步，取消下面的注释
    // await CasbinSyncService.clearPolicies();
    // const syncResult = await CasbinSyncService.syncFromGlobalAuth();
    // console.log(`   ✓ 同步完成：${syncResult.totalPolicies}条策略\n`);

    // 6. 测试适配器
    console.log('6. 测试权限适配器...');
    
    // 启用Casbin但不使用结果（只对比）
    CasbinAuthAdapter.enableCasbin(false);
    
    // 测试获取权限（使用实际存在的用户和模块）
    const permission = await CasbinAuthAdapter.getUserModulePermission(
      3, // userId
      2, // moduleId  
      13, // groupId
      [] // tags
    );
    console.log(`   - 模块权限: view=${permission.hasView}, edit=${permission.hasEdit}\n`);

    console.log('========== 测试完成 ==========');
    process.exit(0);

  } catch (error) {
    console.error('测试失败:', error);
    process.exit(1);
  }
}

// 运行测试
testCasbinIntegration();

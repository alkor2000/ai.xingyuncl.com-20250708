const mysql = require('mysql2/promise');

async function testModuleJWT() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'ai_user',
    password: 'AiPlatform@2025!',
    database: 'ai_platform'
  });

  try {
    // 查询最新创建的启用JWT的模块
    const [rows] = await connection.execute(`
      SELECT id, name, display_name, auth_mode, config 
      FROM system_modules 
      WHERE auth_mode = 'jwt' 
      ORDER BY created_at DESC 
      LIMIT 1
    `);

    if (rows.length === 0) {
      console.log('❌ 没有找到配置JWT认证的模块');
      return;
    }

    const module = rows[0];
    console.log('✅ 找到JWT模块:', module.display_name);
    console.log('   - 模块名称:', module.name);
    console.log('   - 认证模式:', module.auth_mode);

    // 解析配置
    if (module.config) {
      const config = typeof module.config === 'string' ? 
        JSON.parse(module.config) : module.config;
      
      console.log('\n📋 JWT配置:');
      console.log('   - 算法:', config.auth?.algorithm || '未设置');
      console.log('   - 有效期:', config.auth?.expiresIn || '未设置', '秒');
      console.log('   - 传递方式:', config.auth?.tokenMethod || '未设置');
      console.log('   - 参数名:', config.auth?.tokenField || '未设置');
      console.log('   - 密钥已设置:', config.auth?.secret ? '✅ 是' : '❌ 否');
      
      if (config.auth?.payload?.includes) {
        console.log('   - Payload包含:', config.auth.payload.includes.join(', '));
      }
    }

    console.log('\n✅ 模块保存成功！');

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  } finally {
    await connection.end();
  }
}

testModuleJWT();

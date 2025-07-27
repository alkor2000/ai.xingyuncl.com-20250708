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
      SELECT id, name, display_name, module_url, open_mode, auth_mode, config, is_active
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
    console.log('\n========== 模块配置信息 ==========');
    console.log('✅ 模块名称:', module.display_name);
    console.log('📌 模块标识:', module.name);
    console.log('🔗 目标URL:', module.module_url);
    console.log('🪟 打开方式:', module.open_mode === 'new_tab' ? '新标签页' : '内嵌显示');
    console.log('🔒 认证模式:', module.auth_mode);
    console.log('✨ 启用状态:', module.is_active ? '已启用' : '已禁用');

    // 解析配置
    if (module.config) {
      const config = typeof module.config === 'string' ? 
        JSON.parse(module.config) : module.config;
      
      console.log('\n========== JWT认证配置 ==========');
      
      // 检查密钥
      let secret = '';
      if (config.auth?.secret) {
        if (config.auth.secret.encrypted) {
          // 密钥已加密，显示提示
          console.log('🔐 密钥状态: 已加密存储（安全）');
          secret = '[已加密存储]';
        } else {
          secret = config.auth.secret;
          console.log('🔑 密钥:', secret);
        }
      }
      
      console.log('📊 算法:', config.auth?.algorithm || 'HS256');
      console.log('⏱️  有效期:', config.auth?.expiresIn || 3600, '秒', `(${(config.auth?.expiresIn || 3600) / 3600}小时)`);
      console.log('📤 传递方式:', config.auth?.tokenMethod || 'query');
      console.log('🏷️  参数名:', config.auth?.tokenField || 'token');
      
      if (config.auth?.payload?.includes) {
        console.log('📦 Payload包含:', config.auth.payload.includes.join(', '));
      }

      // 构建示例URL
      console.log('\n========== 访问URL示例 ==========');
      const tokenMethod = config.auth?.tokenMethod || 'query';
      const tokenField = config.auth?.tokenField || 'token';
      
      if (tokenMethod === 'query') {
        const separator = module.module_url.includes('?') ? '&' : '?';
        const exampleUrl = `${module.module_url}${separator}${tokenField}=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`;
        console.log('🌐 用户访问时URL格式:');
        console.log('   ', exampleUrl);
      } else if (tokenMethod === 'header') {
        console.log('🌐 请求将包含Header:');
        console.log(`   ${tokenField}: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`);
      } else if (tokenMethod === 'cookie') {
        console.log('🌐 请求将包含Cookie:');
        console.log(`   ${tokenField}=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`);
      } else if (tokenMethod === 'post') {
        console.log('🌐 将通过POST表单提交:');
        console.log(`   ${tokenField}: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`);
      }

      console.log('\n========== 对方系统需要的信息 ==========');
      console.log('1️⃣  密钥:', secret === '[已加密存储]' ? '请查看您设置的密钥（xingyun-20250726）' : secret);
      console.log('2️⃣  算法:', config.auth?.algorithm || 'HS256');
      console.log('3️⃣  Token位置和获取方式:');
      
      switch(tokenMethod) {
        case 'query':
          console.log(`   📍 位置: URL参数`);
          console.log(`   📝 PHP代码: $token = $_GET['${tokenField}'];`);
          console.log(`   📝 Node.js代码: const token = req.query.${tokenField};`);
          console.log(`   📝 Python代码: token = request.args.get('${tokenField}')`);
          break;
        case 'header':
          console.log(`   📍 位置: HTTP Header`);
          console.log(`   📝 PHP代码: $token = $_SERVER['HTTP_${tokenField.toUpperCase().replace('-', '_')}'];`);
          console.log(`   📝 Node.js代码: const token = req.headers['${tokenField.toLowerCase()}'];`);
          console.log(`   📝 Python代码: token = request.headers.get('${tokenField}')`);
          break;
        case 'cookie':
          console.log(`   📍 位置: Cookie`);
          console.log(`   📝 PHP代码: $token = $_COOKIE['${tokenField}'];`);
          console.log(`   📝 Node.js代码: const token = req.cookies.${tokenField};`);
          console.log(`   📝 Python代码: token = request.cookies.get('${tokenField}')`);
          break;
        case 'post':
          console.log(`   📍 位置: POST请求体`);
          console.log(`   📝 PHP代码: $token = $_POST['${tokenField}'];`);
          console.log(`   📝 Node.js代码: const token = req.body.${tokenField};`);
          console.log(`   📝 Python代码: token = request.form.get('${tokenField}')`);
          break;
      }
      
      console.log('\n4️⃣  Token中包含的用户信息:');
      if (config.auth?.payload?.includes) {
        config.auth.payload.includes.forEach(field => {
          switch(field) {
            case 'sub':
              console.log(`   - ${field}: 用户ID (字符串类型)`);
              break;
            case 'name':
              console.log(`   - ${field}: 用户名`);
              break;
            case 'email':
              console.log(`   - ${field}: 用户邮箱`);
              break;
            case 'role':
              console.log(`   - ${field}: 用户角色 (user/admin/super_admin)`);
              break;
          }
        });
        console.log('   - group_id: 用户组ID (自动包含)');
        console.log('   - group_name: 用户组名称 (自动包含)');
        console.log('   - iat: 签发时间 (自动包含)');
        console.log('   - exp: 过期时间 (自动包含)');
      }

      console.log('\n========== 验证步骤 ==========');
      console.log('1. 在侧边栏找到并点击该模块');
      console.log('2. 查看浏览器地址栏或开发者工具');
      console.log('3. 确认Token已正确传递');
      console.log('4. 对方系统使用相同密钥验证Token');
    }

    console.log('\n✅ 配置检查完成！');

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  } finally {
    await connection.end();
  }
}

testModuleJWT();

const bcrypt = require('../../backend/node_modules/bcryptjs');
const mysql = require('../../backend/node_modules/mysql2/promise');
const config = require('../../backend/src/config');

async function createTestAdmin() {
  let connection;
  
  try {
    connection = await mysql.createConnection({
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.database
    });

    // 创建测试管理员
    const email = 'admin@test.com';
    const username = 'testadmin';
    const password = 'Test123456';
    const hashedPassword = await bcrypt.hash(password, 10);

    await connection.execute(
      `INSERT INTO users (email, username, password_hash, role, status, token_quota, credits_quota) 
       VALUES (?, ?, ?, 'admin', 'active', 100000, 10000)`,
      [email, username, hashedPassword]
    );

    console.log('测试管理员创建成功！');
    console.log('邮箱:', email);
    console.log('密码:', password);

  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      console.log('测试管理员已存在');
    } else {
      console.error('创建失败:', error);
    }
  } finally {
    if (connection) await connection.end();
  }
}

createTestAdmin();

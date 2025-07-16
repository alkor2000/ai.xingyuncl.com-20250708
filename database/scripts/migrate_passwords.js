/**
 * 密码迁移脚本 - 将明文密码转换为bcrypt hash
 */

// 使用backend目录的依赖
const bcrypt = require('../../backend/node_modules/bcryptjs');
const mysql = require('../../backend/node_modules/mysql2/promise');
const config = require('../../backend/src/config');

async function migratePasswords() {
  let connection;
  
  try {
    // 创建数据库连接
    connection = await mysql.createConnection({
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.database
    });

    console.log('连接数据库成功');

    // 获取所有用户
    const [users] = await connection.execute('SELECT id, email, password_hash FROM users');
    console.log(`找到 ${users.length} 个用户需要处理`);

    let migratedCount = 0;
    let skippedCount = 0;

    for (const user of users) {
      // 检查是否已经是bcrypt hash（bcrypt hash以$2a$, $2b$或$2y$开头）
      if (user.password_hash && user.password_hash.startsWith('$2')) {
        console.log(`用户 ${user.email} 的密码已经加密，跳过`);
        skippedCount++;
        continue;
      }

      // 加密明文密码
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(user.password_hash, saltRounds);

      // 更新数据库
      await connection.execute(
        'UPDATE users SET password_hash = ? WHERE id = ?',
        [hashedPassword, user.id]
      );

      console.log(`用户 ${user.email} 的密码已成功加密`);
      migratedCount++;
    }

    console.log(`\n迁移完成！`);
    console.log(`- 已加密: ${migratedCount} 个用户`);
    console.log(`- 已跳过: ${skippedCount} 个用户`);

  } catch (error) {
    console.error('密码迁移失败:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// 执行迁移
console.log('开始密码迁移...\n');
migratePasswords().then(() => {
  console.log('\n密码迁移成功完成！');
  process.exit(0);
}).catch(error => {
  console.error('\n密码迁移失败:', error);
  process.exit(1);
});

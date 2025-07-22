const dbConnection = require('./backend/src/database/connection');
const User = require('./backend/src/models/User');
const bcrypt = require('bcryptjs');

async function debugProfileUpdate() {
  try {
    // 初始化数据库连接
    await dbConnection.initialize();
    
    // 查找测试用户
    console.log('=== 查找用户 ===');
    const user = await User.findById(4); // superadmin的ID
    console.log('当前用户数据:', {
      id: user.id,
      username: user.username,
      email: user.email,
      phone: user.phone
    });
    
    // 测试更新相同的数据
    console.log('\n=== 测试更新相同的数据 ===');
    const updateData = { phone: '18210711618' };
    console.log('更新数据:', updateData);
    
    try {
      const result = await user.update(updateData);
      console.log('更新成功:', result.phone);
    } catch (error) {
      console.log('更新失败:', error.message);
      console.log('错误详情:', error);
    }
    
    await dbConnection.close();
  } catch (error) {
    console.error('调试失败:', error);
    process.exit(1);
  }
}

debugProfileUpdate();

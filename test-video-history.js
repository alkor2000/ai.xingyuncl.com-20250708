const axios = require('axios');

async function test() {
  try {
    // 1. 登录
    console.log('1. 登录测试...');
    const loginRes = await axios.post('https://ai.xingyuncl.com/api/auth/login', {
      account: 'admin',
      password: '123456'
    });
    
    const token = loginRes.data.data.accessToken;
    console.log('✓ 登录成功\n');
    
    // 2. 测试历史记录查询
    console.log('2. 测试历史记录查询...');
    try {
      const historyRes = await axios.get('https://ai.xingyuncl.com/api/video/history', {
        headers: { 'Authorization': `Bearer ${token}` },
        params: { page: 1, limit: 20 }
      });
      console.log('✓ 历史记录查询成功');
      console.log('  总记录数:', historyRes.data.data.pagination.total);
      console.log('  当前页记录数:', historyRes.data.data.data.length);
      
      // 显示第一条记录
      if (historyRes.data.data.data.length > 0) {
        const first = historyRes.data.data.data[0];
        console.log('\n  第一条记录:');
        console.log('    - ID:', first.id);
        console.log('    - 状态:', first.status);
        console.log('    - 提示词:', first.prompt);
        console.log('    - 视频URL:', first.video_url);
        console.log('    - 本地路径:', first.local_path);
      }
    } catch (err) {
      console.log('✗ 历史记录查询失败:', err.response?.data?.message || err.message);
    }
    
    // 3. 测试公开画廊查询
    console.log('\n3. 测试公开画廊查询...');
    try {
      const galleryRes = await axios.get('https://ai.xingyuncl.com/api/video/gallery', {
        headers: { 'Authorization': `Bearer ${token}` },
        params: { page: 1, limit: 20 }
      });
      console.log('✓ 公开画廊查询成功');
      console.log('  总记录数:', galleryRes.data.data.pagination.total);
    } catch (err) {
      console.log('✗ 公开画廊查询失败:', err.response?.data?.message || err.message);
    }
    
    // 4. 测试统计信息
    console.log('\n4. 测试统计信息查询...');
    try {
      const statsRes = await axios.get('https://ai.xingyuncl.com/api/video/stats', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      console.log('✓ 统计信息查询成功');
      const stats = statsRes.data.data;
      console.log('  总生成数:', stats.total_count);
      console.log('  成功数:', stats.success_count);
      console.log('  失败数:', stats.failed_count);
    } catch (err) {
      console.log('✗ 统计信息查询失败:', err.response?.data?.message || err.message);
    }
    
  } catch (error) {
    console.error('测试失败:', error.response?.data || error.message);
  }
}

test();

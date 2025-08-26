const OSS = require('ali-oss');
const fs = require('fs');

const client = new OSS({
  region: 'oss-cn-beijing',
  accessKeyId: 'LTAI5t79syj3Bs7DNXuY9y6P',
  accessKeySecret: 'tZTthHOdq1nm9MfyDFKwq7tXje3pE4',
  bucket: 'xingyunbeijing20250826'
});

async function testUpload() {
  try {
    // 创建测试文件
    const testContent = 'Test upload at ' + new Date().toISOString();
    const testFile = '/tmp/test-upload.txt';
    fs.writeFileSync(testFile, testContent);
    
    // 上传到OSS
    const ossKey = `test/upload-test-${Date.now()}.txt`;
    console.log('正在上传文件到OSS...');
    const result = await client.put(ossKey, testFile);
    
    console.log('✅ 上传成功！');
    console.log('OSS Key:', ossKey);
    console.log('URL:', result.url);
    
    // 清理测试文件
    fs.unlinkSync(testFile);
    
    // 尝试删除OSS文件
    console.log('正在删除测试文件...');
    await client.delete(ossKey);
    console.log('✅ 删除成功！');
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }
}

testUpload();

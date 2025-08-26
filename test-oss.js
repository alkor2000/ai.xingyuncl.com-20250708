const OSS = require('ali-oss');

// 测试配置
const config = {
  region: 'oss-cn-beijing',
  accessKeyId: 'LTAI5t79syj3Bs7DNXuY9y6P',
  accessKeySecret: 'tZTthHOdq1nm9MfyDFKwq7tXje3pE4',  // 请确认这个密钥是否正确
  bucket: 'xingyunbeijing20250826'
};

async function testOSS() {
  try {
    console.log('测试配置:', {
      ...config,
      accessKeySecret: config.accessKeySecret.substring(0, 4) + '****'
    });
    
    const client = new OSS(config);
    
    console.log('尝试列出bucket中的文件...');
    const result = await client.list({
      'max-keys': 1
    });
    
    console.log('✅ OSS连接成功!');
    console.log('文件数量:', result.objects ? result.objects.length : 0);
    
  } catch (error) {
    console.error('❌ OSS连接失败:', error.message);
    if (error.code === 'SignatureDoesNotMatch') {
      console.error('提示: Access Key Secret可能有误，请检查:');
      console.error('1. 是否有多余的空格');
      console.error('2. 是否完整复制了密钥');
      console.error('3. 密钥是否已经更新');
    }
  }
}

testOSS();

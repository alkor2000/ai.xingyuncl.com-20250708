const mysql = require('mysql2/promise');
const OSS = require('ali-oss');
const fs = require('fs');

async function testOSSFromDatabase() {
  let connection;
  
  try {
    console.log('========================================');
    console.log('OSS配置和连接详细测试');
    console.log('========================================\n');
    
    // 1. 连接数据库
    console.log('1. 连接数据库...');
    connection = await mysql.createConnection({
      host: 'localhost',
      user: 'ai_user',
      password: 'AiPlatform@2025!',
      database: 'ai_platform'
    });
    console.log('✓ 数据库连接成功\n');
    
    // 2. 读取OSS配置
    console.log('2. 从数据库读取OSS配置...');
    const [rows] = await connection.execute(
      'SELECT setting_value FROM system_settings WHERE setting_key = ?',
      ['oss_config']
    );
    
    if (rows.length === 0) {
      console.error('✗ 未找到OSS配置');
      return;
    }
    
    const configStr = rows[0].setting_value;
    console.log('原始配置JSON:', configStr);
    
    const config = JSON.parse(configStr);
    console.log('\n解析后的配置:');
    console.log('  - enabled:', config.enabled);
    console.log('  - provider:', config.provider);
    console.log('  - region:', config.region);
    console.log('  - bucket:', config.bucket);
    console.log('  - accessKeyId:', config.accessKeyId);
    console.log('  - accessKeySecret长度:', config.accessKeySecret.length);
    console.log('  - accessKeySecret前5位:', config.accessKeySecret.substring(0, 5) + '...');
    
    // 检查是否有空格
    if (config.accessKeySecret.startsWith(' ') || config.accessKeySecret.endsWith(' ')) {
      console.error('\n⚠️  警告: accessKeySecret包含前导或尾随空格！');
      console.log('  原始值: "' + config.accessKeySecret + '"');
      console.log('  去空格后: "' + config.accessKeySecret.trim() + '"');
    }
    
    // 3. 初始化OSS客户端
    console.log('\n3. 初始化阿里云OSS客户端...');
    const client = new OSS({
      region: config.region,
      accessKeyId: config.accessKeyId.trim(),
      accessKeySecret: config.accessKeySecret.trim(),
      bucket: config.bucket
    });
    console.log('✓ OSS客户端创建成功\n');
    
    // 4. 测试列出文件
    console.log('4. 测试列出Bucket中的文件...');
    try {
      const listResult = await client.list({
        'max-keys': 5
      });
      console.log('✓ 列出文件成功');
      console.log('  文件数量:', listResult.objects ? listResult.objects.length : 0);
      if (listResult.objects && listResult.objects.length > 0) {
        console.log('  前5个文件:');
        listResult.objects.slice(0, 5).forEach(obj => {
          console.log('    -', obj.name);
        });
      }
    } catch (listError) {
      console.error('✗ 列出文件失败:', listError.message);
      console.error('  错误代码:', listError.code);
      console.error('  请求ID:', listError.requestId);
      throw listError;
    }
    
    // 5. 测试上传文件
    console.log('\n5. 测试上传文件...');
    const testFileName = 'test-' + Date.now() + '.txt';
    const testContent = 'OSS测试文件内容 - ' + new Date().toISOString();
    const testPath = '/tmp/' + testFileName;
    
    fs.writeFileSync(testPath, testContent);
    console.log('  创建测试文件:', testPath);
    
    const ossKey = 'test/oss-test/' + testFileName;
    console.log('  上传到OSS路径:', ossKey);
    
    try {
      const uploadResult = await client.put(ossKey, testPath);
      console.log('✓ 文件上传成功');
      console.log('  文件URL:', uploadResult.url);
      console.log('  ETag:', uploadResult.res.headers.etag);
      
      // 6. 验证文件存在
      console.log('\n6. 验证文件存在...');
      const headResult = await client.head(ossKey);
      console.log('✓ 文件存在确认');
      console.log('  文件大小:', headResult.res.headers['content-length']);
      
      // 7. 删除测试文件
      console.log('\n7. 删除测试文件...');
      await client.delete(ossKey);
      console.log('✓ 测试文件已删除');
      
    } catch (uploadError) {
      console.error('✗ 上传失败:', uploadError.message);
      console.error('  错误代码:', uploadError.code);
      console.error('  请求ID:', uploadError.requestId);
      throw uploadError;
    } finally {
      // 清理本地文件
      if (fs.existsSync(testPath)) {
        fs.unlinkSync(testPath);
      }
    }
    
    console.log('\n========================================');
    console.log('✅ 所有测试通过！OSS配置正确');
    console.log('========================================');
    
  } catch (error) {
    console.error('\n========================================');
    console.error('❌ 测试失败');
    console.error('========================================');
    console.error('错误详情:', error);
    
    if (error.code === 'SignatureDoesNotMatch') {
      console.error('\n可能的原因:');
      console.error('1. AccessKey ID或Secret有误');
      console.error('2. 密钥中包含空格或特殊字符');
      console.error('3. Region设置不正确');
    } else if (error.code === 'InvalidAccessKeyId') {
      console.error('\n可能的原因:');
      console.error('1. AccessKey ID不存在');
      console.error('2. AccessKey ID格式错误');
    } else if (error.code === 'NoSuchBucket') {
      console.error('\n可能的原因:');
      console.error('1. Bucket名称错误');
      console.error('2. Bucket不存在于指定的Region');
    }
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// 运行测试
testOSSFromDatabase();

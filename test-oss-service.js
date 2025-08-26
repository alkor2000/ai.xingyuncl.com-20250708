const ossService = require('./backend/src/services/ossService');

async function test() {
  try {
    console.log('测试ossService初始化...');
    const result = await ossService.initialize();
    console.log('初始化结果:', result);
    console.log('是否使用本地存储:', ossService.isLocal);
    console.log('配置:', ossService.config);
    
    if (!ossService.isLocal && ossService.client) {
      console.log('✅ OSS客户端已正确初始化');
    } else if (ossService.isLocal) {
      console.log('⚠️  使用本地存储模式');
    } else {
      console.log('❌ OSS客户端初始化失败');
    }
  } catch (error) {
    console.error('测试失败:', error);
  }
}

test();

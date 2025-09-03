/**
 * 测试OpenRouter上的Gemini-2.5-flash-image-preview模型
 */

const axios = require('axios');
const fs = require('fs').promises;

async function testGeminiImageGeneration() {
  const API_KEY = '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';
  const API_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
  const MODEL = 'google/gemini-2.5-flash-image-preview';

  console.log('测试OpenRouter上的Gemini-2.5-flash-image-preview模型\n');
  console.log('API端点:', API_ENDPOINT);
  console.log('模型:', MODEL);
  console.log('=' .repeat(60));

  // 测试不同的提示词
  const testCases = [
    {
      name: '中文图片生成请求',
      message: '生成一个美短猫宇航员的图片'
    },
    {
      name: '英文图片生成请求',
      message: 'Generate an image of a cute American Shorthair cat astronaut floating in space'
    },
    {
      name: '详细描述（参考Gemini文档格式）',
      message: 'Create a picture of a fluffy American Shorthair cat wearing a NASA spacesuit, floating in space with Earth in the background. Photorealistic style, high resolution.'
    }
  ];

  for (let i = 0; i < testCases.length; i++) {
    const test = testCases[i];
    console.log(`\n测试 ${i + 1}: ${test.name}`);
    console.log('提示词:', test.message);
    console.log('-'.repeat(40));

    try {
      const response = await axios.post(API_ENDPOINT, {
        model: MODEL,
        messages: [
          {
            role: 'user',
            content: test.message
          }
        ],
        temperature: 0.7
      }, {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://ai.xingyuncl.com',
          'X-Title': 'AI Platform'
        },
        timeout: 60000
      });

      console.log('✅ 请求成功！');
      
      // 分析响应结构
      console.log('\n响应结构分析:');
      console.log('- 顶层键:', Object.keys(response.data));
      
      if (response.data.choices) {
        console.log('- choices数量:', response.data.choices.length);
        
        if (response.data.choices[0]) {
          const choice = response.data.choices[0];
          console.log('- choice键:', Object.keys(choice));
          console.log('- message键:', Object.keys(choice.message || {}));
          
          const content = choice.message?.content;
          if (content) {
            console.log('\n内容分析:');
            console.log('- 类型:', typeof content);
            console.log('- 长度:', content.length, '字符');
            
            // 检查是否包含图片数据
            if (content.includes('data:image')) {
              console.log('✅ 发现Base64图片数据!');
              const base64Start = content.indexOf('data:image');
              const base64End = content.indexOf('"', base64Start);
              if (base64End > base64Start) {
                const imageData = content.substring(base64Start, base64End);
                console.log('- 图片数据长度:', imageData.length);
                console.log('- 图片格式:', imageData.substring(0, 30) + '...');
              }
            } else if (content.includes('http://') || content.includes('https://')) {
              console.log('✅ 发现图片URL!');
              const urlMatch = content.match(/(https?:\/\/[^\s"]+)/);
              if (urlMatch) {
                console.log('- 图片URL:', urlMatch[1]);
              }
            } else {
              console.log('⚠️ 未发现图片数据，只有文本响应');
              console.log('- 响应内容预览:', content.substring(0, 200));
            }
          }
        }
      }
      
      // 保存完整响应
      const filename = `/var/www/ai-platform/logs/openrouter_gemini_test_${i + 1}.json`;
      await fs.writeFile(filename, JSON.stringify(response.data, null, 2));
      console.log(`\n完整响应已保存到: ${filename}`);
      
    } catch (error) {
      console.error('❌ 请求失败!');
      if (error.response) {
        console.error('- 状态码:', error.response.status);
        console.error('- 错误信息:', error.response.data);
        
        // 保存错误响应
        const filename = `/var/www/ai-platform/logs/openrouter_gemini_error_${i + 1}.json`;
        await fs.writeFile(filename, JSON.stringify(error.response.data, null, 2));
        console.log(`错误详情已保存到: ${filename}`);
      } else {
        console.error('- 错误:', error.message);
      }
    }
    
    // 等待避免频率限制
    if (i < testCases.length - 1) {
      console.log('\n等待2秒...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('测试完成！');
}

// 运行测试
testGeminiImageGeneration().catch(console.error);

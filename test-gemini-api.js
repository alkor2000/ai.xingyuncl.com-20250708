/**
 * 直接测试Gemini API的响应格式
 */

const axios = require('axios');

async function testGeminiAPI() {
  const API_KEY = 'sk-VIjVjJq0xOj8aO2p2aE5Dc3bA3074d4a2b0244A9BdE76267F87bC8Fb';
  const API_ENDPOINT = 'https://kmvmtjom.cloud.sealos.io/v1/chat/completions';
  const MODEL = 'google/gemini-2.5-flash-image-preview';

  console.log('测试Gemini图片生成API...\n');

  // 测试不同的提示词格式
  const prompts = [
    // 1. 简单的生成请求
    "生成一个美短猫宇航员的图片",
    
    // 2. 英文请求
    "Generate an image of a cute cat astronaut",
    
    // 3. 更详细的描述（参考Gemini文档）
    "Create a picture of a fluffy American Shorthair cat wearing a NASA spacesuit, floating in space with Earth in the background. The cat should look happy and the image should be photorealistic.",
    
    // 4. 明确的生成指令
    "Please generate an image: A photorealistic portrait of an American Shorthair cat dressed as an astronaut"
  ];

  for (let i = 0; i < prompts.length; i++) {
    console.log(`\n测试 ${i + 1}: ${prompts[i]}\n`);
    
    try {
      const response = await axios.post(API_ENDPOINT, {
        model: MODEL,
        messages: [
          {
            role: 'user',
            content: prompts[i]
          }
        ],
        temperature: 0.7
      }, {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      console.log('响应结构:');
      console.log('- 顶层键:', Object.keys(response.data));
      
      if (response.data.choices) {
        console.log('- choices数量:', response.data.choices.length);
        if (response.data.choices[0]) {
          console.log('- choice[0]键:', Object.keys(response.data.choices[0]));
          console.log('- message键:', Object.keys(response.data.choices[0].message || {}));
          
          const content = response.data.choices[0].message?.content;
          if (content) {
            console.log('- content类型:', typeof content);
            console.log('- content长度:', content.length);
            console.log('- content前100字符:', content.substring(0, 100));
            
            // 检查是否包含base64图片数据
            if (content.includes('data:image') || content.includes('base64')) {
              console.log('✅ 发现图片数据标记!');
            }
          }
        }
      }
      
      if (response.data.candidates) {
        console.log('- candidates数量:', response.data.candidates.length);
        if (response.data.candidates[0]) {
          console.log('- candidate[0]键:', Object.keys(response.data.candidates[0]));
          if (response.data.candidates[0].content) {
            console.log('- content键:', Object.keys(response.data.candidates[0].content));
            if (response.data.candidates[0].content.parts) {
              console.log('- parts数量:', response.data.candidates[0].content.parts.length);
              response.data.candidates[0].content.parts.forEach((part, idx) => {
                console.log(`  - part[${idx}]键:`, Object.keys(part));
                if (part.inline_data) {
                  console.log(`    ✅ part[${idx}]包含inline_data!`);
                }
              });
            }
          }
        }
      }
      
      // 保存完整响应用于分析
      const fs = require('fs').promises;
      const filename = `/var/www/ai-platform/logs/test_response_${i + 1}.json`;
      await fs.writeFile(filename, JSON.stringify(response.data, null, 2));
      console.log(`完整响应已保存到: ${filename}`);
      
    } catch (error) {
      console.error(`测试 ${i + 1} 失败:`, error.response?.data || error.message);
    }
    
    // 等待一下避免频率限制
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

// 运行测试
testGeminiAPI().then(() => {
  console.log('\n测试完成！');
}).catch(console.error);

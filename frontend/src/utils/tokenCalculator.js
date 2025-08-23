/**
 * Token计算工具（前端版本）
 * 与后端保持一致的计算逻辑
 */

/**
 * 计算文本的token数量
 * @param {string} text - 要计算的文本
 * @returns {number} - 估算的token数量
 */
export function calculateTokens(text) {
  if (!text || typeof text !== 'string') {
    return 0;
  }

  const cleanText = text.trim();
  if (!cleanText) {
    return 0;
  }

  // 统计不同类型的字符
  let chineseCount = 0;
  let englishWords = 0;
  let numbers = 0;
  let punctuation = 0;
  let whitespace = 0;

  // 匹配中文字符
  const chineseMatches = cleanText.match(/[\u4e00-\u9fa5]/g);
  if (chineseMatches) {
    chineseCount = chineseMatches.length;
  }

  // 匹配英文单词
  const englishMatches = cleanText.match(/[a-zA-Z]+/g);
  if (englishMatches) {
    englishWords = englishMatches.length;
  }

  // 匹配数字序列
  const numberMatches = cleanText.match(/\d+/g);
  if (numberMatches) {
    numbers = numberMatches.length;
  }

  // 匹配标点符号
  const punctuationMatches = cleanText.match(/[^\w\s\u4e00-\u9fa5]/g);
  if (punctuationMatches) {
    punctuation = punctuationMatches.length;
  }

  // 统计空白字符
  const whitespaceMatches = cleanText.match(/\s/g);
  if (whitespaceMatches) {
    whitespace = whitespaceMatches.length;
  }

  // 计算token数量
  let tokens = 0;
  tokens += chineseCount * 1.5;
  tokens += englishWords * 1.3;
  tokens += numbers;
  tokens += punctuation * 0.5;
  
  const newlines = (cleanText.match(/\n/g) || []).length;
  const spaces = whitespace - newlines;
  tokens += spaces * 0.25 + newlines * 0.5;

  return Math.ceil(tokens);
}

/**
 * 格式化token数量为K单位显示
 * @param {number} tokens - token数量
 * @returns {string} - 格式化后的字符串
 */
export function formatTokenCount(tokens) {
  if (!tokens || tokens === 0) {
    return '0';
  }
  
  // 小于1000时的精确显示
  if (tokens < 1000) {
    if (tokens < 10) {
      return (tokens / 1000).toFixed(3) + 'K';
    }
    if (tokens < 100) {
      return (tokens / 1000).toFixed(2) + 'K';
    }
    return (tokens / 1000).toFixed(1) + 'K';
  }
  
  // 1000-10000显示一位小数
  if (tokens < 10000) {
    return (tokens / 1000).toFixed(1) + 'K';
  }
  
  // 大于10000显示整数
  return Math.round(tokens / 1000) + 'K';
}

/**
 * 计算多个模块的总token数
 * @param {Array} modules - 模块数组
 * @returns {number} - 总token数
 */
export function calculateModulesTotalTokens(modules) {
  if (!Array.isArray(modules)) {
    return 0;
  }
  
  return modules.reduce((total, module) => {
    // 优先使用后端计算的token_count
    if (module.token_count) {
      return total + module.token_count;
    }
    // 否则实时计算
    return total + calculateTokens(module.content || '');
  }, 0);
}

/**
 * 获取token使用状态
 * @param {number} tokens - 当前token数
 * @param {number} maxTokens - 最大token数
 * @returns {object} - 包含百分比和状态
 */
export function getTokenStatus(tokens, maxTokens = 100000) {
  const percentage = Math.min((tokens / maxTokens) * 100, 100);
  
  let status = 'success';
  let color = '#52c41a';
  
  if (percentage > 90) {
    status = 'danger';
    color = '#ff4d4f';
  } else if (percentage > 70) {
    status = 'warning';
    color = '#faad14';
  }
  
  return {
    percentage: Math.round(percentage),
    status,
    color,
    isOverLimit: tokens > maxTokens
  };
}

// 默认导出所有函数
export default {
  calculateTokens,
  formatTokenCount,
  calculateModulesTotalTokens,
  getTokenStatus
};

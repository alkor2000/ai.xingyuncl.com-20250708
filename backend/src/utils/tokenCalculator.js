/**
 * Token计算工具
 * 提供统一的token估算算法
 */

/**
 * 计算文本的token数量
 * 使用更准确的估算算法
 * @param {string} text - 要计算的文本
 * @returns {number} - 估算的token数量
 */
function calculateTokens(text) {
  if (!text || typeof text !== 'string') {
    return 0;
  }

  // 移除多余的空白字符
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

  // 匹配英文单词（连续的字母）
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

  // 统计空白字符（空格、换行等）
  const whitespaceMatches = cleanText.match(/\s/g);
  if (whitespaceMatches) {
    whitespace = whitespaceMatches.length;
  }

  // 计算token数量
  // 基于GPT模型的tokenizer特性进行估算
  let tokens = 0;

  // 中文字符：平均每个字符1.5个token
  tokens += chineseCount * 1.5;

  // 英文单词：平均每个单词1.3个token
  tokens += englishWords * 1.3;

  // 数字：每个数字序列算1个token
  tokens += numbers;

  // 标点符号：每个1个token
  tokens += punctuation * 0.5;

  // 空白字符：空格算0.25个token，换行算0.5个token
  const newlines = (cleanText.match(/\n/g) || []).length;
  const spaces = whitespace - newlines;
  tokens += spaces * 0.25 + newlines * 0.5;

  // 向上取整
  return Math.ceil(tokens);
}

/**
 * 格式化token数量为K单位显示
 * @param {number} tokens - token数量
 * @returns {string} - 格式化后的字符串
 */
function formatTokenCount(tokens) {
  if (!tokens || tokens === 0) {
    return '0';
  }
  
  // 小于1000直接显示
  if (tokens < 1000) {
    // 如果小于1，显示为0.001K这样的格式
    if (tokens < 100) {
      return (tokens / 1000).toFixed(3) + 'K';
    }
    return (tokens / 1000).toFixed(2) + 'K';
  }
  
  // 1000-10000显示一位小数
  if (tokens < 10000) {
    return (tokens / 1000).toFixed(1) + 'K';
  }
  
  // 大于10000显示整数
  return Math.round(tokens / 1000) + 'K';
}

/**
 * 计算多个文本的总token数
 * @param {string[]} texts - 文本数组
 * @returns {number} - 总token数
 */
function calculateTotalTokens(texts) {
  if (!Array.isArray(texts)) {
    return 0;
  }
  
  return texts.reduce((total, text) => {
    return total + calculateTokens(text);
  }, 0);
}

/**
 * 获取token使用状态
 * @param {number} tokens - 当前token数
 * @param {number} maxTokens - 最大token数
 * @returns {object} - 包含百分比和状态
 */
function getTokenStatus(tokens, maxTokens = 100000) {
  const percentage = Math.min((tokens / maxTokens) * 100, 100);
  
  let status = 'success';
  if (percentage > 90) {
    status = 'danger';
  } else if (percentage > 70) {
    status = 'warning';
  }
  
  return {
    percentage: Math.round(percentage),
    status,
    isOverLimit: tokens > maxTokens
  };
}

module.exports = {
  calculateTokens,
  formatTokenCount,
  calculateTotalTokens,
  getTokenStatus
};

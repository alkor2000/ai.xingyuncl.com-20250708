/**
 * 日志工具模块
 * 支持本地开发和Docker部署
 */
const winston = require('winston');
const path = require('path');
const fs = require('fs');

// 根据环境决定日志目录
// Docker环境：使用/app/logs目录（通过环境变量LOG_DIR指定）
// 本地环境：使用相对路径
const logDir = process.env.LOG_DIR 
  ? path.join(process.env.LOG_DIR, 'backend/auth')
  : path.resolve(__dirname, '../../../logs/backend/auth');

// 尝试创建日志目录
try {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
} catch (error) {
  console.warn('无法创建日志目录，使用控制台输出:', error.message);
}

// 定义日志格式
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    return stack 
      ? `${timestamp} ${level}: ${message}\n${stack}`
      : `${timestamp} ${level}: ${message}`;
  })
);

// 创建传输方式数组
const transports = [];

// 如果能创建日志目录，添加文件传输
try {
  if (fs.existsSync(logDir) && fs.accessSync(logDir, fs.constants.W_OK) === undefined) {
    // 错误日志文件
    transports.push(new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }));
    
    // 所有日志文件
    transports.push(new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }));
  }
} catch (error) {
  console.warn('无法写入日志文件，仅使用控制台输出');
}

// 始终添加控制台输出
transports.push(new winston.transports.Console({
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.simple()
  )
}));

// 创建 Winston logger 实例
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'ai-platform-backend' },
  transports: transports
});

// 扩展 logger 功能
logger.stream = {
  write: function(message) {
    logger.info(message.trim());
  }
};

module.exports = logger;

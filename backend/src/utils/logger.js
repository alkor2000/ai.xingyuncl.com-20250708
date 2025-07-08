/**
 * 日志工具模块
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');

// 使用固定的日志目录路径
const logDir = path.resolve(__dirname, '../../../logs/backend/auth');

// 确保日志目录存在
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
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

// 创建 Winston logger 实例
const logger = winston.createLogger({
  level: 'info',
  format: logFormat,
  defaultMeta: { service: 'ai-platform-backend' },
  transports: [
    // 错误日志文件
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    
    // 所有日志文件
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    
    // 控制台输出
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// 扩展 logger 功能
logger.stream = {
  write: function(message) {
    logger.info(message.trim());
  }
};

module.exports = logger;

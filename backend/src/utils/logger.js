/**
 * 日志工具
 */

const winston = require('winston');
const config = require('../config');
const path = require('path');
const fs = require('fs');

// 确保日志目录存在
const logDir = config.logging.dir;
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// 日志格式
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// 控制台格式
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}] ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

// 创建logger
const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  transports: [
    // 错误日志文件
    new winston.transports.File({
      filename: path.join(logDir, config.logging.file.error),
      level: 'error',
      maxsize: 20971520, // 20MB
      maxFiles: 5,
      tailable: true
    }),
    
    // 综合日志文件
    new winston.transports.File({
      filename: path.join(logDir, config.logging.file.combined),
      maxsize: 20971520, // 20MB
      maxFiles: 5,
      tailable: true
    })
  ]
});

// 开发环境添加控制台输出
if (config.app.env !== 'production') {
  logger.add(new winston.transports.Console({
    format: consoleFormat
  }));
}

module.exports = logger;

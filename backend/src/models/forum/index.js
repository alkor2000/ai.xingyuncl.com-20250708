/**
 * 论坛模块 - 模型统一导出
 * 
 * @module models/forum
 */

const BaseModel = require('./BaseModel');
const ForumBoard = require('./ForumBoard');
const ForumPost = require('./ForumPost');
const ForumReply = require('./ForumReply');
const ForumAttachment = require('./ForumAttachment');

module.exports = {
  BaseModel,
  ForumBoard,
  ForumPost,
  ForumReply,
  ForumAttachment
};

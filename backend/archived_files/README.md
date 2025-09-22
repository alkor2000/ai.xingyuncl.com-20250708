# 归档文件说明

此目录包含系统重构和迭代过程中产生的旧文件和备份。

## 目录结构

### 旧版控制器文件
- `controllers/` - 旧版控制器主文件
  - `authController.js` - 旧版认证控制器（已被AuthControllerRefactored.js替代）
  - `chatController.js` - 旧版聊天控制器（已被ChatControllerRefactored.js替代）
  - `chatController_fixed.js` - 临时修复文件

### 各模块备份文件  
- `controllers/auth_backups/` - 认证控制器的历史备份
- `controllers/chat_backups/` - 聊天控制器的历史备份
- `controllers/storage_backups/` - 存储控制器的历史备份
- `controllers/image_backups/` - 图像控制器的历史备份
- `controllers/html_editor_backups/` - HTML编辑器控制器的历史备份
- `controllers/video_backups/` - 视频控制器的历史备份
- `controllers/knowledge_backups/` - 知识模块控制器的历史备份
- `controllers/misc_backups/` - 其他杂项备份

## 当前使用的主要文件

### 核心控制器
- `/src/controllers/AuthControllerRefactored.js` - 当前认证控制器
- `/src/controllers/ChatControllerRefactored.js` - 当前聊天控制器

### 功能模块控制器
- `/src/controllers/StorageController.js` - 存储管理控制器
- `/src/controllers/imageController.js` - 图像生成控制器
- `/src/controllers/videoController.js` - 视频生成控制器
- `/src/controllers/HtmlEditorController.js` - HTML编辑器控制器
- `/src/controllers/KnowledgeModuleController.js` - 知识模块控制器
- `/src/controllers/ModuleCombinationController.js` - 模块组合控制器
- `/src/controllers/OcrController.js` - OCR控制器
- `/src/controllers/PublicUploadController.js` - 公共上传控制器
- `/src/controllers/statsController.js` - 统计控制器
- `/src/controllers/adminController.js` - 管理员控制器
- `/src/controllers/fileController.js` - 文件控制器

## 归档日期

2025-09-22

## 注意事项

1. 这些文件仅作为历史参考保留，不应再被引用或使用
2. 如果需要恢复某个文件，请先确认其兼容性
3. 建议定期清理过于陈旧的备份文件以节省空间
4. 新的开发应基于当前使用的文件进行

## 版本迭代记录

- 2025-09-22: 系统重构，认证和聊天控制器改为Refactored版本
- 2025-09-22: 清理所有历史备份文件到归档目录

-- 迁移脚本：为AI模型添加文档上传支持
-- 执行时间：2025-08-10

-- 添加文档上传启用字段
ALTER TABLE ai_models 
ADD COLUMN document_upload_enabled BOOLEAN DEFAULT FALSE COMMENT '是否支持文档上传' 
AFTER image_upload_enabled;

-- 为特定模型启用文档上传（可选，根据实际需求）
-- UPDATE ai_models SET document_upload_enabled = 1 WHERE name IN ('gpt-4o-all', 'o3-all');

-- 添加索引以优化查询
ALTER TABLE ai_models ADD INDEX idx_document_upload (document_upload_enabled);

-- 验证添加成功
SELECT name, display_name, image_upload_enabled, document_upload_enabled 
FROM ai_models 
ORDER BY sort_order ASC, created_at ASC;

-- 修复图像生成记录的级联删除问题
-- 将 ON DELETE CASCADE 改为 ON DELETE SET NULL
-- 这样删除模型后，图像记录仍然保留，只是model_id变为NULL

-- 1. 先删除现有的外键约束
ALTER TABLE image_generations 
DROP FOREIGN KEY image_generations_ibfk_2;

-- 2. 修改model_id字段允许NULL
ALTER TABLE image_generations 
MODIFY COLUMN model_id BIGINT NULL COMMENT '模型ID（可为空，模型删除后保留记录）';

-- 3. 重新添加外键约束，使用ON DELETE SET NULL
ALTER TABLE image_generations 
ADD CONSTRAINT image_generations_model_fk 
FOREIGN KEY (model_id) REFERENCES image_models(id) 
ON DELETE SET NULL;

-- 4. 添加索引优化查询
ALTER TABLE image_generations 
ADD INDEX idx_public (is_public, created_at);
